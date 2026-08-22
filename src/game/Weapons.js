import * as THREE from 'three';
import { EQUIP_META } from '../core/constants.js';
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
const _up = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Vector3();

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

    /** @type {Array<object>} every slot, live or not */
    this.pool = [];
    for (let i = 0; i < max; i++) this.pool.push(this._makeSlot());
    this._cursor = 0;
    /** Hits accumulated this frame, for the caller to turn into feedback. */
    this.hits = [];
  }

  _makeSlot() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.boltGeo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return {
      mesh, mat, life: 0, kind: 'bolt',
      velocity: new THREE.Vector3(),
      damage: 0, radius: 0.2, speed: 0, turn: 0, owner: null, target: null,
    };
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
  }) {
    const s = this._take();
    s.kind = kind;
    s.life = life;
    s.maxLife = life;
    s.damage = damage;
    s.radius = radius;
    s.speed = speed;
    s.turn = turn;
    s.owner = owner;
    s.target = target;

    s.velocity.copy(direction).normalize().multiplyScalar(speed);
    s.mesh.geometry = kind === 'missile' ? this.missileGeo : this.boltGeo;
    s.mesh.position.copy(position);
    s.mat.color.setHex(color);
    s.mat.opacity = 0.95;
    s.mesh.visible = true;
    this._orient(s);
    return s;
  }

  _orient(s) {
    _dir.copy(s.velocity);
    if (_dir.lengthSq() < 1e-8) return;
    _dir.normalize();
    s.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _dir);
    if (s.kind === 'missile') {
      const k = s.radius;
      s.mesh.scale.set(k * 0.5, k * 0.5, k * 0.9);
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

    for (const s of this.pool) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { this._kill(s); continue; }

      // ---- homing: steer, never teleport. A missile you cannot outrun is
      // not a missile, it is a cutscene.
      if (s.turn > 0 && s.target?.alive) {
        _to.copy(s.target.position).sub(s.mesh.position);
        if (_to.lengthSq() > 1e-6) {
          _to.normalize();
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
      }

      _prev.copy(s.mesh.position);
      s.mesh.position.addScaledVector(s.velocity, dt);
      this._orient(s);
      s.mat.opacity = 0.35 + clamp01(s.life / Math.max(0.001, s.maxLife)) * 0.6;

      // ---- terrain
      const p = s.mesh.position;
      const groundY = this.world?.groundHeight?.(p.x, p.z) ?? 0;
      if (p.y <= groundY + 0.05 || Math.hypot(p.x, p.z) > r + 8) {
        this.hits.push({ position: p.clone(), robot: null, damage: 0 });
        this._kill(s);
        continue;
      }

      // ---- machines
      // Swept, not sampled: a gatling round covers three metres in a frame,
      // which is further than some machines are wide. Testing only the
      // endpoint would let fast rounds pass straight through small targets.
      for (const t of targets) {
        if (!t || t === s.owner || !t.alive) continue;
        if (this._sweepHits(_prev, p, t.position, t.radius + s.radius) === null) continue;
        t.damage(s.damage);
        this.hits.push({ position: _near.clone(), robot: t, damage: s.damage });
        this._kill(s);
        break;
      }
    }
    return this;
  }

  /**
   * Closest approach of the segment a→b to a sphere. Returns the point of
   * contact (in the shared temp `_near`) or null.
   */
  _sweepHits(a, b, centre, radius) {
    _seg.copy(b).sub(a);
    const len2 = _seg.lengthSq();
    let u = 0;
    if (len2 > 1e-9) {
      u = clamp01(_v.copy(centre).sub(a).dot(_seg) / len2);
    }
    _near.copy(a).addScaledVector(_seg, u);
    return _near.distanceTo(centre) <= radius ? _near : null;
  }

  _kill(s) {
    s.life = 0;
    s.target = null;
    s.owner = null;
    s.mesh.visible = false;
  }

  get liveCount() { return this.pool.reduce((n, s) => n + (s.life > 0 ? 1 : 0), 0); }

  clear() { for (const s of this.pool) this._kill(s); return this; }

  dispose() {
    this.clear();
    for (const s of this.pool) s.mat.dispose();
    this.boltGeo.dispose();
    this.missileGeo.dispose();
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
    this.slots = [];
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
    }
    this.bladeGlow = 0;
    return this;
  }

  /** What the HUD draws: one row per plate, with the live one marked. */
  readout() {
    return this.slots.map((s, i) => ({
      active: i === this.activeIndex,
      label: s.meta.label,
      color: s.part.bulletColor ?? s.meta.accent,
      melee: !!s.meta.dps,
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
    const { firing = false, aimPoint = null, projectiles = null, targets = [], lockTarget = null } = ctx;
    let blade = 0;

    // World transforms are read straight off the posed rig, so a plate on a
    // swinging arm really does fire from where the arm is pointing.
    this.robot.object3D.updateMatrixWorld(true);

    const live = this.active;

    for (const s of this.slots) {
      // Cooldowns and reloads run on EVERY plate, selected or not. Switching
      // away to let something reload is the point of having a set.
      s.cooldown = Math.max(0, s.cooldown - dt);
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
        this._blade(s, targets, dt);
        continue;
      }

      if (s.reloadT > 0 || s.cooldown > 0) continue;
      if (!s.meta.auto && !s.armed) continue;
      if (s.ammo <= 0) { s.reloadT = s.meta.reload; continue; }

      this._shoot(s, { aimPoint, projectiles, lockTarget });
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
   * lead depends on how fast that particular weapon's round travels — the
   * machine's aim assist leads for steering, which is a different problem
   * and, at range, a different point in space. Two passes of fixed-point
   * iteration is plenty: the third moves the answer by centimetres.
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
    const { projectiles, lockTarget } = ctx;
    if (!projectiles) return;
    const meta = slot.meta;
    const { position, direction } = this.muzzle(slot, ctx);
    const color = slot.part.bulletColor ?? meta.bullet;
    const scale = slot.part.size / 0.7;
    const shots = meta.shots ?? 1;

    // Local frame of the shot: right, then up. Used for both the deliberate
    // fan of a shotgun and the random scatter of a gatling.
    _right.crossVectors(direction, _up);
    if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
    _right.normalize();
    _localUp.crossVectors(_right, direction).normalize();

    for (let i = 0; i < shots; i++) {
      _dir.copy(direction);
      if (meta.spread) {
        if (shots > 1) {
          // A deliberate fan: odd counts keep one pellet dead centre.
          _dir.applyAxisAngle(_localUp, (i - (shots - 1) / 2) * meta.spread);
        } else {
          // Scatter in both axes, so held fire reads as a stream not a line.
          _dir.applyAxisAngle(_localUp, (Math.random() - 0.5) * meta.spread);
          _dir.applyAxisAngle(_right, (Math.random() - 0.5) * meta.spread);
        }
      }
      projectiles.spawn({
        position,
        direction: _dir,
        speed: meta.speed,
        life: meta.life,
        damage: meta.damage,
        radius: meta.radius * scale,
        color,
        kind: meta.turn ? 'missile' : 'bolt',
        turn: meta.turn ?? 0,
        target: meta.turn ? lockTarget : null,
        owner: this.robot,
      });
    }
  }

  _blade(slot, targets, dt) {
    const reach = slot.meta.reach * (slot.part.size / 0.7);
    slot.node.plate.getWorldPosition(_v);
    for (const t of targets) {
      if (!t || t === this.robot || !t.alive) continue;
      if (_v.distanceTo(t.position) > t.radius + reach) continue;
      t.damage(slot.meta.dps * dt);
    }
  }
}
