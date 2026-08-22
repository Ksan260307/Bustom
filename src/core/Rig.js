import * as THREE from 'three';
import { BONE_META, EQUIP_META, EQUIP_THICKNESS, equipShape } from './constants.js';

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
    /** every equipment plate, in tree order */
    this.equipNodes = [];
    /** blocks a ROLLING plate keeps turning */
    this.rollers = [];
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
    else if (part.kind === 'equip') this._buildEquip(part, parentGroup, parentPart);
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
    if (parentPart.kind !== 'bone') return pnode.spin ?? pnode.group;
    return ridesFarHalf(part, parentPart) ? pnode.far : pnode.near;
  }

  _buildBlock(part, parentGroup, parentPart) {
    const group = new THREE.Group();
    group.name = `block:${part.id}`;
    this._placeOnParent(group, part, parentPart);

    // A ROLLING plate turns the block it is stuck to, so the block's contents
    // — mesh and everything mounted on it — live one level down, inside a
    // group that is free to spin. The root never spins: turning the core
    // would take the whole machine with it.
    let spin = null;
    if (part.id !== this.assembly.rootId && this._rollerOn(part)) {
      spin = new THREE.Group();
      spin.name = 'spin';
      group.add(spin);
    }
    const inner = spin ?? group;

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
    inner.add(mesh);

    const host = parentPart ? this._hostGroupFor(part, parentPart) : parentGroup;
    host.add(group);

    this.nodes.set(part.id, { part, group, spin, mesh, host });
    this.pickables.push(mesh);

    for (const c of part.children) this._build(c, group, part);
  }

  /** The ROLLING plate mounted directly on this part, if any. */
  _rollerOn(part) {
    for (const id of part.children) {
      const child = this.assembly.get(id);
      if (child?.kind === 'equip' && child.equipType === 'rolling' && child.spin) return child;
    }
    return null;
  }

  // ---------------------------------------------------------- equipment

  /**
   * A plate: one thin slab lying on the surface, plus an emissive inset so
   * the player can tell at a glance what is fitted and — for the weapons
   * that allow it — what colour it will fire.
   *
   * The plate's local +Y is its facing. Placed on a face the mount already
   * points +Y down the face normal, so the slab lies flat and the inset
   * looks outward with no extra work.
   */
  _buildEquip(part, parentGroup, parentPart) {
    const group = new THREE.Group();
    group.name = `equip:${part.id}`;
    this._placeOnParent(group, part, parentPart);

    const meta = EQUIP_META[part.equipType] ?? EQUIP_META.beam;
    const round = equipShape(part.equipType) === 'round';
    const d = part.size;
    const t = EQUIP_THICKNESS;

    const plateGeo = round
      ? new THREE.CylinderGeometry(d / 2, d / 2, t, 24)
      : new THREE.BoxGeometry(d, t, d);
    this._owned.push(plateGeo);
    const plateMat = new THREE.MeshStandardMaterial({
      color: meta.plate, metalness: 0.72, roughness: 0.36, flatShading: !round,
    });
    this._ownedMaterials.push(plateMat);
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.y = t / 2;
    plate.castShadow = true;
    plate.userData.partId = part.id;
    plate.userData.kind = 'equip';
    group.add(plate);
    this.pickables.push(plate);

    // The inset carries the bullet colour where the player may choose it.
    const accentColor = part.bulletColor ?? meta.accent;
    const k = round ? 0.62 : 0.52;
    const accentGeo = round
      ? new THREE.CylinderGeometry((d / 2) * k, (d / 2) * k, t * 0.9, 20)
      : new THREE.BoxGeometry(d * k, t * 0.9, d * k);
    this._owned.push(accentGeo);
    const accentMat = new THREE.MeshStandardMaterial({
      color: accentColor, emissive: accentColor, emissiveIntensity: 0.85,
      metalness: 0.2, roughness: 0.4,
    });
    this._ownedMaterials.push(accentMat);
    const accent = new THREE.Mesh(accentGeo, accentMat);
    accent.position.y = t * 0.75;
    accent.userData.partId = part.id;
    accent.userData.kind = 'equip';
    group.add(accent);
    this.pickables.push(accent);

    const host = parentPart ? this._hostGroupFor(part, parentPart) : parentGroup;
    host.add(group);

    const node = { part, group, mesh: plate, plate, accent, host, meta };
    if (part.equipType === 'blade') node.bladeGlow = this._bladeGlow(part, parentPart, host);
    if (part.equipType === 'boost') node.boostFlare = this._boostFlare(part, group);
    this.nodes.set(part.id, node);
    this.equipNodes.push(node);

    // The plate's own facing IS the axis it turns the block about: where you
    // stuck it decides which way the thing spins, with no extra setting.
    const pnode = parentPart ? this.nodes.get(parentPart.id) : null;
    if (part.equipType === 'rolling' && part.spin && pnode?.spin) {
      node.roller = {
        part,
        spin: pnode.spin,
        axis: new THREE.Vector3(0, 1, 0)
          .applyQuaternion(new THREE.Quaternion().fromArray(part.mount.rot)).normalize(),
        angle: 0,
      };
      this.rollers.push(node.roller);
    }

    for (const c of part.children) this._build(c, group, part);
  }

  /**
   * The shell that lights up while a blade is held. It wraps the part the
   * plate is stuck to — "the block it is attached to glows" — so a blade on
   * a shin lights the shin, not the whole machine.
   */
  _bladeGlow(part, parentPart, host) {
    const pnode = parentPart ? this.nodes.get(parentPart.id) : null;
    const color = EQUIP_META.blade.accent;
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.BackSide,
    });
    this._ownedMaterials.push(mat);

    let mesh;
    if (pnode && parentPart.kind !== 'bone' && pnode.mesh?.geometry) {
      // Same silhouette as the block, a touch proud of it.
      mesh = new THREE.Mesh(pnode.mesh.geometry, mat);
      mesh.scale.copy(pnode.mesh.scale).multiplyScalar(1.07);
      mesh.position.copy(pnode.mesh.position).multiplyScalar(1.07);
      pnode.group.add(mesh);
    } else {
      const geo = new THREE.IcosahedronGeometry(Math.max(0.4, part.size * 0.9), 1);
      this._owned.push(geo);
      mesh = new THREE.Mesh(geo, mat);
      host.add(mesh);
    }
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
  }

  /**
   * Advance every rolling block. Called every frame in both the editor and
   * the field: a plate whose whole job is "it is always turning" has to be
   * turning while you look at it.
   */
  updateRollers(dt) {
    for (const r of this.rollers) {
      const { dir, rpm } = r.part.spin;
      r.angle = (r.angle + dir * rpm * (Math.PI / 30) * dt) % (Math.PI * 2);
      r.spin.quaternion.setFromAxisAngle(r.axis, r.angle);
    }
    return this;
  }

  /**
   * The flame a BOOST plate throws while the thruster is lit. It fires along
   * the plate's own facing (+Y), so a plate stuck on the back pushes you
   * forward and one on the belly pushes you up — where you put it is what it
   * does, exactly like the rolling plate's axis.
   */
  _boostFlare(part, group) {
    const d = part.size;
    const meta = EQUIP_META.boost;

    const flare = new THREE.Group();
    flare.position.y = EQUIP_THICKNESS;
    flare.visible = false;
    group.add(flare);

    const coneGeo = new THREE.ConeGeometry(d * 0.34, d * 1.9, 12, 1, true);
    coneGeo.translate(0, d * 0.95, 0);       // base at the plate, tip outward
    this._owned.push(coneGeo);
    const coneMat = new THREE.MeshBasicMaterial({
      color: meta.accent, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this._ownedMaterials.push(coneMat);
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.frustumCulled = false;
    flare.add(cone);

    // A bright disc right on the plate face, so the source reads even when
    // the flame is edge-on to the camera.
    const discGeo = new THREE.CircleGeometry(d * 0.44, 16);
    discGeo.rotateX(-Math.PI / 2);
    this._owned.push(discGeo);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this._ownedMaterials.push(discMat);
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.y = 0.01;
    disc.frustumCulled = false;
    flare.add(disc);

    return { group: flare, cone, disc, size: d };
  }

  /** 0..1 — how hard the boost thrusters are burning right now. */
  setBoostGlow(amount, flicker = 0) {
    for (const node of this.equipNodes) {
      const f = node.boostFlare;
      if (!f) continue;
      const on = amount > 0.01;
      f.group.visible = on;
      if (!on) continue;
      const wobble = 1 + flicker * 0.18;
      f.cone.material.opacity = amount * 0.55;
      f.cone.scale.set(1, amount * wobble, 1);
      f.disc.material.opacity = amount * 0.8;
      f.disc.scale.setScalar(0.6 + amount * 0.7);
      node.accent.material.emissiveIntensity = 0.85 + amount * 3.2;
    }
    return this;
  }

  /** 0..1 — how hard every blade on this machine is lit right now. */
  setBladeGlow(amount) {
    for (const node of this.equipNodes) {
      if (!node.bladeGlow) continue;
      node.bladeGlow.visible = amount > 0.01;
      node.bladeGlow.material.opacity = amount * 0.55;
      node.accent.material.emissiveIntensity = 0.85 + amount * 2.4;
    }
    return this;
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
    if (!node || !node.part.vox) return false;
    node.mesh.geometry = node.part.vox.geometry(this.assembly.palette);
    return true;
  }

  /** Apply a size change without rebuilding the whole hierarchy. */
  refreshSize(partId) {
    const node = this.nodes.get(partId);
    if (!node || node.part.kind === 'bone' || node.part.kind === 'equip') return false;
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
    // A rolling plate's axis is baked from its mount, so moving one is a rebuild.
    if (node.roller) return false;
    const parent = node.part.parent ? this.assembly.get(node.part.parent) : null;
    if (parent?.kind === 'bone') {
      const wanted = ridesFarHalf(node.part, parent) ? this.nodes.get(parent.id).far : this.nodes.get(parent.id).near;
      if (wanted !== node.host) return false;
    }
    this._placeOnParent(node.group, node.part, parent);
    return true;
  }

  /**
   * Re-cut one plate after a size, type or colour change, without touching
   * the rest of the hierarchy.
   * @returns {boolean} false when the caller must do a full rebuild
   */
  refreshEquip(partId) {
    const node = this.nodes.get(partId);
    if (!node || node.part.kind !== 'equip') return false;
    const part = node.part;
    const meta = EQUIP_META[part.equipType];
    if (!meta) return false;
    // The blade shell and the roller are both bound to the host at build
    // time, so gaining or losing either one is a rebuild, not a re-cut.
    if ((part.equipType === 'blade') !== !!node.bladeGlow) return false;
    if ((part.equipType === 'rolling') !== !!node.roller) return false;

    const round = equipShape(part.equipType) === 'round';
    const d = part.size;
    const t = EQUIP_THICKNESS;
    const k = round ? 0.62 : 0.52;

    node.plate.geometry = round
      ? new THREE.CylinderGeometry(d / 2, d / 2, t, 24)
      : new THREE.BoxGeometry(d, t, d);
    node.accent.geometry = round
      ? new THREE.CylinderGeometry((d / 2) * k, (d / 2) * k, t * 0.9, 20)
      : new THREE.BoxGeometry(d * k, t * 0.9, d * k);
    this._owned.push(node.plate.geometry, node.accent.geometry);

    const accentColor = part.bulletColor ?? meta.accent;
    node.plate.material.color.setHex(meta.plate);
    node.accent.material.color.setHex(accentColor);
    node.accent.material.emissive.setHex(accentColor);
    node.meta = meta;
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
