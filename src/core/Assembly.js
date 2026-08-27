import * as THREE from 'three';
import {
  BONE, BONE_GAUGE, FACE_NORMAL, FACE_AXIS, DEFAULT_VOX, snapSize,
  RING_PLANE_DEFAULT, isRingPlane,
  BONE_LENGTH_MIN, BONE_LENGTH_MAX, BONE_RADIUS_MIN, BONE_RADIUS_MAX,
  EQUIP, EQUIP_META, EQUIP_SIZE_DEFAULT, snapEquipSize,
  CIRCLE_RADIUS_DEFAULT, snapCircleRadius,
  SPIN_RPM_MIN, SPIN_RPM_MAX, CUSTOM_DEFAULT, SIZE_STEP, SIZE_MAX,
  BONE_GAIN_MAX, BONE_LAG_MAX, BONE_MOTION_DEFAULT,
} from './constants.js';
import { VoxelBlock } from './VoxelBlock.js';
import { SHAPE, SHAPE_DEFAULT, isShape } from './Shapes.js';
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
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * mount = { pos: [x, y, z], rot: [x, y, z, w] }
 * Both are expressed in the parent's own frame. For a bone parent that
 * frame starts at the mount face with +Y running down the shaft, so
 * `pos[1]` is simply "how far along the bone".
 */
export const defaultMount = (m = {}) => ({ pos: [0, 0, 0], rot: [0, 0, 0, 1], ...m });

/** A spin setting that is always sane, whatever the caller or a save file says. */
function normaliseSpin(spin, meta) {
  // A non-numeric rpm from a hand-edited save would clamp to NaN and poison
  // the block's quaternion, which takes the whole transform with it.
  const rpm = Number(spin?.rpm);
  return {
    dir: (spin?.dir ?? 1) < 0 ? -1 : 1,
    rpm: clamp(Number.isFinite(rpm) ? rpm : (meta.rpm ?? 60), SPIN_RPM_MIN, SPIN_RPM_MAX),
  };
}

/** Quaternion that points a bone's +Y shaft along a face normal. */
export function alignYToFace(face, roll = 0) {
  _v.fromArray(FACE_NORMAL[face]);
  if (_v.y < -0.9999) _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  else _q.setFromUnitVectors(UP, _v);
  if (roll) _q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, (roll * Math.PI) / 2));
  return _q.toArray();
}

// ---------------------------------------------------------- ring geometry

const _radial = new THREE.Vector3();
const _up = new THREE.Vector3();
/** Enough to survive a quarter-metre placement being run through a matrix. */
const RING_TOUCH_EPS = 1e-6;
const _axX = new THREE.Vector3();
const _axY = new THREE.Vector3();
const _axZ = new THREE.Vector3();
const _ringLocal = new THREE.Vector3();
const _ringQ = new THREE.Quaternion();
const _ringQ2 = new THREE.Quaternion();

/**
 * How far this part reaches from its own centre along `u`, in metres.
 *
 * The support function of its box, so a block turned on the spot is measured
 * by the corner it actually presents rather than by the side it started
 * with. All three of its axes count: a block tipped over leans its height
 * into the plane of the ring.
 */
export function reachAlong(part, quat, u) {
  if (part.kind !== 'block' && part.kind !== 'core') return part.radius ?? 0.25;
  const [sx = 1, sy = 1, sz = 1] = part.size ?? [];
  return Math.abs((sx / 2) * _axX.set(1, 0, 0).applyQuaternion(quat).dot(u))
    + Math.abs((sy / 2) * _axY.set(0, 1, 0).applyQuaternion(quat).dot(u))
    + Math.abs((sz / 2) * _axZ.set(0, 0, 1).applyQuaternion(quat).dot(u));
}

/**
 * Is this part TOUCHING the circle?
 *
 * The circle is a line drawn in space, and this asks the plain question the
 * builder is asking when they look at it: does the part's own body reach
 * that line? Both ways at once — out along the radius, and across the
 * ring's plane. A wide plinth straddling the line is carried; a small block
 * a hand's width inside it is not, and neither is one at the right radius
 * but a metre above.
 *
 * Across the plane it is the part's BODY that has to reach, not its centre,
 * so a tower standing on the plate is carried by its base however high it
 * goes — which is the case worth getting right, because that is how the
 * line is used.
 *
 * There is no slop on top of that. A fudge factor makes the rule impossible
 * to see: two blocks that look equally close would be decided by a number
 * nobody can read off the screen. Positions snap to a quarter metre and so
 * does the radius, so "touching" is something a builder can actually hit —
 * and a block sitting flush against the plate lands exactly on the boundary,
 * which is why the comparisons carry enough tolerance to survive being run
 * through a matrix.
 */
export function touchesLine(part, local, quat, radius) {
  // Across the plane first: it is what tells a part on the machine's own
  // body apart from one bolted to the ring.
  if (Math.abs(local.y) > reachAlong(part, quat, _up.set(0, 1, 0)) + RING_TOUCH_EPS) {
    return false;
  }
  const flat = Math.hypot(local.x, local.z);
  if (flat < RING_TOUCH_EPS) {
    // Dead centre: it touches only if it is wide enough to reach out to the
    // line on its own.
    return reachAlong(part, quat, _radial.set(1, 0, 0)) >= radius - RING_TOUCH_EPS;
  }
  _radial.set(local.x / flat, 0, local.z / flat);
  return Math.abs(flat - radius) <= reachAlong(part, quat, _radial) + RING_TOUCH_EPS;
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

  /**
   * A standalone part document. Same format as a robot, but rooted at an
   * ordinary block rather than a core — so it can be authored on its own and
   * later grafted into a machine as a real, deletable part.
   */
  static createPart(name = 'NEW PART', colorIndex = 2) {
    const a = new Assembly(name);
    const root = {
      id: nextId('p'),
      kind: 'block',
      parent: null,
      mount: null,
      children: [],
      size: [1, 1, 1],
      shape: SHAPE_DEFAULT,
      vox: new VoxelBlock(a.voxRes, colorIndex),
      label: 'PART',
    };
    a.parts.set(root.id, root);
    a.rootId = root.id;
    return a;
  }

  /** Is this a part document rather than a machine? */
  get isPart() { return this.core?.kind !== 'core'; }

  addCore() {
    const core = {
      id: nextId('c'),
      kind: 'core',
      parent: null,
      mount: null,
      children: [],
      size: [1, 1, 1],
      shape: SHAPE.BEVEL,
      vox: new VoxelBlock(this.voxRes, 0).fillShape(SHAPE.BEVEL, 0), // silver, chamfered
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
      /** Which pattern the voxel grid was cut to. Sculpting works on top. */
      shape: isShape(opts.shape) ? opts.shape : SHAPE_DEFAULT,
      vox: new VoxelBlock(this.voxRes, colorIndex),
      // What this block IS, when the builder knows. The parts list shows it,
      // and "PELVIS" tells you far more about a row than "立方体" does.
      label: opts.label ?? 'BLOCK',
    };
    if (part.shape !== SHAPE_DEFAULT) part.vox.fillShape(part.shape, colorIndex);
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
      /** How strongly this bone follows its attribute's motion. */
      gain: clamp(opts.gain ?? 1, 0, BONE_GAIN_MAX),
      /** Where it sits in the gait cycle, 0..1 of a stride. */
      lag: clamp(opts.lag ?? 0, 0, BONE_LAG_MAX),
      custom: { ...CUSTOM_DEFAULT, ...(opts.custom ?? {}) },
      label: 'BONE',
    };
    this.parts.set(part.id, part);
    parent.children.push(part.id);
    return part;
  }

  /**
   * Equipment: a thin plate stuck onto a part. It has no voxels and carries
   * no structure — it is kit, not chassis. `size` is the plate's diameter
   * (round) or edge (square); the thickness is fixed, because a uniform
   * silhouette is the whole point of the format.
   */
  addEquip(parentId, mount, equipType = EQUIP.BEAM, opts = {}) {
    const parent = this.parts.get(parentId);
    const meta = EQUIP_META[equipType];
    if (!parent || !meta) return null;
    if (this.blockedBy(equipType)) return null;

    const part = {
      id: nextId('e'),
      kind: 'equip',
      parent: parentId,
      mount: defaultMount(mount),
      children: [],
      equipType,
      size: snapEquipSize(opts.size ?? EQUIP_SIZE_DEFAULT),
      /** Bullet colour as a raw hex. Null on plates that cannot recolour. */
      bulletColor: meta.colorable ? (opts.bulletColor ?? meta.bullet) : null,
      /** Rotation, for plates that spin what they are stuck to. */
      spin: meta.spins ? normaliseSpin(opts.spin, meta) : null,
      /**
       * How wide a ring the plate turns, for the ones that turn a ring.
       *
       * A plain default here. Fitting it to the machine needs the built rig
       * — where the parts actually are, rather than where their mounts say
       * relative to their own parents — so the editor does that on placement
       * with Rig.fitRingRadius.
       */
      ringRadius: meta.ring
        ? snapCircleRadius(opts.ringRadius ?? CIRCLE_RADIUS_DEFAULT)
        : null,
      /** Which way that ring lies. See RING_PLANES. */
      ringPlane: meta.ring
        ? (isRingPlane(opts.ringPlane) ? opts.ringPlane : RING_PLANE_DEFAULT)
        : null,
      label: 'EQUIP',
    };
    this.parts.set(part.id, part);
    parent.children.push(part.id);
    return part;
  }

  /** A sticker laid flat on a face, its plate normal pointing outward. */
  addEquipOnFace(parentId, face, equipType, opts = {}) {
    const parent = this.parts.get(parentId);
    if (!parent) return null;
    return this.addEquip(parentId, {
      pos: faceAnchor(parent, face),
      rot: alignYToFace(face, opts.roll ?? 0),
    }, equipType, opts);
  }

  /** How many plates of one type the build already carries. */
  countEquip(type) {
    let n = 0;
    this.walk((p) => { if (p.kind === 'equip' && p.equipType === type) n++; });
    return n;
  }

  /** Would adding this type be legal right now? */
  canAddEquip(type) {
    return !this.blockedBy(type);
  }

  /**
   * Why this plate cannot be fitted, as something worth showing the player.
   * Some plates argue with each other — a machine cannot both refuse to
   * leave the ground and never touch it — so saying which one is in the way
   * beats silently doing nothing.
   */
  blockedBy(type) {
    const meta = EQUIP_META[type];
    if (!meta) return 'unknown';
    if (meta.unique && this.countEquip(type) >= 1) return 'unique';
    for (const other of meta.conflicts ?? []) {
      if (this.countEquip(other) > 0) return other;
    }
    return null;
  }

  /** Every equip plate, in stable tree order. */
  equips() {
    const out = [];
    this.walk((p) => { if (p.kind === 'equip') out.push(p); });
    return out;
  }

  setEquipType(id, type) {
    const part = this.parts.get(id);
    const meta = EQUIP_META[type];
    if (!part || part.kind !== 'equip' || !meta) return false;
    if (part.equipType === type) return true;
    if (this.blockedBy(type)) return false;
    part.equipType = type;
    part.bulletColor = meta.colorable ? (part.bulletColor ?? meta.bullet) : null;
    part.spin = meta.spins ? normaliseSpin(part.spin, meta) : null;
    part.ringRadius = meta.ring
      ? snapCircleRadius(part.ringRadius ?? CIRCLE_RADIUS_DEFAULT)
      : null;
    return true;
  }

  /** Which way and how fast a ROLLING plate turns its block. */
  setEquipSpin(id, { dir, rpm } = {}) {
    const part = this.parts.get(id);
    if (!part || part.kind !== 'equip' || !part.spin) return false;
    if (dir !== undefined) part.spin.dir = dir < 0 ? -1 : 1;
    if (rpm !== undefined) part.spin.rpm = clamp(rpm, SPIN_RPM_MIN, SPIN_RPM_MAX);
    return true;
  }

  setEquipSize(id, size) {
    const part = this.parts.get(id);
    if (!part || part.kind !== 'equip') return false;
    part.size = snapEquipSize(size);
    return true;
  }

  /** Only bites on plates whose meta says they may be recoloured. */
  /** How wide a ring a CIRCLE plate turns. */
  setEquipRing(id, radius) {
    const part = this.parts.get(id);
    if (!part || part.kind !== 'equip' || !EQUIP_META[part.equipType]?.ring) return false;
    part.ringRadius = snapCircleRadius(Number(radius) || CIRCLE_RADIUS_DEFAULT);
    return true;
  }

  /** Which way the ring lies: see RING_PLANES. */
  setEquipRingPlane(id, plane) {
    const part = this.parts.get(id);
    if (!part || part.kind !== 'equip' || !EQUIP_META[part.equipType]?.ring) return false;
    if (!isRingPlane(plane)) return false;
    part.ringPlane = plane;
    return true;
  }

  setBulletColor(id, hex) {
    const part = this.parts.get(id);
    if (!part || part.kind !== 'equip') return false;
    if (!EQUIP_META[part.equipType]?.colorable) return false;
    part.bulletColor = hex & 0xffffff;
    return true;
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

  /** Remove a part and everything mounted on it. Never removes the root. */
  remove(id) {
    const part = this.parts.get(id);
    if (!part || id === this.rootId) return false;
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
    if (!part || part.kind === 'bone' || part.kind === 'equip') return false;
    part.size = size.map(snapSize);
    return true;
  }

  /**
   * Grow a block outward on one face, keeping everything already sculpted
   * exactly where it is. This is what lets the ADD tool build past the edge
   * of a block instead of stopping dead at it.
   *
   * The block's own mount takes up the slack so the shape does not shift.
   * The root has no mount, so there its children move instead — either way
   * the sculpted material stays put and the build stays coherent.
   *
   * @param {string} id
   * @param {number} axis 0..2
   * @param {number} dir  +1 grows the positive face, -1 the negative one
   * @param {number} amount world units, snapped to the size grid
   * @returns {boolean} false if it is already as big as a block may be
   */
  growBlock(id, axis, dir, amount = SIZE_STEP) {
    const part = this.parts.get(id);
    if (!part || !part.vox) return false;

    const grow = snapSize(part.size[axis] + Math.abs(amount)) - part.size[axis];
    if (grow <= 0) return false;

    const before = part.size[axis];
    const after = before + grow;
    part.size = part.size.slice();
    part.size[axis] = after;

    const keep = [1, 1, 1];
    const offset = [0, 0, 0];
    keep[axis] = before / after;
    offset[axis] = dir < 0 ? grow / after : 0;
    part.vox.regrid(keep, offset);

    // Put the material back where it was: the box grew on one side, so its
    // centre moved half the growth that way.
    _v.set(0, 0, 0);
    _v.setComponent(axis, (dir < 0 ? -1 : 1) * (grow / 2));

    // Anything mounted on this block would ride the shift, so it is walked
    // back by the same amount: growing a block must not drag the arm bolted
    // to its far side along with it.
    for (const childId of part.children) {
      const child = this.parts.get(childId);
      if (child?.mount) {
        child.mount.pos = child.mount.pos.map((p, i) => p - _v.getComponent(i));
      }
    }

    if (part.mount) {
      _q.fromArray(part.mount.rot);
      _v.applyQuaternion(_q);
      part.mount.pos = part.mount.pos.map((p, i) => p + _v.getComponent(i));
    }
    return true;
  }

  setBoneShape(id, { length, radius } = {}) {
    const part = this.parts.get(id);
    if (!part || part.kind !== 'bone') return false;
    if (length !== undefined) part.length = clamp(length, BONE_LENGTH_MIN, BONE_LENGTH_MAX);
    if (radius !== undefined) part.radius = clamp(radius, BONE_RADIUS_MIN, BONE_RADIUS_MAX);
    return true;
  }

  /**
   * Re-cut a block to a named shape.
   *
   * This REPLACES the contents: a shape is the block's material, not a
   * modifier laid over it, so anything carved here goes with it. That is
   * worth one undo step rather than a confusing partial merge.
   */
  setBlockShape(id, shape, colorIndex = null) {
    const part = this.parts.get(id);
    if (!part || !part.vox || !isShape(shape)) return false;
    part.shape = shape;
    part.vox.fillShape(shape, colorIndex ?? part.vox.mainColor());
    return true;
  }

  /** How much of its attribute's motion a bone takes, and when. */
  setBoneMotion(id, { gain, lag } = {}) {
    const part = this.parts.get(id);
    if (!part || part.kind !== 'bone') return false;
    if (gain !== undefined) part.gain = clamp(Number(gain) || 0, 0, BONE_GAIN_MAX);
    if (lag !== undefined) part.lag = clamp(Number(lag) || 0, 0, BONE_LAG_MAX);
    return true;
  }

  /** Change sculpt resolution for the whole build, resampling every block. */
  setVoxResolution(n) {
    if (this.voxRes === n) return false;
    this.voxRes = n;
    this.walk((p) => {
      if (!p.vox) return;
      // A block nobody has carved is re-CUT at the new resolution rather than
      // resampled: resampling a sphere just enlarges its existing steps,
      // where re-cutting actually makes it rounder, which is the whole point
      // of turning the resolution up.
      const shape = p.shape ?? SHAPE_DEFAULT;
      const pristine = p.vox.isPristine(shape);
      const colour = pristine ? p.vox.mainColor() : 0;
      p.vox.setResolution(n, !pristine);
      if (pristine) p.vox.fillShape(shape, colour);
    });
    return true;
  }

  // ---------------------------------------------------------- extract / graft

  /**
   * Lift a subtree out into a standalone part document, carrying only the
   * colours it actually uses. This is the single mechanism behind copy,
   * duplicate and "save as a part".
   */
  extract(id) {
    const src = this.parts.get(id);
    if (!src) return null;

    const out = new Assembly(this.name);
    out.voxRes = this.voxRes;
    out.parts.clear();

    const colorMap = new Map();
    const mapColor = (i) => {
      if (!colorMap.has(i)) colorMap.set(i, Math.max(0, out.palette.ensure(this.palette.get(i))));
      return colorMap.get(i);
    };

    const idMap = new Map();
    this.walk((p) => {
      const isRoot = p.id === id;
      const copy = {
        id: p.id,
        kind: isRoot ? (p.kind === 'core' ? 'block' : p.kind) : p.kind,
        parent: isRoot ? null : idMap.get(p.parent) ?? p.parent,
        mount: isRoot ? null : defaultMount({ pos: [...p.mount.pos], rot: [...p.mount.rot] }),
        children: [],
        label: p.label,
      };
      if (p.kind === 'bone') {
        Object.assign(copy, {
          boneType: p.boneType, radius: p.radius, length: p.length,
          limit: p.limit, invert: p.invert, gain: p.gain, lag: p.lag,
          custom: { ...p.custom },
        });
      } else if (p.kind === 'equip') {
        Object.assign(copy, {
          equipType: p.equipType, size: p.size, bulletColor: p.bulletColor,
          spin: p.spin ? { ...p.spin } : null, ringRadius: p.ringRadius,
        });
      } else {
        copy.size = [...p.size];
        copy.shape = p.shape ?? SHAPE_DEFAULT;
        copy.vox = p.vox.clone();
        const remap = new Map();
        for (const c of copy.vox.usedColors()) remap.set(c, mapColor(c));
        copy.vox.remapColors(remap);
      }
      out.parts.set(copy.id, copy);
      idMap.set(p.id, copy.id);
      if (isRoot) out.rootId = copy.id;
    }, id);

    for (const p of out.parts.values()) {
      if (p.parent && out.parts.has(p.parent)) out.parts.get(p.parent).children.push(p.id);
    }
    return out;
  }

  /**
   * Insert a whole part document under `parentId`, at `mount`.
   * Ids are regenerated, and the source palette is merged into this one so
   * the colours the author picked survive the trip.
   * @returns the newly created root part, or null
   */
  graft(source, parentId, mount) {
    if (!source || !this.parts.get(parentId)) return null;

    const colorMap = new Map();
    const mapColor = (i) => {
      if (!colorMap.has(i)) {
        const idx = this.palette.ensure(source.palette.get(i));
        colorMap.set(i, idx < 0 ? 0 : idx);
      }
      return colorMap.get(i);
    };

    const idMap = new Map();
    let rootCopy = null;

    source.walk((p) => {
      const isRoot = p.id === source.rootId;
      const destParent = isRoot ? parentId : idMap.get(p.parent);
      if (!destParent) return;
      const m = isRoot
        ? defaultMount(mount)
        : defaultMount({ pos: [...p.mount.pos], rot: [...p.mount.rot] });

      let copy;
      if (p.kind === 'bone') {
        copy = this.addBone(destParent, m, p.boneType, {
          length: p.length, radius: p.radius, limit: p.limit, invert: p.invert,
          gain: p.gain, lag: p.lag, custom: { ...p.custom },
        });
      } else if (p.kind === 'equip') {
        // A unique plate the destination already carries is dropped rather
        // than quietly becoming a second one.
        copy = this.addEquip(destParent, m, p.equipType, {
          size: p.size, bulletColor: p.bulletColor, spin: p.spin,
          ringRadius: p.ringRadius,
        });
      } else {
        copy = this.addBlock(destParent, m, 0, {
          size: [...p.size], shape: p.shape ?? SHAPE_DEFAULT,
        });
        copy.vox = p.vox.clone();
        // The destination document owns the resolution.
        if (copy.vox.n !== this.voxRes) copy.vox.setResolution(this.voxRes, true);
        const remap = new Map();
        for (const c of copy.vox.usedColors()) remap.set(c, mapColor(c));
        copy.vox.remapColors(remap);
      }
      if (!copy) return;
      idMap.set(p.id, copy.id);
      if (isRoot) rootCopy = copy;
    });

    return rootCopy;
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
      if (!p.vox) return;
      for (const c of p.vox.usedColors()) all.add(c);
    });
    return all;
  }

  /** Drop unreferenced custom colours and rewrite every voxel index. */
  prunePalette() {
    const remap = this.palette.prune(this.usedColors());
    this.walk((p) => { if (p.vox) p.vox.remapColors(remap); });
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
          limit: p.limit, invert: p.invert, gain: p.gain, lag: p.lag,
          custom: p.custom,
        });
      } else if (p.kind === 'equip') {
        Object.assign(o, {
          equipType: p.equipType, size: p.size, bulletColor: p.bulletColor,
          spin: p.spin, ringRadius: p.ringRadius, ringPlane: p.ringPlane,
        });
      } else {
        o.size = p.size;
        o.shape = p.shape ?? SHAPE_DEFAULT;
        // A block nobody has carved is stored as "this shape, this colour"
        // rather than as a grid of cells. The grid for a sphere is thousands
        // of runs even before anyone touches it, and writing those out is
        // what pushes a share code past what a QR code can carry — so a
        // machine made of round parts could not be shared at all.
        if (p.vox.isPristine(o.shape)) o.color = p.vox.mainColor();
        else o.vox = p.vox.encode();
      }
      parts.push(o);
    });
    return {
      format: 'brostom.assembly',
      version: 4,
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
        part.custom = { ...CUSTOM_DEFAULT, ...(o.custom ?? {}) };
        part.gain = clamp(o.gain ?? BONE_MOTION_DEFAULT.gain, 0, BONE_GAIN_MAX);
        part.lag = clamp(o.lag ?? BONE_MOTION_DEFAULT.lag, 0, BONE_LAG_MAX);
      } else if (o.kind === 'equip') {
        delete part.vox;
        const type = EQUIP_META[o.equipType] ? o.equipType : EQUIP.BEAM;
        part.equipType = type;
        part.size = snapEquipSize(o.size ?? EQUIP_SIZE_DEFAULT);
        part.bulletColor = EQUIP_META[type].colorable
          ? (o.bulletColor ?? EQUIP_META[type].bullet)
          : null;
        part.spin = EQUIP_META[type].spins ? normaliseSpin(o.spin, EQUIP_META[type]) : null;
        part.ringRadius = EQUIP_META[type].ring
          ? snapCircleRadius(o.ringRadius ?? CIRCLE_RADIUS_DEFAULT)
          : null;
        // Builds saved before the ring could be turned all used the plate's
        // own facing, which is what 'face' means.
        part.ringPlane = EQUIP_META[type].ring
          ? (isRingPlane(o.ringPlane) ? o.ringPlane : RING_PLANE_DEFAULT)
          : null;
      } else {
        part.size = (o.size ?? [1, 1, 1]).map(snapSize);
        // Builds saved before shapes existed are all boxes, which is what
        // they were, so nothing needs re-cutting on load.
        part.shape = isShape(o.shape) ? o.shape : SHAPE_DEFAULT;
        // Either the cells were written out, or the block was untouched and
        // can simply be cut again from its shape.
        part.vox = o.vox
          ? VoxelBlock.decode(a.voxRes, o.vox)
          : new VoxelBlock(a.voxRes, o.color ?? 0).fillShape(part.shape, o.color ?? 0);
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
  let equipMass = 0;
  let thrust = 30;
  const bones = { leg: 0, arm: 0, face: 0, custom: 0 };
  const equips = [];

  assembly.walk((p) => {
    if (p.kind === 'equip') {
      const meta = EQUIP_META[p.equipType];
      if (!meta) return;
      // A plate weighs what its table says, scaled by how big it was made.
      equipMass += (meta.mass ?? 0.5) * (p.size / EQUIP_SIZE_DEFAULT) ** 2;
      equips.push(p);
    } else if (p.kind === 'bone') {
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

  // ---- equipment: what the plates do to the machine that carries them
  const loadout = summariseEquipment(equips);

  // ---- durability comes from the CORE and the machine's own weight.
  // The core is the thing that has to survive: making it bigger is the
  // deliberate way to buy toughness, and it costs manoeuvrability through
  // the mass it adds. Weight contributes too, so an armoured build is
  // sturdier than a skeleton with the same core — but only gently, or
  // "bolt on more bricks" would beat "design a tougher core".
  const core = assembly.core;
  const coreScale = core ? Math.cbrt(Math.max(1e-4, core.size[0] * core.size[1] * core.size[2])) : 1;

  // A solid 1x1x1 block weighs 1.0; carving it out makes it genuinely lighter.
  const mass = Math.max(0.8, solidVolume + boneMass + equipMass);

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
    /** Effective edge of the core cube, 0.25..4. */
    coreScale,
    /** Hit points, before the equipment bonus that `loadout` carries. */
    durability: Math.round(40 + coreScale * coreScale * 60 + mass * 5),
    // 0 = feather, 1 = tank. Drives ZMF drag, spool and camera weight.
    weightClass: clamp01((mass - 2) / 26),
    agility: clamp01((thrustToMass - 18) / 42),
    ...loadout,
  };
}

/**
 * Fold the equipped plates into the handful of numbers the rest of the game
 * asks about. Weapons stay as a list, because each plate is its own gun with
 * its own magazine; systems collapse into modifiers.
 *
 * GRAVITY is capped at one plate even if a malformed document carries two:
 * the rule is "one only", and a loader should not be able to break it.
 */
export function summariseEquipment(equips) {
  const weapons = [];
  let boostPlates = 0;
  let gravityPlates = 0;
  let floatPlates = 0;
  let circlePlates = 0;

  for (const p of equips) {
    const meta = EQUIP_META[p.equipType];
    if (!meta) continue;
    if (meta.category === 'weapon') { weapons.push(p); continue; }
    if (p.equipType === EQUIP.BOOST) boostPlates++;
    if (p.equipType === EQUIP.GRAVITY) gravityPlates++;
    if (p.equipType === EQUIP.FLOAT) floatPlates++;
    if (p.equipType === EQUIP.CIRCLE) circlePlates++;
  }

  const gravity = gravityPlates > 0;
  // Gravity and float are mutually exclusive when fitted, but a build loaded
  // from an older file could still carry both. Gravity is the one that says
  // "you do not leave the ground", so it wins.
  const floating = floatPlates > 0 && !gravity;
  return {
    equipCount: equips.length,
    weapons,
    weaponCount: weapons.length,
    boostPlates,
    gravityPlates: Math.min(1, gravityPlates),
    /** Dash impulse multiplier. Each plate is a small step, and they stack. */
    dashBonus: boostPlates * EQUIP_META[EQUIP.BOOST].dashBonus,
    /** Sustained flight is off while a gravity plate is fitted. */
    noFly: gravity,
    /** Extra durability, as a fraction of base HP. */
    hpBonus: gravity ? EQUIP_META[EQUIP.GRAVITY].hpBonus : 0,
    floatPlates: Math.min(1, floatPlates),
    circlePlates,
    /** How far off the floor the machine rests. 0 means it stands on it. */
    hoverHeight: floating ? EQUIP_META[EQUIP.FLOAT].hover : 0,
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

/**
 * A bend applied where a bone chains off the tip of another one.
 *
 * `addBoneOnTip` continues straight along the parent, which is right for a
 * strut and wrong for a limb: a knee or an elbow that starts perfectly
 * straight has to be bent by the animator every frame just to stop the
 * machine looking like it is standing to attention. Building the bend into
 * the mount gives the limb a resting shape of its own.
 *
 * Positive `deg` folds the tip FORWARD (+Z) for a bone hanging downward.
 */
function bentTip(bone, deg) {
  const q = new THREE.Quaternion().setFromAxisAngle(_v.set(1, 0, 0), (deg * Math.PI) / 180);
  return { pos: boneAnchor(bone.length), rot: q.toArray() };
}

/**
 * STRIDER — the two-legged one, and the shape most people picture when they
 * hear "robot".
 *
 * Built to three rules the old one broke:
 *
 *  - **the arms hang clear of the body.** They are mounted wider than the
 *    pelvis and stop above it, so nothing intersects when the machine is at
 *    rest and nothing clips through when it walks.
 *  - **the limbs are round.** Capsules for the long segments and spheres at
 *    the joints, so a leg reads as a leg instead of a stack of boxes.
 *  - **it does not stand to attention.** Elbows and knees carry a resting
 *    bend, which is also what gives the walk something to work against.
 */
export function presetBiped() {
  const a = new Assembly('STRIDER');
  const core = a.addCore();

  // ---- torso
  // The waist is a CUSTOM bone twisting on Y off the STRIDE, not a new bone
  // type: the torso counter-rotating against the pelvis is most of what makes
  // a walk read as a walk.
  //
  // It carries the CHEST rather than sitting under the legs on purpose. A
  // bone mounted on a downward face flips its whole frame, and everything
  // built below it would then have to be built upside down.
  const spine = a.addBoneOnFace(core.id, 2, BONE.CUSTOM, {
    length: 0.4, gauge: 'thick', limit: 30,
    custom: { axis: 'y', wave: 'sine', amp: 16, freq: 1, phase: 0, offset: 0, source: 'stride' },
  });
  const chest = a.addBlockOnBone(spine.id, 0.5, 1, {
    size: [1.75, 1.25, 1.3], shape: SHAPE.BEVEL, label: 'CHEST',
  });
  // Intake vents, and the one bright thing on the front of the machine.
  a.addBlockOnFace(chest.id, 4, 15, {
    size: [0.5, 0.25, 0.25], shape: SHAPE.PRISM, label: 'VENT',
  });

  // A barrel around the core rather than a block under it. The core is a
  // metre of bare silver in the middle of the machine, and every build that
  // does not cover it ends up with a bright square in its stomach.
  // A box AROUND the core, not one under it. The core is a metre of bare
  // silver in the middle of the machine, and a rounded shape leaves its
  // corners poking out — which reads as a bright square in its stomach.
  const belly = a.addBlock(core.id, { pos: [0, -0.15, 0] }, 2, {
    size: [1.15, 1.1, 1.15], label: 'BELLY',
  });
  // Narrow. The hips have to end well inside where the arms hang, or the
  // forearms clip the hip balls every time the machine takes a step — which
  // is the whole reason this build was drawn again.
  const pelvis = a.addBlockOnFace(belly.id, 3, 1, {
    size: [1, 0.6, 1.2], shape: SHAPE.BEVEL, label: 'PELVIS',
  });

  // ---- head
  const neck = a.addBoneOnFace(chest.id, 2, BONE.FACE, { length: 0.4, gauge: 'thin' });
  const skull = a.addBlockOnBone(neck.id, 0.35, 1, {
    size: [0.9, 0.8, 1], shape: SHAPE.HEX, label: 'HEAD',
  });
  a.addBlockOnFace(skull.id, 4, 15, { size: [0.6, 0.25, 0.1] });
  a.addBlockOnFace(skull.id, 2, 4, { size: [0.2, 0.2, 0.6], shape: SHAPE.WEDGE });

  // ---- arms
  // Mounted on the outside of the chest and stopping above the pelvis: the
  // whole point of the rebuild. Anything narrower and the hands sit inside
  // the hips, which is what the old build did.
  for (const face of [0, 1]) {
    const pauldron = a.addBlockOnFace(chest.id, face, 2, {
      size: [0.65, 0.8, 1.15], shape: SHAPE.DOME, label: 'PAULDRON',
    });
    a.addBlockOnFace(pauldron.id, 2, 5, { size: [0.5, 0.2, 0.7], shape: SHAPE.BEVEL });

    const upper = a.addBoneOnFace(pauldron.id, 3, BONE.ARM, {
      length: 1.1, gauge: 'mid', gain: 0.85,
    });
    a.addBlockOnBone(upper.id, 0.55, 1, {
      size: [0.5, 1.05, 0.5], shape: SHAPE.CAPSULE, label: 'UPPER ARM',
    });

    const elbow = a.addBone(upper.id, bentTip(upper, 12), BONE.ARM, {
      length: 1.05, gauge: 'thin', gain: 1, lag: 0.06,
    });
    a.addBlockOnBone(elbow.id, 0, 5, { size: [0.45, 0.45, 0.45], shape: SHAPE.SPHERE });
    a.addBlockOnBone(elbow.id, 0.5, 2, {
      size: [0.45, 0.95, 0.45], shape: SHAPE.CAPSULE, label: 'FOREARM',
    });
    const hand = a.addBlockOnBone(elbow.id, 1, 1, {
      size: [0.5, 0.5, 0.55], shape: SHAPE.BEVEL, label: 'HAND',
    });
    a.addEquipOnFace(hand.id, face, face === 0 ? EQUIP.BEAM : EQUIP.GATLING, { size: 0.6 });
  }

  // Weapon order is tree order, and the plate you deploy holding should be one
  // you can actually shoot with, so nothing melee goes above the arms here.
  a.addEquipOnFace(chest.id, 1, EQUIP.MISSILE, { size: 0.7 });
  a.addEquipOnFace(chest.id, 5, EQUIP.BOOST, { size: 0.8 });

  // ---- legs
  for (const face of [0, 1]) {
    const hip = a.addBlockOnFace(pelvis.id, face, 2, {
      size: [0.25, 0.5, 0.5], shape: SHAPE.SPHERE, label: 'HIP',
    });
    // 股関節: the leg bone at the root of the chain, taking the full stride.
    const thigh = a.addBoneOnFace(hip.id, 3, BONE.LEG, { length: 1.6, gauge: 'mid', gain: 1 });
    a.addBlockOnBone(thigh.id, 0.8, 1, {
      size: [0.65, 1.5, 0.7], shape: SHAPE.CAPSULE, label: 'THIGH',
    });

    // The knee runs a hair behind the thigh, so the shin whips through, and
    // starts folded rather than locked straight.
    const shin = a.addBone(thigh.id, bentTip(thigh, -14), BONE.LEG, {
      length: 1.5, gauge: 'thin', gain: 1, lag: 0.07,
    });
    a.addBlockOnBone(shin.id, 0, 5, {
      size: [0.55, 0.55, 0.55], shape: SHAPE.SPHERE, label: 'KNEE',
    });
    a.addBlockOnBone(shin.id, 0.75, 2, {
      size: [0.55, 1.4, 0.6], shape: SHAPE.CAPSULE, label: 'SHIN',
    });

    // Toes forward of the ankle, or the machine looks like it is standing on
    // stilts rather than on feet.
    const foot = a.addBlock(shin.id, { pos: [0, 1.45, 0.25] }, 1, {
      size: [0.75, 0.35, 1.25], shape: SHAPE.BEVEL, label: 'FOOT',
    });
    a.addEquipOnFace(foot.id, 5, EQUIP.BOOST, { size: 0.45 });
  }

  return a;
}

/**
 * POGO — one leg and a lot of nerve.
 *
 * Round where STRIDER is square: the whole machine is a pod balanced on a
 * single sprung leg, so it reads as something that hops rather than
 * something that walks badly.
 */
export function presetHopper() {
  const a = new Assembly('POGO');
  const core = a.addCore();

  // The shell goes AROUND the core. Every build that hangs blocks off it
  // instead ends up with a metre of bare silver showing between them.
  const pod = a.addBlock(core.id, { pos: [0, 0.05, 0] }, 1, {
    size: [1.5, 1.4, 1.6], shape: SHAPE.BEVEL,
  });
  const cap = a.addBlockOnFace(pod.id, 2, 2, { size: [1.1, 0.4, 1.2], shape: SHAPE.DOME });

  // ---- the eye, on a face bone so it tracks where the machine is going
  const eye = a.addBoneOnFace(pod.id, 4, BONE.FACE, { length: 0.6, gauge: 'thin' });
  const lens = a.addBlockOnBone(eye.id, 0.4, 1, { size: [0.9, 0.6, 0.6], shape: SHAPE.DOME });
  a.addBlockOnFace(lens.id, 4, 15, { size: [0.6, 0.3, 0.15], shape: SHAPE.DISH });
  a.addEquipOnFace(lens.id, 2, EQUIP.SHOT, { size: 0.5 });

  // ---- tail fins, for the look of the thing and somewhere to put the boost
  for (const face of [0, 1]) {
    const fin = a.addBlock(pod.id, {
      pos: [(face === 0 ? -1 : 1) * 0.7, 0.1, -0.75],
    }, 2, { size: [0.3, 0.9, 0.8], shape: SHAPE.WEDGE });
    a.addEquipOnFace(fin.id, 5, EQUIP.BOOST, { size: 0.45 });
  }

  // ---- arms: short, fast and armed with blades
  for (const face of [0, 1]) {
    const shoulder = a.addBlockOnFace(pod.id, face, 2, {
      size: [0.4, 0.5, 0.6], shape: SHAPE.SPHERE,
    });
    const arm = a.addBoneOnFace(shoulder.id, 3, BONE.ARM, {
      length: 0.9, gauge: 'thin', gain: 1.3,
    });
    a.addBlockOnBone(arm.id, 0.45, 2, { size: [0.35, 0.85, 0.35], shape: SHAPE.CAPSULE });
    const claw = a.addBlock(arm.id, bentTip(arm, 18), 5, {
      size: [0.45, 0.5, 0.45], shape: SHAPE.OCTA,
    });
    a.addEquipOnFace(claw.id, face, EQUIP.BLADE, { size: 0.5 });
  }

  // ---- the leg: one, and wound tighter than standard
  const thigh = a.addBoneOnFace(pod.id, 3, BONE.LEG, {
    length: 1.5, gauge: 'thick', gain: 1.2,
  });
  a.addBlockOnBone(thigh.id, 0.75, 1, { size: [0.8, 1.4, 0.8], shape: SHAPE.CAPSULE });

  const shank = a.addBone(thigh.id, bentTip(thigh, -20), BONE.LEG, {
    length: 1.4, gauge: 'mid', gain: 1.1, lag: 0.06,
  });
  a.addBlockOnBone(shank.id, 0, 5, { size: [0.7, 0.7, 0.7], shape: SHAPE.SPHERE });
  a.addBlockOnBone(shank.id, 0.7, 2, { size: [0.6, 1.3, 0.6], shape: SHAPE.CAPSULE });

  const foot = a.addBlockOnBone(shank.id, 1.4, 1, {
    size: [1.2, 0.4, 1.3], shape: SHAPE.FRUSTUM,
  });
  a.addEquipOnFace(foot.id, 5, EQUIP.BOOST, { size: 0.55 });

  // ---- two bits, circling the cap
  //
  // The plate on the cap draws a line at 1.5m, level with the top of the
  // cap; the bits sit on that line, one either side, and go round it. They
  // used to just hang there in mid-air, which is a fair bit less convincing
  // for something with no visible means of support.
  const RING = 1.5;
  a.addEquipOnFace(cap.id, 2, EQUIP.CIRCLE, {
    size: 0.6, ringRadius: RING, spin: { dir: 1, rpm: 40 },
  });
  for (const side of [-1, 1]) {
    const bit = a.addBlock(pod.id, { pos: [side * RING, 1.1, 0] }, 15, {
      size: [0.4, 0.4, 0.8], shape: SHAPE.PRISM,
    });
    a.addEquipOnFace(bit.id, 4, EQUIP.BEAM, { size: 0.4 });
  }
  return a;
}

/**
 * CRAWLER — four legs, hung off a flat hull.
 *
 * A bone mount rotation is read in its parent's frame, so a knee chained off
 * a sideways hip would fold back into the body; the sideways stance comes
 * from the animator's splay instead.
 */
export function presetMultileg() {
  const a = new Assembly('CRAWLER');
  const core = a.addCore();

  // One hull, wrapped around the core and stretched back over the tail.
  const hull = a.addBlock(core.id, { pos: [0, 0, -0.2] }, 1, {
    size: [1.7, 1.3, 2.5], shape: SHAPE.BEVEL,
  });
  const deck = a.addBlockOnFace(hull.id, 2, 2, {
    size: [1.2, 0.4, 1.8], shape: SHAPE.FRUSTUM,
  });
  a.addEquipOnFace(deck.id, 2, EQUIP.GRAVITY, { size: 0.9 });
  a.addEquipOnFace(hull.id, 5, EQUIP.BOOST, { size: 0.7 });

  // ---- turret, on a face bone so the gun leads the machine
  const neck = a.addBoneOnFace(hull.id, 4, BONE.FACE, { length: 0.7, gauge: 'thin' });
  const turret = a.addBlockOnBone(neck.id, 0.45, 11, {
    size: [0.9, 0.7, 0.9], shape: SHAPE.DOME,
  });
  a.addBlockOnFace(turret.id, 4, 15, { size: [0.5, 0.25, 0.2], shape: SHAPE.DISH });
  a.addEquipOnFace(turret.id, 4, EQUIP.GATLING, { size: 0.55 });

  // ---- four legs, front pair and back pair
  for (const z of [0.75, -0.75]) {
    for (const face of [0, 1]) {
      const side = face === 0 ? -1 : 1;
      const outrigger = a.addBlock(hull.id, { pos: [side * 0.95, 0.1, z] }, 2, {
        size: [0.6, 0.5, 0.6], shape: SHAPE.HEX,
      });
      if (z > 0) a.addEquipOnFace(outrigger.id, 2, EQUIP.MISSILE, { size: 0.5 });

      const hip = a.addBoneOnFace(outrigger.id, 3, BONE.LEG, {
        length: 1.1, gauge: 'mid', limit: 80, invert: face === 1, gain: 1,
      });
      a.addBlockOnBone(hip.id, 0.55, 1, { size: [0.4, 1, 0.4], shape: SHAPE.CAPSULE });

      const knee = a.addBone(hip.id, bentTip(hip, -22), BONE.LEG, {
        length: 1.5, gauge: 'thin', limit: 90, invert: face === 1, gain: 1, lag: 0.08,
      });
      a.addBlockOnBone(knee.id, 0, 8, { size: [0.45, 0.45, 0.45], shape: SHAPE.SPHERE });
      a.addBlockOnBone(knee.id, 0.75, 2, { size: [0.35, 1.4, 0.35], shape: SHAPE.CAPSULE });
      a.addBlockOnBone(knee.id, 1.45, 1, { size: [0.4, 0.4, 0.5], shape: SHAPE.CONE });
    }
  }

  // ---- tail, swinging off the machine's own speed
  const tail = a.addBoneOnFace(hull.id, 5, BONE.CUSTOM, {
    length: 2.2, gauge: 'thin', custom: { axis: 'x', amp: 24, freq: 1.6, phase: 0, source: 'speed' },
  });
  a.addBlockOnBone(tail.id, 0.9, 2, { size: [0.3, 1.6, 0.3], shape: SHAPE.CAPSULE });
  const tip = a.addBlockOnBone(tail.id, 1.9, 15, { size: [0.45, 0.6, 0.45], shape: SHAPE.OCTA });
  a.addEquipOnFace(tip.id, 2, EQUIP.BEAM, { size: 0.45 });
  return a;
}

/**
 * FUNNEL — a body that barely touches the ground and a ring of bits that
 * never do. Built to show off free placement: nothing in the ring is
 * attached to anything it looks attached to.
 */
export function presetBits() {
  const a = new Assembly('FUNNEL');
  const core = a.addCore();

  // A ball, and big enough to swallow the core whole. A shape that tapers —
  // an octahedron, a cone — has to be much larger than the thing it covers
  // before its faces clear the corners, and anything less leaves the bare
  // silver of the core poking through in eight places.
  const shell = a.addBlock(core.id, { pos: [0, 0, 0] }, 1, {
    size: [1.8, 1.75, 1.8], shape: SHAPE.SPHERE,
  });
  const crown = a.addBlockOnFace(shell.id, 2, 9, {
    size: [0.9, 0.5, 0.9], shape: SHAPE.DOME,
  });
  a.addBlockOnFace(crown.id, 4, 15, { size: [0.5, 0.25, 0.2], shape: SHAPE.DISH });
  a.addEquipOnFace(crown.id, 4, EQUIP.BEAM, { size: 0.5 });
  a.addEquipOnFace(shell.id, 5, EQUIP.BOOST, { size: 0.7 });

  const ring = 6;
  for (let i = 0; i < ring; i++) {
    const t = (i / ring) * Math.PI * 2;
    const bit = a.addBlock(core.id, {
      pos: [Math.cos(t) * 1.9, 0.35 + Math.sin(t * 2) * 0.3, Math.sin(t) * 1.9],
      rot: new THREE.Quaternion().setFromAxisAngle(UP, -t).toArray(),
    }, 15, { size: [0.5, 0.3, 0.9], shape: SHAPE.PRISM });
    // Every other bit spins on the spot; the rest carry the guns.
    if (i % 2 === 0) {
      a.addEquipOnFace(bit.id, 2, EQUIP.ROLLING, {
        size: 0.4, spin: { dir: i % 4 === 0 ? 1 : -1, rpm: 90 },
      });
    } else {
      a.addEquipOnFace(bit.id, 2, EQUIP.SHOT, { size: 0.4 });
    }
  }

  // One leg, folded, with a dish for a foot: it lands rather than walks.
  const leg = a.addBoneOnFace(shell.id, 3, BONE.LEG, {
    length: 1.3, gauge: 'mid', gain: 1.1,
  });
  a.addBlockOnBone(leg.id, 0.65, 2, { size: [0.5, 1.2, 0.5], shape: SHAPE.CAPSULE });
  const shank = a.addBone(leg.id, bentTip(leg, -16), BONE.LEG, {
    length: 1, gauge: 'thin', gain: 1, lag: 0.06,
  });
  a.addBlockOnBone(shank.id, 0, 9, { size: [0.45, 0.45, 0.45], shape: SHAPE.SPHERE });
  const pad = a.addBlockOnBone(shank.id, 1, 2, { size: [1.3, 0.35, 1.3], shape: SHAPE.DISH });
  a.addEquipOnFace(pad.id, 3, EQUIP.MISSILE, { size: 0.45 });
  return a;
}

export const PRESETS = {
  biped: { label: '2脚 STRIDER', build: presetBiped },
  hopper: { label: '1脚 POGO', build: presetHopper },
  multileg: { label: '4脚 CRAWLER', build: presetMultileg },
  bits: { label: '浮遊ビット FUNNEL', build: presetBits },
  core: { label: 'コアのみ', build: () => Assembly.createDefault() },
};
