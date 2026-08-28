import * as THREE from 'three';
import { clamp01 } from '../zmf/math.js';

// ============================================================
//  Effects : the small, constant feedback a fight is made of.
//
//    muzzle flash   something left the barrel
//    impact         something arrived
//    dust           the machine is on the ground and moving
//    landing        a heavy machine just planted itself
//    contact shadow where the machine is, relative to the floor
//
//  All of it is DECORATION. Nothing here is read back by the fight, and
//  every random number it draws comes from the presentation stream — so
//  throwing more sparks can never move a bullet. See FieldScene's two
//  Random instances.
//
//  Everything is pooled and built once. A muzzle flash that allocates is a
//  muzzle flash that stutters the first time each weapon is fired.
// ============================================================

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const FORWARD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** Dust is lit by the arena, not glowing: a cool grey reads as kicked-up floor. */
const DUST_COLOR = 0x9fb0c4;

/**
 * A soft round blot, white in the middle and transparent at the rim.
 *
 * Built as raw pixels rather than drawn into a canvas: this runs in the
 * tests too, and a texture that needs a DOM is a module that cannot be
 * tested without one.
 */
function blobTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
      // Flat in the middle, then off quickly: a linear falloff reads as a
      // ring rather than a blot.
      const a = d >= 1 ? 0 : (1 - d) ** 1.6;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

export class Effects {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./World.js').World} world
   */
  constructor(scene, world, {
    random = null, impacts = 10, muzzles = 10, puffs = 48, rings = 6, shadows = 10,
  } = {}) {
    this.scene = scene;
    this.world = world;
    this.random = random;

    this.group = new THREE.Group();
    this.group.name = 'effects';
    scene.add(this.group);

    this._owned = [];

    // ---- shared geometry
    this.flashGeo = new THREE.IcosahedronGeometry(1, 1);
    /** A streak lying along +Z, so a scale is (thickness, thickness, length). */
    this.streakGeo = new THREE.BoxGeometry(1, 1, 1);
    this.coneGeo = new THREE.ConeGeometry(1, 1, 10, 1, true);
    this.coneGeo.rotateX(-Math.PI / 2);      // opens along +Z
    this.coneGeo.translate(0, 0, 0.5);
    this.ringGeo = new THREE.TorusGeometry(1, 0.035, 6, 40);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.quadGeo = new THREE.PlaneGeometry(1, 1);
    this.blob = blobTexture();

    this.impacts = [];
    for (let i = 0; i < impacts; i++) this.impacts.push(this._makeImpact());
    this.muzzles = [];
    for (let i = 0; i < muzzles; i++) this.muzzles.push(this._makeMuzzle());
    this.puffs = [];
    for (let i = 0; i < puffs; i++) this.puffs.push(this._makePuff());
    this.rings = [];
    for (let i = 0; i < rings; i++) this.rings.push(this._makeRing());

    /** Contact shadows, handed out to machines and taken back. See `track`. */
    this.shadowPool = [];
    for (let i = 0; i < shadows; i++) this.shadowPool.push(this._makeShadow());
    /** @type {Map<object, THREE.Mesh>} machine -> its blot */
    this.shadows = new Map();

    this._cursor = { impact: 0, muzzle: 0, puff: 0, ring: 0 };
  }

  /** A number from the PRESENTATION stream, or an ordinary one. */
  _rand(a, b) {
    return this.random ? this.random.range(a, b) : a + Math.random() * (b - a);
  }

  _own(mat) { this._owned.push(mat); return mat; }

  // ---------------------------------------------------------- the pools

  /**
   * One arrival: a flash, and a handful of streaks thrown back out of it.
   *
   * Every piece shares ONE material, so the whole burst takes one colour
   * and one fade. That is what lets a hit be tinted by the round that made
   * it without paying for a material per spark.
   */
  _makeImpact() {
    const mat = this._own(new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const group = new THREE.Group();
    group.visible = false;
    const flash = new THREE.Mesh(this.flashGeo, mat);
    flash.frustumCulled = false;
    group.add(flash);
    const streaks = [];
    for (let i = 0; i < 7; i++) {
      const mesh = new THREE.Mesh(this.streakGeo, mat);
      mesh.frustumCulled = false;
      group.add(mesh);
      streaks.push({ mesh, dir: new THREE.Vector3(0, 1, 0), speed: 1, len: 1 });
    }
    this.group.add(group);
    return { group, mat, flash, streaks, life: 0, maxLife: 1, scale: 1 };
  }

  /**
   * One departure: a stubby cone down the barrel, and a bright core at the
   * mouth of it.
   *
   * Two shapes rather than one, because a muzzle flash has to read from
   * behind the gun (where the player is) AND from the side (where everyone
   * else is). A cone alone all but vanishes when you are looking down it,
   * which is exactly the angle the player has.
   */
  _makeMuzzle() {
    const mat = this._own(new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    const group = new THREE.Group();
    group.visible = false;
    const cone = new THREE.Mesh(this.coneGeo, mat);
    const core = new THREE.Mesh(this.flashGeo, mat);
    cone.frustumCulled = false;
    core.frustumCulled = false;
    group.add(cone, core);
    this.group.add(group);
    return { group, mat, cone, core, life: 0, maxLife: 1, scale: 1 };
  }

  /** A single puff of kicked-up floor. Its own material, so it fades alone. */
  _makePuff() {
    const mat = this._own(new THREE.MeshBasicMaterial({
      color: DUST_COLOR, map: this.blob, transparent: true, opacity: 0,
      depthWrite: false,
    }));
    const mesh = new THREE.Mesh(this.quadGeo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return {
      mesh, mat, life: 0, maxLife: 1, spin: 0, roll: 0,
      vel: new THREE.Vector3(), from: 1, to: 2,
    };
  }

  /** The ring a heavy landing throws out along the floor. */
  _makeRing() {
    const mat = this._own(new THREE.MeshBasicMaterial({
      color: DUST_COLOR, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, mat, life: 0, maxLife: 1, scale: 1 };
  }

  /** A soft blot for under a machine. */
  _makeShadow() {
    const mat = this._own(new THREE.MeshBasicMaterial({
      color: 0x000000, map: this.blob, transparent: true, opacity: 0,
      depthWrite: false,
    }));
    const mesh = new THREE.Mesh(this.quadGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;                   // under everything else on the floor
    this.group.add(mesh);
    return mesh;
  }

  _next(kind, pool) {
    const free = pool.find((s) => s.life <= 0);
    if (free) return free;
    // Nothing free: take the next in rotation, so a busy moment recycles
    // evenly instead of stamping on the same slot every time.
    this._cursor[kind] = (this._cursor[kind] + 1) % pool.length;
    return pool[this._cursor[kind]];
  }

  // ---------------------------------------------------------- what to show

  /**
   * A round arrived here.
   *
   * `dir` is the way it was travelling, so the sparks come back OUT of the
   * surface rather than continuing through it — which is the whole
   * difference between a hit and a pass-through.
   */
  impact(at, dir = null, { scale = 1, color = 0xffffff, life = 0.24 } = {}) {
    const e = this._next('impact', this.impacts);
    e.life = life;
    e.maxLife = life;
    e.scale = scale;
    e.mat.color.setHex(color);
    e.group.position.copy(at);
    e.group.visible = true;
    e.flash.visible = true;

    // The spray is centred on the way back out, opened into a wide cone.
    _v.copy(dir ?? UP);
    if (_v.lengthSq() < 1e-8) _v.copy(UP); else _v.normalize().negate();
    for (const s of e.streaks) {
      _v2.set(this._rand(-1, 1), this._rand(-1, 1), this._rand(-1, 1));
      if (_v2.lengthSq() < 1e-8) _v2.copy(UP);
      s.dir.copy(_v).addScaledVector(_v2.normalize(), 0.85).normalize();
      s.speed = this._rand(5, 13) * scale;
      s.len = this._rand(0.22, 0.6) * scale;
      s.mesh.position.set(0, 0, 0);
      s.mesh.quaternion.setFromUnitVectors(FORWARD, s.dir);
    }
    return e;
  }

  /** Something left the barrel here, pointing that way. */
  muzzle(at, dir, { scale = 1, color = 0xffffff, life = 0.075 } = {}) {
    const e = this._next('muzzle', this.muzzles);
    e.life = life;
    e.maxLife = life;
    e.scale = scale;
    e.mat.color.setHex(color);
    e.group.position.copy(at);
    _v.copy(dir ?? FORWARD);
    if (_v.lengthSq() < 1e-8) _v.copy(FORWARD);
    e.group.quaternion.setFromUnitVectors(FORWARD, _v.normalize());
    e.group.visible = true;
    return e;
  }

  /**
   * One puff of dust at `at`, drifting along `drift`.
   *
   * It grows and fades rather than travelling far: dust that travels reads
   * as smoke, and smoke reads as damage.
   */
  dust(at, drift = null, { scale = 1, life = 0.5 } = {}) {
    const e = this._next('puff', this.puffs);
    e.life = life * this._rand(0.75, 1.25);
    e.maxLife = e.life;
    e.from = scale * this._rand(0.5, 0.8);
    e.to = e.from * this._rand(2.2, 3.4);
    e.spin = this._rand(-2.4, 2.4);
    e.roll = this._rand(0, Math.PI * 2);
    e.mesh.position.copy(at);
    e.mesh.position.y += 0.04;
    e.vel.set(this._rand(-0.6, 0.6), this._rand(0.5, 1.6), this._rand(-0.6, 0.6));
    if (drift) e.vel.addScaledVector(drift, 0.35);
    e.mesh.visible = true;
    return e;
  }

  /**
   * A machine planted itself here: a ring along the floor, and a skirt of
   * dust thrown outward from the feet.
   */
  landing(at, { scale = 1, power = 1 } = {}) {
    const r = this._next('ring', this.rings);
    r.life = 0.42;
    r.maxLife = 0.42;
    r.scale = scale * (0.8 + power * 1.4);
    const floor = (this.world?.groundHeight?.(at.x, at.z) ?? 0) + 0.06;
    r.mesh.position.set(at.x, floor, at.z);
    r.mesh.visible = true;

    const n = Math.round(4 + power * 6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this._rand(-0.3, 0.3);
      _v.set(Math.cos(a), 0, Math.sin(a));
      _v2.set(at.x, floor, at.z).addScaledVector(_v, scale * this._rand(0.4, 1.0));
      this.dust(_v2, _v.multiplyScalar(4 * power), { scale: scale * 0.8, life: 0.65 });
    }
    return r;
  }

  // ---------------------------------------------------------- shadows

  /**
   * Give every live machine a blot on the floor beneath it, and take the
   * blots back from the ones that have gone.
   *
   * The arena already casts real shadows from the key light, but a shadow
   * thrown thirty metres sideways cannot answer the question a machine in
   * the air keeps asking: how far above the floor am I? The blot sits
   * directly underneath, and spreads and fades with height — so the
   * altitude is legible from the shadow alone, which is what makes landing
   * on top of something possible.
   */
  track(machines) {
    for (const [robot, mesh] of [...this.shadows]) {
      if (robot.alive && machines.includes(robot)) continue;
      mesh.visible = false;
      mesh.material.opacity = 0;
      this.shadowPool.push(mesh);
      this.shadows.delete(robot);
    }
    for (const robot of machines) {
      if (!robot?.alive) continue;
      let mesh = this.shadows.get(robot);
      if (!mesh) {
        mesh = this.shadowPool.pop();
        if (!mesh) continue;          // more machines than blots: the last ones go without
        this.shadows.set(robot, mesh);
      }
      const groundY = this.world?.groundHeight?.(robot.position.x, robot.position.z) ?? 0;
      const foot = robot.position.y - (robot.body?.rideHeight ?? 0);
      const height = Math.max(0, foot - groundY);
      // Spread and fade together, so the blot dies out rather than shrinking
      // to a dot: a machine twenty metres up has no contact to show.
      const up = clamp01(height / 22);
      const width = Math.max(1, (robot.hitRadius ?? 1) * 4.4) * (1 + up * 1.9);
      mesh.position.set(robot.position.x, groundY + 0.03, robot.position.z);
      mesh.scale.set(width, width, 1);
      mesh.material.opacity = 0.52 * (1 - up) ** 2;
      mesh.visible = mesh.material.opacity > 0.01;
    }
    return this;
  }

  // ---------------------------------------------------------- per frame

  update(dt) {
    const g = (this.world?.gravity ?? 22) * 0.12;   // dust barely notices gravity

    for (const e of this.impacts) {
      if (e.life <= 0) continue;
      e.life -= dt;
      if (e.life <= 0) { e.group.visible = false; continue; }
      const t = 1 - clamp01(e.life / e.maxLife);
      // The flash is gone in the first third; the streaks carry the rest.
      const flash = clamp01(t / 0.34);
      e.flash.scale.setScalar(e.scale * (0.11 + flash * 0.3));
      e.flash.visible = flash < 1;
      for (const s of e.streaks) {
        s.mesh.position.copy(s.dir).multiplyScalar(s.speed * t * e.maxLife);
        const len = s.len * (1 - t * 0.55);
        s.mesh.scale.set(0.035 * e.scale, 0.035 * e.scale, len);
      }
      e.mat.opacity = (1 - t) ** 1.5;
    }

    for (const e of this.muzzles) {
      if (e.life <= 0) continue;
      e.life -= dt;
      if (e.life <= 0) { e.group.visible = false; continue; }
      const t = 1 - clamp01(e.life / e.maxLife);
      const k = e.scale * (0.75 + t * 0.7);
      e.cone.scale.set(k * 0.17, k * 0.17, k * 0.6);
      e.core.scale.setScalar(k * 0.13);
      e.mat.opacity = (1 - t) ** 1.4;
    }

    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; p.mat.opacity = 0; continue; }
      const t = 1 - clamp01(p.life / p.maxLife);
      p.vel.y -= g * dt;
      p.vel.x *= 1 - 2.2 * dt;
      p.vel.z *= 1 - 2.2 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.roll += p.spin * dt;
      const k = p.from + (p.to - p.from) * t;
      p.mesh.scale.set(k, k, 1);
      // Up quickly, out slowly: a puff that fades IN reads as a puff rather
      // than as a sprite being switched on.
      p.mat.opacity = clamp01(t / 0.15) * (1 - t) ** 1.6 * 0.5;
    }

    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const t = 1 - clamp01(r.life / r.maxLife);
      r.mesh.scale.setScalar(r.scale * (0.9 + t * 1.6));
      r.mat.opacity = (1 - t) ** 1.8 * 0.28;
    }
    return this;
  }

  /**
   * Turn the dust to face the camera. Output only, and the reason the
   * puffs are quads at all: a flat sprite seen edge-on is not there.
   */
  faceCamera(camera) {
    camera.getWorldQuaternion(_q);
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.mesh.quaternion.copy(_q);
      p.mesh.rotateZ(p.roll);
    }
    return this;
  }

  get liveCount() {
    let n = 0;
    for (const e of this.impacts) if (e.life > 0) n++;
    for (const e of this.muzzles) if (e.life > 0) n++;
    for (const p of this.puffs) if (p.life > 0) n++;
    for (const r of this.rings) if (r.life > 0) n++;
    return n;
  }

  clear() {
    for (const e of this.impacts) { e.life = 0; e.group.visible = false; }
    for (const e of this.muzzles) { e.life = 0; e.group.visible = false; }
    for (const p of this.puffs) { p.life = 0; p.mesh.visible = false; p.mat.opacity = 0; }
    for (const r of this.rings) { r.life = 0; r.mesh.visible = false; }
    for (const [robot, mesh] of [...this.shadows]) {
      mesh.visible = false;
      mesh.material.opacity = 0;
      this.shadowPool.push(mesh);
      this.shadows.delete(robot);
    }
    return this;
  }

  dispose() {
    this.clear();
    for (const m of this._owned) m.dispose();
    this.flashGeo.dispose();
    this.streakGeo.dispose();
    this.coneGeo.dispose();
    this.ringGeo.dispose();
    this.quadGeo.dispose();
    this.blob.dispose();
    this.group.removeFromParent();
  }
}
