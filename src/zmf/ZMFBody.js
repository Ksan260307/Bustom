import * as THREE from 'three';
import { clamp, clamp01, damp, smoothstep } from './math.js';
import { InertiaCore } from './InertiaCore.js';
import { VelocityLayerSystem } from './VelocityLayer.js';
import { AngularDynamics } from './AngularDynamics.js';
import { AssistController } from './AssistController.js';
import { RelativeSpaceMapper } from './RelativeSpace.js';
import { EnvironmentInterference } from './EnvInterference.js';
import { STAGGER, LANDING, DRIFT, FALL, AIR, HOVER } from '../core/constants.js';

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
/** Scratch for the body-local thrust command before it goes to world space. */
const _air = new THREE.Vector3();
const _external = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _flat = new THREE.Vector3();
const _assist = new THREE.Vector3();
const _frame = new THREE.Vector3();
const _shove = new THREE.Vector3();

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

    /**
     * How badly the machine has just been rocked, 0..1, and which way it was
     * thrown. A hit hard enough to matter takes the machine's thrust away
     * for a moment: being shot has to cost something other than a number on
     * a bar, or a fight is two machines trading damage while neither of them
     * ever notices. See STAGGER.
     */
    this.stagger = 0;
    this.staggerDir = new THREE.Vector3(0, 0, -1);
    /**
     * The last shove, in m/s, and how much of it took the machine off its
     * feet. `knockback` is what was applied; `downed` is what it cost.
     */
    this.knockback = new THREE.Vector3();
    /**
     * Off its feet: 0..1, held for as long as the machine is in the air and
     * bled off once it lands. While this is up the machine has no say in
     * anything — that is the difference between being rocked and being
     * thrown.
     */
    this.downed = 0;
    /** One-frame event: how hard it was just thrown. For the effects layer. */
    this.launched = 0;

    /**
     * A heavy machine planting itself after a drop, 0..1, decaying — and
     * the one-frame event that started it, for whoever wants to throw the
     * dust. See LANDING.
     */
    this.landing = 0;
    this.landed = 0;

    this.setStats(stats, opts.rideHeight ?? 1.0);
  }

  setStats(stats, rideHeight = this.baseRideHeight ?? this.rideHeight) {
    this.stats = stats;
    this.baseRideHeight = rideHeight;
    /**
     * A FLOAT plate holds the machine off the floor. Raising the ride height
     * is all it takes: the machine still "lands", just onto a surface that
     * is now a metre and a half up, so it hovers with its legs dangling and
     * everything else — walking, jumping, ground steering — keeps working.
     */
    this.hoverHeight = stats.hoverHeight ?? 0;
    this.rideHeight = rideHeight + this.hoverHeight;
    // A tall mech is not a big ball: keep the collision proxy close to the
    // torso so you can actually walk between the pillars.
    this.radius = Math.max(0.6, stats.extent * 0.42);
    this.inertia.setStats(stats);
    this.angular.setStats(stats);

    // Leg count sets how the machine relates to the ground.
    const legs = stats.legs;
    this.grip = legs === 0 ? 0.35 : legs === 1 ? 0.8 : legs === 2 ? 1.0 : 1.25;
    // How much a leg is worth depends on what the leg is made of. Counting
    // them and stopping there meant a machine on wire walked as well as one
    // on tree trunks, which is why bone thickness only ever cost weight.
    const drive = stats.legDrive ?? 1;
    this.jumpPower = (legs === 0 ? 6 : legs === 1 ? 15.5 : legs === 2 ? 12 : 9.5) * drive;
    this.groundSpeedCap = 8 + legs * 2.2 * drive + stats.agility * 9;
    this.airSpeedCap = 16 + stats.agility * 24;
    // BOOST plates make a dash bite harder. They stack, deliberately gently.
    // Hard and immediate. A boost you have to wait for is a boost you stop
    // using, so the impulse is big and the cooldown short.
    this.dashSpeed = (17 + stats.agility * 17) * (1 + (stats.dashBonus ?? 0));
    /**
     * The boost thruster is a fitted part, not a birthright: a machine with
     * no BOOST plate has nothing to light.
     */
    this.canBoost = (stats.boostPlates ?? 0) > 0;
    /**
     * How big the energy tank is, as a multiple of the standard one.
     *
     * Energy stays a 0..1 gauge, because that is what the read-out draws and
     * what everything else reasons about. What a tank changes is what one
     * second of flight, or one dash, COSTS as a share of it — and, in the
     * same proportion, what one second on the ground puts back.
     */
    this.energyCapacity = Math.max(1, stats.energyCapacity ?? 1);
    this.boosting = false;
    /** 0..1 smoothed, for the flare on the plates. */
    this.boostOutput = 0;
    /** A GRAVITY plate trades sustained flight for durability. */
    this.noFly = !!stats.noFly;
    this.floating = this.hoverHeight > 0;
  }

  /**
   * Put the machine back to how it comes out of the box.
   *
   * This used to leave the environment probe, the weight layers and the
   * thruster timers holding whatever the previous life ended with — so a
   * machine that respawned after dying in mid-air spent its first moments
   * on the ground believing it was still falling, and two runs of the same
   * fight could not be made to agree.
   */
  /**
   * Put the machine down, facing somewhere.
   *
   * `facing` is a direction, not a point. Everything used to spawn pointing
   * at +Z whatever corner it woke up in, so three of the four machines
   * opened a fight looking at the wall behind them.
   */
  reset(position = new THREE.Vector3(0, this.rideHeight, 0), facing = null) {
    this.position.copy(position);
    this.inertia.reset();
    this.angular.reset(facing ?? new THREE.Vector3(0, 0, 1));
    this.assist.clear();
    this.env.reset();
    this.layers.reset();
    this.space.clear();

    this.energy = 1;
    this.hover = 0;
    this.gravityScale = 1;
    this.airborneTime = 0;
    this.strain = 0;
    this.boosting = false;
    this.boostOutput = 0;
    this.dashCooldown = 0;
    this.dashFlash = 0;
    this.jumpCooldown = 0;
    this.locked = false;
    this.stagger = 0;
    this.staggerDir.set(0, 0, -1);
    this.knockback.set(0, 0, 0);
    this.downed = 0;
    this.launched = 0;
    this.landing = 0;
    this.landed = 0;
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
   * Knock the machine back along `dir`, and take its legs for a moment.
   *
   * The knock is an impulse rather than a scripted shove, so a machine hit
   * while already moving keeps what it had — being shot mid-dash throws you
   * further, which is the read a player wants from it.
   *
   * Worse never overwrites better: a second hit landing on top of the first
   * deepens the stagger, it does not reset it to whatever the newest round
   * happened to be worth.
   *
   * `power` is measured in full staggers and is NOT clamped on the way in.
   * Past 1 the blow stops rocking the machine and starts throwing it: the
   * shove grows, some of it turns upward, and the machine leaves the floor
   * with no say in anything until it lands. Capping at 1 made every heavy
   * weapon feel identical once it cleared the bar.
   *
   * @param {number} power  in full staggers; 1 is as rocked as it gets
   * @param {THREE.Vector3} dir  world direction the machine is thrown
   */
  applyStagger(power, dir) {
    if (!(power > 0)) return this;
    // Weight is what a blow has to move. The same shell knocked a
    // two-hundred-tonne siege frame exactly as far off its feet as a
    // four-tonne drone, which is the sort of thing you only notice as
    // "everything feels the same" rather than as a bug.
    const braced = power / (1 + (this.stats.weightClass ?? 0) * STAGGER.brace);
    const a = clamp01(braced);
    // Horizontal to begin with. A machine shot from above should stumble,
    // not be driven into the floor, and one shot from below should stumble
    // rather than take off — the knock is what puts it off its feet, and
    // neither of those is a thing feet do. Straight up or down leaves
    // nothing to lean on, so it goes over backwards instead.
    _shove.copy(dir).setY(0);
    if (_shove.lengthSq() < 1e-8) _shove.copy(this.forward).negate().setY(0);
    if (_shove.lengthSq() < 1e-8) _shove.set(0, 0, -1);
    _shove.normalize();
    this.staggerDir.copy(_shove);
    this.stagger = Math.max(this.stagger, a);

    // Past a full stagger the blow starts LIFTING. The vertical share is
    // what turns a shove into being thrown: the feet leave the floor, and
    // everything the machine does from here is decided by where it was
    // pointed when it was hit.
    const over = clamp01(
      (braced - STAGGER.launchAt) / (STAGGER.launchFull - STAGGER.launchAt),
    );
    this.knockback.copy(_shove).multiplyScalar(STAGGER.knockback * a + STAGGER.launchPush * over);
    if (over > 0) {
      this.knockback.y += STAGGER.launchLift * over;
      this.downed = Math.max(this.downed, over);
      this.launched = Math.max(this.launched, over);
    }
    this.inertia.applyImpulse(this.knockback);
    return this;
  }

  /**
   * The machine has just come down. Decide whether that was a landing.
   *
   * Two gates, and both of them have to be open: how hard it fell, and how
   * much machine there is to feel it. A feather dropped from a great height
   * still only lands; a tank stepping off a kerb still only steps.
   *
   * @param {number} fall  downward speed at the moment of contact, m/s
   */
  /**
   * What a landing costs in forward speed.
   *
   * A machine used to touch down at any speed and carry every bit of it
   * through, so a drop from a rooftop was a free way to cross ground — the
   * landing played and nothing about it was true. Heavy machines lose more,
   * because planting two hundred tonnes is not something you do while still
   * travelling.
   */
  _plant(fall) {
    const hard = clamp01((fall - LANDING.speed) / (LANDING.speed * 2));
    if (hard <= 0) return this;
    const keep = 1 - hard * LANDING.scrub * (0.4 + (this.stats.weightClass ?? 0) * 0.6);
    this.inertia.velocity.x *= keep;
    this.inertia.velocity.z *= keep;
    return this;
  }

  _touchdown(fall) {
    this._plant(fall);
    if (!(fall > LANDING.speed)) return 0;
    const hard = clamp01((fall - LANDING.speed) / (LANDING.hard - LANDING.speed));
    const heft = clamp01(
      ((this.stats.weightClass ?? 0) - LANDING.weight) / (LANDING.full - LANDING.weight),
    );
    // A machine that was THROWN here did not choose to land, so it arrives
    // badly however light it is: the weight gate is what tells a step down
    // from a drop, and being blown across the arena is neither.
    const amount = Math.max(hard * heft, hard * this.downed);
    if (amount < 0.02) return 0;
    this.landing = Math.max(this.landing, amount);
    this.landed = amount;
    return amount;
  }

  /**
   * @param {import('./InputManager.js').InputManager} input
   * @param {number} dt  already clamped by the caller
   */
  update(input, dt) {
    this.time += dt;
    // A stagger bleeds off on its own. Nothing clears it early: riding it
    // out is the cost of having been hit.
    if (this.stagger > 0) {
      this.stagger *= Math.exp(-dt / (STAGGER.seconds * 0.35));
      if (this.stagger < 1e-3) this.stagger = 0;
    }
    // Being thrown is not on a clock: it lasts as long as the machine is in
    // the air, and only starts wearing off once it has something to stand
    // on again. You cannot shrug it off by waiting mid-flight.
    //
    // `launched` is NOT cleared here. It is a latch the effects layer takes
    // and resets, the same way blows are: a throw resolved late in one step
    // and read at the top of the next would otherwise be wiped by the very
    // update that was supposed to hand it over.
    // Settled, not merely "the smoothed contact figure says so". `grounded`
    // takes about three steps to fall away, which is long enough for a
    // machine to lose half of being thrown before its feet have left the
    // floor — so the vertical speed has to have gone too.
    const settled = this.env.grounded > 0.5 && Math.abs(this.inertia.velocity.y) < 1.5;
    if (this.downed > 0 && settled) {
      this.downed *= Math.exp(-dt / (STAGGER.riseSeconds * 0.4));
      if (this.downed < 1e-3) this.downed = 0;
    }
    // The brace does the same, and the touchdown that caused it is an event
    // rather than a state: it lasts exactly the step it happened on.
    this.landed = 0;
    if (this.landing > 0) {
      this.landing *= Math.exp(-dt / (LANDING.seconds * 0.4));
      if (this.landing < 1e-3) this.landing = 0;
    }
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
    this.boostOutput = damp(this.boostOutput, boosting ? 1 : 0, boosting ? 0.018 : 0.09, dt);
    const burn = this.hover * 0.30 + this.inertia.thrustOutput * 0.11 + (boosting ? 0.34 : 0);
    /**
     * A thruster that is burning is not a thruster that is charging.
     *
     * Standing on the ground used to refill at 0.55 a second against a
     * maximum burn of 0.45, so ON THE GROUND THE TANK NEVER MOVED — you
     * could hold the boost down for ever and the gauge would not budge.
     * Energy was a flight-only resource that looked like a general one,
     * which is worse than not having it: the bar was on screen the whole
     * time saying nothing.
     *
     * Cutting regeneration while boosting is the whole fix. Everything else
     * keeps the old numbers: walk around and you recover quickly, which is
     * what makes spending it a decision rather than a countdown.
     */
    const regen = boosting ? 0.05 : (groundedNow > 0.5 ? 0.55 : 0.10);
    // Both sides divided by the tank: a bigger one lasts longer AND takes
    // longer to fill, which is what makes it a choice rather than a bonus.
    this.energy = clamp01(this.energy + (regen - burn) / this.energyCapacity * dt);
    this.strain = smoothstep(0.28, 0.02, this.energy);

    // ---------------------------------------------- dash
    // A dash is an impulse, not a thrust command. Routing it through the
    // spool would let the deliberately sluggish backward profile swallow a
    // backward dash entirely, and a dash you cannot feel is not a dash.
    // A dash costs no energy. Its own cooldown is what limits it, and
    // charging for it too meant a machine low on energy could neither boost
    // nor dodge — the two things you need most at exactly that moment.
    if (input.dash && this.dashCooldown <= 0) {
      _tmp.copy(input.dash.dir).applyQuaternion(this.angular.quaternion);
      if (groundedNow > 0.5) _tmp.y = 0;
      if (_tmp.lengthSq() > 1e-6) {
        // Backwards is a fraction weaker, but still unmistakably a dash.
        const back = input.dash.dir.z < -0.5 ? 0.9 : 1;
        this.inertia.applyImpulse(_tmp.normalize().multiplyScalar(this.dashSpeed * back));
        // How soon it can do that again. Weight decides: a siege frame
        // that could sidestep as often as a drone is a siege frame with no
        // weakness worth exploiting.
        this.dashCooldown = 0.26 * (1 + (this.stats.weightClass ?? 0) * 0.9);
        this.dashFlash = 1;
        input.dash = null;
      }
    }

    // ---------------------------------------------- 3. substep loop
    // The touchdown is read out of the loop rather than from either side of
    // it. `grounded` is smoothed over about three steps, so by the time it
    // has climbed high enough to say "landed" the fall it landed from is
    // long gone — the probe knows on the substep it happens, and only then.
    const sdt = dt / this.substeps;
    let fell = 0;
    for (let i = 0; i < this.substeps; i++) {
      this._substep(input, sdt, boosting, wantsLift, wantsDown);
      fell = Math.max(fell, this.env.landingSpeed);
    }
    if (fell > 0) this._touchdown(fell);

    // ---------------------------------------------- attitude commit
    this.quaternion.copy(this.angular.quaternion);
    this.angular.applyCentripetalAssist(
      this.inertia.velocity, dt, 0.45 + this.stats.agility * 0.4, this.env.grounded > 0.5,
    );

    // speed ceilings, expressed as soft drag rather than a hard clamp
    // The ceiling opens up a long way under boost: the whole point of the
    // thruster is that it takes the machine somewhere its cruise cannot.
    const cap = THREE.MathUtils.lerp(this.airSpeedCap, this.groundSpeedCap, this.env.grounded)
      * (boosting ? 2.35 : 1) * (1 + this.layers.jerk * 0.12);
    const sp = this.speed;
    if (sp > cap) {
      const over = (sp - cap) / cap;
      this.inertia.velocity.multiplyScalar(1 - clamp01(over * 3.2 * dt));
    }

    // Hovering is not skating.
    //
    // A machine off the ground has no friction, so a light hover build took
    // 2.1 seconds to come to a stop — LONGER than a two-hundred-tonne frame
    // on its feet, which is exactly backwards. Thrusters holding a machine
    // up can hold it still too, and only while nothing is being asked of
    // them, so a deliberate drift still drifts.
    if (this.hover > 0.3 && this.env.grounded < 0.5) {
      // Only while nothing is being asked of them. Under thrust this has to
      // be as close to nothing as makes no difference: at a tenth it was
      // still scrubbing 40% of a two-second climb's speed, which showed up
      // as the chassis refusing to pitch with the aim.
      const idle = this.inertia.thrustOutput < 0.15 ? 1 : 0.02;
      const hold = HOVER.hold * this.hover * idle * (1 - (this.stats.weightClass ?? 0) * 0.6);
      this.inertia.velocity.x *= 1 - clamp01(hold * dt);
      this.inertia.velocity.z *= 1 - clamp01(hold * dt);
    }

    // A fall has to read as a fall.
    //
    // The drag model is tuned for thrust, and applied to a free drop it
    // pinned the descent at 13.5 m/s — a twenty-metre machine took eight
    // seconds to come down from a rooftop and never looked like it was
    // falling. Below the cap nothing changes; past it the machine stops
    // being slowed by air it is not flying through.
    const vy = this.inertia.velocity.y;
    if (vy < -FALL.softFrom && this.env.grounded < 0.5) {
      const over = clamp01((-vy - FALL.softFrom) / (FALL.terminal - FALL.softFrom));
      this.inertia.velocity.y -= FALL.pull * over * dt;
    }

    // Somewhere with no gravity, letting go of the stick has to mean
    // something.
    //
    // Every other arena stops a machine with the floor: you come down, you
    // land, you are still. Weightless there is no floor in the way, so
    // without this a tap of the thruster is a one-way trip to the ceiling
    // and the controls stop being controls. This is the machine holding
    // itself steady — which is what a thruster does when it is not being
    // asked for anything — so it fades out the moment anything IS asked.
    if (this.world.gravity <= 0) {
      const asking = input.move.lengthSq() > 1e-4 || wantsLift || wantsDown || boosting;
      const hold = asking ? DRIFT.thrusting : DRIFT.idle;
      this.inertia.velocity.multiplyScalar(1 - clamp01(hold * dt));
    }

    return this;
  }

  /**
   * Off the ground you have thrusters, not feet.
   *
   * Air lateral authority was uncapped, so strafing while hovering reached
   * 21 m/s against 11 on the ground — flying sideways was better than
   * running sideways at everything, and the floor became a place you left
   * as soon as possible and never came back to. Cutting sideways and
   * backward push in the air leaves flight what it ought to be: better at
   * going up and over, worse at fencing.
   *
   * Applied to the SPOOL, in the machine's own axes. Doing it after the
   * command has been turned into world space would only be "sideways" while
   * the machine happened to be facing down +Z.
   *
   * @param {THREE.Vector3} sp body-local thrust command, modified in place
   */
  _airCut(sp, grounded) {
    if (grounded >= 0.5) return sp;
    const keep = 1 - (1 - grounded) * AIR.lateral;
    sp.x *= keep;
    if (sp.z < 0) sp.z *= keep;
    return sp;
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
      const sp = _air.copy(this.inertia.spool);
      this._airCut(sp, grounded);
      _thrust.set(
        _flat.x * sp.z + rightX * sp.x,
        sp.y,
        _flat.z * sp.z + rightZ * sp.x,
      );
    } else {
      _thrust.copy(_air.copy(this.inertia.spool));
      this._airCut(_thrust, grounded);
      _thrust.applyQuaternion(this.angular.quaternion);
    }
    // Legs push against the floor: more of them means more traction, which
    // is where a walker's ground speed advantage over a hover build comes from.
    _thrust.multiplyScalar((1 + (boosting ? 1.05 : 0)) * (1 + grounded * this.grip * 0.55));
    // Rocked machines do not drive. The thrust goes, not the velocity: a
    // machine staggered at speed keeps sliding, which is what being knocked
    // off your feet looks like from outside.
    if (this.stagger > 0) _thrust.multiplyScalar(1 - this.stagger * STAGGER.authority);
    // Thrown clean off its feet, the machine has nothing to push against
    // and nothing to say about where it is going.
    if (this.downed > 0) _thrust.multiplyScalar(1 - this.downed);

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
      energyCapacity: this.energyCapacity,
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
      stagger: this.stagger,
      downed: this.downed,
      landing: this.landing,
    };
  }
}

const _qInv = new THREE.Quaternion();
