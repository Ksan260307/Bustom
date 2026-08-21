import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Rig, ridesFarHalf, makeBodyMaterial } from '../src/core/Rig.js';
import { Assembly, PRESETS, alignYToFace, _resetIds } from '../src/core/Assembly.js';
import { BONE } from '../src/core/constants.js';

let a;
beforeEach(() => { _resetIds(0); a = Assembly.createDefault(); });

const at = (x, y, z) => ({ pos: [x, y, z] });

const worldPos = (rig, id) => {
  rig.root.updateMatrixWorld(true);
  return rig.nodes.get(id).group.getWorldPosition(new THREE.Vector3());
};

describe('Rig hierarchy', () => {
  it('builds a node for every part', () => {
    const asm = PRESETS.biped.build();
    const rig = new Rig(asm);
    expect(rig.nodes.size).toBe(asm.size);
    asm.walk((p) => expect(rig.nodes.has(p.id)).toBe(true));
  });

  it('gives every bone a near / joint / far triple', () => {
    const n = a.addBoneOnFace(a.rootId, 3, BONE.LEG, { length: 3 });
    const rig = new Rig(a);
    const node = rig.nodes.get(n.id);
    expect(node.near).toBeTruthy();
    expect(node.joint).toBeTruthy();
    expect(node.far).toBeTruthy();
    expect(node.joint.position.y).toBeCloseTo(1.5, 6);   // half the length
    expect(node.far.parent).toBe(node.joint);
    expect(rig.joints).toContain(node);
  });

  it('splits bone-mounted children at the midpoint', () => {
    const n = a.addBoneOnFace(a.rootId, 3, BONE.LEG, { length: 4 });
    const near = a.addBlock(n.id, at(0, 0.5, 0));
    const far = a.addBlock(n.id, at(0, 3.5, 0));
    expect(ridesFarHalf(near, n)).toBe(false);
    expect(ridesFarHalf(far, n)).toBe(true);

    const rig = new Rig(a);
    expect(rig.nodes.get(near.id).host).toBe(rig.nodes.get(n.id).near);
    expect(rig.nodes.get(far.id).host).toBe(rig.nodes.get(n.id).far);
  });

  it('the far half is measured from the joint, so world position is unchanged', () => {
    const n = a.addBoneOnFace(a.rootId, 2, BONE.LEG, { length: 4 });
    const far = a.addBlock(n.id, at(0, 3, 0));
    const rig = new Rig(a);
    // core surface at +0.5, then 3 along the shaft
    expect(worldPos(rig, far.id).y).toBeCloseTo(3.5, 6);
    expect(rig.nodes.get(far.id).group.position.y).toBeCloseTo(1, 6); // 3 - L/2
  });

  it('a block exactly on the midpoint rides the far half', () => {
    const n = a.addBoneOnFace(a.rootId, 2, BONE.LEG, { length: 4 });
    const mid = a.addBlock(n.id, at(0, 2, 0));
    expect(ridesFarHalf(mid, n)).toBe(true);
  });

  it('chains a bone off another bone tip into the far group', () => {
    const thigh = a.addBoneOnFace(a.rootId, 3, BONE.LEG, { length: 2 });
    const shin = a.addBoneOnTip(thigh.id, BONE.LEG, { length: 2 });
    const rig = new Rig(a);
    expect(rig.nodes.get(shin.id).host).toBe(rig.nodes.get(thigh.id).far);
  });

  it('tags every pickable with its part id', () => {
    const rig = new Rig(PRESETS.multileg.build());
    expect(rig.pickables.length).toBeGreaterThan(0);
    for (const m of rig.pickables) expect(typeof m.userData.partId).toBe('string');
  });
});

describe('free placement', () => {
  it('puts a part exactly where its mount says', () => {
    const b = a.addBlock(a.rootId, at(2.5, -1.25, 0.75));
    const rig = new Rig(a);
    const p = worldPos(rig, b.id);
    expect(p.x).toBeCloseTo(2.5, 6);
    expect(p.y).toBeCloseTo(-1.25, 6);
    expect(p.z).toBeCloseTo(0.75, 6);
  });

  it('a floating part is still parented, and still moves with its segment', () => {
    const bone = a.addBoneOnFace(a.rootId, 2, BONE.LEG, { length: 4 });
    const bit = a.addBlock(bone.id, at(2, 3, 0));   // far half, well off the shaft
    const rig = new Rig(a);
    const before = worldPos(rig, bit.id).clone();

    // rotate the joint: the bit must swing with the far half
    rig.nodes.get(bone.id).joint.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.6);
    rig.root.updateMatrixWorld(true);
    const after = worldPos(rig, bit.id);
    expect(after.distanceTo(before)).toBeGreaterThan(0.5);
  });

  it('honours the mount rotation', () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const b = a.addBlock(a.rootId, { pos: [2, 0, 0], rot: q.toArray() });
    const rig = new Rig(a);
    const worldQ = rig.nodes.get(b.id).group.getWorldQuaternion(new THREE.Quaternion());
    expect(worldQ.angleTo(q)).toBeCloseTo(0, 5);
  });

  it('a bone points along its mount rotation', () => {
    const n = a.addBone(a.rootId, { pos: [0, 0, 0], rot: alignYToFace(0) }, BONE.ARM, { length: 2 });
    const rig = new Rig(a);
    rig.root.updateMatrixWorld(true);
    const tip = rig.nodes.get(n.id).group.localToWorld(new THREE.Vector3(0, 2, 0));
    expect(tip.x).toBeCloseTo(2, 5);
    expect(tip.y).toBeCloseTo(0, 5);
  });

  it('the flush helpers separate two blocks by half of each size', () => {
    a.setSize(a.rootId, [2, 2, 2]);
    const b = a.addBlockOnFace(a.rootId, 0, 1, { size: [1, 1, 1] });
    const rig = new Rig(a);
    expect(worldPos(rig, b.id).x).toBeCloseTo(1.5, 6);
  });

  it('non-uniform sizes only shift along the mount axis', () => {
    const b = a.addBlockOnFace(a.rootId, 2, 1, { size: [3, 0.5, 2] });
    const rig = new Rig(a);
    const p = worldPos(rig, b.id);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0.75, 6);
  });

  it('scales the mesh instead of re-meshing', () => {
    const b = a.addBlock(a.rootId, at(0, 1, 0), 1, { size: [2, 0.5, 1] });
    const rig = new Rig(a);
    const mesh = rig.nodes.get(b.id).mesh;
    expect(mesh.scale.toArray()).toEqual([2, 0.5, 1]);
    expect(mesh.position.toArray()).toEqual([-1, -0.25, -0.5]);
    expect(mesh.geometry).toBe(b.vox.geometry(a.palette));
  });
});

describe('Rig refresh', () => {
  it('refreshSize updates the transform in place', () => {
    const b = a.addBlockOnFace(a.rootId, 2);
    const rig = new Rig(a);
    a.setSize(b.id, [2, 2, 2]);
    expect(rig.refreshSize(b.id)).toBe(true);
    expect(rig.nodes.get(b.id).mesh.scale.toArray()).toEqual([2, 2, 2]);
    expect(rig.refreshSize('nope')).toBe(false);
  });

  it('refreshMount moves a part without a rebuild', () => {
    const b = a.addBlockOnFace(a.rootId, 2);
    const rig = new Rig(a);
    a.setMount(b.id, { pos: [3, 0, 0] });
    expect(rig.refreshMount(b.id)).toBe(true);
    expect(worldPos(rig, b.id).x).toBeCloseTo(3, 6);
  });

  it('refreshMount reports when a part has changed bone halves', () => {
    const n = a.addBoneOnFace(a.rootId, 2, BONE.LEG, { length: 4 });
    const b = a.addBlock(n.id, at(0, 0.5, 0));   // near half
    const rig = new Rig(a);
    a.setMount(b.id, { pos: [0, 3.5, 0] });      // now the far half
    expect(rig.refreshMount(b.id)).toBe(false);
    // after a real rebuild it lands in the far group
    const rebuilt = new Rig(a);
    expect(rebuilt.nodes.get(b.id).host).toBe(rebuilt.nodes.get(n.id).far);
  });

  it('refreshBlock swaps in the new geometry after a carve', () => {
    const b = a.addBlockOnFace(a.rootId, 2);
    const rig = new Rig(a);
    const before = rig.nodes.get(b.id).mesh.geometry;
    b.vox.brush(8, 8, 8, 4, 0);
    expect(rig.refreshBlock(b.id)).toBe(true);
    expect(rig.nodes.get(b.id).mesh.geometry).not.toBe(before);
    expect(rig.refreshBlock('nope')).toBe(false);
  });
});

describe('Rig measurement', () => {
  it('measures bounds, radius and the lowest point', () => {
    const rig = new Rig(PRESETS.biped.build());
    expect(rig.boundingRadius).toBeGreaterThan(0);
    expect(rig.restLowestY).toBeLessThan(0);
    expect(rig.restHeight).toBeGreaterThan(1);
    expect(rig.bounds.isEmpty()).toBe(false);
  });

  it('a floating part widens the bounds', () => {
    const tight = new Rig(a).boundingRadius;
    a.addBlock(a.rootId, at(5, 0, 0), 15, { size: [0.5, 0.5, 0.5] });
    expect(new Rig(a).boundingRadius).toBeGreaterThan(tight);
  });
});

describe('Rig limbs', () => {
  it('groups leg chains into limbs', () => {
    const rig = new Rig(PRESETS.multileg.build());
    expect(rig.limbs).toHaveLength(4);
    for (const limb of rig.limbs) {
      expect(limb.chain.length).toBe(2);        // hip + knee
      expect(limb.chain[0]).toBe(limb.root);
    }
  });

  it('indexes limbs deterministically', () => {
    const asm = PRESETS.multileg.build();
    const one = new Rig(asm).limbs.map((l) => l.anchor.toArray().map((v) => +v.toFixed(4)));
    const two = new Rig(asm).limbs.map((l) => l.anchor.toArray().map((v) => +v.toFixed(4)));
    expect(one).toEqual(two);
  });

  it('sorts limbs into distinct rows and sides', () => {
    const rig = new Rig(PRESETS.multileg.build());
    const zs = new Set(rig.limbs.map((l) => +l.anchor.z.toFixed(3)));
    const xs = new Set(rig.limbs.map((l) => Math.sign(l.anchor.x)));
    expect(zs.size).toBe(2);
    expect(xs.size).toBe(2);
  });

  it('separates bones by attribute', () => {
    const rig = new Rig(PRESETS.biped.build());
    expect(rig.armBones.length).toBe(2);
    expect(rig.faceBones.length).toBe(1);
    expect(rig.customBones.length).toBe(0);
    expect(new Rig(PRESETS.multileg.build()).customBones.length).toBe(1);
  });

  it('a legless build has no limbs', () => {
    expect(new Rig(a).limbs).toHaveLength(0);
  });
});

describe('Rig lifecycle', () => {
  it('resetPose returns every joint to identity', () => {
    const rig = new Rig(PRESETS.biped.build());
    rig.joints[0].joint.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1);
    rig.resetPose();
    for (const j of rig.joints) {
      expect(j.joint.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 9);
    }
  });

  it('dispose leaves the block geometry cache intact', () => {
    const asm = PRESETS.biped.build();
    const rig = new Rig(asm);
    const core = asm.core;
    const geo = core.vox.geometry(asm.palette);
    rig.dispose();
    expect(core.vox.geometry(asm.palette)).toBe(geo);
    expect(geo.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('makeBodyMaterial uses vertex colours', () => {
    const m = makeBodyMaterial();
    expect(m.vertexColors).toBe(true);
    expect(m.flatShading).toBe(true);
  });
});
