import * as THREE from 'three';
import { EQUIP_META, weaponLead, STAGGER } from '../core/constants.js';
import { clamp01 } from '../zmf/math.js';

// ============================================================
//  Weapons : what the equipment plates actually do in the field.
//
//  One plate is one gun. Each carries its own magazine, its own reload
//  and its own trigger discipline, so a machine's firepower is a
//  consequence of what the player stuck on it rather than a stat.
//
//  Two objects live here:
//    Projectiles   a pool of live shots, shared by everything that fires
//    WeaponSystem  one machine's plates, their ammo and their triggers
// ============================================================

const _v = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _localUp = new THREE.Vector3();
const _lead = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _near = new THREE.Vector3();

/**
 * How a held trigger loosens up, in seconds to reach full bloom, seconds to
 * settle back, and how much wider the cone gets at the top.
 *
 * The point is a reason to let go, not a punishment for shooting: a long
 * burst still lands, it just stops being precise. Settling is faster than
 * warming so a short tap costs nothing at all.
 */
const WARM_UP = 1.6;
const WARM_DOWN = 0.7;
const WARM_BLOOM = 1.5;
const _near2 = new THREE.Vector3();
const _hitAt = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Vector3();
/** +Z, the axis every bolt and beam is modelled along. */
const _FORWARD = new THREE.Vector3(0, 0, 1);

/**
 * Closest approach of the segment a→b to a sphere. Writes the contact point
 * into `out` and returns it, or null for a miss.
 *
 * Shared by the projectile sweep and the laser: both are asking the same
 * question — "does this line touch that machine" — and a second copy of it
 * is a second place for the answer to drift.
 */
export function segmentHitsSphere(a, b, centre, radius, out) {
  _seg.copy(b).sub(a);
  const len2 = _seg.lengthSq();
  let u = 0;
  if (len2 > 1e-9) u = clamp01(_v.copy(centre).sub(a).dot(_seg) / len2);
  out.copy(a).addScaledVector(_seg, u);
  return out.distanceTo(centre) <= radius ? out : null;
}

/**
 * Closest approach of the segment a→b to an upright capsule: a vertical
 * segment of half-length `halfHeight` centred on `centre`, thickened by
 * `radius`. Writes the contact point on the SHOT into `out` and returns it,
 * or null for a miss.
 *
 * A machine is not a ball. Modelled as one, the sphere has to be as wide as
 * the machine is tall or its head and feet stop existing — and a seven-metre
 * walker then eats every round that passes three metres to the side of it.
 * That is most of what "everything hits" was: not the aim, the target.
 *
 * A standing column is the honest shape. It is as wide as the machine
 * actually is, so stepping aside works; it is as tall as the machine
 * actually is, so shooting one in the legs still counts.
 */
export function segmentHitsCapsule(a, b, centre, halfHeight, radius, out) {
  if (!(halfHeight > 0)) return segmentHitsSphere(a, b, centre, radius, out);
  _seg.copy(b).sub(a);                      // d
  _v.copy(a).sub(centre);                   // w

  // With the axis exactly upright, the vertical term drops out of the
  // distance the moment the axis point is free to slide: what is left is the
  // horizontal miss, and that is what picks the point along the shot.
  const flat2 = _seg.x * _seg.x + _seg.z * _seg.z;
  let u = flat2 > 1e-12
    ? clamp01(-(_v.x * _seg.x + _v.z * _seg.z) / flat2)
    : 0;
  let t = _v.y + u * _seg.y;

  // Past the end of the column the axis point is pinned, and the best point
  // along the shot has to be solved again against that fixed end — the cap.
  if (t < -halfHeight || t > halfHeight) {
    t = t < -halfHeight ? -halfHeight : halfHeight;
    const len2 = _seg.lengthSq();
    if (len2 > 1e-12) {
      u = clamp01(-((_v.x * _seg.x) + (_v.y - t) * _seg.y + (_v.z * _seg.z)) / len2);
    }
  }

  out.copy(a).addScaledVector(_seg, u);
  _near2.copy(centre).setY(centre.y + t);
  return out.distanceTo(_near2) <= radius ? out : null;
}

// ---------------------------------------------------------- how a round looks
//
// Rounds are drawn additively in the player's chosen colour, so their
// texture is a GREYSCALE mask: it multiplies that colour rather than
// replacing it, and a blue beam and an orange one get the same shape from
// the same map. Baked as pixels rather than drawn into a canvas, so the
// module still works with no DOM — the tests build these too.

/** A triangular bump of half-width `w` centred on `c`. */
const bump = (v, c, w) => Math.max(0, 1 - Math.abs(v - c) / w);

/** Wrap a greyscale ramp into a DataTexture. `at(u, v)` returns 0..1. */
function maskTexture(w, h, at) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = Math.max(0, Math.min(1, at((x + 0.5) / w, (y + 0.5) / h)));
      const i = (y * w + x) * 4;
      const v = Math.round(k * 255);
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/**
 * A bolt: white-hot at the nose, falling away down the tail, with two tight
 * bands across it.
 *
 * The cylinder is modelled along +Z with v = 1 at the nose, so the ramp runs
 * straight down v. The bands are what stop a fast round reading as a smear —
 * they give the eye something fixed to track it by.
 */
function boltTexture() {
  return maskTexture(4, 64, (u, v) => {
    let a = 0.14 + (v ** 2.2) * 0.86;
    a *= 1 - 0.5 * bump(v, 0.62, 0.035) - 0.5 * bump(v, 0.46, 0.035);
    return a;
  });
}

/**
 * A missile: a dark body with the motor burning at the tail and a bright
 * warhead at the tip.
 *
 * The opposite shape to a bolt on purpose. A missile is a THING with an
 * engine, and the one part of it that should be brightest is the end you
 * are not being hit by.
 */
function missileTexture() {
  return maskTexture(4, 64, (u, v) => {
    let a = 0.22;
    a += 0.95 * bump(v, 0.0, 0.16);        // exhaust
    a += 0.55 * (v ** 6);                  // the tip catches the light
    a -= 0.14 * bump(v, 0.34, 0.06);       // a seam, so the body has scale
    return a;
  });
}

/**
 * A grenade: a mottled shell, so a lobbed round tumbling through the air
 * reads as tumbling rather than as a smooth dot sliding sideways.
 */
function grenadeTexture() {
  return maskTexture(32, 32, (u, v) => {
    const bands = Math.sin(u * Math.PI * 6) * Math.sin(v * Math.PI * 5);
    return 0.55 + bands * 0.35;
  });
}

/** Unit bolt: a cylinder lying along +Z, so a scale is (radius, radius, length). */
function boltGeometry() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 7, 1, true);
  g.rotateX(Math.PI / 2);
  return g;
}

function missileGeometry() {
  const g = new THREE.ConeGeometry(1, 3, 8);
  g.rotateX(Math.PI / 2);
  return g;
}

function grenadeGeometry() {
  return new THREE.IcosahedronGeometry(1, 0);
}

/**
 * Are these two on the same side?
 *
 * Only ever true when BOTH of them say which side they are on. Anything
 * without an answer — a stand-in, a wreck, a test dummy — is fair game,
 * which is the safe way round: a shot that fails to hit is a bug you can
 * see, and a shot that hits its own team is a bug you cannot.
 */
function sameSide(owner, target) {
  return owner != null
    && owner.isPlayer !== undefined && target.isPlayer !== undefined
    && owner.isPlayer === target.isPlayer;
}

/** How many points a missile's smoke trail remembers. */
const TRAIL_POINTS = 16;

/**
 * How far a missile has to open up past its closest approach before it
 * accepts that it missed, in metres.
 *
 * Not zero: a target jinking across the nose makes the range wobble by a
 * few centimetres, and a missile that gave up on that would never reach
 * anything. Not large either — the whole point is that it gives up.
 */
const HOMING_GIVE_UP = 2;

export class Projectiles {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./World.js').World} world
   */
  constructor(scene, world, { max = 220 } = {}) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'projectiles';
    scene.add(this.group);

    this.boltGeo = boltGeometry();
    this.missileGeo = missileGeometry();
    this.grenadeGeo = grenadeGeometry();

    // One map per shape, made once and shared by every slot. Swapping which
    // texture a material points at is free; adding or removing one is not,
    // so every slot always has one.
    this.boltTex = boltTexture();
    this.missileTex = missileTexture();
    this.grenadeTex = grenadeTexture();

    /**
     * Beams are not projectiles: a laser exists between two points for as
     * long as the trigger is held. They get their own short-lived pool so
     * the weapon can simply re-issue one every frame.
     */
    this.beams = [];
    for (let i = 0; i < 8; i++) this.beams.push(this._makeBeam());

    /** @type {Array<object>} every slot, live or not */
    this.pool = [];
    for (let i = 0; i < max; i++) this.pool.push(this._makeSlot());
    this._cursor = 0;
    /** Hits accumulated this frame, for the caller to turn into feedback. */
    this.hits = [];
  }

  _makeSlot() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, map: this.boltTex, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.boltGeo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return {
      mesh, mat, life: 0, kind: 'bolt', color: 0xffffff,
      velocity: new THREE.Vector3(),
      damage: 0, radius: 0.2, speed: 0, turn: 0, owner: null, target: null,
      /** Homing state: whether it is still steering, and its best approach. */
      homing: false, closest: Infinity,
      gravity: 0, blast: null, streak: 0, trail: null, trailColor: 0xffffff,
    };
  }

  _makeBeam() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.boltGeo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, mat, life: 0 };
  }

  /**
   * A smoke trail, made once per slot and kept. Only missiles ask for one,
   * and there are never many missiles live, so this stays cheap — but the
   * line is reused rather than rebuilt, because allocating a geometry per
   * shot is how a weapon becomes a frame-rate problem.
   */
  _ensureTrail(s) {
    if (s.trail) return s.trail;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.visible = false;
    this.group.add(line);
    s.trail = { line, geo, mat };
    return s.trail;
  }

  /** Lay the whole trail on one point, so a new shot has no old tail. */
  _resetTrail(s, at) {
    const t = this._ensureTrail(s);
    const arr = t.geo.getAttribute('position').array;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      arr[i * 3] = at.x; arr[i * 3 + 1] = at.y; arr[i * 3 + 2] = at.z;
    }
    t.geo.getAttribute('position').needsUpdate = true;
    t.mat.color.setHex(s.trailColor);
    t.line.visible = true;
  }

  _advanceTrail(s) {
    if (!s.trail) return;
    const attr = s.trail.geo.getAttribute('position');
    const arr = attr.array;
    arr.copyWithin(0, 3);
    const p = s.mesh.position;
    const i = (TRAIL_POINTS - 1) * 3;
    arr[i] = p.x; arr[i + 1] = p.y; arr[i + 2] = p.z;
    attr.needsUpdate = true;
    s.trail.mat.opacity = s.mat.opacity * 0.6;
  }

  /**
   * Draw a beam for a moment. Called every frame a laser is held, so the
   * lifetime is barely longer than a frame: no caller has to remember to
   * turn it off.
   */
  beam({ from, to, width = 0.4, color = 0xffffff }) {
    let b = this.beams.find((x) => x.life <= 0);
    if (!b) b = this.beams[0];
    b.life = 0.05;
    b.mat.color.setHex(color);
    b.mat.opacity = 0.8;
    b.mesh.visible = true;
    _seg.copy(to).sub(from);
    const len = Math.max(0.01, _seg.length());
    b.mesh.position.copy(from).addScaledVector(_seg, 0.5);
    b.mesh.quaternion.setFromUnitVectors(_FORWARD, _seg.normalize());
    b.mesh.scale.set(width, width, len);
    return b;
  }

  /**
   * Take the next free slot. When every slot is live the oldest one is
   * recycled — dropping a shot the player asked for reads far worse than
   * clipping a tracer that is already on its way out.
   */
  _take() {
    for (let i = 0; i < this.pool.length; i++) {
      const s = this.pool[(this._cursor + i) % this.pool.length];
      if (s.life <= 0) { this._cursor = (this._cursor + i + 1) % this.pool.length; return s; }
    }
    const s = this.pool[this._cursor];
    this._cursor = (this._cursor + 1) % this.pool.length;
    return s;
  }

  spawn({
    position, direction, speed, life = 2, damage = 1, color = 0xffffff,
    radius = 0.2, kind = 'bolt', turn = 0, target = null, owner = null,
    gravity = 0, blast = null, streak = 0, trail = null,
  }) {
    const s = this._take();
    s.kind = kind;
    s.gravity = gravity;
    s.blast = blast;
    s.streak = streak;
    s.trailColor = trail ?? 0xffffff;
    s.life = life;
    s.maxLife = life;
    // Whatever the machine that fired it is worth.
    //
    // Applied once, here, rather than at every place a hit is counted: a
    // direct hit, a blast, a beam and the number the read-out shows all
    // come off this, so scaling it here is the only way they can agree.
    // One for the player, always: a run's difficulty is what the OPPOSITION
    // is, not a discount on your own guns.
    const scale = owner?.damageScale ?? 1;
    s.damage = damage * scale;
    if (blast) s.blast = { ...blast, damage: blast.damage * scale };
    s.radius = radius;
    s.speed = speed;
    s.turn = turn;
    s.owner = owner;
    s.target = target;
    s.homing = turn > 0;
    s.closest = Infinity;

    s.velocity.copy(direction).normalize().multiplyScalar(speed);
    s.mesh.geometry = kind === 'missile' ? this.missileGeo
      : kind === 'grenade' ? this.grenadeGeo : this.boltGeo;
    s.mat.map = kind === 'missile' ? this.missileTex
      : kind === 'grenade' ? this.grenadeTex : this.boltTex;
    s.mesh.position.copy(position);
    s.color = color;
    s.mat.color.setHex(color);
    s.mat.opacity = 0.95;
    s.mesh.visible = true;
    if (trail) this._resetTrail(s, position);
    else if (s.trail) s.trail.line.visible = false;
    this._orient(s);
    return s;
  }

  _orient(s) {
    _dir.copy(s.velocity);
    if (_dir.lengthSq() < 1e-8) return;
    _dir.normalize();
    // Allocating a constant here cost one vector per live round per frame.
    s.mesh.quaternion.setFromUnitVectors(_FORWARD, _dir);
    if (s.kind === 'missile') {
      const k = s.radius;
      s.mesh.scale.set(k * 0.9, k * 0.9, k * 2.6);
    } else if (s.kind === 'grenade') {
      s.mesh.scale.setScalar(s.radius);
    } else if (s.streak > 0) {
      // A rifle shot is a LINE: thin, and long enough to read as one stroke
      // rather than a dot crossing the screen.
      s.mesh.scale.set(s.radius, s.radius, s.streak);
    } else {
      // Streak length follows speed, so a gatling round reads as a tracer
      // and a beam bolt reads as a bolt.
      s.mesh.scale.set(s.radius, s.radius, Math.max(s.radius * 2, s.speed * 0.035));
    }
  }

  /**
   * Advance every live shot and resolve what it hits.
   * @param {number} dt
   * @param {Array<import('./Robot.js').Robot>} targets everything shootable
   */
  update(dt, targets = []) {
    this.hits.length = 0;
    const r = this.world?.arenaRadius ?? 400;

    for (const b of this.beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) b.mesh.visible = false;
    }

    for (const s of this.pool) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { this._kill(s); continue; }

      // ---- homing: steer, never teleport. A missile you cannot outrun is
      // not a missile, it is a cutscene.
      //
      // And it gets ONE go. The moment it has passed its closest approach —
      // flown by, or been outrun — the steering stops and it carries
      // straight on. A missile that keeps turning until its fuel runs out
      // circles back and comes at you again, and again, so dodging it buys
      // nothing: the only thing that ever ends the chase is being hit by
      // it. Giving up is what makes the dodge mean something.
      if (s.homing && s.target?.alive) {
        _to.copy(s.target.position).sub(s.mesh.position);
        const range = _to.length();
        if (range <= s.closest + HOMING_GIVE_UP) {
          if (range < s.closest) s.closest = range;
          if (range > 1e-3) {
            _to.divideScalar(range);
            _dir.copy(s.velocity).normalize();
            const cos = Math.min(1, Math.max(-1, _dir.dot(_to)));
            const step = Math.min(Math.acos(cos), s.turn * dt);
            if (step > 1e-5) {
              _v.crossVectors(_dir, _to);
              if (_v.lengthSq() < 1e-8) _v.copy(_up);
              _dir.applyAxisAngle(_v.normalize(), step);
              s.velocity.copy(_dir).multiplyScalar(s.speed);
            }
          }
        } else {
          s.homing = false;
        }
      }

      // Lobbed rounds arc. The drop is what makes a grenade a grenade
      // rather than a slow bullet.
      if (s.gravity) s.velocity.y -= s.gravity * dt;

      _prev.copy(s.mesh.position);
      s.mesh.position.addScaledVector(s.velocity, dt);
      this._orient(s);
      this._advanceTrail(s);
      s.mat.opacity = 0.35 + clamp01(s.life / Math.max(0.001, s.maxLife)) * 0.6;

      // ---- terrain
      const p = s.mesh.position;
      const groundY = this.world?.groundHeight?.(p.x, p.z) ?? 0;
      // Cover stops rounds, and wears out. The pillars have stood there
      // since the first build and only ever broke a lock — you could hide
      // behind one and still be shot through it, which is worse than having
      // no cover at all, because it looks like it should work.
      const inCover = this.world?.blocksAt?.(p) ?? false;
      if (inCover) this.world.damageCover(p, s.damage);
      if (inCover || p.y <= groundY + 0.05 || Math.hypot(p.x, p.z) > r + 8) {
        // A plain round reports where it struck; one with a blast reports
        // the blast instead, which is the bigger event and the one worth
        // drawing.
        if (!s.blast) this.hits.push(this._hitRecord(s, p, null, 0));
        this._detonate(s, p, targets);
        this._kill(s);
        continue;
      }

      // ---- machines
      // Swept, not sampled: a gatling round covers three metres in a frame,
      // which is further than some machines are wide. Testing only the
      // endpoint would let fast rounds pass straight through small targets.
      for (const t of targets) {
        if (!t || t === s.owner || !t.alive) continue;
        if (sameSide(s.owner, t)) continue;
        if (this._sweepHits(_prev, p, t, s.radius) === null) continue;
        t.damage(s.damage, _near);
        this.hits.push(this._hitRecord(s, _near, t, s.damage));
        this._detonate(s, _near, targets, t);
        this._kill(s);
        break;
      }
    }
    return this;
  }

  /**
   * What a hit looks like to whatever is going to draw it: where, on whom,
   * how hard — and the two things only the round itself knows, which way it
   * was travelling and what colour it was.
   */
  _hitRecord(s, at, robot, damage) {
    return {
      position: at.clone(),
      robot,
      damage,
      color: s.color,
      dir: s.velocity.clone().normalize(),
      radius: s.radius,
    };
  }

  /**
   * Closest approach of the segment a→b to a machine's own hit volume.
   * Returns the point of contact (in the shared temp `_near`) or null.
   *
   * `hitRadius` / `hitHalfHeight` are what a Robot measures off its own
   * built body. Anything without them — a stand-in, a wreck — is still a
   * plain ball of `radius`.
   */
  _sweepHits(a, b, t, pad) {
    _hitAt.copy(t.position);
    _hitAt.y += t.hitOffsetY ?? 0;
    return segmentHitsCapsule(
      a, b, _hitAt, t.hitHalfHeight ?? 0, (t.hitRadius ?? t.radius) + pad, _near,
    );
  }

  /**
   * Blast damage, for anything that carries one. Falls off with distance so
   * a near miss still counts for something and a direct hit counts for more.
   * The machine that ate the direct hit is skipped: it has been billed once
   * already, and double-charging it makes a grenade quietly the best gun in
   * the game.
   */
  _detonate(s, at, targets, direct = null) {
    if (!s.blast) return;
    const { radius, damage } = s.blast;
    for (const t of targets) {
      if (!t || !t.alive || t === s.owner || t === direct) continue;
      if (sameSide(s.owner, t)) continue;
      const d = at.distanceTo(t.position) - t.radius;
      if (d > radius) continue;
      const falloff = 1 - clamp01(Math.max(0, d) / radius);
      t.damage(damage * falloff, at);
    }
    // Reported wherever it went off — on the floor or on somebody — so the
    // explosion is drawn in both cases.
    this.hits.push({ position: at.clone(), robot: null, damage: 0, blast: radius });
  }

  _kill(s) {
    s.life = 0;
    s.target = null;
    s.homing = false;
    s.closest = Infinity;
    s.owner = null;
    s.mesh.visible = false;
    if (s.trail) s.trail.line.visible = false;
  }

  get liveCount() { return this.pool.reduce((n, s) => n + (s.life > 0 ? 1 : 0), 0); }

  /**
   * Empty the pool. The cursor goes back to the start too, so a cleared
   * pool is indistinguishable from a fresh one — otherwise the same volley
   * lands in different slots depending on what was fired before it, which
   * makes two runs of the same match look different when they are not.
   */
  clear() {
    for (const s of this.pool) this._kill(s);
    this._cursor = 0;
    return this;
  }

  dispose() {
    this.clear();
    for (const s of this.pool) {
      s.mat.dispose();
      if (s.trail) { s.trail.geo.dispose(); s.trail.mat.dispose(); }
    }
    for (const b of this.beams) b.mat.dispose();
    this.boltTex.dispose();
    this.missileTex.dispose();
    this.grenadeTex.dispose();
    this.boltGeo.dispose();
    this.missileGeo.dispose();
    this.grenadeGeo.dispose();
    this.group.removeFromParent();
  }
}

// ============================================================
//  WeaponSystem
// ============================================================

/**
 * One slot per weapon plate, of which exactly ONE is live at a time. The
 * trigger fires the selected plate; a separate action cycles the set, the
 * way a sub-weapon list works. Everything not selected keeps reloading in
 * the background, so switching away is how you cover a reload.
 *
 * Nothing here reaches into the scene beyond the plate's own transform,
 * which keeps the whole thing testable in node.
 */
export class WeaponSystem {
  /** @param {import('./Robot.js').Robot} robot */
  constructor(robot) {
    this.robot = robot;
    /**
     * Where scatter comes from. Handed in by whoever owns the fight so
     * every machine draws from the same replayable stream; a private
     * generator would make the salvo depend on how many machines happened
     * to fire before it.
     */
    this.random = robot.random ?? null;
    this.slots = [];
    /**
     * Rounds this rack has put in the air since it was last zeroed.
     *
     * Counted per ROUND, not per press, so a shotgun's nine pellets are
     * nine — which is what makes it comparable with the nine hits they
     * might land, and lets a run say something about aim.
     */
    this.shotsFired = 0;
    /**
     * True on any frame a round left a barrel, cleared by whoever reads it.
     *
     * Firing was the one thing a machine did that nothing else on it could
     * see: hits were reported and feedback was driven, but the act of
     * shooting reached neither the rig nor the animator, so nothing on a
     * machine could recoil.
     */
    this.firedThisFrame = false;
    /** Which plate the trigger is wired to. */
    this.activeIndex = 0;
    /** 0..1 — how lit the blades are, exported for the rig. */
    this.bladeGlow = 0;
    this.build();
  }

  build() {
    this.slots = [];
    for (const node of this.robot.rig.equipNodes ?? []) {
      const meta = EQUIP_META[node.part.equipType];
      if (!meta || meta.category !== 'weapon') continue;
      this.slots.push({
        node,
        part: node.part,
        type: node.part.equipType,
        meta,
        ammo: meta.ammo ?? 0,
        reloadT: 0,
        cooldown: 0,
        /** Semi-auto plates fire once per press, never on the hold. */
        armed: true,
        /** Continuous weapons overheat instead of running out of rounds. */
        heat: 0,
        /**
         * How long the trigger has been held, as 0..1.
         *
         * The opponents were given burst discipline and the player was not,
         * which left holding the trigger down the strictly best thing to do
         * — the gaps are where the fight is, and only one side had any.
         * This does not reduce damage or refuse to fire: it widens the cone,
         * so a long burst is still a choice and still lands, just loosely.
         */
        warmth: 0,
      });
    }
    this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.slots.length - 1));
    return this;
  }

  get hasWeapons() { return this.slots.length > 0; }

  /** The plate the trigger currently fires, or null on a bare chassis. */
  get active() { return this.slots[this.activeIndex] ?? null; }

  /** Select by index, wrapping. Out-of-range indices wrap rather than throw. */
  select(i) {
    if (!this.slots.length) { this.activeIndex = 0; return null; }
    const n = this.slots.length;
    this.activeIndex = ((i % n) + n) % n;
    return this.active;
  }

  next() { return this.select(this.activeIndex + 1); }
  prev() { return this.select(this.activeIndex - 1); }

  reset() {
    this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.slots.length - 1));
    for (const s of this.slots) {
      s.ammo = s.meta.ammo ?? 0;
      s.reloadT = 0;
      s.cooldown = 0;
      s.armed = true;
      s.warmth = 0;
    }
    this.bladeGlow = 0;
    for (const s of this.slots) s.heat = 0;
    this.robot.shield = null;
    return this;
  }

  /** What the HUD draws: one row per plate, with the live one marked. */
  readout() {
    return this.slots.map((s, i) => ({
      active: i === this.activeIndex,
      // The battle read-out's own name for it. One language on that screen:
      // a katakana word in a strip of monospaced numerals reads as two
      // designs sharing a panel. The editor keeps the Japanese labels.
      label: s.meta.en ?? s.meta.label,
      color: s.part.bulletColor ?? s.meta.accent,
      melee: !!s.meta.dps,
      // A laser has no magazine, so its bar shows how far from overheating
      // it is — which is the number the player is actually managing.
      gauge: s.meta.beam ? 1 - s.heat : null,
      ammo: s.ammo,
      max: s.meta.ammo ?? 0,
      reloading: s.reloadT > 0,
      reloadFrac: s.meta.reload ? 1 - clamp01(s.reloadT / s.meta.reload) : 1,
    }));
  }

  /**
   * @param {object} ctx
   * @param {boolean} ctx.firing        trigger held this frame
   * @param {THREE.Vector3|null} ctx.aimPoint  where the machine is aiming
   * @param {Projectiles} ctx.projectiles
   * @param {Array} ctx.targets         everything shootable
   * @param {object|null} ctx.lockTarget the locked machine, for homing
   */
  update(ctx, dt) {
    let {
      firing = false,
    } = ctx;
    const {
      aimPoint = null, projectiles = null, targets = [],
      lockTarget = null, effects = null, feedback = null,
    } = ctx;
    let blade = 0;

    // World transforms are read straight off the posed rig, so a plate on a
    // swinging arm really does fire from where the arm is pointing. The
    // machine refreshes them once after posing itself; re-forcing a full
    // traversal here only recomputed matrices that were already correct.

    const live = this.active;
    this._shieldTick(targets, dt);

    // A machine that has just been rocked cannot shoot back for a moment.
    // Without this a stagger is decoration: you get knocked halfway across
    // the arena and land the same volley you were going to land anyway, and
    // the heavy weapons buy nothing that the light ones do not.
    if ((this.robot.body?.stagger ?? 0) > STAGGER.fireBlock) firing = false;

    for (const s of this.slots) {
      // Cooldowns and reloads run on EVERY plate, selected or not. Switching
      // away to let something reload is the point of having a set.
      s.cooldown = Math.max(0, s.cooldown - dt);
      // Only weapons that CAN be held matter here: a magnum fires once per
      // press and has nothing to settle down from.
      const auto = !s.meta.semi && (s.meta.interval ?? 1) < 0.25;
      const heating = auto && firing && s === this.active;
      s.warmth = clamp01(s.warmth + (heating ? dt / WARM_UP : -dt / WARM_DOWN));
      // Heat bleeds off whenever the plate is not the one being held down.
      if (s.meta.beam && (s !== live || !firing)) {
        s.heat = Math.max(0, s.heat - dt / Math.max(0.2, s.meta.reload));
      }
      if (s.reloadT > 0) {
        s.reloadT = Math.max(0, s.reloadT - dt);
        if (s.reloadT === 0) s.ammo = s.meta.ammo;
      }

      // A plate you are not holding the trigger on is re-armed, so switching
      // to a semi-auto never carries a stale "already fired this press".
      if (!firing || s !== live) s.armed = true;
      if (s !== live || !firing) continue;

      if (s.meta.dps) {
        // ---- blade: no ammo, no projectile. Contact damage while held.
        blade = 1;
        this._blade(s, targets, dt, effects);
        continue;
      }

      if (s.meta.beam) {
        // ---- laser: a line that exists while the trigger is down, paid
        // for in heat rather than rounds.
        if (s.reloadT <= 0) this._laser(s, { aimPoint, projectiles, targets, lockTarget, effects }, dt);
        continue;
      }

      if (s.reloadT > 0 || s.cooldown > 0) continue;
      if (!s.meta.auto && !s.armed) continue;
      if (s.ammo <= 0) { s.reloadT = s.meta.reload; continue; }

      if (s.meta.shield) this._raiseShield(s);
      else this._shoot(s, { aimPoint, projectiles, lockTarget, effects, feedback });
      s.ammo--;
      s.cooldown = s.meta.interval;
      s.armed = false;
      if (s.ammo <= 0) s.reloadT = s.meta.reload;
    }

    // Ramp rather than snap: a blade that pops on is a blade that looks like
    // a bug rather than a weapon coming alive.
    const rate = blade > this.bladeGlow ? 9 : 5;
    this.bladeGlow += (blade - this.bladeGlow) * Math.min(1, rate * dt);
    this.robot.rig.setBladeGlow?.(this.bladeGlow);
    return this;
  }

  /**
   * Where a plate's shots leave from, and which way they go.
   *
   * With a target locked each weapon solves its OWN intercept, because the
   * flight time depends on how fast that particular weapon's round travels —
   * the machine's aim assist leads for steering, which is a different
   * problem and, at range, a different point in space. Two passes of
   * fixed-point iteration is plenty: the third moves the answer by
   * centimetres.
   *
   * And then it deliberately aims SHORT of the answer, by the weapon's own
   * lead figure. A gun that solves the intercept exactly cannot be dodged —
   * the round is already going wherever the target is about to be, so the
   * lock does the fighting and the player watches. Aiming short leaves the
   * shot going somewhere the target can choose not to be, which is the
   * whole game: a machine that keeps moving is missed, one that stands
   * still is not. See WEAPON_LEAD_DEFAULT.
   */
  muzzle(slot, ctx, outPos = new THREE.Vector3(), outDir = new THREE.Vector3()) {
    const { aimPoint = null, lockTarget = null } = ctx ?? {};
    slot.node.plate.getWorldPosition(outPos);

    const speed = slot.meta.speed;
    if (lockTarget?.alive && speed > 0) {
      _lead.copy(lockTarget.position);
      let t = outPos.distanceTo(_lead) / speed;
      for (let i = 0; i < 2; i++) {
        _lead.copy(lockTarget.position).addScaledVector(lockTarget.velocity ?? _zero, t);
        t = outPos.distanceTo(_lead) / speed;
      }
      // Back off the intercept toward where the target actually IS.
      _lead.copy(lockTarget.position)
        .addScaledVector(lockTarget.velocity ?? _zero, t * weaponLead(slot.meta));
      outDir.copy(_lead).sub(outPos);
    } else if (aimPoint) {
      outDir.copy(aimPoint).sub(outPos);
    } else {
      // Where you are LOOKING, not where the chassis is pointed: on the
      // ground those are different, and shooting at your feet because the
      // legs are level is not what anyone means by "fire".
      outDir.copy(this.robot.body.aimForward ?? this.robot.body.forward);
    }

    if (outDir.lengthSq() < 1e-6) outDir.copy(this.robot.body.forward);
    outDir.normalize();
    return { position: outPos, direction: outDir };
  }

  _shoot(slot, ctx) {
    const { projectiles, lockTarget, effects = null, feedback = null } = ctx;
    if (!projectiles) return;
    const meta = slot.meta;
    const { position, direction } = this.muzzle(slot, ctx);
    const color = slot.part.bulletColor ?? meta.bullet;
    const scale = slot.part.size / 0.7;
    const shots = meta.shots ?? 1;

    // The flash belongs to the PLATE, not to the round: a shotgun throwing
    // nine pellets fires once, and nine flashes stacked on one barrel is a
    // white blob rather than a gun going off.
    const heft = Math.min(1.4, meta.damage * (meta.shots ?? 1) / 40);
    effects?.muzzle(position, direction, { scale: scale * (0.5 + heft), color });
    // How big it sounds is how hard it hits, not how big the plate is.
    feedback?.fire?.(heft / 1.4, this.robot.isPlayer);

    // Local frame of the shot: right, then up. Used for both the deliberate
    // fan of a shotgun and the random scatter of a gatling.
    _right.crossVectors(direction, _up);
    if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
    _right.normalize();
    _localUp.crossVectors(_right, direction).normalize();

    const bloom = 1 + (slot?.warmth ?? 0) * WARM_BLOOM;
    for (let i = 0; i < shots; i++) {
      _dir.copy(direction);
      if (meta.spread) {
        if (shots > 1) {
          // A deliberate fan: odd counts keep one pellet dead centre.
          _dir.applyAxisAngle(_localUp, (i - (shots - 1) / 2) * meta.spread * bloom);
        } else {
          // Scatter in both axes, so held fire reads as a stream not a line.
          const rng = this.random;
          _dir.applyAxisAngle(_localUp, (rng ? rng.signed() * 0.5 : 0) * meta.spread * bloom);
          _dir.applyAxisAngle(_right, (rng ? rng.signed() * 0.5 : 0) * meta.spread * bloom);
        }
      }
      this.shotsFired++;
      this.firedThisFrame = true;
      // A salvo is thrown WIDE and then homes back in. Without the scatter
      // five homing missiles fly as one missile with five sprites in it.
      let speed = meta.speed;
      if (meta.scatter && shots > 1) {
        const rng = this.random;
        _dir.applyAxisAngle(direction, (i / shots) * Math.PI * 2);
        _dir.applyAxisAngle(_right, (rng ? rng.signed() * 0.5 : 0) * meta.scatter);
        if (rng) speed *= 0.8 + rng.unit() * 0.4;
      }
      projectiles.spawn({
        position,
        direction: _dir,
        speed,
        life: meta.life,
        damage: meta.damage,
        radius: meta.radius * scale,
        color,
        kind: meta.shape ?? (meta.turn ? 'missile' : 'bolt'),
        streak: (meta.streak ?? 0) * scale,
        gravity: meta.gravity ?? 0,
        blast: meta.blast ?? null,
        trail: meta.trail ?? null,
        turn: meta.turn ?? 0,
        target: meta.turn ? lockTarget : null,
        owner: this.robot,
      });
    }
  }

  /**
   * The laser. A hitscan line out to `range`, damaging the first machine it
   * crosses for as long as it is held.
   *
   * Held fire is billed as HEAT rather than ammunition: the interesting
   * decision with a continuous weapon is when to let go, and a magazine
   * cannot express that.
   */
  _laser(slot, ctx, dt) {
    const {
      projectiles = null, targets = [], aimPoint = null, lockTarget = null, effects = null,
    } = ctx;
    const spec = slot.meta.beam;
    const { position, direction } = this.muzzle(slot, { aimPoint, lockTarget });

    slot.heat = clamp01(slot.heat + spec.drain * dt);
    if (slot.heat >= 1) {
      // Overheated: it stops, and the cool-down is a full reload.
      slot.reloadT = slot.meta.reload;
      slot.heat = 1;
      return;
    }

    _to.copy(position).addScaledVector(direction, spec.range);
    let hit = null;
    let best = Infinity;
    for (const t of targets) {
      if (!t || t === this.robot || !t.alive) continue;
      _hitAt.copy(t.position);
      _hitAt.y += t.hitOffsetY ?? 0;
      if (segmentHitsCapsule(
        position, _to, _hitAt, t.hitHalfHeight ?? 0,
        (t.hitRadius ?? t.radius) + spec.width, _near,
      ) === null) continue;
      const d = position.distanceTo(t.position);
      if (d < best) { best = d; hit = t; }
    }
    if (hit) {
      hit.damage(spec.dps * dt, position);
      _to.copy(position).addScaledVector(direction, Math.max(1, best));
      // A shower where it lands, thinned out in time. Every frame would
      // recycle the whole pool into one spot and leave nothing for the
      // rounds arriving anywhere else.
      slot.sparkT = (slot.sparkT ?? 0) - dt;
      if (effects && slot.sparkT <= 0) {
        slot.sparkT = 0.06;
        effects.impact(_near, direction, {
          color: slot.part.bulletColor ?? slot.meta.bullet, scale: 0.5, life: 0.16,
        });
      }
    }
    projectiles?.beam({
      from: position, to: _to,
      width: spec.width * (slot.part.size / 0.7),
      color: slot.part.bulletColor ?? slot.meta.bullet,
    });
    slot.lastBeam = { from: position.clone(), to: _to.clone(), hit: !!hit };
  }

  /** Put the barrier up. It runs on a clock from here on, not on the trigger. */
  _raiseShield(slot) {
    const spec = slot.meta.shield;
    const scale = slot.part.size / 0.7;
    this.robot.shield = {
      hp: spec.hp * scale,
      maxHp: spec.hp * scale,
      t: spec.seconds,
      seconds: spec.seconds,
      ram: spec.ram,
      reach: spec.reach * scale,
      color: slot.part.bulletColor ?? slot.meta.accent,
    };
  }

  /**
   * Run the barrier: count it down, and hurt whatever the machine drives
   * into while it is up. Ramming damage scales with closing speed, so a
   * shield is a weapon for a machine that is actually moving.
   */
  _shieldTick(targets, dt) {
    const sh = this.robot.shield;
    if (!sh) return;
    sh.t -= dt;
    if (sh.t <= 0 || sh.hp <= 0) { this.robot.shield = null; return; }

    const speed = this.robot.body?.speed ?? 0;
    const bite = sh.ram * dt * clamp01(0.3 + speed / 18);
    for (const t of targets) {
      if (!t || t === this.robot || !t.alive) continue;
      if (this.robot.position.distanceTo(t.position) > this.robot.radius + sh.reach + t.radius) continue;
      t.damage(bite, this.robot.position);
    }
  }

  _blade(slot, targets, dt, effects = null) {
    const reach = slot.meta.reach * (slot.part.size / 0.7);
    slot.node.plate.getWorldPosition(_v);
    slot.sparkT = (slot.sparkT ?? 0) - dt;
    for (const t of targets) {
      if (!t || t === this.robot || !t.alive) continue;
      if (_v.distanceTo(t.position) > t.radius + reach) continue;
      t.damage(slot.meta.dps * dt, _v);
      // Sparks off the blade itself, thinned in time the way the laser's are.
      if (effects && slot.sparkT <= 0) {
        slot.sparkT = 0.05;
        _to.copy(t.position).sub(_v);
        effects.impact(_v, _to, {
          color: slot.part.bulletColor ?? slot.meta.bullet, scale: 0.6, life: 0.18,
        });
      }
    }
  }
}
