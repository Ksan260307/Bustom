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
const _assist = new THREE.Vector3();
const _frame = new THREE.Vector3();

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
    this.dashCooldown = 0;
    this.dashFlash = 0;      // 0..1, for feedback

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
    // BOOST plates make a dash bite harder. They stack, deliberately gently.
    this.dashSpeed = (11 + stats.agility * 11) * (1 + (stats.dashBonus ?? 0));
    /**
     * The boost thruster is a fitted part, not a birthright: a machine with
     * no BOOST plate has nothing to light.
     */
    this.canBoost = (stats.boostPlates ?? 0) > 0;
    this.boosting = false;
    /** 0..1 smoothed, for the flare on the plates. */
    this.boostOutput = 0;
    /** A GRAVITY plate trades sustained flight for durability. */
    this.noFly = !!stats.noFly;
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
  /** Where the machine is aiming, which on the ground is not where it faces. */
  get aimForward() { return this.angular.aimForward; }

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
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.dashFlash = Math.max(0, this.dashFlash - dt * 4);

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
    // A gravity plate does not stop you jumping — it stops you HOVERING.
    // The lift key still fires a legged machine off the floor; what it no
    // longer does is buy back gravity and hold you up there.
    const wantsLift = input.isDown('up') && this.energy > 0.02 && !this.noFly;
    const wantsJump = input.isDown('up') && this.energy > 0.02;
    const wantsDown = input.isDown('down');
    const groundedNow = this.env.grounded;

    if (wantsJump && groundedNow > 0.6 && this.jumpCooldown <= 0 && this.stats.legs > 0) {
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
    // Decide whether the boost actually fires BEFORE billing for it: an empty
    // tank should not keep charging you for thrust you are not getting.
    const boosting = this.canBoost && input.isDown('boost') && this.energy > 0.04;
    this.boosting = boosting;
    // Lights fast, dies slowly: a thruster that snaps off looks switched, not spent.
    this.boostOutput = damp(this.boostOutput, boosting ? 1 : 0, boosting ? 0.035 : 0.09, dt);
    const burn = this.hover * 0.30 + this.inertia.thrustOutput * 0.11 + (boosting ? 0.4 : 0);
    const regen = groundedNow > 0.5 ? 0.55 : 0.10;
    this.energy = clamp01(this.energy + (regen - burn) * dt);
    this.strain = smoothstep(0.28, 0.02, this.energy);

    // ---------------------------------------------- dash
    // A dash is an impulse, not a thrust command. Routing it through the
    // spool would let the deliberately sluggish backward profile swallow a
    // backward dash entirely, and a dash you cannot feel is not a dash.
    if (input.dash && this.dashCooldown <= 0 && this.energy > 0.08) {
      _tmp.copy(input.dash.dir).applyQuaternion(this.angular.quaternion);
      if (groundedNow > 0.5) _tmp.y = 0;
      if (_tmp.lengthSq() > 1e-6) {
        // Backwards is a fraction weaker, but still unmistakably a dash.
        const back = input.dash.dir.z < -0.5 ? 0.9 : 1;
        this.inertia.applyImpulse(_tmp.normalize().multiplyScalar(this.dashSpeed * back));
        this.dashCooldown = 0.42;
        this.dashFlash = 1;
        this.energy = clamp01(this.energy - 0.12);
        input.dash = null;
      }
    }

    // ---------------------------------------------- 3. substep loop
    const sdt = dt / this.substeps;
    for (let i = 0; i < this.substeps; i++) this._substep(input, sdt, boosting, wantsLift, wantsDown);

    // ---------------------------------------------- attitude commit
    this.quaternion.copy(this.angular.quaternion);
    this.angular.applyCentripetalAssist(
      this.inertia.velocity, dt, 0.45 + this.stats.agility * 0.4, this.env.grounded > 0.5,
    );

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

    // On the ground, steering happens in a YAW-ONLY frame. Looking up must
    // not drive the machine into the dirt — and, just as importantly, looking
    // up must not lift it off the floor.
    const onGround = grounded > 0.5;
    _flat.copy(this.angular.forward); _flat.y = 0;
    if (_flat.lengthSq() < 1e-5) _flat.set(0, 0, 1); else _flat.normalize();
    // body right = worldUp x forward, for a forward already flattened
    const rightX = _flat.z;
    const rightZ = -_flat.x;

    if (onGround) {
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
    if (onGround) {
      // Rotating the spool by the FULL attitude would turn a pitched-up nose
      // into vertical thrust, so tracking a target above you would quietly
      // fly the machine off the ground. Use the yaw-only frame instead, and
      // let the deliberate vertical channel be the only source of lift.
      const sp = this.inertia.spool;
      _thrust.set(
        _flat.x * sp.z + rightX * sp.x,
        sp.y,
        _flat.z * sp.z + rightZ * sp.x,
      );
    } else {
      _thrust.copy(this.inertia.spool).applyQuaternion(this.angular.quaternion);
    }
    // Legs push against the floor: more of them means more traction, which
    // is where a walker's ground speed advantage over a hover build comes from.
    _thrust.multiplyScalar((1 + (boosting ? 0.55 : 0)) * (1 + grounded * this.grip * 0.55));

    // -------- external accelerations (bypass the mass term)
    _external.set(0, -this.world.gravity * this.gravityScale * (1 - grounded * 0.9), 0);
    _external.add(this.env.repulsion);
    // Assist is an acceleration nudge, never a position override — and on the
    // ground it is a nudge in the horizontal plane only.
    _assist.copy(this.assist.command);
    if (onGround) _assist.y = 0;
    _external.addScaledVector(_assist, 0.35);
    // Frame locking: carry a share of the reference frame's motion — but the
    // VERTICAL share only as far as our weight is off the floor. Standing on
    // the ground you are riding the ground, not the target; without this a
    // hopping enemy hands you its climb the moment you close to knife range,
    // and a ground fight quietly turns into a flight.
    if (this.space.blend > 0) {
      _frame.copy(this.space.frameVelocity);
      _frame.y *= 1 - grounded;
      _external.addScaledVector(_frame, 1.4 * this.space.blend);
    }

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
      dash: this.dashFlash,
      boost: this.boostOutput,
      canBoost: this.canBoost,
      relief: this.inertia.approachRelief ?? 0,
      impact: this.env.impactImpulse,
    };
  }
}

const _qInv = new THREE.Quaternion();
