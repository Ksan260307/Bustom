import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Animator, waveAt, limitAngle } from '../src/anim/Animator.js';
import { Rig } from '../src/core/Rig.js';
import { Assembly, PRESETS, computeStats } from '../src/core/Assembly.js';
import { BONE, BONE_META, WEAPON_BONE_DEFAULT } from '../src/core/constants.js';

const DEG = Math.PI / 180;

function rigOf(assembly) {
  const rig = new Rig(assembly);
  const stats = computeStats(assembly, rig);
  return { rig, stats, animator: new Animator(rig, stats) };
}

/** A machine with one bone of the given type hanging off the core. */
function oneBone(type, opts = {}) {
  const a = Assembly.createDefault();
  const bone = a.addBone(a.core.id, { pos: [0, -0.5, 0] }, type, {
    length: 2, radius: 0.3, ...opts,
  });
  return { a, boneId: bone.id };
}

/** A machine with one custom bone, moving the way the caller says. */
function movingBone(custom, opts = {}) {
  return oneBone(BONE.CUSTOM, { limit: 90, custom, ...opts });
}

const state = (extra = {}) => ({
  dt: 1 / 60,
  speed: 0,
  planarSpeed: 0,
  grounded: 1,
  airborne: 0,
  velocity: new THREE.Vector3(),
  bodyQ: new THREE.Quaternion(),
  aimDir: null,
  locked: 0,
  thrust: 0,
  jerk: 0,
  ...extra,
});

/** How far a joint has turned, in degrees, sign kept. */
function angleOf(node) {
  const q = node.joint.quaternion;
  const v = new THREE.Vector3(q.x, q.y, q.z);
  const sign = Math.sign(q.x + q.y + q.z) || 1;
  return (2 * Math.atan2(v.length() * sign, q.w)) / DEG;
}

// ============================================================
//  The shapes a bone can move in
// ============================================================

describe('the shapes a bone can move in', () => {
  it('has a wave that snaps out and eases back', () => {
    // A recoil is not a sine: it spends almost none of its time going out
    // and nearly all of it coming back.
    expect(waveAt('pulse', 0.02)).toBeGreaterThan(0.7);
    expect(waveAt('pulse', 0.5)).toBeLessThan(0);
    // And it still has to fit the band everything downstream assumes.
    for (let t = 0; t < 1; t += 0.01) {
      expect(Math.abs(waveAt('pulse', t))).toBeLessThanOrEqual(1.0001);
    }
  });

  it('has a wave that wanders, the same way every time', () => {
    const run = () => {
      const out = [];
      for (let t = 0; t < 4; t += 0.05) out.push(waveAt('noise', t));
      return out;
    };
    const first = run();
    expect(run()).toEqual(first);
    // A "noise" that is a straight line is a bug nobody spots from the code.
    expect(Math.max(...first) - Math.min(...first)).toBeGreaterThan(0.8);
    expect(Math.max(...first.map(Math.abs))).toBeLessThanOrEqual(1.0001);
    // Smooth: neighbouring samples must not jump the whole range.
    let biggest = 0;
    for (let i = 1; i < first.length; i++) {
      biggest = Math.max(biggest, Math.abs(first[i] - first[i - 1]));
    }
    expect(biggest).toBeLessThan(0.6);
  });
});

// ============================================================
//  How far a joint may go
// ============================================================

describe('how far a joint may go', () => {
  it('goes as far back as forward unless told otherwise', () => {
    const part = { limit: 40 };
    expect(limitAngle(90 * DEG, part) / DEG).toBeCloseTo(40, 6);
    expect(limitAngle(-90 * DEG, part) / DEG).toBeCloseTo(-40, 6);
  });

  it('bends one way, like a knee', () => {
    const part = { limit: 120, limitBack: 3 };
    expect(limitAngle(150 * DEG, part) / DEG).toBeCloseTo(120, 6);
    expect(limitAngle(-150 * DEG, part) / DEG).toBeCloseTo(-3, 6);
  });

  it('can spring off the stop instead of parking on it', () => {
    const part = { limit: 40, limitMode: 'bounce' };
    // Ten degrees past forty comes back to thirty, not to forty.
    expect(limitAngle(50 * DEG, part) / DEG).toBeCloseTo(30, 6);
    // And never past the stop the other way, however far it overshoots.
    expect(limitAngle(400 * DEG, part) / DEG).toBeGreaterThanOrEqual(0);
  });

  it('can carry on round, for anything that is really a rotation', () => {
    const part = { limit: 40, limitMode: 'wrap' };
    expect(limitAngle(200 * DEG, part) / DEG).toBeCloseTo(200, 6);
  });

  it('shrinks as the joint is shot up', () => {
    const part = { limit: 60 };
    expect(limitAngle(90 * DEG, part, 0) / DEG).toBeCloseTo(60, 6);
    expect(limitAngle(90 * DEG, part, 0.8) / DEG).toBeCloseTo(36, 6);
  });
});

// ============================================================
//  The weapon bone
// ============================================================

describe('a bone that moves when you change weapons', () => {
  it('holds one pose for its weapon and another for everything else', () => {
    const { a, boneId } = oneBone(BONE.WEAPON);
    a.setWeaponMotion(boneId, { when: 'gatling', stowed: 0, deployed: -70, speed: 12 });
    const kit = rigOf(a);
    const node = kit.rig.nodes.get(boneId);

    for (let i = 0; i < 120; i++) kit.animator.update(state({ activeWeapon: null }));
    const stowed = Math.abs(angleOf(node));

    for (let i = 0; i < 240; i++) kit.animator.update(state({ activeWeapon: 'gatling' }));
    const deployed = Math.abs(angleOf(node));

    for (let i = 0; i < 240; i++) kit.animator.update(state({ activeWeapon: 'missile' }));
    const other = Math.abs(angleOf(node));

    expect(stowed).toBeLessThan(4);
    expect(deployed).toBeGreaterThan(55);
    // The pose says WHICH weapon, so the wrong one must not raise it.
    expect(other).toBeLessThan(4);
  });

  it('stands still between switches', () => {
    // "Only moves when you switch" is the whole brief: a weapon bone that
    // drifts while the trigger is held is just a custom bone.
    const { a, boneId } = oneBone(BONE.WEAPON);
    a.setWeaponMotion(boneId, { when: 'any', deployed: -60, speed: 8 });
    const kit = rigOf(a);
    const node = kit.rig.nodes.get(boneId);
    for (let i = 0; i < 600; i++) kit.animator.update(state({ activeWeapon: 'gatling' }));
    const settled = angleOf(node);
    for (let i = 0; i < 120; i++) kit.animator.update(state({ activeWeapon: 'gatling' }));
    expect(Math.abs(angleOf(node) - settled)).toBeLessThan(0.05);
  });

  it('carries past its mark on the way and comes back to it', () => {
    const { a, boneId } = oneBone(BONE.WEAPON);
    a.setWeaponMotion(boneId, {
      when: 'any', deployed: -60, speed: 4, overshoot: 0.3,
    });
    const kit = rigOf(a);
    const node = kit.rig.nodes.get(boneId);
    // Stowed first: a machine that spawns holding a gun starts holding it,
    // so there is nothing to overshoot until something changes.
    for (let i = 0; i < 300; i++) kit.animator.update(state({ activeWeapon: null }));
    let furthest = 0;
    for (let i = 0; i < 600; i++) {
      kit.animator.update(state({ activeWeapon: 'gatling' }));
      furthest = Math.max(furthest, Math.abs(angleOf(node)));
    }
    const settled = Math.abs(angleOf(node));
    expect(furthest).toBeGreaterThan(settled + 1);
    expect(settled).toBeGreaterThan(55);
  });

  it('is a bone type like any other, and survives being saved', () => {
    const { a, boneId } = oneBone(BONE.WEAPON);
    a.setWeaponMotion(boneId, { when: 'sniper', deployed: -95 });
    const back = Assembly.fromJSON(a.toJSON());
    const part = [...back.parts.values()].find((p) => p.kind === 'bone');
    expect(part.boneType).toBe(BONE.WEAPON);
    expect(part.weapon.when).toBe('sniper');
    expect(part.weapon.deployed).toBe(-95);

    // A document saved before any of this existed still loads.
    const old = a.toJSON();
    for (const p of old.parts) delete p.weapon;
    const legacy = Assembly.fromJSON(old);
    const lp = [...legacy.parts.values()].find((p) => p.kind === 'bone');
    expect(lp.weapon).toEqual(WEAPON_BONE_DEFAULT);
  });
});

// ============================================================
//  Linkage
// ============================================================

describe('a bone that copies another one', () => {
  it('follows its partner, scaled', () => {
    const a = Assembly.createDefault();
    const driver = a.addBone(a.core.id, { pos: [0.4, 0, 0] }, BONE.WEAPON, {
      length: 2, radius: 0.3,
    });
    a.setWeaponMotion(driver.id, { when: 'any', deployed: -60, speed: 14 });
    const follower = a.addBone(a.core.id, { pos: [-0.4, 0, 0] }, BONE.CUSTOM, {
      length: 2, radius: 0.3,
    });
    a.setBoneShape(follower.id, { limit: 180, link: { to: driver.id, ratio: 0.5 } });

    const kit = rigOf(a);
    const dn = kit.rig.nodes.get(driver.id);
    const fn = kit.rig.nodes.get(follower.id);
    for (let i = 0; i < 400; i++) kit.animator.update(state({ activeWeapon: 'gatling' }));

    const d = Math.abs(angleOf(dn));
    const f = Math.abs(angleOf(fn));
    expect(d).toBeGreaterThan(55);
    expect(f / d).toBeCloseTo(0.5, 1);
  });
});

// ============================================================
//  What a bone can be driven by
// ============================================================

describe('what a bone can be driven by', () => {
  const driven = (source, signals) => {
    const { a, boneId } = movingBone({
      source, wave: 'sine', amp: 40, freq: 2, axis: 'x',
    });
    const kit = rigOf(a);
    const node = kit.rig.nodes.get(boneId);
    let span = 0;
    for (let i = 0; i < 180; i++) {
      kit.animator.update(state(signals));
      span = Math.max(span, Math.abs(angleOf(node)));
    }
    return span;
  };

  it('moves for the fight, not just for the walk', () => {
    // Every one of these was unreachable: a machine looked the same full of
    // holes and out of energy as it did fresh off the bench.
    expect(driven('hp', { hp: 0.2 })).toBeGreaterThan(10);
    expect(driven('hp', { hp: 1 })).toBeLessThan(2);
    expect(driven('energy', { energy: 0.1 })).toBeGreaterThan(10);
    expect(driven('energy', { energy: 1 })).toBeLessThan(2);
    expect(driven('boost', { boost: 1 })).toBeGreaterThan(10);
    expect(driven('boost', { boost: 0 })).toBeLessThan(2);
    expect(driven('recoil', { fired: true })).toBeGreaterThan(10);
    expect(driven('recoil', { fired: false })).toBeLessThan(2);
    expect(driven('damage', { hurt: 1 })).toBeGreaterThan(10);
    expect(driven('landing', { landing: 20 })).toBeGreaterThan(10);
  });

  it('settles again after the thing that moved it stops', () => {
    const { a, boneId } = movingBone({
      source: 'recoil', wave: 'sine', amp: 40, freq: 2, axis: 'x',
    });
    const kit = rigOf(a);
    const node = kit.rig.nodes.get(boneId);
    for (let i = 0; i < 30; i++) kit.animator.update(state({ fired: true }));
    for (let i = 0; i < 120; i++) kit.animator.update(state({ fired: false }));
    // A shot is an instant; a bone still swinging for it two seconds later
    // has been left switched on.
    expect(Math.abs(angleOf(node))).toBeLessThan(1);
  });
});

// ============================================================
//  More than one thing at a time
// ============================================================

describe('a custom bone can do more than one thing at a time', () => {
  it('lays a small quick wave over a big slow one', () => {
    const roughness = (amp2) => {
      const { a, boneId } = movingBone({
        source: 'time', wave: 'sine', amp: 20, freq: 0.5, axis: 'x',
        amp2, freq2: 3, wave2: 'sine',
      });
      const kit = rigOf(a);
      const node = kit.rig.nodes.get(boneId);
      // Path length in the pose itself, which needs no axis and no sign.
      const prev = new THREE.Quaternion();
      let travelled = 0;
      for (let i = 0; i < 300; i++) {
        kit.animator.update(state());
        if (i) travelled += prev.angleTo(node.target) / DEG;
        prev.copy(node.target);
      }
      return travelled;
    };
    // The tremble shows up as distance travelled, which is exactly what one
    // wave cannot buy without also getting bigger.
    expect(roughness(8)).toBeGreaterThan(roughness(0) * 1.5);
  });

  it('can lean further the harder it is driven', () => {
    const rest = (drive) => {
      const { a, boneId } = movingBone({
        source: 'speed', wave: 'sine', amp: 20, freq: 1, axis: 'x', offsetGain: 1,
      });
      const kit = rigOf(a);
      const node = kit.rig.nodes.get(boneId);
      for (let i = 0; i < 200; i++) kit.animator.update(state({ planarSpeed: drive }));
      return Math.abs(angleOf(node));
    };
    // A waist that leans into the run, rather than only twisting harder.
    expect(rest(0)).toBeLessThan(1);
    expect(rest(18)).toBeGreaterThan(10);
  });

  it('can be a spin, or a spin that stops at the joint limit', () => {
    const spin = (bounded) => {
      const { a, boneId } = movingBone({
        source: 'time', wave: 'saw', amp: 90, freq: 1, axis: 'x', bounded,
      }, { limit: 30 });
      const kit = rigOf(a);
      const node = kit.rig.nodes.get(boneId);
      const rest = new THREE.Quaternion();
      let biggest = 0;
      for (let i = 0; i < 400; i++) {
        kit.animator.update(state());
        biggest = Math.max(biggest, node.joint.quaternion.angleTo(rest) / DEG);
      }
      return biggest;
    };
    // Free: all the way round, which is what a propeller does.
    expect(spin(false)).toBeGreaterThan(100);
    // Bounded: the same setting, held inside the joint.
    expect(spin(true)).toBeLessThan(35);
  });
});

// ============================================================
//  Settling
// ============================================================

describe('how a bone settles onto its pose', () => {
  it('can be set to arrive sooner or later than the rest', () => {
    const arrive = (ease) => {
      const { a, boneId } = oneBone(BONE.WEAPON);
      a.setWeaponMotion(boneId, { when: 'any', deployed: -60, speed: 40 });
      a.setBoneShape(boneId, { follow: { ease, damping: 1 } });
      const kit = rigOf(a);
      const node = kit.rig.nodes.get(boneId);
      for (let i = 0; i < 600; i++) kit.animator.update(state({ activeWeapon: null }));
      let frames = 0;
      while (frames < 600 && Math.abs(angleOf(node)) < 50) {
        kit.animator.update(state({ activeWeapon: 'gatling' }));
        frames++;
      }
      return frames;
    };
    // Every joint used to be slerped at one rate, so a two-tonne arm and a
    // whip aerial arrived at exactly the same speed.
    expect(arrive(0.5)).toBeGreaterThan(arrive(0.02));
  });

  it('lets a chain say how much of the swing each link takes', () => {
    const { a, boneId } = oneBone(BONE.CUSTOM);
    expect(a.get(boneId).chain).toBeGreaterThan(0);
    a.setBoneShape(boneId, { chain: 0.95 });
    expect(a.get(boneId).chain).toBe(0.95);
    // And it comes back off disk, because a tentacle that flattens into a
    // forearm on reload is worse than not having the setting.
    const back = Assembly.fromJSON(a.toJSON());
    const part = [...back.parts.values()].find((p) => p.kind === 'bone');
    expect(part.chain).toBe(0.95);
  });
});

// ============================================================
//  Damage
// ============================================================

describe('a joint that has been shot', () => {
  it('drives less hard, without ever seizing', () => {
    const { a, boneId } = movingBone({
      source: 'time', wave: 'sine', amp: 60, freq: 2, axis: 'x',
    });
    const kit = rigOf(a);
    const node = kit.rig.nodes.get(boneId);

    const swing = () => {
      let span = 0;
      for (let i = 0; i < 200; i++) {
        kit.animator.update(state());
        span = Math.max(span, Math.abs(angleOf(node)));
      }
      return span;
    };
    const whole = swing();
    node.wear = 0.8;
    const hurt = swing();

    expect(whole).toBeGreaterThan(30);
    expect(hurt).toBeLessThan(whole * 0.6);
    // A leg that stops entirely reads as a broken game, not a damaged one.
    expect(hurt).toBeGreaterThan(1);
  });
});

// ============================================================
//  What a leg is made of
// ============================================================

describe('what a leg is made of', () => {
  /** A real machine, with its legs re-gauged. */
  const regauged = (scale) => {
    const a = PRESETS.biped.build();
    a.walk((p) => {
      if (p.kind === 'bone' && p.boneType === BONE.LEG) {
        a.setBoneShape(p.id, { radius: p.radius * scale });
      }
    });
    return computeStats(a);
  };

  it('counts for something, not just for weight', () => {
    const thin = regauged(0.5);
    const thick = regauged(1.6);
    // The bone table has carried a torque figure since bones existed and
    // nothing read it, so thickness only ever cost weight.
    expect(BONE_META.leg.torque).toBeGreaterThan(0);
    expect(thick.legTorque).toBeGreaterThan(thin.legTorque * 3);
    expect(thick.legDrive).toBeGreaterThan(thin.legDrive * 1.1);
  });

  it('stays inside its bounds however the machine was built', () => {
    for (const p of Object.values(PRESETS)) {
      const s = computeStats(p.build());
      expect(s.legDrive).toBeGreaterThanOrEqual(0.72);
      expect(s.legDrive).toBeLessThanOrEqual(1.35);
    }
  });
});

// ============================================================
//  Feet
// ============================================================

describe('putting a foot on what is under it', () => {
  /** A two-legged machine, posed and with its transforms up to date. */
  const stand = () => {
    const a = PRESETS.biped.build();
    const kit = rigOf(a);
    for (let i = 0; i < 120; i++) kit.animator.update(state());
    kit.rig.root.updateMatrixWorld(true);
    return kit;
  };

  /** How high each foot is above a given surface height. */
  const feetOver = (kit, surface) => kit.rig.limbs.map((limb) => {
    const tip = limb.chain[limb.chain.length - 1];
    const v = new THREE.Vector3(0, tip.length / 2, 0);
    tip.far.localToWorld(v);
    return v.y - surface(v.x, v.z);
  });

  it('lifts a foot out of a step it is standing inside', () => {
    const kit = stand();
    // Whatever the feet are resting at now IS the floor. One of them then
    // gets a step under it, which is the case the body cannot see: it is
    // held up by a single probe at the middle of the machine.
    const flat = feetOver(kit, () => 0);
    const groundY = Math.min(...flat);
    const stepX = (() => {
      const limb = kit.rig.limbs[0];
      const tip = limb.chain[limb.chain.length - 1];
      const v = new THREE.Vector3(0, tip.length / 2, 0);
      tip.far.localToWorld(v);
      return v.x;
    })();
    // A step half a metre high under whichever side that foot is on.
    const surface = (x) => (Math.sign(x) === Math.sign(stepX) && stepX !== 0
      ? groundY + 0.5 : groundY);

    const before = feetOver(kit, surface);
    for (let i = 0; i < 90; i++) {
      kit.animator.update(state());
      kit.rig.root.updateMatrixWorld(true);
      kit.animator.plantFeet((x, z, fromY) => Math.min(surface(x, z), fromY), 1, 1 / 60);
    }
    const after = feetOver(kit, surface);

    // The foot on the step was half a metre inside it and is now much less.
    const worstBefore = Math.max(...before.map(Math.abs));
    const worstAfter = Math.max(...after.map(Math.abs));
    // Measured: half a metre inside the step, to three centimetres — which
    // is the slack the correction deliberately leaves, so a foot resting a
    // hair inside something does not keep the legs working.
    expect(worstBefore).toBeGreaterThan(0.3);
    expect(worstAfter).toBeLessThan(0.05);
  });

  it('leaves a machine alone when it is not on the ground', () => {
    const kit = stand();
    const before = kit.rig.limbs.map((l) => l.root.joint.quaternion.clone());
    for (let i = 0; i < 60; i++) {
      kit.animator.plantFeet(() => 999, 0, 1 / 60);
    }
    // In the air there is nothing to stand on, and a leg reaching for a
    // floor a kilometre below is worse than a leg left alone.
    for (let i = 0; i < kit.rig.limbs.length; i++) {
      expect(kit.rig.limbs[i].root.joint.quaternion.angleTo(before[i])).toBeLessThan(1e-6);
    }
  });

  it('never reaches DOWN for anything', () => {
    const kit = stand();
    const before = kit.rig.limbs.map((l) => l.root.joint.quaternion.clone());
    // Half of every stride is a leg in the air on purpose, and there is no
    // per-foot "this one is taking the weight" to tell that apart from a
    // leg that has missed the floor. So a foot is only ever lifted out of
    // something, never pulled down onto it — otherwise the correction
    // spends the whole gait fighting the animation, at sixty hertz.
    for (let i = 0; i < 90; i++) {
      kit.animator.update(state());
      kit.rig.root.updateMatrixWorld(true);
      kit.animator.plantFeet(() => -40, 1, 1 / 60);
    }
    for (let i = 0; i < kit.rig.limbs.length; i++) {
      expect(kit.rig.limbs[i].root.joint.quaternion.angleTo(before[i])).toBeLessThan(1e-6);
    }
  });

  it('reads the pose the animator meant, not its own last answer', () => {
    // Measuring through its own output makes this a loop with a frame of
    // lag in it. Measured: 25.8 degrees of hip movement per frame while
    // standing perfectly still, against none at all now.
    const kit = stand();
    const surface = () => 4;                 // permanently above the feet
    let worst = 0;
    const prev = kit.rig.limbs.map(() => new THREE.Quaternion());
    for (let i = 0; i < 300; i++) {
      kit.animator.update(state());
      kit.rig.root.updateMatrixWorld(true);
      kit.animator.plantFeet((x, z, y) => Math.min(surface(), y), 1, 1 / 60);
      if (i > 150) {
        kit.rig.limbs.forEach((l, k) => {
          worst = Math.max(worst, (l.root.joint.quaternion.angleTo(prev[k]) * 180) / Math.PI);
        });
      }
      kit.rig.limbs.forEach((l, k) => prev[k].copy(l.root.joint.quaternion));
    }
    expect(worst).toBeLessThan(0.05);
  });
});
