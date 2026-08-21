import * as THREE from 'three';
import { clamp, clamp01, damp, smoothstep, lerp } from './math.js';

// ============================================================
//  ZMF §7 : Camera Dynamics
//    target-leading gaze, G-force tilt, collision-avoidance priority
//    panning, view-residual inertia (camera ghosting).
// ============================================================

const _desired = new THREE.Vector3();
const _gaze = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _up = new THREE.Vector3();
const _boom = new THREE.Vector3();
const _boomUp = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Steepest the camera boom may tilt, as a sine of the angle from horizontal. */
const BOOM_TILT_CAP = 0.35;

export class CameraDynamics {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3(0, 4, -10);
    this.gaze = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);

    this.baseFov = 62;
    this.fov = this.baseFov;
    this.roll = 0;
    this.shake = new THREE.Vector3();
    this.shakeAmount = 0;

    /** Exported to the HUD / post pass. */
    this.vfx = { chroma: 0, speedLines: 0, fovPump: 0 };

    this.config = {
      distance: 7.4,
      height: 2.35,
      shoulder: 0.0,
      /** Camera ghosting half-lives. Position lags more than the gaze. */
      posHalfLife: 0.085,
      gazeHalfLife: 0.055,
      leadDistance: 5.5,
      /** Collision-avoidance gaze split, per §7.2. */
      avoidBias: 0.7,
    };
    this._framed = false;
  }

  /** Rescale the boom for the size of the machine. */
  fitTo(stats) {
    const s = clamp(stats.extent / 2.8, 0.7, 1.8);
    this.config.distance = 4.6 * s + 3.4;
    this.config.height = 1.25 * s + 1.0;
    this.baseFov = 60 + stats.agility * 8;
  }

  snap(position, forward) {
    _tmp.copy(forward).multiplyScalar(-this.config.distance);
    this.position.copy(position).add(_tmp);
    this.position.y += this.config.height;
    this.gaze.copy(position);
    this._framed = true;
  }

  /**
   * @param {object} p
   * @param {THREE.Vector3} p.position     machine position
   * @param {THREE.Vector3} p.forward
   * @param {THREE.Vector3} p.up
   * @param {THREE.Vector3} p.velocity
   * @param {THREE.Vector3} p.accel
   * @param {THREE.Vector3|null} p.aimPoint
   * @param {number} p.jerk
   * @param {number} p.bank
   * @param {{normal:THREE.Vector3}|null} p.avoid   imminent-collision contact
   * @param {number} p.thrust  0..1
   */
  update(p, dt) {
    if (!this._framed) this.snap(p.position, p.forward);

    const speed = p.velocity.length();
    const speedN = clamp01(speed / 34);

    // ---------------------------------------------------- gaze
    // Look at the machine, biased toward wherever it is about to be.
    _gaze.copy(p.position).addScaledVector(p.forward, this.config.leadDistance * (0.35 + speedN * 0.9));

    if (p.aimPoint && p.assistAuthority > 0.02) {
      // Frame both the machine and the target: the gaze slides toward the
      // midpoint, weighted by how much the assist is actually engaged.
      _tmp.copy(p.aimPoint).add(p.position).multiplyScalar(0.5);
      _gaze.lerp(_tmp, clamp01(p.assistAuthority * 0.65));
    }

    // §7.2 collision-avoidance priority panning, 7:3 in favour of the escape.
    if (p.avoid) {
      _tmp.copy(p.position).addScaledVector(p.avoid.normal, 9);
      _gaze.lerp(_tmp, this.config.avoidBias * clamp01(p.avoidUrgency ?? 0.6));
    }

    this.gaze.x = damp(this.gaze.x, _gaze.x, this.config.gazeHalfLife, dt);
    this.gaze.y = damp(this.gaze.y, _gaze.y, this.config.gazeHalfLife, dt);
    this.gaze.z = damp(this.gaze.z, _gaze.z, this.config.gazeHalfLife, dt);

    // ---------------------------------------------------- boom position
    // The boom only partly follows pitch. A chase cam welded to the nose ends
    // up directly overhead the moment the machine dives, which is exactly the
    // spatial disorientation the whole model exists to avoid.
    _boom.copy(p.forward);
    _boom.y *= 0.42;
    if (Math.hypot(_boom.x, _boom.z) < 1e-4) _boom.set(0, _boom.y, 1);
    _boom.normalize();

    // Hard cap on how steep the boom may get. Scaling pitch alone is not
    // enough: at a near-vertical dive even 42% of it still swings the camera
    // overhead, and a top-down view is exactly what we are avoiding.
    if (Math.abs(_boom.y) > BOOM_TILT_CAP) {
      const sign = Math.sign(_boom.y);
      const h = Math.hypot(_boom.x, _boom.z) || 1;
      const want = Math.sqrt(1 - BOOM_TILT_CAP * BOOM_TILT_CAP) / h;
      _boom.x *= want;
      _boom.z *= want;
      _boom.y = sign * BOOM_TILT_CAP;
    }

    // Likewise the boom rises along an axis that is mostly world-up, so the
    // horizon stays roughly where the player left it.
    _boomUp.copy(WORLD_UP).lerp(p.up, 0.35).normalize();

    const dist = this.config.distance * (1 + speedN * 0.30);
    _desired.copy(p.position)
      .addScaledVector(_boom, -dist)
      .addScaledVector(_boomUp, this.config.height)
      .addScaledVector(p.right ?? WORLD_UP, this.config.shoulder);

    // Pull the boom back along the velocity vector a touch — the machine
    // drifts forward in frame under acceleration, which is where the
    // sensation of being pushed comes from.
    _desired.addScaledVector(p.velocity, -0.055);

    // Never let the camera clip through the floor.
    const floor = (p.groundY ?? 0) + 0.9;
    if (_desired.y < floor) _desired.y = floor;

    // §7 camera ghosting: the boom is a lagged follower, not a rigid arm.
    const hl = this.config.posHalfLife * (1 + speedN * 0.5);
    this.position.x = damp(this.position.x, _desired.x, hl, dt);
    this.position.y = damp(this.position.y, _desired.y, hl * 1.25, dt);
    this.position.z = damp(this.position.z, _desired.z, hl, dt);

    // ---------------------------------------------------- G-force tilt + roll
    _tmp.copy(p.accel);
    const lateralG = _tmp.dot(p.right ?? WORLD_UP);
    const rollTarget = p.bank * 0.55 + clamp(-lateralG * 0.010, -0.22, 0.22);
    this.roll = damp(this.roll, rollTarget, 0.13, dt);

    _up.copy(p.up).lerp(WORLD_UP, 0.55).normalize();
    _tmp2.copy(this.gaze).sub(this.position).normalize();
    _up.applyAxisAngle(_tmp2, this.roll).normalize();
    this.up.lerp(_up, clamp01(dt * 12)).normalize();

    // ---------------------------------------------------- FOV pumping
    const pump = clamp01(p.jerk / 260);
    const fovTarget = this.baseFov + speedN * 9 + p.thrust * 4.5 + pump * 5.5;
    this.fov = damp(this.fov, fovTarget, 0.14, dt);

    // ---------------------------------------------------- shake
    this.shakeAmount = damp(this.shakeAmount, clamp01(p.jerk / 320) * 0.55 + (p.impact ?? 0), 0.09, dt);
    const a = this.shakeAmount * 0.34;
    if (a > 0.0005) {
      const t = performance.now() * 0.001;
      this.shake.set(
        Math.sin(t * 63.1) * a, Math.sin(t * 71.7 + 1.7) * a, Math.sin(t * 55.3 + 3.1) * a,
      );
    } else this.shake.set(0, 0, 0);

    // ---------------------------------------------------- exported VFX
    this.vfx.chroma = damp(this.vfx.chroma, clamp01(p.thrust * 0.7 + speedN * 0.5) ** 2, 0.12, dt);
    this.vfx.speedLines = damp(this.vfx.speedLines, clamp01(pump * 1.3 + smoothstep(0.55, 1, speedN) * 0.7), 0.10, dt);
    this.vfx.fovPump = pump;

    // ---------------------------------------------------- commit
    const cam = this.camera;
    cam.position.copy(this.position).add(this.shake);
    cam.up.copy(this.up);
    cam.lookAt(this.gaze);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    return cam;
  }
}
