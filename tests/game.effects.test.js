import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Effects } from '../src/game/Effects.js';
import { Robot } from '../src/game/Robot.js';
import { PRESETS, _resetIds } from '../src/core/Assembly.js';
import { Random } from '../src/core/Random.js';
import { testWorld } from './helpers/dom.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const fx = (opts = {}) =>
  new Effects(new THREE.Scene(), testWorld(), { random: new Random(7), ...opts });

/** A machine standing `height` metres above the floor. */
function machine(height = 0) {
  const r = new Robot(PRESETS.biped.build(), testWorld());
  r.body.reset(V(0, r.body.rideHeight + height, 0));
  return r;
}

describe('muzzle flashes', () => {
  it('a shot puts a flash on the barrel, pointing the way it went', () => {
    const e = fx();
    expect(e.muzzles.every((m) => m.life <= 0), 'nothing burning to start with').toBe(true);

    const m = e.muzzle(V(1, 2, 3), V(0, 0, 1), { color: 0xff8800, scale: 1 });
    expect(m.life).toBeGreaterThan(0);
    expect(m.group.visible).toBe(true);
    expect(m.group.position.toArray()).toEqual([1, 2, 3]);
    expect(m.mat.color.getHex()).toBe(0xff8800);

    // +Z of the flash is down the barrel.
    const aim = V(0, 0, 1).applyQuaternion(m.group.quaternion);
    expect(aim.z).toBeCloseTo(1, 5);
    e.dispose();
  });

  it('and it is gone again in a few frames', () => {
    // A muzzle flash that lingers is a machine on fire.
    const e = fx();
    const m = e.muzzle(V(), V(0, 0, 1));
    e.update(0.05);
    expect(m.life).toBeGreaterThan(0);
    e.update(0.2);
    expect(m.life).toBeLessThanOrEqual(0);
    expect(m.group.visible).toBe(false);
    e.dispose();
  });

  it('a barrel pointing nowhere still gets a flash', () => {
    const e = fx();
    expect(() => e.muzzle(V(), V(0, 0, 0))).not.toThrow();
    expect(e.muzzles.filter((m) => m.life > 0)).toHaveLength(1);
    e.dispose();
  });
});

describe('impacts', () => {
  it('the sparks come back OUT of what was hit', () => {
    // Continuing through the surface is what a MISS looks like. The whole
    // job of the burst is to say the round stopped here.
    const e = fx();
    const im = e.impact(V(0, 4, 10), V(0, 0, 1), { scale: 1 });
    const back = V(0, 0, -1);
    const facing = im.streaks.filter((s) => s.dir.dot(back) > 0);
    expect(facing.length, 'most of them, at least').toBeGreaterThan(im.streaks.length / 2);
    e.dispose();
  });

  it('it is tinted by the round that made it', () => {
    const e = fx();
    expect(e.impact(V(), V(0, 0, 1), { color: 0x7fd4ff }).mat.color.getHex()).toBe(0x7fd4ff);
    e.dispose();
  });

  it('the streaks travel and the whole thing fades out', () => {
    const e = fx();
    const im = e.impact(V(), V(0, 0, 1), { life: 0.3 });
    e.update(1 / 60);
    const near = im.streaks[0].mesh.position.length();
    e.update(0.1);
    expect(im.streaks[0].mesh.position.length(), 'thrown outward').toBeGreaterThan(near);
    expect(im.mat.opacity).toBeLessThan(1);
    e.update(0.3);
    expect(im.group.visible, 'and gone').toBe(false);
    e.dispose();
  });

  it('a full pool recycles rather than dropping the newest hit', () => {
    // A busy second is exactly when the player most needs to see where the
    // rounds are landing, so the pool must never simply refuse.
    const e = fx({ impacts: 3 });
    for (let i = 0; i < 8; i++) e.impact(V(i, 0, 0), V(0, 0, 1));
    expect(e.impacts.filter((x) => x.life > 0)).toHaveLength(3);
    e.dispose();
  });
});

describe('dust', () => {
  it('a puff grows, rises and fades away', () => {
    const e = fx();
    const p = e.dust(V(0, 0, 0), V(0, 0, 6), { scale: 1, life: 0.4 });
    const y0 = p.mesh.position.y;
    const k0 = p.mesh.scale.x;
    e.update(0.1);
    expect(p.mesh.position.y, 'up off the floor').toBeGreaterThan(y0);
    expect(p.mesh.scale.x, 'and out').toBeGreaterThan(k0);
    expect(p.mat.opacity).toBeGreaterThan(0);
    e.update(1);
    expect(p.mesh.visible).toBe(false);
    expect(p.mat.opacity, 'and it leaves nothing behind').toBe(0);
    e.dispose();
  });

  it('it drifts with whatever kicked it up', () => {
    const e = fx();
    const p = e.dust(V(), V(0, 0, 20));
    expect(p.vel.z).toBeGreaterThan(1);
    e.dispose();
  });

  it('every puff fades on its own clock', () => {
    // One shared material would fade the whole trail together, which reads
    // as a light being switched off rather than as dust settling.
    const e = fx();
    const a = e.dust(V(0, 0, 0));
    const b = e.dust(V(3, 0, 0));
    expect(a.mat).not.toBe(b.mat);
    e.dispose();
  });

  it('faces the camera, or it is not there at all', () => {
    const e = fx();
    const p = e.dust(V(0, 0, 0));
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(10, 6, 10);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    e.faceCamera(cam);
    const face = V(0, 0, 1).applyQuaternion(p.mesh.quaternion);
    const toCam = cam.position.clone().sub(p.mesh.position).normalize();
    expect(face.dot(toCam)).toBeGreaterThan(0.9);
    e.dispose();
  });
});

describe('landings', () => {
  it('throws a ring along the floor and a skirt of dust with it', () => {
    const e = fx();
    const r = e.landing(V(4, 3, -2), { scale: 2, power: 1 });
    expect(r.life).toBeGreaterThan(0);
    expect(r.mesh.position.y, 'the ring lies ON the floor, not where the hips are')
      .toBeCloseTo(0.06, 5);
    expect(e.puffs.filter((p) => p.life > 0).length).toBeGreaterThan(3);
    e.dispose();
  });

  it('a harder landing throws more of it', () => {
    const soft = fx();
    soft.landing(V(), { scale: 1, power: 0.2 });
    const hard = fx();
    hard.landing(V(), { scale: 1, power: 1 });
    expect(hard.puffs.filter((p) => p.life > 0).length)
      .toBeGreaterThan(soft.puffs.filter((p) => p.life > 0).length);
    expect(hard.rings[0].scale).toBeGreaterThan(soft.rings[0].scale);
    soft.dispose();
    hard.dispose();
  });

  it('the ring opens out and dies', () => {
    const e = fx();
    const r = e.landing(V(), { scale: 1, power: 1 });
    e.update(1 / 60);
    const first = r.mesh.scale.x;
    e.update(0.15);
    expect(r.mesh.scale.x).toBeGreaterThan(first);
    e.update(0.5);
    expect(r.mesh.visible).toBe(false);
    e.dispose();
  });
});

describe('contact shadows', () => {
  beforeEach(() => _resetIds(0));

  it('every machine gets a blot, directly underneath it', () => {
    const e = fx();
    const r = machine();
    e.track([r]);
    const blot = e.shadows.get(r);
    expect(blot, 'it got one').toBeTruthy();
    expect(blot.visible).toBe(true);
    expect(blot.position.x).toBeCloseTo(r.position.x, 5);
    expect(blot.position.z).toBeCloseTo(r.position.z, 5);
    expect(blot.position.y, 'on the floor, not on the machine').toBeCloseTo(0.03, 5);
    e.dispose();
    r.dispose();
  });

  it('it spreads and fades with height, which is how you read your altitude', () => {
    // The key light throws a real shadow, but a real shadow lands thirty
    // metres sideways and cannot answer "how far up am I". This can.
    const e = fx();
    const low = machine(0);
    e.track([low]);
    const near = { w: e.shadows.get(low).scale.x, a: e.shadows.get(low).material.opacity };

    low.body.position.y += 12;
    e.track([low]);
    const far = { w: e.shadows.get(low).scale.x, a: e.shadows.get(low).material.opacity };

    expect(far.w, 'wider').toBeGreaterThan(near.w);
    expect(far.a, 'and fainter').toBeLessThan(near.a);
    e.dispose();
    low.dispose();
  });

  it('a machine high enough has no contact left to show', () => {
    const e = fx();
    const r = machine(40);
    e.track([r]);
    expect(e.shadows.get(r).visible).toBe(false);
    e.dispose();
    r.dispose();
  });

  it('the blot is taken back when the machine goes', () => {
    const e = fx();
    const r = machine();
    e.track([r]);
    const spare = e.shadowPool.length;

    r.alive = false;
    e.track([r]);
    expect(e.shadows.has(r)).toBe(false);
    expect(e.shadowPool.length, 'and put back for the next one').toBe(spare + 1);
    e.dispose();
    r.dispose();
  });

  it('more machines than blots is a machine without one, not a crash', () => {
    const e = fx({ shadows: 1 });
    const a = machine();
    const b = machine();
    expect(() => e.track([a, b])).not.toThrow();
    expect(e.shadows.size).toBe(1);
    e.dispose();
    a.dispose();
    b.dispose();
  });
});

describe('the effects layer as a whole', () => {
  it('draws its numbers from the stream it was given', () => {
    // Sparks come off the PRESENTATION stream, so drawing more of them can
    // never move a bullet. Same seed in, same sparks out.
    const dirs = (seed) => {
      const e = new Effects(new THREE.Scene(), testWorld(), { random: new Random(seed) });
      const im = e.impact(V(), V(0, 0, 1));
      const out = im.streaks.map((s) => s.dir.toArray());
      e.dispose();
      return out;
    };
    expect(dirs(11)).toEqual(dirs(11));
    expect(dirs(11)).not.toEqual(dirs(12));
  });

  it('clear leaves nothing on screen', () => {
    const e = fx();
    const r = machine();
    e.muzzle(V(), V(0, 0, 1));
    e.impact(V(), V(0, 0, 1));
    e.dust(V());
    e.landing(V(), { power: 1 });
    e.track([r]);
    expect(e.liveCount).toBeGreaterThan(0);

    e.clear();
    expect(e.liveCount).toBe(0);
    expect(e.shadows.size).toBe(0);
    expect(e.group.children.every((c) => !c.visible || c.type === 'Group')).toBe(true);
    e.dispose();
    r.dispose();
  });

  it('survives being run with nothing happening', () => {
    const e = fx();
    for (let i = 0; i < 120; i++) e.update(1 / 60);
    expect(e.liveCount).toBe(0);
    expect(() => e.dispose()).not.toThrow();
  });
});
