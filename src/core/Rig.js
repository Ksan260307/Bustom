import * as THREE from 'three';
import { BLOCK, BONE_META, BONE_GAUGE, FACE_NORMAL } from './constants.js';
import { greedyMesh } from './Voxel.js';

// ============================================================
//  Rig : turns an Assembly (data) into a live Three.js hierarchy.
//
//  Per bone the graph is
//     boneRoot ─ near-half mesh + near-slot blocks     (parent segment)
//        └ joint  ← THE articulated node
//             └ far ─ far-half mesh + far-slot blocks  (child segment)
//                        └ downstream bones ...
// ============================================================

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();

function alignYTo(normal, roll = 0) {
  const q = new THREE.Quaternion();
  if (normal.y < -0.9999) q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  else q.setFromUnitVectors(UP, normal);
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, (roll * Math.PI) / 2));
  return q;
}

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
    color,
    metalness: 0.75,
    roughness: 0.32,
    flatShading: true,
  });
}

export class Rig {
  /**
   * @param {import('./Assembly.js').Assembly} assembly
   * @param {{ ghostJoints?: boolean }} [opts]
   */
  constructor(assembly, opts = {}) {
    this.assembly = assembly;
    this.opts = opts;
    this.root = new THREE.Group();
    this.root.name = 'rig';

    /** partId -> { part, group, mesh, joint, near, far, tip } */
    this.nodes = new Map();
    /** every articulated node, in tree order */
    this.joints = [];
    /** pickable meshes, tagged with userData.partId */
    this.pickables = [];

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

    if (parentPart.kind === 'bone') {
      // Threaded onto the shaft, or chained off the tip.
      const L = parentPart.length;
      if (m.slot === 'tip') {
        group.position.set(0, L / 2, 0); // relative to the far group
        const n = _v.fromArray(FACE_NORMAL[m.face ?? 2]);
        group.quaternion.copy(alignYTo(n, m.roll ?? 0));
      } else {
        const y = m.slot + 0.5;
        const nearSide = y < L / 2;
        group.position.set(0, nearSide ? y : y - L / 2, 0);
        if (m.roll) group.quaternion.setFromAxisAngle(UP, (m.roll * Math.PI) / 2);
      }
    } else {
      // Mounted flat on a block face.
      const n = _v.fromArray(FACE_NORMAL[m.face]);
      if (part.kind === 'bone') {
        group.position.copy(n).multiplyScalar(BLOCK * 0.5);
        group.quaternion.copy(alignYTo(n, m.roll ?? 0));
      } else {
        group.position.copy(n).multiplyScalar(BLOCK);
      }
    }
  }

  /** Which group does a bone-mounted child belong in: near (rigid) or far (articulated)? */
  _hostGroupFor(part, parentPart, node) {
    if (parentPart.kind !== 'bone') return node.group;
    const pnode = this.nodes.get(parentPart.id);
    if (part.mount.slot === 'tip') return pnode.far;
    return part.mount.slot + 0.5 < parentPart.length / 2 ? pnode.near : pnode.far;
  }

  _buildBlock(part, parentGroup, parentPart) {
    const group = new THREE.Group();
    group.name = `block:${part.id}`;
    this._placeOnParent(group, part, parentPart);

    const geo = greedyMesh(part.vox);
    const mesh = new THREE.Mesh(geo, this.bodyMaterial);
    mesh.position.set(-BLOCK / 2, -BLOCK / 2, -BLOCK / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.partId = part.id;
    mesh.userData.kind = part.kind;
    group.add(mesh);

    const host = parentPart ? this._hostGroupFor(part, parentPart, this.nodes.get(parentPart.id)) : parentGroup;
    host.add(group);

    const node = { part, group, mesh, host };
    this.nodes.set(part.id, node);
    this.pickables.push(mesh);

    for (const c of part.children) this._build(c, group, part);
  }

  _buildBone(part, parentGroup, parentPart) {
    const L = part.length;
    const gauge = BONE_GAUGE[part.gauge] ?? BONE_GAUGE.thick;
    const r = gauge.radius;
    const meta = BONE_META[part.boneType];

    const group = new THREE.Group();   // bone root: origin at the mount face, +Y = shaft
    group.name = `bone:${part.id}`;
    this._placeOnParent(group, part, parentPart);

    const mat = this.boneMaterial(part.boneType);

    // --- near half (rigid with the parent segment)
    const near = new THREE.Group();
    near.name = 'near';
    group.add(near);
    near.add(this._shaft(r, L / 2, mat, part.id, 0));

    // --- joint pivot at the bone centre
    const joint = new THREE.Group();
    joint.name = 'joint';
    joint.position.set(0, L / 2, 0);
    group.add(joint);

    const knuckle = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r * 1.55, 1),
      new THREE.MeshStandardMaterial({ color: meta.color, metalness: 0.9, roughness: 0.25, flatShading: true }),
    );
    knuckle.userData.partId = part.id;
    knuckle.userData.kind = 'bone';
    knuckle.castShadow = true;
    joint.add(knuckle);
    this.pickables.push(knuckle);

    // --- far half (articulated)
    const far = new THREE.Group();
    far.name = 'far';
    joint.add(far);
    far.add(this._shaft(r, L / 2, mat, part.id, 0));

    const host = parentPart ? this._hostGroupFor(part, parentPart, this.nodes.get(parentPart.id)) : parentGroup;
    host.add(group);

    const node = { part, group, near, joint, far, mesh: knuckle, host, length: L, radius: r };
    this.nodes.set(part.id, node);
    this.joints.push(node);

    for (const c of part.children) this._build(c, group, part);
  }

  /** A shaft segment running from y=0 to y=len, with slot collars. */
  _shaft(radius, len, material, partId) {
    const g = new THREE.Group();

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8, 1, false), material);
    shaft.position.y = len / 2;
    shaft.castShadow = true;
    shaft.userData.partId = partId;
    shaft.userData.kind = 'bone';
    g.add(shaft);
    this.pickables.push(shaft);

    // collars mark where blocks thread on
    const collarGeo = new THREE.CylinderGeometry(radius * 1.45, radius * 1.45, 0.07, 8);
    for (let i = 0; i <= Math.round(len); i++) {
      if (i === 0) continue;
      const c = new THREE.Mesh(collarGeo, material);
      c.position.y = i;
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
      // follow the first downstream leg bone at each step
      for (;;) {
        const next = this._firstLegDescendant(cursor.part);
        if (!next) break;
        chain.push(next);
        cursor = next;
      }
      limbs.push({ chain, root: node });
    }

    // Deterministic ordering: left-to-right by rest X, then front-to-back.
    this.root.updateMatrixWorld(true);
    for (const limb of limbs) {
      limb.anchor = limb.root.group.getWorldPosition(new THREE.Vector3());
    }
    limbs.sort((a, b) => (a.anchor.z - b.anchor.z) || (a.anchor.x - b.anchor.x));
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

  /**
   * Re-mesh one block in place. The editor calls this on every brush stroke,
   * so it must never touch the rest of the hierarchy.
   */
  refreshBlock(partId) {
    const node = this.nodes.get(partId);
    if (!node || node.part.kind === 'bone') return false;
    const next = greedyMesh(node.part.vox);
    node.mesh.geometry.dispose();
    node.mesh.geometry = next;
    return true;
  }

  /** Reset every joint to its rest pose. */
  resetPose() {
    for (const j of this.joints) j.joint.quaternion.identity();
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.bodyMaterial.dispose();
    for (const m of this._boneMaterials.values()) m.dispose();
  }
}

// ============================================================
//  Socket enumeration for the editor
// ============================================================

/**
 * Every legal place a new part could be mounted, in world space.
 * Pass `only` (a Set of part ids) to limit the enumeration to the parts the
 * builder is actually pointing at — showing all of them at once buries the
 * model under wireframe.
 * @returns {Array<{parentId, mount, kind, position: THREE.Vector3, normal: THREE.Vector3}>}
 */
export function enumerateSockets(assembly, rig, { forBone = false, only = null } = {}) {
  const out = [];
  rig.root.updateMatrixWorld(true);

  for (const [id, node] of rig.nodes) {
    if (only && !only.has(id)) continue;
    const part = node.part;

    if (part.kind === 'bone') {
      const L = part.length;
      for (let slot = 0; slot < L; slot++) {
        if (assembly.isSlotOccupied(id, slot)) continue;
        if (forBone) continue; // bones thread only onto the tip
        const y = slot + 0.5;
        const nearSide = y < L / 2;
        const host = nearSide ? node.near : node.far;
        const local = new THREE.Vector3(0, nearSide ? y : y - L / 2, 0);
        out.push({
          parentId: id,
          mount: { slot, roll: 0 },
          kind: 'slot',
          position: host.localToWorld(local.clone()),
          normal: host.getWorldDirection(new THREE.Vector3()).normalize(),
        });
      }
      // tip socket: chain another bone or cap it with a block
      if (!assembly.isSlotOccupied(id, 'tip')) {
        const local = new THREE.Vector3(0, L / 2, 0);
        out.push({
          parentId: id,
          mount: { slot: 'tip', face: 2, roll: 0 },
          kind: 'tip',
          position: node.far.localToWorld(local.clone()),
          normal: new THREE.Vector3(0, 1, 0).applyQuaternion(node.far.getWorldQuaternion(new THREE.Quaternion())),
        });
      }
      continue;
    }

    // block / core : six faces
    for (let face = 0; face < 6; face++) {
      if (assembly.isFaceOccupied(id, face)) continue;
      const n = new THREE.Vector3().fromArray(FACE_NORMAL[face]);
      const local = n.clone().multiplyScalar(forBone ? BLOCK * 0.5 : BLOCK);
      out.push({
        parentId: id,
        mount: { face, roll: 0 },
        kind: 'face',
        position: node.group.localToWorld(local),
        normal: n.clone().applyQuaternion(node.group.getWorldQuaternion(new THREE.Quaternion())),
      });
    }
  }
  return out;
}
