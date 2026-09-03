import * as THREE from 'three';
import { World } from './World.js';
import { DEFAULT_ARENA, getArena } from './Arenas.js';
import { Robot, SimpleAI, HABITS } from './Robot.js';
import { Projectiles } from './Weapons.js';
import { Debris } from './Debris.js';
import { Effects } from './Effects.js';
import { Hud } from './Hud.js';
import { PostFX } from './PostFX.js';
import { Random, seedFromClock } from '../core/Random.js';
import { CameraDynamics } from '../zmf/CameraDynamics.js';
import { PRESETS } from '../core/Assembly.js';
import { clamp01 } from '../zmf/math.js';

// ============================================================
//  Debug field : flat plane, one player machine, three opponents.
//  This is the harness the motion model is tuned against.
// ============================================================

/** Wheel deltaY is ~100 per notch; this makes a notch about 13% of distance. */
const ZOOM_PER_WHEEL_UNIT = 0.0013;

const _v = new THREE.Vector3();
const _corner = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _cross = new THREE.Vector3();
const _screenDir = new THREE.Vector2();
/** Reused by `_machines`: this runs for every machine, every step. */
const _machines = [];
const _threats = [];

/** Below this, a machine is shuffling rather than running. */
const DUST_MIN_SPEED = 3.5;
/** One puff per this many metres of ground covered. */
const DUST_EVERY_METRES = 1.6;

/** Seconds between read-out redraws. Output only; never affects the fight. */
const HUD_INTERVAL = 1 / 30;

/**
 * How long it takes to get a lock, in seconds.
 *
 * Short enough that it never feels like a wait, long enough that switching
 * targets in the middle of a fight is a decision with a price.
 */
const LOCK_TIME = 0.35;

/**
 * The actions that take the three offers between waves.
 *
 * The same keys that pick a movement layer in a fight, borrowed for the
 * three seconds when there is no fight — so nothing new has to be found in
 * the key settings, and rebinding one rebinds both.
 */
const OFFER_KEYS = ['layerA', 'layerB', 'layerC'];

/** The practice field's three, and the corners they stand in. */
const REGULARS = [
  { preset: 'biped', x: 24, z: 18, style: 'orbit', range: 24 },
  { preset: 'multileg', x: -28, z: 6, style: 'rusher', range: 16 },
  { preset: 'hopper', x: 6, z: -32, style: 'flyer', range: 30 },
];

/** Distances, in metres, at which a machine's limbs are posed less often. */
const POSE_NEAR = 26;
const POSE_FAR = 55;

export class FieldScene {
  constructor({ renderer, hudCanvas, input, feedback, post = null }) {
    this.renderer = renderer;
    this.input = input;
    this.feedback = feedback;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
    this.world = new World(this.scene, renderer, DEFAULT_ARENA);
    /**
     * Whether the opponents shoot back.
     *
     * Free play is where a machine gets tried out, and trying out a walk
     * cycle while being shot at is two jobs at once. Under a set of rules
     * this is not on offer — a run where nothing shoots is not a run.
     */
    this.enemyFire = true;
    this.cameraRig = new CameraDynamics(this.camera);
    this.hud = new Hud(hudCanvas);
    /** Shared with the editors when the app supplies one. */
    this.post = post ?? new PostFX(renderer);
    this._ownsPost = !post;

    /**
     * The opponents ON THE FIELD right now, wrecks included until they are
     * cleared away. This is what everything else reads: the read-out, the
     * lock, the hit tests.
     */
    this.enemies = [];
    /** Nobody is on the field until a machine is loaded onto it. */
    this.player = null;
    /** Which of the four corners the player starts from. */
    this.playerCorner = 0;
    /**
     * Machines that have been built and are waiting to be used again.
     *
     * A rig is new geometry and new materials, so throwing one away at the
     * end of a wave and building its twin at the head of the next is a
     * visible hitch for no gain. Parked here, the same handful of machines
     * carries a run of forty waves.
     */
    this.retired = [];
    this.ais = [];
    /**
     * The rules of the current run, or null for the free-play arena.
     *
     * With no rules in charge the field is what it has always been: three
     * opponents that come straight back, forever, which is the right thing
     * for trying a machine out. With rules in charge the field stops
     * deciding who comes back and simply reports what happened.
     */
    this.director = null;
    this.lock = null;
    this.tracers = [];
    this.fireCooldown = 0;
    /** Decaying kick from landing a shot, folded into the feedback bus. */
    this.hitPulse = 0;
    /**
     * Two streams, deliberately. `random` decides anything the fight
     * depends on — where a machine dodges, where a pellet goes — so a match
     * is reproducible from its seed. `visualRandom` decides sparks and
     * screen jitter, and is kept apart so that drawing more debris on a
     * faster machine cannot nudge a bullet.
     */
    this.seed = seedFromClock();
    this.random = new Random(this.seed);
    this.visualRandom = new Random(this.seed ^ 0x5bf03635);
    /** Real time owed to the read-out, which redraws on its own slower beat. */
    this.hudBank = 0;
    this.shieldBubbles = new Map();
    this.time = 0;
    this.active = false;
    this.paused = false;

    this._buildTracerPool();
    this.projectiles = new Projectiles(this.scene, this.world);
    this.debris = new Debris(this.scene, this.world, { random: this.visualRandom });
    /**
     * Sparks, flashes, dust and the blots under the machines. Drawn from
     * the same presentation stream as the wreckage, for the same reason.
     */
    this.effects = new Effects(this.scene, this.world, { random: this.visualRandom });
    /**
     * Metres run since each machine last kicked up dust (see `_groundDust`).
     * Weak, because a machine that has been thrown away must not be kept
     * alive by the dust it once raised.
     */
    this._dustBank = new WeakMap();
    /** Machines waiting to be put back together: { robot, at }. */
    this.pendingRespawns = [];
    /** A lock being reached for, but not yet made. */
    this.locking = null;
  }

  /** Seconds a wreck lies on the field before the machine comes back. */
  static get RESPAWN_DELAY() { return 2.6; }

  // ---------------------------------------------------------- lifecycle

  load(assembly) {
    // The wreckage borrows the rig's geometry, so it cannot outlive the rig.
    this.debris.clear();
    this.effects.clear();
    // Anything queued against the machine we are about to throw away is not
    // coming back; everything else is flushed by the respawn below.
    this.pendingRespawns = this.pendingRespawns.filter((j) => j.robot !== this.player);
    if (this.player) { this.scene.remove(this.player.object3D); this.player.dispose(); }
    this.player = new Robot(assembly.clone(), this.world, {
      isPlayer: true, random: this.random,
    });
    this.scene.add(this.player.object3D);
    this.cameraRig.fitTo(this.player.stats, this.player.rig.restHeight);
    this.input.profile.massSensitivityScale = 1 / (1 + this.player.stats.weightClass * 0.5);
    this.respawn();
    if (!this.director && !this.enemies.length) this._spawnEnemies();
    return this;
  }

  // ---------------------------------------------------------- who is on the field

  /**
   * Hand the field over to a set of rules, or take it back.
   *
   * Passing null puts it back the way the debug arena wants it: the three
   * regulars, respawning forever.
   */
  /**
   * Move the fight to a different place.
   *
   * The arena decides gravity, so this has to reach the machines: they hold
   * a reference to the world and read `gravity` every step, which means a
   * swap takes effect on the next frame with nothing else to do.
   *
   * @param {string} arenaId
   */
  setArena(arenaId) {
    if (arenaId === this.world.arenaId) return this;
    this.world.setArena(arenaId);
    // Cover, wrecks and rounds all belonged to the old place.
    this.projectiles.clear();
    this.debris.clear();
    this.effects.clear();
    // The place can be chosen before there is a machine to put in it — the
    // app restores the saved arena as part of entering the field, which
    // happens either side of the machine being loaded depending on how the
    // field was reached.
    if (!this.player) return this;
    this.respawn();
    for (const e of this.enemies) {
      if (e.wrecked) continue;
      e.revive(this._enemySpawn(e));
    }
    return this;
  }

  /** Which place this is, and what it is like. */
  get arena() { return getArena(this.world.arenaId); }

  /** Whether the opponents shoot back. Only free play may turn this off. */
  setEnemyFire(on) {
    this.enemyFire = !!on || !!this.director;
    return this;
  }

  setDirector(director) {
    this.director = director ?? null;
    this.retireEnemies();
    if (director) {
      director.begin();
      return this;
    }
    // Free play: the standing three, built once and then put back on their
    // feet. Building them again on every visit would leak a rig a time.
    if (!this.enemies.length) this._spawnEnemies();
    for (const e of this.enemies) {
      e.setToughness(1);
      e.revive(this.player ? this._enemySpawn(e) : null);
    }
    return this;
  }

  /** Take every opponent off the field, keeping the machines for reuse. */
  retireEnemies() {
    this.pendingRespawns = this.pendingRespawns.filter((j) => j.robot === this.player);
    for (const e of this.enemies) {
      e.alive = false;
      // Marked as already dealt with, not as freshly dead: taking a machine
      // off the field is not a kill, and must not throw a wreck or put a
      // point on anybody's score.
      e.wrecked = true;
      e.object3D.visible = false;
      e.shield = null;
      this.retired.push(e);
    }
    this.enemies.length = 0;
    if (this.lock && !this.lock.robot.alive) {
      this.lock = null;
      this.player.setTarget(null);
      this.player.setLocked(false);
    }
    return this;
  }

  /**
   * Put one opponent on the field and hand it back.
   *
   * A retired machine of the same build is reused rather than rebuilt.
   * Building a rig means new geometry and new materials, and doing that for
   * six machines at the head of every wave is a visible hitch at exactly
   * the moment the player is being asked to fight.
   */
  spawnEnemy({
    preset = 'biped', style = 'orbit', range = 24, toughness = 1,
    aggression = 1, habit = 'steady', ace = false, at = null, hitting = 1,
  } = {}) {
    const shelved = this.retired.findIndex((e) => e.presetKey === preset);
    let bot = shelved >= 0 ? this.retired.splice(shelved, 1)[0] : null;
    if (!bot) {
      const asm = PRESETS[preset].build();
      asm.name = `EN-${preset.toUpperCase()}`;
      bot = new Robot(asm, this.world, { name: asm.name, random: this.random });
      // Tagged with what it was built from, so the next wave can reuse it
      // rather than build a second machine of exactly the same kind.
      bot.presetKey = preset;
      this.scene.add(bot.object3D);
      this.ais.push(new SimpleAI(bot, { style, range, aggression, habit, ace }));
    }
    this.enemies.push(bot);
    const ai = this.ais.find((a) => a.robot === bot);
    if (ai) {
      ai.style = style;
      ai.preferredRange = range;
      ai.aggression = clamp01(aggression);
      ai.habit = HABITS[habit] ? habit : 'steady';
      ai.ace = !!ace;
      ai.reset();
    }

    bot.setToughness(toughness);
    // What it can take, and what it does to you, move together: a run that
    // only made opponents harder to kill would make the fight longer
    // without making it harder.
    bot.setDamageScale(hitting);
    bot.revive(at ?? this._enemySpawn(bot));
    bot.hp = bot.maxHp;
    return bot;
  }

  /** The regulars of the practice field, at their usual corners. */
  _spawnEnemies() {
    for (const spec of REGULARS) {
      // Placed rather than scattered: the corner each of them stands in is
      // part of what makes the practice field the same place every time, so
      // it must not come out of the fight's number stream.
      const bot = this.spawnEnemy({ ...spec, at: _corner.set(spec.x, 2, spec.z) });
      bot.body.reset(
        new THREE.Vector3(spec.x, Math.max(0.5, -bot.rig.restLowestY), spec.z),
        // Facing in, like everything else that stands up in this arena.
        new THREE.Vector3(-spec.x, 0, -spec.z),
      );
      bot.syncTransform();
    }
  }

  /**
   * Start the match over from a known point.
   *
   * `respawn` only puts the player back; the other machines keep whatever
   * damage and position they had. That is right for dying mid-fight and
   * wrong for anything that needs a known starting point — a replay, or a
   * test that has to run the same match twice. This resets everything the
   * fight is made of, including the number stream, so the same seed really
   * does give the same match.
   */
  restart(seed = this.seed) {
    this.seed = seed >>> 0;
    this.random.reseed(this.seed);
    this.visualRandom.reseed(this.seed ^ 0x5bf03635);
    this.time = 0;
    this.hitPulse = 0;
    this.hudBank = 0;
    this.pendingRespawns.length = 0;
    this.fireCooldown = 0;
    // Put the tracers out, but keep the pool: it is built once, and
    // emptying the array leaves the built-in gun with nothing to draw with.
    for (const t of this.tracers) { t.life = 0; t.line.visible = false; }
    this.input.clearState?.();

    this.locking = null;
    // Cover that was shot away comes back. A match starts from the arena as
    // it is drawn, or the same seed gives two different fights.
    this.world.resetCover?.();

    this.respawn();
    if (this.director) {
      // Under a set of rules the roster is theirs to decide; putting the
      // last wave back on the field would fight whatever they do next.
      this.retireEnemies();
      this.director.begin();
    } else {
      for (const e of this.enemies) {
        e.wrecked = false;
        e.revive(this._enemySpawn(e));
        e.poseInterval = 1;
      }
    }
    for (const ai of this.ais) ai.reset?.();
    return this;
  }

  respawn() {
    const h = Math.max(0.35, -this.player.rig.restLowestY);
    this.projectiles.clear();
    this.debris.clear();
    this.effects.clear();
    this._flushRespawns();
    this.player.wrecked = false;
    // A corner, and a different one each time: coming back to exactly the
    // spot you were shot in is how a bad position becomes a habit.
    this.playerCorner = (this.playerCorner + 1) % 4;
    this.player.revive(this.cornerSpawn(this.playerCorner, h + 0.2));
    // A respawn is a fresh view: whatever the player had the boom swung to,
    // they are looking at a new fight now. Their zoom is a preference, so it stays.
    this.cameraRig.recenter();
    this.cameraRig.snap(this.player.position, this.player.body.forward);
    this.lock = null;
    this.player.setTarget(null);
    this.player.setLocked(false);
  }

  enter() {
    this.active = true;
    this.input.setEnabled(true);
    this.hud.visible = true;
  }

  exit() {
    this.active = false;
    this.paused = false;
    // Leaving the field takes the barriers with it, the way it takes the
    // debris: nothing that belongs to a fight should survive it.
    for (const b of this.shieldBubbles.values()) b.visible = false;
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.feedback.suspend();
    this.hud.ctx.clearRect(0, 0, this.hud.w, this.hud.h);
  }

  /**
   * Paused freezes the simulation but keeps rendering, so the pause menu sits
   * over a still frame of the fight rather than a black screen.
   */
  setPaused(on) {
    this.paused = !!on;
    this.input.setEnabled(!this.paused);
    if (this.paused) this.feedback.suspend();
    return this.paused;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hud.resize(w, h);
    // Only if it is ours: the app sizes the shared one itself, and doing it
    // twice is harmless but tells the next reader the wrong thing about who
    // owns it.
    if (this._ownsPost) this.post.setSize(w, h);
  }

  // ---------------------------------------------------------- lock-on

  /**
   * The nearest opponent, wherever it happens to be.
   *
   * It used to score by how squarely the CAMERA was facing something and
   * refuse anything more than a fifth of a turn off screen or past two
   * hundred metres — so pressing lock while looking the wrong way found
   * nothing at all, and which machine you got depended on where the boom
   * had drifted rather than on where the machines were. Nearest is a rule
   * anybody can predict, and the arrows are there to disagree with it.
   */
  _pickTarget(cycle = false) {
    let best = null;
    let bestD = Infinity;
    const current = this.lock?.robot ?? this.locking?.robot;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (cycle && e === current) continue;
      const d = e.position.distanceTo(this.player.position);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /** Every live opponent, in the order they appear across the screen. */
  _targetsAcross() {
    const out = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      _v.copy(e.position).project(this.camera);
      // Behind the camera comes back mirrored, so those go to the ends
      // rather than into the middle of the row.
      out.push({ e, x: _v.z > 1 ? Math.sign(_v.x) * 1e3 : _v.x });
    }
    out.sort((a, b) => a.x - b.x);
    return out.map((r) => r.e);
  }

  /**
   * Move the lock one opponent to the left or to the right.
   *
   * Across the SCREEN, not around the machine: left means the one that
   * looks left of this one, which is the only ordering the player can see.
   */
  shiftLock(dir) {
    const list = this._targetsAcross();
    if (!list.length) return null;
    const cur = this.lock?.robot ?? this.locking?.robot;
    const at = cur ? list.indexOf(cur) : -1;
    const next = at < 0
      ? list[dir > 0 ? 0 : list.length - 1]
      : list[(at + dir + list.length) % list.length];
    if (!next || next === cur) return null;
    this._beginLock(next);
    return next;
  }

  /**
   * The wave break, and what it is for.
   *
   * Number keys rather than a bound action: this is a menu that exists for
   * three seconds between waves, like the one on the title screen, not a
   * control anybody should have to find in the key settings.
   */
  _updateOffer() {
    const offer = this.director?.offer;
    if (!offer) return;
    const inp = this.input;
    for (let i = 0; i < offer.choices.length && i < OFFER_KEYS.length; i++) {
      const action = OFFER_KEYS[i];
      if (!inp.wasPressed?.(action)) continue;
      // The menu swallows the key. 1, 2 and 3 pick a movement layer during a
      // fight, and there is no fight for another three seconds — but leaving
      // the press to fall through would quietly change a combat setting on
      // the way out of a menu.
      for (const code of inp.keysFor?.(action) ?? []) inp.pressed?.delete(code);
      this.director.choose(i);
      return;
    }
  }

  _updateLock(dt) {
    const inp = this.input;

    if (inp.consume('lockLeft', 0.2)) this.shiftLock(-1);
    if (inp.consume('lockRight', 0.2)) this.shiftLock(1);

    if (inp.consume('cycleTarget', 0.2)) {
      const next = this._pickTarget(true) ?? this._pickTarget(false);
      if (next) this._beginLock(next);
    }

    if (inp.consume('lock', 0.2)) {
      if (this.lock || this.locking) {
        this._dropLock();
      } else {
        const t = this._pickTarget();
        if (t) this._beginLock(t);
      }
    }

    // Acquisition takes a moment.
    //
    // A lock used to be instant, free, permanent and re-aimable at the best
    // available target with one keypress — which means that in a fight with
    // six machines in it there was never a question about who to shoot.
    // Paying a third of a second for it makes choosing one an actual choice,
    // and makes changing your mind mid-fight cost the same again.
    if (this.locking) {
      const t = this.locking.robot;
      if (!t.alive || this._blocked(this.player.position, t.position)) {
        this.locking = null;
        this.hud.lockProgress = 0;
      } else {
        this.locking.t += dt;
        if (this.locking.t >= LOCK_TIME) {
          this.lock = { robot: t, aimPoint: t.position.clone() };
          this.locking = null;
          this._applyLock();
        }
      }
    }

    if (this.lock) {
      if (!this.lock.robot.alive) {
        this.lock = null;
        this.player.setTarget(null);
        this.player.setLocked(false);
        return;
      }
      this.lock.aimPoint = this.player.body.assist.hasTarget
        ? this.player.body.assist.aimPoint
        : this.lock.robot.position;

      // Cover does NOT break the lock.
      //
      // It used to, on the reasoning that a permanent aim aid is a lock
      // with no decision in it. In play it reads as the lock being broken:
      // you are tracking something, it steps behind a crate for half a
      // second, and the target you chose is gone — so you spend the fight
      // re-acquiring rather than fighting. Cover already does its job by
      // stopping the ROUNDS, which is the part the player can see.
    }
  }

  /**
   * Is the line between these two points inside a solid thing?
   *
   * Sampled rather than solved. The arena's obstacles are axis-aligned
   * boxes and there are a couple of dozen of them, so walking the line and
   * asking "am I inside anything" is both shorter and easier to be sure
   * about than a slab test per box — and it is asked once per frame for one
   * pair of machines, not per bullet.
   */
  _blocked(from, to) {
    const boxes = this.world.colliders;
    if (!boxes?.length) return false;
    const span = from.distanceTo(to);
    if (span < 1e-3) return false;
    const steps = Math.min(48, Math.max(4, Math.round(span / 1.5)));
    for (let i = 1; i < steps; i++) {
      _v.lerpVectors(from, to, i / steps);
      for (const box of boxes) if (box.containsPoint(_v)) return true;
    }
    return false;
  }

  /** Start reaching for a target; `_updateLock` finishes the job. */
  _beginLock(robot) {
    this.lock = null;
    this.player.setTarget(null);
    this.player.setLocked(false);
    this.locking = { robot, t: 0 };
    return this.locking;
  }

  /** Let go of whatever we had, or were reaching for. */
  _dropLock() {
    this.lock = null;
    this.locking = null;
    this.feedback.lock?.(false);
    this.player.setTarget(null);
    this.player.setLocked(false);
    this.hud.lockProgress = 0;
    return this;
  }

  _applyLock() {
    this.feedback.lock?.(true);
    this.player.setTarget(this.lock.robot);
    this.player.setLocked(true);
    this.hud.lockProgress = 0;
    // Frame-lock onto whatever we just committed to fighting.
    this.player.body.space.clear();
    this.player.body.space.register('target', this.lock.robot, this.lock.robot.radius * 2.2);
  }

  // ---------------------------------------------------------- weapons

  _buildTracerPool() {
    this.tracerGroup = new THREE.Group();
    this.scene.add(this.tracerGroup);
    const mat = new THREE.LineBasicMaterial({
      color: 0x9fe6ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < 24; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, mat.clone());
      line.visible = false;
      line.frustumCulled = false;
      this.tracerGroup.add(line);
      this.tracers.push({ line, life: 0 });
    }
  }

  /**
   * Everything the player has bolted on, then — only for a machine carrying
   * no weapon plates at all — the built-in vulcan, so a bare chassis is
   * still worth taking into the field.
   */
  _fire(dt) {
    const p = this.player;

    if (this.input.consume('weaponNext', 0.2)) this._switchWeapon(1);
    if (this.input.consume('weaponPrev', 0.2)) this._switchWeapon(-1);

    const firing = this.input.isDown('fire');

    p.weapons.update({
      firing,
      aimPoint: this.lock && p.body.assist.hasTarget ? p.body.assist.aimPoint : null,
      projectiles: this.projectiles,
      targets: this.enemies,
      lockTarget: this.lock?.robot ?? null,
      effects: this.effects,
      feedback: this.feedback,
    }, dt);

    if (!p.weapons.hasWeapons) this._fireDefault(dt);
  }

  /** What the view is worth — the rig decides. */
  get baseFov() { return this.cameraRig.baseFov; }

  /**
   * Decide how often each machine re-poses itself.
   *
   * The player is always every step — it is the one the camera is on and
   * the one the player is steering. The others step down with distance
   * from the player, which is a fact about the fight rather than about the
   * screen, so two runs of the same match make the same choices.
   *
   * A machine close enough to matter, or shooting, stays at full rate: the
   * cost saved is not worth a muzzle that lags behind the arm holding it.
   */
  _shareOutWork() {
    const from = this.player.position;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = from.distanceTo(e.position);
      e.poseInterval = d < POSE_NEAR ? 1 : d < POSE_FAR ? 2 : 3;
    }
    this.player.poseInterval = 1;
  }

  /** A bubble around anything carrying a live barrier. */
  _updateShields(dt) {
    // Hide everything first: the machines get rebuilt whenever the player
    // edits, and a bubble left over from a Robot that no longer exists would
    // hang in the arena forever.
    for (const b of this.shieldBubbles.values()) b.visible = false;

    for (const robot of [this.player, ...this.enemies]) {
      const sh = robot.alive ? robot.shield : null;
      let bubble = this.shieldBubbles.get(robot);
      if (!sh) continue;
      if (!bubble) {
        const geo = new THREE.IcosahedronGeometry(1, 2);
        const mat = new THREE.MeshBasicMaterial({
          color: sh.color, transparent: true, opacity: 0.2, wireframe: true,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        bubble = new THREE.Mesh(geo, mat);
        bubble.frustumCulled = false;
        this.scene.add(bubble);
        this.shieldBubbles.set(robot, bubble);
      }
      bubble.visible = true;
      bubble.material.color.setHex(sh.color);
      bubble.position.copy(robot.position);
      bubble.scale.setScalar(robot.radius + sh.reach);
      bubble.rotation.y += dt * 0.6;
      // Thins out as it is worn down, and flickers as it runs out of time.
      const wear = sh.hp / Math.max(1, sh.maxHp);
      const fade = sh.t < 1.2 ? 0.5 + Math.sin(sh.t * 22) * 0.5 : 1;
      bubble.material.opacity = (0.08 + wear * 0.22) * fade;
    }
    return this;
  }

  // ---------------------------------------------------------- destruction

  /**
   * Anything that hit zero this frame comes apart. The machine hides itself
   * in `damage()`; the wreck and the queue for putting it back are ours.
   */
  _checkDeaths() {
    for (const robot of [this.player, ...this.enemies]) {
      if (!robot || robot.alive || robot.wrecked) continue;
      robot.wrecked = true;
      const mine = robot === this.player;
      this.debris.burst(robot, { power: mine ? 1.15 : 1 });
      this.hitPulse = Math.max(this.hitPulse, mine ? 0.9 : 0.55);
      this.feedback.boom?.(mine ? 1 : 0.75);
      // A kill is the one moment the whole loop pays out, and it used to
      // look exactly like taking a hit. It gets a ring of its own, a bigger
      // shake, and a mark where it happened.
      if (!mine) {
        _v.copy(robot.position);
        _v.y -= robot.body.rideHeight ?? 0;
        this.effects.landing(_v, {
          scale: Math.max(1.6, (robot.hitRadius ?? 1) * 3), power: 1,
        });
        this.hud.markHit(robot.position, 1, true);
      }
      // With rules in charge, whether anything comes back is their call.
      if (this.director) this.director.onDown(robot);
      else this.pendingRespawns.push({ robot, at: this.time + FieldScene.RESPAWN_DELAY });
      if (this.lock?.robot === robot) {
        this.lock = null;
        this.player.setTarget(null);
        this.player.setLocked(false);
      }
    }
  }

  /** Put wrecks back on the field once their timer is up. */
  _updateRespawns() {
    for (let i = this.pendingRespawns.length - 1; i >= 0; i--) {
      const job = this.pendingRespawns[i];
      if (this.time < job.at) continue;
      this.pendingRespawns.splice(i, 1);
      job.robot.wrecked = false;
      if (job.robot === this.player) this.respawn();
      else job.robot.revive(this._enemySpawn(job.robot));
    }
  }

  /**
   * Put every queued machine back right now. Dropping the queue instead
   * would strand an opponent that happened to be mid-respawn when the
   * player restarted — dead, invisible and never coming back.
   */
  _flushRespawns() {
    for (const job of this.pendingRespawns) {
      job.robot.wrecked = false;
      if (job.robot === this.player) continue;      // the caller is reviving it
      if (!this.enemies.includes(job.robot)) continue;
      job.robot.revive(this._enemySpawn(job.robot));
    }
    this.pendingRespawns.length = 0;
    return this;
  }

  /** Somewhere well clear of the player, and inside the arena, to put an
   *  opponent back. */
  /**
   * The four places a machine can start from.
   *
   * Everybody used to appear within sixty metres of the player, at a random
   * bearing — so a fight opened at knife range with no say in it, and on a
   * hundred-and-fifty-metre flat the whole arena beyond that circle was
   * scenery nobody visited. The corners put real ground between the
   * machines and make crossing it the first decision of the fight.
   *
   * Measured off the arena rather than written down, so a wider place puts
   * them wider apart with nothing else to change.
   *
   * @param {number} i    which corner; wraps
   * @param {number} lift how far off the floor, for the machine's own feet
   */
  cornerSpawn(i, lift = 0.5) {
    const r = this.world.arenaRadius * 0.66;
    const a = (Math.PI / 4) + (((i % 4) + 4) % 4) * (Math.PI / 2);
    // Somewhere weightless the floor is the far wall, so start out in the
    // volume where the fight actually happens rather than parked on it.
    const y = this.world.gravity <= 0 ? this.world.ceiling * 0.35 : lift;
    return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  }

  /**
   * Which corner an opponent gets: any but the player's.
   *
   * Numbered from the machine's place in the roster so two opponents do not
   * pile into the same corner, and so a wave is spread rather than bunched.
   */
  _enemySpawn(robot) {
    const at = this.enemies.indexOf(robot);
    const nth = at < 0 ? this.enemies.length : at;
    const lift = Math.max(0.5, -robot.rig.restLowestY);
    _v.copy(this.cornerSpawn(this.playerCorner + 1 + nth, lift));
    // A nudge off dead centre of the corner, so three machines sharing one
    // do not start inside each other.
    const spread = this.world.arenaRadius * 0.09;
    _v.x += this.random.range(-spread, spread);
    _v.z += this.random.range(-spread, spread);
    const edge = this.world.arenaRadius - 8;
    const flat = Math.hypot(_v.x, _v.z);
    if (flat > edge) {
      _v.x *= edge / flat;
      _v.z *= edge / flat;
    }
    return _v.clone();
  }

  /** Cycle the sub-weapon set, and say what came up. */
  _switchWeapon(dir) {
    const w = this.player.weapons;
    if (w.slots.length < 2) return null;
    const slot = dir > 0 ? w.next() : w.prev();
    this.hud.flashWeapon(slot?.meta.en ?? slot?.meta.label ?? '');
    return slot;
  }

  _fireDefault(dt) {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (!this.input.isDown('fire') || this.fireCooldown > 0) return;
    this.fireCooldown = 0.11;

    const from = _v.copy(this.player.position).addScaledVector(this.player.body.forward, 1.4);
    let to;
    if (this.lock && this.player.body.assist.hasTarget) {
      to = this.player.body.assist.aimPoint.clone();
    } else {
      to = from.clone().addScaledVector(this.player.body.forward, 140);
    }

    // slight scatter so continuous fire reads as a stream, not a laser
    to.x += this.random.signed() * 0.45;
    to.y += this.random.signed() * 0.45;
    to.z += this.random.signed() * 0.45;

    const slot = this.tracers.find((t) => t.life <= 0) ?? this.tracers[0];
    slot.life = 0.07;
    slot.line.visible = true;
    const pos = slot.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;

    if (this.lock && this.lock.robot.alive) {
      // The built-in gun is hitscan, so it cannot be dodged by moving out of
      // the way of a round — there is no round. What it can be is HARDER to
      // hit with while the target is crossing: distance, and how fast the
      // target is moving across the line rather than along it. Standing
      // still in front of it is still a mistake.
      const t = this.lock.robot;
      _dir.copy(t.position).sub(this.player.position);
      const range = _dir.length();
      if (range > 1e-4) _dir.multiplyScalar(1 / range);
      _cross.copy(t.velocity).addScaledVector(_dir, -t.velocity.dot(_dir));
      const miss = clamp01(range * 0.006 + _cross.length() * 0.045);
      if (this.random.unit() > miss) t.damage(1.6, this.player.position);
    }
  }

  /**
   * Turn what everyone just took into something the player can read.
   *
   * Landing a hit and taking one are the two things a fight is made of, and
   * both of them used to be invisible: a number moved on a bar somewhere.
   * A mark on the machine that took it says the round connected; an arc
   * round the reticle says which way the one that hit US came from —
   * including from behind, which is exactly when it matters.
   */
  _readBlows() {
    for (const robot of this._machines()) {
      if (!robot.blows?.length) continue;
      for (const blow of robot.blows) {
        const weight = clamp01(blow.damage / (robot.maxHp * 0.14));
        if (robot === this.player) {
          if (blow.from) this.hud.markHurt(blow.from, weight);
          if (this.director) this.director.tookHits = true;
          // Being hit shakes the view, and harder for a heavier blow. Landing
          // one already does; taking one used to do nothing at all.
          this.hitPulse = Math.max(this.hitPulse, 0.25 + weight * 0.55);
        } else {
          this.hud.markHit(robot.position, weight, blow.fatal);
          // Nobody shoots their own side, so anything an opponent took came
          // from us — which is how the run knows what our aim was worth.
          this.player.shotsLanded = (this.player.shotsLanded ?? 0) + 1;
        }
      }
      robot.blows.length = 0;
    }
  }

  /**
   * Who is shooting at us right now.
   *
   * With six machines on the field the read-out only ever spoke about the
   * one that was locked; the other five announced themselves by hitting
   * you. This is the shortest honest answer — not every opponent, only the
   * ones with their trigger down and us in front of it.
   */
  _threats() {
    _threats.length = 0;
    for (const ai of this.ais) {
      if (ai.aiming && ai.robot.alive) _threats.push(ai.robot);
    }
    return _threats;
  }

  /** Everything with a body on the field right now, the player included. */
  _machines() {
    _machines.length = 0;
    if (this.player) _machines.push(this.player);
    for (const e of this.enemies) _machines.push(e);
    return _machines;
  }

  /**
   * Kick up dust from the feet of anything running on the floor.
   *
   * Billed per METRE travelled rather than per second, so the trail reads
   * the same whether a machine is sprinting or trudging: a fixed rate puts
   * the same number of puffs into a long stride as a short one, which makes
   * a fast machine look like it is skating.
   */
  _groundDust(dt) {
    for (const robot of this._machines()) {
      if (!robot.alive) continue;
      const body = robot.body;
      _v.copy(robot.velocity); _v.y = 0;
      const speed = _v.length();
      if (body.env.grounded < 0.6 || speed < DUST_MIN_SPEED) {
        this._dustBank.set(robot, 0);
        continue;
      }
      let bank = (this._dustBank.get(robot) ?? 0) + speed * dt;
      // A machine skating sideways is dragging its feet across the floor
      // rather than picking them up: more dust, and more of it, which is
      // most of what tells the player they are sliding rather than walking.
      const skate = robot.animator?.slide ?? 0;
      const step = DUST_EVERY_METRES * (1 - skate * 0.6);
      while (bank >= step) {
        bank -= step;
        const groundY = this.world.groundHeight(robot.position.x, robot.position.z);
        // Behind the machine, where the foot that just pushed off was.
        _corner.copy(robot.position).addScaledVector(_v, -0.12 / Math.max(1, speed));
        _corner.y = groundY;
        this.effects.dust(_corner, _v, {
          scale: Math.max(0.7, (robot.hitRadius ?? 1) * 1.5) * (1 + skate * 0.6),
          life: 0.45 + skate * 0.25,
        });
      }
      this._dustBank.set(robot, bank);
    }
  }

  /**
   * Throw the ring and the skirt of dust for anything that just planted —
   * and for anything that has just been thrown off its feet.
   */
  _landings() {
    for (const robot of this._machines()) {
      if (!robot.alive) continue;
      // Being blown away leaves the floor where the machine WAS: it is the
      // last thing its feet did, and the only part of the throw the player
      // can see from behind their own machine.
      const thrown = robot.body.launched ?? 0;
      if (thrown > 0) {
        robot.body.launched = 0;          // taken
        _v.copy(robot.position);
        _v.y -= robot.body.rideHeight ?? 0;
        this.effects.landing(_v, {
          scale: Math.max(1.2, (robot.hitRadius ?? 1) * 2.4),
          power: thrown,
        });
        this.effects.impact(robot.position, robot.body.knockback, {
          scale: 0.7 + thrown * 0.9, color: 0xffd7a0, life: 0.3,
        });
        this.hitPulse = Math.max(this.hitPulse, 0.35 + thrown * 0.5);
      }

      const power = robot.body.landed ?? 0;
      if (power <= 0) continue;
      _v.copy(robot.position);
      _v.y -= robot.body.rideHeight ?? 0;
      this.effects.landing(_v, {
        // Wide as the machine's stance, not as its body: the ring is the
        // floor answering the feet, and the feet are not under the chest.
        scale: Math.max(1.2, (robot.hitRadius ?? 1) * 2.2),
        power,
      });
      // A landing you can feel is a landing that shook something.
      if (robot === this.player) this.hitPulse = Math.max(this.hitPulse, power * 0.45);
    }
  }

  _updateTracers(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.line.material.opacity = clamp01(t.life / 0.07) * 0.9;
      if (t.life <= 0) t.line.visible = false;
    }
  }

  // ---------------------------------------------------------- frame

  update(dt) {
    if (!this.active) return;
    if (this.paused) return;
    this.time += dt;
    const p = this.player;

    if (this.input.consume('reset', 0.2)) this.respawn();

    this._updateOffer();
    this._updateLock(dt);
    this._shareOutWork();
    p.update(this.input, dt);

    // Everything an opponent needs to shoot back, built once per step
    // rather than per machine.
    this._aiContext = {
      target: p,
      projectiles: this.projectiles,
      targets: this._machines(),
      effects: this.effects,
      feedback: this.feedback,
      // Everything else about an opponent carries on: they still move, still
      // close, still take cover. They just do not pull the trigger.
      enemyFire: this.enemyFire,
    };
    for (const ai of this.ais) {
      if (!ai.robot.alive) continue;
      ai.update(p.position, dt, this._aiContext);
    }

    this._checkDeaths();
    this.director?.update(dt);
    this._updateRespawns(dt);
    this.debris.update(dt);

    this._fire(dt);
    this._updateTracers(dt);
    // EVERY machine, the player included. Rounds used to be tested against
    // the opposition only, so an opponent's shot could not have hit you if
    // it had been fired — which, until now, it never was.
    this.projectiles.update(dt, this._machines());
    this.hitPulse = Math.max(0, this.hitPulse - dt * 5);
    for (const hit of this.projectiles.hits) {
      // Landing a hit should register, not white out the screen. A missile
      // does 30, so an unscaled ratio here drove the post-process flash to
      // full and swallowed the frame you actually wanted to see.
      if (hit.robot) this.hitPulse = Math.max(this.hitPulse, clamp01(hit.damage / 26) * 0.4);
      // A grenade going off is worth seeing from further away than the round
      // that carried it.
      if (hit.blast) {
        this.debris.blast?.(hit.position, hit.blast * 0.45);
        this.hitPulse = Math.max(this.hitPulse, 0.5);
        this.feedback.boom?.(0.45);
      } else {
        // Everything else gets sparks, in the colour of the round that made
        // them — including the ones that hit the floor. A shot that lands
        // with no mark on it reads as a shot that missed, and then the
        // player cannot tell the two apart.
        const weight = clamp01(hit.damage / 40);
        this.effects.impact(hit.position, hit.dir, {
          color: hit.color ?? 0xffffff,
          scale: 0.55 + weight * 1.1,
          life: hit.robot ? 0.26 : 0.18,
        });
        // Only what LANDED on somebody is worth a sound. A round hitting the
        // floor is already saying so with sparks, and forty of them a second
        // off a gatling is a hiss.
        if (hit.robot) this.feedback.hit?.(weight, hit.robot !== this.player);
      }
    }

    this._readBlows();
    this._groundDust(dt);
    this._landings();
    this.effects.track(this._machines());
    this.effects.update(dt);

    this._updateShields(dt);
  }

  /**
   * Everything that only decides what the frame LOOKS like: camera, screen
   * effects, the read-out. Runs once per displayed frame on real elapsed
   * time, never on the simulation clock.
   *
   * Kept apart from `update` on purpose. Anything in here may read the
   * fight but must not change it — that separation is what lets the
   * simulation be replayed, and what lets this half be skipped or throttled
   * when frames get expensive without the match drifting.
   */
  present(elapsed) {
    if (!this.active) return;
    if (this.paused) { this._drawHud(0); return; }
    const dt = Math.max(1e-4, Math.min(elapsed, 1 / 15));
    const p = this.player;


    // ---- camera
    const tel = p.body.telemetry();
    const avoid = p.body.env.contact;
    const orbiting = this.input.isDown('camera');
    this.cameraRig.orbitBy(this.input.cameraLook.yaw, this.input.cameraLook.pitch);
    this.cameraRig.zoomBy(this.input.zoomDelta * ZOOM_PER_WHEEL_UNIT);
    this.cameraRig.update({
      orbiting,
      position: p.position,
      forward: p.body.forward,
      up: p.body.angular.up,
      right: p.body.angular.right,
      velocity: p.velocity,
      accel: p.body.inertia.accel,
      aimPoint: this.lock ? this.lock.aimPoint : null,
      assistAuthority: tel.assist,
      jerk: tel.jerk,
      bank: tel.bank,
      thrust: tel.thrust,
      grounded: tel.grounded,
      groundY: 0,
      impact: Math.max(tel.impact, tel.stagger ?? 0),
      avoid,
      avoidUrgency: p.body.env.slideFactor,
    }, dt);

    // ---- shadows and billboards
    // Output only, and per FRAME rather than per step: neither one is read
    // back by anything, and both are about where the camera is.
    this.world.focusShadows(p.position);
    // The sky rides with the CAMERA, not with the machine: it is the camera
    // whose far plane would otherwise cut it in half.
    this.world.followSky(this.camera.position);
    this.effects.faceCamera(this.camera);

    // ---- feedback
    this.feedback.update({
      thrust: tel.thrust, jerk: tel.jerk, speed: tel.speed,
      impact: Math.max(tel.impact, this.hitPulse, tel.stagger ?? 0), strain: tel.strain,
    }, dt);

    // ---- post uniforms: thrust direction projected to screen
    _v.copy(p.position).addScaledVector(p.body.inertia.accel, 0.3).project(this.camera);
    _dir.copy(p.position).project(this.camera);
    _screenDir.set(_v.x - _dir.x, _v.y - _dir.y);
    if (_screenDir.lengthSq() > 1e-8) _screenDir.normalize();

    this.post.set({
      chroma: Math.min(0.8, this.cameraRig.vfx.chroma * 0.6 + this.feedback.visual.chroma * 0.25),
      lines: this.cameraRig.vfx.speedLines,
      noise: this.feedback.visual.noise,
      flash: this.feedback.visual.flash,
      dir: _screenDir,
    }, this.time);

    // The read-out is a 2D canvas redrawn from scratch, and nothing on it
    // changes fast enough to be worth doing every frame at 144Hz.
    this.hudBank += dt;
    if (this.hudBank >= HUD_INTERVAL) {
      this._drawHud(this.hudBank);
      this.hudBank = 0;
    }
  }

  _drawHud(dt) {
    const p = this.player;
    this.hud.draw({
      camera: this.camera,
      player: p,
      targets: this.enemies.filter((e) => e.alive),
      lock: this.lock,
      locking: this.locking ? this.locking.t / LOCK_TIME : 0,
      threats: this._threats(),
      // The place itself, for the dial in the corner. Read-only, like
      // everything else on this object.
      arena: this.world.arena,
      telemetry: p.body.telemetry(),
      gait: p.stats.gait,
      legs: p.stats.legs,
      weapons: p.weapons.readout(),
      mission: this.director?.readout ?? null,
      // The motion model's tuning numbers belong on the practice field,
      // where somebody is deliberately watching how a machine behaves.
      // In a run they are six rows of nothing where something could be.
      diagnostics: !this.director,
      // How much of the top the control legend is covering right now. The
      // arena does not know what a DOM panel is; the app measures it and
      // hands the number over, which is the app's job.
      topInset: this.topInset ?? 0,
    }, dt);
  }

  render() {
    this.post.render(this.scene, this.camera);
  }
}
