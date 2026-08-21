import { BONE, BONE_GAUGE, FACE_OPPOSITE } from './constants.js';
import { createVoxels, bevel, encodeVoxels, decodeVoxels, voxelCount } from './Voxel.js';

// ============================================================
//  Assembly : the pure-data description of a robot.
//
//  A robot is a tree of parts rooted at exactly one CORE block.
//
//    core ──face──> block ──face──> block
//         └─face──> bone  ──slot──> block ──face──> block
//                        └─tip───> bone (chained joint)
//
//  A bone is the only articulated element. Its near half is rigid
//  with the parent segment; its centre is the joint; its far half
//  (and everything mounted beyond) forms a child segment.
// ============================================================

let _uid = 0;
const nextId = (prefix) => `${prefix}${(++_uid).toString(36)}`;

/**
 * mount shapes
 *   on a block/core parent : { face: 0..5, roll: 0..3 }
 *   on a bone parent       : { slot: 0..length-1, roll: 0..3 }   threaded on the shaft
 *                          : { slot: 'tip', face: 0..5, roll }   chained off the far end
 */

export class Assembly {
  constructor(name = 'NEW ROBO') {
    this.name = name;
    this.parts = new Map();
    this.rootId = null;
  }

  // ---------------------------------------------------------- creation

  static createDefault() {
    const a = new Assembly('CORE ONLY');
    a.addCore();
    return a;
  }

  addCore() {
    const core = {
      id: nextId('c'),
      kind: 'core',
      parent: null,
      mount: null,
      children: [],
      vox: bevel(createVoxels(0), 2), // silver, chamfered
      label: 'CORE',
    };
    this.parts.set(core.id, core);
    this.rootId = core.id;
    return core;
  }

  get core() { return this.parts.get(this.rootId); }
  get(id) { return this.parts.get(id); }
  get size() { return this.parts.size; }
  list() { return [...this.parts.values()]; }

  addBlock(parentId, mount, colorIndex = 2) {
    const parent = this.parts.get(parentId);
    if (!parent) return null;
    const part = {
      id: nextId('b'),
      kind: 'block',
      parent: parentId,
      mount,
      children: [],
      vox: createVoxels(colorIndex),
      label: 'BLOCK',
    };
    this.parts.set(part.id, part);
    parent.children.push(part.id);
    return part;
  }

  addBone(parentId, mount, boneType = BONE.LEG, opts = {}) {
    const parent = this.parts.get(parentId);
    if (!parent) return null;
    const part = {
      id: nextId('n'),
      kind: 'bone',
      parent: parentId,
      mount,
      children: [],
      boneType,
      gauge: opts.gauge ?? 'thick',
      length: Math.max(2, Math.min(8, opts.length ?? 3)),
      limit: opts.limit ?? 70,          // joint travel, degrees
      invert: opts.invert ?? false,     // mirror the animator's swing
      custom: opts.custom ?? { axis: 'x', amp: 30, freq: 1.0, phase: 0, source: 'time' },
      label: 'BONE',
    };
    this.parts.set(part.id, part);
    parent.children.push(part.id);
    return part;
  }

  /** Remove a part and everything mounted on it. Never removes the core. */
  remove(id) {
    const part = this.parts.get(id);
    if (!part || part.kind === 'core') return false;
    const stack = [id];
    const doomed = [];
    while (stack.length) {
      const cur = this.parts.get(stack.pop());
      if (!cur) continue;
      doomed.push(cur.id);
      stack.push(...cur.children);
    }
    for (const d of doomed) this.parts.delete(d);
    const parent = this.parts.get(part.parent);
    if (parent) parent.children = parent.children.filter((c) => c !== id);
    return true;
  }

  // ---------------------------------------------------------- queries

  /** Every part on the path from the core down to `id`, inclusive. */
  ancestry(id) {
    const out = [];
    let cur = this.parts.get(id);
    while (cur) { out.unshift(cur); cur = cur.parent ? this.parts.get(cur.parent) : null; }
    return out;
  }

  /** Depth-first walk from the core. */
  walk(fn, id = this.rootId, depth = 0) {
    const part = this.parts.get(id);
    if (!part) return;
    fn(part, depth);
    for (const c of part.children) this.walk(fn, c, depth + 1);
  }

  /** Is this block face already taken by a child? */
  isFaceOccupied(partId, face) {
    const part = this.parts.get(partId);
    if (!part) return true;
    // A block also blocks the face it is mounted through.
    if (part.mount && part.mount.face !== undefined && part.mount.slot === undefined) {
      if (FACE_OPPOSITE[part.mount.face] === face) return true;
    }
    return part.children.some((c) => {
      const ch = this.parts.get(c);
      return ch.mount && ch.mount.slot === undefined && ch.mount.face === face;
    });
  }

  isSlotOccupied(boneId, slot) {
    const bone = this.parts.get(boneId);
    if (!bone) return true;
    return bone.children.some((c) => this.parts.get(c).mount?.slot === slot);
  }

  /** Bones grouped by attribute, in stable tree order. */
  bonesByType(type) {
    const out = [];
    this.walk((p) => { if (p.kind === 'bone' && p.boneType === type) out.push(p); });
    return out;
  }

  // ---------------------------------------------------------- serialisation

  toJSON() {
    const parts = [];
    this.walk((p) => {
      const o = { id: p.id, kind: p.kind, parent: p.parent, mount: p.mount };
      if (p.kind === 'bone') {
        Object.assign(o, {
          boneType: p.boneType, gauge: p.gauge, length: p.length,
          limit: p.limit, invert: p.invert, custom: p.custom,
        });
      } else {
        o.vox = encodeVoxels(p.vox);
      }
      parts.push(o);
    });
    return { format: 'brostom.assembly', version: 1, name: this.name, root: this.rootId, parts };
  }

  static fromJSON(data) {
    const a = new Assembly(data.name ?? 'ROBO');
    a.parts.clear();
    a.rootId = data.root;
    for (const o of data.parts) {
      const part = { ...o, children: [] };
      if (o.kind === 'bone') delete part.vox;
      else part.vox = decodeVoxels(o.vox);
      a.parts.set(part.id, part);
      // keep the uid counter ahead of any loaded id
      const n = parseInt(String(o.id).slice(1), 36);
      if (Number.isFinite(n) && n > _uid) _uid = n;
    }
    for (const p of a.parts.values()) {
      if (p.parent && a.parts.has(p.parent)) a.parts.get(p.parent).children.push(p.id);
    }
    return a;
  }

  clone() { return Assembly.fromJSON(JSON.parse(JSON.stringify(this.toJSON()))); }
}

// ============================================================
//  Derived combat / motion statistics
// ============================================================

const VOX_TOTAL = 8 * 8 * 8;

/**
 * Everything the ZMF body and the animators need to know about a build.
 * Mass, thrust and agility all fall out of what the player actually built —
 * this is the single place where "heavy" and "light" get their meaning.
 */
export function computeStats(assembly, rig = null) {
  let blockCount = 0;
  let voxelSolid = 0;
  let boneMass = 0;
  const bones = { leg: 0, arm: 0, face: 0, custom: 0 };

  assembly.walk((p) => {
    if (p.kind === 'bone') {
      const meta = BONE_GAUGE[p.gauge] ?? BONE_GAUGE.thick;
      boneMass += p.length * 0.28 * meta.massScale;
      bones[p.boneType] = (bones[p.boneType] ?? 0) + 1;
    } else {
      blockCount++;
      voxelSolid += voxelCount(p.vox);
    }
  });

  // A leg is a CHAIN of leg bones, not a single bone: thigh + shin is still
  // one leg. The gait therefore counts limbs, which is what "1 leg / 2 legs /
  // 3+ legs" means to anyone actually building a robot.
  const limbs = countLimbs(assembly);

  // A full 1x1x1 block weighs 1.0; carving it out makes it genuinely lighter.
  const blockMass = voxelSolid / VOX_TOTAL;
  const mass = Math.max(0.8, blockMass + boneMass);

  // Density: how much of the occupied lattice is actually solid. Hollowed,
  // skeletal builds are nimble; packed bricks are ponderous.
  const density = blockCount ? voxelSolid / (blockCount * VOX_TOTAL) : 1;

  // Thrust comes from BLOCKS — each one carries engine volume — while mass
  // comes from solid voxels. That is the lever the sculpt tools pull on:
  // hollow a block out and it keeps its thrust but sheds its weight.
  const thrust = 30 + blockCount * 34 + limbs * 8;
  const thrustToMass = thrust / mass;

  // Radius of gyration from the rig, if we have one (falls back to a guess).
  let extent = 1.2;
  if (rig) extent = Math.max(0.8, rig.boundingRadius);
  else extent = 0.8 + Math.cbrt(blockCount) * 0.55;

  const inertia = mass * extent * extent * 0.42;

  return {
    blockCount,
    voxelSolid,
    mass,
    density,
    extent,
    inertia,
    thrust,
    thrustToMass,
    legs: limbs,
    legBones: bones.leg,
    arms: bones.arm,
    faces: bones.face,
    customs: bones.custom,
    gait: gaitFor(limbs),
    // 0 = feather, 1 = tank. Drives ZMF drag, spool and camera weight.
    weightClass: clamp01((mass - 2) / 26),
    agility: clamp01((thrustToMass - 18) / 42),
  };
}

export function gaitFor(legs) {
  if (legs <= 0) return 'hover';
  if (legs === 1) return 'hop';
  if (legs === 2) return 'walk';
  return 'skitter';
}

/** Leg bones that have no leg bone above them: one per actual leg. */
export function countLimbs(assembly) {
  let n = 0;
  const hasLegAncestor = (part) => {
    let cur = part.parent ? assembly.get(part.parent) : null;
    while (cur) {
      if (cur.kind === 'bone' && cur.boneType === BONE.LEG) return true;
      cur = cur.parent ? assembly.get(cur.parent) : null;
    }
    return false;
  };
  assembly.walk((p) => {
    if (p.kind === 'bone' && p.boneType === BONE.LEG && !hasLegAncestor(p)) n++;
  });
  return n;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ============================================================
//  Presets — the editor ships with something already walking.
// ============================================================

export function presetBiped() {
  const a = new Assembly('STRIDER');
  const core = a.addCore();

  // --- torso
  const chest = a.addBlock(core.id, { face: 2, roll: 0 }, 1);   // +Y
  const waist = a.addBlock(core.id, { face: 3, roll: 0 }, 2);   // -Y

  const head = a.addBone(chest.id, { face: 2, roll: 0 }, BONE.FACE, { length: 2, gauge: 'thin' });
  a.addBlock(head.id, { slot: 1, roll: 0 }, 4);

  // --- shoulders + arms
  for (const face of [0, 1]) {
    const shoulder = a.addBlock(chest.id, { face, roll: 0 }, 1);
    const arm = a.addBone(shoulder.id, { face: 3, roll: 0 }, BONE.ARM, { length: 3, gauge: 'thin' });
    a.addBlock(arm.id, { slot: 2, roll: 0 }, 5);
  }

  // --- hips + legs (thigh, knee block, shin, foot block)
  for (const face of [0, 1]) {
    const hip = a.addBlock(waist.id, { face, roll: 0 }, 2);
    const thigh = a.addBone(hip.id, { face: 3, roll: 0 }, BONE.LEG, { length: 2 });
    a.addBlock(thigh.id, { slot: 1, roll: 0 }, 1);
    const shin = a.addBone(thigh.id, { slot: 'tip', face: 2, roll: 0 }, BONE.LEG, { length: 2, gauge: 'thin' });
    a.addBlock(shin.id, { slot: 1, roll: 0 }, 2);
  }

  return a;
}

export function presetHopper() {
  const a = new Assembly('POGO');
  const core = a.addCore();

  const leg = a.addBone(core.id, { face: 3, roll: 0 }, BONE.LEG, { length: 3 });
  a.addBlock(leg.id, { slot: 2, roll: 0 }, 6);

  const eye = a.addBone(core.id, { face: 4, roll: 0 }, BONE.FACE, { length: 2, gauge: 'thin' });
  a.addBlock(eye.id, { slot: 1, roll: 0 }, 15);

  const hood = a.addBlock(core.id, { face: 2, roll: 0 }, 5);
  for (const face of [0, 1]) {
    const pod = a.addBlock(hood.id, { face, roll: 0 }, 2);
    const arm = a.addBone(pod.id, { face: 3, roll: 0 }, BONE.ARM, { length: 2, gauge: 'thin' });
    a.addBlock(arm.id, { slot: 1, roll: 0 }, 5);
  }
  return a;
}

export function presetSkitter() {
  const a = new Assembly('CRAWLER');
  const core = a.addCore();
  const spine = a.addBlock(core.id, { face: 5, roll: 0 }, 1);   // -Z, the abdomen

  const head = a.addBone(core.id, { face: 4, roll: 0 }, BONE.FACE, { length: 2, gauge: 'thin' });
  a.addBlock(head.id, { slot: 1, roll: 0 }, 12);

  // four legs, hung off outriggers so they actually point at the floor
  for (const host of [core, spine]) {
    for (const face of [0, 1]) {
      const outrigger = a.addBlock(host.id, { face, roll: 0 }, 2);
      const leg = a.addBone(outrigger.id, { face: 3, roll: 0 }, BONE.LEG, { length: 2, gauge: 'thin' });
      a.addBlock(leg.id, { slot: 1, roll: 0 }, 8);
    }
  }

  const tail = a.addBone(spine.id, { face: 5, roll: 0 }, BONE.CUSTOM, {
    length: 3, gauge: 'thin', custom: { axis: 'x', amp: 24, freq: 1.6, phase: 0, source: 'speed' },
  });
  a.addBlock(tail.id, { slot: 2, roll: 0 }, 15);
  return a;
}

export const PRESETS = {
  biped: { label: '2脚 STRIDER', build: presetBiped },
  hopper: { label: '1脚 POGO', build: presetHopper },
  skitter: { label: '4脚 CRAWLER', build: presetSkitter },
  core: { label: 'コアのみ', build: () => Assembly.createDefault() },
};
