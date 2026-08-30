import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ARENAS, ARENA_ORDER, DEFAULT_ARENA, getArena } from '../src/game/Arenas.js';
import { KITS, buildProp, variantAt } from '../src/game/Props.js';
import { ZMFBody } from '../src/zmf/ZMFBody.js';
import { SyntheticInput } from '../src/game/Robot.js';
import { Assembly, PRESETS, computeStats } from '../src/core/Assembly.js';
import { testWorld, stripEquips } from './helpers/dom.js';

const STATS = computeStats(stripEquips(PRESETS.biped.build()));
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function run(body, input, seconds, dt = 1 / 60) {
  for (let i = 0; i < Math.round(seconds / dt); i++) body.update(input, dt);
  return body;
}

describe('the places a fight happens', () => {
  it('offers seven of them, all listed and all real', () => {
    expect(ARENA_ORDER).toHaveLength(7);
    expect(new Set(ARENA_ORDER).size).toBe(7);
    for (const id of ARENA_ORDER) expect(ARENAS[id]).toBeTruthy();
    // And nothing is on the shelf that the list forgot about.
    expect(Object.keys(ARENAS).sort()).toEqual([...ARENA_ORDER].sort());
  });

  it('gives every one of them what the world needs to build it', () => {
    for (const id of ARENA_ORDER) {
      const a = ARENAS[id];
      expect(typeof a.label).toBe('string');
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.gravity).toBeGreaterThanOrEqual(0);
      expect(a.radius).toBeGreaterThan(40);
      expect(a.ceiling).toBeGreaterThan(a.radius / 4);
      expect(Array.isArray(a.pillars)).toBe(true);
      expect(Array.isArray(a.platforms)).toBe(true);
      // Cover has to stand on the floor and have some width, or the collider
      // built from it is degenerate and rounds pass straight through.
      for (const [, , r, h] of a.pillars) {
        expect(r).toBeGreaterThan(0.5);
        expect(h).toBeGreaterThan(1);
      }
      // And nothing may stand outside the wall.
      for (const [x, z, r] of a.pillars) {
        expect(Math.hypot(x, z) + r).toBeLessThan(a.radius);
      }
      for (const [x, y, z, w] of a.platforms) {
        expect(Math.hypot(x, z) + w).toBeLessThan(a.radius);
        expect(y).toBeLessThan(a.ceiling);
      }
      for (const [x, y, z, r, h] of a.floaters ?? []) {
        expect(Math.hypot(x, z) + r, `${id} floater at ${x},${z}`).toBeLessThan(a.radius);
        expect(y + h).toBeLessThan(a.ceiling);
        expect(y).toBeGreaterThan(h);        // actually off the ground
      }
    }
  });

  it('they are not all the same fight', () => {
    // Per unit of floor, not per arena: twenty pieces of cover on a
    // hundred-and-fifty-metre flat is an empty plain, and the same twenty
    // in a ninety-metre yard is a maze. Counting them straight said those
    // two were the same place.
    const density = ARENA_ORDER.map((id) => {
      const a = ARENAS[id];
      return a.pillars.length / (Math.PI * a.radius * a.radius);
    });
    expect(Math.max(...density)).toBeGreaterThan(Math.min(...density) * 4);
    const gravity = new Set(ARENA_ORDER.map((id) => ARENAS[id].gravity));
    expect(gravity.size).toBeGreaterThanOrEqual(3);
    // And how much of the fight is off the ground: anything standing on a
    // platform, plus anything hanging in the volume.
    const air = ARENA_ORDER.map((id) => {
      const a = ARENAS[id];
      return a.platforms.length + (a.floaters ?? []).length;
    });
    expect(Math.max(...air)).toBeGreaterThan(6);
    // Somewhere has none at all: a place where the whole fight is on the
    // floor is a different fight from one where it is not.
    expect(Math.min(...air)).toBe(0);
  });

  it('the Moon is light but not weightless; orbit is weightless', () => {
    const g = ARENAS.moon.gravity;
    // Not zero: the Moon is open ground with no ceiling over it, and with
    // nothing pulling you back a single burn would be a one-way trip off
    // the top of the map. A fourteenth of a gee still brings you home.
    expect(g).toBeGreaterThan(0);
    expect(ARENAS.orbit.gravity).toBe(0);
    const heavy = ARENA_ORDER
      .filter((id) => id !== 'moon' && id !== 'orbit')
      .map((id) => ARENAS[id].gravity);
    expect(g).toBeLessThan(Math.min(...heavy) / 8);
  });

  it('the weightless places put their cover in the air, not on the deck', () => {
    // A weightless arena furnished only from the floor is furnished in the
    // one place nobody goes: with nothing pulling you down, the deck is the
    // far wall of the fight rather than its floor.
    for (const id of ['orbit', 'moon']) {
      const air = ARENAS[id].floaters ?? [];
      expect(air.length, `${id} has cover off the ground`).toBeGreaterThanOrEqual(4);
    }
    // Space has NOTHING else: no floor cover and no platforms. There is no
    // floor there worth the name, so furniture on it is furniture in a room
    // nobody enters, and a platform is somewhere to stand for a machine
    // with no reason to stand.
    expect(ARENAS.orbit.pillars).toHaveLength(0);
    expect(ARENAS.orbit.platforms).toHaveLength(0);
    // And the heavy places have none in the air: cover you cannot reach is
    // not cover.
    for (const id of ['proving', 'city', 'works', 'canyon', 'flats']) {
      expect(ARENAS[id].floaters ?? []).toHaveLength(0);
    }
  });

  it('the two places with no floor worth standing on go without a wall', () => {
    const open = ARENA_ORDER.filter((id) => ARENAS[id].open).sort();
    expect(open).toEqual(['moon', 'orbit']);
    // The Moon's ceiling is far enough up that nobody meets it by accident,
    // while still being there as a backstop.
    expect(ARENAS.moon.ceiling).toBeGreaterThan(300);
  });

  it('gives every place a dozen silhouettes to furnish itself from', () => {
    for (const id of ARENA_ORDER) {
      const a = ARENAS[id];
      const kit = KITS[a.prop];
      expect(kit, `${id} asks for a kit called ${a.prop}`).toBeTruthy();
      expect(kit.length).toBeGreaterThanOrEqual(12);
      // And it actually USES most of them: a kit of twelve that a place
      // only ever draws three from has not furnished anything.
      const spots = [
        ...a.pillars.map(([x, z]) => [x, z]),
        ...(a.floaters ?? []).map(([x, y, z]) => [x, z + y]),
      ];
      const used = new Set(spots.map(([x, k]) => variantAt(x, k, a.propSalt ?? 0) % kit.length));
      // Scaled to how much furniture the place actually has: the salt flat
      // is meant to hold eight things, and eight things cannot show twelve
      // shapes. What matters is that it is not showing the same one twice
      // over and over.
      const want = Math.min(8, Math.max(3, Math.round(spots.length * 0.6)));
      expect(used.size, `${id} shows ${used.size} of ${kit.length} across ${spots.length}`)
        .toBeGreaterThanOrEqual(want);
    }
  });

  it('every place is made of something, and says what', () => {
    for (const id of ARENA_ORDER) {
      const a = ARENAS[id];
      expect(typeof a.floor).toBe('string');
      expect(typeof a.skin).toBe('string');
      expect(typeof a.prop).toBe('string');
      expect(a.floorScale).toBeGreaterThan(4);
      expect(a.skinColor).toBeGreaterThan(0);
    }
    // And no two look alike: the floor and the cover shape together have to
    // tell one place from another before a single label is read.
    const looks = ARENA_ORDER.map((id) => ARENAS[id].floor + '/' + ARENAS[id].prop);
    expect(new Set(looks).size).toBeGreaterThanOrEqual(5);
  });

  it('falls back to the default rather than to nothing', () => {
    expect(getArena('no such place')).toBe(ARENAS[DEFAULT_ARENA]);
    expect(getArena(undefined)).toBe(ARENAS[DEFAULT_ARENA]);
  });
});

describe('a machine on the Moon', () => {
  const lunar = () => {
    // Well clear of the ceiling: hitting it is a shove downwards, which
    // would swamp the very thing being measured.
    const body = new ZMFBody(STATS, testWorld([], {
      gravity: ARENAS.moon.gravity, ceiling: 400,
    }), { rideHeight: 2 });
    body.reset(V(0, 200, 0));
    return body;
  };

  const weightless = () => {
    const body = new ZMFBody(STATS, testWorld([], { gravity: 0 }), { rideHeight: 2 });
    body.reset(V(0, 30, 0));
    return body;
  };

  it('falls, but takes its time about it', () => {
    const body = lunar();
    const from = body.position.y;
    run(body, new SyntheticInput(), 3);
    const dropped = from - body.position.y;
    // It does come down — otherwise, with no ceiling, one burn is a one-way
    // trip. It just comes down slowly enough to think on the way.
    expect(dropped).toBeGreaterThan(0.5);
    expect(dropped).toBeLessThan(14);
  });

  it('falls far slower than anywhere else', () => {
    const moon = lunar();
    const earth = new ZMFBody(STATS, testWorld([], { ceiling: 400 }), { rideHeight: 2 });
    earth.reset(V(0, 200, 0));
    run(moon, new SyntheticInput(), 2.5);
    run(earth, new SyntheticInput(), 2.5);
    expect(200 - moon.position.y).toBeLessThan((200 - earth.position.y) / 5);
  });

  it('does not fall at all with the gravity taken right out', () => {
    const body = weightless();
    run(body, new SyntheticInput(), 3);
    expect(body.position.y).toBeGreaterThan(29);
  });

  it('still falls where there IS gravity', () => {
    const body = new ZMFBody(STATS, testWorld(), { rideHeight: 2 });
    body.reset(V(0, 30, 0));
    run(body, new SyntheticInput(), 3);
    expect(body.position.y).toBeLessThan(20);
  });

  it('comes to a stop when the controls are let go', () => {
    // Otherwise a tap of the thruster is a one-way trip to the ceiling and
    // the controls stop being controls.
    const body = weightless();
    const push = new SyntheticInput();
    push.move.set(0, 0, 1);
    run(body, push, 1.5);
    const moving = body.speed;
    expect(moving).toBeGreaterThan(2);

    run(body, new SyntheticInput(), 4);
    expect(body.speed).toBeLessThan(moving * 0.15);
  });

  it('still goes somewhere while it is being asked to', () => {
    const body = weightless();
    const push = new SyntheticInput();
    push.move.set(0, 0, 1);
    const from = body.position.clone();
    run(body, push, 2);
    expect(body.position.distanceTo(from)).toBeGreaterThan(6);
  });

  it('answers the lift control, which is the only way up', () => {
    const body = weightless();
    const up = new SyntheticInput();
    up.hold('up', true);
    run(body, up, 1.5);
    expect(body.position.y).toBeGreaterThan(31);
  });
});
