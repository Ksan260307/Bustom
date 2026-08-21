import * as THREE from 'three';
import { Rig } from '../core/Rig.js';
import { computeStats } from '../core/Assembly.js';
import { ZMFBody } from '../zmf/ZMFBody.js';
import { Animator } from '../anim/Animator.js';
import { clamp01, damp } from '../zmf/math.js';

// ============================================================
//  Robot : assembly -> rig -> ZMF body -> animator, in one object.
// ============================================================

const _v = new THREE.Vector3();
const _aim = new THREE.Vector3();

/** Soft radial falloff. A Sprite with no map is a hard white square. */
let _glowTexture = null;
function glowTexture() {
  if (_glowTexture) return _glowTexture;
  // Headless (tests, tooling): no canvas, so the sprite just goes untextured.
  if (typeof document === 'undefined') return null;
  const size = 128;
  const c = document.createElement('canvas');
  if (!c.getContext) return null;
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(190,235,255,0.72)');
  grad.addColorStop(0.6, 'rgba(120,200,255,0.18)');
  grad.addColorStop(1.0, 'rgba(80,170,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  _glowTexture = new THREE.CanvasTexture(c);
  _glowTexture.colorSpace = THREE.SRGBColorSpace;
  return _glowTexture;
}

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

    this.rig = new Rig(assembly);
    this.stats = computeStats(assembly, this.rig);

    this.object3D = new THREE.Group();
    this.object3D.add(this.rig.root);

    const rideHeight = Math.max(0.35, -this.rig.restLowestY);
    this.body = new ZMFBody(this.stats, world, { rideHeight });
    this.animator = new Animator(this.rig, this.stats);

    this.hp = 100 + this.stats.blockCount * 8;
    this.maxHp = this.hp;
    this.alive = true;
    this.radius = Math.max(1.0, this.stats.extent * 0.8);

    this._buildThrusterFx();
    this.body.reset(new THREE.Vector3(opts.x ?? 0, rideHeight, opts.z ?? 0));
    this.syncTransform();
  }

  get position() { return this.body.position; }
  get velocity() { return this.body.velocity; }

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

    const glowMat = new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xbfefff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(0.5 * k);
    glow.position.set(0, 0, -0.7 * k);
    this.rig.root.add(glow);
    this.glow = glow;
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
    if (this.lockTarget) {
      // keep the tracked handle pointing at live data
      this.body.target = { position: this.lockTarget.position, radius: this.lockTarget.radius };
    }
    this.body.update(input, dt);
    this.syncTransform();
    this._animate(dt);
    this._updateFx(dt);
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
    });

    // Bob and lean are visual carriage only — the physics body never moves.
    this.rig.root.position.set(0, this.animator.bodyBob, 0);
    this.rig.root.rotation.set(this.animator.bodyLean.x, 0, this.animator.bodyLean.y);
  }

  _updateFx(dt) {
    const out = this.body.inertia.thrustOutput;
    const fwd = Math.max(0, this.body.inertia.spool.z);
    const amt = clamp01(out * 0.6 + fwd * 0.9);
    const k = this.fxScale;
    this.plume.material.opacity = damp(this.plume.material.opacity, amt * 0.42, 0.05, dt);
    this.plume.scale.set(0.7 + amt * 0.4, 0.7 + amt * 0.4, 0.6 + amt * 1.4);
    this.glow.material.opacity = damp(this.glow.material.opacity, amt * 0.38, 0.05, dt);
    this.glow.scale.setScalar(k * (1.1 + amt * 2.2));
  }

  damage(n) {
    this.hp = Math.max(0, this.hp - n);
    if (this.hp <= 0) this.alive = false;
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

export class SimpleAI {
  constructor(robot, opts = {}) {
    this.robot = robot;
    this.input = new SyntheticInput();
    this.t = Math.random() * 10;
    this.preferredRange = opts.range ?? 26;
    this.style = opts.style ?? 'orbit';   // orbit | rusher | flyer
    this.phase = Math.random() * Math.PI * 2;
    this.jinkTimer = 0;
    this.jinkDir = 1;
  }

  update(playerPos, dt) {
    const r = this.robot;
    const inp = this.input;
    this.t += dt;

    _v.copy(playerPos).sub(r.position);
    const range = _v.length();
    _v.y = 0;
    const flat = _v.lengthSq() > 1e-4 ? _v.clone().normalize() : new THREE.Vector3(0, 0, 1);

    // face roughly toward the player
    const fwd = r.body.forward;
    const cross = fwd.x * flat.z - fwd.z * flat.x;
    inp.look.yaw = THREE.MathUtils.clamp(-cross * 2.4, -1, 1) * 2.6;   // rad/s
    inp.look.pitch = 0;

    // approach / retreat along the range error, strafe for the rest
    this.jinkTimer -= dt;
    if (this.jinkTimer <= 0) {
      this.jinkTimer = 0.7 + Math.random() * 1.4;
      this.jinkDir = Math.random() < 0.5 ? -1 : 1;
    }

    const err = (range - this.preferredRange) / this.preferredRange;
    const drive = THREE.MathUtils.clamp(err * 1.6, -1, 1);
    const strafe = this.jinkDir * (0.55 + Math.sin(this.t * 1.7 + this.phase) * 0.45);

    inp.move.set(strafe, 0, drive);
    inp.intensity = Math.min(1, inp.move.length());

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
    inp.endFrame();
  }
}
