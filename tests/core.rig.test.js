import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { EQUIP, CIRCLE_RADIUS_DEFAULT } from '../src/core/constants.js';
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

describe('the circle plate carries what stands on its line', () => {
  /** A wide deck with towers at the given distances from the middle. */
  const deck = (radius, dists) => {
    const a = Assembly.createDefault();
    a.setSize(a.rootId, [4, 0.5, 4]);
    const towers = dists.map((d, i) => a.addBlock(a.rootId, { pos: [d, 0.35, 0] }, 2 + i, {
      size: [0.5, 0.5, 0.5],
    }));
    const plate = a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE, { ringRadius: radius });
    return { a, towers, plate, rig: new Rig(a) };
  };

  it('takes what is on the line, and leaves the middle alone', () => {
    // The plate is at the centre; the line is at 1.5. A block standing in
    // the middle of the circle is not on it and does not travel with it —
    // that is the difference between a line and a turntable.
    const { plate, towers, rig } = deck(1.5, [0.2, 1.5, 3.4]);
    const ring = rig.nodes.get(plate.id).ring;
    expect(ring, 'the plate drew a line').toBeTruthy();
    expect(ring.members).toHaveLength(1);
    expect(ring.members).toContain(towers[1].id);
    expect(ring.members, 'the one in the middle').not.toContain(towers[0].id);
    expect(ring.members, 'and the one well outside').not.toContain(towers[2].id);
    rig.dispose();
  });

  it('a block straddling the line counts as on it', () => {
    // Positions snap to a quarter metre and the radius is a free slider, so
    // "exactly on the line" would almost never happen. Touching it is enough.
    const { plate, towers, rig } = deck(1.5, [1.25]);
    expect(rig.nodes.get(plate.id).ring.members).toContain(towers[0].id);
    rig.dispose();
  });

  it('changing the radius changes which line the blocks are on', () => {
    const near = deck(1.0, [1.0, 2.5]);
    const far = deck(2.5, [1.0, 2.5]);
    expect(near.rig.nodes.get(near.plate.id).ring.members).toEqual([near.towers[0].id]);
    expect(far.rig.nodes.get(far.plate.id).ring.members).toEqual([far.towers[1].id]);
    near.rig.dispose();
    far.rig.dispose();
  });

  it('turns what it collected, and leaves the rest alone', () => {
    const { towers, rig } = deck(1.5, [1.5, 3.4]);
    rig.root.updateMatrixWorld(true);
    const before = towers.map((t) => {
      const v = new THREE.Vector3();
      rig.nodes.get(t.id).group.getWorldPosition(v);
      return v;
    });

    rig.updateRollers(0.5);          // half a second of turning
    rig.root.updateMatrixWorld(true);
    const after = towers.map((t) => {
      const v = new THREE.Vector3();
      rig.nodes.get(t.id).group.getWorldPosition(v);
      return v;
    });

    expect(after[0].distanceTo(before[0]), 'the one on the line moved').toBeGreaterThan(0.2);
    expect(after[1].distanceTo(before[1]), 'the one off it did not').toBeLessThan(1e-6);
    rig.dispose();
  });

  it('the ring turns about the face the plate was stuck to', () => {
    const { towers, rig } = deck(1.5, [1.5]);
    rig.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    rig.nodes.get(towers[0].id).group.getWorldPosition(v);
    const y0 = v.y;

    rig.updateRollers(0.4);
    rig.root.updateMatrixWorld(true);
    rig.nodes.get(towers[0].id).group.getWorldPosition(v);
    // Stuck on the top face, so the ring is horizontal: the rider goes round,
    // never up or down.
    expect(v.y).toBeCloseTo(y0, 5);
    rig.dispose();
  });

  it('a plate with no radius set still gets the default one', () => {
    const a = Assembly.createDefault();
    a.setSize(a.rootId, [6, 0.5, 6]);
    const tower = a.addBlock(a.rootId, { pos: [CIRCLE_RADIUS_DEFAULT, 0.35, 0] }, 3, {
      size: [0.4, 0.4, 0.4],
    });
    const plate = a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE);
    const rig = new Rig(a);
    expect(rig.nodes.get(plate.id).ring.members).toContain(tower.id);
    rig.dispose();
  });

  it('carries what TOUCHES the line, not what is merely near it', () => {
    // Radius 2, and three blocks that differ only in how far they reach:
    // one whose side lands exactly on the line, one a quarter of a metre
    // short of it, and a long one lying across it.
    const a = Assembly.createDefault();
    a.setSize(a.rootId, [8, 0.5, 8]);
    const touching = a.addBlock(a.rootId, { pos: [1.75, 0.5, 0] }, 5, { size: [0.5, 0.5, 0.5] });
    const short = a.addBlock(a.rootId, { pos: [1.5, 0.5, 0] }, 6, { size: [0.5, 0.5, 0.5] });
    const across = a.addBlock(a.rootId, { pos: [0, 0.5, 1] }, 7, { size: [0.5, 0.5, 2.5] });
    const plate = a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE, { ringRadius: 2 });

    const rig = new Rig(a);
    const members = rig.nodes.get(plate.id).ring.members;
    expect(members, 'its side lands on the line').toContain(touching.id);
    expect(members, 'and this one stops short of it').not.toContain(short.id);
    expect(members, 'a long part lying across it is on it').toContain(across.id);
    rig.dispose();
  });

  it('measures a turned part by the side it actually presents', () => {
    // The same long plank, in the same place, turned on the spot. End-on it
    // is a quarter of a metre wide and stops short of the line; side-on it
    // is a metre and lies across it. One number for "how wide is it" cannot
    // tell those apart, and picking the wrong one gets it backwards.
    const build = (turn) => {
      const a = Assembly.createDefault();
      a.setSize(a.rootId, [8, 0.5, 8]);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn);
      const plank = a.addBlock(a.rootId, { pos: [1.5, 0.5, 0], rot: q.toArray() }, 5, {
        size: [0.5, 0.5, 2],
      });
      const plate = a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE, { ringRadius: 2 });
      const rig = new Rig(a);
      const on = rig.nodes.get(plate.id).ring.members.includes(plank.id);
      rig.dispose();
      return on;
    };
    expect(build(0), 'end-on, it reaches 1.75 and the line is at 2').toBe(false);
    expect(build(Math.PI / 2), 'turned side-on, it lies right across it').toBe(true);
  });

  it('the line goes where the plate goes', () => {
    // The bug this replaces: the ring was positioned once, when the rig was
    // built, so dragging the plate left its circle hanging in the air.
    const a = Assembly.createDefault();
    a.setSize(a.rootId, [8, 0.5, 8]);
    const rider = a.addBlock(a.rootId, { pos: [2, 0.5, 0] }, 5, { size: [0.5, 0.5, 0.5] });
    const plate = a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE, { ringRadius: 2 });
    const rig = new Rig(a);
    const ring = rig.nodes.get(plate.id).ring;
    expect(ring.members).toContain(rider.id);

    const where = (obj) => {
      rig.root.updateMatrixWorld(true);
      return obj.getWorldPosition(new THREE.Vector3());
    };
    const plateNode = rig.nodes.get(plate.id);
    expect(where(ring.guide).distanceTo(where(plateNode.group)), 'they start together')
      .toBeCloseTo(0, 5);

    // Move the plate the way an edit does: write the mount.
    plate.mount.pos = [1.5, plate.mount.pos[1], 0.5];
    plateNode.group.position.fromArray(plate.mount.pos);
    rig.syncRings();

    expect(where(ring.guide).distanceTo(where(plateNode.group)), 'and they stay together')
      .toBeCloseTo(0, 5);

    // And the rider stayed at its own mount rather than being towed along.
    expect(where(rig.nodes.get(rider.id).group).x, 'the rider did not move with it')
      .toBeCloseTo(2, 5);
    rig.dispose();
  });

  it('a ring that has turned keeps its riders while the plate moves', () => {
    const a = Assembly.createDefault();
    a.setSize(a.rootId, [8, 0.5, 8]);
    const rider = a.addBlock(a.rootId, { pos: [2, 0.5, 0] }, 5, { size: [0.5, 0.5, 0.5] });
    const plate = a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE, { ringRadius: 2 });
    const rig = new Rig(a);
    const ring = rig.nodes.get(plate.id).ring;

    rig.updateRollers(0.5);                    // part way round
    const spun = ring.angle;
    expect(spun).toBeGreaterThan(0);

    plate.mount.pos = [0.5, plate.mount.pos[1], 0];
    rig.nodes.get(plate.id).group.position.fromArray(plate.mount.pos);
    rig.syncRings();

    expect(ring.angle, 'moving the plate is not a reason to lose the rotation')
      .toBe(spun);
    expect(ring.members, 'nor the riders').toContain(rider.id);
    rig.dispose();
  });

  it('the plane decides which way the line lies', () => {
    // The same deck and the same plate, stuck on the FRONT face. Left to the
    // plate's own facing the circle stands on edge; the plane control lays
    // it down. This is the whole bug: a plate on the wrong face drew its
    // line where nothing was standing, and read as "the gimmick is broken".
    const normalOf = (plane) => {
      const a = Assembly.createDefault();
      a.setSize(a.rootId, [4, 0.5, 4]);
      const plate = a.addEquipOnFace(a.rootId, 4, EQUIP.CIRCLE, {
        ringRadius: 2, ringPlane: plane,
      });
      const rig = new Rig(a);
      rig.root.updateMatrixWorld(true);
      const ring = rig.nodes.get(plate.id).ring;
      const n = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(ring.guide.parent.getWorldQuaternion(new THREE.Quaternion()));
      rig.dispose();
      return n;
    };

    // Stuck on +Z, so the plate's own plane faces the camera.
    expect(Math.abs(normalOf('face').z), 'left alone, it faces the way the plate does')
      .toBeCloseTo(1, 5);
    expect(Math.abs(normalOf('pitch').y), 'pitched over, it lies flat').toBeCloseTo(1, 5);
    expect(Math.abs(normalOf('roll').x), 'rolled over, it stands the other way')
      .toBeCloseTo(1, 5);
  });

  it('turning the plane re-decides who is standing on the line', () => {
    // Towers in a flat ring on the deck, and a plate in the middle of the
    // deck's top. Flat catches all four; stood on edge it cannot.
    const build = (plane) => {
      const a = Assembly.createDefault();
      a.setSize(a.rootId, [4, 0.5, 4]);
      for (const [x, z] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
        a.addBlock(a.rootId, { pos: [x, 0.5, z] }, 5, { size: [0.5, 0.5, 0.5] });
      }
      const plate = a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE, {
        ringRadius: 2, ringPlane: plane,
      });
      const rig = new Rig(a);
      const n = rig.nodes.get(plate.id).ring.members.length;
      rig.dispose();
      return n;
    };
    expect(build('face'), 'flat, and everything is on it').toBe(4);
    expect(build('pitch'), 'on edge, and most of them are not').toBeLessThan(4);
  });

  it('draws the line, and keeps it out of the field', () => {
    const { plate, rig } = deck(1.5, [1.5]);
    const guide = rig.nodes.get(plate.id).ring.guide;
    expect(guide, 'the line is a real object').toBeTruthy();
    expect(guide.visible, 'and starts hidden: it is a building aid').toBe(false);

    rig.setRingGuides(true);
    expect(guide.visible).toBe(true);
    rig.setRingGuides(false);
    expect(guide.visible).toBe(false);
    rig.dispose();
  });

  it('one gimmick can be stopped without stopping the others', () => {
    const a = Assembly.createDefault();
    a.setSize(a.rootId, [4, 0.5, 4]);
    a.addBlock(a.rootId, { pos: [1.5, 0.35, 0] }, 3, { size: [0.5, 0.5, 0.5] });
    const circle = a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE, { ringRadius: 1.5 });
    const wheel = a.addBlockOnFace(a.rootId, 0, 4, { size: [0.5, 0.5, 0.5] });
    const roller = a.addEquipOnFace(wheel.id, 2, EQUIP.ROLLING, { size: 0.4 });

    const rig = new Rig(a);
    rig.setGimmickPaused(circle.id, true);
    rig.updateRollers(0.5);

    expect(rig.nodes.get(circle.id).ring.angle, 'the stopped one').toBe(0);
    expect(rig.rollers.find((r) => r.part.id === roller.id).angle, 'the other one')
      .not.toBe(0);

    rig.setGimmickPaused(circle.id, false);
    rig.updateRollers(0.5);
    expect(rig.nodes.get(circle.id).ring.angle, 'and it starts again').not.toBe(0);
    rig.dispose();
  });

  it('rolling and circle plates advance together', () => {
    const { rig } = deck(1.5, [1.5]);
    expect(rig.rings).toHaveLength(1);
    const ring = rig.rings[0];
    rig.updateRollers(0.25);
    expect(ring.angle).toBeGreaterThan(0);
    rig.dispose();
  });
});

describe('a circle sizes itself to what is already there', () => {
  const fit = (build) => {
    const a = Assembly.createDefault();
    const plate = build(a);
    const rig = new Rig(a);
    const radius = rig.fitRingRadius(plate.id);
    rig.dispose();
    return radius;
  };

  it('lands on the ring of parts around the plate', () => {
    // The trap this replaces: a fixed two-metre default is wider than most
    // machines, so a plate stuck on one drew its line out past everything
    // and carried nothing. It looked broken, and the only way out was to
    // guess at the radius slider until something moved.
    expect(fit((a) => {
      a.setSize(a.rootId, [4, 0.5, 4]);
      for (const [x, z] of [[1.25, 0], [-1.25, 0], [0, 1.25], [0, -1.25]]) {
        a.addBlock(a.rootId, { pos: [x, 0.5, z] }, 5, { size: [0.5, 0.5, 0.5] });
      }
      return a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE, {});
    })).toBeCloseTo(1.25, 6);
  });

  it('counts parts hanging off other blocks, not only the plate’s own', () => {
    // A head with a plate on top and two pods either side of it, mounted on
    // the body. The line passes straight through both pods, so the builder
    // expects them to go round — and which block they happen to hang off is
    // bookkeeping they should never have to think about.
    expect(fit((a) => {
      a.setSize(a.rootId, [1, 1, 1]);
      const head = a.addBlockOnFace(a.rootId, 2, 4, { size: [1, 1, 1] });
      for (const x of [-1.75, 1.75]) {
        a.addBlock(a.rootId, { pos: [x, 1.5, 0] }, 1, { size: [0.75, 0.75, 0.75] });
      }
      return a.addEquipOnFace(head.id, 2, EQUIP.CIRCLE, {});
    })).toBeCloseTo(1.75, 6);
  });

  it('picks the circle that catches the most, not the nearest thing', () => {
    expect(fit((a) => {
      a.setSize(a.rootId, [8, 0.5, 8]);
      a.addBlock(a.rootId, { pos: [0.75, 0.5, 0] }, 6, { size: [0.5, 0.5, 0.5] });
      for (const [x, z] of [[2.5, 0], [-2.5, 0], [0, 2.5]]) {
        a.addBlock(a.rootId, { pos: [x, 0.5, z] }, 5, { size: [0.5, 0.5, 0.5] });
      }
      return a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE, {});
    })).toBeCloseTo(2.5, 6);
  });

  it('has nothing to say when there is nothing to measure', () => {
    expect(fit((a) => a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE, {}))).toBe(null);
  });

  it('counts what it is already carrying, not just what is loose', () => {
    // Asked for a second time, the parts it picked up the first time are
    // inside the ring and invisible to a walk of the scene. Leaving them out
    // would fit the circle to everything EXCEPT the parts it is turning.
    const a = Assembly.createDefault();
    a.setSize(a.rootId, [4, 0.5, 4]);
    for (const [x, z] of [[1.25, 0], [-1.25, 0], [0, 1.25], [0, -1.25]]) {
      a.addBlock(a.rootId, { pos: [x, 0.5, z] }, 5, { size: [0.5, 0.5, 0.5] });
    }
    const plate = a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE, { ringRadius: 1.25 });
    const rig = new Rig(a);
    expect(rig.nodes.get(plate.id).ring.members, 'it has them all').toHaveLength(4);
    expect(rig.fitRingRadius(plate.id), 'and still says the same circle')
      .toBeCloseTo(1.25, 6);
    rig.dispose();
  });

  it('what it fitted is what actually turns', () => {
    const a = Assembly.createDefault();
    a.setSize(a.rootId, [4, 0.5, 4]);
    const towers = [[1.25, 0], [-1.25, 0], [0, 1.25], [0, -1.25]].map(([x, z]) =>
      a.addBlock(a.rootId, { pos: [x, 0.5, z] }, 5, { size: [0.5, 0.5, 0.5] }));
    const plate = a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE, {});

    const probe = new Rig(a);
    a.setEquipRing(plate.id, probe.fitRingRadius(plate.id));
    probe.dispose();

    const rig = new Rig(a);
    const ring = rig.nodes.get(plate.id).ring;
    expect(ring.members, 'all four of them').toHaveLength(towers.length);

    rig.root.updateMatrixWorld(true);
    const before = rig.nodes.get(towers[0].id).group.getWorldPosition(new THREE.Vector3());
    rig.updateRollers(0.5);
    rig.root.updateMatrixWorld(true);
    const after = rig.nodes.get(towers[0].id).group.getWorldPosition(new THREE.Vector3());
    expect(after.distanceTo(before), 'and they go round').toBeGreaterThan(0.2);
    rig.dispose();
  });
});

describe('a circle carries anything rigid with it', () => {
  /** Head with a plate on it, two pods on the BODY either side. */
  const podded = (radius) => {
    const a = Assembly.createDefault();
    a.setSize(a.rootId, [1, 1, 1]);
    const head = a.addBlockOnFace(a.rootId, 2, 4, { size: [1, 1, 1] });
    const pods = [-1.75, 1.75].map((x) =>
      a.addBlock(a.rootId, { pos: [x, 1.5, 0] }, 1, { size: [0.75, 0.75, 0.75] }));
    const plate = a.addEquipOnFace(head.id, 2, EQUIP.CIRCLE, { ringRadius: radius });
    return { a, pods, plate, head, rig: new Rig(a) };
  };

  it('takes parts mounted on a different block', () => {
    const { pods, plate, rig } = podded(1.75);
    const members = rig.nodes.get(plate.id).ring.members;
    for (const pod of pods) expect(members, 'on the line, so on the ring').toContain(pod.id);
    rig.dispose();
  });

  it('picking them up does not move them', () => {
    // They are re-parented into the ring, which means their transform is
    // rewritten. Get that wrong and the machine visibly rearranges itself
    // the moment a plate is stuck on.
    const { pods, rig } = podded(1.75);
    rig.root.updateMatrixWorld(true);
    for (const [i, pod] of pods.entries()) {
      const at = rig.nodes.get(pod.id).group.getWorldPosition(new THREE.Vector3());
      expect(at.x, `pod ${i} x`).toBeCloseTo(i === 0 ? -1.75 : 1.75, 5);
      expect(at.y, `pod ${i} y`).toBeCloseTo(1.5, 5);
      expect(at.z, `pod ${i} z`).toBeCloseTo(0, 5);
    }
    rig.dispose();
  });

  it('and then carries them round', () => {
    const { pods, rig } = podded(1.75);
    rig.root.updateMatrixWorld(true);
    const before = rig.nodes.get(pods[0].id).group.getWorldPosition(new THREE.Vector3());
    rig.updateRollers(0.5);
    rig.root.updateMatrixWorld(true);
    const after = rig.nodes.get(pods[0].id).group.getWorldPosition(new THREE.Vector3());
    expect(after.distanceTo(before)).toBeGreaterThan(0.5);
    expect(after.y, 'round, not up').toBeCloseTo(before.y, 5);
    rig.dispose();
  });

  it('stops at anything that moves on its own', () => {
    // Past a joint the part already has something animating it, and a ring
    // that stole it would be fighting whatever that is.
    const a = Assembly.createDefault();
    a.setSize(a.rootId, [1, 1, 1]);
    const arm = a.addBoneOnFace(a.rootId, 0, BONE.ARM, { length: 2 });
    const hand = a.addBlockOnBone(arm.id, 1.75, 5, { size: [0.5, 0.5, 0.5] });
    const plate = a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE, { ringRadius: 1.75 });
    const rig = new Rig(a);
    expect(rig.nodes.get(plate.id).ring.members, 'the arm keeps its own hand')
      .not.toContain(hand.id);
    rig.dispose();
  });

  it('never tries to carry what it is standing on', () => {
    const { plate, head, rig } = podded(0.5);
    const members = rig.nodes.get(plate.id).ring.members;
    expect(members, 'its own host').not.toContain(head.id);
    expect(members, 'nor the core under it').not.toContain(rig.assembly.rootId);
    rig.dispose();
  });

  /** Head on a neck bone, with a pod on the BODY out on the plate's line. */
  const necked = (pod) => {
    const a = Assembly.createDefault();
    a.setSize(a.rootId, [1, 1, 1]);
    const neck = a.addBoneOnFace(a.rootId, 2, BONE.FACE, { length: 1 });
    const head = a.addBlockOnBone(neck.id, 1, 4, { size: [1, 1, 1] });
    const ball = a.addBlock(a.rootId, { pos: pod }, 1, { size: [0.5, 0.5, 0.5] });
    const plate = a.addEquipOnFace(head.id, 2, EQUIP.CIRCLE, { ringRadius: 2 });
    return { a, ball, plate, rig: new Rig(a) };
  };

  it('reaches back past a joint for something above it', () => {
    // A plate on a head that nods, and a pod bolted to the body two metres
    // out on its line. Nothing here is being stolen from the neck: the pod
    // simply gets carried by the neck as well once the ring has it, which
    // is what being bolted to a ring on a nodding head should look like.
    // It read as "the gimmick does not work" for as long as the search
    // stopped at the neck.
    const { ball, plate, rig } = necked([2, 2, 0]);
    expect(rig.nodes.get(plate.id).ring.members, 'out on the line').toContain(ball.id);

    rig.root.updateMatrixWorld(true);
    const before = rig.nodes.get(ball.id).group.getWorldPosition(new THREE.Vector3());
    expect(before.x, 'and it did not jump on the way in').toBeCloseTo(2, 5);
    expect(before.y).toBeCloseTo(2, 5);
    rig.updateRollers(0.5);
    rig.root.updateMatrixWorld(true);
    const after = rig.nodes.get(ball.id).group.getWorldPosition(new THREE.Vector3());
    expect(after.distanceTo(before), 'and then it goes round').toBeGreaterThan(0.5);
    rig.dispose();
  });

  it('does not reach for something at the right radius but off the plane', () => {
    // Same pod, same two metres out, dropped to the height of the body. It
    // is nowhere near the line the builder can see, and a ring that grabbed
    // it anyway would be answering a question nobody asked.
    const { ball, plate, rig } = necked([2, -1, 0]);
    expect(rig.nodes.get(plate.id).ring.members).not.toContain(ball.id);
    rig.dispose();
  });

  it('a block sitting flush against the plate is on the line', () => {
    // The commonest placement there is, and the one that lands exactly on
    // the boundary: the block's underside and the ring's plane are the same
    // surface. It has to come out ON, not one float away from it.
    const a = Assembly.createDefault();
    a.setSize(a.rootId, [4, 0.5, 4]);
    const flush = a.addBlockOnFace(a.rootId, 2, 5, { size: [0.5, 0.5, 0.5] });
    a.setMount(flush.id, { pos: [1.5, 0.5, 0] });
    const plate = a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE, { ringRadius: 1.5 });
    const rig = new Rig(a);
    expect(rig.nodes.get(plate.id).ring.members).toContain(flush.id);
    rig.dispose();
  });
});

describe('the machines that ship with a circle', () => {
  it('POGO’s bits ride its circle rather than hanging in the air', () => {
    // A preset is the first thing anyone sees the gimmick in, so it has to
    // be a build that works: the plate on the cap, the bits sat on its line,
    // and both of them going round when the machine is standing still.
    const a = PRESETS.hopper.build();
    const plate = [...a.parts.values()].find((p) => p.equipType === EQUIP.CIRCLE);
    expect(plate, 'the preset fits one').toBeTruthy();

    const rig = new Rig(a);
    const ring = rig.nodes.get(plate.id).ring;
    expect(ring.members, 'both bits are on the line').toHaveLength(2);

    rig.root.updateMatrixWorld(true);
    const at = () => ring.members.map((id) =>
      rig.nodes.get(id).group.getWorldPosition(new THREE.Vector3()));
    const before = at();
    rig.updateRollers(0.4);
    rig.root.updateMatrixWorld(true);
    at().forEach((after, i) => {
      expect(after.distanceTo(before[i]), `bit ${i} travelled`).toBeGreaterThan(0.5);
      expect(after.y, `bit ${i} stayed level`).toBeCloseTo(before[i].y, 5);
    });
    rig.dispose();
  });
});

describe('a blade lights everything joined to it', () => {
  const built = () => {
    const a = Assembly.createDefault();
    const wing = a.addBlockOnFace(a.rootId, 0, 5, { size: [1, 0.5, 1] });
    const tip = a.addBlockOnFace(wing.id, 0, 5, { size: [0.75, 0.5, 0.75] });
    a.addBlockOnFace(tip.id, 0, 5, { size: [0.5, 0.5, 0.5] });
    const arm = a.addBoneOnFace(wing.id, 3, BONE.ARM, { length: 1 });
    const past = a.addBlockOnBone(arm.id, 0.8, 5, { size: [0.5, 0.5, 0.5] });
    const blade = a.addEquipOnFace(wing.id, 2, EQUIP.BLADE, { size: 0.6 });
    return { a, blade, past, rig: new Rig(a) };
  };

  it('wraps the whole connected run of blocks', () => {
    const { blade, rig } = built();
    const glow = rig.nodes.get(blade.id).bladeGlow;
    expect(glow.meshes, 'the block it is on, and the two joined to it').toHaveLength(3);
    rig.dispose();
  });

  it('stops at a bone, because past a joint it is a different limb', () => {
    const { blade, past, rig } = built();
    const glow = rig.nodes.get(blade.id).bladeGlow;
    const beyond = rig.nodes.get(past.id);
    expect(glow.meshes.some((m) => m.parent === (beyond.spin ?? beyond.group))).toBe(false);
    rig.dispose();
  });

  it('lights and dims as one thing', () => {
    const { blade, rig } = built();
    const glow = rig.nodes.get(blade.id).bladeGlow;
    rig.setBladeGlow(1);
    expect(glow.meshes.every((m) => m.visible)).toBe(true);
    expect(glow.material.opacity).toBeGreaterThan(0.4);
    rig.setBladeGlow(0);
    expect(glow.meshes.some((m) => m.visible)).toBe(false);
    rig.dispose();
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
