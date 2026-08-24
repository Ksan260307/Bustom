import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Random } from '../src/core/Random.js';
import { Robot } from '../src/game/Robot.js';
import { PRESETS } from '../src/core/Assembly.js';
import { EQUIP } from '../src/core/constants.js';
import { Projectiles } from '../src/game/Weapons.js';
import { testWorld, stripEquips } from './helpers/dom.js';

const drawMany = (r, n = 200) => Array.from({ length: n }, () => r.unit());

describe('the replayable number stream', () => {
  it('the same seed gives the same numbers', () => {
    expect(drawMany(new Random(42))).toEqual(drawMany(new Random(42)));
  });

  it('different seeds give different numbers', () => {
    expect(drawMany(new Random(42))).not.toEqual(drawMany(new Random(43)));
  });

  it('any seed works, including the awkward ones', () => {
    for (const seed of [0, -1, 1, 2 ** 31, 2 ** 32 - 1, 0.5]) {
      const out = drawMany(new Random(seed), 50);
      expect(new Set(out).size, `seed ${seed} is not stuck`).toBeGreaterThan(40);
      for (const v of out) {
        expect(Number.isFinite(v), `seed ${seed}`).toBe(true);
        expect(v >= 0 && v < 1, `seed ${seed} in range`).toBe(true);
      }
    }
  });

  it('spreads evenly enough to be worth calling random', () => {
    const r = new Random(7);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) buckets[Math.floor(r.unit() * 10)]++;
    for (const n of buckets) expect(n).toBeGreaterThan(1500);
  });

  it('the shaped draws stay in their ranges', () => {
    const r = new Random(3);
    for (let i = 0; i < 500; i++) {
      const s = r.signed();
      expect(s >= -1 && s < 1).toBe(true);
      const v = r.range(4, 9);
      expect(v >= 4 && v < 9).toBe(true);
      expect(Math.abs(r.sign())).toBe(1);
    }
  });

  it('directions land on the sphere, not in a cube', () => {
    const r = new Random(11);
    const v = new THREE.Vector3();
    let up = 0;
    for (let i = 0; i < 400; i++) {
      r.direction(v);
      expect(v.length()).toBeCloseTo(1, 6);
      if (v.y > 0) up++;
    }
    expect(up, 'not biased to one hemisphere').toBeGreaterThan(150);
    expect(up).toBeLessThan(250);
  });

  it('can be saved and picked up again exactly', () => {
    const r = new Random(5);
    drawMany(r, 37);
    const mark = r.save();
    const after = drawMany(r, 20);
    expect(drawMany(new Random(1).restore(mark), 20)).toEqual(after);
  });

  it('counts how many numbers it has handed out', () => {
    const r = new Random(5);
    expect(r.count).toBe(0);
    drawMany(r, 12);
    expect(r.count).toBe(12);
    r.reseed(5);
    expect(r.count, 'reseeding starts the count over').toBe(0);
  });
});

describe('a fight replays from its seed', () => {
  const shooter = (random) => {
    const a = stripEquips(PRESETS.biped.build());
    a.addEquipOnFace(a.core.id, 4, EQUIP.GATLING, { size: 0.7 });
    a.addEquipOnFace(a.core.id, 2, EQUIP.MISSILE, { size: 0.7 });
    return new Robot(a, testWorld(), { isPlayer: true, random });
  };

  /** Where every round ended up after a burst, as a comparable string. */
  const burst = (seed) => {
    const random = new Random(seed);
    const r = shooter(random);
    const p = new Projectiles(new THREE.Scene(), testWorld(), { max: 128 });
    const ctx = {
      firing: true, aimPoint: new THREE.Vector3(0, 2, 50),
      projectiles: p, targets: [], lockTarget: null,
    };
    for (let i = 0; i < 40; i++) {
      r.weapons.update(ctx, 1 / 60);
      if (i === 20) r.weapons.next();
      p.update(1 / 60, []);
    }
    return p.pool
      .filter((s) => s.life > 0)
      .map((s) => s.mesh.position.toArray().map((v) => v.toFixed(6)).join(','))
      .join('|');
  };

  it('the same seed fires the same spread, twice', () => {
    const a = burst(2024);
    expect(a.length, 'something was actually fired').toBeGreaterThan(20);
    expect(burst(2024)).toBe(a);
  });

  it('a different seed fires a different spread', () => {
    expect(burst(2024)).not.toBe(burst(2025));
  });

  it('without a stream it still works, it just cannot be replayed', () => {
    const a = stripEquips(PRESETS.biped.build());
    a.addEquipOnFace(a.core.id, 4, EQUIP.GATLING, { size: 0.7 });
    const r = new Robot(a, testWorld(), { isPlayer: true });
    const p = new Projectiles(new THREE.Scene(), testWorld(), { max: 32 });
    expect(() => {
      for (let i = 0; i < 20; i++) {
        r.weapons.update({ firing: true, projectiles: p, targets: [] }, 1 / 60);
      }
    }).not.toThrow();
    expect(p.liveCount).toBeGreaterThan(0);
  });

  it('drawing for effects cannot move a bullet', () => {
    // The two streams are separate objects; spending one never advances the
    // other. That is what stops "more sparks on a faster machine" from
    // changing where a shot goes.
    const sim = new Random(99);
    const visual = new Random(99 ^ 0x5bf03635);
    const before = sim.save();
    for (let i = 0; i < 500; i++) visual.unit();
    expect(sim.save()).toEqual(before);
  });
});
