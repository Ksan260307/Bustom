import * as THREE from 'three';
import { clamp, clamp01, damp, lerp, smoothstep } from '../zmf/math.js';
import { SLIDE, CHAIN_FALLOFF_DEFAULT } from '../core/constants.js';

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
const _euler = new THREE.Euler();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _axis2 = new THREE.Vector3();
const _t2 = new THREE.Vector2();
const _push = new THREE.Vector3();
const _foot = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _armv = new THREE.Vector3();
const _paxis = new THREE.Vector3();
const _rate = new THREE.Vector3();
const _pq = new THREE.Quaternion();
const _rest = new THREE.Quaternion();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Standing on what is there rather than on what the middle of the machine
 * is over. `reach` is how far a foot will stretch for a surface below it —
 * beyond that it is a ledge, and a leg does not reach down a ledge.
 */
const PLANT = { reach: 1.1, ease: 0.09, maxAngle: 0.45 };
// Scratch for reading an angle's direction back off a quaternion.
const _lv = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const BODY_X = new THREE.Vector3(1, 0, 0);
const BODY_Y = new THREE.Vector3(0, 1, 0);
const BODY_Z = new THREE.Vector3(0, 0, 1);

/**
 * How far a full stagger throws the carriage: pitch, roll and a dip, in
 * radians and metres.
 *
 * A round lands on the BODY, not on the feet, so the machine rocks away
 * from where it was hit — shot in the chest, the top goes backwards. That
 * is the opposite of the lean a run produces, where the feet drive and the
 * top lags behind, and getting the sign wrong makes a machine bow politely
 * to whoever just shot it.
 */
const FLINCH = { pitch: 0.34, roll: 0.26, drop: 0.11, sprawl: 2.6 };

/**
 * How far a full landing folds the machine: knee bend in degrees, and how
 * far the body sinks onto it in metres.
 *
 * A machine that drops out of the sky and carries on running as if nothing
 * happened weighs nothing, whatever its stats say. This is where the weight
 * is actually seen.
 */
const BRACE = { bend: 40, drop: 0.34 };

/**
 * Hold a posed joint inside the travel its bone allows.
 *
 * `floorDeg` is a minimum the caller insists on — an aiming arm needs room
 * whatever the bone was set to. Which of the two limits applies is decided
 * by which way the joint has actually turned, so a knee can bend 130 forward
 * and 4 back; with `limitBack` unset both directions are the same number and
 * this behaves exactly as one cone always did.
 */
function limitQuat(q, part, floorDeg = 0, node = null) {
  // A shot-up joint does not open as far as an intact one.
  const wear = 1 - (node?.wear ?? 0) * 0.5;
  const fwd = Math.max(part.limit ?? 70, floorDeg) * wear;
  const back = ((part.limitBack ?? null) === null
    ? Math.max(part.limit ?? 70, floorDeg)
    : Math.max(part.limitBack, floorDeg)) * wear;

  // A hinge turns on one axis and no other. Everything the animator asked
  // for that was not about this axis is dropped here rather than being
  // limited, because a knee that wanders sideways by 5 degrees is not a knee
  // that has been limited — it is a knee that is broken.
  if (part.hinge && node) {
    const axis = Animator.spinAxisOf(node);
    if (axis) {
      const angle = 2 * Math.atan2(_lv.set(q.x, q.y, q.z).dot(axis), q.w);
      q.setFromAxisAngle(axis, angle);
    }
  }

  let maxDeg = fwd;
  if (back !== fwd && node) {
    // sin(t/2) about the axis, times cos(t/2): negative exactly when the
    // joint has swung the other way.
    const axis = Animator.spinAxisOf(node);
    maxDeg = axis && _lv.set(q.x, q.y, q.z).dot(axis) * q.w < 0 ? back : fwd;
  }

  const max = maxDeg * DEG;
  const angle = 2 * Math.acos(clamp(Math.abs(q.w), -1, 1));
  if (angle <= max || max <= 0) return angle <= max ? q : q.slerp(_q2.identity(), 1);
  // A rotation is allowed round; a hinge is not.
  if (part.limitMode === 'wrap') return q;
  // Sprung: the overshoot comes back off the stop instead of parking on it.
  const keep = part.limitMode === 'bounce'
    ? Math.max(0, max - Math.min(angle - max, max))
    : max;
  return q.slerp(_q2.identity(), 1 - keep / angle);
}

/**
 * A joint's travel, which is not the same in both directions.
 *
 * Every joint used to be one cone: as far forward as back. A knee bends one
 * way, and there was no way to say so — so every knee could hyperextend
 * exactly as far as it could bend, which is most of why a leg chain looked
 * like a rope rather than like a leg.
 *
 * The mode decides what happens at the end. `clamp` stops dead, which is a
 * hard stop; `bounce` reflects the overshoot back, which is a sprung one;
 * `wrap` lets it carry round, for anything that is really a rotation.
 *
 * @param {number} angle signed radians about the bone's axis
 * @param {object} part the bone, for its limits and mode
 */
export function limitAngle(angle, part, wear = 0) {
  const worn = 1 - clamp01(wear) * 0.5;
  const fwd = (part.limit ?? 70) * worn * DEG;
  const back = ((part.limitBack ?? null) === null
    ? (part.limit ?? 70) : part.limitBack) * worn * DEG;
  const hi = angle >= 0 ? fwd : back;
  if (hi <= 0) return 0;
  const over = Math.abs(angle) - hi;
  if (over <= 0) return angle;
  const sign = Math.sign(angle);
  switch (part.limitMode) {
    // Reflected, and only as far as the stop again: a joint that bounces
    // past its own end stop is a joint with no end stop.
    case 'bounce': return sign * (hi - Math.min(over, hi));
    case 'wrap': return angle;
    default: return sign * hi;
  }
}

/**
 * Value noise: smooth, repeatable, and nothing like Math.random().
 *
 * A joint that jitters has to jitter the SAME way every time the machine is
 * built, or a replay of a fight is a different fight. This is a hash of the
 * integer part blended across the fraction, which costs two multiplies and
 * is deterministic for ever.
 */
function noiseAt(t) {
  const i = Math.floor(t);
  const f = t - i;
  const hash = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  };
  const a = hash(i);
  const b = hash(i + 1);
  const k = f * f * (3 - 2 * f);          // smoothstep, so it has no corners
  return a + (b - a) * k;
}

/** -1..1 for one cycle of `t` turns. */
export function waveAt(wave, t) {
  const u = ((t % 1) + 1) % 1;
  switch (wave) {
    case 'tri': return 1 - 4 * Math.abs(u - 0.5);
    case 'square': return u < 0.5 ? 1 : -1;
    case 'saw': return u * 2 - 1;
    // Sharp out, slow back. A recoil, a heartbeat, a piston — none of which
    // a sine can do, because a sine spends as long arriving as leaving.
    case 'pulse': return 2 * Math.exp(-u * 5.5) - 1;
    case 'noise': return noiseAt(t * 3.1);
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
    /** 0..1, how much of the pose is a sideways skate rather than a walk. */
    this.slide = 0;
    /** Which way that skate is going, +1 or -1 in body space. */
    this.slideDir = 1;
    this.aimBlend = 0;
    /**
     * Things that HAPPEN, held for a moment so a bone can react to them.
     *
     * A drive source has to be a number a bone can read every frame, but
     * firing, landing, being hit and swapping weapons are all instants.
     * Each of these is set to 1 by the event and decays on its own, so a
     * bone driven by one fires and settles rather than being held open.
     */
    this.firePulse = 0;
    this.landPulse = 0;
    this.hurtPulse = 0;
    this.swapPulse = 0;
    /** Which weapon is live, so weapon bones know whether they are up. */
    this.activeWeapon = null;
    /**
     * Direction of travel in the body's own horizontal plane, as (x, z).
     * Legs step along THIS, not along the nose — strafing should put the feet
     * out sideways, the way inertia actually carries you.
     */
    this.travel = new THREE.Vector2(0, 1);
    this.travelBlend = 0;
    /** Body-local velocity, kept so the float poses can read it. */
    this.localVel = new THREE.Vector3();
    this._prevLocalVel = new THREE.Vector3();
    /**
     * Where a hanging leg wants to swing to, in the body's own (x, z).
     * A limb with no floor under it is a pendulum: it lags behind whatever
     * the machine is doing, trailing acceleration and dragging against
     * travel. Everything the FLOAT poses do is built on this one vector.
     */
    this.legSway = new THREE.Vector2();
    this._bind();
  }

  /**
   * Back to a machine that has just been built: standing still, mid-stride
   * of nothing, no swing left over.
   *
   * A machine that comes back from a wreck used to keep the pose and the
   * momentum of its previous life — it respawned already walking, and
   * because the limbs decide where its guns point, the first shots of the
   * new life came out of a barrel that was still finishing the old one.
   */
  reset() {
    this.time = 0;
    this.gaitPhase = 0;
    this.gaitFreq = 0;
    // A weapon bone starts wherever the weapon it is bound to says it
    // should be, rather than swinging into place on the spawn pad.
    for (const node of this.rig.weaponBones ?? []) {
      node.deployT = undefined;
      node.deployV = 0;
    }
    this.hopCharge = 0;
    this.bodyBob = 0;
    this.bodyLean.set(0, 0);
    this.slide = 0;
    this.slideDir = 1;
    this.aimBlend = 0;
    this.firePulse = 0;
    this.landPulse = 0;
    this.hurtPulse = 0;
    this.swapPulse = 0;
    this.activeWeapon = null;
    this.travel.set(0, 1);
    this.travelBlend = 0;
    this.localVel.set(0, 0, 0);
    this._prevLocalVel.set(0, 0, 0);
    this.legSway.set(0, 0);
    for (const node of this.rig.joints) {
      node.target.identity();
      node.spinPhase = undefined;
    }
    this.rig.resetPose();
    return this;
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
   * @param {number} [s.stagger]       0..1, how hard it was just hit
   * @param {THREE.Vector3} [s.staggerDir]  world direction it was thrown
   * @param {number} [s.landing]       0..1, how hard it just came down
   * @param {number} [s.downed]        0..1, thrown off its feet
   * @param {number} [s.dashSpeed]     the machine's own dash speed, m/s
   * @param {number} [s.walkCap]       ...and the fastest its legs can carry it
   */
  update(s) {
    const dt = s.dt;
    this.time += dt;

    const gait = this.stats.gait;
    /** A FLOAT plate keeps the feet off the floor, so nothing walks. */
    const floating = (this.stats.hoverHeight ?? 0) > 0 && this.rig.limbs.length > 0;
    this.aimBlend = damp(this.aimBlend, s.locked ?? 0, 0.11, dt);

    // ---- the things that happen
    //
    // Set by the event, decayed here. Landing arrives as a speed, so it is
    // scaled against what counts as a hard one rather than used raw.
    this._pulses(s, dt);

    // ---- gait clock: stride rate follows real ground speed
    const legs = Math.max(1, this.rig.limbs.length);
    const strideLen = lerp(2.4, 1.0, clamp01((legs - 1) / 4)) * (0.7 + this.stats.extent * 0.35);
    const moving = clamp01(s.planarSpeed / 0.8);
    const targetFreq = gait === 'multileg'
      // Multi-leg machines scuttle: a high floor frequency even at a crawl,
      // otherwise four small legs just look like they are vibrating.
      ? (1.6 + clamp(s.planarSpeed / strideLen, 0, 6) * 1.6) * moving
      : clamp(s.planarSpeed / strideLen, 0, 4.2);
    // Hovering machines have no stride: the clock stops, which also settles
    // the arms into their idle float and stills a stride-driven waist.
    this.gaitFreq = damp(this.gaitFreq, floating ? 0 : targetFreq * s.grounded, 0.12, dt);
    this.gaitPhase = (this.gaitPhase + this.gaitFreq * dt) % 1;

    // ---- body carriage
    // Bob twice per gait cycle regardless of leg count: one bob per leg makes
    // a four-legger oscillate faster than the smoothing can follow, which
    // cancels the very motion it is supposed to sell.
    const bobAmp = gait === 'hop' ? 0 : gait === 'multileg' ? 0.075 : 0.045;
    const bobHz = gait === 'hover' ? Math.max(1, legs) : 2;
    const bobTarget = floating ? 0
      : Math.sin(this.gaitPhase * TAU * bobHz)
        * bobAmp * (1 + this.gaitFreq * 0.2) * s.grounded;
    // Track faster when the gait is faster, or the smoothing eats the peaks.
    const bobHalfLife = clamp(0.22 / Math.max(1, this.gaitFreq * bobHz), 0.02, 0.06);

    // `_q` holds the inverse of the body's orientation from here on: the
    // flinch below reads its push direction out of the same one.
    const localVel = this.localVel.copy(s.velocity).applyQuaternion(_q.copy(s.bodyQ).invert());
    // Lean INTO the run. A machine that stays bolt upright while sprinting is
    // the other half of looking rigid: the legs move and the body does not.
    let pitch = clamp(localVel.z * 0.019, -0.28, 0.28);
    let roll = clamp(-localVel.x * 0.014, -0.20, 0.20);
    let drop = 0;
    // ---- flinch: rocked away from the blow, and snappier than a lean.
    // Folded into the same carriage rather than posed separately, so it
    // reads as the machine's own weight moving. The half-life drops with
    // it: a flinch that eases in over a fifth of a second is not a flinch,
    // it is a machine changing its mind.
    const shock = clamp01(s.stagger ?? 0);
    const load = clamp01(s.landing ?? 0);
    if (load > 1e-3) drop += BRACE.drop * load;
    // Skating sideways, the feet are held back and the top carries on: the
    // machine tips the way it is being taken, further than a strafe ever
    // does. Same sign as the strafe lean, just more of it.
    if (this.slide > 1e-3) roll -= SLIDE.lean * this.slide * this.slideDir;
    // Thrown off its feet, it goes right over.
    const sprawl = clamp01(s.downed ?? 0);
    let leanHalfLife = 0.15;
    if ((shock > 1e-3 || sprawl > 1e-3) && s.staggerDir) {
      _push.copy(s.staggerDir).applyQuaternion(_q);
      const flat = Math.hypot(_push.x, _push.z);
      // Rocked is a lean. THROWN is a machine going over: the same motion,
      // several times as far, and it does not come back until it lands.
      const rock = shock + sprawl * FLINCH.sprawl;
      if (flat > 1e-5) {
        pitch += FLINCH.pitch * rock * (_push.z / flat);
        roll -= FLINCH.roll * rock * (_push.x / flat);
      }
      drop = Math.max(drop, FLINCH.drop * shock);
      leanHalfLife = 0.045;
    }
    this.bodyBob = damp(this.bodyBob, bobTarget - drop, bobHalfLife, dt);
    this.bodyLean.x = damp(this.bodyLean.x, pitch, leanHalfLife, dt);
    this.bodyLean.y = damp(this.bodyLean.y, roll, leanHalfLife, dt);

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

    // ---- sliding
    // Going sideways faster than the machine could ever step. There is no
    // gait left to run at that speed — the legs cannot reach that far that
    // fast — so it stops pretending to walk, plants both legs on the
    // trailing side and skates. Measured against the machine's OWN dash,
    // because "too fast to walk" is a fact about the machine and not a
    // number that could be picked in advance.
    const dash = s.dashSpeed ?? 0;
    const walk = s.walkCap ?? 0;
    const sideways = dash > walk + 1
      ? clamp01((Math.abs(localVel.x) - walk) / (dash - walk))
      : 0;
    // On fast, off slowly. A slide that faded in would be a machine
    // deciding to slide; it is supposed to be a machine that has no choice.
    const want = sideways * s.grounded;
    this.slide = damp(
      this.slide, want,
      want > this.slide ? SLIDE.riseHalfLife : SLIDE.fallHalfLife, dt,
    );
    this.slideDir = Math.abs(localVel.x) > 0.05
      ? Math.sign(localVel.x)
      : (this.slideDir || 1);

    this._sway(dt);

    // ---- limbs
    if (floating) {
      this._floatLegs(s, dt);
    } else {
      switch (gait) {
        case 'hop': this._hop(s, dt); break;
        case 'walk': this._walk(s, dt); break;
        case 'multileg': this._multileg(s, dt); break;
        default: this._hover(s, dt); break;
      }
    }

    this._brace(s);
    this._arms(s, dt);
    this._faces(s, dt);
    this._customs(s, dt);
    this._weapons(s, dt);
    // Last, because a linked bone copies whatever its partner ended up at.
    this._links();
    this._commit(dt);
  }

  /**
   * A heavy machine coming down plants itself: the knees fold and the body
   * sinks onto them, and it takes a moment to stand back up.
   *
   * Added ON TOP of whatever the gait is doing rather than replacing it, so
   * a machine that lands running keeps running — it just does the first
   * fraction of a second of it from a crouch. The sign alternates down the
   * chain so the leg CLOSES like a knee rather than swinging like a
   * pendulum, which is the same trick the hop uses.
   */
  _brace(s) {
    const load = clamp01(s.landing ?? 0);
    if (load <= 1e-3) return;
    for (const limb of this.rig.limbs) {
      const mirror = limb.root.part.invert ? -1 : 1;
      limb.chain.forEach((node, i) => {
        const bend = BRACE.bend * DEG * load * (i % 2 === 0 ? 1 : -1.35) * mirror;
        _q.setFromAxisAngle(this._strideAxis(node), bend * Animator.gainOf(node));
        node.target.multiply(_q);
        limitQuat(node.target, node.part, 0, node);
      });
    }
  }

  /**
   * The axis to swing this joint about so its tip steps along the CURRENT
   * direction of travel.
   *
   * Rotating about A moves the tip along (A x S). We want that along the
   * travel direction D = cos.Z + sin.X, and the cross product is linear in D,
   * so the answer is just the same blend of the two bound axes.
   */
  /** How much of its attribute's motion this bone takes. */
  /**
   * How hard this bone drives, with what has been shot off it taken away.
   *
   * `wear` is put there by the machine when a round lands on the joint. A
   * worn hip still walks, it just walks worse — which is the whole point of
   * shooting at one.
   */
  static gainOf(node) {
    return (node.part.gain ?? 1) * (1 - (node.wear ?? 0) * 0.75);
  }

  /** Where this bone sits in the gait cycle, its own lag included. */
  _phaseFor(node, extra = 0) {
    return (this.gaitPhase + extra + (node.part.lag ?? 0) + 1) % 1;
  }

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
      _q.setFromAxisAngle(
        this._strideAxis(node),
        (bend + (dir + sway) * (1 - t)) * Animator.gainOf(node),
      );
      node.target.copy(limitQuat(_q, node.part, 0, node));
    });
  }

  /**
   * Two legs: opposed sine stride with a knee that only bends one way —
   * unless the machine is going sideways faster than it can step, in which
   * case it stops stepping.
   *
   * Above its own dash speed there is no stride that could keep up: a leg
   * would have to swing further than it can reach, faster than it can move,
   * and the result is the machine moonwalking at thirty metres a second.
   * So the stride is blended OUT and both legs cant over onto the trailing
   * side, which is the shape a thing being carried sideways actually makes
   * — the feet held back by the floor, the body going on ahead.
   */
  _walk(s, dt) {
    const drive = clamp01(this.gaitFreq / 2.6);
    const amp = lerp(10, 40, drive) * DEG;
    const kneeAmp = lerp(8, 55, drive) * DEG;
    const idle = 1 - clamp01(this.gaitFreq * 2.2);
    const air = 1 - s.grounded;
    const skate = this.slide;
    const walking = 1 - skate;

    for (const limb of this.rig.limbs) {
      const mirror = limb.root.part.invert ? -1 : 1;

      limb.chain.forEach((node, i) => {
        // Each bone reads the cycle at its own point in it, so a hip set to
        // lag behind its knee gives the leg a whip rather than a hinge.
        const p = this._phaseFor(node, limb.phaseOffset);
        const stride = Math.sin(p * TAU);
        const lift = Math.max(0, Math.sin(p * TAU));

        let angle;
        if (i === 0) {
          angle = stride * amp * mirror - air * 22 * DEG + idle * 2 * DEG;
        } else if (i === 1) {
          angle = -(lift * kneeAmp + air * 34 * DEG) * mirror;
        } else {
          angle = (-stride * amp * 0.35 + lift * kneeAmp * 0.4) * mirror;
        }
        _q.setFromAxisAngle(this._strideAxis(node), angle * walking * Animator.gainOf(node));
        node.target.copy(limitQuat(_q, node.part, 0, node));

        // Cant the whole leg over onto the side it is being dragged from.
        // A positive turn about the splay axis takes the tip toward -X, so
        // travelling +X wants a positive one: the feet trail, the body goes
        // on without them.
        if (skate > 1e-3) {
          const taper = i === 0 ? 1 : SLIDE.taper ** i;
          _q.setFromAxisAngle(
            node.axisSplay,
            SLIDE.tilt * DEG * skate * this.slideDir * taper * Animator.gainOf(node),
          );
          node.target.multiply(_q);
          limitQuat(node.target, node.part, 0, node);
        }
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
      const p = this._phaseFor(limb.root, limb.phaseOffset);
      const stride = Math.sin(p * TAU);
      // Swing occupies the first half of the cycle; stance drags along the floor.
      const swing = Math.max(0, Math.sin(p * TAU));
      const mirror = limb.root.part.invert ? -1 : 1;
      const splay = 22 * DEG * -limb.root.side;

      limb.chain.forEach((node, i) => {
        // Splay is posture, not motion, so gain leaves it alone: a hip turned
        // down to a shoulder's worth of swing still stands where it stood.
        const g = Animator.gainOf(node);
        if (i === 0) {
          // hip: step along the travel vector, lift clear of the floor on the swing
          _q.setFromAxisAngle(this._strideAxis(node), stride * strideAmp * mirror * g);
          _q2.setFromAxisAngle(
            node.axisLift,
            (swing * liftAmp + air * 14 * DEG) * -limb.root.side * node.liftScale * g,
          );
          _q.multiply(_q2);
          _q2.setFromAxisAngle(node.axisSplay, splay * (1 + idle * 0.3));
          _q.multiply(_q2);
        } else {
          // knee: tuck during the swing, extend to plant
          // With a vertical hip the knee is the only thing that can pick the
          // foot up, so it carries the whole lift.
          const bend = ((0.35 + swing * 0.65) * kneeAmp + air * 18 * DEG) * g;
          _q.setFromAxisAngle(this._strideAxis(node), -bend * mirror);
          _q2.setFromAxisAngle(
            node.axisLift,
            -swing * liftAmp * 0.5 * -limb.root.side * node.liftScale * g,
          );
          _q.multiply(_q2);
        }
        node.target.copy(limitQuat(_q, node.part, 0, node));
      });
    }
  }

  /**
   * Update the pendulum a hanging limb swings on.
   *
   * Two forces, both read off the body's own motion: legs are thrown back
   * when the machine accelerates, and they drag against the way it is
   * already travelling. Damping toward the sum is what makes them lag —
   * they arrive late and settle late, which is the whole tell that they are
   * hanging rather than being held.
   */
  _sway(dt) {
    if (dt <= 0) return;
    _t2.set(
      (this.localVel.x - this._prevLocalVel.x) / dt,
      (this.localVel.z - this._prevLocalVel.z) / dt,
    );
    this._prevLocalVel.copy(this.localVel);

    // Acceleration throws them hard; travel drags them gently.
    const tx = clamp(-_t2.x * 0.016 - this.localVel.x * 0.030, -1, 1);
    const tz = clamp(-_t2.y * 0.016 - this.localVel.z * 0.030, -1, 1);
    this.legSway.set(damp(this.legSway.x, tx, 0.13, dt), damp(this.legSway.y, tz, 0.13, dt));
  }

  /**
   * Legs with no ground under them.
   *
   *   1 leg    a plain pendulum: it goes where inertia leaves it
   *   2 legs   hung, knees softly folded, toes pointed and trailing
   *   3+ legs  curled inward under the body, the way an insect flies
   */
  _floatLegs(s, dt) {
    const n = this.rig.limbs.length;
    if (n === 1) this._floatSingle(s, dt);
    else if (n === 2) this._floatPair(s, dt);
    else this._floatCurl(s, dt);
  }

  /**
   * Which way the angles go.
   *
   * The stride axis is Z x S, and (Z x S) x S = -Z, so turning a joint the
   * POSITIVE way about it swings the tip BACKWARD. Same story sideways:
   * positive about the splay axis carries the tip toward -X. Every float
   * pose below is written in those terms — "back" and "inboard" are the
   * positive directions — because a hanging leg is described far more
   * naturally that way than by the raw axis signs.
   */

  /** One leg, hanging free. Inertia is the only thing posing it. */
  _floatSingle(s, dt) {
    const limb = this.rig.limbs[0];
    if (!limb) return;
    const sway = this.legSway;
    const mag = Math.hypot(sway.x, sway.y);
    const idle = Math.sin(this.time * 1.15) * 3 * DEG;

    limb.chain.forEach((node, i) => {
      // Down the chain the swing arrives later and smaller: the tip of a
      // hanging limb always trails its own root.
      const follow = 0.62 ** i;
      const g = Animator.gainOf(node);
      _q.setFromAxisAngle(node.axisStride, (-sway.y * 30 * DEG * follow + idle) * g);
      _q2.setFromAxisAngle(node.axisSplay, -sway.x * 22 * DEG * follow * g);
      _q.multiply(_q2);
      if (i > 0) {
        // A trailing knee never straightens all the way.
        _q2.setFromAxisAngle(node.axisStride, (9 + mag * 13) * DEG * g);
        _q.multiply(_q2);
      }
      node.target.copy(limitQuat(_q, node.part, 0, node));
    });
  }

  /**
   * Two legs, hung the way a hovering bipedal frame hangs them: trailing a
   * little behind the body, knees softly folded back, toes pointed. Held
   * close together rather than braced apart — there is nothing to brace
   * against.
   */
  _floatPair(s, dt) {
    const sway = this.legSway;
    const mag = Math.hypot(sway.x, sway.y);
    const thrust = s.thrust ?? 0;

    for (const limb of this.rig.limbs) {
      const mirror = limb.root.part.invert ? -1 : 1;
      const side = limb.root.side;
      // The two legs breathe out of phase, so the pair never reads as one
      // rigid fork.
      const idle = Math.sin(this.time * 0.9 + (side > 0 ? 0 : Math.PI)) * 2.5 * DEG;

      limb.chain.forEach((node, i) => {
        const g = Animator.gainOf(node);
        const follow = 0.68 ** i;
        let pitch;
        if (i === 0) {
          // Hip: hangs a touch behind vertical, and further back the harder
          // the thrusters push.
          pitch = (11 + thrust * 9) * DEG - sway.y * 26 * DEG + idle;
        } else if (i === 1) {
          // Knee: folded back, and it folds tighter as the machine moves.
          pitch = (20 + mag * 10) * DEG * mirror - sway.y * 26 * DEG * follow;
        } else {
          // Ankle and beyond: the toe points, trailing the knee.
          pitch = (-14 + mag * 6) * DEG * mirror - sway.y * 20 * DEG * follow;
        }
        _q.setFromAxisAngle(this._strideAxis(node), pitch * g);
        // Drawn in toward the centre line, plus whatever the sway asks for.
        _q2.setFromAxisAngle(node.axisSplay, (side * 5 * DEG - sway.x * 20 * DEG * follow) * g);
        _q.multiply(_q2);
        node.target.copy(limitQuat(_q, node.part, 80, node));
      });
    }
  }

  /**
   * Three legs or more: curled in under the body, tracing an arc, the way a
   * flying insect carries the legs it is not standing on. Each bone down the
   * chain turns a little further the same way, and a chain of equal turns IS
   * an arc — that is where the circle comes from.
   */
  _floatCurl(s, dt) {
    const sway = this.legSway;
    const mag = Math.hypot(sway.x, sway.y);

    for (const limb of this.rig.limbs) {
      const side = limb.root.side;
      // Front legs fold forward and under, back legs trail back and under —
      // the way a beetle carries them in the air. Curling every leg the same
      // way just piles all the feet in the middle and they cross.
      const fore = Math.sign(Number(limb.root.restPos.z.toFixed(3))) || 1;
      // Slow, per-limb ripple: real ones never hold perfectly still.
      const idle = Math.sin(this.time * 1.3 + limb.phaseOffset * TAU) * 3 * DEG;

      limb.chain.forEach((node, i) => {
        const g = Animator.gainOf(node);
        const follow = 0.7 ** i;
        // The arc: each joint turns a bit further the same way. Big enough
        // at the hip to lift the limb clear of hanging, tighter down the
        // chain to close the curl.
        const curl = (34 + i * 22) * DEG;
        _q.setFromAxisAngle(node.axisSplay, (side * curl - sway.x * 18 * DEG * follow) * g);
        _q2.setFromAxisAngle(
          this._strideAxis(node),
          (-fore * (16 + i * 13) * DEG - sway.y * 22 * DEG * follow + idle + mag * 5 * DEG) * g,
        );
        _q.multiply(_q2);
        node.target.copy(limitQuat(_q, node.part, 110, node));
      });
    }
  }

  /** No legs at all: everything just trails the acceleration. */
  _hover(s, dt) {
    for (const node of this.rig.joints) {
      if (node.part.boneType !== 'leg') continue;
      _q.setFromAxisAngle(node.axisStride, Math.sin(this.time * 1.6 + node.restPos.x) * 5 * DEG);
      node.target.copy(limitQuat(_q, node.part, 0, node));
    }
  }

  // ---------------------------------------------------------- arms / face

  /**
   * Arms swing counter-phase to the legs while travelling; the moment a
   * lock exists they abandon the gait and point down the firing line.
   */
  _arms(s, dt) {
    const drive = clamp01(this.gaitFreq / 2.6);
    const swingAmp = lerp(4, 34, drive) * DEG;
    /**
     * How far a chained arm folds at rest, before any swing.
     *
     * An arm that runs with its elbow locked straight is the single thing
     * that makes a walking machine read as a mannequin being dragged along —
     * the legs can be doing everything right and it still looks rigid. The
     * fold grows with the stride, so standing still keeps the arms nearly
     * straight and a run carries them up.
     */
    const fold = lerp(5, 42, drive) * DEG;

    for (const node of this.rig.armBones) {
      const phaseSide = node.side >= 0 ? 0 : 0.5;
      // An arm hung off another arm is a forearm: it trails the shoulder and
      // takes less of the swing, or the limb bends twice as far as an arm can.
      const depth = node.chainDepth ?? 0;
      // How much of the shoulder's swing this link takes. It was 0.55 per
      // link, hard-wired, which puts a third link at 0.166 — right for a
      // forearm, useless for a tentacle where every segment takes nearly
      // all of it.
      const perLink = node.part.chain ?? CHAIN_FALLOFF_DEFAULT;
      const chainFalloff = depth === 0 ? 1 : perLink ** depth;
      const chainLag = depth * 0.08;
      const p = this._phaseFor(node, phaseSide + chainLag);
      const swing = -Math.sin(p * TAU) * swingAmp * chainFalloff;
      const idleFloat = Math.sin(this.time * 1.3 + node.restPos.x * 2) * 3 * DEG;
      // Negative folds the tip forward: the elbow closes rather than opening
      // backwards into a shape no arm makes.
      const bend = depth > 0 ? -fold : 0;

      _q.setFromAxisAngle(
        this._strideAxis(node),
        (swing + bend + idleFloat + s.thrust * 12 * DEG) * Animator.gainOf(node),
      );

      if (s.aimDir && this.aimBlend > 0.001) {
        this._aimQuat(node, s.aimDir, s.bodyQ, _q2);
        _q.slerp(_q2, this.aimBlend);
      }
      node.target.copy(limitQuat(_q, node.part, 95, node));
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
      node.target.copy(limitQuat(_q, node.part, 80, node));
    }
  }

  _customs(s, dt) {
    for (const node of this.rig.customBones) {
      const c = node.part.custom ?? {};
      const axis = this._axisOf(node, c.axis);
      const drive = this._customDrive(c, s);
      const gain = Animator.gainOf(node);

      if ((c.wave ?? 'sine') === 'saw' && !c.bounded) {
        // A continuous turn: the drive scales the SPEED, not the angle, so
        // easing off does not snap the joint back to where it started.
        node.spinPhase = (node.spinPhase ?? c.phase ?? 0)
          + (c.freq ?? 1) * drive * gain * dt;
        _q.setFromAxisAngle(axis, node.spinPhase * TAU + (c.offset ?? 0) * DEG);
        node.target.copy(_q);          // no joint limit: it is a rotation
        continue;
      }

      // "Stride" locks the wave to the walk cycle instead of a free clock,
      // which is what a waist has to do: twist in time with the footfalls.
      const base = c.source === 'stride'
        ? this._phaseFor(node) * (c.freq ?? 1) + (c.phase ?? 0)
        : this.time * (c.freq ?? 1) + (c.phase ?? 0);

      /**
       * A second wave, laid over the first.
       *
       * One wave is either slow and wide or quick and small; it cannot be
       * both, so "sways heavily while trembling" was not expressible at
       * all. Zero amplitude costs nothing, which is the default.
       */
      let swing = waveAt(c.wave, base) * (c.amp ?? 20);
      if (c.amp2) {
        const t2 = c.source === 'stride'
          ? this._phaseFor(node) * (c.freq2 ?? 4) + (c.phase ?? 0)
          : this.time * (c.freq2 ?? 4) + (c.phase ?? 0);
        swing += waveAt(c.wave2 ?? 'sine', t2) * c.amp2;
      }

      // The resting angle itself can move with the drive: a waist that
      // leans forward the faster you go, rather than only twisting harder.
      const rest = (c.offset ?? 0) + (c.offsetGain ?? 0) * drive * (c.amp ?? 20);
      const angle = (rest + swing * drive * gain) * DEG;
      _q.setFromAxisAngle(axis, limitAngle(angle, node.part, node.wear));
      node.target.copy(_q);
    }
  }

  /**
   * The things that HAPPEN, set by their event and decayed on their own.
   *
   * Landing arrives as a speed, so it is scaled against what counts as a
   * hard one rather than used raw. A swap is noticed rather than announced:
   * the weapon system already knows which plate is live, and comparing it to
   * last frame is both cheaper and impossible to forget to call.
   */
  _pulses(s, dt) {
    const decay = Math.pow(0.02, dt);
    this.firePulse = Math.max(s.fired ? 1 : 0, this.firePulse * decay);
    this.hurtPulse = Math.max(s.hurt ? clamp01(s.hurt) : 0, this.hurtPulse * decay);
    this.landPulse = Math.max(clamp01((s.landing ?? 0) / 12), this.landPulse * decay);
    const nowWeapon = s.activeWeapon ?? null;
    if (nowWeapon !== this.activeWeapon) {
      this.swapPulse = 1;
      this.activeWeapon = nowWeapon;
    } else {
      this.swapPulse *= decay;
    }
    return this;
  }

  /** Which of the bone's three axes a setting names. */
  _axisOf(node, axis) {
    return axis === 'y' ? node.axisTwist : axis === 'z' ? node.axisLift : node.axisStride;
  }

  /**
   * What a custom bone is listening to.
   *
   * The first six are all about MOVING. Nothing here used to be about
   * fighting, which is why a machine looked the same whether it was full of
   * holes and out of ammunition or fresh off the bench.
   */
  /**
   * Weapon bones: the stance a machine takes for the gun in its hands.
   *
   * "Only moves when you switch weapons" read literally is a one-shot
   * gesture, but a gesture that plays and ends says nothing about WHICH
   * weapon you ended up holding. A pose does both: the bone is deployed
   * while its weapon is live and stowed otherwise, so it moves exactly at
   * the switch and then holds — and the machine's silhouette tells you what
   * it is carrying without a glance at the rack.
   *
   * Bound to a weapon TYPE, not to a rack index. An index shifts the moment
   * another plate is fitted, which would silently change what every weapon
   * bone on the machine means; "the arm that raises for the sniper" stays
   * that arm for ever.
   */
  _weapons(s, dt) {
    for (const node of this.rig.weaponBones) {
      const w = node.part.weapon ?? {};
      const live = s.activeWeapon ?? null;
      const want = live !== null && (w.when === 'any' || w.when === live) ? 1 : 0;

      // This is the whole of "only moves when you switch". The target is 0
      // or 1 and nothing else, so between switches it is already there and
      // nothing moves. No state machine, no timers.
      //
      // A machine that spawns holding a rifle starts with the rifle pose,
      // rather than swinging into it in front of everyone.
      if (node.deployT === undefined) {
        node.deployT = want;
        node.deployV = 0;
      }

      /**
       * A spring, not a fade.
       *
       * `overshoot` is how far under-damped it is: at 0 the bone arrives and
       * stops, and the further up it goes the more it carries past its mark
       * and comes back. A fade cannot do that at all — it can only ever
       * approach from one side, which is why a hard-swung arm read as a
       * slow one however the numbers were set.
       */
      const wn = clamp(w.speed ?? 3.2, 0.1, 12);
      const zeta = 1 - clamp(w.overshoot ?? 0, 0, 0.9);
      // A distant machine is posed every third step and hands the animator
      // all three at once. A spring integrated over a step that long comes
      // apart, so it is stepped at a length it can survive.
      const h = Math.min(dt, 1 / 30);
      node.deployV = (node.deployV ?? 0)
        + ((want - node.deployT) * wn * wn - 2 * zeta * wn * (node.deployV ?? 0)) * h;
      node.deployT += node.deployV * h;

      const angle = lerp(w.stowed ?? 0, w.deployed ?? -60, node.deployT)
        * Animator.gainOf(node) * DEG;
      _q.setFromAxisAngle(this._axisOf(node, w.axis), limitAngle(angle, node.part, node.wear));
      node.target.copy(_q);
    }
  }

  /**
   * Bones that copy another bone, as a fraction of its angle.
   *
   * A mechanical linkage: armour that opens as the joint under it bends, a
   * counterweight that swings the other way. Run after everything else,
   * because it reads the angle its partner actually ended up at rather than
   * the one it was asked for — a linkage driven by an intention rather than
   * by a result is not a linkage.
   */
  _links() {
    for (const node of this.rig.joints) {
      const link = node.part.link;
      if (!link?.to) continue;
      const from = this.rig.nodes.get(link.to);
      if (!from?.target) continue;
      // Its partner's swing, signed about the axis that partner turns on.
      // Read off the quaternion rather than remembered, because whichever
      // routine posed that bone is none of this one's business.
      if (!from.axisStride) continue;
      _v.set(from.target.x, from.target.y, from.target.z);
      const axis = Animator.spinAxisOf(from);
      const angle = 2 * Math.atan2(_v.dot(axis), from.target.w);
      _q.setFromAxisAngle(
        node.axisStride, limitAngle(angle * (link.ratio ?? 1), node.part, node.wear),
      );
      node.target.copy(_q);
    }
  }

  /**
   * How hard a joint chases the pose it has been given, this frame.
   *
   * Every joint used to be slerped at one global rate, so a two-tonne arm
   * and a whip aerial arrived at exactly the same speed. A bone can now name
   * its own half-life, and a damping under 1 lets it overshoot and come
   * back — which is most of what makes a light part read as light.
   */
  /**
   * The axis a bone is actually turning about, for reading its angle back.
   *
   * A custom or weapon bone names its own axis; everything else swings on
   * its stride axis. Guessing wrong flips the sign of a linkage, which reads
   * as the linked part moving the opposite way to the joint driving it.
   */
  static spinAxisOf(node) {
    const named = node.part.boneType === 'weapon'
      ? node.part.weapon?.axis
      : node.part.boneType === 'custom' ? node.part.custom?.axis : null;
    if (named === 'y') return node.axisTwist;
    if (named === 'z') return node.axisLift;
    return node.axisStride;
  }

  static followOf(node, dt, base) {
    const f = node.part.follow ?? {};
    if (!f.ease) return base;
    const k = clamp01(1 - Math.pow(0.001, dt / Math.max(0.01, f.ease)));
    // Under-damped: carry a little past, then settle. Never past 1.6, or
    // the joint oscillates instead of arriving.
    return clamp(k * (f.damping >= 1 ? 1 : (2 - f.damping)), 0, 1.6);
  }

  _customDrive(c, s) {
    switch (c.source) {
      case 'stride': return clamp01(this.gaitFreq / 1.6);
      case 'speed': return clamp01((s.planarSpeed ?? 0) / 18);
      case 'thrust': return s.thrust ?? 0;
      case 'jerk': return clamp01((s.jerk ?? 0) / 240);
      case 'aim': return this.aimBlend;
      case 'boost': return clamp01(s.boost ?? 0);
      // These four decay on their own, so a bone driven by them fires and
      // settles rather than being held open by a number that stays put.
      case 'landing': return clamp01(this.landPulse);
      case 'recoil': return clamp01(this.firePulse);
      case 'damage': return clamp01(this.hurtPulse);
      // How far GONE it is, not how much is left: a machine should do more
      // as it comes apart, not less.
      case 'hp': return clamp01(1 - (s.hp ?? 1));
      case 'energy': return clamp01(1 - (s.energy ?? 1));
      case 'weapon': return clamp01(this.swapPulse);
      default: return 1;
    }
  }

  /**
   * Run ONLY the custom bones, for the editor: tuning a motion you cannot
   * see until you deploy is tuning blind, but faking a whole walk cycle
   * would move everything else too.
   */
  /**
   * Run the moving bones on the workbench, and nothing else.
   *
   * Two things this has to do that a fight does not. It moves only what the
   * builder is working on, because a machine where every bone is running at
   * once tells you nothing about the one you are tuning; and it takes its
   * drive signals from the panel, because on the bench the machine is
   * standing still — so a bone driven by speed, by boost, by damage or by
   * anything else that only happens in a fight simply did not move, and
   * every slider under it was a guess.
   *
   * @param {number} dt
   * @param {object} [s] forced signals, exactly as a fight would supply them
   * @param {Set<string>|null} [only] part ids to move; null moves them all
   */
  previewBones(dt, s = {}, only = null) {
    this.time += dt;
    const signals = { planarSpeed: 0, thrust: 0, jerk: 0, ...s };
    // The gait clock does not run on the bench, so anything locked to the
    // stride would sit still. The panel drives it directly instead.
    if (s.gaitFreq !== undefined) this.gaitFreq = s.gaitFreq;
    if (s.locked !== undefined) this.aimBlend = clamp01(s.locked);
    this._pulses(signals, dt);
    this._customs(signals, dt);
    this._weapons(signals, dt);
    this._links();

    for (const node of this.rig.joints) {
      if (only && !only.has(node.part.id)) continue;
      if (node.part.boneType !== 'custom' && node.part.boneType !== 'weapon'
        && !node.part.link?.to) continue;
      const base = clamp01(1 - Math.pow(0.0008, dt));
      node.joint.quaternion.slerp(node.target, Animator.followOf(node, dt, base));

      // How far it is ACTUALLY going, as opposed to how far it is allowed
      // to. The arc drawn round a joint is the setting, and whether the
      // motion under it ever reaches that arc was not knowable from looking.
      const now = node.joint.quaternion.angleTo(_rest) / DEG;
      node.reach = Math.max(now, (node.reach ?? 0) - dt * 12);
    }
    return this;
  }

  /** @deprecated the bench drives its own signals now. */
  updateCustomsOnly(dt) {
    return this.previewBones(dt);
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
      const base = clamp01(
        1 - Math.pow(0.0008, dt * (node.part.boneType === 'leg' ? 1.6 : 1.0)),
      );
      node.joint.quaternion.slerp(node.target, Animator.followOf(node, dt, base));
    }
  }

  /**
   * Put the feet on what is actually underneath each of them.
   *
   * The body is held up by ONE probe at the middle of the machine, so on a
   * step, a crate or a slope one foot is buried in the concrete and the
   * other is standing on nothing — and a walk cycle, however good, cannot
   * hide a foot that is six inches inside the floor.
   *
   * One joint per limb, the one at the top of it. Bending the whole chain
   * would be a solver; this is a correction, and a correction that moves the
   * hip is the one a real leg makes anyway.
   *
   * Called after the pose is committed and after world transforms are up to
   * date, by whoever knows what the ground is.
   * Costs one world-position read and one small matrix update per limb, and
   * only for machines close enough to matter — so it is off by default and
   * the caller turns it on.
   *
   * @param {(x: number, z: number, fromY: number) => number} surfaceAt
   * @param {number} grounded 0..1 — how much this machine is on the ground
   * @param {number} dt
   */
  plantFeet(surfaceAt, grounded, dt) {
    if (!surfaceAt || grounded <= 0.01 || !this.rig.limbs?.length) return this;

    for (const limb of this.rig.limbs) {
      const root = limb.root;
      const tipNode = limb.chain[limb.chain.length - 1];
      if (!root?.joint || !tipNode?.far) continue;

      // Where this leg actually ends, in the world.
      const tip = _foot.set(0, tipNode.length / 2, 0);
      tipNode.far.localToWorld(tip);
      const pivot = root.joint.getWorldPosition(_pivot);

      const want = surfaceAt(tip.x, tip.z, pivot.y);
      // Up out of the floor at once; down onto a surface only if it is
      // within reach, or a leg beside a ledge would stretch for the bottom.
      let delta = want - tip.y;
      if (delta < -PLANT.reach) delta = -PLANT.reach;
      if (delta > PLANT.reach) delta = PLANT.reach;
      // Eased, so stepping onto a crate is a step and not a snap.
      root.plantY = damp(root.plantY ?? 0, delta * grounded, PLANT.ease, dt);
      if (Math.abs(root.plantY) < 0.004) continue;

      // The axis about which turning this joint lifts the foot most: across
      // the line from the hip to the foot, level with the world. Worked out
      // rather than assumed, because "which way is up for this bone" depends
      // on how the machine was built and there is no answering it in general.
      const arm = _armv.copy(tip).sub(pivot);
      const axis = _paxis.crossVectors(arm, WORLD_UP);
      if (axis.lengthSq() < 1e-6) continue;
      axis.normalize();
      // How far the foot rises per radian about that axis.
      const rate = _rate.crossVectors(axis, arm).y;
      if (Math.abs(rate) < 0.05) continue;
      const theta = clamp(root.plantY / rate, -PLANT.maxAngle, PLANT.maxAngle);

      // Applied in the joint's parent frame, so it composes with the pose
      // rather than replacing it.
      root.joint.parent.getWorldQuaternion(_pq);
      _paxis.applyQuaternion(_pq.invert());
      _q.setFromAxisAngle(_paxis, theta);
      root.joint.quaternion.premultiply(_q);
      root.joint.updateMatrixWorld(true);
    }
    return this;
  }

  /** Visual-only body offset: bob and lean, applied by the caller. */
  applyBodyCarriage(object) {
    object.position.y += this.bodyBob;
    _euler.set(this.bodyLean.x, 0, this.bodyLean.y, 'XZY');
    _q.setFromEuler(_euler);
    object.quaternion.multiply(_q);
  }
}
