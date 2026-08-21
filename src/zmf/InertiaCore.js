import * as THREE from 'three';
import { clamp, clamp01, softStep, slew, damp } from './math.js';

// ============================================================
//  ZMF §3 : Inertia Core
//    3.1  velocity-Verlet + non-linear, distance-sensitive drag
//    3.2  normalised profiles + directional spool control
//
//  This module never touches the scene. It owns velocity, the
//  thruster spool state, and the fabricated drag coefficient.
// ============================================================

/**
 * Directional spool profiles, all in normalised 0..1 space.
 *   aMax : share of total thrust this direction may command
 *   rise : jerk while building thrust   (units of aMax per second)
 *   fall : jerk while releasing thrust
 *
 * Backward deliberately spools up slowly (retreating is a commitment)
 * but releases very fast, which is what makes precise stops possible.
 */
export const SPOOL_PROFILE = {
  forward:  { aMax: 1.00, rise: 5.20, fall: 3.40 },
  backward: { aMax: 0.56, rise: 1.45, fall: 6.60 },
  lateral:  { aMax: 0.80, rise: 4.30, fall: 3.90 },
  vertical: { aMax: 0.76, rise: 3.80, fall: 4.20 },
};

const _f = new THREE.Vector3();
const _vp = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class InertiaCore {
  constructor(stats) {
    this.velocity = new THREE.Vector3();
    this.accel = new THREE.Vector3();
    this.prevAccel = new THREE.Vector3();
    this.jerk = new THREE.Vector3();
    this.jerkMag = 0;

    /** Normalised applied thrust in body-local space. Chases the command. */
    this.spool = new THREE.Vector3();
    /** What the player asked for, after profile scaling. */
    this.command = new THREE.Vector3();

    /** Counter-thruster impulse window (§3.2). */
    this.counterImpulse = new THREE.Vector3();
    this.counterTimer = 0;
    this._reversalArmed = true;

    this.zeta = 0;
    this.thrustOutput = 0;      // 0..1, drives audio / VFX

    this.setStats(stats);
  }

  setStats(stats) {
    this.stats = stats;
    this.baseMass = stats.mass;
    this.thrust = stats.thrust;
    // Heavier machines sit in thicker space; that is what "weight" feels like
    // when there is no ground to push against.
    this.zetaViscous = 0.85 + stats.weightClass * 1.65;
    this.zetaQuad = 0.016 + stats.weightClass * 0.030;
    this.vKnee = 14 + stats.agility * 12;
  }

  get speed() { return this.velocity.length(); }
  get mass() { return this.baseMass * this._layerMass; }

  /**
   * §3.1 — the fabricated drag coefficient.
   * Low speed: a viscous floor that makes millimetre corrections possible.
   * High speed: a quadratic wall that gives the top end a ceiling you can feel.
   * Near a target and closing: deliberately relaxed, so the last stretch of
   * the approach reads as being pulled in rather than flying in.
   */
  computeDrag(speed, closingRate, range, viscosityScale) {
    const quadGate = softStep(speed, this.vKnee * 0.55, this.vKnee * 1.7, 5);
    let z = this.zetaViscous * viscosityScale + this.zetaQuad * speed * quadGate;

    if (Number.isFinite(range)) {
      // proximity 1 at contact -> 0 beyond ~40 units
      const proximity = 1 - softStep(range, 6, 42, 5);
      const closing = clamp01(closingRate / 18);
      const relief = proximity * closing;
      z *= 1 - 0.62 * relief;
      this.approachRelief = relief;
    } else {
      this.approachRelief = 0;
    }

    this.zeta = z;
    return z;
  }

  /**
   * §3.2 — directional spool control.
   * @param {THREE.Vector3} cmd  normalised local command (x=right, y=up, z=forward)
   */
  spoolTo(cmd, dt, jerkScale = 1) {
    const zProf = cmd.z >= 0 ? SPOOL_PROFILE.forward : SPOOL_PROFILE.backward;
    const tz = clamp(cmd.z, -1, 1) * zProf.aMax;
    const tx = clamp(cmd.x, -1, 1) * SPOOL_PROFILE.lateral.aMax;
    const ty = clamp(cmd.y, -1, 1) * SPOOL_PROFILE.vertical.aMax;

    this.command.set(tx, ty, tz);

    const j = jerkScale;
    this.spool.x = slew(this.spool.x, tx, SPOOL_PROFILE.lateral.rise * j, SPOOL_PROFILE.lateral.fall * j, dt);
    this.spool.y = slew(this.spool.y, ty, SPOOL_PROFILE.vertical.rise * j, SPOOL_PROFILE.vertical.fall * j, dt);
    this.spool.z = slew(this.spool.z, tz, zProf.rise * j, zProf.fall * j, dt);

    this.thrustOutput = clamp01(this.spool.length());
    return this.spool;
  }

  /**
   * §3.2 — opposing-thruster boost.
   * A hard reversal at speed gets a one-shot impulse applied outside the
   * mass term, so the flip reads as sharp instead of sludgy. Edge-triggered
   * so holding the stick back cannot farm it.
   */
  tryCounterBoost(worldCommandDir, dt) {
    this.counterTimer = Math.max(0, this.counterTimer - dt);

    const speed = this.speed;
    if (speed < 4 || worldCommandDir.lengthSq() < 0.2) { this._reversalArmed = true; return false; }

    const align = _tmp.copy(this.velocity).normalize().dot(worldCommandDir);
    if (align > -0.55) { this._reversalArmed = true; return false; }
    if (!this._reversalArmed || this.counterTimer > 0) return false;

    this._reversalArmed = false;
    this.counterTimer = 0.14;
    const magnitude = Math.min(speed, 34) * 0.62 * (0.7 + this.stats.agility * 0.6);
    this.counterImpulse.copy(worldCommandDir).multiplyScalar(magnitude);
    return true;
  }

  /**
   * A one-shot velocity change that ignores the mass term, the same way the
   * counter-thruster boost does. Dashes use this so a backward dash is just
   * as sharp as a forward one, instead of being throttled by the deliberately
   * sluggish backward spool profile.
   */
  applyImpulse(worldVelocity) {
    this.velocity.add(worldVelocity);
    return this.velocity;
  }

  /**
   * §3.1 — one velocity-Verlet substep.
   *
   * @param {THREE.Vector3} position    mutated in place
   * @param {THREE.Vector3} worldThrust world-space thruster force direction*magnitude (already 0..1 scaled)
   * @param {THREE.Vector3} external    world-space accelerations that bypass the mass term (gravity, repulsion)
   */
  integrate(position, worldThrust, external, dt, ctx) {
    const { layerMass = 1, viscosity = 1, closingRate = 0, range = NaN } = ctx;
    this._layerMass = layerMass;
    const m = this.baseMass * layerMass;

    // a(t) — recompute with the current state so Verlet stays consistent
    const zeta = this.computeDrag(this.speed, closingRate, range, viscosity);
    _f.copy(worldThrust).multiplyScalar(this.thrust / m).add(external);
    this.accel.copy(_f).addScaledVector(this.velocity, -zeta);

    // x(t+dt) = x + v*dt + 1/2*a*dt^2
    position.addScaledVector(this.velocity, dt).addScaledVector(this.accel, 0.5 * dt * dt);

    // a(t+dt) using the predicted velocity for the drag term
    _vp.copy(this.velocity).addScaledVector(this.accel, dt);
    const zeta2 = this.computeDrag(_vp.length(), closingRate, range, viscosity);
    _tmp.copy(worldThrust).multiplyScalar(this.thrust / m).add(external).addScaledVector(_vp, -zeta2);

    // v(t+dt) = v + 1/2*(a(t) + a(t+dt))*dt
    this.prevAccel.copy(this.accel);
    this.velocity.addScaledVector(this.accel, 0.5 * dt).addScaledVector(_tmp, 0.5 * dt);

    // one-shot counter impulse, applied as a pure velocity change
    if (this.counterTimer > 0 && this.counterImpulse.lengthSq() > 0) {
      this.velocity.addScaledVector(this.counterImpulse, dt / 0.14);
      if (this.counterTimer <= dt) this.counterImpulse.set(0, 0, 0);
    }

    // jerk = d(accel)/dt — the single most useful signal for feedback
    this.jerk.copy(_tmp).sub(this.prevAccel).divideScalar(Math.max(1e-5, dt));
    this.jerkMag = damp(this.jerkMag, this.jerk.length(), 0.05, dt);
    this.accel.copy(_tmp);

    return position;
  }

  reset() {
    this.velocity.set(0, 0, 0);
    this.accel.set(0, 0, 0);
    this.spool.set(0, 0, 0);
    this.counterImpulse.set(0, 0, 0);
    this.counterTimer = 0;
    this.jerkMag = 0;
  }
}
