import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Animator, waveAt } from '../src/anim/Animator.js';
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
    const spans = swingRange(rigged);

    expect(rigged.rig.nodes.get(upper.id).chainDepth).toBe(0);
    expect(rigged.rig.nodes.get(fore.id).chainDepth).toBe(1);
    expect(spanOf(spans, fore.id), 'so the arm does not double-bend')
      .toBeLessThan(spanOf(spans, upper.id));
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
