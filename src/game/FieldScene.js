import * as THREE from 'three';
import { World } from './World.js';
import { Robot, SimpleAI } from './Robot.js';
import { Projectiles } from './Weapons.js';
import { Debris } from './Debris.js';
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
const _dir = new THREE.Vector3();
const _screenDir = new THREE.Vector2();

/** Seconds between read-out redraws. Output only; never affects the fight. */
const HUD_INTERVAL = 1 / 30;

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
    this.world = new World(this.scene, renderer);
    this.cameraRig = new CameraDynamics(this.camera);
    this.hud = new Hud(hudCanvas);
    /** Shared with the editors when the app supplies one. */
    this.post = post ?? new PostFX(renderer);
    this._ownsPost = !post;

    this.enemies = [];
    this.ais = [];
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
    /** Machines waiting to be put back together: { robot, at }. */
    this.pendingRespawns = [];
  }

  /** Seconds a wreck lies on the field before the machine comes back. */
  static get RESPAWN_DELAY() { return 2.6; }

  // ---------------------------------------------------------- lifecycle

  load(assembly) {
    // The wreckage borrows the rig's geometry, so it cannot outlive the rig.
    this.debris.clear();
    // Anything queued against the machine we are about to throw away is not
    // coming back; everything else is flushed by the respawn below.
    this.pendingRespawns = this.pendingRespawns.filter((j) => j.robot !== this.player);
    if (this.player) { this.scene.remove(this.player.object3D); this.player.dispose(); }
    this.player = new Robot(assembly.clone(), this.world, {
      isPlayer: true, random: this.random,
    });
    this.scene.add(this.player.object3D);
    this.cameraRig.fitTo(this.player.stats);
    this.input.profile.massSensitivityScale = 1 / (1 + this.player.stats.weightClass * 0.5);
    this.respawn();
    if (!this.enemies.length) this._spawnEnemies();
    return this;
  }

  _spawnEnemies() {
    const specs = [
      { preset: 'biped', x: 24, z: 18, style: 'orbit', range: 24 },
      { preset: 'multileg', x: -28, z: 6, style: 'rusher', range: 16 },
      { preset: 'hopper', x: 6, z: -32, style: 'flyer', range: 30 },
    ];
    for (const s of specs) {
      const asm = PRESETS[s.preset].build();
      asm.name = `EN-${s.preset.toUpperCase()}`;
      const bot = new Robot(asm, this.world, {
        x: s.x, z: s.z, name: asm.name, random: this.random,
      });
      this.scene.add(bot.object3D);
      this.enemies.push(bot);
      this.ais.push(new SimpleAI(bot, { style: s.style, range: s.range }));
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

    this.respawn();
    for (const e of this.enemies) {
      e.wrecked = false;
      e.revive(this._enemySpawn(e));
      e.poseInterval = 1;
    }
    for (const ai of this.ais) ai.reset?.();
    return this;
  }

  respawn() {
    const h = Math.max(0.35, -this.player.rig.restLowestY);
    this.projectiles.clear();
    this.debris.clear();
    this._flushRespawns();
    this.player.wrecked = false;
    this.player.revive(new THREE.Vector3(0, h + 0.2, -18));
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

  _pickTarget(cycle = false) {
    const cam = this.camera;
    cam.getWorldDirection(_dir);
    let best = null;
    let bestScore = -Infinity;
    const current = this.lock?.robot;

    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (cycle && e === current) continue;
      _v.copy(e.position).sub(cam.position);
      const dist = _v.length();
      if (dist > 220) continue;
      const align = _v.divideScalar(dist).dot(_dir);
      if (align < 0.35) continue;                       // roughly on screen
      const score = align * 3.2 - dist / 160;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  _updateLock(dt) {
    const inp = this.input;

    if (inp.consume('cycleTarget', 0.2)) {
      const next = this._pickTarget(true) ?? this._pickTarget(false);
      if (next) { this.lock = { robot: next, aimPoint: next.position.clone() }; this._applyLock(); }
    }

    if (inp.consume('lock', 0.2)) {
      if (this.lock) {
        this.lock = null;
        this.player.setTarget(null);
        this.player.setLocked(false);
        this.hud.lockProgress = 0;
      } else {
        const t = this._pickTarget();
        if (t) { this.lock = { robot: t, aimPoint: t.position.clone() }; this._applyLock(); }
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
    }
  }

  _applyLock() {
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
      scoping: this.input.isDown('scope'),
      aimPoint: this.lock && p.body.assist.hasTarget ? p.body.assist.aimPoint : null,
      projectiles: this.projectiles,
      targets: this.enemies,
      lockTarget: this.lock?.robot ?? null,
    }, dt);

    if (!p.weapons.hasWeapons) this._fireDefault(dt);
  }

  /**
   * The scope. Narrowing the field of view IS the zoom — it magnifies what
   * the sniper is pointed at without moving the camera, so the machine stays
   * where the player left it.
   */
  _updateScope() {
    this.cameraRig.scope = this.player.alive ? (this.player.weapons.scopeZoom ?? 1) : 1;
    return this;
  }

  /** What the view is worth without a scope on it — the rig decides. */
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
      this.debris.burst(robot, { power: robot === this.player ? 1.15 : 1 });
      this.hitPulse = Math.max(this.hitPulse, robot === this.player ? 0.9 : 0.55);
      this.pendingRespawns.push({ robot, at: this.time + FieldScene.RESPAWN_DELAY });
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
  _enemySpawn(robot) {
    const angle = this.random.unit() * Math.PI * 2;
    const r = this.random.range(34, 60);
    _v.set(
      this.player.position.x + Math.cos(angle) * r,
      Math.max(0.5, -robot.rig.restLowestY),
      this.player.position.z + Math.sin(angle) * r,
    );
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
    this.hud.flashWeapon(slot?.meta.label ?? '');
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
      const miss = this.player.position.distanceTo(this.lock.robot.position) * 0.006;
      if (this.random.unit() > miss) this.lock.robot.damage(1.6);
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

    this._updateLock(dt);
    this._shareOutWork();
    p.update(this.input, dt);

    for (const ai of this.ais) {
      if (!ai.robot.alive) continue;
      ai.update(p.position, dt);
    }

    this._checkDeaths();
    this._updateRespawns(dt);
    this.debris.update(dt);

    this._fire(dt);
    this._updateTracers(dt);
    this.projectiles.update(dt, this.enemies);
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
      }
    }

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

    this._updateScope();

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
      impact: tel.impact,
      avoid,
      avoidUrgency: p.body.env.slideFactor,
    }, dt);

    // ---- feedback
    this.feedback.update({
      thrust: tel.thrust, jerk: tel.jerk, speed: tel.speed,
      impact: Math.max(tel.impact, this.hitPulse), strain: tel.strain,
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
      telemetry: p.body.telemetry(),
      gait: p.stats.gait,
      legs: p.stats.legs,
      weapons: p.weapons.readout(),
    }, dt);
  }

  render() {
    this.post.render(this.scene, this.camera);
  }
}
