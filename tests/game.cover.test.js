import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { World } from '../src/game/World.js';
import { Projectiles } from '../src/game/Weapons.js';

// ============================================================
//  Cover.
//
//  The arena has been full of pillars since the first build and they only
//  ever did one thing: break a lock. Rounds went straight through them, so
//  standing behind one looked like it should work and did not — which is
//  worse than having no cover at all.
// ============================================================

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** A real arena, pillars and all. */
function arena() {
  return new World(new THREE.Scene());
}

/** Somewhere inside the first pillar still standing. */
function insideCover(world) {
  return world.pillars[0].box.getCenter(new THREE.Vector3());
}

describe('the arena stops rounds', () => {
  let world;
  beforeEach(() => { world = arena(); });

  it('has pillars that can be worn down', () => {
    expect(world.pillars.length, 'there are some').toBeGreaterThan(0);
    for (const p of world.pillars) expect(p.hp, p.hp).toBeGreaterThan(0);
  });

  it('knows the difference between inside a pillar and open ground', () => {
    expect(world.blocksAt(insideCover(world)), 'in cover').toBe(true);
    expect(world.blocksAt(V(0, 2, 0)), 'and out in the middle').toBe(false);
  });

  it('a round that reaches a pillar stops there', () => {
    const proj = new Projectiles(new THREE.Scene(), world, { max: 8 });
    const at = insideCover(world);
    // Fired from just outside it, straight in.
    const from = at.clone().add(V(0, 0, -6));
    proj.spawn({
      position: from, direction: V(0, 0, 1), speed: 60, life: 3,
      damage: 5, radius: 0.2, owner: null,
    });
    for (let i = 0; i < 30 && proj.liveCount > 0; i++) proj.update(1 / 60, []);
    expect(proj.liveCount, 'it did not come out the other side').toBe(0);
  });

  it('and the same shot in the open keeps going', () => {
    const proj = new Projectiles(new THREE.Scene(), world, { max: 8 });
    proj.spawn({
      position: V(0, 3, 0), direction: V(0, 0, 1), speed: 60, life: 3,
      damage: 5, radius: 0.2, owner: null,
    });
    proj.update(1 / 60, []);
    expect(proj.liveCount, 'still in the air').toBe(1);
  });

  it('enough rounds take the pillar away', () => {
    // Cover that can never be taken is a place to stand and win from; cover
    // that runs out is a decision about when to leave it.
    const pillar = world.pillars[0];
    const at = pillar.box.getCenter(new THREE.Vector3());
    const before = world.colliders.length;
    let broke = null;
    for (let i = 0; i < 400 && !broke; i++) broke = world.damageCover(at, 20);
    expect(broke, 'it came down').toBe(pillar);
    expect(world.colliders.length, 'and stopped being solid').toBe(before - 1);
    expect(world.blocksAt(at), 'the line through it is open now').toBe(false);
    for (const m of pillar.mesh) expect(m.visible, 'and it is gone from the arena').toBe(false);
  });

  it('a new match is a new arena', () => {
    const pillar = world.pillars[0];
    const at = pillar.box.getCenter(new THREE.Vector3());
    const before = world.colliders.length;
    for (let i = 0; i < 400; i++) world.damageCover(at, 20);
    world.resetCover();
    expect(pillar.hp, 'back up').toBe(pillar.maxHp);
    expect(world.colliders.length).toBe(before);
    expect(world.blocksAt(at)).toBe(true);
    for (const m of pillar.mesh) expect(m.visible).toBe(true);
  });

  it('damage outside every pillar wears nothing down', () => {
    const hp = world.pillars.map((p) => p.hp);
    expect(world.damageCover(V(0, 2, 0), 500)).toBe(null);
    world.pillars.forEach((p, i) => expect(p.hp).toBe(hp[i]));
  });
});
