import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  Assembly, computeStats, gaitFor, countLimbs, PRESETS,
  defaultMount, faceAnchor, boneAnchor, alignYToFace, _resetIds,
} from '../src/core/Assembly.js';
import { BONE, SIZE_MIN, SIZE_MAX, BONE_LENGTH_MAX, BONE_RADIUS_MAX } from '../src/core/constants.js';
import { STANDARD_COLORS } from '../src/core/Palette.js';

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
      } else {
        expect(q.size).toEqual(p.size);
        expect(q.vox.solid).toBe(p.vox.solid);
      }
    });
  });

  it('declares its format', () => {
    const json = a.toJSON();
    expect(json.format).toBe('brostom.assembly');
    expect(json.version).toBe(3);
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
