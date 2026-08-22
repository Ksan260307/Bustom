import * as THREE from 'three';
import { World } from './World.js';
import { Robot, SimpleAI } from './Robot.js';
import { Projectiles } from './Weapons.js';
import { Hud } from './Hud.js';
import { PostFX } from './PostFX.js';
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

export class FieldScene {
  constructor({ renderer, hudCanvas, input, feedback }) {
    this.renderer = renderer;
    this.input = input;
    this.feedback = feedback;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
    this.world = new World(this.scene);
    this.cameraRig = new CameraDynamics(this.camera);
    this.hud = new Hud(hudCanvas);
    this.post = new PostFX(renderer);

    this.enemies = [];
    this.ais = [];
    this.lock = null;
    this.tracers = [];
    this.fireCooldown = 0;
    /** Decaying kick from landing a shot, folded into the feedback bus. */
    this.hitPulse = 0;
    this.time = 0;
    this.active = false;
    this.paused = false;

    this._buildTracerPool();
    this.projectiles = new Projectiles(this.scene, this.world);
  }

  // ---------------------------------------------------------- lifecycle

  load(assembly) {
    if (this.player) { this.scene.remove(this.player.object3D); this.player.dispose(); }
    this.player = new Robot(assembly.clone(), this.world, { isPlayer: true });
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
      const bot = new Robot(asm, this.world, { x: s.x, z: s.z, name: asm.name });
      this.scene.add(bot.object3D);
      this.enemies.push(bot);
      this.ais.push(new SimpleAI(bot, { style: s.style, range: s.range }));
    }
  }

  respawn() {
    const h = Math.max(0.35, -this.player.rig.restLowestY);
    this.player.body.reset(new THREE.Vector3(0, h + 0.2, -18));
    // A respawn is a fresh view: whatever the player had the boom swung to,
    // they are looking at a new fight now. Their zoom is a preference, so it stays.
    this.projectiles.clear();
    this.player.rearm();
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
    this.post.setSize(w, h);
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
      aimPoint: this.lock && p.body.assist.hasTarget ? p.body.assist.aimPoint : null,
      projectiles: this.projectiles,
      targets: this.enemies,
      lockTarget: this.lock?.robot ?? null,
    }, dt);

    if (!p.weapons.hasWeapons) this._fireDefault(dt);
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
    to.x += (Math.random() - 0.5) * 0.9;
    to.y += (Math.random() - 0.5) * 0.9;
    to.z += (Math.random() - 0.5) * 0.9;

    const slot = this.tracers.find((t) => t.life <= 0) ?? this.tracers[0];
    slot.life = 0.07;
    slot.line.visible = true;
    const pos = slot.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;

    if (this.lock && this.lock.robot.alive) {
      const miss = this.player.position.distanceTo(this.lock.robot.position) * 0.006;
      if (Math.random() > miss) this.lock.robot.damage(1.6);
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
    if (this.paused) { this._drawHud(0); return; }
    this.time += dt;
    const p = this.player;

    if (this.input.consume('reset', 0.2)) this.respawn();

    this._updateLock(dt);
    p.update(this.input, dt);

    for (const ai of this.ais) {
      if (!ai.robot.alive) continue;
      ai.update(p.position, dt);
    }

    this._fire(dt);
    this._updateTracers(dt);
    this.projectiles.update(dt, this.enemies);
    this.hitPulse = Math.max(0, this.hitPulse - dt * 5);
    for (const hit of this.projectiles.hits) {
      if (hit.robot) this.hitPulse = Math.max(this.hitPulse, clamp01(hit.damage / 26));
    }

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

    this._drawHud(dt);
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
      weapons: p.weapons.readout(),
    }, dt);
  }

  render() {
    this.post.render(this.scene, this.camera);
  }
}
