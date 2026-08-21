import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Animator } from '../src/anim/Animator.js';
import { Rig } from '../src/core/Rig.js';
import { Assembly, PRESETS, computeStats } from '../src/core/Assembly.js';
import { BONE } from '../src/core/constants.js';

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
function swingRange({ rig, animator }, signals = {}, frames = 240) {
  const spans = new Map(rig.joints.map((j) => [j.part.id, { min: Infinity, max: -Infinity }]));
  const s = {
    dt: 1 / 60, speed: 8, planarSpeed: 8, grounded: 1, airborne: 0,
    velocity: new THREE.Vector3(0, 0, 8), bodyQ: new THREE.Quaternion(),
    aimDir: null, locked: 0, thrust: 0.3, jerk: 0, ...signals,
  };
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
    expect(Math.abs(rigged.animator.bodyLean.x)).toBeLessThanOrEqual(0.21);
    expect(Math.abs(rigged.animator.bodyLean.y)).toBeLessThanOrEqual(0.17);
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
