import * as THREE from 'three';
import { clamp, clamp01, damp, sigmoid, smoothstep, softStep } from './math.js';

// ============================================================
//  ZMF §3/§7.1 : Angular Dynamics
//    quaternion attitude, adaptive bank damping, centripetal assist,
//    adaptive auto-horizon.
//
//  The contract: attitude is always derived from a (forward, up) pair,
//  never integrated freely. That is what makes it impossible for the
//  machine to drift into an unrecoverable orientation.
// ============================================================

const WORLD_UP = new THREE.Vector3(0, 1, 0);

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qPrev = new THREE.Quaternion();

const DEG = Math.PI / 180;

export class AngularDynamics {
  constructor(stats) {
    this.quaternion = new THREE.Quaternion();
    /** The free-look forward vector, before assist and bank are applied. */
    this.freeForward = new THREE.Vector3(0, 0, 1);
    this.forward = new THREE.Vector3(0, 0, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.right = new THREE.Vector3(1, 0, 0);

    this.bank = 0;              // current roll about forward, radians
    this.angularVelocity = new THREE.Vector3();
    this.turnRate = 0;          // scalar magnitude, rad/s
    /** 0 = free 3D attitude, 1 = pinned to the horizon. */
    this.horizonWeight = 1;

    this.setStats(stats);
  }

  setStats(stats) {
    this.stats = stats;
    // Rotational authority falls off with inertia — big builds turn like they look.
    this.turnAuthority = clamp(4.6 * (1 - stats.weightClass * 0.55) + stats.agility * 1.8, 1.1, 7.5);
    this.maxBankLow = 15 * DEG;
    this.maxBankHigh = 30 * DEG;
  }

  reset(forward = new THREE.Vector3(0, 0, 1)) {
    this.freeForward.copy(forward).normalize();
    this.forward.copy(this.freeForward);
    this.bank = 0;
    this.angularVelocity.set(0, 0, 0);
    this.quaternion.identity();
  }

  /**
   * @param {object} p
   * @param {{yaw:number, pitch:number}} p.look       normalised look input
   * @param {THREE.Vector3|null} p.aimPoint           lock-on aim point, world
   * @param {THREE.Vector3} p.position
   * @param {THREE.Vector3} p.velocity
   * @param {number} p.assistAuthority                0..1 from AssistController
   * @param {number} p.layerTurn                      ABC turn scalar
   * @param {number} p.grounded                       0..1 ground contact
   */
  update(p, dt) {
    _qPrev.copy(this.quaternion);

    const speed = p.velocity.length();
    const speedNorm = clamp01(speed / 30);

    // ---------------------------------------------------- 1. free look
    // Yaw about the *world* up rather than the body up. This is the single
    // biggest defence against spatial disorientation during violent 3D work.
    // look input already arrives as rad/s; ABC is the only extra scaling.
    const rate = p.layerTurn;
    if (p.look.yaw) {
      _q.setFromAxisAngle(WORLD_UP, p.look.yaw * rate * dt);
      this.freeForward.applyQuaternion(_q);
    }
    if (p.look.pitch) {
      // forward x worldUp points along body -X, so a positive pitch input
      // rotates the nose upward. Keep the sign here, not at the call site.
      _right.copy(this.freeForward).cross(WORLD_UP);
      if (_right.lengthSq() < 1e-6) _right.set(-1, 0, 0);
      _right.normalize();
      _q.setFromAxisAngle(_right, p.look.pitch * rate * dt);
      _tmp.copy(this.freeForward).applyQuaternion(_q);
      // Refuse to tip past the poles; gimbal flips read as a bug, never as flair.
      if (Math.abs(_tmp.y) < 0.985) this.freeForward.copy(_tmp);
    }
    this.freeForward.normalize();

    // ---------------------------------------------------- 2. target forward
    _fwd.copy(this.freeForward);

    if (p.aimPoint && p.assistAuthority > 0.001) {
      _tmp.copy(p.aimPoint).sub(p.position);
      if (_tmp.lengthSq() > 1e-4) {
        _tmp.normalize();
        // Slerp-ish blend through the shortest arc.
        const a = clamp01(p.assistAuthority);
        _fwd.lerp(_tmp, a).normalize();
        // Keep free-look anchored to where the assist actually points, so
        // releasing the target does not snap the view somewhere else.
        this.freeForward.lerp(_fwd, clamp01(dt * 6 * a)).normalize();
      }
    } else if (p.grounded > 0.5 && speed > 1.2 && !p.look.yaw && !p.look.pitch) {
      // Grounded and coasting: settle the nose onto the travel direction.
      _tmp.copy(p.velocity); _tmp.y = 0;
      if (_tmp.lengthSq() > 0.25) {
        _tmp.normalize();
        _fwd.lerp(_tmp, clamp01(dt * 1.8)).normalize();
        this.freeForward.copy(_fwd);
      }
    }

    // ---------------------------------------------------- 3. adaptive bank
    // Lateral acceleration in the body frame is what a pilot would feel
    // through the seat; roll into it, proportionally.
    _right.copy(_fwd).cross(WORLD_UP);
    if (_right.lengthSq() < 1e-6) _right.copy(this.right);
    _right.normalize();

    const lateralG = p.accel ? p.accel.dot(_right) : 0;
    const maxBank = THREE.MathUtils.lerp(this.maxBankLow, this.maxBankHigh, softStep(speed, 6, 26, 5));
    // Below walking pace the horizon is held strictly — that is the "not
    // nauseating" half of the deal.
    const bankGate = smoothstep(2.5, 12, speed) * (1 - p.grounded * 0.55);
    const bankTarget = clamp(-lateralG * 0.055, -1, 1) * maxBank * bankGate;

    // Rolling in is quick; rolling out uses a sigmoid so the horizon glides back.
    const rollingIn = Math.abs(bankTarget) > Math.abs(this.bank);
    const restore = sigmoid((Math.abs(this.bank) - Math.abs(bankTarget)) * 8) * 0.5 + 0.5;
    const hl = rollingIn ? 0.10 : 0.26 * restore;
    this.bank = damp(this.bank, bankTarget, hl, dt);

    // ---------------------------------------------------- 4. adaptive auto-horizon
    // The reference up is world-up, weakened only while the machine is
    // genuinely inverted or vertical, where world-up carries no information.
    const verticality = Math.abs(_fwd.y);
    const horizonAuthority = (1 - smoothstep(0.72, 0.985, verticality)) * this.horizonWeight;
    _up.copy(WORLD_UP).lerp(this.up, 1 - horizonAuthority).normalize();

    _right.copy(_up).cross(_fwd);
    if (_right.lengthSq() < 1e-6) _right.copy(this.right);
    _right.normalize();
    _up.copy(_fwd).cross(_right).normalize();

    if (this.bank) {
      _q.setFromAxisAngle(_fwd, this.bank);
      _up.applyQuaternion(_q).normalize();
      _right.copy(_up).cross(_fwd).normalize();
    }

    // ---------------------------------------------------- 5. commit
    // basis X = up x forward, which is the body's right-hand axis
    _m.makeBasis(_right, _up, _fwd);
    _q.setFromRotationMatrix(_m);

    // Slerp rate scales with how far we have to go: small errors settle
    // smoothly, big ones get authority. Never a constant, never a snap.
    const err = this.quaternion.angleTo(_q);
    const k = clamp01(1 - Math.pow(0.0005, dt * this.turnAuthority * p.layerTurn * (0.45 + clamp01(err) * 0.9)));
    this.quaternion.slerp(_q, k);

    this.forward.set(0, 0, 1).applyQuaternion(this.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion);

    // ---------------------------------------------------- 6. angular velocity
    _q.copy(_qPrev).invert().premultiply(this.quaternion);
    const angle = 2 * Math.acos(clamp(_q.w, -1, 1));
    const s = Math.sqrt(Math.max(1e-9, 1 - _q.w * _q.w));
    if (angle > 1e-5 && dt > 0) {
      _tmp2.set(_q.x / s, _q.y / s, _q.z / s).multiplyScalar(angle / dt);
      this.angularVelocity.lerp(_tmp2, clamp01(dt * 20));
    } else {
      this.angularVelocity.multiplyScalar(Math.pow(0.02, dt));
    }
    this.turnRate = this.angularVelocity.length();

    return this.quaternion;
  }

  /**
   * §3 — centripetal assist. While turning hard, a slice of the machine's
   * momentum is rotated to follow the nose. Without it, fast turns feel like
   * skidding on ice; with too much, inertia disappears entirely.
   */
  applyCentripetalAssist(velocity, dt, strength = 0.5) {
    const speed = velocity.length();
    if (speed < 1.5) return;
    _tmp.copy(velocity).divideScalar(speed);
    const align = _tmp.dot(this.forward);
    if (align <= 0) return; // never help a reversal, that is the counter-thruster's job
    const k = clamp01(dt * this.turnRate * strength * 2.2);
    _tmp.lerp(this.forward, k).normalize();
    velocity.copy(_tmp).multiplyScalar(speed);
  }
}
