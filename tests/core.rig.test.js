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

describe('boost flares', () => {
  const plated = (type, face = 5) => {
    const a = Assembly.createDefault();
    const plate = a.addEquipOnFace(a.rootId, face, type, { size: 0.7 });
    return { a, plate, rig: new Rig(a) };
  };

  it('a boost plate carries its own flame', () => {
    const { plate, rig } = plated('boost');
    const node = rig.nodes.get(plate.id);
    expect(node.boostFlare).toBeTruthy();
    expect(node.boostFlare.group.parent, 'mounted on the plate itself').toBe(node.group);
    expect(node.boostFlare.group.visible, 'and dark at rest').toBe(false);
    rig.dispose();
  });

  it('no other plate does', () => {
    for (const type of ['beam', 'gravity', 'rolling', 'blade']) {
      const { plate, rig } = plated(type);
      expect(rig.nodes.get(plate.id).boostFlare, type).toBeFalsy();
      rig.dispose();
    }
  });

  it('lights up and goes out again', () => {
    const { plate, rig } = plated('boost');
    const f = rig.nodes.get(plate.id).boostFlare;

    rig.setBoostGlow(1);
    expect(f.group.visible).toBe(true);
    expect(f.cone.material.opacity).toBeGreaterThan(0.3);
    expect(f.disc.material.opacity).toBeGreaterThan(0.5);

    rig.setBoostGlow(0.5);
    const half = f.cone.material.opacity;
    rig.setBoostGlow(1);
    expect(f.cone.material.opacity).toBeGreaterThan(half);

    rig.setBoostGlow(0);
    expect(f.group.visible).toBe(false);
    rig.dispose();
  });

  it('fires along the face it is stuck to', () => {
    const back = plated('boost', 5);          // -Z
    back.rig.root.updateMatrixWorld(true);
    const dir = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(back.rig.nodes.get(back.plate.id).group.getWorldQuaternion(new THREE.Quaternion()));
    expect(dir.z, 'a plate on the back throws its flame backwards').toBeLessThan(-0.9);
    back.rig.dispose();

    const belly = plated('boost', 3);         // -Y
    belly.rig.root.updateMatrixWorld(true);
    const down = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(belly.rig.nodes.get(belly.plate.id).group.getWorldQuaternion(new THREE.Quaternion()));
    expect(down.y).toBeLessThan(-0.9);
    belly.rig.dispose();
  });

  it('every fitted plate lights together', () => {
    const a = Assembly.createDefault();
    const one = a.addEquipOnFace(a.rootId, 5, 'boost');
    const two = a.addEquipOnFace(a.rootId, 3, 'boost');
    const rig = new Rig(a);
    rig.setBoostGlow(1);
    for (const id of [one.id, two.id]) {
      expect(rig.nodes.get(id).boostFlare.group.visible, id).toBe(true);
    }
    rig.dispose();
  });
});

describe('rolling blocks', () => {
  /** A block with a ROLLING plate on the named face. */
  const rolling = (face = 2, spin = undefined) => {
    const a = Assembly.createDefault();
    const block = a.addBlockOnFace(a.rootId, 2, 3, { size: [1, 0.5, 1] });
    const plate = a.addEquipOnFace(block.id, face, 'rolling', { spin });
    return { a, block, plate, rig: new Rig(a) };
  };

  it('gives the block a group that is free to turn', () => {
    const { block, rig } = rolling();
    expect(rig.rollers).toHaveLength(1);
    expect(rig.nodes.get(block.id).spin).toBeTruthy();
    expect(rig.nodes.get(block.id).mesh.parent).toBe(rig.nodes.get(block.id).spin);
    rig.dispose();
  });

  it('never turns the core: the whole machine would go with it', () => {
    const a = Assembly.createDefault();
    a.addEquipOnFace(a.rootId, 2, 'rolling');
    const rig = new Rig(a);
    expect(rig.rollers).toHaveLength(0);
    expect(rig.nodes.get(a.rootId).spin).toBeFalsy();
    rig.dispose();
  });

  it('a plate on a bone spins nothing', () => {
    const a = Assembly.createDefault();
    const bone = a.addBoneOnFace(a.rootId, 3, BONE.LEG, { length: 2 });
    a.addEquip(bone.id, { pos: [0.2, 1, 0] }, 'rolling');
    const rig = new Rig(a);
    expect(rig.rollers).toHaveLength(0);
    rig.dispose();
  });

  it('turns at the rate it was given, in the direction it was given', () => {
    const { rig } = rolling(2, { dir: 1, rpm: 60 });   // one turn a second
    rig.updateRollers(0.25);
    expect(rig.rollers[0].angle).toBeCloseTo(Math.PI / 2, 4);
    rig.updateRollers(0.25);
    expect(rig.rollers[0].angle).toBeCloseTo(Math.PI, 4);
    rig.dispose();

    const back = rolling(2, { dir: -1, rpm: 60 });
    back.rig.updateRollers(0.25);
    expect(back.rig.rollers[0].angle).toBeCloseTo(-Math.PI / 2, 4);
    back.rig.dispose();
  });

  it('the face it is stuck to decides the axis', () => {
    const top = rolling(2);       // +Y
    expect(Math.abs(top.rig.rollers[0].axis.y)).toBeCloseTo(1, 5);
    top.rig.dispose();

    const side = rolling(0);      // +X
    expect(Math.abs(side.rig.rollers[0].axis.x)).toBeCloseTo(1, 5);
    side.rig.dispose();
  });

  it('carries whatever is mounted on the block round with it', () => {
    const { a, block, rig } = rolling();
    rig.dispose();

    const rider = a.addBlockOnFace(block.id, 4, 6, { size: [0.5, 0.5, 0.5] });
    const rig2 = new Rig(a);
    const node = rig2.nodes.get(block.id);
    expect(rig2.nodes.get(rider.id).group.parent).toBe(node.spin);

    rig2.root.updateMatrixWorld(true);
    const before = rig2.nodes.get(rider.id).group.getWorldPosition(new THREE.Vector3());
    rig2.updateRollers(0.25);
    rig2.root.updateMatrixWorld(true);
    const after = rig2.nodes.get(rider.id).group.getWorldPosition(new THREE.Vector3());
    expect(before.distanceTo(after)).toBeGreaterThan(0.2);
    rig2.dispose();
  });
});

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
    expect(rig.armBones.length, 'upper arm and forearm, both sides').toBe(4);
    expect(rig.faceBones.length).toBe(1);
    expect(rig.customBones.length, 'the waist').toBe(1);
    expect(new Rig(PRESETS.multileg.build()).customBones.length).toBe(1);
  });

  it('knows how deep each arm bone hangs in its chain', () => {
    const rig = new Rig(PRESETS.biped.build());
    const depths = rig.armBones.map((n) => n.chainDepth).sort();
    expect(depths, 'a shoulder and a forearm per side').toEqual([0, 0, 1, 1]);
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
