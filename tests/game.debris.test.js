import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Debris } from '../src/game/Debris.js';
import { Robot } from '../src/game/Robot.js';
import { Assembly, PRESETS, computeStats, _resetIds } from '../src/core/Assembly.js';
import { EQUIP, EQUIP_META } from '../src/core/constants.js';
import { testWorld, stripEquips } from './helpers/dom.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ============================================================
//  Durability
// ============================================================

describe('durability', () => {
  beforeEach(() => _resetIds(0));

  const withCore = (edge) => {
    const a = PRESETS.biped.build();
    a.setSize(a.rootId, [edge, edge, edge]);
    return computeStats(a);
  };

  it('is decided by the core and the machine weight, nothing else', () => {
    const s = computeStats(PRESETS.biped.build());
    expect(s.coreScale).toBeCloseTo(1, 6);
    expect(s.durability).toBe(Math.round(40 + 60 + s.mass * 5));
  });

  it('a bigger core is a tougher machine', () => {
    const small = withCore(0.5);
    const mid = withCore(1);
    const big = withCore(2);
    expect(mid.durability).toBeGreaterThan(small.durability);
    expect(big.durability).toBeGreaterThan(mid.durability * 2);
    expect(big.coreScale).toBeCloseTo(2, 6);
  });

  it('weight helps too, but only gently', () => {
    const light = computeStats(PRESETS.bits.build());
    const heavy = computeStats(PRESETS.biped.build());
    expect(heavy.mass).toBeGreaterThan(light.mass * 2);
    expect(heavy.durability).toBeGreaterThan(light.durability);
    // not so much that bolting on bricks beats designing a core
    expect(heavy.durability).toBeLessThan(light.durability * 2);
  });

  it('an oblong core is measured by its volume', () => {
    const a = PRESETS.biped.build();
    a.setSize(a.rootId, [4, 1, 1]);
    expect(computeStats(a).coreScale).toBeCloseTo(Math.cbrt(4), 6);
  });

  it('the gravity plate still multiplies it', () => {
    const bare = new Robot(PRESETS.biped.build(), testWorld());
    const a = PRESETS.biped.build();
    a.addEquipOnFace(a.core.id, 4, EQUIP.GRAVITY);
    const armoured = new Robot(a, testWorld());
    expect(armoured.maxHp).toBeGreaterThan(bare.maxHp * 1.3);
    expect(bare.maxHp).toBe(computeStats(PRESETS.biped.build()).durability);
  });
});

// ============================================================
//  Dying and coming back
// ============================================================

describe('a machine that loses', () => {
  let robot;
  beforeEach(() => {
    _resetIds(0);
    robot = new Robot(PRESETS.biped.build(), testWorld());
  });

  it('stops being a machine when the last point goes', () => {
    robot.damage(robot.hp - 1);
    expect(robot.alive).toBe(true);
    expect(robot.object3D.visible).toBe(true);

    robot.damage(5);
    expect(robot.hp).toBe(0);
    expect(robot.alive).toBe(false);
    expect(robot.object3D.visible, 'and takes itself off the field').toBe(false);
  });

  it('cannot be killed twice, or hurt afterwards', () => {
    robot.damage(9999);
    const hp = robot.hp;
    robot.damage(50);
    expect(robot.hp).toBe(hp);
  });

  it('a wreck does not drive', () => {
    robot.damage(9999);
    const before = robot.position.clone();
    expect(() => robot.update({
      move: V(0, 0, 1), look: { yaw: 0, pitch: 0 }, intensity: 1,
      dash: null, isDown: () => false, wasPressed: () => false, lookMagnitude: 0,
    }, 1 / 60)).not.toThrow();
    expect(robot.position.distanceTo(before)).toBe(0);
  });

  it('comes back whole', () => {
    robot.weapons.slots.length = 0;
    robot.damage(9999);
    robot.revive(V(4, 5, -6));

    expect(robot.alive).toBe(true);
    expect(robot.hp).toBe(robot.maxHp);
    expect(robot.object3D.visible).toBe(true);
    expect(robot.position.x).toBeCloseTo(4, 5);
    expect(robot.position.z).toBeCloseTo(-6, 5);
  });

  it('comes back reloaded', () => {
    const a = stripEquips(PRESETS.biped.build());
    a.addEquipOnFace(a.core.id, 4, EQUIP.BEAM);
    const armed = new Robot(a, testWorld());
    armed.weapons.slots[0].ammo = 1;
    armed.damage(9999);
    armed.revive(V());
    expect(armed.weapons.slots[0].ammo).toBe(EQUIP_META.beam.ammo);
  });

  it('revive with no position leaves it where it was', () => {
    const at = robot.position.clone();
    robot.damage(9999);
    robot.revive();
    expect(robot.position.distanceTo(at)).toBeCloseTo(0, 5);
  });
});

// ============================================================
//  Debris
// ============================================================

describe('Debris', () => {
  let scene;
  let world;
  let debris;
  let robot;

  beforeEach(() => {
    _resetIds(0);
    scene = new THREE.Scene();
    world = testWorld();
    debris = new Debris(scene, world);
    robot = new Robot(PRESETS.biped.build(), world);
  });

  it('starts with nothing to draw', () => {
    expect(debris.pieceCount).toBe(0);
    expect(debris.blastCount).toBe(0);
    expect(debris.active).toBe(false);
  });

  it('throws out one chunk per part, plus sparks and a blast', () => {
    const parts = robot.rig.pickables.length;
    debris.burst(robot);
    expect(parts).toBeGreaterThan(5);
    expect(debris.pieceCount).toBe(parts + 18);
    expect(debris.blastCount).toBe(1);
    expect(debris.active).toBe(true);
  });

  it('the chunks are the machine, not a generic puff', () => {
    debris.burst(robot, { sparks: 0 });
    const geometries = new Set(robot.rig.pickables.map((m) => m.geometry));
    for (const p of debris.pieces) {
      expect(geometries.has(p.mesh.geometry), 'same geometry as the part').toBe(true);
    }
  });

  it('starts each chunk exactly where its part was', () => {
    robot.object3D.updateMatrixWorld(true);
    const before = robot.rig.pickables.map((m) => m.getWorldPosition(new THREE.Vector3()));
    debris.burst(robot, { sparks: 0 });
    debris.pieces.forEach((p, i) => {
      expect(p.mesh.position.distanceTo(before[i]), `piece ${i}`).toBeLessThan(1e-4);
    });
  });

  it('throws them outward from the core', () => {
    debris.burst(robot, { sparks: 0 });
    let outward = 0;
    for (const p of debris.pieces) {
      const radial = p.mesh.position.clone().sub(robot.position).setY(0);
      if (radial.lengthSq() < 0.04) continue;
      if (radial.normalize().dot(p.vel.clone().setY(0).normalize()) > 0) outward++;
    }
    expect(outward).toBeGreaterThan(debris.pieces.length * 0.6);
  });

  it('the chunks fall, and settle on the floor rather than through it', () => {
    debris.burst(robot, { sparks: 0 });
    for (let i = 0; i < 150; i++) debris.update(1 / 60);
    expect(debris.pieceCount, 'still around after two and a half seconds').toBeGreaterThan(0);
    for (const p of debris.pieces) {
      expect(p.mesh.position.y, 'nothing underground').toBeGreaterThan(-0.01);
    }
  });

  it('the wreckage clears itself up', () => {
    debris.burst(robot);
    for (let i = 0; i < 60 * 6; i++) debris.update(1 / 60);
    expect(debris.pieceCount).toBe(0);
    expect(debris.blastCount).toBe(0);
    expect(debris.group.children.length, 'only the pooled blast meshes remain')
      .toBe(debris.blasts.length * 3);
  });

  it('the sparks are gone long before the chunks land', () => {
    debris.burst(robot);
    const sparks = () => debris.pieces.filter((p) => p.spark).length;
    expect(sparks()).toBe(18);
    for (let i = 0; i < 45; i++) debris.update(1 / 60);
    expect(sparks()).toBe(0);
    expect(debris.pieces.filter((p) => !p.spark).length).toBeGreaterThan(0);
  });

  it('the blast opens and dies inside a second', () => {
    debris.burst(robot);
    const b = debris.blasts.find((x) => x.life > 0);
    debris.update(1 / 60);
    const opened = b.shell.scale.x;
    for (let i = 0; i < 12; i++) debris.update(1 / 60);
    expect(b.shell.scale.x, 'it expands').toBeGreaterThan(opened);
    expect(b.shell.material.opacity, 'and fades as it goes').toBeLessThan(0.5);
    for (let i = 0; i < 45; i++) debris.update(1 / 60);
    expect(debris.blastCount).toBe(0);
  });

  it('is sized off the machine, not off the arena', () => {
    debris.burst(robot);
    const b = debris.blasts.find((x) => x.life > 0);
    for (let i = 0; i < 20; i++) debris.update(1 / 60);
    expect(b.shell.scale.x, 'a mech kill, not a nuke').toBeLessThan(robot.stats.extent * 3);
  });

  it('never runs away with itself, however many die at once', () => {
    const small = new Debris(scene, world, { maxPieces: 20 });
    for (let i = 0; i < 6; i++) small.burst(robot);
    expect(small.pieceCount).toBeLessThanOrEqual(20);
    small.dispose();
  });

  it('clear and dispose leave nothing behind', () => {
    debris.burst(robot);
    debris.clear();
    expect(debris.pieceCount).toBe(0);
    expect(debris.blastCount).toBe(0);
    expect(() => debris.dispose()).not.toThrow();
  });

  it('survives a machine with nothing to break', () => {
    const bare = new Robot(Assembly.createDefault(), world);
    expect(() => debris.burst(bare)).not.toThrow();
    expect(debris.blastCount).toBe(1);
  });
});
