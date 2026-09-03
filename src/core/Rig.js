import * as THREE from 'three';
import {
  BONE_META, EQUIP_META, EQUIP_THICKNESS, equipShape, snapCircleRadius,
} from './constants.js';
import { fxSprite } from '../game/Kit.js';
import { touchesLine } from './Assembly.js';

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
    // The environment supplies the sheen instead — a painted panel catching
    // the sky, rather than a chrome one losing its colour to it.
    metalness: 0.22,
    roughness: 0.46,
    envMapIntensity: 0.85,
    // Unlit means ZERO, not "black at full intensity". Both look the same,
    // but only one of them lets "is this machine lit" be a question with an
    // answer. See setHitFlash.
    emissiveIntensity: 0,
  });
}

function makeBoneMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color, metalness: 0.85, roughness: 0.24, flatShading: true,
    emissiveIntensity: 0,
    // Bones ARE the chrome. With a sky to reflect they finally read as
    // machined metal instead of grey plastic.
    envMapIntensity: 1.35,
  });
}

/** Does this part ride the far (articulated) half of its bone parent? */
export function ridesFarHalf(part, parentPart) {
  if (!parentPart || parentPart.kind !== 'bone' || !part.mount) return false;
  return part.mount.pos[1] >= parentPart.length / 2;
}

/** The colour of the building aid a CIRCLE plate draws around itself. */
const RING_GUIDE_COLOR = 0x4fd2ff;

const _ringInv = new THREE.Quaternion();
const _ringBase = new THREE.Matrix4();
const _ringBaseInv = new THREE.Matrix4();
const _ringHome = new THREE.Matrix4();
const _ringLocal2 = new THREE.Matrix4();
const _ringPos = new THREE.Vector3();
const _ringQuat = new THREE.Quaternion();
const _ringScale = new THREE.Vector3();
const _hostInv = new THREE.Matrix4();
const _fitPos = new THREE.Vector3();
const _fitQuat = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);

/**
 * Groups whose transform is written every frame by something.
 *
 * Crossing one of these leaves the rigid body the plate belongs to, which is
 * where a circle's reach stops.
 */
const ANIMATED_FRAMES = new Set(['joint', 'spin', 'ring']);

const _tiltPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const _tiltRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);

/** The extra turn a CIRCLE plate's chosen plane asks for, or null for none. */
function ringTilt(plane) {
  if (plane === 'pitch') return _tiltPitch;
  if (plane === 'roll') return _tiltRoll;
  return null;
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
    this.rings = [];
    /** The circle lines a CIRCLE plate draws. Editor only; see _buildRings. */
    this.ringGuides = [];
    this.showRingGuides = false;
    /** pickable meshes, tagged with userData.partId */
    this.pickables = [];
    /** geometry + materials this rig created itself and must dispose */
    this._owned = [];
    this._ownedMaterials = [];

    this.bodyMaterial = makeBodyMaterial();
    this._boneMaterials = new Map();
    /** Last hit-flash level written, so an unlit machine costs nothing. */
    this._flashed = 0;

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
    // So a walk over the scene graph can tell which part a group IS, not
    // merely which part its meshes belong to.
    group.userData.partId = part.id;
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

  /**
   * Hand every CIRCLE plate the parts it is meant to turn.
   *
   * A rolling plate spins the block it is stuck to. A circle plate lays down
   * a LINE — a circle of the given radius, centred on the plate — and
   * carries whatever is sitting on that line around it. So it cannot be done
   * while building: the parts it collects are scattered all over the machine,
   * and most of them do not exist yet when the plate is reached.
   *
   * On the line, not inside it. A disc that turned everything within its
   * radius made the radius slider mean "how much of the machine comes with
   * me", which is not a thing anyone wants to dial in. A line means you can
   * see where to put things, which is why the editor draws it.
   *
   * Membership is the plain question of whether the part's body reaches the
   * line — which is why a tower standing on the plate turns with it however
   * high it goes, and why something at the same radius but a metre above the
   * plane does not.
   */
  _buildRings() {
    // Everything below reads world matrices to compare parts that live in
    // different branches, so they have to be current first.
    this.root.updateMatrixWorld(true);
    for (const node of this.equipNodes) {
      const part = node.part;
      if (!EQUIP_META[part.equipType]?.ring || !part.spin) continue;
      const host = part.parent ? this.nodes.get(part.parent) : null;
      if (!host) continue;

      const base = new THREE.Group();
      base.name = 'ringbase';
      base.position.fromArray(part.mount.pos);
      base.quaternion.fromArray(part.mount.rot);
      // Turn the whole ring frame, not just the drawing: membership is
      // measured in this frame, so tilting it moves both the line and the
      // question of who is standing on it. They cannot be allowed to differ.
      const tilt = ringTilt(part.ringPlane);
      if (tilt) base.quaternion.multiply(tilt);
      const spin = new THREE.Group();
      spin.name = 'ring';
      base.add(spin);
      (host.spin ?? host.group).add(base);

      const baseLocal = _ringBase.compose(base.position, base.quaternion, _one);
      const baseLocalInv = _ringBaseInv.copy(baseLocal).invert();
      // Candidates are not necessarily mounted on the same block as the
      // plate, so their own matrices are in all sorts of frames. Everything
      // is brought into the HOST's frame first, which is the one the plate
      // and its ring live in.
      const hostFrame = host.spin ?? host.group;
      const intoHost = _hostInv.copy(hostFrame.matrixWorld).invert();

      const members = [];
      for (const candidate of this._ringCandidates(host, part)) {
        const home = _ringHome.multiplyMatrices(intoHost, candidate.matrixWorld);
        const local = _ringLocal2.multiplyMatrices(baseLocalInv, home);
        local.decompose(_ringPos, _ringQuat, _ringScale);

        const other = this.nodes.get(candidate.userData.partId);
        if (!other) continue;
        if (!touchesLine(other.part, _ringPos, _ringQuat, part.ringRadius)) continue;

        // Its home is remembered in the HOST's frame, which nothing animates
        // — so the ring can be moved later and still put its riders back
        // exactly where they belong. See syncRings.
        other.ringHome = home.clone();
        other.ringFrame = hostFrame;
        candidate.position.copy(_ringPos);
        candidate.quaternion.copy(_ringQuat);
        spin.add(candidate);
        members.push(other.part.id);
      }

      // The line itself, drawn at the plate's own radius. Hidden by default:
      // it is a building aid, and a machine in the field should not be
      // wearing its scaffolding. The editor switches it on.
      const guide = new THREE.Mesh(
        new THREE.TorusGeometry(Math.max(0.05, part.ringRadius), 0.035, 6, 96),
        new THREE.MeshBasicMaterial({
          color: RING_GUIDE_COLOR, transparent: true, opacity: 0.85,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      guide.rotation.x = -Math.PI / 2;      // the ring's plane is the plate's
      guide.visible = this.showRingGuides;
      guide.renderOrder = 3;
      base.add(guide);
      this._owned.push(guide.geometry);
      this._ownedMaterials.push(guide.material);
      this.ringGuides.push(guide);

      node.ring = {
        part,
        base,
        spin,
        axis: new THREE.Vector3(0, 1, 0),   // the ring's own frame is the plate's
        angle: 0,
        members,
        guide,
      };
      this.rings.push(node.ring);
    }
  }

  /**
   * The circle that would pick up the most of what is already standing
   * around this plate, or null when there is nothing to measure.
   *
   * Asked for once, when a plate is first stuck on. A fixed default cannot
   * do this job: two metres is wider than most machines, so a new plate
   * used to draw its line out past everything and carry nothing at all. It
   * looked broken, and the only way out was to guess at the radius slider
   * until something moved. The parts are right there when the plate goes
   * on — so the plate looks.
   *
   * Measured over the same candidates the ring would really collect, from
   * the real built positions. Working it out from mounts instead would get
   * a part hanging off a different block wrong, which is exactly the case
   * worth getting right.
   */
  fitRingRadius(plateId) {
    const node = this.nodes.get(plateId);
    const part = node?.part;
    if (!part || !EQUIP_META[part.equipType]?.ring) return null;
    const host = part.parent ? this.nodes.get(part.parent) : null;
    if (!host) return null;

    // The plate's own frame, tilt included: the same one membership uses.
    _ringQuat.fromArray(part.mount.rot);
    const tilt = ringTilt(part.ringPlane);
    if (tilt) _ringQuat.multiply(tilt);
    _ringPos.fromArray(part.mount.pos);
    const baseInv = _ringBaseInv.compose(_ringPos, _ringQuat, _one).invert();
    this.root.updateMatrixWorld(true);

    const hostFrame = host.spin ?? host.group;
    const intoHost = _hostInv.copy(hostFrame.matrixWorld).invert();

    const seen = [];
    const measure = (candidatePart, homeMatrix) => {
      _ringLocal2.multiplyMatrices(baseInv, homeMatrix)
        .decompose(_fitPos, _fitQuat, _ringScale);
      const flat = Math.hypot(_fitPos.x, _fitPos.z);
      if (flat < 1e-6) return;                       // sitting on the plate
      seen.push({ part: candidatePart, pos: _fitPos.clone(), quat: _fitQuat.clone(), flat });
    };

    // Whatever this ring already carries. They are inside it by now, so the
    // walk below cannot see them — and leaving them out would fit the circle
    // to everything EXCEPT the parts it is currently turning.
    for (const id of node.ring?.members ?? []) {
      const rider = this.nodes.get(id);
      if (rider?.ringHome) measure(rider.part, rider.ringHome);
    }
    for (const candidate of this._ringCandidates(host, part)) {
      const other = this.nodes.get(candidate.userData.partId);
      if (!other) continue;
      measure(other.part, _ringHome.multiplyMatrices(intoHost, candidate.matrixWorld));
    }
    if (!seen.length) return null;

    // Every candidate's own distance is a circle worth trying; the winner
    // touches the most of them, and is the tightest when several tie.
    let best = null;
    let bestCount = 0;
    for (const candidate of seen) {
      const radius = snapCircleRadius(candidate.flat);
      let count = 0;
      for (const other of seen) {
        if (touchesLine(other.part, other.pos, other.quat, radius)) count++;
      }
      if (count > bestCount || (count === bestCount && count > 0 && radius < best)) {
        best = radius;
        bestCount = count;
      }
    }
    return bestCount ? best : null;
  }

  /**
   * Every part a circle could pick up.
   *
   * The rule the builder is given is the one they can see: a part rides the
   * circle when its body touches the LINE. So the search has to reach
   * wherever the line does, and which block a part happens to hang off is
   * bookkeeping they should never have to think about. It kept leaking out
   * as "the gimmick does not work" — first for a pod on the block next
   * door, then for one on the body below a plate stuck on the head.
   *
   * So the walk follows the plate's own line of hosts all the way down to
   * the machine's root, joints and all, and takes every branch hanging off
   * it. Going UP through a joint costs nothing: a part above the plate is
   * simply carried by that joint as well once the ring has it, which is what
   * being bolted to a ring on a nodding head should look like.
   *
   * Going DOWN through one is different, and stops the walk. Past a joint
   * the part already has something animating it — the hand belongs to the
   * arm — and a ring that took it would leave the arm swinging empty.
   *
   * The plate's own hosts are never candidates. A ring cannot carry what it
   * is standing on, and re-parenting one of them would tie the tree in a
   * knot.
   */
  _ringCandidates(host, plate) {
    const hostFrame = host.spin ?? host.group;

    // The plate's hosts, all the way up. The walk starts at the far end of
    // this and follows it back down, so every branch off it is in reach.
    const spine = new Set();
    let top = hostFrame;
    for (let g = hostFrame; g; g = g.parent) {
      spine.add(g);
      top = g;
    }

    const found = [];
    const walk = (group) => {
      for (const child of group.children) {
        if (!child.isObject3D || child.isMesh) continue;
        // The plate's own line: never a candidate, always followed.
        if (spine.has(child)) {
          walk(child);
          continue;
        }
        // Another frame's business: a joint, something already spinning, or
        // a circle that got here first.
        if (ANIMATED_FRAMES.has(child.name) || child.name === 'ringbase') continue;
        const id = child.userData.partId;
        if (id && id !== plate.id) {
          // A subtree root: whatever is mounted on it comes along with it.
          found.push(child);
          continue;
        }
        walk(child);
      }
    };
    walk(top);
    return found;
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
      // Above 1 so the bright pass finds it: an accent light that does not
      // spill is a sticker, not a lamp.
      color: accentColor, emissive: accentColor, emissiveIntensity: 1.9,
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

    const shells = [];
    /** A shell that copies one block's silhouette, a touch proud of it. */
    const wrap = (node) => {
      if (!node?.mesh?.geometry) return;
      const m = new THREE.Mesh(node.mesh.geometry, mat);
      m.scale.copy(node.mesh.scale).multiplyScalar(1.07);
      m.position.copy(node.mesh.position).multiplyScalar(1.07);
      m.frustumCulled = false;
      m.visible = false;
      (node.spin ?? node.group).add(m);
      shells.push(m);
    };

    if (pnode && parentPart.kind !== 'bone' && pnode.mesh?.geometry) {
      // The blade lights the block it is stuck to AND everything joined to
      // it, so a blade on a wing lights the whole wing. Bones stop the run:
      // past a joint it is a different limb, not the same edge.
      wrap(pnode);
      const spread = (p) => {
        for (const id of p.children) {
          const child = this.assembly.get(id);
          if (!child || child.kind === 'bone' || child.kind === 'equip') continue;
          wrap(this.nodes.get(id));
          spread(child);
        }
      };
      spread(parentPart);
    } else {
      const geo = new THREE.IcosahedronGeometry(Math.max(0.4, part.size * 0.9), 1);
      this._owned.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.visible = false;
      host.add(m);
      shells.push(m);
    }

    // One material behind however many shells, so the whole run lights and
    // dims as a single thing.
    return { material: mat, meshes: shells };
  }

  /**
   * Advance every rolling block. Called every frame in both the editor and
   * the field: a plate whose whole job is "it is always turning" has to be
   * turning while you look at it.
   */
  updateRollers(dt) {
    // Two loops rather than one over a joined array: the spread allocated a
    // fresh array for every machine on every frame, to iterate a list that
    // is usually empty.
    for (const r of this.rollers) this._advanceSpin(r, dt);
    for (const r of this.rings) this._advanceSpin(r, dt);
    return this;
  }

  _advanceSpin(r, dt) {
    if (r.paused) return;
    const { dir, rpm } = r.part.spin;
    r.angle = (r.angle + dir * rpm * (Math.PI / 30) * dt) % (Math.PI * 2);
    r.spin.quaternion.setFromAxisAngle(r.axis, r.angle);
  }

  /**
   * Put every ring back where its plate is, and its riders back where theirs
   * are.
   *
   * The ring lives in a frame of its own, written once when the rig is
   * built. Drag the plate and the frame stays behind, so the line is left
   * hanging in the air next to a plate that has walked off — and the parts
   * riding it walk off too, since they are parented into that frame.
   *
   * Everything here is DERIVED from the mounts, so re-deriving it costs
   * nothing and cannot drift. Which parts are on the line is a separate
   * question, settled when the rig is rebuilt: re-collecting mid-drag would
   * mean parts joining and leaving the ring on every mouse move.
   */
  syncRings() {
    for (const r of this.rings) {
      const mount = r.part.mount;
      if (!mount) continue;
      r.base.position.fromArray(mount.pos);
      r.base.quaternion.fromArray(mount.rot);
      const tilt = ringTilt(r.part.ringPlane);
      if (tilt) r.base.quaternion.multiply(tilt);

      // The riders are parented into the ring, but they belong where they
      // were put. Each one remembers its home in the HOST's frame — which
      // nothing animates — so it can be re-expressed in the frame the ring
      // is in NOW. Without this, moving the plate drags every rider with it.
      _ringBase.compose(r.base.position, r.base.quaternion, _one);
      _ringBaseInv.copy(_ringBase).invert();
      for (const id of r.members) {
        const node = this.nodes.get(id);
        if (!node?.ringHome) continue;
        _ringLocal2.multiplyMatrices(_ringBaseInv, node.ringHome);
        _ringLocal2.decompose(_ringPos, _ringQuat, _ringScale);
        node.group.position.copy(_ringPos);
        node.group.quaternion.copy(_ringQuat);
      }
    }
    return this;
  }

  /**
   * A rider has been moved by hand: remember where it is now.
   *
   * Its remembered home is what syncRings puts it back to every frame, so a
   * rider dragged without this would snap out from under the cursor and
   * back to where the ring picked it up. Anything that is not riding a ring
   * is left alone.
   */
  rehomeRider(id, world) {
    const node = this.nodes.get(id);
    if (!node?.ringHome || !node.ringFrame) return false;
    node.ringFrame.updateWorldMatrix(true, false);
    node.ringHome.copy(_hostInv.copy(node.ringFrame.matrixWorld).invert().multiply(world));
    return true;
  }

  /**
   * Show or hide every circle line at once.
   *
   * Remembered on the rig, because the answer has to survive a rebuild —
   * which happens on every edit, and a guide that blinked out each time you
   * placed a block would be worse than not having one.
   */
  setRingGuides(on) {
    this.showRingGuides = !!on;
    for (const g of this.ringGuides) g.visible = this.showRingGuides;
    return this;
  }

  /** Stop or start one gimmick, by the id of the plate that drives it. */
  setGimmickPaused(partId, paused) {
    for (const r of [...this.rollers, ...this.rings]) {
      if (r.part.id === partId) r.paused = !!paused;
    }
    return this;
  }

  /** Does anything on this machine turn under its own power? */
  get hasMovingParts() { return this.rollers.length > 0 || this.rings.length > 0; }

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

    /**
     * The flame itself, as a photograph rather than as a cone.
     *
     * Two cards crossed at right angles, not one facing the camera. A
     * thruster is bolted to a machine that turns, and the rig has no camera
     * to face — a crossed pair reads from every angle for the price of one
     * more quad, and never swings round as you orbit the machine, which a
     * billboard visibly does when it is this close to the eye.
     */
    const plume = fxSprite('flame');
    const cards = [];
    if (plume) {
      const cardGeo = new THREE.PlaneGeometry(d * 1.5, d * 2.4);
      cardGeo.translate(0, d * 1.05, 0);
      this._owned.push(cardGeo);
      const cardMat = new THREE.MeshBasicMaterial({
        map: plume, color: meta.accent, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      this._ownedMaterials.push(cardMat);
      for (const turn of [0, Math.PI / 2]) {
        const card = new THREE.Mesh(cardGeo, cardMat);
        card.rotation.y = turn;
        card.frustumCulled = false;
        flare.add(card);
        cards.push(card);
      }
    }

    return { group: flare, cone, disc, cards, size: d };
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
      // Trimmed once bloom arrived: the flare now spills light of its own,
      // and at full opacity the core of it just clipped to white.
      f.disc.material.opacity = amount * 0.55;
      f.disc.scale.setScalar(0.6 + amount * 0.7);
      if (f.cards?.length) {
        // Longer with output, and jittering on its own so a held burn is
        // not a still picture of a flame.
        f.cards[0].material.opacity = amount * 0.85;
        for (const card of f.cards) card.scale.set(wobble, amount * (0.7 + wobble * 0.5), 1);
      }
      node.accent.material.emissiveIntensity = 1.9 + amount * 4.2;
    }
    return this;
  }

  /** 0..1 — how hard every blade on this machine is lit right now. */
  /**
   * Light the whole machine up for an instant, because it was just hit.
   *
   * One shared body material and one material per bone type means the whole
   * thing takes a hit flash from two or three property writes — no per-mesh
   * work, and it costs nothing when it is off.
   *
   * The emissive COLOUR is left set when the flash goes out; the intensity
   * is what is taken to zero. An unlit emissive is the same as no emissive,
   * and it saves writing the colour back every frame of a fight.
   */
  setHitFlash(amount, color = 0xffffff) {
    const a = Math.max(0, amount);
    if (a === 0 && this._flashed === 0) return this;
    this._flashed = a;
    this.bodyMaterial.emissive.setHex(color);
    this.bodyMaterial.emissiveIntensity = a;
    for (const m of this._boneMaterials.values()) {
      m.emissive.setHex(color);
      m.emissiveIntensity = a;
    }
    return this;
  }

  setBladeGlow(amount) {
    for (const node of this.equipNodes) {
      if (!node.bladeGlow) continue;
      const on = amount > 0.01;
      for (const m of node.bladeGlow.meshes) m.visible = on;
      node.bladeGlow.material.opacity = amount * 0.55;
      node.accent.material.emissiveIntensity = 1.9 + amount * 3.4;
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

    this._buildRings();

    this.limbs = limbs;
    this.armBones = this.joints.filter((n) => n.part.boneType === 'arm');

    // Arms are chains too. Without this, a shoulder and the elbow below it
    // both take the full swing and the arm bends twice as far as it should.
    for (const node of this.armBones) {
      node.chainDepth = this._depthUnder(node.part, 'arm');
    }
    this.faceBones = this.joints.filter((n) => n.part.boneType === 'face');
    this.customBones = this.joints.filter((n) => n.part.boneType === 'custom');
    this.weaponBones = this.joints.filter((n) => n.part.boneType === 'weapon');
    return limbs;
  }

  /** How many bones of the same attribute sit above this one. */
  _depthUnder(part, boneType) {
    let depth = 0;
    let cur = part.parent ? this.assembly.get(part.parent) : null;
    while (cur) {
      if (cur.kind === 'bone' && cur.boneType === boneType) depth++;
      cur = cur.parent ? this.assembly.get(cur.parent) : null;
    }
    return depth;
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
