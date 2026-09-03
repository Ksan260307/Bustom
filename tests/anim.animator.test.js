import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Animator, waveAt } from '../src/anim/Animator.js';
import { Rig } from '../src/core/Rig.js';
import { Assembly, PRESETS, computeStats } from '../src/core/Assembly.js';
import { BONE, EQUIP, RUN } from '../src/core/constants.js';

const IDENTITY = new THREE.Quaternion();

function makeAnimator(assembly) {
  const rig = new Rig(assembly);
  const stats = computeStats(assembly, rig);
  return { rig, stats, animator: new Animator(rig, stats) };
}

/**
 * Run a gait for a while and report, per joint, how far it swung.
 * Sampling the extremes is the only honest way to ask "is this visible".
 */
/**
 * @param settle frames to run before recording, for anything measuring the
 *   size of a swing rather than the way it starts. The gait clock ramps up
 *   from standing, and so does anything derived from it, so a span taken
 *   across the ramp measures the ramp as much as the swing.
 */
function swingRange({ rig, animator }, signals = {}, frames = 240, settle = 0) {
  const spans = new Map(rig.joints.map((j) => [j.part.id, { min: Infinity, max: -Infinity }]));
  const s = {
    dt: 1 / 60, speed: 8, planarSpeed: 8, grounded: 1, airborne: 0,
    velocity: new THREE.Vector3(0, 0, 8), bodyQ: new THREE.Quaternion(),
    aimDir: null, locked: 0, thrust: 0.3, jerk: 0, ...signals,
  };
  for (let i = 0; i < settle; i++) animator.update(s);
  for (let i = 0; i < frames; i++) {
    animator.update(s);
    for (const j of rig.joints) {
      const a = j.joint.quaternion.angleTo(IDENTITY);
      const span = spans.get(j.part.id);
      span.min = Math.min(span.min, a);
      span.max = Math.max(span.max, a);
    }
  }
  return spans;
}

const deg = (rad) => (rad * 180) / Math.PI;

/**
 * How far each joint swings about its own stride axis, in radians, as a
 * peak-to-peak figure with the sign kept.
 */
function strideSwing({ rig, animator }, frames = 240, settle = 240) {
  const s = {
    dt: 1 / 60, speed: 8, planarSpeed: 8, grounded: 1, airborne: 0,
    velocity: new THREE.Vector3(0, 0, 8), bodyQ: new THREE.Quaternion(),
    aimDir: null, locked: 0, thrust: 0, jerk: 0,
  };
  for (let i = 0; i < settle; i++) animator.update(s);

  const seen = new Map(rig.joints.map((j) => [j.part.id, { min: Infinity, max: -Infinity }]));
  const axis = new THREE.Vector3();
  for (let i = 0; i < frames; i++) {
    animator.update(s);
    for (const j of rig.joints) {
      animator._strideAxis(j, axis);
      const q = j.joint.quaternion;
      const about = 2 * Math.atan2(q.x * axis.x + q.y * axis.y + q.z * axis.z, q.w);
      const e = seen.get(j.part.id);
      e.min = Math.min(e.min, about);
      e.max = Math.max(e.max, about);
    }
  }
  return new Map([...seen].map(([id, e]) => [id, e.max - e.min]));
}

describe('axis binding', () => {
  it('solves a stride axis perpendicular to the shaft', () => {
    const a = Assembly.createDefault();
    a.addBoneOnFace(a.rootId, 3, BONE.LEG, { length: 2 });   // hangs down
    const { rig } = makeAnimator(a);
    const node = rig.joints[0];
    // the shaft points down in body space
    expect(node.shaft.y).toBeCloseTo(-1, 5);
    // rotating about the stride axis must move the tip, not twist it
    expect(Math.abs(node.axisStride.dot(new THREE.Vector3(0, 1, 0)))).toBeLessThan(0.1);
  });

  it('handles a bone that sticks straight out sideways', () => {
    const a = Assembly.createDefault();
    a.addBoneOnFace(a.rootId, 0, BONE.LEG, { length: 2 });   // points +X
    const { rig } = makeAnimator(a);
    const node = rig.joints[0];
    expect(node.shaft.x).toBeCloseTo(1, 5);
    // still a usable, non-degenerate rotation axis
    expect(node.axisStride.length()).toBeCloseTo(1, 5);
    expect(node.axisLift.length()).toBeCloseTo(1, 5);
    expect(Math.abs(node.axisStride.dot(node.axisLift))).toBeLessThan(0.99);
  });

  it('gives every joint a full, finite axis set', () => {
    const { rig } = makeAnimator(PRESETS.multileg.build());
    for (const node of rig.joints) {
      for (const axis of [node.axisStride, node.axisLift, node.axisSplay, node.axisTwist]) {
        expect(axis.length()).toBeCloseTo(1, 5);
        expect(Number.isFinite(axis.x)).toBe(true);
      }
    }
  });
});

describe('gait phases', () => {
  it('two legs run in opposition', () => {
    const { rig } = makeAnimator(PRESETS.biped.build());
    const offsets = rig.limbs.map((l) => l.phaseOffset).sort();
    expect(offsets).toEqual([0, 0.5]);
  });

  it('four legs are fanned so no two neighbours match', () => {
    const { rig } = makeAnimator(PRESETS.multileg.build());
    const offsets = rig.limbs.map((l) => l.phaseOffset);
    expect(new Set(offsets).size).toBeGreaterThan(1);
    // left and right of the same row are always in antiphase
    for (let i = 0; i < offsets.length; i += 2) {
      expect(Math.abs(offsets[i] - offsets[i + 1])).toBeCloseTo(0.5, 6);
    }
  });

  it('a single leg has no phase offset to speak of', () => {
    const { rig } = makeAnimator(PRESETS.hopper.build());
    expect(rig.limbs).toHaveLength(1);
    expect(rig.limbs[0].phaseOffset).toBe(0);
  });
});

describe('walk gait', () => {
  it('moves the legs while travelling', () => {
    const rigged = makeAnimator(PRESETS.biped.build());
    const spans = swingRange(rigged);
    const legs = rigged.rig.limbs.flatMap((l) => l.chain);
    for (const j of legs) {
      const s = spans.get(j.part.id);
      expect(deg(s.max), `leg ${j.part.id}`).toBeGreaterThan(5);
    }
  });

  it('settles when standing still', () => {
    const rigged = makeAnimator(PRESETS.biped.build());
    const spans = swingRange(rigged, {
      speed: 0, planarSpeed: 0, velocity: new THREE.Vector3(),
    }, 400);
    for (const j of rigged.rig.limbs.flatMap((l) => l.chain)) {
      expect(deg(spans.get(j.part.id).max - spans.get(j.part.id).min)).toBeLessThan(8);
    }
  });
});

describe('multileg gait', () => {
  it('is clearly visible: every leg swings well past ten degrees', () => {
    const rigged = makeAnimator(PRESETS.multileg.build());
    expect(rigged.stats.gait).toBe('multileg');
    const spans = swingRange(rigged);
    for (const limb of rigged.rig.limbs) {
      for (const j of limb.chain) {
        const s = spans.get(j.part.id);
        expect(deg(s.max - s.min), `limb ${limb.index} joint ${j.chainIndex}`).toBeGreaterThan(10);
      }
    }
  });

  it('scuttles even at a crawl', () => {
    const rigged = makeAnimator(PRESETS.multileg.build());
    const spans = swingRange(rigged, {
      speed: 1.5, planarSpeed: 1.5, velocity: new THREE.Vector3(0, 0, 1.5),
    }, 400);
    const hips = rigged.rig.limbs.map((l) => l.chain[0]);
    for (const j of hips) expect(deg(spans.get(j.part.id).max - spans.get(j.part.id).min)).toBeGreaterThan(6);
  });

  it('splays the legs outward, each side its own way', () => {
    const rigged = makeAnimator(PRESETS.multileg.build());
    const sides = rigged.rig.limbs.map((l) => l.root.side);
    expect(new Set(sides)).toEqual(new Set([-1, 1]));
  });

  it('bobs the body more than a biped does', () => {
    const multi = makeAnimator(PRESETS.multileg.build());
    const bi = makeAnimator(PRESETS.biped.build());
    let multiPeak = 0;
    let biPeak = 0;
    const s = (over) => ({
      dt: 1 / 60, speed: 8, planarSpeed: 8, grounded: 1, airborne: 0,
      velocity: new THREE.Vector3(0, 0, 8), bodyQ: new THREE.Quaternion(),
      aimDir: null, locked: 0, thrust: 0.3, jerk: 0, ...over,
    });
    for (let i = 0; i < 400; i++) {
      multi.animator.update(s());
      bi.animator.update(s());
      multiPeak = Math.max(multiPeak, Math.abs(multi.animator.bodyBob));
      biPeak = Math.max(biPeak, Math.abs(bi.animator.bodyBob));
    }
    expect(multiPeak).toBeGreaterThan(biPeak);
  });
});

describe('hop gait', () => {
  it('compresses on the ground and extends in the air', () => {
    const rigged = makeAnimator(PRESETS.hopper.build());
    const s = (grounded, airborne) => ({
      dt: 1 / 60, speed: 4, planarSpeed: 4, grounded, airborne,
      velocity: new THREE.Vector3(0, 0, 4), bodyQ: new THREE.Quaternion(),
      aimDir: null, locked: 0, thrust: 0.3, jerk: 0,
    });
    for (let i = 0; i < 120; i++) rigged.animator.update(s(1, 0));
    const crouched = rigged.animator.hopCharge;
    for (let i = 0; i < 120; i++) rigged.animator.update(s(0, 1));
    expect(crouched).toBeGreaterThan(0.5);
    expect(rigged.animator.hopCharge).toBeLessThan(crouched);
  });
});

describe('hover', () => {
  it('a legless build still animates without error', () => {
    const a = Assembly.createDefault();
    a.addBoneOnFace(a.rootId, 4, BONE.FACE, { length: 1.5 });
    const rigged = makeAnimator(a);
    expect(rigged.stats.gait).toBe('hover');
    expect(() => swingRange(rigged, {}, 60)).not.toThrow();
  });
});

describe('travel direction', () => {
  const drive = (rigged, vel, frames = 200) => swingRange(rigged, {
    velocity: vel, speed: vel.length(), planarSpeed: Math.hypot(vel.x, vel.z),
  }, frames);

  it('points the travel vector down the nose when going forward', () => {
    const rigged = makeAnimator(PRESETS.biped.build());
    drive(rigged, new THREE.Vector3(0, 0, 8));
    expect(rigged.animator.travel.y).toBeGreaterThan(0.95);
    expect(Math.abs(rigged.animator.travel.x)).toBeLessThan(0.1);
  });

  it('swings the travel vector sideways when strafing', () => {
    const rigged = makeAnimator(PRESETS.biped.build());
    drive(rigged, new THREE.Vector3(8, 0, 0));
    expect(rigged.animator.travel.x).toBeGreaterThan(0.9);
    expect(rigged.animator.travelBlend).toBeGreaterThan(0.9);
  });

  it('rotates the stride axis so the legs step diagonally', () => {
    const rigged = makeAnimator(PRESETS.biped.build());
    const node = rigged.rig.limbs[0].chain[0];

    drive(rigged, new THREE.Vector3(0, 0, 8));
    const forwardAxis = rigged.animator._strideAxis(node).clone();

    drive(rigged, new THREE.Vector3(8, 0, 0));
    const strafeAxis = rigged.animator._strideAxis(node).clone();

    expect(forwardAxis.length()).toBeCloseTo(1, 5);
    expect(strafeAxis.length()).toBeCloseTo(1, 5);
    // a real change of direction, not a nudge
    expect(forwardAxis.angleTo(strafeAxis)).toBeGreaterThan(0.5);
  });

  it('blends back to a straight stride once the machine stops', () => {
    const rigged = makeAnimator(PRESETS.biped.build());
    drive(rigged, new THREE.Vector3(8, 0, 0));
    drive(rigged, new THREE.Vector3(0, 0, 0), 300);
    expect(rigged.animator.travelBlend).toBeLessThan(0.05);
  });

  it('reverses the stride when walking backwards', () => {
    const rigged = makeAnimator(PRESETS.biped.build());
    drive(rigged, new THREE.Vector3(0, 0, -8));
    expect(rigged.animator.travel.y).toBeLessThan(-0.9);
  });

  it('a diagonal walk lands between the two', () => {
    const rigged = makeAnimator(PRESETS.biped.build());
    drive(rigged, new THREE.Vector3(6, 0, 6));
    expect(rigged.animator.travel.x).toBeCloseTo(0.707, 1);
    expect(rigged.animator.travel.y).toBeCloseTo(0.707, 1);
  });
});

describe('arms and face', () => {
  it('arms swing while travelling', () => {
    const rigged = makeAnimator(PRESETS.biped.build());
    const spans = swingRange(rigged);
    for (const node of rigged.rig.armBones) {
      expect(deg(spans.get(node.part.id).max - spans.get(node.part.id).min)).toBeGreaterThan(3);
    }
  });

  it('arms abandon the gait and point at the lock', () => {
    const rigged = makeAnimator(PRESETS.biped.build());
    const aimDir = new THREE.Vector3(1, 0, 0);
    const spans = swingRange(rigged, { aimDir, locked: 1 }, 400);
    for (const node of rigged.rig.armBones) {
      // pointing sideways is a big rotation away from hanging down
      expect(deg(spans.get(node.part.id).max)).toBeGreaterThan(30);
    }
    expect(rigged.animator.aimBlend).toBeGreaterThan(0.9);
  });

  it('the face leans into the travel direction', () => {
    const rigged = makeAnimator(PRESETS.biped.build());
    const spans = swingRange(rigged, { velocity: new THREE.Vector3(10, 0, 4) }, 200);
    const face = rigged.rig.faceBones[0];
    expect(deg(spans.get(face.part.id).max)).toBeGreaterThan(2);
  });
});

describe('custom bones', () => {
  it('follow their configured amplitude and driver', () => {
    const a = Assembly.createDefault();
    const tail = a.addBoneOnFace(a.rootId, 5, BONE.CUSTOM, {
      length: 2, limit: 120, custom: { axis: 'x', amp: 45, freq: 2, phase: 0, source: 'time' },
    });
    const rigged = makeAnimator(a);
    const spans = swingRange(rigged, {}, 240);
    expect(deg(spans.get(tail.id).max)).toBeGreaterThan(20);
  });

  it('a speed-driven bone is still when the machine is still', () => {
    const a = Assembly.createDefault();
    const tail = a.addBoneOnFace(a.rootId, 5, BONE.CUSTOM, {
      length: 2, custom: { axis: 'x', amp: 45, freq: 2, phase: 0, source: 'speed' },
    });
    const rigged = makeAnimator(a);
    const spans = swingRange(rigged, {
      speed: 0, planarSpeed: 0, velocity: new THREE.Vector3(),
    }, 240);
    expect(deg(spans.get(tail.id).max)).toBeLessThan(2);
  });
});

describe('joint limits', () => {
  it('no joint ever exceeds its configured travel', () => {
    const asm = PRESETS.multileg.build();
    asm.walk((p) => { if (p.kind === 'bone' && p.boneType === 'leg') p.limit = 25; });
    const rigged = makeAnimator(asm);
    const spans = swingRange(rigged, {}, 400);
    for (const limb of rigged.rig.limbs) {
      for (const j of limb.chain) {
        expect(deg(spans.get(j.part.id).max)).toBeLessThanOrEqual(25.5);
      }
    }
  });

  it('body lean stays inside a sane range', () => {
    const rigged = makeAnimator(PRESETS.biped.build());
    swingRange(rigged, { velocity: new THREE.Vector3(40, 0, 40) }, 300);
    // It leans into a run — about 16 degrees flat out — and no further. The
    // number is a cap, not a target: past this it stops reading as effort
    // and starts reading as falling over.
    expect(Math.abs(rigged.animator.bodyLean.x)).toBeLessThanOrEqual(0.29);
    expect(Math.abs(rigged.animator.bodyLean.y)).toBeLessThanOrEqual(0.21);
  });

  it('a rocked machine reels away from the blow', () => {
    // A round lands on the BODY, not on the feet, so the machine goes over
    // backwards when it is shot in the chest. That is the opposite sign to
    // the lean a run produces — where the feet drive and the top lags — and
    // getting it wrong has the machine bow politely to whoever shot it.
    const rigged = makeAnimator(PRESETS.biped.build());
    const still = {
      dt: 1 / 60, speed: 0, planarSpeed: 0, grounded: 1, airborne: 0,
      velocity: new THREE.Vector3(), bodyQ: new THREE.Quaternion(),
      aimDir: null, locked: 0, thrust: 0, jerk: 0,
    };
    for (let i = 0; i < 60; i++) rigged.animator.update(still);
    const rest = rigged.animator.bodyLean.x;

    // Shot from in front: thrown backwards, so the top goes backwards too.
    const shove = { ...still, stagger: 1, staggerDir: new THREE.Vector3(0, 0, -1) };
    for (let i = 0; i < 10; i++) rigged.animator.update(shove);
    expect(rigged.animator.bodyLean.x, 'it reels').toBeLessThan(rest - 0.1);
    expect(rigged.animator.bodyBob, 'and drops on its legs').toBeLessThan(0);

    // Shot from the left: it rolls away to the right.
    const side = { ...still, stagger: 1, staggerDir: new THREE.Vector3(1, 0, 0) };
    const rigged2 = makeAnimator(PRESETS.biped.build());
    for (let i = 0; i < 60; i++) rigged2.animator.update(still);
    for (let i = 0; i < 10; i++) rigged2.animator.update(side);
    expect(rigged2.animator.bodyLean.y).toBeLessThan(-0.1);
  });

  it('the reel lands fast and lets go with the stagger', () => {
    // A flinch that eases in over a fifth of a second is not a flinch, it is
    // a machine changing its mind.
    const rigged = makeAnimator(PRESETS.biped.build());
    const still = {
      dt: 1 / 60, speed: 0, planarSpeed: 0, grounded: 1, airborne: 0,
      velocity: new THREE.Vector3(), bodyQ: new THREE.Quaternion(),
      aimDir: null, locked: 0, thrust: 0, jerk: 0,
    };
    for (let i = 0; i < 60; i++) rigged.animator.update(still);
    const shove = { ...still, stagger: 1, staggerDir: new THREE.Vector3(0, 0, -1) };
    for (let i = 0; i < 4; i++) rigged.animator.update(shove);
    expect(Math.abs(rigged.animator.bodyLean.x), 'most of it inside four frames')
      .toBeGreaterThan(0.12);

    for (let i = 0; i < 120; i++) rigged.animator.update(still);
    expect(Math.abs(rigged.animator.bodyLean.x), 'and gone once the stagger is')
      .toBeLessThan(0.02);
  });

  it('a heavy machine folds its knees when it lands', () => {
    // The brace is added ON TOP of the gait rather than replacing it, so a
    // machine that lands running keeps running — it just does the first
    // fraction of a second of it from a crouch.
    const rigged = makeAnimator(PRESETS.biped.build());
    const still = {
      dt: 1 / 60, speed: 0, planarSpeed: 0, grounded: 1, airborne: 0,
      velocity: new THREE.Vector3(), bodyQ: new THREE.Quaternion(),
      aimDir: null, locked: 0, thrust: 0, jerk: 0,
    };
    for (let i = 0; i < 90; i++) rigged.animator.update(still);
    const bend = () => rigged.rig.limbs
      .flatMap((l) => l.chain)
      .reduce((n, j) => n + j.joint.quaternion.angleTo(IDENTITY), 0);
    const standing = bend();
    const level = rigged.animator.bodyBob;

    const planted = { ...still, landing: 1 };
    for (let i = 0; i < 20; i++) rigged.animator.update(planted);
    expect(bend(), 'the legs fold').toBeGreaterThan(standing + 0.2);
    expect(rigged.animator.bodyBob, 'and the body sinks onto them')
      .toBeLessThan(level - 0.1);

    for (let i = 0; i < 180; i++) rigged.animator.update(still);
    expect(bend(), 'and it stands back up').toBeLessThan(standing + 0.05);
  });

  it('a machine that is not landing is not crouching', () => {
    const rigged = makeAnimator(PRESETS.biped.build());
    const still = {
      dt: 1 / 60, speed: 0, planarSpeed: 0, grounded: 1, airborne: 0,
      velocity: new THREE.Vector3(), bodyQ: new THREE.Quaternion(),
      aimDir: null, locked: 0, thrust: 0, jerk: 0,
    };
    for (let i = 0; i < 60; i++) rigged.animator.update(still);
    expect(Math.abs(rigged.animator.bodyBob)).toBeLessThan(0.06);
  });

  it('going sideways faster than it can walk, it stops walking', () => {
    // Above the machine's own ground speed there is no stride that could
    // keep up: the leg would have to swing further than it can reach,
    // faster than it can move. What came out instead was a machine
    // moonwalking at thirty metres a second.
    const rigged = makeAnimator(PRESETS.biped.build());
    const going = (vx) => ({
      dt: 1 / 60, speed: Math.abs(vx), planarSpeed: Math.abs(vx), grounded: 1, airborne: 0,
      velocity: new THREE.Vector3(vx, 0, 0), bodyQ: new THREE.Quaternion(),
      aimDir: null, locked: 0, thrust: 0, jerk: 0,
      walkCap: 16, dashSpeed: 34,
    });

    for (let i = 0; i < 120; i++) rigged.animator.update(going(10));
    expect(rigged.animator.slide, 'at a walk, it walks').toBeLessThan(0.05);

    for (let i = 0; i < 60; i++) rigged.animator.update(going(34));
    expect(rigged.animator.slide, 'past a dash, it skates').toBeGreaterThan(0.8);
    expect(rigged.animator.slideDir, 'and it knows which way it is going').toBe(1);

    for (let i = 0; i < 120; i++) rigged.animator.update(going(4));
    expect(rigged.animator.slide, 'and it stops again').toBeLessThan(0.05);
  });

  it('the legs cant over onto the side it is being dragged from', () => {
    // Feet held back by the floor, body carried on ahead. Both legs the
    // same way — this is one machine being taken sideways, not two legs
    // each doing something.
    const build = (vx) => {
      const rigged = makeAnimator(PRESETS.biped.build());
      const s = {
        dt: 1 / 60, speed: Math.abs(vx), planarSpeed: Math.abs(vx), grounded: 1, airborne: 0,
        velocity: new THREE.Vector3(vx, 0, 0), bodyQ: new THREE.Quaternion(),
        aimDir: null, locked: 0, thrust: 0, jerk: 0, walkCap: 16, dashSpeed: 34,
      };
      for (let i = 0; i < 90; i++) rigged.animator.update(s);
      return rigged;
    };
    // Measured off the built rig rather than off a quaternion: where the
    // foot ENDS UP is the thing being claimed, and it survives any change
    // to which axis the pose is expressed about.
    const feet = (rigged) => {
      rigged.rig.root.updateMatrixWorld(true);
      return rigged.rig.limbs.map((l) => {
        const last = l.chain[l.chain.length - 1];
        return last.far.getWorldPosition(new THREE.Vector3()).x;
      });
    };

    const still = feet(build(0));
    const right = feet(build(34));
    const left = feet(build(-34));
    right.forEach((x, i) => {
      expect(x, `going right, foot ${i} trails left`).toBeLessThan(still[i] - 0.1);
    });
    left.forEach((x, i) => {
      expect(x, `and the other way round, foot ${i}`).toBeGreaterThan(still[i] + 0.1);
    });
  });

  it('a machine thrown off its feet goes right over', () => {
    // Rocked is a lean. Thrown is the same motion several times as far, and
    // it does not come back until the machine lands.
    const rigged = makeAnimator(PRESETS.biped.build());
    const base = {
      dt: 1 / 60, speed: 0, planarSpeed: 0, grounded: 1, airborne: 0,
      velocity: new THREE.Vector3(), bodyQ: new THREE.Quaternion(),
      aimDir: null, locked: 0, thrust: 0, jerk: 0,
    };
    for (let i = 0; i < 60; i++) rigged.animator.update(base);

    const rocked = { ...base, stagger: 1, staggerDir: new THREE.Vector3(0, 0, -1) };
    for (let i = 0; i < 12; i++) rigged.animator.update(rocked);
    const lean = rigged.animator.bodyLean.x;

    const thrown = { ...base, stagger: 1, downed: 1, staggerDir: new THREE.Vector3(0, 0, -1) };
    for (let i = 0; i < 12; i++) rigged.animator.update(thrown);
    expect(rigged.animator.bodyLean.x, 'much further over').toBeLessThan(lean - 0.3);
  });

  it('produces no NaN under absurd signals', () => {
    const rigged = makeAnimator(PRESETS.multileg.build());
    swingRange(rigged, {
      speed: 500, planarSpeed: 500, velocity: new THREE.Vector3(300, -200, 100),
      jerk: 9999, thrust: 5, aimDir: new THREE.Vector3(0, 1, 0), locked: 1,
    }, 200);
    for (const j of rigged.rig.joints) {
      expect(Number.isFinite(j.joint.quaternion.x)).toBe(true);
      expect(j.joint.quaternion.length()).toBeCloseTo(1, 4);
    }
  });
});

// ============================================================
//  Custom bones
// ============================================================

describe('custom bone waveforms', () => {
  it('every wave stays inside -1..1 and completes in one cycle', () => {
    for (const wave of ['sine', 'tri', 'square', 'saw']) {
      for (let i = 0; i <= 40; i++) {
        const v = waveAt(wave, i / 40);
        expect(v, `${wave} @${i}`).toBeGreaterThanOrEqual(-1.0001);
        expect(v, `${wave} @${i}`).toBeLessThanOrEqual(1.0001);
      }
      expect(waveAt(wave, 0), `${wave} wraps`).toBeCloseTo(waveAt(wave, 3), 6);
    }
  });

  it('each wave has the shape its name promises', () => {
    expect(waveAt('sine', 0.25)).toBeCloseTo(1, 6);
    expect(waveAt('sine', 0.75)).toBeCloseTo(-1, 6);

    expect(waveAt('tri', 0.5), 'peaks halfway').toBeCloseTo(1, 6);
    expect(waveAt('tri', 0), 'and bottoms at the ends').toBeCloseTo(-1, 6);
    expect(waveAt('tri', 0.25), 'linear in between').toBeCloseTo(0, 6);

    expect(waveAt('square', 0.2)).toBe(1);
    expect(waveAt('square', 0.7)).toBe(-1);

    expect(waveAt('saw', 0)).toBeCloseTo(-1, 6);
    expect(waveAt('saw', 0.999)).toBeCloseTo(1, 2);
  });

  it('an unknown wave falls back to a sine rather than breaking', () => {
    expect(waveAt('spiral', 0.25)).toBeCloseTo(1, 6);
  });
});

describe('custom bone motion', () => {
  const rotorRig = (custom) => {
    const a = Assembly.createDefault();
    const bone = a.addBoneOnFace(a.rootId, 2, BONE.CUSTOM, { length: 1.5 });
    Object.assign(bone.custom, custom);
    const rig = new Rig(a);
    return { a, bone, rig, animator: new Animator(rig, computeStats(a, rig)) };
  };

  const angleOf = (rig, id) => 2 * Math.acos(
    Math.min(1, Math.abs(rig.nodes.get(id).joint.quaternion.w)),
  );

  it('a swing stays inside the joint limit', () => {
    const { bone, rig, animator } = rotorRig({ wave: 'sine', amp: 90, freq: 2 });
    bone.limit = 30;
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      animator.updateCustomsOnly(1 / 60);
      peak = Math.max(peak, angleOf(rig, bone.id));
    }
    expect(peak * (180 / Math.PI)).toBeLessThan(31);
    rig.dispose();
  });

  it('a rotation ignores the limit, because a propeller has to go round', () => {
    const { bone, rig, animator } = rotorRig({ wave: 'saw', freq: 2 });
    bone.limit = 30;
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      animator.updateCustomsOnly(1 / 60);
      peak = Math.max(peak, angleOf(rig, bone.id));
    }
    expect(peak * (180 / Math.PI)).toBeGreaterThan(120);
    rig.dispose();
  });

  it('a rotation keeps turning the same way rather than snapping back', () => {
    const { bone, rig, animator } = rotorRig({ wave: 'saw', freq: 1 });
    const node = rig.nodes.get(bone.id);
    for (let i = 0; i < 30; i++) animator.updateCustomsOnly(1 / 60);
    const half = node.spinPhase;
    for (let i = 0; i < 30; i++) animator.updateCustomsOnly(1 / 60);
    expect(node.spinPhase).toBeGreaterThan(half);
    expect(node.spinPhase).toBeCloseTo(1, 1);
    rig.dispose();
  });

  it('the drive source scales a rotation SPEED, not its angle', () => {
    const idle = rotorRig({ wave: 'saw', freq: 2, source: 'speed' });
    for (let i = 0; i < 60; i++) idle.animator.updateCustomsOnly(1 / 60);
    expect(idle.rig.nodes.get(idle.bone.id).spinPhase, 'standing still: no turn')
      .toBeCloseTo(0, 6);
    idle.rig.dispose();

    const moving = rotorRig({ wave: 'saw', freq: 2, source: 'speed' });
    for (let i = 0; i < 60; i++) {
      moving.animator.time += 1 / 60;
      moving.animator._customs({ planarSpeed: 18, thrust: 0, jerk: 0 }, 1 / 60);
    }
    expect(moving.rig.nodes.get(moving.bone.id).spinPhase).toBeGreaterThan(1.5);
    moving.rig.dispose();
  });

  it('the centre angle biases the swing', () => {
    const { bone, rig, animator } = rotorRig({ wave: 'sine', amp: 0, offset: 40 });
    bone.limit = 90;
    for (let i = 0; i < 240; i++) animator.updateCustomsOnly(1 / 60);
    expect(angleOf(rig, bone.id) * (180 / Math.PI)).toBeCloseTo(40, 0);
    rig.dispose();
  });

  it('the phase offsets one bone against another', () => {
    const a = Assembly.createDefault();
    const one = a.addBoneOnFace(a.rootId, 2, BONE.CUSTOM, { length: 1.5 });
    const two = a.addBone(a.rootId, { pos: [1, 0.5, 0] }, BONE.CUSTOM, { length: 1.5 });
    Object.assign(one.custom, { wave: 'sine', amp: 60, freq: 1, phase: 0 });
    Object.assign(two.custom, { wave: 'sine', amp: 60, freq: 1, phase: 0.5 });
    const rig = new Rig(a);
    const animator = new Animator(rig, computeStats(a, rig));

    for (let i = 0; i < 60; i++) animator.updateCustomsOnly(1 / 60);
    const qa = rig.nodes.get(one.id).joint.quaternion;
    const qb = rig.nodes.get(two.id).joint.quaternion;
    expect(qa.angleTo(qb), 'half a cycle apart').toBeGreaterThan(0.3);
    rig.dispose();
  });

  it('updateCustomsOnly leaves every other joint alone', () => {
    const a = PRESETS.biped.build();
    const custom = a.addBoneOnFace(a.core.id, 2, BONE.CUSTOM, { length: 1.2 });
    custom.custom.amp = 60;
    const rig = new Rig(a);
    const animator = new Animator(rig, computeStats(a, rig));
    const leg = rig.joints.find((n) => n.part.boneType === 'leg');

    for (let i = 0; i < 60; i++) animator.updateCustomsOnly(1 / 60);
    expect(leg.joint.quaternion.w, 'the legs never moved').toBeCloseTo(1, 6);
    expect(rig.nodes.get(custom.id).joint.quaternion.w, 'but the custom bone did')
      .toBeLessThan(0.999);
    rig.dispose();
  });
});

// ============================================================
//  Shoulders, hips and waists, built out of what already exists
// ============================================================

describe('joint gain and lag', () => {
  /** Two legs, both plain, with the LEFT one turned down to `gain`. */
  const pair = (gain, lag = 0) => {
    const a = Assembly.createDefault();
    for (const face of [0, 1]) {
      const hip = a.addBlockOnFace(a.rootId, face, 2, { size: [0.5, 0.5, 0.5] });
      a.addBoneOnFace(hip.id, 3, BONE.LEG, {
        length: 2, ...(face === 1 ? { gain, lag } : {}),
      });
    }
    return makeAnimator(a);
  };

  const spanOf = (spans, id) => {
    const s = spans.get(id);
    return s.max - s.min;
  };

  it('gain scales how far a leg swings', () => {
    const rigged = pair(0.3);
    const spans = swingRange(rigged);
    const [right, left] = rigged.rig.joints.filter((n) => n.part.boneType === 'leg');
    expect(spanOf(spans, left.part.id), 'the quiet one barely moves')
      .toBeLessThan(spanOf(spans, right.part.id) * 0.6);
  });

  it('gain zero pins a joint still', () => {
    const rigged = pair(0);
    const left = rigged.rig.joints.filter((n) => n.part.boneType === 'leg')[1];
    swingRange(rigged);
    expect(left.joint.quaternion.angleTo(IDENTITY)).toBeCloseTo(0, 5);
  });

  it('gain above one swings harder than standard', () => {
    const loud = pair(1.8);
    const spans = swingRange(loud);
    const [right, left] = loud.rig.joints.filter((n) => n.part.boneType === 'leg');
    expect(spanOf(spans, left.part.id)).toBeGreaterThan(spanOf(spans, right.part.id));
  });

  it('lag slides a joint round the gait cycle', () => {
    const straight = pair(1, 0);
    const delayed = pair(1, 0.25);
    const legOf = (r) => r.rig.joints.filter((n) => n.part.boneType === 'leg')[1];

    const sample = (r) => {
      const s = {
        dt: 1 / 60, speed: 8, planarSpeed: 8, grounded: 1, airborne: 0,
        velocity: new THREE.Vector3(0, 0, 8), bodyQ: new THREE.Quaternion(),
        aimDir: null, locked: 0, thrust: 0, jerk: 0,
      };
      for (let i = 0; i < 90; i++) r.animator.update(s);
      return legOf(r).joint.quaternion.clone();
    };
    // Same drive, same number of frames: only the phase differs.
    expect(sample(straight).angleTo(sample(delayed))).toBeGreaterThan(0.05);
  });

  it('a forearm takes less of the swing than the shoulder above it', () => {
    const a = Assembly.createDefault();
    const upper = a.addBoneOnFace(a.rootId, 0, BONE.ARM, { length: 1.3 });
    const fore = a.addBoneOnTip(upper.id, BONE.ARM, { length: 1.2 });
    const rigged = makeAnimator(a);

    expect(rigged.rig.nodes.get(upper.id).chainDepth).toBe(0);
    expect(rigged.rig.nodes.get(fore.id).chainDepth).toBe(1);

    // Measured as a SIGNED swing about each joint's own stride axis, once
    // the stride is up to speed. The unsigned angle from rest cannot answer
    // this: a chained arm also folds at the elbow, and an angle that swings
    // either side of a fold reads as twice the travel of one that swings
    // either side of zero, whatever the swing is actually doing.
    const swings = strideSwing(rigged, 240, 240);
    expect(swings.get(fore.id), 'so the arm does not double-bend')
      .toBeLessThan(swings.get(upper.id));
  });
});

describe('a waist driven by the stride', () => {
  const waistRig = (source) => {
    const a = Assembly.createDefault();
    const hip = a.addBlockOnFace(a.rootId, 3, 2, { size: [0.5, 0.5, 0.5] });
    a.addBoneOnFace(hip.id, 3, BONE.LEG, { length: 2 });
    a.addBoneOnFace(a.rootId, 0, BONE.LEG, { length: 2 });
    const waist = a.addBoneOnFace(a.rootId, 2, BONE.CUSTOM, {
      length: 0.6,
      custom: { axis: 'y', wave: 'sine', amp: 40, freq: 1, phase: 0, offset: 0, source },
    });
    return { ...makeAnimator(a), waist };
  };

  const walk = (rigged, speed) => {
    const s = {
      dt: 1 / 60, speed, planarSpeed: speed, grounded: 1, airborne: 0,
      velocity: new THREE.Vector3(0, 0, speed), bodyQ: new THREE.Quaternion(),
      aimDir: null, locked: 0, thrust: 0, jerk: 0,
    };
    let span = { min: Infinity, max: -Infinity };
    for (let i = 0; i < 240; i++) {
      rigged.animator.update(s);
      const ang = rigged.rig.nodes.get(rigged.waist.id).joint.quaternion.angleTo(IDENTITY);
      span = { min: Math.min(span.min, ang), max: Math.max(span.max, ang) };
    }
    return span.max - span.min;
  };

  it('turns when the machine walks and stops when it stops', () => {
    expect(walk(waistRig('stride'), 8)).toBeGreaterThan(0.1);
    expect(walk(waistRig('stride'), 0), 'standing still, the hips are still')
      .toBeLessThan(0.02);
  });

  it('is locked to the footfalls, not to a free clock', () => {
    // A time-driven bone at the same frequency drifts against the gait; a
    // stride-driven one cannot, because the gait phase IS its clock.
    const strided = waistRig('stride');
    const timed = waistRig('time');
    const phaseOf = (r) => {
      const s = {
        dt: 1 / 60, speed: 5, planarSpeed: 5, grounded: 1, airborne: 0,
        velocity: new THREE.Vector3(0, 0, 5), bodyQ: new THREE.Quaternion(),
        aimDir: null, locked: 0, thrust: 0, jerk: 0,
      };
      for (let i = 0; i < 200; i++) r.animator.update(s);
      return { gait: r.animator.gaitPhase, q: r.rig.nodes.get(r.waist.id).joint.quaternion.clone() };
    };
    const a = phaseOf(strided);
    const b = phaseOf(timed);
    expect(a.gait).toBeCloseTo(b.gait, 6);
    expect(a.q.angleTo(b.q), 'and so they end up somewhere different')
      .toBeGreaterThan(0.02);
  });
});

// ============================================================
//  Legs with nothing under them
// ============================================================

describe('floating legs', () => {
  /**
   * The named preset, wearing a FLOAT plate. Any gravity plate comes off
   * first — the two cannot share a machine, and a preset that already has
   * one would otherwise silently refuse the float and test nothing.
   */
  const hovering = (preset) => {
    const a = PRESETS[preset].build();
    for (const e of a.equips()) if (e.equipType === EQUIP.GRAVITY) a.remove(e.id);
    const plate = a.addEquipOnFace(a.core.id, 4, EQUIP.FLOAT, { size: 0.6 });
    expect(plate, `${preset} took the float plate`).toBeTruthy();
    const rigged = makeAnimator(a);
    expect(rigged.stats.hoverHeight, `${preset} is actually floating`).toBeGreaterThan(0);
    return rigged;
  };

  const grounded = (preset) => makeAnimator(PRESETS[preset].build());

  /** Drive the machine at a fixed body-local velocity for a while. */
  const fly = (rigged, { vz = 0, vx = 0, frames = 120, thrust = 0.4 } = {}) => {
    const s = {
      dt: 1 / 60, speed: Math.hypot(vx, vz), planarSpeed: Math.hypot(vx, vz),
      grounded: 1, airborne: 0,
      velocity: new THREE.Vector3(vx, 0, vz), bodyQ: new THREE.Quaternion(),
      aimDir: null, locked: 0, thrust, jerk: 0,
    };
    for (let i = 0; i < frames; i++) rigged.animator.update(s);
    return rigged;
  };

  /**
   * Where the far END of a limb has ended up. The joint is the thing that
   * rotates, so the tip has to be measured from inside it — the group above
   * it never moves however the leg is posed.
   */
  const tipOf = (rigged, limb) => {
    rigged.rig.root.updateMatrixWorld(true);
    const node = limb.chain[limb.chain.length - 1];
    return node.joint.localToWorld(new THREE.Vector3(0, node.part.length / 2, 0));
  };

  it('a hovering machine does not run a walk cycle', () => {
    const air = fly(hovering('biped'), { vz: 9 });
    const ground = fly(grounded('biped'), { vz: 9 });
    expect(ground.animator.gaitFreq, 'the one on the floor is striding')
      .toBeGreaterThan(1);
    expect(air.animator.gaitFreq, 'the one in the air is not').toBeLessThan(0.05);
    expect(Math.abs(air.animator.bodyBob), 'and it does not bob to a gait it has not got')
      .toBeLessThan(1e-3);
  });

  it('one leg just hangs, and inertia decides where', () => {
    const forward = fly(hovering('hopper'), { vz: 10 });
    const backward = fly(hovering('hopper'), { vz: -10 });
    const still = fly(hovering('hopper'), { vz: 0, thrust: 0 });

    const z = (r) => tipOf(r, r.rig.limbs[0]).z - r.rig.root.position.z;
    expect(z(forward), 'travelling forward, the foot trails behind')
      .toBeLessThan(z(still));
    expect(z(backward), 'and the other way when it goes backwards')
      .toBeGreaterThan(z(still));
  });

  it('the swing lags rather than snapping to the new speed', () => {
    // Cut the throttle and the leg keeps going for a moment. That delay is
    // the whole reason it reads as hanging instead of being held.
    const r = fly(hovering('hopper'), { vz: 12 });
    const moving = r.animator.legSway.y;
    fly(r, { vz: 0, frames: 2, thrust: 0 });
    expect(Math.abs(r.animator.legSway.y), 'still swung, two frames later')
      .toBeGreaterThan(Math.abs(moving) * 0.5);
    fly(r, { vz: 0, frames: 200, thrust: 0 });
    expect(Math.abs(r.animator.legSway.y), 'and settles eventually').toBeLessThan(0.05);
  });

  it('two legs hang together instead of stepping apart', () => {
    const air = fly(hovering('biped'), { vz: 6 });
    const walking = fly(grounded('biped'), { vz: 6 });

    const spread = (r) => {
      const [a, b] = r.rig.limbs.map((l) => tipOf(r, l).z);
      return Math.abs(a - b);
    };
    expect(spread(air), 'both feet hang the same way').toBeLessThan(0.35);
    expect(spread(walking), 'where a walk has one foot in front of the other')
      .toBeGreaterThan(spread(air));
  });

  it('two legs trail behind the body rather than hanging straight down', () => {
    const air = fly(hovering('biped'), { vz: 8 });
    const still = fly(hovering('biped'), { vz: 0, thrust: 0 });
    const z = (r) => r.rig.limbs.reduce((n, l) => n + tipOf(r, l).z, 0) / r.rig.limbs.length;
    expect(z(air)).toBeLessThan(z(still) - 0.15);
  });

  it('four legs curl in under the body', () => {
    const air = fly(hovering('multileg'), { vz: 4 });
    const ground = fly(grounded('multileg'), { vz: 4 });

    // How far out to the sides the feet sit: curled in means narrower.
    const width = (r) => Math.max(...r.rig.limbs.map((l) => Math.abs(tipOf(r, l).x)));
    expect(width(air), 'drawn in toward the centre line')
      .toBeLessThan(width(ground) * 0.85);
  });

  it('front legs fold forward and back legs trail, so they do not all pile up', () => {
    const r = fly(hovering('multileg'), { vz: 0, thrust: 0 });
    r.rig.root.updateMatrixWorld(true);
    // Split the way the animator does: a leg mounted at the middle counts
    // as a front one, so a four-legger with a pair at z=0 still folds two
    // one way and two the other.
    const foreOf = (l) => Math.sign(Number(l.root.restPos.z.toFixed(3))) || 1;
    const front = r.rig.limbs.filter((l) => foreOf(l) > 0);
    const back = r.rig.limbs.filter((l) => foreOf(l) < 0);
    expect(front.length, 'the preset really has legs at both ends').toBeGreaterThan(0);
    expect(back.length).toBeGreaterThan(0);

    const mid = (list) => list.reduce((n, l) => n + tipOf(r, l).z, 0) / list.length;
    expect(mid(front), 'the front pair reaches forward of the back pair')
      .toBeGreaterThan(mid(back));
  });

  it('a dead joint stays dead while floating too', () => {
    const rigged = hovering('multileg');
    for (const node of rigged.rig.joints) {
      if (node.part.boneType === 'leg') node.part.gain = 0;
    }
    fly(rigged, { vz: 8 });
    for (const node of rigged.rig.joints) {
      if (node.part.boneType !== 'leg') continue;
      expect(node.joint.quaternion.angleTo(IDENTITY), node.part.id).toBeCloseTo(0, 5);
    }
  });

  it('a machine with no legs at all is untouched by any of this', () => {
    const a = Assembly.createDefault();
    a.addEquipOnFace(a.core.id, 4, EQUIP.FLOAT);
    const rigged = makeAnimator(a);
    expect(() => fly(rigged, { vz: 8 })).not.toThrow();
    expect(rigged.rig.limbs).toHaveLength(0);
  });
});

// ============================================================
//  Giving ground.
// ============================================================

describe('backing away is its own pose, not the sideways one', () => {
  /**
   * Run a retreat and report where the feet ended up, in body space.
   *
   * @param jitter lateral speed to wobble by. A machine backing off in a
   *   straight line still has a little sideways speed that changes sign a
   *   few times a second, and that wobble is the whole bug: the skate reads
   *   its direction off it, so borrowing the skate made the legs cant left,
   *   then right, then left again.
   */
  const backing = (jitter = 0, frames = 90) => {
    const a = PRESETS.biped.build();
    const rig = new Rig(a);
    const animator = new Animator(rig, computeStats(a, rig));
    const s = {
      dt: 1 / 60, speed: 9, planarSpeed: 9, grounded: 1, airborne: 0,
      bodyQ: new THREE.Quaternion(), aimDir: null, locked: 1,
      thrust: 0.2, jerk: 0, retreat: 1, dashSpeed: 14, walkCap: 6,
    };
    let rollSpan = 0;
    let dirFlips = 0;
    let was = animator.slideDir;
    for (let i = 0; i < frames; i++) {
      const wobble = Math.sin(i * 0.7) * jitter;
      animator.update({ ...s, velocity: new THREE.Vector3(wobble, 0, -9) });
      if (i > 20) {
        rollSpan = Math.max(rollSpan, Math.abs(animator.bodyLean.y));
        if (Math.sign(animator.slideDir) !== Math.sign(was)) dirFlips++;
        was = animator.slideDir;
      }
    }
    rig.root.updateMatrixWorld(true);
    const feet = rig.limbs.map((limb) => new THREE.Vector3()
      .setFromMatrixPosition(limb.chain[limb.chain.length - 1].joint.matrixWorld));
    return { feet, rollSpan, dirFlips, animator };
  };

  it('reaches the feet out in front', () => {
    // The floor holds them where they were; the machine goes back without
    // them. Feet behind the machine would be somebody being shoved over.
    const { feet } = backing();
    for (const f of feet) expect(f.z).toBeGreaterThan(0.4);
  });

  it('stands the legs apart rather than together', () => {
    // Both legs reaching the same distance is standing to attention while
    // sliding. One foot leads.
    const [a, b] = backing().feet;
    expect(Math.abs(a.z - b.z), 'one foot ahead of the other').toBeGreaterThan(0.2);
  });

  it('does not lean to a side, however the lateral speed wobbles', () => {
    // The complaint, exactly: the legs turned right, then left, then right.
    const wobbling = backing(0.9);
    expect(wobbling.dirFlips, 'the skate direction flipped repeatedly')
      .toBeGreaterThan(2);
    expect(wobbling.rollSpan, `and the body rolled by ${wobbling.rollSpan.toFixed(4)}`)
      .toBeLessThan(0.01);
    // The pose itself must not have moved with those flips either.
    const still = backing(0);
    for (let i = 0; i < still.feet.length; i++) {
      expect(wobbling.feet[i].x).toBeCloseTo(still.feet[i].x, 2);
    }
  });

  it('leaves the sideways skate alone', () => {
    // Two channels, because they are two shapes. A machine doing both at
    // once would be doing neither.
    const { animator } = backing();
    expect(animator.brace).toBeGreaterThan(0.9);
    expect(animator.slide).toBe(0);
  });
});

// ============================================================
//  Feet that keep up with the floor.
// ============================================================

/**
 * Run a machine at a steady speed and report how far its sole travels
 * against how far the ground travelled under it.
 *
 * The difference is the foot being dragged. It used to be half of every
 * step at every speed — the gait clock counted steps 2.16m long while the
 * legs swung 0.9m — and that drag is what a skitter is: a machine moving
 * three times faster than its feet.
 */
function footSlip(preset, v, extra = {}) {
  const a = PRESETS[preset].build();
  const rig = new Rig(a);
  const animator = new Animator(rig, computeStats(a, rig));
  const s = {
    dt: 1 / 60, speed: v, planarSpeed: v, grounded: 1, airborne: 0,
    velocity: new THREE.Vector3(0, 0, v), bodyQ: new THREE.Quaternion(),
    aimDir: null, locked: 0, thrust: 0.2, jerk: 0,
    dashSpeed: 30, walkCap: 17, ...extra,
  };
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 260; i++) {
    animator.update(s);
    // Settled: the gait clock ramps, and a span taken across the ramp
    // measures the ramp.
    if (i <= 150) continue;
    rig.root.updateMatrixWorld(true);
    const limb = rig.limbs[0];
    const tip = limb.chain[limb.chain.length - 1];
    const p = limb.sole.clone().applyMatrix4(tip.joint.matrixWorld);
    lo = Math.min(lo, p.z);
    hi = Math.max(hi, p.z);
  }
  const perStep = v / (animator.gaitFreq * rig.limbs.length);
  return { slip: 1 - (hi - lo) / perStep, swing: hi - lo, perStep, animator };
}

describe('the feet keep up with the floor', () => {
  it('plants rather than drags, at every speed it can walk', () => {
    for (const v of [2, 4, 8, 12, 17]) {
      const { slip, swing, perStep } = footSlip('biped', v);
      expect(
        Math.abs(slip),
        `${v}m/s: the floor moved ${perStep.toFixed(2)}m under a `
          + `${swing.toFixed(2)}m step`,
      ).toBeLessThan(0.2);
    }
  });

  it('and does it for a machine of any size', () => {
    // The step comes from the leg now, so a machine five metres to the hip
    // and one a quarter of that are both solving the same equation.
    for (const preset of ['mite', 'biped', 'titan', 'colossus']) {
      const { slip } = footSlip(preset, 9);
      expect(Math.abs(slip), `${preset} slipped ${(slip * 100).toFixed(0)}%`)
        .toBeLessThan(0.2);
    }
  });

  it('gets BIGGER steps as it speeds up, not just faster ones', () => {
    // The old gait had one shape played at different rates, and above about
    // ten metres a second the joint slew ate it faster than the rate added
    // to it — so a machine at a sprint moved its legs LESS than at a jog.
    const jog = footSlip('biped', 6);
    const run = footSlip('biped', 12);
    expect(run.swing, `${run.swing.toFixed(2)}m against ${jog.swing.toFixed(2)}m`)
      .toBeGreaterThan(jog.swing * 1.2);
    // And the cadence stays somewhere a leg can actually go.
    expect(run.animator.gaitFreq).toBeLessThanOrEqual(RUN.cadence + 1e-6);
  });

  it('walks at every speed the machine can reach under its own power', () => {
    // The point of the exercise. A gait that gave up at cruise speed would
    // trade one problem for a worse one: the walk is the workhorse and it
    // should be what is on screen nearly all the time.
    const { animator } = footSlip('biped', 17);
    expect(animator.glide, 'still walking at its own top speed').toBeLessThan(0.05);
    expect(animator.runCap, 'and the legs are good for more than that')
      .toBeGreaterThan(17);
  });
});

describe('carried forward faster than the legs can stride', () => {
  const dashing = (v) => footSlip('biped', v, { velocity: new THREE.Vector3(0, 0, v) });

  it('gives up the walk rather than skittering through it', () => {
    // Above the run cap no step reaches the ground being covered — the
    // machine would need one longer than its own leg. Pretending otherwise
    // is exactly where the skitter came from.
    const boosted = dashing(34);
    expect(boosted.animator.glide, 'skating, not walking').toBeGreaterThan(0.9);
    expect(boosted.swing, 'and the legs have stopped cycling').toBeLessThan(0.3);
  });

  it('trails its feet behind it, the opposite way a retreat plants them', () => {
    const a = PRESETS.biped.build();
    const rig = new Rig(a);
    const animator = new Animator(rig, computeStats(a, rig));
    const at = (extra) => {
      animator.reset();
      const s = {
        dt: 1 / 60, grounded: 1, airborne: 0, bodyQ: new THREE.Quaternion(),
        aimDir: null, thrust: 0.2, jerk: 0, dashSpeed: 30, walkCap: 17,
        speed: 0, planarSpeed: 0, velocity: new THREE.Vector3(),
        locked: 0, ...extra,
      };
      for (let i = 0; i < 120; i++) animator.update(s);
      rig.root.updateMatrixWorld(true);
      const limb = rig.limbs[0];
      const tip = limb.chain[limb.chain.length - 1];
      return limb.sole.clone().applyMatrix4(tip.joint.matrixWorld).z;
    };
    const still = at({});
    const carried = at({
      speed: 34, planarSpeed: 34, velocity: new THREE.Vector3(0, 0, 34),
    });
    const giving = at({
      speed: 9, planarSpeed: 9, velocity: new THREE.Vector3(0, 0, -9),
      locked: 1, retreat: 1,
    });
    // One shape, reflected. Feet ahead of a machine going backwards; feet
    // behind one going forwards.
    expect(carried, `carried: sole at ${carried.toFixed(2)}`).toBeLessThan(still - 0.3);
    expect(giving, `giving ground: sole at ${giving.toFixed(2)}`)
      .toBeGreaterThan(still + 0.3);
  });

  it('leaves the sideways skate to the sideways case', () => {
    const { animator } = dashing(34);
    expect(animator.slide).toBe(0);
    expect(animator.brace).toBe(0);
  });
});

describe('the gait asks the machine how long its legs are', () => {
  it('measures the step rather than working it out on paper', () => {
    // The hip is not the only thing turning: the knee bends on the same
    // cycle and takes back about a third of what the hip gives. Assuming it
    // away came out 35% short, which is a third of every step dragged.
    const a = PRESETS.biped.build();
    const rig = new Rig(a);
    const animator = new Animator(rig, computeStats(a, rig));
    const limb = rig.limbs[0];
    expect(limb.lever, 'the measured lever is shorter than the bare geometry')
      .toBeLessThan(limb.reach);
    expect(limb.lever).toBeGreaterThan(limb.reach * 0.3);
  });

  it('gives the same answer however many times it is asked', () => {
    // The measurement drives the real gait, and the real gait reads the
    // measurement. Left to itself that chases its own tail.
    const a = PRESETS.biped.build();
    const rig = new Rig(a);
    const stats = computeStats(a, rig);
    const first = new Animator(rig, stats).legLever;
    const second = new Animator(rig, stats).legLever;
    const third = new Animator(rig, stats).legLever;
    expect(second).toBeCloseTo(first, 6);
    expect(third).toBeCloseTo(first, 6);
  });

  it('puts the machine back exactly as it found it', () => {
    const a = PRESETS.biped.build();
    const rig = new Rig(a);
    const before = rig.joints.map((n) => n.joint.quaternion.clone());
    // eslint-disable-next-line no-new
    new Animator(rig, computeStats(a, rig));
    rig.joints.forEach((n, i) => {
      expect(n.joint.quaternion.angleTo(before[i]), n.part.id).toBeLessThan(1e-6);
    });
  });

  it('leaves gaits with no stride alone', () => {
    // A hop covers ground by leaving it. There is no foot down to keep up
    // with the floor and nothing to solve.
    const a = PRESETS.hopper.build();
    const rig = new Rig(a);
    const animator = new Animator(rig, computeStats(a, rig));
    expect(animator.stats.gait).toBe('hop');
    expect(animator.legLever).toBeUndefined();
  });
});

// ============================================================
//  Stepping sideways.
// ============================================================

describe('a step to the side is not a stride turned sideways', () => {
  /** The widest the sole gets, across the machine, over one whole cycle. */
  const sideStep = (preset, vx) => {
    const a = PRESETS[preset].build();
    const rig = new Rig(a);
    const animator = new Animator(rig, computeStats(a, rig));
    const s = {
      dt: 1 / 60, speed: vx, planarSpeed: vx, grounded: 1, airborne: 0,
      velocity: new THREE.Vector3(vx, 0, 0), bodyQ: new THREE.Quaternion(),
      aimDir: null, locked: 1, thrust: 0.2, jerk: 0, dashSpeed: 30, walkCap: 17,
    };
    let lo = Infinity;
    let hi = -Infinity;
    let was = 0;
    let widest = 0;
    for (let i = 0; i < 900; i++) {
      animator.update(s);
      if (i <= 400) continue;
      rig.root.updateMatrixWorld(true);
      const limb = rig.limbs[0];
      const tip = limb.chain[limb.chain.length - 1];
      const p = limb.sole.clone().applyMatrix4(tip.joint.matrixWorld);
      // Per whole cycle, found by watching the phase wrap: a fixed window
      // measures the window rather than the stride.
      if (animator.gaitPhase < was) {
        if (lo < Infinity) widest = Math.max(widest, hi - lo);
        lo = Infinity;
        hi = -Infinity;
      }
      was = animator.gaitPhase;
      lo = Math.min(lo, p.x);
      hi = Math.max(hi, p.x);
    }
    return { widest, animator, rig };
  };

  it('fits between the machine own feet', () => {
    // A TITAN was taking 5.31m steps across a stance 2.75m wide: two and a
    // half metres of leg swung through the leg holding the machine up, once
    // a second, which is what "opens wide then shuts" looks like from the
    // outside.
    for (const preset of ['biped', 'titan', 'colossus']) {
      const { widest, rig } = sideStep(preset, 9);
      expect(widest, `${preset}: ${widest.toFixed(2)}m across a ${rig.stance.toFixed(2)}m stance`)
        .toBeLessThan(rig.stance * 1.15);
    }
  });

  it('is shorter than the same machine step forward', () => {
    const { animator } = sideStep('titan', 9);
    expect(animator.sideStepMax).toBeLessThan(animator.stepMax * 0.8);
  });

  it('does not make up the difference in cadence', () => {
    // Shortening the step without opening it sooner just moves the problem:
    // the legs would shuffle twice as fast to cover the same ground, which
    // is the skitter again.
    const across = sideStep('biped', 3).animator.gaitFreq;
    const a = PRESETS.biped.build();
    const rig = new Rig(a);
    const ahead = new Animator(rig, computeStats(a, rig));
    const s = {
      dt: 1 / 60, speed: 3, planarSpeed: 3, grounded: 1, airborne: 0,
      velocity: new THREE.Vector3(0, 0, 3), bodyQ: new THREE.Quaternion(),
      aimDir: null, locked: 0, thrust: 0.2, jerk: 0, dashSpeed: 30, walkCap: 17,
    };
    for (let i = 0; i < 400; i++) ahead.update(s);
    expect(across, `sideways ${across.toFixed(2)}Hz against forward ${ahead.gaitFreq.toFixed(2)}Hz`)
      .toBeLessThan(ahead.gaitFreq * 1.3);
  });

  it('skates once side-stepping gives out, rather than walking on', () => {
    // The threshold used to be the machine ground speed, which is a fact
    // about its thrust and nothing to do with its legs.
    const { animator } = sideStep('biped', 3);
    expect(animator.sideCap).toBeLessThan(17);
    const fast = sideStep('biped', 16).animator;
    expect(fast.slide, 'past its own side-step, it is being carried')
      .toBeGreaterThan(0.5);
  });
});
