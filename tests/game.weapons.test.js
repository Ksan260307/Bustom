import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Projectiles, WeaponSystem } from '../src/game/Weapons.js';
import { Robot } from '../src/game/Robot.js';
import { Assembly, PRESETS, computeStats, _resetIds } from '../src/core/Assembly.js';
import { EQUIP, EQUIP_META, WEAPON_TYPES } from '../src/core/constants.js';
import { testWorld, stripEquips } from './helpers/dom.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** A stand-in for a Robot, as far as the projectile pool is concerned. */
function dummy(x = 0, y = 0, z = 0, radius = 2) {
  return {
    position: V(x, y, z),
    velocity: V(),
    radius,
    alive: true,
    hp: 100,
    damage(n) { this.hp -= n; if (this.hp <= 0) this.alive = false; },
  };
}

function pool(max = 12) {
  return new Projectiles(new THREE.Scene(), testWorld(), { max });
}

// ============================================================
//  Projectiles
// ============================================================

describe('Projectiles', () => {
  let p;
  beforeEach(() => { p = pool(); });

  it('starts empty and invisible', () => {
    expect(p.liveCount).toBe(0);
    expect(p.pool.every((s) => !s.mesh.visible)).toBe(true);
  });

  it('spawns a shot travelling the way it was pointed', () => {
    const s = p.spawn({ position: V(0, 5, 0), direction: V(0, 0, 3), speed: 40, life: 1 });
    expect(p.liveCount).toBe(1);
    expect(s.mesh.visible).toBe(true);
    expect(s.velocity.z).toBeCloseTo(40, 5);   // direction is normalised for us
    p.update(0.5, []);
    expect(s.mesh.position.z).toBeCloseTo(20, 3);
  });

  it('expires on its own lifetime', () => {
    p.spawn({ position: V(0, 5, 0), direction: V(0, 0, 1), speed: 10, life: 0.2 });
    p.update(0.3, []);
    expect(p.liveCount).toBe(0);
  });

  it('damages the first machine it reaches, then stops', () => {
    const a = dummy(0, 5, 10);
    const b = dummy(0, 5, 20);
    p.spawn({ position: V(0, 5, 0), direction: V(0, 0, 1), speed: 100, damage: 12, life: 2 });
    // One 0.2s step covers 20m: it passes THROUGH a and ends up past b, so
    // this only works if the sweep is honest about the whole segment.
    p.update(0.2, [a, b]);
    expect(a.hp).toBe(88);
    expect(b.hp, 'a bolt is not a railgun').toBe(100);
    expect(p.liveCount).toBe(0);
    expect(p.hits).toHaveLength(1);
    expect(p.hits[0].robot).toBe(a);
  });

  it('never shoots its own owner', () => {
    const me = dummy(0, 5, 1);
    p.spawn({ position: V(0, 5, 0), direction: V(0, 0, 1), speed: 30, damage: 9, owner: me, life: 2 });
    p.update(0.2, [me]);
    expect(me.hp).toBe(100);
  });

  it('ignores the dead', () => {
    const gone = dummy(0, 5, 5);
    gone.alive = false;
    p.spawn({ position: V(0, 5, 0), direction: V(0, 0, 1), speed: 60, damage: 9, life: 2 });
    p.update(0.2, [gone]);
    expect(gone.hp).toBe(100);
  });

  it('dies on the ground rather than tunnelling under the field', () => {
    p.spawn({ position: V(0, 2, 0), direction: V(0, -1, 0), speed: 40, life: 3 });
    p.update(0.2, []);
    expect(p.liveCount).toBe(0);
    expect(p.hits[0].robot).toBeNull();
  });

  it('dies outside the arena', () => {
    p.spawn({ position: V(0, 8, 0), direction: V(1, 0, 0), speed: 400, life: 5 });
    p.update(0.5, []);
    expect(p.liveCount).toBe(0);
  });

  it('a homing round turns toward its target instead of teleporting', () => {
    const t = dummy(40, 8, 0);
    const m = p.spawn({
      position: V(0, 8, 0), direction: V(0, 0, 1), speed: 30, life: 6,
      turn: 3.1, target: t, damage: 5, radius: 0.3,
    });
    // one step: it must have turned, but nowhere near all the way
    p.update(1 / 60, [t]);
    const dir = m.velocity.clone().normalize();
    expect(dir.x, 'has begun to turn').toBeGreaterThan(0.001);
    expect(dir.x, 'but not snapped round').toBeLessThan(0.3);

    let d = Infinity;
    for (let i = 0; i < 200 && m.life > 0; i++) {
      p.update(1 / 60, [t]);
      d = Math.min(d, m.mesh.position.distanceTo(t.position));
    }
    expect(t.hp, 'and it eventually connects').toBeLessThan(100);
  });

  it('a homing round with a dead target simply flies on', () => {
    const t = dummy(40, 8, 0);
    t.alive = false;
    const m = p.spawn({
      position: V(0, 8, 0), direction: V(0, 0, 1), speed: 30, life: 2, turn: 3.1, target: t,
    });
    p.update(0.2, [t]);
    expect(m.velocity.clone().normalize().z).toBeCloseTo(1, 3);
  });

  it('recycles the oldest slot rather than dropping a shot', () => {
    const small = pool(3);
    for (let i = 0; i < 5; i++) {
      small.spawn({ position: V(0, 9, 0), direction: V(0, 0, 1), speed: 5, life: 9 });
    }
    expect(small.liveCount).toBe(3);
  });

  it('clear and dispose leave nothing live', () => {
    p.spawn({ position: V(0, 5, 0), direction: V(0, 0, 1), speed: 10, life: 5 });
    p.clear();
    expect(p.liveCount).toBe(0);
    expect(() => p.dispose()).not.toThrow();
  });
});

// ============================================================
//  WeaponSystem
// ============================================================

describe('WeaponSystem', () => {
  let world;

  beforeEach(() => { _resetIds(0); world = testWorld(); });

  /** A machine carrying the listed plates and nothing else. */
  const machine = (...types) => {
    const a = stripEquips(PRESETS.biped.build());
    for (const t of types) a.addEquipOnFace(a.core.id, 4, t, { size: 0.7 });
    return new Robot(a, world, { isPlayer: true });
  };

  const ctx = (over = {}) => ({
    firing: false, aimPoint: null, projectiles: null, targets: [], lockTarget: null, ...over,
  });

  it('makes one slot per weapon plate, and ignores the systems', () => {
    const r = machine(EQUIP.BEAM, EQUIP.GATLING, EQUIP.BOOST, EQUIP.GRAVITY);
    expect(r.weapons.slots.map((s) => s.type)).toEqual([EQUIP.BEAM, EQUIP.GATLING]);
    expect(r.weapons.hasWeapons).toBe(true);
  });

  it('a machine with no plates has no weapons at all', () => {
    const r = new Robot(stripEquips(PRESETS.biped.build()), world);
    expect(r.weapons.hasWeapons).toBe(false);
    expect(r.weapons.readout()).toEqual([]);
  });

  it('starts with full magazines', () => {
    const r = machine(EQUIP.BEAM);
    expect(r.weapons.slots[0].ammo).toBe(EQUIP_META.beam.ammo);
  });

  it('a held trigger fires the gatling over and over', () => {
    const r = machine(EQUIP.GATLING);
    const p = pool(64);
    for (let i = 0; i < 60; i++) r.weapons.update(ctx({ firing: true, projectiles: p }), 1 / 60);
    // one second at a 0.07s interval is about fourteen rounds
    expect(30 - r.weapons.slots[0].ammo).toBeGreaterThan(10);
  });

  it('a held trigger fires the beam exactly once', () => {
    const r = machine(EQUIP.BEAM);
    const p = pool(64);
    for (let i = 0; i < 60; i++) r.weapons.update(ctx({ firing: true, projectiles: p }), 1 / 60);
    expect(r.weapons.slots[0].ammo, 'one round gone').toBe(EQUIP_META.beam.ammo - 1);
  });

  it('releasing and pressing again fires the beam again', () => {
    const r = machine(EQUIP.BEAM);
    const p = pool(64);
    const pull = () => {
      for (let i = 0; i < 20; i++) r.weapons.update(ctx({ firing: true, projectiles: p }), 1 / 60);
      for (let i = 0; i < 5; i++) r.weapons.update(ctx({ firing: false, projectiles: p }), 1 / 60);
    };
    pull(); pull(); pull();
    expect(r.weapons.slots[0].ammo, 'three presses, three rounds').toBe(EQUIP_META.beam.ammo - 3);
  });

  it('runs dry, reloads on its own, and comes back full', () => {
    const r = machine(EQUIP.SHOT);
    const p = pool(64);
    const slot = r.weapons.slots[0];
    for (let i = 0; i < 6; i++) {
      r.weapons.update(ctx({ firing: true, projectiles: p }), 0.5);
      r.weapons.update(ctx({ firing: false, projectiles: p }), 1 / 60);
    }
    expect(slot.ammo).toBe(0);
    expect(slot.reloadT).toBeGreaterThan(0);

    for (let i = 0; i < 200; i++) r.weapons.update(ctx({ firing: false, projectiles: p }), 1 / 60);
    expect(slot.reloadT).toBe(0);
    expect(slot.ammo).toBe(EQUIP_META.shot.ammo);
  });

  it('a shot plate throws three pellets on one trigger pull', () => {
    const r = machine(EQUIP.SHOT);
    const p = pool(64);
    r.weapons.update(ctx({ firing: true, projectiles: p }), 1 / 60);
    expect(p.liveCount).toBe(3);
    // and they genuinely fan out
    const dirs = p.pool.filter((s) => s.life > 0).map((s) => s.velocity.clone().normalize());
    expect(dirs[0].distanceTo(dirs[2])).toBeGreaterThan(0.05);
  });

  it('fires in the plate colour the player chose', () => {
    const a = stripEquips(PRESETS.biped.build());
    a.addEquipOnFace(a.core.id, 4, EQUIP.BEAM, { bulletColor: 0x6bff6b });
    const r = new Robot(a, world);
    const p = pool(8);
    r.weapons.update(ctx({ firing: true, projectiles: p }), 1 / 60);
    const shot = p.pool.find((s) => s.life > 0);
    expect(shot.mat.color.getHex()).toBe(0x6bff6b);
  });

  it('leads a moving target by its own projectile speed', () => {
    const r = machine(EQUIP.BEAM);
    const slow = machine(EQUIP.MISSILE);
    const target = dummy(0, 5, 60);
    target.velocity.set(30, 0, 0);

    const fast = r.weapons.muzzle(r.weapons.slots[0], { lockTarget: target });
    const lazy = slow.weapons.muzzle(slow.weapons.slots[0], { lockTarget: target });

    // Both lead the same way; the slower round has to lead much further.
    expect(fast.direction.x).toBeGreaterThan(0);
    expect(lazy.direction.x).toBeGreaterThan(fast.direction.x);
  });

  it('with no lock it fires where the machine is pointed', () => {
    const r = machine(EQUIP.BEAM);
    const { direction } = r.weapons.muzzle(r.weapons.slots[0], {});
    expect(direction.dot(r.body.forward)).toBeCloseTo(1, 3);
  });

  it('a blade burns nothing and damages what it touches', () => {
    const r = machine(EQUIP.BLADE);
    r.object3D.updateMatrixWorld(true);
    const at = r.weapons.slots[0].node.plate.getWorldPosition(new THREE.Vector3());
    const near = dummy(at.x, at.y, at.z + 1.0, 1.0);
    const far = dummy(at.x, at.y, at.z + 40, 1.0);
    for (let i = 0; i < 30; i++) {
      r.weapons.update(ctx({ firing: true, targets: [near, far] }), 1 / 60);
    }
    expect(near.hp).toBeLessThan(100);
    expect(far.hp).toBe(100);
    expect(r.weapons.slots[0].ammo, 'no magazine to run down').toBe(0);
  });

  it('a blade lights up while held and fades when let go', () => {
    const r = machine(EQUIP.BLADE);
    for (let i = 0; i < 30; i++) r.weapons.update(ctx({ firing: true }), 1 / 60);
    expect(r.weapons.bladeGlow).toBeGreaterThan(0.8);
    for (let i = 0; i < 60; i++) r.weapons.update(ctx({ firing: false }), 1 / 60);
    expect(r.weapons.bladeGlow).toBeLessThan(0.05);
  });

  it('a blade never hits its own machine', () => {
    const r = machine(EQUIP.BLADE);
    const before = r.hp;
    for (let i = 0; i < 30; i++) r.weapons.update(ctx({ firing: true, targets: [r] }), 1 / 60);
    expect(r.hp).toBe(before);
  });

  it('starts on the first plate, and cycles both ways', () => {
    const r = machine(EQUIP.BEAM, EQUIP.GATLING, EQUIP.SHOT);
    const w = r.weapons;
    expect(w.active.type).toBe(EQUIP.BEAM);
    expect(w.next().type).toBe(EQUIP.GATLING);
    expect(w.next().type).toBe(EQUIP.SHOT);
    expect(w.next().type, 'wraps forward').toBe(EQUIP.BEAM);
    expect(w.prev().type, 'and backward').toBe(EQUIP.SHOT);
    expect(w.select(1).type).toBe(EQUIP.GATLING);
    expect(w.select(7).type, 'out of range wraps rather than throws').toBe(EQUIP.GATLING);
    expect(w.select(-1).type).toBe(EQUIP.SHOT);
  });

  it('a machine with no plates has nothing to cycle', () => {
    const r = new Robot(stripEquips(PRESETS.biped.build()), world);
    expect(r.weapons.active).toBeNull();
    expect(r.weapons.next()).toBeNull();
    expect(() => r.weapons.update(ctx({ firing: true }), 1 / 60)).not.toThrow();
  });

  it('only the selected plate answers the trigger', () => {
    const r = machine(EQUIP.BEAM, EQUIP.SHOT);
    const p = pool(64);
    r.weapons.select(1);
    r.weapons.update(ctx({ firing: true, projectiles: p }), 1 / 60);
    expect(r.weapons.slots[0].ammo, 'the beam never fired').toBe(EQUIP_META.beam.ammo);
    expect(r.weapons.slots[1].ammo).toBe(EQUIP_META.shot.ammo - 1);
    expect(p.liveCount, 'three pellets, from the shot plate only').toBe(3);
  });

  it('a plate keeps reloading while you are using another one', () => {
    const r = machine(EQUIP.SHOT, EQUIP.BEAM);
    const p = pool(64);
    const shot = r.weapons.slots[0];

    // empty the shot plate
    for (let i = 0; i < 6; i++) {
      r.weapons.update(ctx({ firing: true, projectiles: p }), 0.5);
      r.weapons.update(ctx({ firing: false, projectiles: p }), 1 / 60);
    }
    expect(shot.reloadT).toBeGreaterThan(0);

    // switch away and keep fighting; the reload runs in the background
    r.weapons.select(1);
    for (let i = 0; i < 240; i++) {
      r.weapons.update(ctx({ firing: i % 20 < 2, projectiles: p }), 1 / 60);
    }
    expect(shot.reloadT).toBe(0);
    expect(shot.ammo).toBe(EQUIP_META.shot.ammo);
  });

  it('switching mid-hold does not spend the new plate until you press again', () => {
    const r = machine(EQUIP.BEAM, EQUIP.SHOT);
    const p = pool(64);
    // hold the trigger on the beam
    for (let i = 0; i < 30; i++) r.weapons.update(ctx({ firing: true, projectiles: p }), 1 / 60);
    expect(r.weapons.slots[0].ammo, 'one round gone').toBe(EQUIP_META.beam.ammo - 1);

    r.weapons.select(1);
    for (let i = 0; i < 30; i++) r.weapons.update(ctx({ firing: true, projectiles: p }), 1 / 60);
    expect(r.weapons.slots[1].ammo, 'a semi-auto fires once per press').toBe(EQUIP_META.shot.ammo - 1);
  });

  it('only the selected blade lights up', () => {
    const r = machine(EQUIP.BEAM, EQUIP.BLADE);
    for (let i = 0; i < 30; i++) r.weapons.update(ctx({ firing: true }), 1 / 60);
    expect(r.weapons.bladeGlow, 'the beam is selected, so no glow').toBeLessThan(0.05);

    r.weapons.select(1);
    for (let i = 0; i < 30; i++) r.weapons.update(ctx({ firing: true }), 1 / 60);
    expect(r.weapons.bladeGlow).toBeGreaterThan(0.8);
  });

  it('reports a row per plate for the HUD', () => {
    const r = machine(EQUIP.BEAM, EQUIP.BLADE);
    const rows = r.weapons.readout();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      label: EQUIP_META.beam.label, ammo: EQUIP_META.beam.ammo,
      max: EQUIP_META.beam.ammo, reloading: false, melee: false,
    });
    expect(rows[1].melee).toBe(true);
    expect(rows.map((x) => x.active), 'and marks the live one').toEqual([true, false]);
    r.weapons.next();
    expect(r.weapons.readout().map((x) => x.active)).toEqual([false, true]);
  });

  it('rearm refills everything mid-fight', () => {
    const r = machine(EQUIP.BEAM);
    const p = pool(8);
    r.weapons.update(ctx({ firing: true, projectiles: p }), 1 / 60);
    expect(r.weapons.slots[0].ammo, 'one round gone').toBe(EQUIP_META.beam.ammo - 1);
    r.rearm();
    expect(r.weapons.slots[0].ammo).toBe(EQUIP_META.beam.ammo);
    expect(r.weapons.bladeGlow).toBe(0);
  });

  it('firing with no projectile pool is a no-op, not a crash', () => {
    const r = machine(EQUIP.BEAM);
    expect(() => r.weapons.update(ctx({ firing: true }), 1 / 60)).not.toThrow();
  });
});

// ============================================================
//  What the plates do to the machine carrying them
// ============================================================

describe('equipment effects', () => {
  const withPlates = (...types) => {
    const a = stripEquips(PRESETS.biped.build());
    for (const t of types) a.addEquipOnFace(a.core.id, 4, t);
    return a;
  };

  it('boost plates stack into a bigger dash', () => {
    const one = computeStats(withPlates(EQUIP.BOOST));
    const two = computeStats(withPlates(EQUIP.BOOST, EQUIP.BOOST));
    expect(one.dashBonus).toBeCloseTo(EQUIP_META.boost.dashBonus, 6);
    expect(two.dashBonus).toBeCloseTo(EQUIP_META.boost.dashBonus * 2, 6);
    expect(computeStats(stripEquips(PRESETS.biped.build())).dashBonus).toBe(0);
  });

  it('a gravity plate trades flight for durability', () => {
    const s = computeStats(withPlates(EQUIP.GRAVITY));
    expect(s.noFly).toBe(true);
    expect(s.hpBonus).toBeCloseTo(EQUIP_META.gravity.hpBonus, 6);

    const bare = new Robot(stripEquips(PRESETS.biped.build()), testWorld());
    const heavy = new Robot(withPlates(EQUIP.GRAVITY), testWorld());
    expect(heavy.hp).toBeGreaterThan(bare.hp * 1.3);
    expect(heavy.body.noFly).toBe(true);
    expect(bare.body.noFly).toBe(false);
  });

  it('only one gravity plate can ever be fitted', () => {
    const a = stripEquips(PRESETS.biped.build());
    expect(a.addEquipOnFace(a.core.id, 4, EQUIP.GRAVITY)).toBeTruthy();
    expect(a.addEquipOnFace(a.core.id, 2, EQUIP.GRAVITY)).toBeNull();
    expect(a.countEquip(EQUIP.GRAVITY)).toBe(1);
    expect(computeStats(a).gravityPlates).toBe(1);
  });

  it('plates make the machine heavier', () => {
    const bare = computeStats(stripEquips(PRESETS.biped.build()));
    const loaded = computeStats(withPlates(EQUIP.MISSILE, EQUIP.MISSILE, EQUIP.GRAVITY));
    expect(loaded.mass).toBeGreaterThan(bare.mass);
    expect(loaded.equipCount).toBe(3);
    expect(loaded.weaponCount).toBe(2);
  });

  it('a float plate holds the machine off the floor', () => {
    const s = computeStats(withPlates(EQUIP.FLOAT));
    expect(s.floatPlates).toBe(1);
    expect(s.hoverHeight).toBeCloseTo(EQUIP_META.float.hover, 6);
    expect(computeStats(stripEquips(PRESETS.biped.build())).hoverHeight).toBe(0);
  });

  it('gravity and float refuse to share a machine', () => {
    const a = stripEquips(PRESETS.biped.build());
    expect(a.addEquipOnFace(a.core.id, 4, EQUIP.GRAVITY)).toBeTruthy();
    expect(a.addEquipOnFace(a.core.id, 2, EQUIP.FLOAT), 'one says never leave the ground, the other never touch it')
      .toBeNull();
    expect(a.blockedBy(EQUIP.FLOAT)).toBe(EQUIP.GRAVITY);
    expect(a.canAddEquip(EQUIP.FLOAT)).toBe(false);

    const b = stripEquips(PRESETS.biped.build());
    expect(b.addEquipOnFace(b.core.id, 4, EQUIP.FLOAT)).toBeTruthy();
    expect(b.addEquipOnFace(b.core.id, 2, EQUIP.GRAVITY)).toBeNull();
    expect(b.blockedBy(EQUIP.GRAVITY)).toBe(EQUIP.FLOAT);
  });

  it('swapping a fitted plate obeys the same rule', () => {
    const a = stripEquips(PRESETS.biped.build());
    a.addEquipOnFace(a.core.id, 4, EQUIP.GRAVITY);
    const other = a.addEquipOnFace(a.core.id, 2, EQUIP.BEAM);
    expect(a.setEquipType(other.id, EQUIP.FLOAT)).toBe(false);
    expect(a.get(other.id).equipType).toBe(EQUIP.BEAM);
  });

  it('only one float plate, like gravity', () => {
    const a = stripEquips(PRESETS.biped.build());
    expect(a.addEquipOnFace(a.core.id, 4, EQUIP.FLOAT)).toBeTruthy();
    expect(a.addEquipOnFace(a.core.id, 2, EQUIP.FLOAT)).toBeNull();
    expect(a.countEquip(EQUIP.FLOAT)).toBe(1);
  });

  it('gravity wins if an old build somehow carries both', () => {
    // Nothing can fit them together any more, but a file saved before the
    // rule existed still can. Gravity is the one that pins you down.
    const a = stripEquips(PRESETS.biped.build());
    a.addEquipOnFace(a.core.id, 4, EQUIP.GRAVITY);
    const forced = a.addEquipOnFace(a.core.id, 2, EQUIP.BEAM);
    a.get(forced.id).equipType = EQUIP.FLOAT;           // bypass the rule
    const s = computeStats(a);
    expect(s.noFly).toBe(true);
    expect(s.hoverHeight).toBe(0);
  });

  it('a circle plate carries a ring radius, and keeps it', () => {
    const a = stripEquips(PRESETS.biped.build());
    const p = a.addEquipOnFace(a.core.id, 2, EQUIP.CIRCLE, { ringRadius: 3 });
    expect(p.ringRadius).toBeCloseTo(3, 6);
    expect(p.spin).toEqual({ dir: 1, rpm: EQUIP_META.circle.rpm });
    expect(computeStats(a).circlePlates).toBe(1);

    expect(a.setEquipRing(p.id, 1.3)).toBe(true);
    expect(p.ringRadius, 'snapped to the step').toBeCloseTo(1.25, 6);
    expect(a.setEquipRing(p.id, 99)).toBe(true);
    expect(p.ringRadius).toBeCloseTo(6, 6);

    const back = Assembly.fromJSON(a.toJSON());
    expect(back.get(p.id).ringRadius).toBeCloseTo(6, 6);
  });

  it('a plate that turns nothing has no ring radius at all', () => {
    const a = stripEquips(PRESETS.biped.build());
    const beam = a.addEquipOnFace(a.core.id, 2, EQUIP.BEAM);
    expect(beam.ringRadius).toBe(null);
    expect(a.setEquipRing(beam.id, 2)).toBe(false);
  });

  it('a bigger plate weighs more than a small one', () => {
    const small = new Assembly('S');
    small.addCore();
    small.addEquipOnFace(small.rootId, 4, EQUIP.BEAM, { size: 0.4 });
    const big = new Assembly('B');
    big.addCore();
    big.addEquipOnFace(big.rootId, 4, EQUIP.BEAM, { size: 1.6 });
    expect(computeStats(big).mass).toBeGreaterThan(computeStats(small).mass);
  });
});

// ============================================================
//  The rest of the rack
// ============================================================

describe('the new weapons', () => {
  let world;
  beforeEach(() => { _resetIds(0); world = testWorld(); });

  const machine = (...types) => {
    const a = stripEquips(PRESETS.biped.build());
    for (const t of types) a.addEquipOnFace(a.core.id, 4, t, { size: 0.7 });
    return new Robot(a, world, { isPlayer: true });
  };
  const ctx = (over = {}) => ({
    firing: false, aimPoint: null, projectiles: null, targets: [], lockTarget: null, ...over,
  });
  const dummy = (z = 30) => {
    const t = new Robot(stripEquips(PRESETS.biped.build()), world);
    t.body.reset(new THREE.Vector3(0, 2, z));
    t.syncTransform();
    return t;
  };

  it('the beam is one long line, not a stream of dots', () => {
    const r = machine(EQUIP.BEAM);
    const p = pool(16);
    r.weapons.update(ctx({ firing: true, projectiles: p, aimPoint: V(0, 2, 60) }), 1 / 60);
    const shot = p.pool.find((s) => s.life > 0);
    expect(shot.kind).toBe('beam');
    expect(shot.streak, 'drawn as a stroke').toBeGreaterThan(5);
    expect(shot.mesh.scale.z, 'and that is its length on screen').toBeCloseTo(shot.streak, 5);
    expect(shot.mesh.scale.x, 'thin').toBeLessThan(0.4);
  });

  it('the beam will not machine-gun', () => {
    const r = machine(EQUIP.BEAM);
    const p = pool(64);
    // Two seconds of frantic clicking.
    for (let i = 0; i < 120; i++) {
      r.weapons.update(ctx({ firing: i % 2 === 0, projectiles: p }), 1 / 60);
    }
    expect(EQUIP_META.beam.interval).toBeGreaterThan(0.4);
    expect(p.pool.filter((s) => s.life > 0).length + (EQUIP_META.beam.ammo - r.weapons.slots[0].ammo))
      .toBeLessThan(12);
  });

  it('a missile plate throws a salvo, each one homing', () => {
    const r = machine(EQUIP.MISSILE);
    const p = pool(32);
    const t = dummy();
    r.weapons.update(ctx({ firing: true, projectiles: p, targets: [t], lockTarget: t }), 1 / 60);
    const live = p.pool.filter((s) => s.life > 0);
    expect(live).toHaveLength(EQUIP_META.missile.shots);
    expect(live.length, 'a salvo, not a single round').toBeGreaterThan(1);
    for (const s of live) {
      expect(s.kind).toBe('missile');
      expect(s.turn, 'every one of them steers').toBeGreaterThan(0);
      expect(s.target).toBe(t);
      expect(s.trail, 'and leaves a trail behind it').toBeTruthy();
    }
    // Thrown wide: they do not all leave along the same line.
    const dirs = live.map((s) => s.velocity.clone().normalize());
    const spread = Math.max(...dirs.map((d) => d.distanceTo(dirs[0])));
    expect(spread, 'scattered on the way out').toBeGreaterThan(0.1);
  });

  it('the laser burns while held and overheats rather than running dry', () => {
    const r = machine(EQUIP.LASER);
    const t = dummy(20);
    const slot = r.weapons.slots[0];
    expect(slot.meta.beam, 'it is a beam weapon').toBeTruthy();

    const hp = t.hp;
    for (let i = 0; i < 30; i++) {
      r.weapons.update(ctx({ firing: true, targets: [t], aimPoint: t.position }), 1 / 60);
    }
    expect(t.hp, 'it is doing damage the whole time').toBeLessThan(hp);
    expect(slot.heat, 'and heating up').toBeGreaterThan(0);

    for (let i = 0; i < 240; i++) {
      r.weapons.update(ctx({ firing: true, targets: [t], aimPoint: t.position }), 1 / 60);
    }
    expect(slot.reloadT, 'held too long, it cuts out').toBeGreaterThan(0);

    const cooked = t.hp;
    r.weapons.update(ctx({ firing: true, targets: [t], aimPoint: t.position }), 1 / 60);
    expect(t.hp, 'and does nothing while it cools').toBe(cooked);
  });

  it('the laser cools down when you let go', () => {
    const r = machine(EQUIP.LASER);
    const t = dummy(20);
    const slot = r.weapons.slots[0];
    for (let i = 0; i < 40; i++) {
      r.weapons.update(ctx({ firing: true, targets: [t], aimPoint: t.position }), 1 / 60);
    }
    const hot = slot.heat;
    for (let i = 0; i < 120; i++) r.weapons.update(ctx({ firing: false, targets: [t] }), 1 / 60);
    expect(slot.heat).toBeLessThan(hot);
  });

  it('the laser hits the nearest thing on the line, not everything on it', () => {
    const r = machine(EQUIP.LASER);
    const near = dummy(20);
    const far = dummy(60);
    for (let i = 0; i < 20; i++) {
      r.weapons.update(ctx({
        firing: true, targets: [near, far], aimPoint: new THREE.Vector3(0, 2, 80),
      }), 1 / 60);
    }
    expect(near.hp, 'the one in the way took it').toBeLessThan(near.maxHp);
    expect(far.hp, 'and shielded the one behind').toBe(far.maxHp);
  });

  it('the sniper reaches further and hits harder than the rifle', () => {
    expect(EQUIP_META.sniper.speed).toBeGreaterThan(EQUIP_META.beam.speed);
    expect(EQUIP_META.sniper.damage).toBeGreaterThan(EQUIP_META.beam.damage);
    expect(EQUIP_META.sniper.interval, 'and pays for it in rate of fire')
      .toBeGreaterThan(EQUIP_META.beam.interval);
  });

  it('the scope only zooms for the plate that has one, and only while held', () => {
    const r = machine(EQUIP.SNIPER, EQUIP.BEAM);
    expect(r.weapons.scopeZoom).toBe(1);

    r.weapons.update(ctx({ scoping: true }), 1 / 60);
    expect(r.weapons.scoped).toBe(true);
    expect(r.weapons.scopeZoom).toBeCloseTo(EQUIP_META.sniper.scope, 6);

    r.weapons.update(ctx({ scoping: false }), 1 / 60);
    expect(r.weapons.scoped).toBe(false);
    expect(r.weapons.scopeZoom).toBe(1);

    r.weapons.select(1);
    r.weapons.update(ctx({ scoping: true }), 1 / 60);
    expect(r.weapons.scoped, 'the rifle has no scope to hold').toBe(false);
    expect(r.weapons.scopeZoom).toBe(1);
  });

  it('the spread throws a fan of pellets in one pull', () => {
    const r = machine(EQUIP.SPREAD);
    const p = pool(32);
    r.weapons.update(ctx({ firing: true, projectiles: p, aimPoint: V(0, 2, 40) }), 1 / 60);
    const live = p.pool.filter((s) => s.life > 0);
    expect(live).toHaveLength(EQUIP_META.spread.shots);
    const dirs = live.map((s) => s.velocity.clone().normalize());
    expect(Math.max(...dirs.map((d) => d.distanceTo(dirs[0]))), 'a wide fan')
      .toBeGreaterThan(0.2);
  });

  it('the magnum hits hard but simply stops after a few metres', () => {
    const m = EQUIP_META.magnum;
    expect(m.damage).toBeGreaterThan(EQUIP_META.shot.damage * 3);
    const reach = m.speed * m.life;
    expect(reach, 'a short-range weapon').toBeLessThan(45);
    expect(EQUIP_META.beam.speed * EQUIP_META.beam.life, 'the rifle reaches much further')
      .toBeGreaterThan(reach * 4);
  });

  it('a grenade arcs, and goes off where it lands', () => {
    const r = machine(EQUIP.GRENADE);
    const p = pool(16);
    r.weapons.update(ctx({ firing: true, projectiles: p, aimPoint: V(0, 2, 30) }), 1 / 60);
    const shot = p.pool.find((s) => s.life > 0);
    expect(shot.kind).toBe('grenade');
    expect(shot.gravity, 'it falls').toBeGreaterThan(0);
    expect(shot.blast, 'and it has a blast').toBeTruthy();

    const before = shot.velocity.y;
    p.update(0.2, []);
    expect(shot.velocity.y, 'dropping as it goes').toBeLessThan(before);
  });

  it('the blast catches whoever is standing near the impact', () => {
    const p = pool(8);
    const bystander = dummy(4);
    p.spawn({
      position: V(0, 6, 4), direction: V(0, -1, 0), speed: 40, life: 2,
      damage: 1, radius: 0.3, kind: 'grenade', gravity: 14,
      blast: { radius: 8, damage: 30 },
    });
    let sawBlast = false;
    for (let i = 0; i < 40; i++) {
      p.update(1 / 60, [bystander]);
      if (p.hits.some((h) => h.blast > 0)) sawBlast = true;
    }
    expect(bystander.hp, 'it did not have to be a direct hit').toBeLessThan(bystander.maxHp);
    expect(sawBlast, 'and it reported one, so the field can draw it').toBe(true);
  });

  it('a shield goes up, keeps damage off the machine, and expires', () => {
    const r = machine(EQUIP.SHIELD);
    expect(r.shield).toBe(null);
    r.weapons.update(ctx({ firing: true }), 1 / 60);
    expect(r.shield, 'the barrier is up').toBeTruthy();

    const hp = r.hp;
    r.damage(40);
    expect(r.hp, 'the barrier ate it').toBe(hp);
    expect(r.shield.hp).toBeCloseTo(EQUIP_META.shield.shield.hp - 40, 0);

    // Run it past its own clock.
    for (let i = 0; i < 60 * (EQUIP_META.shield.shield.seconds + 1); i++) {
      r.weapons.update(ctx({ firing: false }), 1 / 60);
    }
    expect(r.shield, 'and it runs out').toBe(null);
    r.damage(10);
    expect(r.hp, 'after which damage lands as usual').toBeLessThan(hp);
  });

  it('a barrier that is overwhelmed breaks, and the rest gets through', () => {
    const r = machine(EQUIP.SHIELD);
    r.weapons.update(ctx({ firing: true }), 1 / 60);
    const hp = r.hp;
    r.damage(EQUIP_META.shield.shield.hp + 25);
    expect(r.shield).toBe(null);
    expect(hp - r.hp, 'only the excess reached the machine').toBeCloseTo(25, 0);
  });

  it('ramming with the shield up hurts what you drive into', () => {
    const r = machine(EQUIP.SHIELD);
    const t = dummy(0);
    t.body.reset(new THREE.Vector3(0, 2, r.radius + t.radius));
    t.syncTransform();
    r.weapons.update(ctx({ firing: true, targets: [t] }), 1 / 60);

    const hp = t.hp;
    for (let i = 0; i < 60; i++) r.weapons.update(ctx({ firing: false, targets: [t] }), 1 / 60);
    expect(t.hp, 'contact with a live barrier costs it').toBeLessThan(hp);
  });

  it('a shield comes down when the machine does', () => {
    const r = machine(EQUIP.SHIELD);
    r.weapons.update(ctx({ firing: true }), 1 / 60);
    expect(r.shield).toBeTruthy();
    r.damage(99999);
    expect(r.alive).toBe(false);
    expect(r.shield, 'nothing survives the wreck').toBe(null);
  });

  it('every weapon in the table can be fired without throwing', () => {
    for (const type of WEAPON_TYPES) {
      const r = machine(type);
      const p = pool(64);
      const t = dummy();
      expect(() => {
        for (let i = 0; i < 90; i++) {
          r.weapons.update(ctx({
            firing: true, projectiles: p, targets: [t], lockTarget: t,
            aimPoint: t.position, scoping: i > 45,
          }), 1 / 60);
          p.update(1 / 60, [t]);
        }
      }, type).not.toThrow();
    }
  });

  it('the HUD gets a row it can draw for every one of them', () => {
    const r = machine(...WEAPON_TYPES);
    const rows = r.weapons.readout();
    expect(rows).toHaveLength(WEAPON_TYPES.length);
    for (const row of rows) {
      expect(typeof row.label).toBe('string');
      expect(Number.isFinite(row.ammo)).toBe(true);
      expect(Number.isFinite(row.reloadFrac)).toBe(true);
    }
    // The laser has no magazine, so it reports a heat gauge instead.
    const laser = rows[WEAPON_TYPES.indexOf(EQUIP.LASER)];
    expect(laser.gauge).toBeGreaterThan(0);
  });
});
