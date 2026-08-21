import * as THREE from 'three';
import { clamp, clamp01, damp, smoothstep, RingBuffer } from './math.js';

// ============================================================
//  ZMF §4 : Assist Controller
//    prediction-weighted proportional navigation (Kalman-lite),
//    angular-rate limiter, soft override.
// ============================================================

const _r = new THREE.Vector3();
const _vrel = new THREE.Vector3();
const _omega = new THREE.Vector3();
const _cmd = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _lead = new THREE.Vector3();

/**
 * A very small constant-acceleration estimator. Not a real Kalman filter —
 * it is a two-stage complementary blend, which is all the fidelity a
 * dogfight needs and is far cheaper and far more stable.
 */
class TargetEstimator {
  constructor(historySize = 10) {
    this.samples = new RingBuffer(historySize);
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.accel = new THREE.Vector3();
    /** How erratic the target has been recently, 0..1. */
    this.volatility = 0;
    this._lastVel = new THREE.Vector3();
    this._primed = false;
  }

  reset() { this.samples.clear(); this._primed = false; this.volatility = 0; }

  observe(pos, t, dt) {
    const prev = this.samples.back(0);
    this.samples.push({ p: pos.clone(), t });

    if (!prev) {
      this.position.copy(pos);
      this.velocity.set(0, 0, 0);
      this.accel.set(0, 0, 0);
      this._primed = true;
      return;
    }

    const h = Math.max(1e-4, t - prev.t);
    _tmp.copy(pos).sub(prev.p).divideScalar(h);

    // Stage 1: smooth the raw difference (measurement trust rises with dt).
    const kV = 1 - Math.pow(0.02, dt);
    this.velocity.lerp(_tmp, kV);

    // Stage 2: acceleration from the change in the smoothed velocity.
    _tmp.copy(this.velocity).sub(this._lastVel).divideScalar(h);
    const kA = 1 - Math.pow(0.08, dt);
    this.accel.lerp(_tmp, kA);
    this._lastVel.copy(this.velocity);

    // Volatility: how much of the recent motion is unmodelled.
    const jitter = clamp01(this.accel.length() / 90);
    this.volatility = damp(this.volatility, jitter, 0.25, dt);

    this.position.copy(pos);
  }

  /** Constant-acceleration extrapolation, damped by how noisy the target is. */
  predict(tAhead, out = new THREE.Vector3()) {
    const trust = 1 - this.volatility * 0.55;
    out.copy(this.position).addScaledVector(this.velocity, tAhead * trust);
    // The quadratic term is the one that runs away on noisy estimates, so it
    // gets a hard magnitude ceiling rather than just a trust weighting.
    const a = Math.min(this.accel.length(), 26);
    if (a > 1e-4) {
      _tmp2.copy(this.accel).normalize().multiplyScalar(a);
      out.addScaledVector(_tmp2, 0.5 * tAhead * tAhead * trust * trust);
    }
    return out;
  }
}

export class AssistController {
  constructor() {
    this.estimator = new TargetEstimator();
    /** The point the machine should actually be looking at. */
    this.aimPoint = new THREE.Vector3();
    /** Pro-Nav acceleration command, world space. */
    this.command = new THREE.Vector3();
    /** Line-of-sight rotation rate, world space. */
    this.losRate = new THREE.Vector3();
    this.range = NaN;
    this.closingRate = 0;
    /** 0 = fully manual, 1 = fully assisted. */
    this.authority = 0;
    this.timeToGo = 0;
    this.hasTarget = false;

    this.config = {
      /** Pro-Nav gain, ramped by range. */
      navGainNear: 2.4,
      navGainFar: 4.1,
      /** Above this input intensity the player takes the wheel (§4.1). */
      overrideThreshold: 0.34,
      overrideFull: 0.85,
      /** Hard ceiling on assisted turn rate, rad/s. */
      maxTurnRate: 3.2,
      leadWeight: 0.72,
    };
  }

  clear() {
    this.hasTarget = false;
    this.authority = 0;
    this.command.set(0, 0, 0);
    this.losRate.set(0, 0, 0);
    this.range = NaN;
    this.closingRate = 0;
    this.estimator.reset();
  }

  /**
   * @param {THREE.Vector3} selfPos
   * @param {THREE.Vector3} selfVel
   * @param {{position:THREE.Vector3, radius:number}|null} target
   * @param {number} inputIntensity  0..1, from InputManager
   */
  update(selfPos, selfVel, target, inputIntensity, t, dt) {
    if (!target) { this.clear(); return this; }

    this.hasTarget = true;
    this.estimator.observe(target.position, t, dt);

    _r.copy(this.estimator.position).sub(selfPos);
    const range = _r.length();
    this.range = range;

    _vrel.copy(this.estimator.velocity).sub(selfVel);
    this.closingRate = range > 1e-4 ? -_vrel.dot(_tmp.copy(_r).divideScalar(range)) : 0;

    // --- time to go, used both for lead and for the prediction horizon
    const closing = Math.max(2, this.closingRate);
    this.timeToGo = clamp(range / closing, 0, 2.2);

    // --- 4.1 prediction-weighted aim point
    // Blend actual and predicted so a target that jinks does not whip the view.
    const predicted = this.estimator.predict(this.timeToGo, _tmp);
    const w = this.config.leadWeight * (1 - this.estimator.volatility * 0.6);
    this.aimPoint.copy(this.estimator.position).lerp(predicted, clamp01(w));

    // A lead point that leaves the target behind is worse than no lead at all.
    _lead.copy(this.aimPoint).sub(this.estimator.position);
    const maxLead = range * 0.4;
    if (_lead.lengthSq() > maxLead * maxLead) {
      this.aimPoint.copy(this.estimator.position).addScaledVector(_lead.normalize(), maxLead);
    }

    // --- proportional navigation:  a_cmd = N * |v_rel| * (LOS rate x los_unit)
    if (range > 1e-3) {
      const los = _tmp.copy(_r).divideScalar(range);
      // omega_los = (r x v_rel) / |r|^2
      _omega.copy(_r).cross(_vrel).divideScalar(range * range);
      this.losRate.copy(_omega);

      const N = THREE.MathUtils.lerp(
        this.config.navGainNear, this.config.navGainFar,
        smoothstep(8, 60, range),
      );
      _cmd.copy(_vrel).cross(_omega).multiplyScalar(-N);

      // --- angular-rate limiter (§4.1)
      // Projected angular size of the target: the bigger it looks, the less
      // the assist is allowed to swing, or the reticle whips past at knife range.
      const angularSize = Math.atan2(target.radius ?? 1.5, Math.max(0.5, range));
      const losMag = _omega.length();
      const ceiling = this.config.maxTurnRate * (1 - clamp01(angularSize / 0.55) * 0.72);
      const limiter = losMag > ceiling ? ceiling / losMag : 1;
      _cmd.multiplyScalar(limiter);
      this.turnLimiter = limiter;

      // --- soft override
      const manual = smoothstep(this.config.overrideThreshold, this.config.overrideFull, inputIntensity);
      const rangeGate = 1 - smoothstep(70, 130, range);   // no assist at silly ranges
      this.authority = damp(this.authority, (1 - manual) * rangeGate, 0.08, dt);

      this.command.copy(_cmd).multiplyScalar(this.authority);
    } else {
      this.command.set(0, 0, 0);
    }

    return this;
  }
}
