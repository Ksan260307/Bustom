import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  Assembly, computeStats, gaitFor, countLimbs, PRESETS,
  PRESET_LIST, SIZE_CLASSES, presetsOfSize,
  defaultMount, faceAnchor, boneAnchor, alignYToFace, _resetIds,
} from '../src/core/Assembly.js';
import {
  BONE, SIZE_MIN, SIZE_MAX, BONE_LENGTH_MAX, BONE_RADIUS_MAX,
  EQUIP, EQUIP_META, EQUIP_SIZE_MIN, EQUIP_SIZE_MAX, equipShape,
  SPIN_RPM_MIN, SPIN_RPM_MAX, CUSTOM_DEFAULT, BONE_GAIN_MAX, BONE_LAG_MAX,
  CIRCLE_RADIUS_DEFAULT,
} from '../src/core/constants.js';
import { STANDARD_COLORS } from '../src/core/Palette.js';
import { SHAPE, SHAPE_DEFAULT, shapeMask } from '../src/core/Shapes.js';
import { Rig } from '../src/core/Rig.js';

let a;
beforeEach(() => {
  _resetIds(0);
  a = Assembly.createDefault();
});

const at = (x, y, z) => ({ pos: [x, y, z] });

describe('Assembly structure', () => {
  it('starts as a single core that is also the root', () => {
    expect(a.size).toBe(1);
    expect(a.core.kind).toBe('core');
    expect(a.core.id).toBe(a.rootId);
    expect(a.core.size).toEqual([1, 1, 1]);
    expect(a.core.mount).toBeNull();
  });

  it('the core is chamfered, not a raw cube', () => {
    expect(a.core.vox.solid).toBeLessThan(a.core.vox.total);
    expect(a.core.vox.get(0, 0, 0)).toBe(0);
  });

  it('adds blocks and bones as children', () => {
    const b = a.addBlock(a.rootId, at(0, 1, 0));
    const n = a.addBone(a.rootId, at(0, -0.5, 0), BONE.LEG);
    expect(a.size).toBe(3);
    expect(a.core.children).toEqual([b.id, n.id]);
    expect(b.parent).toBe(a.rootId);
    expect(n.boneType).toBe(BONE.LEG);
  });

  it('refuses to attach to a part that does not exist', () => {
    expect(a.addBlock('nope', at(0, 1, 0))).toBeNull();
    expect(a.addBone('nope', at(0, 1, 0), BONE.ARM)).toBeNull();
  });

  it('clamps bone geometry into the legal range', () => {
    const n = a.addBone(a.rootId, at(0, 0, 0), BONE.LEG, { length: 999, radius: 99 });
    expect(n.length).toBe(BONE_LENGTH_MAX);
    expect(n.radius).toBe(BONE_RADIUS_MAX);
  });

  it('snaps new block sizes onto the 0.25 grid', () => {
    const b = a.addBlock(a.rootId, at(0, 1, 0), 1, { size: [1.13, 99, -4] });
    expect(b.size).toEqual([1.25, SIZE_MAX, SIZE_MIN]);
  });

  it('defaultMount is a free transform, not a socket', () => {
    expect(defaultMount()).toEqual({ pos: [0, 0, 0], rot: [0, 0, 0, 1] });
    expect(defaultMount({ pos: [1, 2, 3] }).rot).toEqual([0, 0, 0, 1]);
  });

  it('a part can float free of everything it is attached to', () => {
    const bit = a.addBlock(a.rootId, at(3, 2.5, -1.5), 15, { size: [0.5, 0.5, 0.5] });
    expect(bit.mount.pos).toEqual([3, 2.5, -1.5]);
    expect(bit.parent).toBe(a.rootId);   // still rides the core segment
  });
});

describe('anchor helpers', () => {
  it('faceAnchor puts a child flush against a face', () => {
    a.setSize(a.rootId, [2, 2, 2]);
    expect(faceAnchor(a.core, 0, [1, 1, 1])).toEqual([1.5, 0, 0]);   // +X
    expect(faceAnchor(a.core, 3, [1, 1, 1])).toEqual([0, -1.5, 0]);  // -Y
  });

  it('faceAnchor with no child size lands exactly on the surface', () => {
    expect(faceAnchor(a.core, 2)).toEqual([0, 0.5, 0]);
  });

  it('boneAnchor runs along the shaft', () => {
    expect(boneAnchor(1.5)).toEqual([0, 1.5, 0]);
  });

  it('alignYToFace points a bone down the face normal', () => {
    const down = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(new THREE.Quaternion().fromArray(alignYToFace(3)));
    expect(down.y).toBeCloseTo(-1, 6);

    const right = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(new THREE.Quaternion().fromArray(alignYToFace(0)));
    expect(right.x).toBeCloseTo(1, 6);
  });

  it('the convenience builders use them', () => {
    const b = a.addBlockOnFace(a.rootId, 2, 1, { size: [1, 1, 1] });
    expect(b.mount.pos).toEqual([0, 1, 0]);

    const n = a.addBoneOnFace(a.rootId, 3, BONE.LEG, { length: 2 });
    expect(n.mount.pos).toEqual([0, -0.5, 0]);

    const tip = a.addBoneOnTip(n.id, BONE.LEG, { length: 1 });
    expect(tip.mount.pos).toEqual([0, 2, 0]);   // the far end of a length-2 bone
    expect(a.addBoneOnTip(b.id, BONE.LEG)).toBeNull();  // blocks have no tip
  });
});

describe('Assembly removal', () => {
  it('removes a subtree in one go', () => {
    const b = a.addBlock(a.rootId, at(0, 1, 0));
    const n = a.addBone(b.id, at(0, 0.5, 0), BONE.ARM);
    a.addBlock(n.id, at(0, 1, 0));
    expect(a.size).toBe(4);
    expect(a.remove(b.id)).toBe(true);
    expect(a.size).toBe(1);
    expect(a.core.children).toEqual([]);
  });

  it('never removes the core', () => {
    expect(a.remove(a.rootId)).toBe(false);
    expect(a.size).toBe(1);
  });

  it('subtree() lists the part and everything under it', () => {
    const b = a.addBlock(a.rootId, at(0, 1, 0));
    const c = a.addBlock(b.id, at(0, 1, 0));
    expect(a.subtree(b.id).sort()).toEqual([b.id, c.id].sort());
  });
});

describe('free placement', () => {
  it('setMount writes both position and rotation', () => {
    const b = a.addBlock(a.rootId, at(0, 1, 0));
    expect(a.setMount(b.id, { pos: [1.5, -2, 0.25] })).toBe(true);
    expect(b.mount.pos).toEqual([1.5, -2, 0.25]);
    a.setMount(b.id, { rot: [0, 0.7071, 0, 0.7071] });
    expect(b.mount.rot[1]).toBeCloseTo(0.7071, 4);
  });

  it('setMount refuses the core, which has no mount', () => {
    expect(a.setMount(a.rootId, { pos: [1, 0, 0] })).toBe(false);
  });

  it('translate shifts by a delta', () => {
    const b = a.addBlock(a.rootId, at(0, 1, 0));
    a.translate(b.id, [0.25, 0, -0.5]);
    expect(b.mount.pos).toEqual([0.25, 1, -0.5]);
  });

  it('accepts positions far from everything, with no snapping or clamping', () => {
    const b = a.addBlock(a.rootId, at(0, 0, 0));
    a.setMount(b.id, { pos: [12.345, -7.5, 0.001] });
    expect(b.mount.pos).toEqual([12.345, -7.5, 0.001]);
  });
});

describe('reparenting', () => {
  it('moves a part and its subtree onto another segment', () => {
    const left = a.addBlock(a.rootId, at(-1, 0, 0));
    const right = a.addBlock(a.rootId, at(1, 0, 0));
    const arm = a.addBone(left.id, at(0, 0.5, 0), BONE.ARM);
    const hand = a.addBlock(arm.id, at(0, 1, 0));

    expect(a.reparent(arm.id, right.id)).toBe(true);
    expect(a.get(arm.id).parent).toBe(right.id);
    expect(left.children).toEqual([]);
    expect(right.children).toEqual([arm.id]);
    expect(a.get(hand.id).parent).toBe(arm.id);
    expect(a.size).toBe(5);
  });

  it('keeps the mount unless a new one is given', () => {
    const b = a.addBlock(a.rootId, at(0, 1, 0));
    const c = a.addBlock(a.rootId, at(0, -1, 0));
    a.reparent(c.id, b.id);
    expect(c.mount.pos).toEqual([0, -1, 0]);
    a.reparent(c.id, a.rootId, { pos: [2, 0, 0] });
    expect(c.mount.pos).toEqual([2, 0, 0]);
  });

  it('refuses the core, itself, and its own descendants', () => {
    const b = a.addBlock(a.rootId, at(0, 1, 0));
    const c = a.addBlock(b.id, at(0, 1, 0));
    expect(a.reparent(a.rootId, b.id)).toBe(false);
    expect(a.reparent(b.id, b.id)).toBe(false);
    expect(a.reparent(b.id, c.id)).toBe(false);
    expect(a.canReparent(b.id, c.id)).toBe(false);
    expect(a.canReparent(b.id, a.rootId)).toBe(true);
    expect(a.get(b.id).parent).toBe(a.rootId);
  });

  it('refuses an unknown destination', () => {
    const b = a.addBlock(a.rootId, at(0, 1, 0));
    expect(a.reparent(b.id, 'nope')).toBe(false);
  });
});

describe('part documents', () => {
  it('createPart is rooted at an ordinary block, not a core', () => {
    const doc = Assembly.createPart('SHIELD');
    expect(doc.name).toBe('SHIELD');
    expect(doc.size).toBe(1);
    expect(doc.core.kind).toBe('block');
    expect(doc.core.mount).toBeNull();
    expect(doc.isPart).toBe(true);
    expect(Assembly.createDefault().isPart).toBe(false);
  });

  it('a part document root cannot be removed either', () => {
    const doc = Assembly.createPart();
    expect(doc.remove(doc.rootId)).toBe(false);
    expect(doc.size).toBe(1);
  });

  it('round-trips through JSON like any other document', () => {
    const doc = Assembly.createPart('POD');
    doc.addBlockOnFace(doc.rootId, 2, 5, { size: [0.5, 0.5, 0.5] });
    const copy = Assembly.fromJSON(JSON.parse(JSON.stringify(doc.toJSON())));
    expect(copy.size).toBe(2);
    expect(copy.core.kind).toBe('block');
    expect(copy.core.mount).toBeNull();
  });
});

describe('extract', () => {
  it('lifts a subtree into a standalone document', () => {
    const b = a.addBlockOnFace(a.rootId, 2);
    const bone = a.addBoneOnFace(b.id, 2, BONE.ARM, { length: 2 });
    a.addBlockOnBone(bone.id, 1.5, 5);

    const doc = a.extract(b.id);
    expect(doc.size).toBe(3);
    expect(doc.rootId).toBe(b.id);
    expect(doc.core.mount, 'the new root has no mount').toBeNull();
    expect(doc.get(bone.id).parent).toBe(b.id);
    // the original is untouched
    expect(a.size).toBe(4);
    expect(a.get(b.id).mount).toBeTruthy();
  });

  it('carries only the colours it uses, remapped', () => {
    const custom = a.palette.ensure(0x123456);
    a.palette.ensure(0xabcdef);            // used by nothing
    const b = a.addBlockOnFace(a.rootId, 2, custom);

    const doc = a.extract(b.id);
    expect(doc.palette.indexOf(0x123456)).toBeGreaterThanOrEqual(0);
    expect(doc.palette.indexOf(0xabcdef)).toBe(-1);
    // the voxels point at the new index
    const idx = doc.palette.indexOf(0x123456);
    expect([...doc.core.vox.usedColors()]).toEqual([idx]);
  });

  it('demotes a core root to a plain block', () => {
    a.addBlockOnFace(a.rootId, 2);
    const doc = a.extract(a.rootId);
    expect(doc.core.kind).toBe('block');
    expect(doc.size).toBe(2);
  });

  it('deep-copies the voxels', () => {
    const b = a.addBlockOnFace(a.rootId, 2);
    const doc = a.extract(b.id);
    doc.core.vox.clear();
    expect(b.vox.solid).toBeGreaterThan(0);
  });

  it('returns null for an unknown id', () => {
    expect(a.extract('nope')).toBeNull();
  });
});

describe('graft', () => {
  const makePart = () => {
    const doc = Assembly.createPart('POD', 5);
    const bone = doc.addBoneOnFace(doc.rootId, 2, BONE.ARM, { length: 2 });
    doc.addBlockOnBone(bone.id, 1.5, 6, { size: [0.5, 0.5, 0.5] });
    return doc;
  };

  it('inserts a whole document under a parent', () => {
    const doc = makePart();
    const root = a.graft(doc, a.rootId, { pos: [0, 2, 0] });
    expect(root).toBeTruthy();
    expect(a.size).toBe(4);
    expect(root.parent).toBe(a.rootId);
    expect(root.mount.pos).toEqual([0, 2, 0]);
    expect(root.children).toHaveLength(1);
  });

  it('regenerates ids so the same part can be grafted twice', () => {
    const doc = makePart();
    const one = a.graft(doc, a.rootId, { pos: [0, 2, 0] });
    const two = a.graft(doc, a.rootId, { pos: [0, -2, 0] });
    expect(one.id).not.toBe(two.id);
    expect(a.size).toBe(7);
    const ids = [...a.parts.keys()];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('merges the source palette and repoints the voxels', () => {
    const doc = Assembly.createPart('DOT');
    doc.palette.colors.length = 0;
    doc.palette.colors.push(0x123456);
    doc.core.vox.fill(0);

    const before = a.palette.size;
    const root = a.graft(doc, a.rootId, { pos: [1, 0, 0] });
    const idx = a.palette.indexOf(0x123456);
    expect(a.palette.size).toBe(before + 1);
    expect([...root.vox.usedColors()]).toEqual([idx]);
  });

  it('adopts the destination resolution', () => {
    const doc = makePart();
    doc.setVoxResolution(16);
    a.setVoxResolution(50);
    const root = a.graft(doc, a.rootId, { pos: [0, 2, 0] });
    expect(root.vox.n).toBe(50);
  });

  it('keeps the internal structure of the part', () => {
    const doc = makePart();
    const root = a.graft(doc, a.rootId, { pos: [0, 2, 0] });
    const bone = a.get(root.children[0]);
    expect(bone.kind).toBe('bone');
    expect(bone.boneType).toBe(BONE.ARM);
    expect(bone.length).toBe(2);
    expect(a.get(bone.children[0]).size).toEqual([0.5, 0.5, 0.5]);
  });

  it('refuses an unknown destination', () => {
    expect(a.graft(makePart(), 'nope', { pos: [0, 0, 0] })).toBeNull();
    expect(a.graft(null, a.rootId, { pos: [0, 0, 0] })).toBeNull();
  });

  it('extract then graft is a faithful round trip', () => {
    const b = a.addBlockOnFace(a.rootId, 2, 7, { size: [1.5, 0.5, 1] });
    const bone = a.addBoneOnFace(b.id, 0, BONE.LEG, { length: 3, gauge: 'thin' });
    a.addBlockOnBone(bone.id, 2.5, 9);

    const doc = a.extract(b.id);
    const copy = a.graft(doc, a.rootId, { pos: [0, -2, 0] });

    expect(copy.size).toEqual(b.size);
    expect(copy.vox.solid).toBe(b.vox.solid);
    const copiedBone = a.get(copy.children[0]);
    expect(copiedBone.boneType).toBe(BONE.LEG);
    expect(copiedBone.radius).toBeCloseTo(bone.radius, 6);
    expect(a.get(copiedBone.children[0]).mount.pos[1]).toBeCloseTo(2.5, 6);
  });
});

describe('equipment plates', () => {
  it('sticks a plate on a face, lying flat with its facing outward', () => {
    const e = a.addEquipOnFace(a.rootId, 2, EQUIP.BEAM);
    expect(e.kind).toBe('equip');
    expect(e.equipType).toBe(EQUIP.BEAM);
    expect(e.parent).toBe(a.rootId);
    expect(e.mount.pos, 'flush, with no bulk of its own').toEqual([0, 0.5, 0]);

    // its local +Y is the face normal, so the slab lies ON the surface
    const up = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(new THREE.Quaternion().fromArray(e.mount.rot));
    expect(up.y).toBeCloseTo(1, 6);
  });

  it('every weapon is round and every system is square', () => {
    for (const [type, meta] of Object.entries(EQUIP_META)) {
      expect(equipShape(type), type).toBe(meta.category === 'weapon' ? 'round' : 'square');
    }
  });

  it('clamps the plate size into the legal range', () => {
    expect(a.addEquipOnFace(a.rootId, 2, EQUIP.BEAM, { size: 99 }).size).toBe(EQUIP_SIZE_MAX);
    expect(a.addEquipOnFace(a.rootId, 3, EQUIP.BEAM, { size: -4 }).size).toBe(EQUIP_SIZE_MIN);
  });

  it('refuses an equip type it does not know', () => {
    expect(a.addEquipOnFace(a.rootId, 2, 'railgun')).toBeNull();
  });

  it('gives recolourable weapons a bullet colour and the rest none', () => {
    expect(a.addEquipOnFace(a.rootId, 2, EQUIP.BEAM).bulletColor).toBe(EQUIP_META.beam.bullet);
    expect(a.addEquipOnFace(a.rootId, 3, EQUIP.BLADE).bulletColor).toBeNull();
    expect(a.addEquipOnFace(a.rootId, 0, EQUIP.MISSILE).bulletColor).toBeNull();
  });

  it('only recolours the weapons whose table says it may', () => {
    const beam = a.addEquipOnFace(a.rootId, 2, EQUIP.BEAM);
    const blade = a.addEquipOnFace(a.rootId, 3, EQUIP.BLADE);
    expect(a.setBulletColor(beam.id, 0x6bff6b)).toBe(true);
    expect(beam.bulletColor).toBe(0x6bff6b);
    expect(a.setBulletColor(blade.id, 0x6bff6b)).toBe(false);
    expect(blade.bulletColor).toBeNull();
    expect(a.setBulletColor(a.rootId, 0x6bff6b), 'a block has no bullets').toBe(false);
  });

  it('swaps type in place, and drops the colour when the new type cannot use it', () => {
    const e = a.addEquipOnFace(a.rootId, 2, EQUIP.BEAM, { bulletColor: 0x123456 });
    expect(a.setEquipType(e.id, EQUIP.BLADE)).toBe(true);
    expect(e.equipType).toBe(EQUIP.BLADE);
    expect(e.bulletColor).toBeNull();
    a.setEquipType(e.id, EQUIP.SHOT);
    expect(e.bulletColor).toBe(EQUIP_META.shot.bullet);
  });

  it('resizes a plate but leaves it alone through setSize', () => {
    const e = a.addEquipOnFace(a.rootId, 2, EQUIP.BEAM);
    expect(a.setEquipSize(e.id, 1.2)).toBe(true);
    expect(e.size).toBeCloseTo(1.2, 6);
    expect(a.setSize(e.id, [2, 2, 2]), 'a plate is not a box').toBe(false);
    expect(e.size).toBeCloseTo(1.2, 6);
  });

  it('allows exactly one gravity plate', () => {
    expect(a.canAddEquip(EQUIP.GRAVITY)).toBe(true);
    expect(a.addEquipOnFace(a.rootId, 2, EQUIP.GRAVITY)).toBeTruthy();
    expect(a.canAddEquip(EQUIP.GRAVITY)).toBe(false);
    expect(a.addEquipOnFace(a.rootId, 3, EQUIP.GRAVITY)).toBeNull();
    expect(a.countEquip(EQUIP.GRAVITY)).toBe(1);

    // and you cannot sneak a second one in by swapping a type either
    const other = a.addEquipOnFace(a.rootId, 0, EQUIP.BOOST);
    expect(a.setEquipType(other.id, EQUIP.GRAVITY)).toBe(false);
    expect(other.equipType).toBe(EQUIP.BOOST);
  });

  it('stacks as many boosts as you like', () => {
    for (let i = 0; i < 4; i++) expect(a.addEquipOnFace(a.rootId, i, EQUIP.BOOST)).toBeTruthy();
    expect(a.countEquip(EQUIP.BOOST)).toBe(4);
  });

  it('lists what is fitted, in tree order', () => {
    a.addEquipOnFace(a.rootId, 2, EQUIP.BEAM);
    const b = a.addBlockOnFace(a.rootId, 4);
    a.addEquipOnFace(b.id, 4, EQUIP.GATLING);
    expect(a.equips().map((e) => e.equipType)).toEqual([EQUIP.BEAM, EQUIP.GATLING]);
  });

  it('has no voxels, and never trips the colour walks', () => {
    a.addEquipOnFace(a.rootId, 2, EQUIP.BEAM);
    const e = a.equips()[0];
    expect(e.vox).toBe(undefined);
    expect(() => a.usedColors()).not.toThrow();
    expect(() => a.prunePalette()).not.toThrow();
    expect(() => a.setVoxResolution(16)).not.toThrow();
  });

  it('round-trips through JSON', () => {
    a.addEquipOnFace(a.rootId, 2, EQUIP.SHOT, { size: 1.1, bulletColor: 0x6bff6b });
    a.addEquipOnFace(a.rootId, 3, EQUIP.GRAVITY);
    const copy = Assembly.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    const [shot, grav] = copy.equips();
    expect(shot.equipType).toBe(EQUIP.SHOT);
    expect(shot.size).toBeCloseTo(1.1, 6);
    expect(shot.bulletColor).toBe(0x6bff6b);
    expect(grav.equipType).toBe(EQUIP.GRAVITY);
    expect(grav.bulletColor).toBeNull();
  });

  it('a document naming an unknown plate loads as something sane', () => {
    a.addEquipOnFace(a.rootId, 2, EQUIP.BEAM);
    const json = a.toJSON();
    json.parts.find((x) => x.kind === 'equip').equipType = 'plasma-cannon-9000';
    const copy = Assembly.fromJSON(JSON.parse(JSON.stringify(json)));
    expect(copy.equips()[0].equipType).toBe(EQUIP.BEAM);
  });

  it('travels through extract and graft with the plate intact', () => {
    const arm = a.addBlockOnFace(a.rootId, 0);
    a.addEquipOnFace(arm.id, 2, EQUIP.GATLING, { size: 0.9, bulletColor: 0x6bff6b });

    const doc = a.extract(arm.id);
    expect(doc.equips()).toHaveLength(1);

    const copy = a.graft(doc, a.rootId, { pos: [0, 2, 0] });
    const grafted = a.get(copy.children[0]);
    expect(grafted.kind).toBe('equip');
    expect(grafted.equipType).toBe(EQUIP.GATLING);
    expect(grafted.size).toBeCloseTo(0.9, 6);
    expect(grafted.bulletColor).toBe(0x6bff6b);
  });

  it('grafting a unique plate the machine already carries drops it', () => {
    const pod = a.addBlockOnFace(a.rootId, 0);
    a.addEquipOnFace(pod.id, 2, EQUIP.GRAVITY);
    const doc = a.extract(pod.id);

    const copy = a.graft(doc, a.rootId, { pos: [0, 2, 0] });
    expect(copy, 'the block still lands').toBeTruthy();
    expect(copy.children, 'but without a second gravity plate').toHaveLength(0);
    expect(a.countEquip(EQUIP.GRAVITY)).toBe(1);
  });
});

describe('the rolling plate', () => {
  it('comes with a direction and a speed; the others carry none', () => {
    const r = a.addEquipOnFace(a.rootId, 2, EQUIP.ROLLING);
    expect(r.spin).toEqual({ dir: 1, rpm: EQUIP_META.rolling.rpm });
    expect(a.addEquipOnFace(a.rootId, 3, EQUIP.BOOST).spin).toBeNull();
    expect(a.addEquipOnFace(a.rootId, 0, EQUIP.BEAM).spin).toBeNull();
  });

  it('takes the direction and speed it is given, within reason', () => {
    const r = a.addEquipOnFace(a.rootId, 2, EQUIP.ROLLING, { spin: { dir: -1, rpm: 90 } });
    expect(r.spin).toEqual({ dir: -1, rpm: 90 });

    a.setEquipSpin(r.id, { rpm: 99999 });
    expect(r.spin.rpm).toBe(SPIN_RPM_MAX);
    a.setEquipSpin(r.id, { rpm: 0 });
    expect(r.spin.rpm).toBe(SPIN_RPM_MIN);
    a.setEquipSpin(r.id, { dir: 0 });
    expect(r.spin.dir, 'there is no standing still').toBe(1);
  });

  it('refuses a spin on a plate that does not turn', () => {
    const b = a.addEquipOnFace(a.rootId, 2, EQUIP.BOOST);
    expect(a.setEquipSpin(b.id, { rpm: 200 })).toBe(false);
    expect(a.setEquipSpin(a.rootId, { rpm: 200 })).toBe(false);
  });

  it('gains its spin when swapped in, and loses it when swapped out', () => {
    const e = a.addEquipOnFace(a.rootId, 2, EQUIP.BOOST);
    a.setEquipType(e.id, EQUIP.ROLLING);
    expect(e.spin).toEqual({ dir: 1, rpm: EQUIP_META.rolling.rpm });
    a.setEquipType(e.id, EQUIP.GRAVITY);
    expect(e.spin).toBeNull();
  });

  it('is a system plate, so it is square and has no bullets', () => {
    expect(equipShape(EQUIP.ROLLING)).toBe('square');
    expect(EQUIP_META.rolling.category).toBe('system');
    expect(a.addEquipOnFace(a.rootId, 2, EQUIP.ROLLING).bulletColor).toBeNull();
  });

  it('round-trips, and survives a nonsense saved spin', () => {
    a.addEquipOnFace(a.rootId, 2, EQUIP.ROLLING, { spin: { dir: -1, rpm: 150 } });
    const json = a.toJSON();
    expect(Assembly.fromJSON(JSON.parse(JSON.stringify(json))).equips()[0].spin)
      .toEqual({ dir: -1, rpm: 150 });

    json.parts.find((x) => x.kind === 'equip').spin = { dir: 'left', rpm: 'fast' };
    const broken = Assembly.fromJSON(JSON.parse(JSON.stringify(json)));
    expect(broken.equips()[0].spin.dir).toBe(1);
    expect(Number.isFinite(broken.equips()[0].spin.rpm)).toBe(true);
  });

  it('carries its spin through extract and graft', () => {
    const pod = a.addBlockOnFace(a.rootId, 0);
    a.addEquipOnFace(pod.id, 2, EQUIP.ROLLING, { spin: { dir: -1, rpm: 240 } });
    const copy = a.graft(a.extract(pod.id), a.rootId, { pos: [0, 2, 0] });
    expect(a.get(copy.children[0]).spin).toEqual({ dir: -1, rpm: 240 });
  });
});

describe('custom bone defaults', () => {
  it('a new custom bone has every knob the panel expects', () => {
    const n = a.addBoneOnFace(a.rootId, 2, BONE.CUSTOM);
    expect(n.custom).toEqual(CUSTOM_DEFAULT);
  });

  it('an older save missing the new knobs gets them filled in', () => {
    const n = a.addBoneOnFace(a.rootId, 2, BONE.CUSTOM);
    const json = a.toJSON();
    json.parts.find((x) => x.id === n.id).custom = { axis: 'z', amp: 45 };
    const copy = Assembly.fromJSON(JSON.parse(JSON.stringify(json)));
    const c = copy.get(n.id).custom;
    expect(c.axis, 'what was saved is kept').toBe('z');
    expect(c.amp).toBe(45);
    expect(c.wave, 'what was missing is defaulted').toBe(CUSTOM_DEFAULT.wave);
    expect(c.offset).toBe(0);
  });
});

describe('growing a block outward', () => {
  it('makes the block bigger on the face it was asked for', () => {
    a.setSize(a.rootId, [1, 1, 1]);
    expect(a.growBlock(a.rootId, 0, 1)).toBe(true);
    expect(a.core.size).toEqual([1.25, 1, 1]);
    expect(a.growBlock(a.rootId, 1, -1)).toBe(true);
    expect(a.core.size).toEqual([1.25, 1.25, 1]);
  });

  it('leaves the material exactly where it was', () => {
    const block = a.addBlockOnFace(a.rootId, 2, 3, { size: [1, 1, 1] });
    const before = [...block.mount.pos];

    a.growBlock(block.id, 0, 1);
    // The box grew 0.25 on +X, so its centre moved half of that; the mount
    // walks the same distance so the shape does not appear to slide.
    expect(block.mount.pos[0] - before[0]).toBeCloseTo(0.125, 6);
    expect(block.mount.pos[1]).toBeCloseTo(before[1], 6);

    a.growBlock(block.id, 2, -1);
    expect(block.mount.pos[2] - before[2]).toBeCloseTo(-0.125, 6);
  });

  it('does not drag whatever is bolted to it', () => {
    const block = a.addBlockOnFace(a.rootId, 2, 3, { size: [1, 1, 1] });
    const child = a.addBlockOnFace(block.id, 1, 4, { size: [0.5, 0.5, 0.5] });
    const before = [...child.mount.pos];

    a.growBlock(block.id, 0, 1);
    // the block moved +0.125, so the child moves -0.125 and stays put
    expect(child.mount.pos[0] - before[0]).toBeCloseTo(-0.125, 6);
  });

  it('the root has no mount, so its children take up the slack', () => {
    const child = a.addBlockOnFace(a.rootId, 2, 4);
    const before = [...child.mount.pos];
    a.growBlock(a.rootId, 1, 1);
    expect(a.core.mount).toBeNull();
    expect(child.mount.pos[1] - before[1]).toBeCloseTo(-0.125, 6);
  });

  it('keeps the sculpted shape, only re-gridded', () => {
    const block = a.addBlockOnFace(a.rootId, 2, 3, { size: [1, 1, 1] });
    block.vox.fill(3);
    const before = block.vox.solid;
    a.growBlock(block.id, 0, 1);
    // The old contents now cover 1/1.25 of the grid on X, so roughly that
    // share of the cells stay solid — and nothing else changed.
    expect(block.vox.solid).toBeGreaterThan(before * 0.7);
    expect(block.vox.solid).toBeLessThan(before);
    expect(block.vox.n, 'the resolution is untouched').toBe(a.voxRes);
  });

  it('a thin feature survives the re-grid rather than vanishing', () => {
    const block = a.addBlockOnFace(a.rootId, 2, 3, { size: [1, 1, 1] });
    block.vox.clear();
    const n = block.vox.n;
    // a one-cell-thick plate
    for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) block.vox.set(x, n >> 1, z, 4);
    expect(block.vox.solid).toBe(n * n);

    a.growBlock(block.id, 1, 1);
    expect(block.vox.solid, 'still a plate, not a hole').toBeGreaterThan(0);
  });

  it('stops at the maximum block size', () => {
    a.setSize(a.rootId, [SIZE_MAX, 1, 1]);
    expect(a.growBlock(a.rootId, 0, 1)).toBe(false);
    expect(a.core.size[0]).toBe(SIZE_MAX);
  });

  it('refuses parts that have no voxels to re-grid', () => {
    const bone = a.addBoneOnFace(a.rootId, 3, BONE.LEG);
    const plate = a.addEquipOnFace(a.rootId, 2, EQUIP.BEAM);
    expect(a.growBlock(bone.id, 0, 1)).toBe(false);
    expect(a.growBlock(plate.id, 0, 1)).toBe(false);
    expect(a.growBlock('nope', 0, 1)).toBe(false);
  });

  it('a grown block still serialises and reloads', () => {
    const block = a.addBlockOnFace(a.rootId, 2, 3);
    a.growBlock(block.id, 0, 1);
    a.growBlock(block.id, 1, -1);
    const copy = Assembly.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    expect(copy.get(block.id).size).toEqual(block.size);
    expect(copy.get(block.id).vox.solid).toBe(block.vox.solid);
  });
});

describe('sizing', () => {
  it('setSize snaps and rejects bones', () => {
    const b = a.addBlock(a.rootId, at(0, 1, 0));
    const n = a.addBone(a.rootId, at(0, -1, 0), BONE.LEG);
    expect(a.setSize(b.id, [2.1, 0.3, 1])).toBe(true);
    expect(b.size).toEqual([2, 0.25, 1]);
    expect(a.setSize(n.id, [2, 2, 2])).toBe(false);
  });

  it('setBoneShape clamps and rejects blocks', () => {
    const n = a.addBone(a.rootId, at(0, -1, 0), BONE.LEG, { length: 4 });
    expect(a.setBoneShape(n.id, { length: 2.5, radius: 0.3 })).toBe(true);
    expect(n.length).toBe(2.5);
    expect(n.radius).toBe(0.3);
    expect(a.setBoneShape(a.rootId, { length: 2 })).toBe(false);
  });
});

describe('palette integration', () => {
  it('collects the colours actually used', () => {
    const b = a.addBlock(a.rootId, at(0, 1, 0), 7);
    const used = a.usedColors();
    expect(used.has(7)).toBe(true);
    expect(used.has(0)).toBe(true); // core silver
    expect(b.vox.solid).toBeGreaterThan(0);
  });

  it('prunePalette drops unused custom colours and rewrites voxels', () => {
    const custom = a.palette.ensure(0x123456);
    a.palette.ensure(0x654321);              // never used
    const b = a.addBlock(a.rootId, at(0, 1, 0), custom);

    a.prunePalette();
    expect(a.palette.size).toBe(STANDARD_COLORS.length + 1);
    const newIndex = a.palette.indexOf(0x123456);
    expect(newIndex).toBe(STANDARD_COLORS.length);
    expect(b.vox.get(0, 0, 0)).toBe(newIndex + 1);
  });
});

describe('resolution switching', () => {
  it('changes every block and reports whether anything happened', () => {
    a.addBlock(a.rootId, at(0, 1, 0));
    expect(a.setVoxResolution(50)).toBe(true);
    expect(a.voxRes).toBe(50);
    a.walk((p) => { if (p.kind !== 'bone') expect(p.vox.n).toBe(50); });
    expect(a.setVoxResolution(50)).toBe(false);
  });
});

describe('serialisation', () => {
  it('round-trips a full build', () => {
    const src = PRESETS.biped.build();
    src.palette.ensure(0xabcdef);
    src.setVoxResolution(16);
    const copy = Assembly.fromJSON(JSON.parse(JSON.stringify(src.toJSON())));

    expect(copy.size).toBe(src.size);
    expect(copy.name).toBe(src.name);
    expect(copy.rootId).toBe(src.rootId);
    expect(copy.voxRes).toBe(16);
    expect(copy.palette.colors).toEqual(src.palette.colors);

    src.walk((p) => {
      const q = copy.get(p.id);
      expect(q).toBeTruthy();
      expect(q.kind).toBe(p.kind);
      expect(q.parent).toBe(p.parent);
      expect(q.children.sort()).toEqual(p.children.sort());
      if (p.mount) {
        p.mount.pos.forEach((v, i) => expect(q.mount.pos[i]).toBeCloseTo(v, 6));
        p.mount.rot.forEach((v, i) => expect(q.mount.rot[i]).toBeCloseTo(v, 6));
      }
      if (p.kind === 'bone') {
        expect(q.length).toBeCloseTo(p.length, 6);
        expect(q.radius).toBeCloseTo(p.radius, 6);
        expect(q.gain).toBeCloseTo(p.gain, 6);
        expect(q.lag).toBeCloseTo(p.lag, 6);
      } else if (p.kind === 'equip') {
        expect(q.equipType).toBe(p.equipType);
        expect(q.size).toBeCloseTo(p.size, 6);
      } else {
        expect(q.size).toEqual(p.size);
        expect(q.vox.solid).toBe(p.vox.solid);
      }
    });
  });

  it('declares its format', () => {
    const json = a.toJSON();
    expect(json.format).toBe('blostom.assembly');
    expect(json.version).toBe(4);
  });

  it('preserves a free-floating position through a save', () => {
    a.addBlock(a.rootId, at(2.5, 3, -1.25), 15, { size: [0.5, 0.5, 0.5] });
    const copy = a.clone();
    const bit = [...copy.parts.values()].find((p) => p.kind === 'block');
    expect(bit.mount.pos).toEqual([2.5, 3, -1.25]);
  });

  it('upgrades v2 socket mounts into free transforms', () => {
    const v2 = {
      format: 'brostom.assembly', version: 2, name: 'OLD', root: 'c1', voxRes: 16,
      parts: [
        { id: 'c1', kind: 'core', parent: null, mount: null, size: [1, 1, 1], vox: [1, 4096] },
        // block flush on the core's +Y face
        {
          id: 'b2', kind: 'block', parent: 'c1', size: [1, 1, 1], vox: [3, 4096],
          mount: { face: 2, roll: 0, offset: [0, 0, 0] },
        },
        // bone hanging off the core's -Y face
        {
          id: 'n3', kind: 'bone', parent: 'c1', boneType: 'leg', gauge: 'thin',
          length: 2, limit: 70, invert: false,
          custom: { axis: 'x', amp: 30, freq: 1, phase: 0, source: 'time' },
          mount: { face: 3, roll: 0, offset: [0, 0, 0] },
        },
        // block threaded onto that bone's second slot
        {
          id: 'b4', kind: 'block', parent: 'n3', size: [1, 1, 1], vox: [3, 4096],
          mount: { slot: 1, roll: 0, offset: [0, 0, 0] },
        },
      ],
    };
    const up = Assembly.fromJSON(v2);

    expect(up.get('b2').mount.pos).toEqual([0, 1, 0]);
    expect(up.get('n3').mount.pos).toEqual([0, -0.5, 0]);
    // slot 1 of a 2-slot, length-2 bone sits at 1.5 along the shaft
    expect(up.get('b4').mount.pos[1]).toBeCloseTo(1.5, 6);
    // the bone now points down
    const dir = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(new THREE.Quaternion().fromArray(up.get('n3').mount.rot));
    expect(dir.y).toBeCloseTo(-1, 6);
    expect(up.get('n3').radius).toBeGreaterThan(0);
    expect(up.get('n3').gauge).toBeUndefined();
  });

  it('carries a v2 offset into the free position', () => {
    const v2 = {
      format: 'brostom.assembly', version: 2, root: 'c1', voxRes: 16,
      parts: [
        { id: 'c1', kind: 'core', parent: null, mount: null, size: [1, 1, 1], vox: [1, 4096] },
        {
          id: 'b2', kind: 'block', parent: 'c1', size: [1, 1, 1], vox: [3, 4096],
          mount: { face: 0, roll: 0, offset: [0, 0.5, -0.25] },
        },
      ],
    };
    expect(Assembly.fromJSON(v2).get('b2').mount.pos).toEqual([1, 0.5, -0.25]);
  });

  it('clone is fully independent', () => {
    const src = PRESETS.biped.build();
    const copy = src.clone();
    copy.core.vox.clear();
    copy.name = 'OTHER';
    expect(src.core.vox.solid).toBeGreaterThan(0);
    expect(src.name).not.toBe('OTHER');
  });
});

describe('stats', () => {
  it('gaitFor maps leg count to a gait', () => {
    expect(gaitFor(0)).toBe('hover');
    expect(gaitFor(1)).toBe('hop');
    expect(gaitFor(2)).toBe('walk');
    expect(gaitFor(3)).toBe('multileg');
    expect(gaitFor(8)).toBe('multileg');
  });

  it('counts a thigh+shin chain as one leg, not two', () => {
    const hip = a.addBlockOnFace(a.rootId, 0);
    const thigh = a.addBoneOnFace(hip.id, 3, BONE.LEG, { length: 2 });
    a.addBoneOnTip(thigh.id, BONE.LEG, { length: 2 });
    expect(countLimbs(a)).toBe(1);
    expect(computeStats(a).legBones).toBe(2);
    expect(computeStats(a).gait).toBe('hop');
  });

  it('hollowing a block sheds mass but keeps thrust', () => {
    const b = a.addBlockOnFace(a.rootId, 2);
    const before = computeStats(a);
    b.vox.brush(b.vox.n / 2, b.vox.n / 2, b.vox.n / 2, b.vox.n * 0.4, 0);
    const after = computeStats(a);
    expect(after.mass).toBeLessThan(before.mass);
    expect(after.thrust).toBeCloseTo(before.thrust, 6);
    expect(after.thrustToMass).toBeGreaterThan(before.thrustToMass);
    expect(after.density).toBeLessThan(before.density);
  });

  it('scaling a block up costs more mass than it gains thrust', () => {
    const b = a.addBlockOnFace(a.rootId, 2);
    const small = computeStats(a);
    a.setSize(b.id, [2, 2, 2]);
    const big = computeStats(a);
    expect(big.mass).toBeGreaterThan(small.mass);
    expect(big.thrust).toBeGreaterThan(small.thrust);
    expect(big.thrustToMass).toBeLessThan(small.thrustToMass);
  });

  it('a detached bit still counts toward mass and thrust', () => {
    const before = computeStats(a);
    a.addBlock(a.rootId, at(4, 4, 4), 15, { size: [0.5, 0.5, 0.5] });
    const after = computeStats(a);
    expect(after.blockCount).toBe(before.blockCount + 1);
    expect(after.mass).toBeGreaterThan(before.mass);
    expect(after.thrust).toBeGreaterThan(before.thrust);
  });

  it('weight class and agility stay normalised', () => {
    for (const key of Object.keys(PRESETS)) {
      const s = computeStats(PRESETS[key].build());
      expect(s.weightClass).toBeGreaterThanOrEqual(0);
      expect(s.weightClass).toBeLessThanOrEqual(1);
      expect(s.agility).toBeGreaterThanOrEqual(0);
      expect(s.agility).toBeLessThanOrEqual(1);
      expect(Number.isFinite(s.mass)).toBe(true);
      expect(s.mass).toBeGreaterThan(0);
    }
  });

  it('a bare core is light and lively', () => {
    const s = computeStats(a);
    expect(s.blockCount).toBe(1);
    expect(s.gait).toBe('hover');
    expect(s.mass).toBeLessThan(1.5);
    expect(s.thrustToMass).toBeGreaterThan(30);
  });
});

describe('block shapes', () => {
  let a;
  beforeEach(() => { a = Assembly.createDefault(); });

  const solidRatio = (part) => part.vox.solid / part.vox.total;

  it('a new block is a box unless you ask for something else', () => {
    const plain = a.addBlockOnFace(a.rootId, 2, 5);
    expect(plain.shape).toBe(SHAPE_DEFAULT);
    expect(solidRatio(plain)).toBe(1);

    const ball = a.addBlockOnFace(a.rootId, 4, 5, { shape: SHAPE.SPHERE });
    expect(ball.shape).toBe(SHAPE.SPHERE);
    expect(solidRatio(ball)).toBeLessThan(0.6);
  });

  it('an unknown shape is quietly a box, not a broken block', () => {
    const p = a.addBlockOnFace(a.rootId, 2, 5, { shape: 'banana' });
    expect(p.shape).toBe(SHAPE_DEFAULT);
    expect(solidRatio(p)).toBe(1);
  });

  it('re-cutting replaces the contents and keeps the colour', () => {
    const p = a.addBlockOnFace(a.rootId, 2, 7);
    p.vox.brush(8, 8, 8, 4, 0);
    expect(a.setBlockShape(p.id, SHAPE.CYLINDER)).toBe(true);
    expect(p.shape).toBe(SHAPE.CYLINDER);
    expect([...p.vox.usedColors()], 'still the colour it was').toEqual([7]);
    expect(p.vox.isPristine(SHAPE.CYLINDER)).toBe(true);
  });

  it('refuses a shape it does not know, and things without voxels', () => {
    const p = a.addBlockOnFace(a.rootId, 2, 5);
    expect(a.setBlockShape(p.id, 'banana')).toBe(false);
    expect(p.shape).toBe(SHAPE_DEFAULT);
    const bone = a.addBoneOnFace(a.rootId, 3, BONE.LEG, { length: 1 });
    expect(a.setBlockShape(bone.id, SHAPE.SPHERE)).toBe(false);
  });

  it('a hollow shape weighs less than the box it fits in', () => {
    const box = Assembly.createDefault();
    box.addBlockOnFace(box.rootId, 2, 5, { size: [2, 2, 2] });
    const ball = Assembly.createDefault();
    ball.addBlockOnFace(ball.rootId, 2, 5, { size: [2, 2, 2], shape: SHAPE.SPHERE });
    // Mass already counts solid cells, so this falls out with no extra rule.
    expect(computeStats(ball).mass).toBeLessThan(computeStats(box).mass);
  });

  it('the core wears the chamfer as a shape', () => {
    expect(a.core.shape).toBe(SHAPE.BEVEL);
    expect(a.core.vox.isPristine(SHAPE.BEVEL)).toBe(true);
  });

  it('survives a save and load', () => {
    const p = a.addBlockOnFace(a.rootId, 2, 5, { shape: SHAPE.TORUS });
    const back = Assembly.fromJSON(a.toJSON());
    expect(back.get(p.id).shape).toBe(SHAPE.TORUS);
    expect(back.get(p.id).vox.solid).toBe(p.vox.solid);
  });

  it('a build saved before shapes existed loads as boxes', () => {
    a.addBlockOnFace(a.rootId, 2, 5);
    const json = a.toJSON();
    for (const o of json.parts) delete o.shape;
    const back = Assembly.fromJSON(json);
    back.walk((p) => { if (p.vox) expect(p.shape, p.id).toBe(SHAPE_DEFAULT); });
  });

  it('travels with copy and paste', () => {
    const p = a.addBlockOnFace(a.rootId, 2, 5, { shape: SHAPE.CONE });
    const doc = a.extract(p.id);
    expect(doc.core.shape).toBe(SHAPE.CONE);

    const dest = Assembly.createDefault();
    const landed = dest.graft(doc, dest.rootId, { pos: [0, 2, 0] });
    expect(landed.shape).toBe(SHAPE.CONE);
    expect(landed.vox.solid).toBe(p.vox.solid);
  });

  it('turning the resolution up re-cuts a shape rather than magnifying its steps', () => {
    const p = a.addBlockOnFace(a.rootId, 2, 5, { shape: SHAPE.SPHERE });
    a.setVoxResolution(16);
    const coarse = p.vox.solid / p.vox.total;
    a.setVoxResolution(100);
    expect(p.vox.n).toBe(100);
    expect(p.vox.isPristine(SHAPE.SPHERE), 'cut fresh at the new grid').toBe(true);
    // A resample could only ever reproduce the coarse ratio; a re-cut lands
    // closer to the real volume of a sphere.
    expect(Math.abs(p.vox.solid / p.vox.total - Math.PI / 6))
      .toBeLessThan(Math.abs(coarse - Math.PI / 6));
  });

  it('but a block someone carved is resampled, not thrown away', () => {
    const p = a.addBlockOnFace(a.rootId, 2, 5, { shape: SHAPE.SPHERE });
    p.vox.brush(8, 8, 8, 5, 0);
    const before = p.vox.solid / p.vox.total;
    a.setVoxResolution(16);
    expect(p.vox.isPristine(SHAPE.SPHERE), 'the carving is still there').toBe(false);
    expect(p.vox.solid / p.vox.total).toBeCloseTo(before, 1);
  });
});

describe('presets', () => {
  const expected = { biped: 'walk', hopper: 'hop', multileg: 'multileg', bits: 'hop', core: 'hover' };

  it('each preset builds the gait it advertises', () => {
    for (const [key, gait] of Object.entries(expected)) {
      expect(computeStats(PRESETS[key].build()).gait, key).toBe(gait);
    }
  });

  it('the multileg preset really has four legs with knees', () => {
    const s = computeStats(PRESETS.multileg.build());
    expect(s.legs).toBe(4);
    expect(s.legBones).toBe(8);   // hip + knee per leg
  });

  it('the bits preset has parts touching nothing', () => {
    const asm = PRESETS.bits.build();
    const floating = [...asm.parts.values()].filter(
      (p) => p.mount && Math.hypot(...p.mount.pos) > 1.5,
    );
    expect(floating.length).toBeGreaterThanOrEqual(6);
  });

  it('every preset can dash, because dashing needs a plate', () => {
    for (const key of Object.keys(PRESETS)) {
      if (key === 'core') continue;   // the bare core is the blank page
      const s = computeStats(PRESETS[key].build());
      expect(s.dashBonus, `${key} carries a boost plate`).toBeGreaterThan(0);
    }
  });

  it('every preset comes armed', () => {
    for (const key of Object.keys(PRESETS)) {
      if (key === 'core') continue;
      const s = computeStats(PRESETS[key].build());
      expect(s.weaponCount, `${key} has something to shoot with`).toBeGreaterThan(0);
    }
  });

  it('only the heavy one gives up flight for armour', () => {
    expect(computeStats(PRESETS.multileg.build()).noFly).toBe(true);
    for (const key of ['biped', 'hopper', 'bits']) {
      expect(computeStats(PRESETS[key].build()).noFly, key).toBe(false);
    }
  });

  it('no preset breaks the one-gravity-plate rule', () => {
    for (const key of Object.keys(PRESETS)) {
      expect(PRESETS[key].build().countEquip(EQUIP.GRAVITY), key).toBeLessThan(2);
    }
  });

  it('the biped shows off the joint attributes', () => {
    const a = PRESETS.biped.build();
    const bones = [...a.parts.values()].filter((p) => p.kind === 'bone');

    const shoulders = bones.filter((b) => b.boneType === BONE.ARM && b.gain < 1);
    expect(shoulders.length, 'an arm bone per side that takes less than the full swing')
      .toBe(2);

    const waist = bones.find((b) => b.boneType === BONE.CUSTOM);
    expect(waist, 'a waist').toBeTruthy();
    expect(waist.custom.source).toBe('stride');
    expect(waist.custom.axis).toBe('y');

    const knees = bones.filter((b) => b.boneType === BONE.LEG && b.lag > 0);
    expect(knees.length, 'shins trail their thighs').toBe(2);
  });

  it('every preset keeps its joint attributes in range', () => {
    for (const key of Object.keys(PRESETS)) {
      PRESETS[key].build().walk((p) => {
        if (p.kind !== 'bone') return;
        expect(p.gain, `${key}:${p.id}`).toBeGreaterThanOrEqual(0);
        expect(p.gain, `${key}:${p.id}`).toBeLessThanOrEqual(BONE_GAIN_MAX);
        expect(p.lag, `${key}:${p.id}`).toBeGreaterThanOrEqual(0);
        expect(p.lag, `${key}:${p.id}`).toBeLessThanOrEqual(BONE_LAG_MAX);
      });
    }
  });

  it('every preset is well formed', () => {
    for (const key of Object.keys(PRESETS)) {
      const asm = PRESETS[key].build();
      expect(asm.core).toBeTruthy();
      asm.walk((p) => {
        if (p.id === asm.rootId) return;
        expect(asm.get(p.parent), `${key}:${p.id}`).toBeTruthy();
        expect(p.mount, `${key}:${p.id}`).toBeTruthy();
        expect(p.mount.pos.every(Number.isFinite), `${key}:${p.id}`).toBe(true);
      });
    }
  });
});

describe('which way a circle lies', () => {
  it('is remembered, and defaults to the plate it is stuck to', () => {
    const plate = a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE, {});
    expect(plate.ringPlane, 'left alone, it follows the face').toBe('face');

    expect(a.setEquipRingPlane(plate.id, 'pitch')).toBe(true);
    expect(plate.ringPlane).toBe('pitch');

    const back = Assembly.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    expect(back.get(plate.id).ringPlane, 'and it survives a save').toBe('pitch');
  });

  it('refuses a plane it does not have, rather than taking it', () => {
    const plate = a.addEquipOnFace(a.rootId, 2, EQUIP.CIRCLE, {});
    expect(a.setEquipRingPlane(plate.id, 'sideways')).toBe(false);
    expect(plate.ringPlane).toBe('face');

    // A hand-edited save, or one from a version that had no planes at all.
    const json = JSON.parse(JSON.stringify(a.toJSON()));
    for (const o of json.parts) if (o.equipType === EQUIP.CIRCLE) o.ringPlane = 'nonsense';
    expect(Assembly.fromJSON(json).get(plate.id).ringPlane).toBe('face');
  });

  it('only the plates that draw a circle have one', () => {
    const roller = a.addEquipOnFace(a.rootId, 2, EQUIP.ROLLING, {});
    expect(roller.ringPlane).toBe(null);
    expect(a.setEquipRingPlane(roller.id, 'pitch')).toBe(false);
  });
});

describe('the size classes are facts, not labels', () => {
  it('has twenty machines across five classes', () => {
    expect(PRESET_LIST).toHaveLength(20);
    for (const size of SIZE_CLASSES) {
      expect(presetsOfSize(size).length, `${size} has some`).toBeGreaterThanOrEqual(3);
    }
    // Every id unique, and every one actually in a listed class.
    expect(new Set(PRESET_LIST.map((p) => p.id)).size).toBe(20);
    for (const p of PRESET_LIST) expect(SIZE_CLASSES).toContain(p.size);
  });

  it('no class overlaps the one below it, by mass', () => {
    // A class that overlaps its neighbour is a label rather than a fact —
    // and a run that escalates by size would then be escalating by nothing.
    let heaviestBelow = 0;
    for (const size of SIZE_CLASSES) {
      const masses = presetsOfSize(size).map((id) => computeStats(PRESETS[id].build()).mass);
      expect(Math.min(...masses), `the lightest ${size} outweighs everything below it`)
        .toBeGreaterThan(heaviestBelow);
      heaviestBelow = Math.max(...masses);
    }
  });

  it('spans a real range: the biggest is orders above the smallest', () => {
    const masses = PRESET_LIST.map((p) => computeStats(p.build()).mass);
    expect(Math.max(...masses)).toBeGreaterThan(Math.min(...masses) * 40);
  });

  it('every one of them is armed and can dash', () => {
    for (const p of PRESET_LIST) {
      const st = computeStats(p.build());
      expect(st.weapons.length, `${p.id} comes armed`).toBeGreaterThan(0);
      expect(st.dashBonus, `${p.id} carries a boost plate`).toBeGreaterThan(0);
    }
  });
});

describe('a preset never shows its bare core', () => {
  /**
   * Is this world point inside the solid part of some block other than the
   * core?
   *
   * Each candidate is taken back into its own local space and measured
   * against the very mask the mesher cut it with, so "inside" here means the
   * same thing it means on screen — a shape that tapers can be larger than
   * the core in every dimension and still leave its corners in the open.
   */
  const coveredBySomething = (rig, core, world) => {
    for (const [, node] of rig.nodes) {
      const p = node.part;
      if (p === core || p.kind !== 'block') continue;
      const local = node.group.worldToLocal(world.clone());
      const [sx, sy, sz] = p.size;
      const u = new THREE.Vector3(local.x / (sx / 2), local.y / (sy / 2), local.z / (sz / 2));
      if (Math.abs(u.x) > 1 || Math.abs(u.y) > 1 || Math.abs(u.z) > 1) continue;
      if (shapeMask(p.shape ?? 'box')(u.x, u.y, u.z)) return true;
    }
    return false;
  };

  /** Points on the core's own surface, corners included. */
  const surfaceOfCore = (core) => {
    const [sx, sy, sz] = core.size;
    const out = [];
    for (const x of [-1, 0, 1]) {
      for (const y of [-1, 0, 1]) {
        for (const z of [-1, 0, 1]) {
          if (!x && !y && !z) continue;
          // Just inside the surface: a point exactly on a shared face is a
          // coin toss between two blocks, and that is not what is being asked.
          out.push(new THREE.Vector3(x * sx * 0.49, y * sy * 0.49, z * sz * 0.49));
        }
      }
    }
    return out;
  };

  it('every preset covers it, from every angle', () => {
    for (const key of Object.keys(PRESETS)) {
      const a = PRESETS[key].build();
      const core = a.core;
      // The bare core IS the machine in this one; there is nothing to hide it
      // behind, and that is the point of it.
      if (a.size === 1) continue;

      const rig = new Rig(a);
      rig.root.updateMatrixWorld(true);
      const coreNode = rig.nodes.get(core.id);

      const exposed = surfaceOfCore(core)
        .map((p) => coreNode.group.localToWorld(p.clone()))
        .filter((w) => !coveredBySomething(rig, core, w));

      expect(exposed.length, `${key} leaves ${exposed.length} of 26 core points bare`)
        .toBe(0);
      rig.dispose();
    }
  });
});

