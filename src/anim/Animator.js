import * as THREE from 'three';
import { clamp, clamp01, damp, lerp, smoothstep } from '../zmf/math.js';

// ============================================================
//  Procedural animation driven by bone ATTRIBUTE.
//
//    LEG    1 bone  -> hop        2 bones -> walk      3+ -> skitter
//    ARM    swings while travelling, points at the lock while armed
//    FACE   looks down the travel vector, snaps to the lock
//    CUSTOM whatever the builder wired up in the editor
//
//  Every joint is posed in its own parent frame, but the *axes* are
//  resolved from the body frame at bind time. That is what lets a bone
//  mounted at any angle still swing fore-and-aft like a limb should.
// ============================================================

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _axis = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Limit a rotation to `maxDeg` away from rest. */
function limitQuat(q, maxDeg) {
  const max = maxDeg * DEG;
  const angle = 2 * Math.acos(clamp(Math.abs(q.w), -1, 1));
  if (angle <= max) return q;
  return q.slerp(_q2.identity(), 1 - max / angle);
}

export class Animator {
  constructor(rig, stats) {
    this.rig = rig;
    this.stats = stats;
    this.time = 0;
    this.gaitPhase = 0;
    this.gaitFreq = 0;
    this.hopCharge = 0;
    this.bodyBob = 0;
    this.bodyLean = new THREE.Vector2(); // x = pitch, y = roll
    this.aimBlend = 0;
    this._bind();
  }

  /**
   * Resolve, once, the body-frame axes each joint should rotate about.
   * Doing this at bind time means the per-frame path stays trigonometry only.
   */
  _bind() {
    const rig = this.rig;
    rig.root.updateMatrixWorld(true);
    const rootQ = rig.root.getWorldQuaternion(new THREE.Quaternion()).invert();

    for (const node of rig.joints) {
      // The joint rotates inside the bone-root frame.
      const parentQ = node.group.getWorldQuaternion(new THREE.Quaternion());
      const toBone = parentQ.clone().invert();

      node.axisSwing = new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ).applyQuaternion(toBone).normalize(); // body right
      node.axisSpread = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ).applyQuaternion(toBone).normalize(); // body forward
      node.axisTwist = new THREE.Vector3(0, 1, 0).applyQuaternion(rootQ).applyQuaternion(toBone).normalize();  // body up

      // A bone mounted straight out to the side would have its swing axis
      // running down the shaft, which is a twist, not a swing. Fall back to
      // the perpendicular axis so sideways limbs still articulate.
      if (Math.abs(node.axisSwing.y) > 0.9) {
        const tmp = node.axisSwing.clone();
        node.axisSwing.copy(node.axisSpread);
        node.axisSpread.copy(tmp);
      }
      node.boneWorldQ = parentQ;      // rest orientation of the bone root, body space
      node.target = new THREE.Quaternion();

      // Which side of the body is this bone on? Drives mirrored gaits.
      const p = node.group.getWorldPosition(new THREE.Vector3());
      node.side = Math.sign(p.x) || 1;
      node.restPos = p;
    }

    // Order each limb chain: [hip, knee, ankle, ...]
    for (const limb of this.rig.limbs) {
      limb.chain.forEach((n, i) => { n.chainIndex = i; n.chainLength = limb.chain.length; });
      // Alternate the phase so a biped does not pogo on both legs at once.
      limb.phaseOffset = this.rig.limbs.length <= 1
        ? 0
        : (limb.index / this.rig.limbs.length) + (this.rig.limbs.length === 2 ? 0 : 0);
      if (this.rig.limbs.length === 2) limb.phaseOffset = limb.index * 0.5;
    }
  }

  /**
   * @param {object} s  motion signals
   * @param {number} s.dt
   * @param {number} s.speed           world speed
   * @param {number} s.planarSpeed     horizontal speed
   * @param {number} s.grounded        0..1
   * @param {number} s.airborne        seconds off the ground
   * @param {THREE.Vector3} s.velocity world
   * @param {THREE.Quaternion} s.bodyQ world orientation of the rig root
   * @param {THREE.Vector3|null} s.aimDir  world direction to the lock target
   * @param {number} s.locked          0..1
   * @param {number} s.thrust          0..1
   * @param {number} s.jerk
   */
  update(s) {
    const dt = s.dt;
    this.time += dt;

    const gait = this.stats.gait;
    this.aimBlend = damp(this.aimBlend, s.locked ?? 0, 0.11, dt);

    // ---- gait clock: stride rate follows real ground speed
    const legs = Math.max(1, this.rig.limbs.length);
    const strideLen = lerp(2.4, 1.1, clamp01((legs - 1) / 4)) * (0.7 + this.stats.extent * 0.35);
    const targetFreq = gait === 'skitter'
      ? clamp(s.planarSpeed / strideLen, 0, 6.5) * 1.9 + (s.grounded > 0.4 ? 0.9 : 0)
      : clamp(s.planarSpeed / strideLen, 0, 4.2);
    this.gaitFreq = damp(this.gaitFreq, targetFreq * s.grounded, 0.12, dt);
    this.gaitPhase = (this.gaitPhase + this.gaitFreq * dt) % 1;

    // ---- body carriage
    const bobAmp = gait === 'hop' ? 0.0 : 0.045 * (1 + this.gaitFreq * 0.28);
    const bobTarget = Math.sin(this.gaitPhase * TAU * (legs === 2 ? 2 : legs)) * bobAmp * s.grounded;
    this.bodyBob = damp(this.bodyBob, bobTarget, 0.05, dt);

    const localVel = _v.copy(s.velocity).applyQuaternion(_q.copy(s.bodyQ).invert());
    this.bodyLean.x = damp(this.bodyLean.x, clamp(localVel.z * 0.012, -0.20, 0.20), 0.15, dt);
    this.bodyLean.y = damp(this.bodyLean.y, clamp(-localVel.x * 0.010, -0.16, 0.16), 0.15, dt);

    // ---- limbs
    switch (gait) {
      case 'hop': this._hop(s, dt); break;
      case 'walk': this._walk(s, dt); break;
      case 'skitter': this._skitter(s, dt); break;
      default: this._hover(s, dt); break;
    }

    this._arms(s, dt);
    this._faces(s, dt);
    this._customs(s, dt);
    this._commit(dt);
  }

  // ---------------------------------------------------------- gaits

  /** One leg: charge on contact, fire on release, tuck in the air. */
  _hop(s, dt) {
    const limb = this.rig.limbs[0];
    if (!limb) return;

    const airborne = 1 - s.grounded;
    // Compress while planted, extend hard the instant we leave the floor.
    const compressTarget = s.grounded > 0.5 ? 0.85 : -0.25 * smoothstep(0.35, 0, s.airborne);
    this.hopCharge = damp(this.hopCharge, compressTarget, s.grounded > 0.5 ? 0.07 : 0.11, dt);

    const sway = Math.sin(this.time * 3.1) * 0.06 * airborne;
    const dir = clamp(_v.copy(s.velocity).setY(0).length() * 0.03, 0, 0.35);

    limb.chain.forEach((node, i) => {
      const t = i / Math.max(1, limb.chain.length - 1 || 1);
      const bend = this.hopCharge * (48 - i * 12) * DEG * (i % 2 === 0 ? 1 : -1.25);
      _q.setFromAxisAngle(node.axisSwing, bend + (dir + sway) * (1 - t));
      node.target.copy(limitQuat(_q, node.part.limit));
    });
  }

  /** Two legs: opposed sine stride with a knee that only bends one way. */
  _walk(s, dt) {
    const amp = lerp(10, 40, clamp01(this.gaitFreq / 2.6)) * DEG;
    const kneeAmp = lerp(8, 55, clamp01(this.gaitFreq / 2.6)) * DEG;
    const idle = 1 - clamp01(this.gaitFreq * 2.2);
    const air = 1 - s.grounded;

    for (const limb of this.rig.limbs) {
      const p = (this.gaitPhase + limb.phaseOffset) % 1;
      const stride = Math.sin(p * TAU);
      const lift = Math.max(0, Math.sin(p * TAU));
      const mirror = limb.root.part.invert ? -1 : 1;

      limb.chain.forEach((node, i) => {
        let angle;
        if (i === 0) {
          // hip: fore-aft stride, plus a landing-gear tuck while airborne
          angle = stride * amp * mirror - air * 22 * DEG + idle * 2 * DEG;
        } else if (i === 1) {
          // knee: bends on the swing half only
          angle = -(lift * kneeAmp + air * 34 * DEG) * mirror;
        } else {
          // ankle and below: counter-rotate so the foot stays flattish
          angle = (-stride * amp * 0.35 + lift * kneeAmp * 0.4) * mirror;
        }
        _q.setFromAxisAngle(node.axisSwing, angle);
        node.target.copy(limitQuat(_q, node.part.limit));
      });
    }
  }

  /** Three or more: fast, shallow, phase-fanned. Should read as scuttling. */
  _skitter(s, dt) {
    const n = this.rig.limbs.length;
    const amp = lerp(7, 26, clamp01(this.gaitFreq / 4.5)) * DEG;
    const air = 1 - s.grounded;

    for (const limb of this.rig.limbs) {
      // Fan the phases around the body — alternating tripod when it works out.
      const p = (this.gaitPhase + limb.index / n + (limb.index % 2) * 0.5) % 1;
      const stride = Math.sin(p * TAU);
      const lift = Math.max(0, Math.sin(p * TAU + 0.6));
      const mirror = limb.root.part.invert ? -1 : 1;
      // Splay follows which side of the body the leg is actually on, so a
      // crawler pushes outward rather than folding all four legs one way.
      const splay = 24 * DEG * -limb.root.side;

      limb.chain.forEach((node, i) => {
        _q.setFromAxisAngle(node.axisSwing, (stride * amp - air * 12 * DEG) * mirror);
        if (i === 0) {
          _q2.setFromAxisAngle(node.axisSpread, splay * (1 + lift * 0.35));
          _q.multiply(_q2);
        } else {
          _q2.setFromAxisAngle(node.axisSwing, -lift * amp * 1.4 * mirror);
          _q.multiply(_q2);
        }
        node.target.copy(limitQuat(_q, node.part.limit));
      });
    }
  }

  /** No legs at all: everything just trails the acceleration.  */
  _hover(s, dt) {
    for (const node of this.rig.joints) {
      if (node.part.boneType !== 'leg') continue;
      _q.setFromAxisAngle(node.axisSwing, Math.sin(this.time * 1.6 + node.restPos.x) * 5 * DEG);
      node.target.copy(limitQuat(_q, node.part.limit));
    }
  }

  // ---------------------------------------------------------- arms / face

  /**
   * Arms swing counter-phase to the legs while travelling; the moment a
   * lock exists they abandon the gait and point down the firing line.
   */
  _arms(s, dt) {
    const swingAmp = lerp(4, 26, clamp01(this.gaitFreq / 2.6)) * DEG;

    for (const node of this.rig.armBones) {
      const phaseSide = node.side >= 0 ? 0 : 0.5;
      const p = (this.gaitPhase + phaseSide) % 1;
      const swing = -Math.sin(p * TAU) * swingAmp;
      const idleFloat = Math.sin(this.time * 1.3 + node.restPos.x * 2) * 3 * DEG;

      _q.setFromAxisAngle(node.axisSwing, swing + idleFloat + s.thrust * 12 * DEG);

      if (s.aimDir && this.aimBlend > 0.001) {
        this._aimQuat(node, s.aimDir, s.bodyQ, _q2);
        _q.slerp(_q2, this.aimBlend);
      }
      node.target.copy(limitQuat(_q, Math.max(node.part.limit, 95)));
    }
  }

  /** The face tracks the travel vector, and hard-locks to the target. */
  _faces(s, dt) {
    const travel = _v.copy(s.velocity);
    travel.y *= 0.45;
    const hasTravel = travel.lengthSq() > 1.2;

    for (const node of this.rig.faceBones) {
      _q.identity();
      if (hasTravel) {
        this._aimQuat(node, travel.clone().normalize(), s.bodyQ, _q);
        _q.slerp(_q2.identity(), 0.45); // only lean into it, never full stare
      }
      if (s.aimDir && this.aimBlend > 0.001) {
        this._aimQuat(node, s.aimDir, s.bodyQ, _q2);
        _q.slerp(_q2, this.aimBlend);
      }
      node.target.copy(limitQuat(_q, Math.max(node.part.limit, 80)));
    }
  }

  _customs(s, dt) {
    for (const node of this.rig.customBones) {
      const c = node.part.custom ?? {};
      const axis = c.axis === 'y' ? node.axisTwist : c.axis === 'z' ? node.axisSpread : node.axisSwing;
      let drive = 1;
      switch (c.source) {
        case 'speed': drive = clamp01(s.planarSpeed / 18); break;
        case 'thrust': drive = s.thrust; break;
        case 'jerk': drive = clamp01(s.jerk / 240); break;
        case 'aim': drive = this.aimBlend; break;
        default: drive = 1;
      }
      const angle = Math.sin((this.time * (c.freq ?? 1) + (c.phase ?? 0)) * TAU) * (c.amp ?? 20) * DEG * drive;
      _q.setFromAxisAngle(axis, angle);
      node.target.copy(limitQuat(_q, node.part.limit));
    }
  }

  /**
   * Rotation that swings this bone's far shaft (+Y in bone space) onto a
   * world direction, expressed in the joint's own parent frame.
   */
  _aimQuat(node, worldDir, bodyQ, out) {
    _axis.copy(worldDir)
      .applyQuaternion(_q2.copy(bodyQ).invert())   // -> body space
      .applyQuaternion(_q2.copy(node.boneWorldQ).invert()) // -> bone-root space
      .normalize();
    if (_axis.lengthSq() < 1e-6) return out.identity();
    return out.setFromUnitVectors(UP, _axis);
  }

  // ---------------------------------------------------------- commit

  /** Slew every joint toward its target so nothing ever pops. */
  _commit(dt) {
    for (const node of this.rig.joints) {
      const k = clamp01(1 - Math.pow(0.0008, dt * (node.part.boneType === 'leg' ? 1.4 : 1.0)));
      node.joint.quaternion.slerp(node.target, k);
    }
  }

  /** Visual-only body offset: bob and lean, applied by the caller. */
  applyBodyCarriage(object) {
    object.position.y += this.bodyBob;
    _q.setFromEuler(new THREE.Euler(this.bodyLean.x, 0, this.bodyLean.y, 'XZY'));
    object.quaternion.multiply(_q);
  }
}
