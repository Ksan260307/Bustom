import * as THREE from 'three';
import { BONE_META } from './constants.js';

// ============================================================
//  Rig : turns an Assembly (data) into a live Three.js hierarchy.
//
//  Per bone the graph is
//     boneRoot ─ near-half mesh + near-half children    (parent segment)
//        └ joint  ← THE articulated node
//             └ far ─ far-half mesh + far-half children (child segment)
//                        └ downstream bones ...
//
//  A part's mount is a free position + rotation in its parent's frame.
//  For a bone parent that frame runs along the shaft, so which half a
//  child rides with is simply a question of which side of the midpoint
//  its local Y lands on.
//
//  Block geometry is produced in unit-cube space and cached on the
//  VoxelBlock, so a part's size lives entirely on the mesh transform and
//  rebuilding the rig never re-meshes anything that did not change.
// ============================================================

const _v = new THREE.Vector3();

export function makeBodyMaterial() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    // Keep metalness low: a metallic surface has almost no diffuse term, and
    // the whole point of the palette is that the player's colours read.
    metalness: 0.18,
    roughness: 0.58,
  });
}

function makeBoneMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color, metalness: 0.75, roughness: 0.32, flatShading: true,
  });
}

/** Does this part ride the far (articulated) half of its bone parent? */
export function ridesFarHalf(part, parentPart) {
  if (!parentPart || parentPart.kind !== 'bone' || !part.mount) return false;
  return part.mount.pos[1] >= parentPart.length / 2;
}

export class Rig {
  /** @param {import('./Assembly.js').Assembly} assembly */
  constructor(assembly, opts = {}) {
    this.assembly = assembly;
    this.opts = opts;
    this.root = new THREE.Group();
    this.root.name = 'rig';

    /** partId -> { part, group, mesh, joint, near, far } */
    this.nodes = new Map();
    /** every articulated node, in tree order */
    this.joints = [];
    /** pickable meshes, tagged with userData.partId */
    this.pickables = [];
    /** geometry + materials this rig created itself and must dispose */
    this._owned = [];
    this._ownedMaterials = [];

    this.bodyMaterial = makeBodyMaterial();
    this._boneMaterials = new Map();

    this._build(assembly.rootId, this.root, null);
    this.measure();
    this.buildLimbs();
  }

  boneMaterial(type) {
    if (!this._boneMaterials.has(type)) {
      this._boneMaterials.set(type, makeBoneMaterial(BONE_META[type].color));
    }
    return this._boneMaterials.get(type);
  }

  // ---------------------------------------------------------- build

  _build(partId, parentGroup, parentPart) {
    const part = this.assembly.get(partId);
    if (!part) return;
    if (part.kind === 'bone') this._buildBone(part, parentGroup, parentPart);
    else this._buildBlock(part, parentGroup, parentPart);
  }

  _placeOnParent(group, part, parentPart) {
    const m = part.mount;
    if (!m || !parentPart) return;

    const [x, y, z] = m.pos;
    if (parentPart.kind === 'bone' && ridesFarHalf(part, parentPart)) {
      // the far group's origin sits at the joint, half way down the shaft
      group.position.set(x, y - parentPart.length / 2, z);
    } else {
      group.position.set(x, y, z);
    }
    group.quaternion.fromArray(m.rot);
  }

  /** Which group does a child belong in: the parent's own, or a bone half? */
  _hostGroupFor(part, parentPart) {
    const pnode = this.nodes.get(parentPart.id);
    if (parentPart.kind !== 'bone') return pnode.group;
    return ridesFarHalf(part, parentPart) ? pnode.far : pnode.near;
  }

  _buildBlock(part, parentGroup, parentPart) {
    const group = new THREE.Group();
    group.name = `block:${part.id}`;
    this._placeOnParent(group, part, parentPart);

    // Cached, unit-cube geometry; size lives on the transform.
    const geo = part.vox.geometry(this.assembly.palette);
    const mesh = new THREE.Mesh(geo, this.bodyMaterial);
    const [sx, sy, sz] = part.size;
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(-sx / 2, -sy / 2, -sz / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.partId = part.id;
    mesh.userData.kind = part.kind;
    group.add(mesh);

    const host = parentPart ? this._hostGroupFor(part, parentPart) : parentGroup;
    host.add(group);

    this.nodes.set(part.id, { part, group, mesh, host });
    this.pickables.push(mesh);

    for (const c of part.children) this._build(c, group, part);
  }

  _buildBone(part, parentGroup, parentPart) {
    const L = part.length;
    const r = part.radius;
    const meta = BONE_META[part.boneType];

    const group = new THREE.Group();   // bone root: +Y runs down the shaft
    group.name = `bone:${part.id}`;
    this._placeOnParent(group, part, parentPart);

    const mat = this.boneMaterial(part.boneType);

    // --- near half (rigid with the parent segment)
    const near = new THREE.Group();
    near.name = 'near';
    group.add(near);
    near.add(this._shaft(part, r, L / 2, mat));

    // --- joint pivot at the bone centre
    const joint = new THREE.Group();
    joint.name = 'joint';
    joint.position.set(0, L / 2, 0);
    group.add(joint);

    const knuckleGeo = new THREE.IcosahedronGeometry(r * 1.55, 1);
    this._owned.push(knuckleGeo);
    const knuckleMat = new THREE.MeshStandardMaterial({
      color: meta.color, metalness: 0.9, roughness: 0.25, flatShading: true,
    });
    this._ownedMaterials.push(knuckleMat);
    const knuckle = new THREE.Mesh(knuckleGeo, knuckleMat);
    knuckle.userData.partId = part.id;
    knuckle.userData.kind = 'bone';
    knuckle.castShadow = true;
    joint.add(knuckle);
    this.pickables.push(knuckle);

    // --- far half (articulated)
    const far = new THREE.Group();
    far.name = 'far';
    joint.add(far);
    far.add(this._shaft(part, r, L / 2, mat));

    const host = parentPart ? this._hostGroupFor(part, parentPart) : parentGroup;
    host.add(group);

    const node = { part, group, near, joint, far, mesh: knuckle, host, length: L, radius: r };
    this.nodes.set(part.id, node);
    this.joints.push(node);

    for (const c of part.children) this._build(c, group, part);
  }

  /** A shaft segment running from y=0 to y=len. */
  _shaft(part, radius, len, material) {
    const g = new THREE.Group();

    const shaftGeo = new THREE.CylinderGeometry(radius, radius, len, 8, 1, false);
    this._owned.push(shaftGeo);
    const shaft = new THREE.Mesh(shaftGeo, material);
    shaft.position.y = len / 2;
    shaft.castShadow = true;
    shaft.userData.partId = part.id;
    shaft.userData.kind = 'bone';
    g.add(shaft);
    this.pickables.push(shaft);

    // a collar at each end so the shaft reads as an inserted rod
    const collarGeo = new THREE.CylinderGeometry(radius * 1.35, radius * 1.35, radius * 0.5, 8);
    this._owned.push(collarGeo);
    for (const y of [radius * 0.4, len - radius * 0.4]) {
      const c = new THREE.Mesh(collarGeo, material);
      c.position.y = y;
      c.castShadow = true;
      g.add(c);
    }
    return g;
  }

  // ---------------------------------------------------------- analysis

  measure() {
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
    this.bounds = box;
    this.boundingRadius = box.getSize(_v).length() * 0.5;
    this.restLowestY = box.min.y;
    this.restHeight = box.max.y - box.min.y;
    return box;
  }

  /**
   * A limb is a chain of LEG bones from the body outward.
   * The chain root is a leg bone with no leg bone above it.
   */
  buildLimbs() {
    const limbs = [];
    for (const node of this.joints) {
      if (node.part.boneType !== 'leg') continue;
      if (this._hasLegAncestor(node.part)) continue;
      const chain = [node];
      let cursor = node;
      for (;;) {
        const next = this._firstLegDescendant(cursor.part);
        if (!next) break;
        chain.push(next);
        cursor = next;
      }
      limbs.push({ chain, root: node });
    }

    // Deterministic ordering: front-to-back, then left-to-right.
    this.root.updateMatrixWorld(true);
    for (const limb of limbs) {
      limb.anchor = limb.root.group.getWorldPosition(new THREE.Vector3());
    }
    limbs.sort((a, b) => (b.anchor.z - a.anchor.z) || (a.anchor.x - b.anchor.x));
    limbs.forEach((l, i) => { l.index = i; });

    this.limbs = limbs;
    this.armBones = this.joints.filter((n) => n.part.boneType === 'arm');
    this.faceBones = this.joints.filter((n) => n.part.boneType === 'face');
    this.customBones = this.joints.filter((n) => n.part.boneType === 'custom');
    return limbs;
  }

  _hasLegAncestor(part) {
    let cur = part.parent ? this.assembly.get(part.parent) : null;
    while (cur) {
      if (cur.kind === 'bone' && cur.boneType === 'leg') return true;
      cur = cur.parent ? this.assembly.get(cur.parent) : null;
    }
    return false;
  }

  _firstLegDescendant(part) {
    const stack = [...part.children];
    while (stack.length) {
      const p = this.assembly.get(stack.shift());
      if (!p) continue;
      if (p.kind === 'bone' && p.boneType === 'leg') return this.nodes.get(p.id);
      stack.push(...p.children);
    }
    return null;
  }

  // ---------------------------------------------------------- runtime

  /** Re-mesh one block in place, after a sculpt stroke. */
  refreshBlock(partId) {
    const node = this.nodes.get(partId);
    if (!node || node.part.kind === 'bone') return false;
    node.mesh.geometry = node.part.vox.geometry(this.assembly.palette);
    return true;
  }

  /** Apply a size change without rebuilding the whole hierarchy. */
  refreshSize(partId) {
    const node = this.nodes.get(partId);
    if (!node || node.part.kind === 'bone') return false;
    const [sx, sy, sz] = node.part.size;
    node.mesh.scale.set(sx, sy, sz);
    node.mesh.position.set(-sx / 2, -sy / 2, -sz / 2);
    return true;
  }

  /**
   * Apply a mount change without rebuilding, as long as the part has not
   * crossed a bone's midpoint (which would move it to the other half).
   * @returns {boolean} false when the caller must do a full rebuild
   */
  refreshMount(partId) {
    const node = this.nodes.get(partId);
    if (!node) return false;
    const parent = node.part.parent ? this.assembly.get(node.part.parent) : null;
    if (parent?.kind === 'bone') {
      const wanted = ridesFarHalf(node.part, parent) ? this.nodes.get(parent.id).far : this.nodes.get(parent.id).near;
      if (wanted !== node.host) return false;
    }
    this._placeOnParent(node.group, node.part, parent);
    return true;
  }

  /** Reset every joint to its rest pose. */
  resetPose() {
    for (const j of this.joints) j.joint.quaternion.identity();
  }

  dispose() {
    // Block geometry belongs to the VoxelBlock cache — leave it alone.
    for (const g of this._owned) g.dispose();
    for (const m of this._ownedMaterials) m.dispose();
    for (const m of this._boneMaterials.values()) m.dispose();
    this.bodyMaterial.dispose();
    this._owned.length = 0;
    this._ownedMaterials.length = 0;
    this.root.removeFromParent();
  }
}
