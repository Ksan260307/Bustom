import * as THREE from 'three';
import { clamp, clamp01, damp, smoothstep } from './math.js';
import { InertiaCore } from './InertiaCore.js';
import { VelocityLayerSystem } from './VelocityLayer.js';
import { AngularDynamics } from './AngularDynamics.js';
import { AssistController } from './AssistController.js';
import { RelativeSpaceMapper } from './RelativeSpace.js';
import { EnvironmentInterference } from './EnvInterference.js';

// ============================================================
//  ZMF §9 : the update flow, assembled.
//
//    1. input acquisition        (InputManager, upstream)
//    2. target computation       (AssistController)
//    3. substep loop
//         position update        (velocity Verlet)
//         environment            (probe + intent-aware repulsion)
//         physics prediction     (ABC mass, spool, counter-boost, drag, frame lock)
//         attitude               (bank damping, auto-horizon)
//    4. camera / reference frames (caller)
//    5. feedback sync             (caller)
// ============================================================

const _worldCmd = new THREE.Vector3();
const _thrust = new THREE.Vector3();
const _external = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _flat = new THREE.Vector3();

export class ZMFBody {
  constructor(stats, world, opts = {}) {
    this.world = world;
    this.position = new THREE.Vector3(0, 0, 0);
    this.quaternion = new THREE.Quaternion();

    this.inertia = new InertiaCore(stats);
    this.layers = new VelocityLayerSystem('B');
    this.angular = new AngularDynamics(stats);
    this.assist = new AssistController();
    this.space = new RelativeSpaceMapper();
    this.env = new EnvironmentInterference(world);

    this.substeps = 3;
    this.time = 0;

    /** Energy: spent on flight and boost, recovered on the ground. */
    this.energy = 1;
    this.strain = 0;
    this.gravityScale = 1;
    this.hover = 0;         // 0..1, how committed we are to flight
    this.airborneTime = 0;
    this.jumpCooldown = 0;

    this.locked = false;
    this.target = null;

    this.setStats(stats, opts.rideHeight ?? 1.0);
  }

  setStats(stats, rideHeight = this.rideHeight) {
    this.stats = stats;
    this.rideHeight = rideHeight;
    // A tall mech is not a big ball: keep the collision proxy close to the
    // torso so you can actually walk between the pillars.
    this.radius = Math.max(0.6, stats.extent * 0.42);
    this.inertia.setStats(stats);
    this.angular.setStats(stats);

    // Leg count sets how the machine relates to the ground.
    const legs = stats.legs;
    this.grip = legs === 0 ? 0.35 : legs === 1 ? 0.8 : legs === 2 ? 1.0 : 1.25;
    this.jumpPower = legs === 0 ? 6 : legs === 1 ? 15.5 : legs === 2 ? 12 : 9.5;
    this.groundSpeedCap = 8 + legs * 2.2 + stats.agility * 9;
    this.airSpeedCap = 16 + stats.agility * 24;
  }

  reset(position = new THREE.Vector3(0, this.rideHeight, 0)) {
    this.position.copy(position);
    this.inertia.reset();
    this.angular.reset(new THREE.Vector3(0, 0, 1));
    this.assist.clear();
    this.energy = 1;
    this.hover = 0;
    this.gravityScale = 1;
    this.airborneTime = 0;
  }

  get velocity() { return this.inertia.velocity; }
  get speed() { return this.inertia.velocity.length(); }
  get grounded() { return this.env.grounded; }
  get forward() { return this.angular.forward; }

  setTarget(t) {
    if (t !== this.target) this.assist.estimator.reset();
    this.target = t;
  }

  /**
   * @param {import('./InputManager.js').InputManager} input
   * @param {number} dt  already clamped by the caller
   */
  update(input, dt) {
    this.time += dt;
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);

    // ---------------------------------------------- 1. layer selection
    if (input.wasPressed('layerA')) this.layers.set('A');
    if (input.wasPressed('layerB')) this.layers.set('B');
    if (input.wasPressed('layerC')) this.layers.set('C');

    // ---------------------------------------------- 2. target computation
    const targetInfo = this.locked && this.target
      ? { position: this.target.position, radius: this.target.radius ?? 1.6 }
      : null;

    // Soft override keys off the AIM stick, not the thrust stick. Sliding
    // sideways should not drop the lock; deliberately looking away should.
    const override = Math.min(1, (input.lookMagnitude ?? 0) * 1.6);
    this.assist.update(this.position, this.velocity, targetInfo, override, this.time, dt);

    // ---------------------------------------------- reference frames
    this.space.update(this.position, dt);

    // ---------------------------------------------- flight commitment
    const wantsLift = input.isDown('up') && this.energy > 0.02;
    const wantsDown = input.isDown('down');
    const groundedNow = this.env.grounded;

    if (wantsLift && groundedNow > 0.6 && this.jumpCooldown <= 0 && this.stats.legs > 0) {
      // A legged machine leaves the ground by pushing, not by thrusting.
      this.inertia.velocity.y = Math.max(this.inertia.velocity.y, this.jumpPower);
      this.jumpCooldown = 0.22;
      this.justJumped = true;
    }

    // "Fabricated" gravity: committing to flight buys most of it back.
    // This is the whole reason air and ground can both feel good at once.
    const hoverTarget = wantsLift ? 1 : 0;
    this.hover = damp(this.hover, hoverTarget, wantsLift ? 0.09 : 0.30, dt);
    this.gravityScale = 1 - this.hover * 0.86;

    this.airborneTime = groundedNow > 0.5 ? 0 : this.airborneTime + dt;

    // ---------------------------------------------- energy
    const burn = this.hover * 0.30 + this.inertia.thrustOutput * 0.11
      + (input.isDown('boost') ? 0.4 : 0);
    const regen = groundedNow > 0.5 ? 0.55 : 0.10;
    this.energy = clamp01(this.energy + (regen - burn) * dt);
    this.strain = smoothstep(0.28, 0.02, this.energy);

    const boosting = input.isDown('boost') && this.energy > 0.04;

    // ---------------------------------------------- 3. substep loop
    const sdt = dt / this.substeps;
    for (let i = 0; i < this.substeps; i++) this._substep(input, sdt, boosting, wantsLift, wantsDown);

    // ---------------------------------------------- attitude commit
    this.quaternion.copy(this.angular.quaternion);
    this.angular.applyCentripetalAssist(this.inertia.velocity, dt, 0.45 + this.stats.agility * 0.4);

    // speed ceilings, expressed as soft drag rather than a hard clamp
    const cap = THREE.MathUtils.lerp(this.airSpeedCap, this.groundSpeedCap, this.env.grounded)
      * (boosting ? 1.55 : 1) * (1 + this.layers.jerk * 0.12);
    const sp = this.speed;
    if (sp > cap) {
      const over = (sp - cap) / cap;
      this.inertia.velocity.multiplyScalar(1 - clamp01(over * 3.2 * dt));
    }

    return this;
  }

  _substep(input, dt, boosting, wantsLift, wantsDown) {
    this.layers.update(dt);

    // -------- environment probe (resolves the previous step, feeds this one)
    _worldCmd.copy(input.move).applyQuaternion(this.angular.quaternion);
    this.env.probe(this.position, this.inertia.velocity, _worldCmd, this.radius, this.rideHeight, dt);
    const grounded = this.env.grounded;

    // -------- build the thrust command in body-local space
    _tmp.copy(input.move);
    if (boosting) _tmp.z = Math.max(_tmp.z, 0.35) * 1.6;
    if (input.dash) _tmp.addScaledVector(input.dash.dir, 1.1);

    // On the ground, steering happens in the horizontal plane: looking up
    // must not drive the machine into the dirt.
    if (grounded > 0.5) {
      _flat.copy(this.angular.forward); _flat.y = 0;
      if (_flat.lengthSq() < 1e-5) _flat.set(0, 0, 1); else _flat.normalize();
      // body right = worldUp x forward, for a forward already flattened to the plane
      const rightX = _flat.z, rightZ = -_flat.x;
      _worldCmd.set(
        _flat.x * _tmp.z + rightX * _tmp.x,
        0,
        _flat.z * _tmp.z + rightZ * _tmp.x,
      );
      _tmp.set(_tmp.x, 0, _tmp.z);
    } else {
      _worldCmd.copy(_tmp).applyQuaternion(this.angular.quaternion);
    }

    // Vertical channel is always world-aligned; nobody wants to fly
    // "up" into the floor because the nose was pitched down.
    const lift = (wantsLift ? 1 : 0) - (wantsDown ? 1 : 0);

    // -------- §3.2 opposing-thruster boost, on the world command
    if (_worldCmd.lengthSq() > 0.04) {
      _tmp.copy(_worldCmd).normalize();
      this.inertia.tryCounterBoost(_tmp, dt);
    } else {
      this.inertia.tryCounterBoost(_tmp.set(0, 0, 0), dt);
    }

    // -------- §3.2 directional spool (body-local, so profiles mean something)
    _tmp.copy(_worldCmd).applyQuaternion(_qInv.copy(this.angular.quaternion).invert());
    _tmp.y = lift;
    this.inertia.spoolTo(_tmp, dt, this.layers.jerk * this.layers.jerkBoost);

    // -------- world-space thrust
    _thrust.copy(this.inertia.spool).applyQuaternion(this.angular.quaternion);
    if (grounded > 0.5) {
      // keep ground thrust in-plane, and let legs do the vertical work
      _thrust.y = Math.max(_thrust.y, this.inertia.spool.y);
    }
    // Legs push against the floor: more of them means more traction, which
    // is where a walker's ground speed advantage over a hover build comes from.
    _thrust.multiplyScalar((1 + (boosting ? 0.55 : 0)) * (1 + grounded * this.grip * 0.55));

    // -------- external accelerations (bypass the mass term)
    _external.set(0, -this.world.gravity * this.gravityScale * (1 - grounded * 0.9), 0);
    _external.add(this.env.repulsion);
    // Assist is an acceleration nudge, never a position override.
    _external.addScaledVector(this.assist.command, 0.35);
    // Frame locking: carry a share of the reference frame's motion.
    if (this.space.blend > 0) _external.addScaledVector(this.space.frameVelocity, 1.4 * this.space.blend);

    // -------- §3.1 velocity Verlet with distance-sensitive drag
    this.inertia.integrate(this.position, _thrust, _external, dt, {
      layerMass: this.layers.mass,
      viscosity: this.layers.viscosity * (1 + grounded * 0.2),
      closingRate: this.assist.closingRate,
      range: this.assist.hasTarget ? this.assist.range : NaN,
    });

    this.env.applyGroundFriction(this.inertia.velocity, input.intensity, this.grip, dt);

    // -------- attitude
    this.angular.update({
      look: input.look,
      aimPoint: this.assist.hasTarget ? this.assist.aimPoint : null,
      assistAuthority: this.assist.hasTarget ? this.assist.authority : 0,
      position: this.position,
      velocity: this.inertia.velocity,
      accel: this.inertia.accel,
      layerTurn: this.layers.turn,
      grounded,
    }, dt);
  }

  /** Everything the HUD and the feedback layer want, in one object. */
  telemetry() {
    return {
      speed: this.speed,
      thrust: this.inertia.thrustOutput,
      jerk: this.inertia.jerkMag,
      zeta: this.inertia.zeta,
      mass: this.inertia.baseMass * this.layers.mass,
      layer: this.layers.layer,
      energy: this.energy,
      strain: this.strain,
      grounded: this.env.grounded,
      airborne: this.airborneTime,
      bank: this.angular.bank,
      turnRate: this.angular.turnRate,
      assist: this.assist.authority,
      range: this.assist.range,
      closing: this.assist.closingRate,
      frameLock: this.space.blend,
      relief: this.inertia.approachRelief ?? 0,
      impact: this.env.impactImpulse,
    };
  }
}

const _qInv = new THREE.Quaternion();
