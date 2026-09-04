import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Projectiles } from '../src/game/Weapons.js';
import { Robot, SyntheticInput } from '../src/game/Robot.js';
import { Assembly, PRESETS, computeStats, _resetIds } from '../src/core/Assembly.js';
import {
  EQUIP, EQUIP_META, WEAPON_TYPES, WEAPON_SLOTS, WEAPON_VOICE, weaponLead,
} from '../src/core/constants.js';
import { KIT_SFX, sfxName } from '../src/game/Kit.js';
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

describe('a missile gets one go', () => {
  let p;
  beforeEach(() => { p = pool(); });

  it('stops steering once it has flown past', () => {
    // A missile that keeps turning until its fuel runs out circles back and
    // comes at you again, and again, so dodging buys nothing: the only
    // thing that ends the chase is being hit. Giving up is what makes the
    // dodge worth doing.
    const t = dummy(0, 8, 20, 0.4);
    const m = p.spawn({
      position: V(0, 8, 0), direction: V(0, 0, 1), speed: 30, life: 6,
      turn: 2.6, target: t, damage: 5, radius: 0.3,
    });
    expect(m.homing, 'it starts out hunting').toBe(true);

    // Sidestep hard enough that it cannot make the turn.
    for (let i = 0; i < 120 && m.homing; i++) {
      t.position.x += 45 / 60;
      p.update(1 / 60, [t]);
    }
    expect(t.hp, 'it missed').toBe(100);
    expect(m.homing, 'and it gave up').toBe(false);
  });

  it('and then it really does fly straight', () => {
    const t = dummy(0, 8, 20, 0.4);
    const m = p.spawn({
      position: V(0, 8, 0), direction: V(0, 0, 1), speed: 30, life: 6,
      turn: 2.6, target: t, damage: 5, radius: 0.3,
    });
    for (let i = 0; i < 120 && m.homing; i++) {
      t.position.x += 45 / 60;
      p.update(1 / 60, [t]);
    }
    expect(m.homing).toBe(false);
    const heading = m.velocity.clone().normalize();
    // Park the target right beside it: a missile still hunting would turn.
    t.position.copy(m.mesh.position).add(V(6, 0, 0));
    for (let i = 0; i < 30; i++) p.update(1 / 60, [t]);
    expect(m.velocity.clone().normalize().dot(heading), 'not a degree of it')
      .toBeGreaterThan(0.9999);
  });

  it('a target that runs is a target that gets away', () => {
    // Thirty metres a second against a machine that dashes faster. Outrunning
    // one is supposed to work.
    const t = dummy(0, 8, 10, 0.4);
    const m = p.spawn({
      position: V(0, 8, 0), direction: V(0, 0, 1), speed: 30, life: 6,
      turn: 2.6, target: t, damage: 5, radius: 0.3,
    });
    for (let i = 0; i < 120 && m.life > 0; i++) {
      t.position.z += 40 / 60;
      p.update(1 / 60, [t]);
    }
    expect(t.hp, 'never touched').toBe(100);
    expect(m.homing).toBe(false);
  });

  it('but one that stands there still gets hit', () => {
    const t = dummy(14, 8, 14, 1.2);
    p.spawn({
      position: V(0, 8, 0), direction: V(0, 0, 1), speed: 30, life: 6,
      turn: 2.6, target: t, damage: 9, radius: 0.3,
    });
    for (let i = 0; i < 200 && t.hp === 100; i++) p.update(1 / 60, [t]);
    expect(t.hp).toBeLessThan(100);
  });

  it('a fresh slot never inherits the last one\u2019s hunt', () => {
    const t = dummy(0, 8, 20, 0.4);
    const a = p.spawn({
      position: V(0, 8, 0), direction: V(0, 0, 1), speed: 30, life: 6,
      turn: 2.6, target: t, damage: 5, radius: 0.3,
    });
    for (let i = 0; i < 120 && a.homing; i++) {
      t.position.x += 45 / 60;
      p.update(1 / 60, [t]);
    }
    p.clear();
    const b = p.spawn({
      position: V(0, 8, 0), direction: V(0, 0, 1), speed: 30, life: 6,
      turn: 2.6, target: t, damage: 5, radius: 0.3,
    });
    expect(b.homing).toBe(true);
    expect(b.closest).toBe(Infinity);
  });
});

describe('rounds are drawn, not just coloured', () => {
  let p;
  beforeEach(() => { p = pool(); });

  it('every round carries a map, and the right one for its shape', () => {
    const bolt = p.spawn({ position: V(0, 5, 0), direction: V(0, 0, 1), speed: 90, life: 1 });
    expect(bolt.mat.map, 'a bolt').toBe(p.boltTex);
    const missile = p.spawn({
      position: V(0, 5, 0), direction: V(0, 0, 1), speed: 30, life: 1, kind: 'missile',
    });
    expect(missile.mat.map, 'a missile').toBe(p.missileTex);
    const nade = p.spawn({
      position: V(0, 5, 0), direction: V(0, 0, 1), speed: 40, life: 1, kind: 'grenade',
    });
    expect(nade.mat.map, 'a grenade').toBe(p.grenadeTex);
  });

  it('a slot reused for another shape takes that shape\u2019s map', () => {
    const one = pool(1);
    const a = one.spawn({
      position: V(0, 5, 0), direction: V(0, 0, 1), speed: 30, life: 1, kind: 'missile',
    });
    expect(a.mat.map).toBe(one.missileTex);
    const b = one.spawn({ position: V(0, 5, 0), direction: V(0, 0, 1), speed: 90, life: 1 });
    expect(b.mat.map, 'and not the one it had before').toBe(one.boltTex);
    one.dispose();
  });

  it('the maps are greyscale, so the bullet colour still decides the colour', () => {
    // They MULTIPLY the colour the player picked. A map with colour of its
    // own would quietly repaint every round in the game.
    for (const tex of [p.boltTex, p.missileTex, p.grenadeTex]) {
      const d = tex.image.data;
      for (let i = 0; i < d.length; i += 4) {
        expect(d[i] === d[i + 1] && d[i + 1] === d[i + 2], 'grey').toBe(true);
      }
    }
  });

  it('a bolt is brightest at the nose', () => {
    // The cylinder runs along +Z with v = 1 at the nose, so the ramp has to
    // run that way too — backwards, the round looks like it is flying tail
    // first.
    const d = p.boltTex.image.data;
    const w = p.boltTex.image.width;
    const h = p.boltTex.image.height;
    const row = (y) => d[(y * w) * 4];
    expect(row(h - 1), 'nose').toBeGreaterThan(row(0) * 3);
  });

  it('a missile burns at the tail instead', () => {
    const d = p.missileTex.image.data;
    const w = p.missileTex.image.width;
    const h = p.missileTex.image.height;
    const row = (y) => d[(y * w) * 4];
    expect(row(0), 'the motor').toBeGreaterThan(row(Math.floor(h * 0.5)));
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
      // The battle read-out's own name, not the editor's: one language on
      // that screen.
      label: EQUIP_META.beam.en, ammo: EQUIP_META.beam.ammo,
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
    // Three times, not four: the rifle's range came in to about the width of
    // the arena, because at two hundred and fifty metres it reached further
    // than anything could ever be — which made the sniper's one advantage
    // over it imaginary.
    expect(EQUIP_META.beam.speed * EQUIP_META.beam.life, 'the rifle reaches much further')
      .toBeGreaterThan(reach * 3);
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
    // One machine per weapon, because a rack only holds four now: fitting
    // all eleven at once is a build the game no longer allows.
    for (const type of WEAPON_TYPES) {
      const rows = machine(type).weapons.readout();
      expect(rows, type).toHaveLength(1);
      const [row] = rows;
      expect(typeof row.label, type).toBe('string');
      expect(Number.isFinite(row.ammo), type).toBe(true);
      expect(Number.isFinite(row.reloadFrac), type).toBe(true);
    }
    // The laser has no magazine, so it reports a heat gauge instead.
    const [laser] = machine(EQUIP.LASER).weapons.readout();
    expect(laser.gauge).toBeGreaterThan(0);
  });

  it('a rack holds four, and says which rule refused the fifth', () => {
    // There used to be no limit, and a plate weighs under a tenth of what a
    // machine does — so carrying all ten and cycling beat choosing, and ten
    // different cost structures never became a question.
    const a = PRESETS.core.build();
    for (let i = 0; i < WEAPON_SLOTS; i++) {
      expect(a.addEquipOnFace(a.rootId, i, WEAPON_TYPES[i]), `plate ${i}`).toBeTruthy();
    }
    expect(a.weaponCount()).toBe(WEAPON_SLOTS);
    expect(a.blockedBy(WEAPON_TYPES[4]), 'the fifth is refused').toBe('rack');
    expect(a.addEquipOnFace(a.rootId, 4, WEAPON_TYPES[4])).toBe(null);
    // Systems are not weapons and do not touch the rack.
    expect(a.blockedBy(EQUIP.BOOST), 'a thruster still fits').toBe(null);
  });
});

// ============================================================
//  Being shot at, and being able to do something about it
// ============================================================

describe('a locked shot can be dodged', () => {
  const world = testWorld();

  const shooter = (type) => {
    const a = stripEquips(PRESETS.biped.build());
    a.addEquipOnFace(a.core.id, 4, type, { size: 0.7 });
    return new Robot(a, world, { isPlayer: true });
  };
  const mark = (z, vx = 0) => {
    const t = new Robot(PRESETS.biped.build(), world);
    t.body.reset(new THREE.Vector3(0, 4.5, z));
    t.velocity.set(vx, 0, 0);
    t.syncTransform();
    return t;
  };

  /**
   * Fire one pull at a target crossing at `vx`, and say if it landed.
   *
   * `jinkAt` reverses the target that many seconds after the shot leaves —
   * which is the difference between a machine walking and a machine dodging,
   * and the only difference that ought to decide whether a round connects.
   */
  const shootAt = (type, range, vx, jinkAt = Infinity) => {
    const r = shooter(type);
    const p = pool(32);
    const t = mark(range, vx);
    r.weapons.update({
      firing: true, projectiles: p, targets: [t], lockTarget: t, aimPoint: null,
    }, 1 / 60);
    let flown = 0;
    for (let i = 0; i < 300 && p.liveCount > 0; i++) {
      flown += 1 / 60;
      if (flown >= jinkAt) { t.velocity.x = -vx; }
      t.position.addScaledVector(t.velocity, 1 / 60);
      p.update(1 / 60, [t]);
      if (p.hits.some((h) => h.robot === t)) return true;
    }
    return false;
  };

  it('standing still in front of one is still fatal', () => {
    for (const type of [EQUIP.BEAM, EQUIP.GATLING, EQUIP.SNIPER, EQUIP.SHOT]) {
      expect(shootAt(type, 25, 0), type).toBe(true);
    }
  });

  it('so is walking past one in a straight line', () => {
    /**
     * This used to assert the opposite, and the opposite was the bug.
     *
     * The lead figures were chosen by feel, and worked out to aiming short
     * by 2.9m at thirty metres and 8.6m at sixty — against a machine three
     * to six metres wide. A round passing nine metres behind a target that
     * is walking in a straight line, with a lock on it, is not the target
     * dodging: it is the gun pointing somewhere else.
     *
     * A steady course is not a dodge. Holding one gets you hit.
     */
    for (const type of [EQUIP.BEAM, EQUIP.GATLING, EQUIP.MAGNUM]) {
      expect(shootAt(type, 25, 16), type).toBe(true);
    }
  });

  it('changing course inside the flight time is what saves you', () => {
    // The same crossing target, reversing a tenth of a second after the
    // round leaves the barrel. This is the whole of what dodging means:
    // the shot went where you were GOING to be, so stop going there.
    for (const type of [EQUIP.BEAM, EQUIP.GATLING, EQUIP.MAGNUM]) {
      expect(shootAt(type, 25, 16, 0.1), type).toBe(false);
    }
  });

  it('and the further out you are, the more time you have to do it', () => {
    // In close there is no time to react; across the arena there is.
    expect(shootAt(EQUIP.GATLING, 12, 8, 0.1), 'in close, it lands').toBe(true);
    expect(shootAt(EQUIP.GATLING, 40, 8, 0.1), 'at range, the jink works').toBe(false);
  });

  it('the lock aims short of the intercept it can solve', () => {
    const r = shooter(EQUIP.BEAM);
    const t = mark(60, 30);
    const { position, direction } = r.weapons.muzzle(r.weapons.slots[0], { lockTarget: t });

    const flight = position.distanceTo(t.position) / EQUIP_META.beam.speed;
    const aimedAt = position.clone().addScaledVector(direction, flight * EQUIP_META.beam.speed);
    const perfect = t.position.x + t.velocity.x * flight;
    expect(aimedAt.x, 'it does lead').toBeGreaterThan(perfect * 0.8);
    // Short of the exact answer, but only just.
    //
    // A FRACTION of the intercept is an error proportional to range, and a
    // machine does not get bigger with range — at 0.76 the gun missed a
    // target walking in a straight line at sixty metres by more than the
    // machine was wide. The dodge is the flight time now, not a built-in
    // aiming error, so all this has to say is that the answer is not
    // solved outright.
    expect(aimedAt.x, 'but never exactly').toBeLessThan(perfect);
  });

  it('the weapon that forgives a miss leads less than the one that cannot', () => {
    // What separates them is not aimed-versus-sprayed any more — every gun
    // that has to be exact is allowed to be. It is whether a near miss
    // still does something: a missile turns after it, and a grenade has a
    // seven-metre blast, so neither needs the last few per cent.
    const lead = (t) => weaponLead(EQUIP_META[t]);
    expect(lead(EQUIP.GATLING), 'a gun has to be right').toBeGreaterThan(lead(EQUIP.MISSILE));
    expect(lead(EQUIP.SNIPER)).toBeGreaterThan(lead(EQUIP.GRENADE));

    for (const type of WEAPON_TYPES) {
      // And none of them solves it outright, or the lock does the fighting.
      expect(weaponLead(EQUIP_META[type]), type + ' never solves it outright')
        .toBeLessThan(1);
    }
  });

  it('every round is slow enough to watch cross the gap', () => {
    // Twenty-five metres is a normal fighting range. A round that covers it
    // inside a couple of frames cannot be seen, let alone avoided.
    for (const type of WEAPON_TYPES) {
      const meta = EQUIP_META[type];
      if (!meta.speed) continue;         // the laser is a line, not a round
      expect(25 / meta.speed, type + ' takes long enough').toBeGreaterThan(0.1);
    }
  });

  it('a machine is a standing column, not a ball as wide as it is tall', () => {
    // The old proxy was half the bounding diagonal — three and a half metres
    // for a walker — so anything passing three metres wide of it counted as
    // a hit, and no amount of dodging could change that.
    const t = mark(20);
    expect(t.hitRadius, 'as thick as the body is').toBeLessThan(t.radius * 0.5);
    // Taller than it is wide, which is the whole claim. This used to demand
    // a ratio between the half-height and the radius, which is a different
    // quantity and moved the day the column was widened to match what the
    // player can see — the machine stayed exactly as much of a column.
    const tall = (t.hitHalfHeight + t.hitRadius) * 2;
    const wide = t.hitRadius * 2;
    expect(tall / wide, `${tall.toFixed(1)}m tall by ${wide.toFixed(1)}m`)
      .toBeGreaterThan(2);

    const p = pool(4);
    p.spawn({
      position: new THREE.Vector3(t.hitRadius + 1.5, t.position.y + t.hitOffsetY, 0),
      direction: new THREE.Vector3(0, 0, 1), speed: 100, damage: 10, life: 2,
    });
    p.update(0.4, [t]);
    expect(p.hits, 'a round passing wide of the body misses').toHaveLength(0);

    p.spawn({
      position: new THREE.Vector3(
        0, t.position.y + t.hitOffsetY + t.hitHalfHeight * 0.8, 0,
      ),
      direction: new THREE.Vector3(0, 0, 1), speed: 100, damage: 10, life: 2,
    });
    p.update(0.4, [t]);
    expect(p.hits.some((h) => h.robot === t), 'one at head height does not').toBe(true);
  });
});

describe('knowing you were hit', () => {
  const world = testWorld();
  const target = (player = false) => {
    const t = new Robot(PRESETS.biped.build(), world, { isPlayer: player });
    t.body.reset(new THREE.Vector3(0, 4.5, 0));
    return t;
  };
  const FROM = () => new THREE.Vector3(0, 4.5, -8);

  it('the machine that took it lights up', () => {
    // A hit that only moves a number on a bar is a hit nobody feels.
    const t = target();
    expect(t.rig.bodyMaterial.emissiveIntensity, 'dark to start with').toBe(0);
    t.damage(t.maxHp * 0.2, FROM());
    expect(t.hitFlash).toBeGreaterThan(0);
    expect(t.rig.bodyMaterial.emissiveIntensity, 'lit on the frame it landed')
      .toBeGreaterThan(0);
  });

  it('harder hits light it harder, and it never whites out', () => {
    const light = target();
    light.damage(light.maxHp * 0.02, FROM());
    const heavy = target();
    heavy.damage(heavy.maxHp * 0.3, FROM());
    expect(heavy.hitFlash).toBeGreaterThan(light.hitFlash * 3);
    // Past the cap there is no machine left in the picture, only a white
    // blob — so however big the blow, the silhouette survives.
    const huge = target();
    huge.damage(huge.maxHp * 5, FROM());
    expect(huge.hitFlash).toBeLessThanOrEqual(0.45 + 1e-9);
  });

  it('and it goes out again quickly', () => {
    const t = target();
    const input = new SyntheticInput();
    t.damage(t.maxHp * 0.3, FROM());
    for (let i = 0; i < 30; i++) t.update(input, 1 / 60);
    expect(t.hitFlash).toBe(0);
    expect(t.rig.bodyMaterial.emissiveIntensity).toBe(0);
  });

  it('ours and theirs are different colours', () => {
    // Which of those two things just happened is the single most useful
    // bit on the screen.
    const mine = target(true);
    const theirs = target(false);
    mine.damage(10, FROM());
    theirs.damage(10, FROM());
    expect(mine.rig.bodyMaterial.emissive.getHex())
      .not.toBe(theirs.rig.bodyMaterial.emissive.getHex());
  });

  it('every blow is logged for the read-out, and drained once', () => {
    const t = target();
    t.damage(5, FROM());
    t.damage(9, FROM());
    expect(t.blows).toHaveLength(2);
    expect(t.blows[0].damage).toBe(5);
    expect(t.blows[0].from, 'and where it came from').toBeTruthy();
    t.blows.length = 0;
    t.damage(3, FROM());
    expect(t.blows).toHaveLength(1);
  });

  it('the one that finishes a machine says so', () => {
    const t = target();
    t.damage(t.maxHp * 0.1, FROM());
    expect(t.blows[0].fatal).toBe(false);
    t.damage(t.maxHp, FROM());
    expect(t.blows[t.blows.length - 1].fatal).toBe(true);
  });

  it('the log never grows without bound', () => {
    const t = target();
    t.setToughness(50);
    for (let i = 0; i < 200; i++) t.damage(1, FROM());
    expect(t.blows.length).toBeLessThanOrEqual(8);
  });

  it('nothing survives a respawn', () => {
    const t = target();
    t.damage(t.maxHp * 0.3, FROM());
    t.damage(t.maxHp);
    t.revive(new THREE.Vector3(0, 4.5, 0));
    expect(t.hitFlash).toBe(0);
    expect(t.blows).toHaveLength(0);
    expect(t.rig.bodyMaterial.emissiveIntensity).toBe(0);
  });
});

describe('getting rocked', () => {
  const world = testWorld();
  const target = () => {
    const t = new Robot(PRESETS.biped.build(), world);
    t.body.reset(new THREE.Vector3(0, 4.5, 0));
    return t;
  };
  const BEHIND = () => new THREE.Vector3(0, 4.5, -8);

  it('a heavy hit rocks the machine and throws it clear', () => {
    const t = target();
    t.damage(t.maxHp * 0.25, BEHIND());
    expect(t.body.stagger, 'rocked').toBeGreaterThan(0.3);
    expect(t.velocity.z, 'and driven away from the shot').toBeGreaterThan(1);
  });

  it('a stream of small rounds never does', () => {
    // Held fire is meant to whittle a machine down, not to hold it still
    // while it happens. A gatling round is a fortieth of a machine.
    const t = target();
    const input = new SyntheticInput();
    const meta = EQUIP_META[EQUIP.GATLING];
    let due = 0;
    for (let i = 0; i < 240 && t.alive; i++) {
      due -= 1 / 60;
      if (due <= 0) { t.damage(meta.damage, BEHIND()); due = meta.interval; }
      t.update(input, 1 / 60);
      expect(t.body.stagger, 'never once').toBe(0);
    }
  });

  it('but a volley of them arriving together does', () => {
    // Nine pellets are one blow, not nine unnoticeable ones — which is what
    // judging each round on its own would have made them.
    const t = target();
    const meta = EQUIP_META[EQUIP.SPREAD];
    for (let i = 0; i < meta.shots; i++) t.damage(meta.damage, BEHIND());
    expect(t.body.stagger).toBeGreaterThan(0);
  });

  it('what counts as heavy is the machine’s own toughness', () => {
    const light = target();
    light.setToughness(0.35);
    const heavy = target();
    heavy.setToughness(3);
    const blow = light.maxHp * 0.5;
    light.damage(blow, BEHIND());
    heavy.damage(blow, BEHIND());
    expect(light.body.stagger, 'it folds a light frame').toBeGreaterThan(0);
    expect(heavy.body.stagger, 'and barely troubles a heavy one').toBe(0);
  });

  it('a rocked machine cannot shoot back', () => {
    const a = stripEquips(PRESETS.biped.build());
    a.addEquipOnFace(a.core.id, 4, EQUIP.BEAM, { size: 0.7 });
    const r = new Robot(a, world, { isPlayer: true });
    const p = pool(8);

    r.body.applyStagger(1, new THREE.Vector3(0, 0, -1));
    r.weapons.update({
      firing: true, projectiles: p, targets: [], lockTarget: null,
      aimPoint: new THREE.Vector3(0, 4.5, 60),
    }, 1 / 60);
    expect(p.liveCount, 'the trigger does not answer').toBe(0);
    expect(r.weapons.slots[0].ammo, 'and nothing was spent').toBe(EQUIP_META.beam.ammo);
  });

  it('the blow that killed it does not follow it into the next life', () => {
    const t = target();
    t.damage(t.maxHp * 0.3, BEHIND());
    expect(t.shock + t.body.stagger).toBeGreaterThan(0);
    t.damage(t.maxHp);
    t.revive(new THREE.Vector3(0, 4.5, 0));
    expect(t.shock).toBe(0);
    expect(t.body.stagger).toBe(0);
  });
});

// ============================================================
//  What a blade costs.
// ============================================================

describe('the blade runs on the tank', () => {
  const world = testWorld();
  const bladed = () => {
    const a = stripEquips(PRESETS.biped.build());
    a.addEquipOnFace(a.core.id, 4, EQUIP.BLADE, { size: 0.7 });
    return new Robot(a, world, { isPlayer: true });
  };

  it('costs energy to hold lit', () => {
    // It had no magazine, no reload and no heat: the one weapon with no
    // price at all, so the answer was to hold it down and forget about it.
    const r = bladed();
    const before = r.body.energy;
    for (let i = 0; i < 60; i++) {
      r.weapons.update({ firing: true, projectiles: pool(4), targets: [] }, 1 / 60);
    }
    const spent = before - r.body.energy;
    expect(spent, `a second of blade cost ${spent.toFixed(2)} of the tank`)
      .toBeGreaterThan(0.2);
  });

  it('goes out when the tank does', () => {
    const r = bladed();
    r.body.energy = 0.005;
    r.weapons.update({ firing: true, projectiles: pool(4), targets: [] }, 1 / 60);
    expect(r.body.energy, 'nothing left to spend').toBeGreaterThanOrEqual(0);
    expect(r.weapons.bladeGlow, 'and it is not lit').toBeLessThan(0.2);
  });

  it('costs nothing at all when it is not held', () => {
    const r = bladed();
    const before = r.body.energy;
    for (let i = 0; i < 60; i++) {
      r.weapons.update({ firing: false, projectiles: pool(4), targets: [] }, 1 / 60);
    }
    expect(r.body.energy).toBe(before);
  });
});

// ============================================================
//  Every gun has its own voice.
// ============================================================

describe('the guns do not all speak with one voice', () => {
  it('names a recording for every weapon there is', () => {
    // Every weapon but the blade, which does not go off — it is held lit,
    // and its sound is one of the three that are held rather than struck.
    //
    // This caught a real gap the moment it was written: the laser and the
    // shield had no voice at all, so pressing the trigger on either of them
    // was silent.
    for (const t of WEAPON_TYPES) {
      if (EQUIP_META[t].dps) continue;
      expect(WEAPON_VOICE[t], `${t} has no voice`).toBeTruthy();
    }
  });

  it('and a close weapon does not sound like a long one', () => {
    // Two buckets — light and heavy — was most of why the guns sounded
    // alike: a shotgun, a sniper rifle and a magnum all came out of one
    // file at slightly different pitches, which the ear reads as one gun
    // with a knob on it.
    expect(WEAPON_VOICE[EQUIP.SHOT]).not.toBe(WEAPON_VOICE[EQUIP.SNIPER]);
    expect(WEAPON_VOICE[EQUIP.GATLING]).not.toBe(WEAPON_VOICE[EQUIP.MAGNUM]);
    expect(new Set(Object.values(WEAPON_VOICE)).size,
      'more than two distinct firearms').toBeGreaterThan(2);
  });

  it('and every voice it names is a sound the game actually ships', () => {
    const shipped = new Set(KIT_SFX.map(sfxName));
    for (const [t, voice] of Object.entries(WEAPON_VOICE)) {
      expect(shipped.has(voice), `${t} wants ${voice}, which is not in the kit`).toBe(true);
    }
  });
});

// ============================================================
//  A weapon with no magazine still has to show something.
// ============================================================

describe('a beam has no rounds, and must not say it has none left', () => {
  const world = testWorld();
  const withLaser = () => {
    const a = stripEquips(PRESETS.biped.build());
    a.addEquipOnFace(a.core.id, 4, EQUIP.LASER, { size: 0.6 });
    a.addEquipOnFace(a.core.id, 2, EQUIP.GATLING, { size: 0.6 });
    return new Robot(a, world, { isPlayer: true });
  };

  it('publishes how far it is from overheating instead', () => {
    const r = withLaser();
    const rows = r.weapons.readout();
    const beam = rows.find((w) => w.label === EQUIP_META[EQUIP.LASER].en);
    const gun = rows.find((w) => w.label === EQUIP_META[EQUIP.GATLING].en);
    expect(beam.gauge, 'a beam has a gauge').toBeGreaterThan(0);
    expect(gun.gauge, 'and a gun does not').toBe(null);
  });

  it('and the read-out it publishes would otherwise read as EMPTY', () => {
    // This is the trap, written down. A laser's magazine is 0 of 0, which
    // is exactly what a gun that has run dry looks like — so anything
    // drawing rounds for this weapon is drawing a lie. Nobody saw it for
    // as long as no shipped machine carried one.
    const r = withLaser();
    const beam = r.weapons.readout().find((w) => w.label === EQUIP_META[EQUIP.LASER].en);
    expect(beam.max).toBe(0);
    expect(beam.ammo).toBe(0);
    expect(beam.melee, 'and it is not melee either, so that branch will not catch it')
      .toBe(false);
  });

  it('and the gauge moves as it is held down', () => {
    const r = withLaser();
    r.weapons.select(0);
    const before = r.weapons.readout()[0].gauge;
    for (let i = 0; i < 90; i++) {
      r.weapons.update({ firing: true, projectiles: pool(8), targets: [] }, 1 / 60);
    }
    const after = r.weapons.readout()[0].gauge;
    expect(after, `${before.toFixed(2)} -> ${after.toFixed(2)}`).toBeLessThan(before);
  });
});

// ============================================================
//  Holding a beam down.
// ============================================================

describe('a beam you hold down', () => {
  const world = testWorld();
  const beamer = () => {
    const a = stripEquips(PRESETS.biped.build());
    a.addEquipOnFace(a.core.id, 4, EQUIP.LASER, { size: 0.6 });
    return new Robot(a, world, { isPlayer: true });
  };
  const hold = (r, secs) => {
    const ctx = { firing: true, projectiles: pool(16), targets: [] };
    let lit = 0;
    for (let i = 0; i < secs * 60; i++) {
      r.weapons.update(ctx, 1 / 60);
      if (r.weapons.beaming) lit++;
    }
    return lit / 60;
  };

  it('comes back after it overheats, without letting go', () => {
    // It used to not. Heat only bled off while the trigger was UP, so
    // holding it — which is what everybody does with a beam — left the
    // weapon dead: it fired for one frame every two seconds for the rest of
    // the fight, and nothing said why.
    const r = beamer();
    const lit = hold(r, 10);
    expect(lit, `${lit.toFixed(1)}s of beam in ten`).toBeGreaterThan(4);
  });

  it('and still costs something — it is not a beam you can leave on', () => {
    const r = beamer();
    const lit = hold(r, 10);
    expect(lit, 'not the whole ten seconds').toBeLessThan(8);
  });

  it('says it is beaming only while it is actually burning', () => {
    const r = beamer();
    const ctx = { firing: true, projectiles: pool(16), targets: [] };
    r.weapons.update(ctx, 1 / 60);
    expect(r.weapons.beaming, 'lit').toBe(true);
    r.weapons.update({ ...ctx, firing: false }, 1 / 60);
    expect(r.weapons.beaming, 'and out the moment the trigger comes up').toBe(false);
  });

  it('plants the machine while it is lit', () => {
    // A beam is aimed for as long as it is held, which nothing else here
    // is: a gun is aimed at the instant it goes off and whatever the
    // machine does next cannot make that shot miss. So the nose settling
    // onto the travel direction — right for a machine that is running —
    // dragged the beam off the target the whole time it was burning.
    const r = beamer();
    expect(r.body.bracing).toBe(0);
    const ctx = { firing: true, projectiles: pool(16), targets: [] };
    for (let i = 0; i < 30; i++) {
      r.syncBrace(1 / 60);
      r.weapons.update(ctx, 1 / 60);
    }
    expect(r.body.bracing, 'braced while burning').toBeGreaterThan(0.9);

    // And it lets go slowly: snapping the nose round at the moment the
    // player is looking to see whether the shot landed is its own problem.
    for (let i = 0; i < 6; i++) {
      r.weapons.update({ ...ctx, firing: false }, 1 / 60);
      r.syncBrace(1 / 60);
    }
    expect(r.body.bracing, 'still mostly braced a tenth of a second later')
      .toBeGreaterThan(0.4);
  });
});
