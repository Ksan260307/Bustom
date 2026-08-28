import * as THREE from 'three';
import { clamp, clamp01, damp, smoothstep } from './math.js';

// ============================================================
//  ZMF §5.2 / §6 : Environment Interference
//    priority-evaluated proximity probes,
//    intent-aware (input-projected) repulsion,
//    rebound-triggered break-away.
//
//  The rule: pushing INTO a surface makes it slippery, pulling AWAY
//  from it makes it launch you. The wall reads your intent.
// ============================================================

const _closest = new THREE.Vector3();
const _n = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class EnvironmentInterference {
  constructor(world) {
    this.world = world;
    this.repulsion = new THREE.Vector3();
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.grounded = 0;
    this.landingSpeed = 0;         // smoothed 0..1
    this.groundY = 0;
    this.contact = null;       // nearest non-ground contact
    this.slideFactor = 0;      // 0..1, how much we are grazing a surface
    this.impactImpulse = 0;    // set on a hard hit, consumed by feedback

    this.config = {
      probeMargin: 0.85,
      repulsionGain: 62,
      slidingRelief: 0.22,   // repulsion multiplier while pushing into a wall
      escapeAmplify: 2.35,   // repulsion multiplier while pulling away
      restitution: 0.34,
    };
  }

  /**
   * @param {THREE.Vector3} position
   * @param {THREE.Vector3} velocity  mutated on contact (sliding / rebound)
   * @param {THREE.Vector3} inputDir  world-space desired travel direction (may be zero)
   * @param {number} radius           collision radius of the machine
   * @param {number} rideHeight       distance from the body origin down to the feet
   */
  /** Forget what was underneath and beside the machine. */
  reset() {
    this.repulsion.set(0, 0, 0);
    this.groundNormal.set(0, 1, 0);
    this.grounded = 0;
    this.groundY = 0;
    this.contact = null;
    this.slideFactor = 0;
    this.impactImpulse = 0;
    return this;
  }

  probe(position, velocity, inputDir, radius, rideHeight, dt) {
    this.repulsion.set(0, 0, 0);
    this.impactImpulse = 0;
    this.landingSpeed = 0;

    // -------------------------------------------------- support surface
    // The floor, or the top of whatever box we happen to be standing over.
    // Without this, pillar tops and platforms are solid but never "ground",
    // so the legs keep running their airborne pose while you stand on them.
    let groundY = this.world.groundHeight(position.x, position.z);
    const foot = radius * 0.55;
    const feetY = position.y - rideHeight;
    for (const box of this.world.colliders) {
      if (position.x < box.min.x - foot || position.x > box.max.x + foot) continue;
      if (position.z < box.min.z - foot || position.z > box.max.z + foot) continue;
      if (box.max.y > groundY && box.max.y <= feetY + 0.75) groundY = box.max.y;
    }
    this.groundY = groundY;
    const feet = position.y - rideHeight;
    const gap = feet - groundY;

    let groundedNow = 0;
    if (gap <= 0.02) {
      groundedNow = 1;
      if (gap < 0) {
        position.y = groundY + rideHeight;
      }
      if (velocity.y < 0) {
        // How fast it was coming down at the moment of contact, before the
        // bounce takes it away. This is the only substep on which that
        // number exists: the next one has already had its fall cancelled.
        this.landingSpeed = -velocity.y;
        if (velocity.y < -9) this.impactImpulse = Math.min(1, -velocity.y / 34);
        velocity.y *= -this.config.restitution * smoothstep(2, 14, -velocity.y);
        if (Math.abs(velocity.y) < 0.6) velocity.y = 0;
      }
    } else if (gap < 0.9) {
      groundedNow = 1 - smoothstep(0.02, 0.9, gap);
    }
    this.grounded = damp(this.grounded, groundedNow, 0.05, dt);

    // -------------------------------------------------- obstacles
    // Priority evaluation: the deepest overlap wins the frame. Summing every
    // contact makes corners fire the machine off in random directions.
    let deepest = null;
    let deepestPen = 0;
    const reach = radius + this.config.probeMargin;

    for (const box of this.world.colliders) {
      // Anything we are already standing on top of is handled by the support
      // pass above; pushing sideways off it as well would fling us off ledges.
      if (box.max.y <= feet + 0.2) continue;
      box.clampPoint(position, _closest);
      const d = _closest.distanceTo(position);
      if (d >= reach) continue;
      const pen = reach - d;
      if (pen > deepestPen) {
        deepestPen = pen;
        if (d > 1e-4) _n.copy(position).sub(_closest).divideScalar(d);
        else _n.set(0, 1, 0);
        deepest = { normal: _n.clone(), penetration: pen, distance: d, box };
      }
    }

    this.contact = deepest;
    this.slideFactor = damp(this.slideFactor, deepest ? clamp01(deepestPen / reach) : 0, 0.07, dt);

    if (deepest) {
      const n = deepest.normal;
      const approach = -velocity.dot(n);           // >0 while closing on the surface

      // --- input projection: does the player want to be here?
      let intent = 1;
      if (inputDir.lengthSq() > 0.04) {
        const align = _tmp.copy(inputDir).normalize().dot(n);
        // align < 0 : pushing into the wall  -> relieve, let them slide
        // align > 0 : pulling away           -> amplify, kick them clear
        intent = align < 0
          ? THREE.MathUtils.lerp(1, this.config.slidingRelief, clamp01(-align))
          : THREE.MathUtils.lerp(1, this.config.escapeAmplify, clamp01(align));
      }

      const depth = clamp01(deepest.penetration / reach);
      const mag = this.config.repulsionGain * depth * depth * intent
        + Math.max(0, approach) * 5.5 * depth * intent;
      this.repulsion.addScaledVector(n, mag);

      // Hard contact: kill the into-surface component so we glide instead of grinding.
      if (deepest.distance < radius) {
        position.addScaledVector(n, radius - deepest.distance);
        if (approach > 0) {
          velocity.addScaledVector(n, approach * (1 + this.config.restitution));
          if (approach > 10) this.impactImpulse = Math.max(this.impactImpulse, clamp01(approach / 34));
        }
      }
    }

    // -------------------------------------------------- arena bounds
    const r = this.world.arenaRadius;
    const dist = Math.hypot(position.x, position.z);
    if (dist > r - radius) {
      _n.set(-position.x, 0, -position.z).normalize();
      const pen = dist - (r - radius);
      this.repulsion.addScaledVector(_n, clamp(pen, 0, 6) * 34);
      const approach = -velocity.dot(_n);
      if (approach > 0) velocity.addScaledVector(_n, approach * 1.2);
      if (dist > r) {
        const k = (r - radius) / dist;
        position.x *= k; position.z *= k;
      }
    }

    const ceiling = this.world.ceiling;
    if (position.y > ceiling - radius) {
      const pen = position.y - (ceiling - radius);
      this.repulsion.y -= pen * 34;
      if (velocity.y > 0) velocity.y *= -0.2;
    }

    return this;
  }

  /**
   * Ground friction, applied only through the horizontal plane, and scaled
   * down while the player is actively driving so it never feels like glue.
   */
  applyGroundFriction(velocity, inputIntensity, gripScalar, dt) {
    if (this.grounded < 0.05) return;
    const mu = (2.4 - inputIntensity * 1.9) * gripScalar * this.grounded;
    const k = Math.pow(2, -dt * mu);
    velocity.x *= k;
    velocity.z *= k;
  }
}
