import * as THREE from 'three';
import { clamp, clamp01, damp, lerp, smoothstep } from '../zmf/math.js';

// ============================================================
//  Procedural animation driven by bone ATTRIBUTE.
//
//    LEG    1 leg -> hop      2 legs -> walk      3+ -> multileg
//    ARM    swings while travelling, points at the lock while armed
//    FACE   looks down the travel vector, snaps to the lock
//    CUSTOM whatever the builder wired up in the editor
//
//  Every joint is posed in its own parent frame, but its axes are solved
//  from the BODY frame at bind time. A leg hanging straight down and a leg
//  sticking out sideways need completely different local rotation axes to
//  produce the same "step forward", and this is where that is worked out.
// ============================================================

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _axis2 = new THREE.Vector3();
const _t2 = new THREE.Vector2();
const UP = new THREE.Vector3(0, 1, 0);
const BODY_X = new THREE.Vector3(1, 0, 0);
const BODY_Y = new THREE.Vector3(0, 1, 0);
const BODY_Z = new THREE.Vector3(0, 0, 1);

/** Limit a rotation to `maxDeg` away from rest. */
function limitQuat(q, maxDeg) {
  const max = maxDeg * DEG;
  const angle = 2 * Math.acos(clamp(Math.abs(q.w), -1, 1));
  if (angle <= max) return q;
  return q.slerp(_q2.identity(), 1 - max / angle);
}

/** -1..1 for one cycle of `t` turns. */
export function waveAt(wave, t) {
  const u = ((t % 1) + 1) % 1;
  switch (wave) {
    case 'tri': return 1 - 4 * Math.abs(u - 0.5);
    case 'square': return u < 0.5 ? 1 : -1;
    case 'saw': return u * 2 - 1;
    default: return Math.sin(u * TAU);
  }
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
    /**
     * Direction of travel in the body's own horizontal plane, as (x, z).
     * Legs step along THIS, not along the nose — strafing should put the feet
     * out sideways, the way inertia actually carries you.
     */
    this.travel = new THREE.Vector2(0, 1);
    this.travelBlend = 0;
    this._bind();
  }

  /**
   * Resolve, once, the body-frame axes each joint should rotate about.
   *
   * Rotating a bone about axis A moves its tip along (A x S), where S is the
   * shaft direction. So to step the foot forward we want A x S along body Z,
   * which gives A = Z x S; to lift the foot we want A x S along body Y.
   */
  _bind() {
    const rig = this.rig;
    rig.root.updateMatrixWorld(true);
    const rootQInv = rig.root.getWorldQuaternion(new THREE.Quaternion()).invert();

    for (const node of rig.joints) {
      // Orientation of the bone root, expressed in the body frame.
      const boneQ = node.group.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootQInv);
      const toBone = boneQ.clone().invert();
      node.boneWorldQ = boneQ;

      // Shaft direction in body space.
      const shaft = new THREE.Vector3(0, 1, 0).applyQuaternion(boneQ).normalize();
      node.shaft = shaft;

      const stride = new THREE.Vector3().crossVectors(BODY_Z, shaft);
      if (stride.lengthSq() < 1e-6) stride.copy(BODY_X);
      stride.normalize();

      // A leg hanging straight down genuinely CANNOT raise its own tip by
      // rotating the hip — that is what the knee is for. Flag it rather than
      // substituting an axis that would just double the stride.
      const lift = new THREE.Vector3().crossVectors(BODY_Y, shaft);
      const liftDegenerate = lift.lengthSq() < 1e-4;
      if (liftDegenerate) lift.copy(stride);
      lift.normalize();

      const splay = new THREE.Vector3().crossVectors(BODY_X, shaft);
      if (splay.lengthSq() < 1e-6) splay.copy(lift);
      splay.normalize();

      /** Fore/aft step. */
      node.axisStride = stride.clone().applyQuaternion(toBone).normalize();
      /** Raise/lower the tip. */
      node.axisLift = lift.clone().applyQuaternion(toBone).normalize();
      /** Sideways fan. */
      node.axisSplay = splay.clone().applyQuaternion(toBone).normalize();
      /** Twist along the shaft. */
      node.axisTwist = new THREE.Vector3(0, 1, 0);
      /** 0 when rotating this joint cannot raise its own tip. */
      node.liftScale = liftDegenerate ? 0 : 1;

      node.target = new THREE.Quaternion();

      // Which side of the body is this bone on? Drives mirrored gaits.
      const p = node.group.getWorldPosition(new THREE.Vector3());
      node.side = Math.sign(Number(p.x.toFixed(4))) || 1;
      node.restPos = p;
    }

    // Order each limb chain: [hip, knee, ankle, ...]
    for (const limb of this.rig.limbs) {
      limb.chain.forEach((n, i) => { n.chainIndex = i; n.chainLength = limb.chain.length; });
    }
    this._assignPhases();
  }

  /**
   * Gait phase per limb. Two legs alternate; more than two fan out into an
   * alternating-tripod-ish pattern so neighbours are never in step.
   */
  _assignPhases() {
    const limbs = this.rig.limbs;
    const n = limbs.length;
    limbs.forEach((limb, i) => {
      if (n <= 1) limb.phaseOffset = 0;
      else if (n === 2) limb.phaseOffset = i * 0.5;
      else {
        // left/right alternation on top of a front-to-back sweep
        const row = Math.floor(i / 2);
        const side = i % 2;
        limb.phaseOffset = ((row / Math.max(1, Math.ceil(n / 2))) * 0.5 + side * 0.5) % 1;
      }
    });
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
    const strideLen = lerp(2.4, 1.0, clamp01((legs - 1) / 4)) * (0.7 + this.stats.extent * 0.35);
    const moving = clamp01(s.planarSpeed / 0.8);
    const targetFreq = gait === 'multileg'
      // Multi-leg machines scuttle: a high floor frequency even at a crawl,
      // otherwise four small legs just look like they are vibrating.
      ? (1.6 + clamp(s.planarSpeed / strideLen, 0, 6) * 1.6) * moving
      : clamp(s.planarSpeed / strideLen, 0, 4.2);
    this.gaitFreq = damp(this.gaitFreq, targetFreq * s.grounded, 0.12, dt);
    this.gaitPhase = (this.gaitPhase + this.gaitFreq * dt) % 1;

    // ---- body carriage
    // Bob twice per gait cycle regardless of leg count: one bob per leg makes
    // a four-legger oscillate faster than the smoothing can follow, which
    // cancels the very motion it is supposed to sell.
    const bobAmp = gait === 'hop' ? 0 : gait === 'multileg' ? 0.075 : 0.045;
    const bobHz = gait === 'hover' ? Math.max(1, legs) : 2;
    const bobTarget = Math.sin(this.gaitPhase * TAU * bobHz)
      * bobAmp * (1 + this.gaitFreq * 0.2) * s.grounded;
    // Track faster when the gait is faster, or the smoothing eats the peaks.
    const bobHalfLife = clamp(0.22 / Math.max(1, this.gaitFreq * bobHz), 0.02, 0.06);
    this.bodyBob = damp(this.bodyBob, bobTarget, bobHalfLife, dt);

    const localVel = _v.copy(s.velocity).applyQuaternion(_q.copy(s.bodyQ).invert());
    this.bodyLean.x = damp(this.bodyLean.x, clamp(localVel.z * 0.012, -0.20, 0.20), 0.15, dt);
    this.bodyLean.y = damp(this.bodyLean.y, clamp(-localVel.x * 0.010, -0.16, 0.16), 0.15, dt);

    // ---- travel direction
    // Rotated toward the target rather than lerped: a straight reversal would
    // otherwise interpolate through the origin, collapse, and snap back to
    // forward — so walking backwards would never reverse the stride at all.
    const planar = Math.hypot(localVel.x, localVel.z);
    if (planar > 0.4) _t2.set(localVel.x / planar, localVel.z / planar);
    else _t2.set(0, 1);
    const cross = this.travel.x * _t2.y - this.travel.y * _t2.x;
    const dot = clamp(this.travel.x * _t2.x + this.travel.y * _t2.y, -1, 1);
    const theta = Math.atan2(cross, dot) * clamp01(dt * 8);
    if (theta) {
      const c = Math.cos(theta);
      const sn = Math.sin(theta);
      this.travel.set(this.travel.x * c - this.travel.y * sn, this.travel.x * sn + this.travel.y * c);
      this.travel.normalize();
    }
    this.travelBlend = damp(this.travelBlend, clamp01((planar - 0.4) / 2.5), 0.12, dt);

    // ---- limbs
    switch (gait) {
      case 'hop': this._hop(s, dt); break;
      case 'walk': this._walk(s, dt); break;
      case 'multileg': this._multileg(s, dt); break;
      default: this._hover(s, dt); break;
    }

    this._arms(s, dt);
    this._faces(s, dt);
    this._customs(s, dt);
    this._commit(dt);
  }

  /**
   * The axis to swing this joint about so its tip steps along the CURRENT
   * direction of travel.
   *
   * Rotating about A moves the tip along (A x S). We want that along the
   * travel direction D = cos.Z + sin.X, and the cross product is linear in D,
   * so the answer is just the same blend of the two bound axes.
   */
  _strideAxis(node, out = _axis2) {
    const k = this.travelBlend;
    const cos = 1 + (this.travel.y - 1) * k;
    const sin = this.travel.x * k;
    out.copy(node.axisStride).multiplyScalar(cos).addScaledVector(node.axisSplay, sin);
    if (out.lengthSq() < 1e-8) return out.copy(node.axisStride);
    return out.normalize();
  }

  // ---------------------------------------------------------- gaits

  /** One leg: charge on contact, fire on release, tuck in the air. */
  _hop(s, dt) {
    const limb = this.rig.limbs[0];
    if (!limb) return;

    const airborne = 1 - s.grounded;
    const compressTarget = s.grounded > 0.5 ? 0.85 : -0.25 * smoothstep(0.35, 0, s.airborne);
    this.hopCharge = damp(this.hopCharge, compressTarget, s.grounded > 0.5 ? 0.07 : 0.11, dt);

    const sway = Math.sin(this.time * 3.1) * 0.06 * airborne;
    const dir = clamp(_v.copy(s.velocity).setY(0).length() * 0.03, 0, 0.35);

    limb.chain.forEach((node, i) => {
      const t = i / Math.max(1, limb.chain.length - 1 || 1);
      const bend = this.hopCharge * (48 - i * 12) * DEG * (i % 2 === 0 ? 1 : -1.25);
      _q.setFromAxisAngle(this._strideAxis(node), bend + (dir + sway) * (1 - t));
      node.target.copy(limitQuat(_q, node.part.limit));
    });
  }

  /** Two legs: opposed sine stride with a knee that only bends one way. */
  _walk(s, dt) {
    const drive = clamp01(this.gaitFreq / 2.6);
    const amp = lerp(10, 40, drive) * DEG;
    const kneeAmp = lerp(8, 55, drive) * DEG;
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
          angle = stride * amp * mirror - air * 22 * DEG + idle * 2 * DEG;
        } else if (i === 1) {
          angle = -(lift * kneeAmp + air * 34 * DEG) * mirror;
        } else {
          angle = (-stride * amp * 0.35 + lift * kneeAmp * 0.4) * mirror;
        }
        _q.setFromAxisAngle(this._strideAxis(node), angle);
        node.target.copy(limitQuat(_q, node.part.limit));
      });
    }
  }

  /**
   * Three or more legs. The previous version was far too subtle to read, so
   * this drives three separate channels per leg — a wide fore/aft stride, a
   * clear vertical lift during the swing half, and a static outward splay so
   * the legs are visible outside the body silhouette in the first place.
   */
  _multileg(s, dt) {
    const drive = clamp01(this.gaitFreq / 4.0);
    const strideAmp = lerp(16, 38, drive) * DEG;
    const liftAmp = lerp(10, 26, drive) * DEG;
    const kneeAmp = lerp(12, 34, drive) * DEG;
    const air = 1 - s.grounded;
    const idle = 1 - clamp01(this.gaitFreq * 1.6);

    for (const limb of this.rig.limbs) {
      const p = (this.gaitPhase + limb.phaseOffset) % 1;
      const stride = Math.sin(p * TAU);
      // Swing occupies the first half of the cycle; stance drags along the floor.
      const swing = Math.max(0, Math.sin(p * TAU));
      const mirror = limb.root.part.invert ? -1 : 1;
      const splay = 22 * DEG * -limb.root.side;

      limb.chain.forEach((node, i) => {
        if (i === 0) {
          // hip: step along the travel vector, lift clear of the floor on the swing
          _q.setFromAxisAngle(this._strideAxis(node), stride * strideAmp * mirror);
          _q2.setFromAxisAngle(
            node.axisLift,
            (swing * liftAmp + air * 14 * DEG) * -limb.root.side * node.liftScale,
          );
          _q.multiply(_q2);
          _q2.setFromAxisAngle(node.axisSplay, splay * (1 + idle * 0.3));
          _q.multiply(_q2);
        } else {
          // knee: tuck during the swing, extend to plant
          // With a vertical hip the knee is the only thing that can pick the
          // foot up, so it carries the whole lift.
          const bend = (0.35 + swing * 0.65) * kneeAmp + air * 18 * DEG;
          _q.setFromAxisAngle(this._strideAxis(node), -bend * mirror);
          _q2.setFromAxisAngle(
            node.axisLift,
            -swing * liftAmp * 0.5 * -limb.root.side * node.liftScale,
          );
          _q.multiply(_q2);
        }
        node.target.copy(limitQuat(_q, node.part.limit));
      });
    }
  }

  /** No legs at all: everything just trails the acceleration. */
  _hover(s, dt) {
    for (const node of this.rig.joints) {
      if (node.part.boneType !== 'leg') continue;
      _q.setFromAxisAngle(node.axisStride, Math.sin(this.time * 1.6 + node.restPos.x) * 5 * DEG);
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

      _q.setFromAxisAngle(this._strideAxis(node), swing + idleFloat + s.thrust * 12 * DEG);

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
      const axis = c.axis === 'y' ? node.axisTwist : c.axis === 'z' ? node.axisLift : node.axisStride;
      const drive = this._customDrive(c, s);

      if ((c.wave ?? 'sine') === 'saw') {
        // A continuous turn: the drive scales the SPEED, not the angle, so
        // easing off does not snap the joint back to where it started.
        node.spinPhase = (node.spinPhase ?? c.phase ?? 0) + (c.freq ?? 1) * drive * dt;
        _q.setFromAxisAngle(axis, node.spinPhase * TAU + (c.offset ?? 0) * DEG);
        node.target.copy(_q);          // no joint limit: it is a rotation
        continue;
      }

      const t = this.time * (c.freq ?? 1) + (c.phase ?? 0);
      const angle = ((c.offset ?? 0) + waveAt(c.wave, t) * (c.amp ?? 20) * drive) * DEG;
      _q.setFromAxisAngle(axis, angle);
      node.target.copy(limitQuat(_q, node.part.limit));
    }
  }

  _customDrive(c, s) {
    switch (c.source) {
      case 'speed': return clamp01((s.planarSpeed ?? 0) / 18);
      case 'thrust': return s.thrust ?? 0;
      case 'jerk': return clamp01((s.jerk ?? 0) / 240);
      case 'aim': return this.aimBlend;
      default: return 1;
    }
  }

  /**
   * Run ONLY the custom bones, for the editor: tuning a motion you cannot
   * see until you deploy is tuning blind, but faking a whole walk cycle
   * would move everything else too.
   */
  updateCustomsOnly(dt) {
    this.time += dt;
    this._customs({ planarSpeed: 0, thrust: 0, jerk: 0 }, dt);
    const k = clamp01(1 - Math.pow(0.0008, dt));
    for (const node of this.rig.customBones) node.joint.quaternion.slerp(node.target, k);
    return this;
  }

  /**
   * Rotation that swings this bone's far shaft (+Y in bone space) onto a
   * world direction, expressed in the joint's own parent frame.
   */
  _aimQuat(node, worldDir, bodyQ, out) {
    _axis.copy(worldDir)
      .applyQuaternion(_q2.copy(bodyQ).invert())            // -> body space
      .applyQuaternion(_q2.copy(node.boneWorldQ).invert())  // -> bone-root space
      .normalize();
    if (_axis.lengthSq() < 1e-6) return out.identity();
    return out.setFromUnitVectors(UP, _axis);
  }

  // ---------------------------------------------------------- commit

  /** Slew every joint toward its target so nothing ever pops. */
  _commit(dt) {
    for (const node of this.rig.joints) {
      const k = clamp01(1 - Math.pow(0.0008, dt * (node.part.boneType === 'leg' ? 1.6 : 1.0)));
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
