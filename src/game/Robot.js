import * as THREE from 'three';
import { Rig } from '../core/Rig.js';
import { computeStats } from '../core/Assembly.js';
import { ZMFBody } from '../zmf/ZMFBody.js';
import { Animator } from '../anim/Animator.js';
import { clamp01, damp, lerp as lerpN } from '../zmf/math.js';
import { STAGGER } from '../core/constants.js';
import { WeaponSystem } from './Weapons.js';

// ============================================================
//  Robot : assembly -> rig -> ZMF body -> animator, in one object.
// ============================================================

const _v = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _flat = new THREE.Vector3();
const _knock = new THREE.Vector3();
const _wear = new THREE.Vector3();
const _face = new THREE.Vector3();

/** How near a round has to land to count as hitting a joint, in metres. */
const WEAR_REACH = 2.2;
/** A joint never seizes completely, however much it is shot. */
const WEAR_CAP = 0.8;

/**
 * How much fatter the hit column is than an equal-volume cylinder.
 *
 * The material is not spread evenly up the machine: the legs are thin and
 * the body is not, so averaging the whole solid volume over the whole height
 * understates the part anyone is actually aiming at. This puts the width
 * back where the body is.
 *
 * Measured at 1.3: a standard two-legged machine — four metres across the
 * shoulders — was a column 0.91m in radius. A round passing 1.1m from its
 * centre went through the middle of the silhouette on screen and counted as
 * a miss, which is most of the reason rounds felt like they did not connect.
 * At 1.9 the best round of a burst still passed 1.50m out against a 1.33m
 * column, which is a miss by seventeen centimetres on a machine four metres
 * wide.
 *
 * The cap below still holds it to the machine's own narrower horizontal
 * width, so this cannot make anything wider than it looks — it can only
 * stop it being far thinner.
 */
const HIT_COLUMN_SPREAD = 2.4;

/**
 * How an opponent behaves, in one place.
 *
 * Every one of these is meant to be VISIBLE from the outside. A player who
 * watches a machine for ten seconds should be able to say what it does when
 * it is reloading and what it does when it is hurt — and then use it.
 */
const AI = {
  /** How squarely it has to be facing you before it fires. */
  facing: 0.55,
  /** Below this much health it stops trading and backs off. */
  hurtAt: 0.35,
  /** How much further away it wants to be while hurt, and while reloading. */
  hurtBackoff: 1.7,
  reloadBackoff: 1.5,
  /** Reach for a weapon that has no range of its own to speak of. */
  contactReach: 4,
  /** How far ahead it looks for a round with its name on it, in seconds. */
  seeAhead: 0.55,
  /** How near that round has to pass before it is worth dodging, in metres. */
  dodgeWithin: 3.5,

  /**
   * Fire discipline: seconds on the trigger, then seconds off it.
   *
   * Not a difficulty knob dressed up as one. Three machines holding their
   * triggers down put out more than anyone can answer, and worse, they put
   * it out CONSTANTLY — there is no moment in it to move, so the only thing
   * left to do is trade. The gap is where the game is: it is when you close,
   * when you break cover, when you line one up.
   *
   * And it has to be legible. A machine that stops firing and backs off is
   * telling you something you can use.
   */
  burst: [0.7, 1.6],
  rest: [1.0, 2.2],
  /** How much longer the gaps are at the gentlest setting. */
  restEase: 2.1,
  /**
   * The one that leads every fifth wave: longer bursts, and it CLOSES on
   * its reload instead of backing off it. Toughness alone made the same
   * fight last longer; this makes it a different fight.
   */
  aceBurst: 1.6,
  aceClose: 0.72,
};

/**
 * The hit flash: how hard the machine lights up when something lands on it.
 *
 * A hit that only moves a number on a bar is a hit nobody feels. This is
 * the cheapest honest answer — the machine itself reacts — and it scales
 * with the blow, so a gatling stipples and a magnum whites the thing out.
 *
 * `share` is the damage, as a fraction of the machine's own durability,
 * that lights it fully. Deliberately the same figure a stagger starts at:
 * a blow big enough to rock the machine is a blow big enough to see.
 */
const HIT_FLASH = {
  share: 0.34,
  /** Seconds to fall to about a third. Short: this is a flash, not a glow. */
  decay: 0.07,
  /**
   * Where it stops.
   *
   * Measured on screen rather than picked: the tone mapping saturates a
   * long way below 1, and anything past this is a white blob with no
   * machine left in it. At the cap the silhouette, the panel lines and the
   * plates are all still there — it just looks like it has been hit very
   * hard, which is the entire brief.
   */
  cap: 0.45,
  /** What it looks like when it is us, and when it is somebody else. */
  mine: 0xff6a5c,
  theirs: 0xfff0d0,
};

export class Robot {
  /**
   * @param {import('../core/Assembly.js').Assembly} assembly
   * @param {import('./World.js').World} world
   */
  constructor(assembly, world, opts = {}) {
    this.assembly = assembly;
    this.world = world;
    this.isPlayer = !!opts.isPlayer;
    this.name = opts.name ?? assembly.name;
    /** The fight's replayable number stream, when it has one. */
    this.random = opts.random ?? null;

    /**
     * How often this machine's limbs are re-posed, in simulation steps.
     *
     * Posing a machine is the most expensive thing done per machine per
     * step, and a machine forty metres away gains nothing from a fresh
     * pose sixty times a second. Note what this is derived FROM: the
     * distance between two machines, which is part of the fight. It is
     * never derived from frame time or from where the camera happens to
     * be pointed, because both of those differ between one run and the
     * next — and the posed limbs decide where a shot leaves the barrel, so
     * anything that changes them changes the fight.
     */
    this.poseInterval = 1;
    this._poseCountdown = 0;

    this.rig = new Rig(assembly);
    this.stats = computeStats(assembly, this.rig);

    this.object3D = new THREE.Group();
    this.object3D.add(this.rig.root);

    const rideHeight = Math.max(0.35, -this.rig.restLowestY);
    this.body = new ZMFBody(this.stats, world, { rideHeight });
    this.animator = new Animator(this.rig, this.stats);

    // Durability follows the core and the machine's weight, then whatever
    // the plates add to it.
    this.maxHp = Math.round(this.stats.durability * (1 + (this.stats.hpBonus ?? 0)));
    this.hp = this.maxHp;
    this.weapons = new WeaponSystem(this);
    this.alive = true;
    /**
     * Set by the arena once it has thrown the wreck, so one death produces
     * one wreck however many frames it takes to be noticed. It has to be
     * cleared when the machine comes back — carried into the next life it
     * makes the next death silent: no wreck, no shake, and nothing told to
     * whatever is keeping score.
     */
    this.wrecked = false;
    /** The barrier a SHIELD plate puts up, while it lasts. */
    this.shield = null;
    /** How hard this machine's shots land. One unless a run says otherwise. */
    this.damageScale = 1;
    /** How much it was hurt this frame, 0..1 of its own hull. For the bones. */
    this.hurtThisFrame = 0;
    /**
     * Damage this machine has taken in the last moment, kept just long
     * enough for a volley to land as one blow. See `_takeShock`.
     */
    this.shock = 0;
    /** How brightly the machine is lit by whatever just hit it, 0..1-ish. */
    this.hitFlash = 0;
    /**
     * Blows taken since anyone last looked, for the read-out to turn into
     * marks. Drained by the field; capped, because a shotgun at point blank
     * is one event to the player however many pellets it was.
     */
    this.blows = [];
    this.radius = Math.max(1.0, this.stats.extent * 0.8);
    this._measureHitVolume();

    this._buildThrusterFx();
    this.body.reset(new THREE.Vector3(opts.x ?? 0, rideHeight, opts.z ?? 0));
    this.syncTransform();
  }

  get position() { return this.body.position; }
  get velocity() { return this.body.velocity; }

  /**
   * The standing column a round has to actually cross to hit this machine.
   *
   * `radius` — half the bounding diagonal — is the right figure for the
   * coarse questions: how far to stand off, how wide a blast reaches, when
   * two machines are in contact. It is the wrong one for a bullet. A seven
   * metre walker measures three and a half, so anything passing three
   * metres wide of it counted as a hit, and no amount of dodging could
   * change that.
   *
   * So a bullet is answered with a column instead: as tall as the machine
   * is TALL, and as thick as the machine has SUBSTANCE to be — the width of
   * a cylinder that would hold the same amount of solid material over the
   * same height. Measuring the bounding box instead reads whatever is
   * sticking out of it, so bolting a gun barrel onto each shoulder would
   * double the width of a machine that had not gained an inch of body.
   */
  _measureHitVolume() {
    const b = this.rig.bounds;
    const height = Math.max(0.2, b.max.y - b.min.y);
    const solid = Math.max(0.05, this.stats.solidVolume ?? 0.5);
    // Never wider than the machine itself, however dense it is. Measured
    // across the NARROWER of the two horizontal axes, so a machine is not
    // easier to hit from the side it happens to be broadest on.
    const widest = Math.max(0.35, Math.min(b.max.x - b.min.x, b.max.z - b.min.z) * 0.5);
    this.hitRadius = Math.min(widest, Math.max(0.35, Math.sqrt(solid / (Math.PI * height)) * HIT_COLUMN_SPREAD));
    // The column runs the height of the machine, its own caps taken off the
    // ends so a capsule is not taller than the thing it stands for.
    const top = b.max.y - this.hitRadius;
    const bottom = b.min.y + this.hitRadius;
    this.hitOffsetY = (top + bottom) / 2;
    this.hitHalfHeight = Math.max(0, (top - bottom) / 2);
  }

  _buildThrusterFx() {
    // Sized off the machine, and mounted behind it — a plume that swallows
    // the silhouette tells the player nothing.
    const k = Math.max(0.5, this.stats.extent * 0.24);
    this.fxScale = k;

    const geo = new THREE.ConeGeometry(0.22 * k, 1.5 * k, 10, 1, true);
    geo.translate(0, -0.75 * k, 0);
    geo.rotateX(Math.PI / 2);   // plume points along -Z
    const mat = new THREE.MeshBasicMaterial({
      color: 0x8fdcff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const plume = new THREE.Mesh(geo, mat);
    plume.position.set(0, 0, -0.55 * k);
    plume.frustumCulled = false;
    this.rig.root.add(plume);
    this.plume = plume;

    // There used to be a soft radial sprite here as well, sitting on the
    // machine's origin. It read as "the core block is glowing", which is not
    // what a thruster does — and now that BOOST plates throw their own flame,
    // a second nondescript bloom in the middle of the chassis only muddied
    // which parts were actually doing something. The plume is the exhaust.
  }

  setTarget(robot) {
    this.lockTarget = robot;
    this.body.setTarget(robot ? { position: robot.position, radius: robot.radius, velocity: robot.velocity } : null);
  }

  setLocked(on) {
    this.body.locked = on && !!this.lockTarget;
    if (this.body.locked && this.lockTarget) {
      this.body.setTarget({ position: this.lockTarget.position, radius: this.lockTarget.radius });
    }
  }

  update(input, dt) {
    if (!this.alive) return;
    if (this.shock > 0) {
      this.shock *= Math.exp(-dt / STAGGER.memory);
      if (this.shock < 1e-4) this.shock = 0;
    }
    if (this.lockTarget) {
      // keep the tracked handle pointing at live data
      this.body.target = { position: this.lockTarget.position, radius: this.lockTarget.radius };
    }
    this.body.update(input, dt);
    this.syncTransform();

    // Skipped steps are folded into the next one, so a machine posed every
    // third step still swings its legs at the right speed.
    this._poseSkipped = (this._poseSkipped ?? 0) + dt;
    if (--this._poseCountdown <= 0) {
      this._animate(this._poseSkipped);
      this._poseSkipped = 0;
      this._poseCountdown = Math.max(1, this.poseInterval | 0);
    }
    this._updateFx(dt);

    // World transforms are refreshed HERE, once, after the machine is posed
    // and before anything reads it. Everything downstream — where a muzzle
    // is, where a blade reaches, what the debris copies — used to force its
    // own full traversal of ~200 objects, several times per machine per
    // frame, all recomputing the same matrices.
    this.object3D.updateMatrixWorld(true);

    // Feet last, on fresh transforms. Only for machines posed every step:
    // one that is far enough away to pose every third step is far enough
    // away that nobody can see where its feet are.
    if (this.poseInterval <= 1 && this.body.env?.world?.surfaceAt) {
      this._surface ??= (x, z, y) => this.body.env.world.surfaceAt(x, z, y);
      this.animator.plantFeet(this._surface, this.body.env.grounded, dt);
    }
  }

  /** Bring world transforms up to date if nothing has this step. */
  refreshTransforms() {
    this.object3D.updateMatrixWorld(true);
    return this;
  }

  syncTransform() {
    this.object3D.position.copy(this.body.position);
    this.object3D.quaternion.copy(this.body.quaternion);
  }

  _animate(dt) {
    const b = this.body;
    _v.copy(b.velocity); _v.y = 0;

    let aimDir = null;
    if (b.locked && b.assist.hasTarget) {
      aimDir = _aim.copy(b.assist.aimPoint).sub(b.position);
      if (aimDir.lengthSq() > 1e-4) aimDir.normalize(); else aimDir = null;
    }

    this.animator.update({
      dt,
      speed: b.speed,
      planarSpeed: _v.length(),
      grounded: b.env.grounded,
      airborne: b.airborneTime,
      velocity: b.velocity,
      bodyQ: this.object3D.quaternion,
      aimDir,
      locked: b.locked ? 1 : 0,
      thrust: b.inertia.thrustOutput,
      jerk: b.inertia.jerkMag,
      stagger: b.stagger,
      staggerDir: b.staggerDir,
      downed: b.downed,
      landing: b.landing,
      dashSpeed: b.dashSpeed,
      walkCap: b.groundSpeedCap,
      /** Giving ground with a target held: the legs skate, they do not walk. */
      retreat: b.retreat ?? 0,
      // What the machine is DOING, as opposed to where it is going. None of
      // this used to reach the animator, so no bone could react to a fight.
      boost: b.boostOutput,
      hp: this.maxHp > 0 ? this.hp / this.maxHp : 1,
      energy: b.energy,
      activeWeapon: this.weapons.active?.type ?? null,
      fired: this.weapons.firedThisFrame,
      hurt: this.hurtThisFrame,
    });
    // Read once and cleared: these are instants, and an instant that stays
    // true for two frames is a bone that fires twice for one event.
    this.weapons.firedThisFrame = false;
    this.hurtThisFrame = 0;

    this.rig.updateRollers(dt);

    // Bob and lean are visual carriage only — the physics body never moves.
    this.rig.root.position.set(0, this.animator.bodyBob, 0);
    this.rig.root.rotation.set(this.animator.bodyLean.x, 0, this.animator.bodyLean.y);
  }

  _updateFx(dt) {
    // The boost flame belongs to the plates that produce it, not to the
    // machine's general exhaust.
    this.rig.setBoostGlow(this.body.boostOutput ?? 0, Math.sin(this.body.time * 47) * 0.5 + 0.5);

    if (this.hitFlash > 0) {
      this.hitFlash *= Math.exp(-dt / HIT_FLASH.decay);
      if (this.hitFlash < 1e-3) this.hitFlash = 0;
    }
    // Red for our own machine, hot white for anyone else's: which of those
    // two things just happened is the single most useful bit on the screen.
    this.rig.setHitFlash(this.hitFlash, this.isPlayer ? HIT_FLASH.mine : HIT_FLASH.theirs);

    const out = this.body.inertia.thrustOutput;
    const fwd = Math.max(0, this.body.inertia.spool.z);
    const amt = clamp01(out * 0.6 + fwd * 0.9);
    this.plume.material.opacity = damp(this.plume.material.opacity, amt * 0.42, 0.05, dt);
    this.plume.scale.set(0.7 + amt * 0.4, 0.7 + amt * 0.4, 0.6 + amt * 1.4);
  }

  /** Reload every magazine and drop the blades. Used on respawn. */
  rearm() { this.weapons.reset(); return this; }

  /**
   * Plant the machine while a beam is lit.
   *
   * The body knows nothing about weapons and should not — it is the layer
   * underneath them. So the robot, which owns both, tells it.
   */
  syncBrace(dt) {
    const want = this.weapons?.beaming ? 1 : 0;
    const b = this.body;
    if (!b) return this;
    // On quickly and off slowly: a brace that let go the instant the
    // trigger came up would snap the nose round at exactly the moment the
    // player is looking to see whether the shot landed.
    const rate = want > b.bracing ? 14 : 4;
    b.bracing += (want - b.bracing) * Math.min(1, rate * dt);
    return this;
  }

  /**
   * Scale how much punishment this machine takes before it comes apart.
   *
   * Always measured against the durability it was BUILT with, never against
   * whatever it was set to last time: applied to the current figure, a
   * machine reused across ten waves would end up ten multipliers tough.
   */
  /**
   * How hard this machine's shots land, as a multiplier.
   *
   * Only ever moved for opponents, and only by a run's difficulty. The
   * player's stays at one: a setting is meant to say what you are up
   * against, not to quietly re-tune the guns you built.
   */
  setDamageScale(scale = 1) {
    this.damageScale = Math.max(0, scale);
    return this;
  }

  setToughness(scale = 1) {
    this.baseMaxHp = this.baseMaxHp ?? this.maxHp;
    this.maxHp = Math.max(1, Math.round(this.baseMaxHp * scale));
    this.hp = Math.min(this.hp, this.maxHp);
    return this;
  }

  damage(n, from = null) {
    if (!this.alive) return;
    // Remembered for one frame so a bone can flinch. Measured against this
    // machine's own hull, so a graze on a siege frame is a graze.
    if (n > 0 && this.maxHp > 0) {
      this.hurtThisFrame = Math.max(this.hurtThisFrame, Math.min(1, (n / this.maxHp) * 6));
    }
    // A raised barrier takes the hit first, and only what it cannot absorb
    // reaches the machine. It breaks when it runs out rather than lingering
    // at zero, so "the shield is up" always means it is doing something.
    if (this.shield && n > 0) {
      const taken = Math.min(this.shield.hp, n);
      this.shield.hp -= taken;
      n -= taken;
      if (this.shield.hp <= 0) this.shield = null;
      if (n <= 0) return;
    }
    this.hp = Math.max(0, this.hp - n);
    // The flash goes on whether or not the blow was heavy enough to rock
    // the machine: a light round still has to LOOK like it connected, or
    // held fire reads as firing into thin air.
    this.hitFlash = Math.min(
      HIT_FLASH.cap, this.hitFlash + n / Math.max(1, this.maxHp * HIT_FLASH.share),
    );
    // Lit HERE, not on the next step's effects pass. Damage is resolved
    // after every machine has already been posed, so leaving it to the pass
    // that decays it put the flash one frame behind the round that caused
    // it — and one frame is the whole of it.
    this.rig.setHitFlash(this.hitFlash, this.isPlayer ? HIT_FLASH.mine : HIT_FLASH.theirs);
    if (this.blows.length < 8) {
      this.blows.push({ damage: n, from: from ? from.clone() : null, fatal: this.hp <= 0 });
    }
    if (this.hp > 0) this._takeShock(n, from);
    this._wearJoint(n, from);
    if (this.hp <= 0) {
      this.alive = false;
      // The wreck is produced by the caller, which owns the debris pool; all
      // this has to do is stop being a machine.
      this.object3D.visible = false;
      this.shield = null;
      this.weapons.reset();
      this.rig.setBoostGlow?.(0);
      this.rig.setBladeGlow?.(0);
    }
  }

  /**
   * Damage remembered for a moment, and turned into a stagger once enough
   * of it has landed at once.
   *
   * Accumulated rather than judged shot by shot, because a shotgun arrives
   * as nine pellets and ought to land as one blow — nine separate hits, none
   * of them individually heavy, would rock the machine not at all. The
   * memory is short, so a stream of small rounds settles well below the
   * threshold: held fire is meant to whittle a machine down, not to hold it
   * still while it happens.
   *
   * Measured against this machine's own durability, so the same round folds
   * a light frame and barely troubles a heavy one.
   */
  _takeShock(n, from = null) {
    if (!(n > 0)) return 0;
    this.shock += n;
    const gate = this.maxHp * STAGGER.threshold;
    if (this.shock < gate) return 0;
    // Measured in full staggers, and NOT clamped: past 1 the body turns the
    // surplus into lift and throws the machine instead of rocking it. A cap
    // here made a magnum and a sniper round through the chest feel the same.
    const power = (this.shock - gate) / (this.maxHp * STAGGER.span);
    this.shock = 0;                       // spent on this one
    this.stagger(power, from);
    return power;
  }

  /**
   * Rock the machine away from `from` — the point the blow came from, if
   * anything knows it.
   *
   * Away from, not along the round's own line: what the player has to read
   * off the screen is which side they were hit from, and the shove that
   * says so is the one pointing out of the impact.
   */
  stagger(power, from = null) {
    if (!this.alive || !(power > 0)) return this;
    if (from) _knock.copy(this.position).sub(from);
    else _knock.copy(this.body.forward).negate();
    if (_knock.lengthSq() < 1e-8) _knock.copy(this.body.forward).negate();
    this.body.applyStagger(power, _knock);
    return this;
  }

  /**
   * Mark the joint a round landed on.
   *
   * Bones have always had a hitbox and it has always meant nothing: a leg
   * could be shot to pieces and the machine walked exactly as it had. A worn
   * joint drives less hard and travels less far, so "aim for the legs" is
   * finally a thing a player can do on purpose.
   *
   * Nearest joint to the impact, within a bone's length or so. A round into
   * the middle of the torso wears nothing, which is right — that is armour,
   * and armour is what hit points are for.
   */
  _wearJoint(n, from) {
    if (!from || !(n > 0) || this.maxHp <= 0) return this;
    const joints = this.rig?.joints;
    if (!joints?.length) return this;
    let best = null;
    let bestD = WEAR_REACH * WEAR_REACH;
    for (const node of joints) {
      const d = node.joint.getWorldPosition(_wear).distanceToSquared(from);
      if (d < bestD) { bestD = d; best = node; }
    }
    if (!best) return this;
    // Capped short of seized: a joint that stops entirely reads as a broken
    // game rather than as a damaged machine.
    best.wear = Math.min(WEAR_CAP, (best.wear ?? 0) + (n / this.maxHp) * 2.4);
    return this;
  }

  /**
   * Put it back together at `position`, whole and reloaded.
   *
   * @param {THREE.Vector3} position
   * @param {THREE.Vector3|null} [facing] which way to look; a direction
   */
  revive(position, facing = null) {
    for (const node of this.rig?.joints ?? []) node.wear = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.wrecked = false;
    this.shock = 0;
    this.hitFlash = 0;
    this.blows.length = 0;
    this.rig.setHitFlash(0);
    this.object3D.visible = true;
    /**
     * Face the middle, unless told otherwise.
     *
     * Every arena in this game is centred on the origin, so "the middle" is
     * a fact rather than a parameter. Without this every machine woke up
     * pointing at +Z whichever corner it was standing in, and three of the
     * four opened a fight looking at the wall behind them.
     */
    const at = position ?? this.position;
    this.body.reset(
      position ?? this.position.clone(),
      facing ?? _face.set(-at.x, 0, -at.z),
    );
    this.rearm();
    // Stand it up straight again. Nothing about the life it just lost
    // should follow it into the next one.
    this.animator.reset();
    this._poseCountdown = 0;
    this._poseSkipped = 0;
    this.poseInterval = 1;
    this.syncTransform();
    this.object3D.updateMatrixWorld(true);
    return this;
  }

  dispose() {
    this.rig.dispose();
    this.object3D.removeFromParent();
  }
}

// ============================================================
//  SyntheticInput : quacks like InputManager, driven by code.
// ============================================================

export class SyntheticInput {
  constructor() {
    this.move = new THREE.Vector3();
    this.look = { yaw: 0, pitch: 0 };
    this.intensity = 0;
    this.dash = null;
    this.held = new Set();
    this.justPressed = new Set();
  }

  /** Normalised 0..1 deflection, matching InputManager's contract. */
  get lookMagnitude() { return Math.min(1, Math.hypot(this.look.yaw, this.look.pitch) / 6); }
  hold(a, on) { if (on) this.held.add(a); else this.held.delete(a); }
  press(a) { this.justPressed.add(a); this.held.add(a); }
  isDown(a) { return this.held.has(a); }
  wasPressed(a) { return this.justPressed.has(a); }
  endFrame() { this.justPressed.clear(); }
}

// ============================================================
//  A deliberately readable opponent: orbit, close, break, repeat.
//  Its job is to give the assist controller something worth predicting.
// ============================================================

/**
 * How a machine uses its guns, as distinct from where it stands.
 *
 * Four opponents that differ only in preferred range are one opponent seen
 * from four distances: the shooting is identical, so nothing about them has
 * to be learned separately. A habit is a rule the player can WATCH and
 * answer — and each of these is one line of gate on the same trigger.
 *
 *   steady  fires whenever it is facing you and you are in reach
 *   closer  will not fire until it is right on top of you
 *   salvo   winds up long, then empties for a long time
 *   peak    only at the top of its hop, when it is not climbing or falling
 */
export const HABITS = {
  steady: {},
  /** Comes in first. Its answer to being shot at on the way is to keep coming. */
  closer: { within: 1.15 },
  /** Long gaps, long bursts. Get behind something or take all of it. */
  salvo: { burst: 2.1, rest: 1.5 },
  /** Fires at the top, so its rhythm is visible from across the arena. */
  peak: { atPeak: 3.5 },
};

export class SimpleAI {
  constructor(robot, opts = {}) {
    this.robot = robot;
    this.input = new SyntheticInput();
    this.random = robot.random ?? null;
    this.preferredRange = opts.range ?? 26;
    this.style = opts.style ?? 'orbit';   // orbit | rusher | flyer
    /** How it shoots, as opposed to where it stands. See HABITS. */
    this.habit = HABITS[opts.habit] ? opts.habit : 'steady';
    /**
     * The one that leads every fifth wave.
     *
     * It used to be an ordinary machine with 2.4x the hit points, which
     * makes the same fight last longer rather than making it a different
     * fight. Toughness is the weakest axis there is. What this one has
     * instead is a habit worth reading: it does NOT give you the free
     * window every other machine gives you while it reloads — it uses that
     * time to close.
     */
    this.ace = !!opts.ace;
    /**
     * How hard it presses, 0..1. Only the GAPS between bursts move with it.
     *
     * Not its damage and not its aim — a wave that hits softer teaches the
     * wrong lesson about what a round costs, and one that misses on purpose
     * teaches nothing at all. What an early wave gives you is TIME: room to
     * move between bursts, and a run that ramps by taking that room away.
     */
    this.aggression = clamp01(opts.aggression ?? 1);
    // Drawn once and kept, so restarting the match puts this machine back
    // into the same rhythm it started with rather than a new one.
    this.startT = this.random ? this.random.unit() * 10 : 0;
    this.startPhase = this.random ? this.random.unit() * Math.PI * 2 : 0;
    this.reset();
  }

  /** Back to the state it was built in. */
  reset() {
    this.t = this.startT;
    this.phase = this.startPhase;
    this.jinkTimer = 0;
    this.jinkDir = 1;
    this.burstTimer = 0;
    this.firing = false;
    this.aiming = false;
    this.input.move.set(0, 0, 0);
    this.input.intensity = 0;
    return this;
  }

  /**
   * @param {THREE.Vector3} playerPos
   * @param {number} dt
   * @param {object} [ctx] the arena's shared things: what it shoots WITH,
   *   what it can hit, and what draws the result. Without them the machine
   *   still manoeuvres — it just cannot pull a trigger, which is exactly
   *   what it did for the whole of this game's life so far.
   */
  update(playerPos, dt, ctx = null) {
    const r = this.robot;
    const inp = this.input;
    this.t += dt;

    _v.copy(playerPos).sub(r.position);
    const range = _v.length();
    _v.y = 0;
    // Reused rather than cloned: this runs for every machine, every step.
    const flat = _flat.copy(_v);
    if (flat.lengthSq() > 1e-4) flat.normalize(); else flat.set(0, 0, 1);

    // face roughly toward the player
    const fwd = r.body.forward;
    const cross = fwd.x * flat.z - fwd.z * flat.x;
    inp.look.yaw = THREE.MathUtils.clamp(-cross * 2.4, -1, 1) * 2.6;   // rad/s
    inp.look.pitch = 0;

    // approach / retreat along the range error, strafe for the rest
    this.jinkTimer -= dt;
    if (this.jinkTimer <= 0) {
      const rng = this.random;
      this.jinkTimer = rng ? rng.range(0.7, 2.1) : 1.4;
      this.jinkDir = rng ? rng.sign() : 1;
    }

    // Two habits on top of the orbit, both meant to be LEARNABLE rather
    // than clever. A player has to be able to see what a machine is doing
    // and answer it; an opponent that surprises you at random is not
    // difficulty, it is noise.
    //
    //   reloading  -> back off while it is defenceless
    //   hurt       -> back off, and mean it
    const reloading = r.weapons.active?.reloadT > 0 || this.firing === false;
    const hurt = r.hp < r.maxHp * AI.hurtAt;
    // The ace closes on its reload instead of backing off it. Every other
    // machine hands you a window there; this one turns the window into the
    // reason it is suddenly much nearer than it was.
    const backoff = this.ace ? AI.aceClose : AI.reloadBackoff;
    const wants = this.preferredRange * (reloading ? backoff : 1)
      * (hurt && !this.ace ? AI.hurtBackoff : 1);

    const err = (range - wants) / Math.max(1, wants);
    const drive = THREE.MathUtils.clamp(err * 1.6, -1, 1);
    const strafe = this.jinkDir * (0.55 + Math.sin(this.t * 1.7 + this.phase) * 0.45);

    inp.move.set(strafe, 0, drive);
    inp.intensity = Math.min(1, inp.move.length());

    // A round with its name on it. The player's own answer to being shot
    // at is to dash sideways, and an opponent that never does it is an
    // opponent that has not been taught the game it is in.
    if (this._threatened(ctx)) {
      inp.dash = { dir: new THREE.Vector3(this.jinkDir, 0, 0), t: this.t };
    }

    inp.hold('up', false);
    if (this.style === 'flyer') {
      inp.hold('up', r.position.y < 16 || Math.sin(this.t * 0.6) > 0.2);
    } else if (this.style === 'rusher') {
      inp.hold('boost', range > this.preferredRange * 1.4);
      if (Math.sin(this.t * 1.1) > 0.94) inp.press('up');
    } else if (Math.sin(this.t * 0.9 + this.phase) > 0.93) {
      inp.press('up');
    }

    r.update(inp, dt);
    this._shoot(ctx, range, flat, dt);
    inp.endFrame();
  }

  /**
   * Pull the trigger, if there is anything to pull it at.
   *
   * The rule is deliberately blunt: face the target, be inside the reach of
   * whatever is in hand, and fire. It does not lead, it does not pick its
   * moment — the WEAPON leads (see `WeaponSystem.muzzle`) and the weapon
   * decides how fast it can go off again.
   *
   * What makes it fair is the same thing that makes the player's shots
   * fair: the rounds are slow, the lock aims short of the intercept, and a
   * machine that keeps moving is missed. Being shot at is what all of that
   * was built for.
   */
  _shoot(ctx, range, toTarget, dt) {
    const r = this.robot;
    if (!ctx?.projectiles || !r.weapons.hasWeapons || !r.alive) return;
    // Free play can switch the shooting off: trying out a walk cycle while
    // being shot at is two jobs at once. Everything else about the machine
    // carries on — it still closes, still circles, still takes cover.
    if (ctx.enemyFire === false) { this.firing = false; this.aiming = false; return; }
    const target = ctx.target;
    if (!target?.alive) return;

    // Facing it, roughly. A machine that fires over its shoulder while
    // running away reads as a bug however correct the maths is.
    const facing = r.body.forward.dot(toTarget);
    const reach = this._reach();
    const habit = HABITS[this.habit] ?? HABITS.steady;

    // Where the habit gates the trigger. Each of these is something a
    // player can see happening and answer, rather than a hidden number.
    let allowed = range < reach;
    // A machine that will not shoot until it is on top of you: crossing the
    // ground between you is its whole plan, and interrupting that is yours.
    if (allowed && habit.within) allowed = range < this.preferredRange * habit.within;
    // And one that only fires at the top of its arc, so its rhythm can be
    // read from the other side of the arena.
    if (allowed && habit.atPeak) allowed = Math.abs(r.body.velocity.y) < habit.atPeak;
    const able = facing > AI.facing && allowed;

    // On the trigger, then off it. See AI.burst.
    this.burstTimer -= dt;
    if (this.burstTimer <= 0) {
      this.firing = !this.firing;
      const [lo, hi] = this.firing ? AI.burst : AI.rest;
      const ease = this.firing ? 1 : lerpN(AI.restEase, 1, this.aggression);
      // A long wind-up and a long burst is a different problem from a
      // steady patter, even at the same rounds per minute.
      const shape = this.firing
        ? (habit.burst ?? 1) * (this.ace ? AI.aceBurst : 1)
        : (habit.rest ?? 1) * (this.ace ? 1 / AI.aceBurst : 1);
      this.burstTimer = (this.random ? this.random.range(lo, hi) : (lo + hi) / 2) * ease * shape;
    }
    const firing = able && this.firing;
    /** True while this machine is actually shooting at you — the HUD reads it. */
    this.aiming = firing;

    r.syncBrace?.(dt);
    r.weapons.update({
      firing,
      aimPoint: target.position,
      lockTarget: target,
      projectiles: ctx.projectiles,
      targets: ctx.targets ?? [target],
      effects: ctx.effects ?? null,
      feedback: ctx.feedback ?? null,
    }, dt);
  }

  /**
   * Is a round about to arrive?
   *
   * Only the ones actually pointed here: the closest approach of where the
   * round is going over the next half second, against where this machine
   * is. A machine that dodged everything in flight would twitch constantly
   * and read as broken; one that dodges what is aimed at it reads as
   * paying attention.
   *
   * Deliberately without prediction of its own movement. It is answering
   * "that one is going to hit me", which is the same thing the player sees.
   */
  _threatened(ctx) {
    const pool = ctx?.projectiles?.pool;
    if (!pool || this.robot.body.dashCooldown > 0) return false;
    const me = this.robot.position;
    for (const s of pool) {
      if (s.life <= 0 || !s.owner || s.owner === this.robot) continue;
      if (s.owner.isPlayer === this.robot.isPlayer) continue;
      _v.copy(s.mesh.position).sub(me);
      const closing = -_v.dot(s.velocity) / Math.max(1e-3, s.velocity.lengthSq());
      if (closing <= 0 || closing > AI.seeAhead) continue;
      // Where it will be at its nearest, and how near that is.
      _flat.copy(s.mesh.position).addScaledVector(s.velocity, closing);
      if (_flat.distanceTo(me) < AI.dodgeWithin + this.robot.hitRadius) return true;
    }
    return false;
  }

  /** How far the weapon in hand actually carries, in metres. */
  _reach() {
    const meta = this.robot.weapons.active?.meta;
    if (!meta) return 0;
    if (meta.beam) return meta.beam.range;
    if (meta.dps) return (meta.reach ?? 1.4) + this.robot.radius + 2;
    if (!meta.speed) return AI.contactReach;
    return meta.speed * (meta.life ?? 1);
  }
}
