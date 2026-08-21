import * as THREE from 'three';
import {
  BONE, BONE_GAUGE, FACE_NORMAL, FACE_AXIS, DEFAULT_VOX, snapSize,
  BONE_LENGTH_MIN, BONE_LENGTH_MAX, BONE_RADIUS_MIN, BONE_RADIUS_MAX,
} from './constants.js';
import { VoxelBlock } from './VoxelBlock.js';
import { Palette } from './Palette.js';

// ============================================================
//  Assembly : the pure-data description of a robot.
//
//  A robot is a tree of parts rooted at exactly one CORE block.
//  A part's PARENT decides which rigid segment it rides with; its
//  MOUNT is a free position + rotation inside that parent's frame.
//
//  There are no sockets. A part can sit flush against its parent, or
//  float half a metre off it — which is what makes detached bits,
//  floating pods and asymmetric silhouettes possible.
//
//  Bones are still the only articulated element: the near half is rigid
//  with the parent segment, the centre is the joint, and the far half
//  (plus anything mounted past the midpoint) forms a child segment.
// ============================================================

let _uid = 0;
const nextId = (prefix) => `${prefix}${(++_uid).toString(36)}`;

/** Test seam: keeps generated ids reproducible. */
export function _resetIds(v = 0) { _uid = v; }

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * mount = { pos: [x, y, z], rot: [x, y, z, w] }
 * Both are expressed in the parent's own frame. For a bone parent that
 * frame starts at the mount face with +Y running down the shaft, so
 * `pos[1]` is simply "how far along the bone".
 */
export const defaultMount = (m = {}) => ({ pos: [0, 0, 0], rot: [0, 0, 0, 1], ...m });

/** Quaternion that points a bone's +Y shaft along a face normal. */
export function alignYToFace(face, roll = 0) {
  _v.fromArray(FACE_NORMAL[face]);
  if (_v.y < -0.9999) _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  else _q.setFromUnitVectors(UP, _v);
  if (roll) _q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, (roll * Math.PI) / 2));
  return _q.toArray();
}

/**
 * Where a child would sit if you snapped it flush against one face of a
 * block. Sockets are gone, but this is still the sensible default when the
 * builder clicks on a surface, and it keeps the presets readable.
 */
export function faceAnchor(parentPart, face, childSize = [0, 0, 0]) {
  const axis = FACE_AXIS[face];
  const n = FACE_NORMAL[face];
  const half = (parentPart.size?.[axis] ?? 1) / 2;
  const d = half + (childSize[axis] ?? 0) / 2;
  return [n[0] * d, n[1] * d, n[2] * d];
}

/** Where a child sits when threaded onto a bone, `t` units along the shaft. */
export const boneAnchor = (t) => [0, t, 0];

export class Assembly {
  constructor(name = 'NEW ROBO') {
    this.name = name;
    this.parts = new Map();
    this.rootId = null;
    this.palette = new Palette();
    /** Sculpt resolution shared by every block in the build. */
    this.voxRes = DEFAULT_VOX;
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
      size: [1, 1, 1],
      vox: new VoxelBlock(this.voxRes, 0).bevel(0.22), // silver, chamfered
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

  addBlock(parentId, mount, colorIndex = 2, opts = {}) {
    const parent = this.parts.get(parentId);
    if (!parent) return null;
    const part = {
      id: nextId('b'),
      kind: 'block',
      parent: parentId,
      mount: defaultMount(mount),
      children: [],
      size: (opts.size ?? [1, 1, 1]).map(snapSize),
      vox: new VoxelBlock(this.voxRes, colorIndex),
      label: 'BLOCK',
    };
    this.parts.set(part.id, part);
    parent.children.push(part.id);
    return part;
  }

  addBone(parentId, mount, boneType = BONE.LEG, opts = {}) {
    const parent = this.parts.get(parentId);
    if (!parent) return null;
    const gauge = BONE_GAUGE[opts.gauge] ?? BONE_GAUGE.thick;
    const part = {
      id: nextId('n'),
      kind: 'bone',
      parent: parentId,
      mount: defaultMount(mount),
      children: [],
      boneType,
      radius: clamp(opts.radius ?? gauge.radius, BONE_RADIUS_MIN, BONE_RADIUS_MAX),
      length: clamp(opts.length ?? 3, BONE_LENGTH_MIN, BONE_LENGTH_MAX),
      limit: opts.limit ?? 70,          // joint travel, degrees
      invert: opts.invert ?? false,     // mirror the animator's swing
      custom: opts.custom ?? { axis: 'x', amp: 30, freq: 1.0, phase: 0, source: 'time' },
      label: 'BONE',
    };
    this.parts.set(part.id, part);
    parent.children.push(part.id);
    return part;
  }

  /** Convenience for presets and for click-to-place: flush against a face. */
  addBlockOnFace(parentId, face, colorIndex = 2, opts = {}) {
    const parent = this.parts.get(parentId);
    if (!parent) return null;
    const size = (opts.size ?? [1, 1, 1]).map(snapSize);
    return this.addBlock(parentId, { pos: faceAnchor(parent, face, size) }, colorIndex, { ...opts, size });
  }

  addBoneOnFace(parentId, face, boneType, opts = {}) {
    const parent = this.parts.get(parentId);
    if (!parent) return null;
    return this.addBone(parentId, {
      pos: faceAnchor(parent, face),
      rot: alignYToFace(face, opts.roll ?? 0),
    }, boneType, opts);
  }

  /** Thread a block onto a bone, `t` units along the shaft. */
  addBlockOnBone(boneId, t, colorIndex = 2, opts = {}) {
    return this.addBlock(boneId, { pos: boneAnchor(t) }, colorIndex, opts);
  }

  /** Chain a bone off the far tip of another bone. */
  addBoneOnTip(boneId, boneType, opts = {}) {
    const bone = this.parts.get(boneId);
    if (!bone || bone.kind !== 'bone') return null;
    return this.addBone(boneId, {
      pos: boneAnchor(bone.length),
      rot: alignYToFace(opts.face ?? 2, opts.roll ?? 0),
    }, boneType, opts);
  }

  /** Remove a part and everything mounted on it. Never removes the core. */
  remove(id) {
    const part = this.parts.get(id);
    if (!part || part.kind === 'core') return false;
    for (const d of this.subtree(id)) this.parts.delete(d);
    const parent = this.parts.get(part.parent);
    if (parent) parent.children = parent.children.filter((c) => c !== id);
    return true;
  }

  // ---------------------------------------------------------- editing

  /** Every id at or below `id`. */
  subtree(id) {
    const out = [];
    const stack = [id];
    while (stack.length) {
      const cur = this.parts.get(stack.pop());
      if (!cur) continue;
      out.push(cur.id);
      stack.push(...cur.children);
    }
    return out;
  }

  /** Can `id` legally hang off `parentId`? */
  canReparent(id, parentId) {
    const part = this.parts.get(id);
    if (!part || !this.parts.get(parentId)) return false;
    if (part.kind === 'core') return false;
    if (id === parentId) return false;
    return !this.subtree(id).includes(parentId);
  }

  /**
   * Change which segment a part rides with, keeping its mount as given.
   * Free positioning means this is now only about ARTICULATION: what the
   * part moves with, not where it is.
   */
  reparent(id, parentId, mount = null) {
    if (!this.canReparent(id, parentId)) return false;
    const part = this.parts.get(id);
    const old = this.parts.get(part.parent);
    if (old) old.children = old.children.filter((c) => c !== id);
    part.parent = parentId;
    if (mount) part.mount = defaultMount(mount);
    this.parts.get(parentId).children.push(id);
    return true;
  }

  setMount(id, { pos, rot } = {}) {
    const part = this.parts.get(id);
    if (!part || !part.mount) return false;
    if (pos) part.mount.pos = [pos[0], pos[1], pos[2]];
    if (rot) part.mount.rot = [rot[0], rot[1], rot[2], rot[3]];
    return true;
  }

  /** Shift a part by a delta in its own parent's frame. */
  translate(id, delta) {
    const part = this.parts.get(id);
    if (!part || !part.mount) return false;
    part.mount.pos = part.mount.pos.map((v, i) => v + delta[i]);
    return true;
  }

  setSize(id, size) {
    const part = this.parts.get(id);
    if (!part || part.kind === 'bone') return false;
    part.size = size.map(snapSize);
    return true;
  }

  setBoneShape(id, { length, radius } = {}) {
    const part = this.parts.get(id);
    if (!part || part.kind !== 'bone') return false;
    if (length !== undefined) part.length = clamp(length, BONE_LENGTH_MIN, BONE_LENGTH_MAX);
    if (radius !== undefined) part.radius = clamp(radius, BONE_RADIUS_MIN, BONE_RADIUS_MAX);
    return true;
  }

  /** Change sculpt resolution for the whole build, resampling every block. */
  setVoxResolution(n) {
    if (this.voxRes === n) return false;
    this.voxRes = n;
    this.walk((p) => { if (p.kind !== 'bone') p.vox.setResolution(n, true); });
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
    for (const c of [...part.children]) this.walk(fn, c, depth + 1);
  }

  /** Bones grouped by attribute, in stable tree order. */
  bonesByType(type) {
    const out = [];
    this.walk((p) => { if (p.kind === 'bone' && p.boneType === type) out.push(p); });
    return out;
  }

  /** Palette indices referenced anywhere in the build. */
  usedColors() {
    const all = new Set();
    this.walk((p) => {
      if (p.kind === 'bone') return;
      for (const c of p.vox.usedColors()) all.add(c);
    });
    return all;
  }

  /** Drop unreferenced custom colours and rewrite every voxel index. */
  prunePalette() {
    const remap = this.palette.prune(this.usedColors());
    this.walk((p) => { if (p.kind !== 'bone') p.vox.remapColors(remap); });
    return remap;
  }

  // ---------------------------------------------------------- serialisation

  toJSON() {
    const parts = [];
    this.walk((p) => {
      const o = { id: p.id, kind: p.kind, parent: p.parent, mount: p.mount };
      if (p.kind === 'bone') {
        Object.assign(o, {
          boneType: p.boneType, radius: p.radius, length: p.length,
          limit: p.limit, invert: p.invert, custom: p.custom,
        });
      } else {
        o.size = p.size;
        o.vox = p.vox.encode();
      }
      parts.push(o);
    });
    return {
      format: 'brostom.assembly',
      version: 3,
      name: this.name,
      root: this.rootId,
      voxRes: this.voxRes,
      palette: this.palette.toJSON(),
      parts,
    };
  }

  static fromJSON(data) {
    const a = new Assembly(data.name ?? 'ROBO');
    a.parts.clear();
    a.rootId = data.root;
    a.voxRes = data.voxRes ?? DEFAULT_VOX;
    a.palette = Palette.fromJSON(data.palette);

    const raw = new Map();
    for (const o of data.parts) raw.set(o.id, o);

    for (const o of data.parts) {
      const part = { ...o, children: [] };
      if (o.kind === 'bone') {
        delete part.vox;
        // v1 builds carried a named gauge instead of a free radius
        if (part.radius === undefined) {
          part.radius = (BONE_GAUGE[o.gauge] ?? BONE_GAUGE.thick).radius;
        }
        delete part.gauge;
      } else {
        part.size = (o.size ?? [1, 1, 1]).map(snapSize);
        part.vox = VoxelBlock.decode(a.voxRes, o.vox);
      }
      part.mount = o.mount ? upgradeMount(o, raw) : null;
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

/**
 * Convert a v1/v2 socket mount (face + slot + roll + offset) into the free
 * position/rotation the current format uses. Everything a socket could
 * express is a special case of a free transform, so nothing is lost.
 */
function upgradeMount(o, raw) {
  const m = o.mount;
  if (!m) return null;
  if (m.pos) return defaultMount(m);              // already v3

  const parent = raw.get(o.parent);
  const offset = m.offset ?? [0, 0, 0];
  const isBone = o.kind === 'bone';

  if (parent?.kind === 'bone') {
    const L = parent.length ?? 3;
    let t;
    if (m.slot === 'tip') t = L;
    else {
      const slots = Math.max(1, Math.round(L));
      t = ((m.slot + 0.5) * L) / slots;
    }
    const rot = m.slot === 'tip'
      ? alignYToFace(m.face ?? 2, m.roll ?? 0)
      : (m.roll ? new THREE.Quaternion().setFromAxisAngle(UP, (m.roll * Math.PI) / 2).toArray() : [0, 0, 0, 1]);
    return defaultMount({ pos: [offset[0], t + offset[1], offset[2]], rot });
  }

  const face = m.face ?? 2;
  const parentSize = parent?.size ?? [1, 1, 1];
  const childSize = isBone ? [0, 0, 0] : (o.size ?? [1, 1, 1]);
  const pos = faceAnchor({ size: parentSize }, face, childSize);
  return defaultMount({
    pos: [pos[0] + offset[0], pos[1] + offset[1], pos[2] + offset[2]],
    rot: isBone ? alignYToFace(face, m.roll ?? 0) : [0, 0, 0, 1],
  });
}

// ============================================================
//  Derived combat / motion statistics
// ============================================================

/**
 * Everything the ZMF body and the animators need to know about a build.
 * Mass, thrust and agility all fall out of what the player actually built —
 * this is the single place where "heavy" and "light" get their meaning.
 */
export function computeStats(assembly, rig = null) {
  let blockCount = 0;
  let volume = 0;
  let solidVolume = 0;
  let boneMass = 0;
  let thrust = 30;
  const bones = { leg: 0, arm: 0, face: 0, custom: 0 };

  assembly.walk((p) => {
    if (p.kind === 'bone') {
      // Thicker and longer bones weigh more, quadratically in radius.
      boneMass += p.length * 0.28 * Math.pow(p.radius / BONE_GAUGE.thick.radius, 1.6);
      bones[p.boneType] = (bones[p.boneType] ?? 0) + 1;
    } else {
      blockCount++;
      const vol = p.size[0] * p.size[1] * p.size[2];
      volume += vol;
      solidVolume += vol * (p.vox.solid / p.vox.total);
      // Thrust scales with surface area, mass with volume: scaling a part up
      // makes it heavier faster than it makes it stronger.
      thrust += 34 * Math.pow(vol, 2 / 3);
    }
  });

  // A leg is a CHAIN of leg bones, not a single bone: thigh + shin is still
  // one leg. The gait therefore counts limbs, which is what "1 leg / 2 legs /
  // 3+ legs" means to anyone actually building a robot.
  const limbs = countLimbs(assembly);
  thrust += limbs * 8;

  // A solid 1x1x1 block weighs 1.0; carving it out makes it genuinely lighter.
  const mass = Math.max(0.8, solidVolume + boneMass);

  // Density: how much of the occupied volume is actually solid. Hollowed,
  // skeletal builds are nimble; packed bricks are ponderous.
  const density = volume ? solidVolume / volume : 1;
  const thrustToMass = thrust / mass;

  // Radius of gyration from the rig, if we have one (falls back to a guess).
  let extent;
  if (rig) extent = Math.max(0.8, rig.boundingRadius);
  else extent = 0.8 + Math.cbrt(Math.max(1, volume)) * 0.55;

  const inertia = mass * extent * extent * 0.42;

  return {
    blockCount,
    volume,
    solidVolume,
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
  return 'multileg';
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

  const chest = a.addBlockOnFace(core.id, 2, 1, { size: [1.5, 1, 1] });
  const waist = a.addBlockOnFace(core.id, 3, 2, { size: [1.25, 0.75, 1] });

  const head = a.addBoneOnFace(chest.id, 2, BONE.FACE, { length: 1.2, gauge: 'thin' });
  a.addBlockOnBone(head.id, 0.6, 4, { size: [0.75, 0.75, 0.75] });

  for (const face of [0, 1]) {
    const shoulder = a.addBlockOnFace(chest.id, face, 1, { size: [0.5, 0.75, 0.75] });
    const arm = a.addBoneOnFace(shoulder.id, 3, BONE.ARM, { length: 2.5, gauge: 'thin' });
    a.addBlockOnBone(arm.id, 2, 5, { size: [0.75, 0.75, 0.75] });
  }

  for (const face of [0, 1]) {
    const hip = a.addBlockOnFace(waist.id, face, 2, { size: [0.5, 0.75, 0.75] });
    const thigh = a.addBoneOnFace(hip.id, 3, BONE.LEG, { length: 2, gauge: 'mid' });
    a.addBlockOnBone(thigh.id, 1.5, 1, { size: [0.75, 0.75, 0.75] });
    const shin = a.addBoneOnTip(thigh.id, BONE.LEG, { length: 2, gauge: 'thin' });
    a.addBlockOnBone(shin.id, 1.5, 2, { size: [0.75, 0.5, 1] });
  }

  return a;
}

export function presetHopper() {
  const a = new Assembly('POGO');
  const core = a.addCore();

  const leg = a.addBoneOnFace(core.id, 3, BONE.LEG, { length: 3, gauge: 'thick' });
  a.addBlockOnBone(leg.id, 2.5, 6, { size: [1, 0.5, 1.25] });

  const eye = a.addBoneOnFace(core.id, 4, BONE.FACE, { length: 1.2, gauge: 'thin' });
  a.addBlockOnBone(eye.id, 0.6, 15, { size: [0.75, 0.5, 0.5] });

  const hood = a.addBlockOnFace(core.id, 2, 5, { size: [1.25, 0.5, 1] });
  for (const face of [0, 1]) {
    const pod = a.addBlockOnFace(hood.id, face, 2, { size: [0.5, 0.5, 0.5] });
    const arm = a.addBoneOnFace(pod.id, 3, BONE.ARM, { length: 1.5, gauge: 'thin' });
    a.addBlockOnBone(arm.id, 0.75, 5, { size: [0.5, 0.5, 0.5] });
  }

  // Two free-floating bits, riding the core segment with nothing touching them.
  for (const side of [-1, 1]) {
    a.addBlock(core.id, { pos: [side * 1.9, 1.5, -0.4] }, 15, { size: [0.5, 0.5, 0.75] });
  }
  return a;
}

/**
 * Four legs, hung straight down off outriggers. A bone mount rotation is read
 * in its parent's frame, so a knee chained off a sideways hip would fold back
 * into the body; the sideways stance comes from the animator's splay instead.
 */
export function presetMultileg() {
  const a = new Assembly('CRAWLER');
  const core = a.addCore();
  const spine = a.addBlockOnFace(core.id, 5, 1, { size: [1.25, 0.75, 1.25] });

  const head = a.addBoneOnFace(core.id, 4, BONE.FACE, { length: 1.2, gauge: 'thin' });
  a.addBlockOnBone(head.id, 0.6, 12, { size: [0.75, 0.5, 0.75] });

  for (const host of [core, spine]) {
    for (const face of [0, 1]) {
      const outrigger = a.addBlockOnFace(host.id, face, 2, { size: [0.75, 0.5, 0.75] });
      const hip = a.addBoneOnFace(outrigger.id, 3, BONE.LEG, {
        length: 1.25, gauge: 'mid', limit: 80, invert: face === 1,
      });
      const knee = a.addBoneOnTip(hip.id, BONE.LEG, {
        length: 1.5, gauge: 'thin', limit: 90, invert: face === 1,
      });
      a.addBlockOnBone(knee.id, 1.1, 8, { size: [0.5, 0.5, 0.75] });
    }
  }

  const tail = a.addBoneOnFace(spine.id, 5, BONE.CUSTOM, {
    length: 2.5, gauge: 'thin', custom: { axis: 'x', amp: 24, freq: 1.6, phase: 0, source: 'speed' },
  });
  a.addBlockOnBone(tail.id, 1.8, 15, { size: [0.5, 0.5, 0.75] });
  return a;
}

/** A core surrounded by detached bits: the thing free placement is for. */
export function presetBits() {
  const a = new Assembly('FUNNEL');
  const core = a.addCore();
  a.addBlockOnFace(core.id, 4, 9, { size: [0.75, 0.5, 0.5] });

  const ring = 6;
  for (let i = 0; i < ring; i++) {
    const t = (i / ring) * Math.PI * 2;
    a.addBlock(core.id, {
      pos: [Math.cos(t) * 1.8, 0.35 + Math.sin(t * 2) * 0.3, Math.sin(t) * 1.8],
      rot: new THREE.Quaternion().setFromAxisAngle(UP, -t).toArray(),
    }, 15, { size: [0.5, 0.25, 0.75] });
  }

  const leg = a.addBoneOnFace(core.id, 3, BONE.LEG, { length: 2, gauge: 'mid' });
  a.addBlockOnBone(leg.id, 1.5, 2, { size: [1, 0.5, 1] });
  return a;
}

export const PRESETS = {
  biped: { label: '2脚 STRIDER', build: presetBiped },
  hopper: { label: '1脚 POGO', build: presetHopper },
  multileg: { label: '4脚 CRAWLER', build: presetMultileg },
  bits: { label: '浮遊ビット FUNNEL', build: presetBits },
  core: { label: 'コアのみ', build: () => Assembly.createDefault() },
};
