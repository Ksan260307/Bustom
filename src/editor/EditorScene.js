import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Rig, ridesFarHalf } from '../core/Rig.js';
import { Assembly, computeStats, faceAnchor, alignYToFace } from '../core/Assembly.js';
import { Animator } from '../anim/Animator.js';
import {
  SIZE_STEP, EQUIP, EQUIP_META, EQUIP_THICKNESS, EQUIP_SIZE_DEFAULT,
} from '../core/constants.js';

// ============================================================
//  Editor : place parts anywhere, drag them anywhere, carve them.
//
//    SELECT   pick (shift to add), then drag the gizmo. Multi-select moves
//             and rotates as one rigid group.
//    BLOCK /  click a surface to snap flush against it, or click empty
//    BONE*    space to drop the part free-floating on the work plane.
//    SCULPT   carve / add / paint at the build's voxel resolution, with the
//             camera still fully usable on the right mouse button.
// ============================================================

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
/** Separate from _m: _applyWorldTransform reuses _m, and the drag delta must
 *  survive the whole loop over the selection. */
const _delta = new THREE.Matrix4();
const _next = new THREE.Matrix4();
const _plane = new THREE.Plane();
const UP_VEC = new THREE.Vector3(0, 1, 0);

export const TOOL = {
  SELECT: 'select',
  STAMP: 'stamp',
  EQUIP: 'equip',
  BLOCK: 'block',
  BONE_LEG: 'leg',
  BONE_ARM: 'arm',
  BONE_FACE: 'face',
  BONE_CUSTOM: 'custom',
  CARVE: 'carve',
  ADD: 'add',
  PAINT: 'paint',
};

const SCULPT_TOOLS = new Set([TOOL.CARVE, TOOL.ADD, TOOL.PAINT]);
const PART_TOOLS = new Set([
  TOOL.BLOCK, TOOL.BONE_LEG, TOOL.BONE_ARM, TOOL.BONE_FACE, TOOL.BONE_CUSTOM,
  TOOL.STAMP, TOOL.EQUIP,
]);
const BONE_TOOLS = new Set([TOOL.BONE_LEG, TOOL.BONE_ARM, TOOL.BONE_FACE, TOOL.BONE_CUSTOM]);

export { SCULPT_TOOLS, PART_TOOLS, BONE_TOOLS };

/** Which axis-aligned face a local direction points along. */
function dominantFace(n) {
  const a = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
  const axis = a.indexOf(Math.max(...a));
  const positive = [n.x, n.y, n.z][axis] >= 0;
  return axis * 2 + (positive ? 0 : 1);
}

export class EditorScene {
  constructor({ renderer, canvas }) {
    this.renderer = renderer;
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1219);
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.05, 400);
    this.camera.position.set(7, 5.2, 9);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 60;
    this.controls.target.set(0, 1.2, 0);

    this.tool = TOOL.SELECT;
    this.colorIndex = 2;
    /** Brush radius as a percentage of the block edge — resolution-independent. */
    this.brushPercent = 6;
    this.newBlockSize = [1, 1, 1];
    this.boneOpts = { length: 3, radius: 0.22, limit: 70, invert: false };

    /** @type {Set<string>} every selected part id. */
    this.selection = new Set();
    this.gizmoMode = 'translate';
    this.snap = true;
    this.hoverVoxel = null;
    this.previewMotion = false;
    this.symmetry = false;

    this.onChange = () => {};
    this.onSelect = () => {};
    /**
     * Fired immediately before anything mutates the document, with a label
     * describing what is about to happen. The app turns this into an undo
     * step — the editor itself stays ignorant of history.
     */
    this.onBeforeChange = () => {};
    /** Fired when an edit is refused, with a reason worth showing the player. */
    this.onReject = () => {};

    /** Armed by the part library: the document a STAMP click will graft in. */
    this.stampSource = null;

    /** What the EQUIP tool will stick on next. */
    this.equipType = EQUIP.BEAM;
    this.newEquipSize = EQUIP_SIZE_DEFAULT;
    this.stampSize = [1, 1, 1];

    this._buildEnvironment();
    this._buildOverlays();
    this._buildJointGizmo();
    this._buildGizmo();
    this._bindPointer();
    this._syncCameraButtons();
    this.time = 0;
    this.active = false;
  }

  /** Backwards-compatible single-selection accessor. */
  get selected() {
    for (const id of this.selection) return id;
    return null;
  }

  // ---------------------------------------------------------- setup

  _buildEnvironment() {
    const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x3c4964, 1.55);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff4e6, 2.15);
    key.position.set(9, 17, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const d = 15;
    Object.assign(key.shadow.camera, { left: -d, right: d, top: d, bottom: -d, far: 60 });
    key.shadow.normalBias = 0.035;
    key.shadow.bias = -0.0015;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x8fc4ff, 1.05);
    fill.position.set(-9, 4, 8);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffd9a8, 0.65);
    rim.position.set(2, 5, -12);
    this.scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 64),
      new THREE.MeshStandardMaterial({ color: 0x1b222e, roughness: 0.95, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.001;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(24, 24, 0x3d6f92, 0x232f3d);
    grid.material.transparent = true;
    grid.material.opacity = 0.6;
    this.scene.add(grid);
    this.grid = grid;

    // Front marker: the core's +Z is the direction of travel, and the
    // builder needs to see that at all times.
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0x4fd2ff, transparent: true, opacity: 0.65 });
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.9, 4), arrowMat);
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(0, 0.02, 3.4);
    this.scene.add(arrow);
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 2.4), arrowMat);
    stem.position.set(0, 0.02, 1.9);
    this.scene.add(stem);
  }

  _buildOverlays() {
    // One outline box per selected part, pooled.
    this.outlineGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.outlineMat = new THREE.LineBasicMaterial({
      color: 0xffd166, transparent: true, opacity: 0.95, depthTest: false,
    });
    // The anchor of a multi-selection is what everything else connects TO,
    // so it must be tellable apart at a glance.
    this.anchorMat = new THREE.LineBasicMaterial({
      color: 0x4fd2ff, transparent: true, opacity: 1, depthTest: false,
    });
    this.outlineGroup = new THREE.Group();
    this.scene.add(this.outlineGroup);
    this._outlinePool = [];

    // Connection lines: a link is otherwise invisible, and "what moves with
    // what" is the whole point of connecting parts.
    this.linkPositions = new Float32Array(256 * 6);
    const linkGeo = new THREE.BufferGeometry();
    linkGeo.setAttribute('position', new THREE.BufferAttribute(this.linkPositions, 3));
    this.linkLines = new THREE.LineSegments(linkGeo, new THREE.LineBasicMaterial({
      color: 0x8effc9, transparent: true, opacity: 0.7, depthTest: false,
    }));
    this.linkLines.frustumCulled = false;
    this.linkLines.renderOrder = 12;
    this.scene.add(this.linkLines);

    // Ghost of the part about to be placed.
    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x4fd2ff, transparent: true, opacity: 0.22, depthWrite: false,
      }),
    );
    this.ghostWire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.8, depthTest: false }),
    );
    this.ghost.add(this.ghostWire);
    this.ghost.visible = false;
    this.ghost.renderOrder = 9;
    this.scene.add(this.ghost);

    // voxel cursor
    this.voxCursor = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthTest: false }),
    );
    this.voxCursor.visible = false;
    this.voxCursor.renderOrder = 11;
    this.scene.add(this.voxCursor);
  }

  /**
   * The joint read-out for a selected bone. Three lines answer the three
   * questions the bone format keeps raising:
   *
   *   arc   how far it swings, and about which axis
   *   axis  the hinge itself, through the midpoint
   *   far   which half actually moves
   *
   * Without it you have to deploy to the field to find out whether a limb
   * bends the way you meant.
   */
  _buildJointGizmo() {
    const line = (color, count, width = 1) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      const mat = new THREE.LineBasicMaterial({
        color, transparent: true, opacity: 1, depthTest: false, linewidth: width,
      });
      const l = new THREE.Line(geo, mat);
      l.frustumCulled = false;
      l.renderOrder = 12;
      return l;
    };

    this.jointArc = line(0x4fd2ff, 33);
    this.jointAxis = line(0xffd166, 2);
    this.jointFar = line(0x8effc9, 2);
    this.jointGizmo = new THREE.Group();
    this.jointGizmo.add(this.jointArc, this.jointAxis, this.jointFar);
    this.jointGizmo.visible = false;
    this.scene.add(this.jointGizmo);
  }

  /** Point the joint read-out at whatever single bone is selected. */
  _syncJointGizmo() {
    const parts = this.selectedParts();
    const bone = parts.length === 1 && parts[0].kind === 'bone' ? parts[0] : null;
    const node = bone ? this.rig.nodes.get(bone.id) : null;
    if (!node) {
      this.jointGizmo.visible = false;
      if (this.jointGizmo.parent !== this.scene) this.scene.add(this.jointGizmo);
      return;
    }

    // Ride the bone's own group, so it tracks the machine for free.
    if (this.jointGizmo.parent !== node.group) node.group.add(this.jointGizmo);
    this.jointGizmo.visible = true;
    this.jointGizmo.position.set(0, 0, 0);
    this.jointGizmo.quaternion.identity();

    const L = bone.length;
    const mid = L / 2;
    const r = Math.max(0.42, L * 0.5);
    const axis = this._swingAxis(node);
    const lim = THREE.MathUtils.degToRad(
      bone.custom && bone.boneType === 'custom' && (bone.custom.wave === 'saw')
        ? 180 : Math.min(179, bone.limit),
    );

    const arc = this.jointArc.geometry.attributes.position;
    const n = arc.count - 1;
    for (let i = 0; i <= n; i++) {
      const t = -lim + (2 * lim * i) / n;
      _v.set(0, r, 0).applyQuaternion(_q.setFromAxisAngle(axis, t));
      arc.setXYZ(i, _v.x, _v.y + mid, _v.z);
    }
    arc.needsUpdate = true;

    const ax = this.jointAxis.geometry.attributes.position;
    _v.copy(axis).multiplyScalar(r * 0.75);
    ax.setXYZ(0, -_v.x, mid - _v.y, -_v.z);
    ax.setXYZ(1, _v.x, mid + _v.y, _v.z);
    ax.needsUpdate = true;

    const far = this.jointFar.geometry.attributes.position;
    far.setXYZ(0, 0, mid, 0);
    far.setXYZ(1, 0, L, 0);
    far.needsUpdate = true;
  }

  /** The axis this bone actually swings about, matching the animator. */
  _swingAxis(node) {
    if (node.part.boneType === 'custom') {
      const a = node.part.custom?.axis;
      if (a === 'y') return node.axisTwist ?? UP_VEC;
      if (a === 'z') return node.axisLift ?? UP_VEC;
    }
    return node.axisStride ?? new THREE.Vector3(1, 0, 0);
  }

  _buildGizmo() {
    this.pivot = new THREE.Object3D();
    this.scene.add(this.pivot);

    this.gizmo = new TransformControls(this.camera, this.canvas);
    this.gizmo.setSize(0.85);
    this.gizmo.setSpace('world');
    // three r169+ exposes the visual through getHelper(); older builds are
    // Object3D themselves.
    this.scene.add(this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo);

    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (e.value) this._beginDrag();
      else this._endDrag();
    });
    this.gizmo.addEventListener('objectChange', () => this._applyDrag());

    this._applySnap();
  }

  _applySnap() {
    this.gizmo.setTranslationSnap(this.snap ? SIZE_STEP : null);
    this.gizmo.setRotationSnap(this.snap ? THREE.MathUtils.degToRad(15) : null);
  }

  setSnap(on) { this.snap = !!on; this._applySnap(); }

  setGizmoMode(mode) {
    this.gizmoMode = mode === 'rotate' ? 'rotate' : 'translate';
    this.gizmo.setMode(this.gizmoMode);
  }

  /**
   * Sculpting needs the left button for the brush, so the camera moves to the
   * right button. Zoom stays on the wheel in every mode.
   */
  _syncCameraButtons() {
    const sculpting = SCULPT_TOOLS.has(this.tool);
    this.controls.mouseButtons = sculpting
      ? { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.enableZoom = true;
    this.controls.enabled = true;
  }

  // ---------------------------------------------------------- assembly

  setAssembly(assembly, { keepCamera = false, keepSelection = false } = {}) {
    const keep = keepSelection ? [...this.selection] : [];
    if (this.rig) this.rig.dispose();
    this.assembly = assembly;
    this.selection = new Set(keep.filter((id) => assembly.get(id)));
    this._makeRig();
    if (!keepCamera) this._frameCamera();
    this._syncSelectionVisuals();
    this.onChange(this.stats);
    this.onSelect(this.selectedParts());
    return this;
  }

  _makeRig() {
    this.rig = new Rig(this.assembly);
    this.scene.add(this.rig.root);
    this.stats = computeStats(this.assembly, this.rig);
    this.animator = new Animator(this.rig, this.stats);
    this.groundOffset = -this.rig.restLowestY;
    this.rig.root.position.y = this.groundOffset;
    this.rig.root.updateMatrixWorld(true);
  }

  /** Rebuild the rig after a structural edit, keeping the selection if we can. */
  rebuild() {
    const keep = [...this.selection].filter((id) => this.assembly.get(id));
    this.rig.dispose();
    this._makeRig();
    this.selection = new Set(keep);
    this._syncSelectionVisuals();
    this.onChange(this.stats);
    this.onSelect(this.selectedParts());
  }

  /** Recompute stats without touching the hierarchy. */
  refreshStats() {
    this.stats = computeStats(this.assembly, this.rig);
    this.onChange(this.stats);
    return this.stats;
  }

  _frameCamera() {
    this.rig.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.rig.root);
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(1.4, this.rig.boundingRadius);
    this.controls.target.copy(c);
    const dir = new THREE.Vector3(0.68, 0.46, 0.86).normalize();
    this.camera.position.copy(c).addScaledVector(dir, r * 2.6 + 2.0);
    this.controls.update();
  }

  // ---------------------------------------------------------- selection

  selectedParts() {
    return [...this.selection].map((id) => this.assembly.get(id)).filter(Boolean);
  }

  /**
   * The most recently selected part. Connecting attaches everything else to
   * this one, the way "parent to active" works in most 3D editors.
   */
  get anchorId() {
    let last = null;
    for (const id of this.selection) last = id;
    return last;
  }

  select(idOrIds, additive = false) {
    const ids = idOrIds === null || idOrIds === undefined
      ? []
      : (Array.isArray(idOrIds) ? idOrIds : [idOrIds]);
    if (!additive) this.selection.clear();
    for (const id of ids) {
      if (!this.assembly.get(id)) continue;
      if (additive && this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    }
    this._syncSelectionVisuals();
    this.onSelect(this.selectedParts());
  }

  selectAll() {
    this.selection = new Set(this.assembly.subtree(this.assembly.rootId));
    this._syncSelectionVisuals();
    this.onSelect(this.selectedParts());
  }

  clearSelection() { this.select(null); }

  deleteSelected() {
    const doomed = [...this.selection].filter((id) => id !== this.assembly.rootId);
    if (!doomed.length) return false;
    this.onBeforeChange('削除');
    for (const id of doomed) this.assembly.remove(id);
    this.selection.clear();
    this.rebuild();
    return true;
  }

  /** World-space bounds of one part's group, used for the outline boxes. */
  _partBox(node, out) {
    const part = node.part;
    if (part.kind === 'bone') {
      const L = part.length;
      const r = part.radius;
      node.group.updateMatrixWorld(true);
      out.scale.set(r * 3.4, L * 1.02, r * 3.4);
      out.position.copy(node.group.localToWorld(_v.set(0, L / 2, 0)));
      out.quaternion.copy(node.group.getWorldQuaternion(_q));
    } else if (part.kind === 'equip') {
      // A plate's box hugs the slab, and sits on the surface like the slab does.
      const d = part.size;
      out.scale.set(d * 1.08, EQUIP_THICKNESS * 1.6, d * 1.08);
      node.group.updateMatrixWorld(true);
      out.position.copy(node.group.localToWorld(_v.set(0, EQUIP_THICKNESS / 2, 0)));
      out.quaternion.copy(node.group.getWorldQuaternion(_q));
    } else {
      const [sx, sy, sz] = part.size;
      out.scale.set(sx * 1.04, sy * 1.04, sz * 1.04);
      out.position.copy(node.group.getWorldPosition(_v));
      out.quaternion.copy(node.group.getWorldQuaternion(_q));
    }
  }

  _syncSelectionVisuals() {
    const ids = [...this.selection];

    while (this._outlinePool.length < ids.length) {
      const line = new THREE.LineSegments(this.outlineGeo, this.outlineMat);
      line.renderOrder = 10;
      this._outlinePool.push(line);
      this.outlineGroup.add(line);
    }
    this._outlinePool.forEach((l, i) => { l.visible = i < ids.length; });

    if (!ids.length) {
      this.gizmo.detach();
      this._syncLinkLines();
      this._syncJointGizmo();
      return;
    }

    const anchor = this.anchorId;
    this.rig.root.updateMatrixWorld(true);
    _v2.set(0, 0, 0);
    ids.forEach((id, i) => {
      const node = this.rig.nodes.get(id);
      if (!node) return;
      this._partBox(node, this._outlinePool[i]);
      this._outlinePool[i].material = (ids.length > 1 && id === anchor)
        ? this.anchorMat : this.outlineMat;
      _v2.add(this._outlinePool[i].position);
    });
    _v2.divideScalar(ids.length);

    this.pivot.position.copy(_v2);
    this.pivot.quaternion.identity();
    this.pivot.updateMatrixWorld(true);

    if (this.tool === TOOL.SELECT) this.gizmo.attach(this.pivot);
    else this.gizmo.detach();

    // Last: _syncLinkLines reuses the shared temporaries the centroid was
    // accumulated in, so it must not run before the pivot has been read out.
    this._syncLinkLines();
    this._syncJointGizmo();
  }

  /** Draw a line from each selected part to whatever it is connected to. */
  _syncLinkLines() {
    let n = 0;
    const max = this.linkPositions.length / 6;
    this.rig.root.updateMatrixWorld(true);

    for (const id of this.selection) {
      if (n >= max) break;
      const part = this.assembly.get(id);
      const node = this.rig.nodes.get(id);
      if (!part || !part.parent || !node) continue;
      const host = this.rig.nodes.get(part.parent);
      if (!host) continue;

      node.group.getWorldPosition(_v);
      host.group.getWorldPosition(_v2);
      this.linkPositions.set([_v.x, _v.y, _v.z, _v2.x, _v2.y, _v2.z], n * 6);
      n++;
    }

    this.linkLines.geometry.setDrawRange(0, n * 2);
    this.linkLines.geometry.attributes.position.needsUpdate = true;
    this.linkLines.visible = n > 0;
  }

  // ---------------------------------------------------------- clipboard

  /**
   * Copy the topmost selected parts. Each becomes a standalone document, so
   * a paste is just a graft — the same code path the part library uses.
   * @returns {Array<{json:object, parent:string, mount:object}>}
   */
  copySelected() {
    const out = [];
    for (const id of this._dragRoots()) {
      const part = this.assembly.get(id);
      const doc = this.assembly.extract(id);
      if (!part || !doc) continue;
      out.push({
        json: doc.toJSON(),
        parent: part.parent,
        mount: part.mount ? { pos: [...part.mount.pos], rot: [...part.mount.rot] } : null,
      });
    }
    return out;
  }

  /**
   * Paste clipboard entries back in, nudged off the original so the copy is
   * visible rather than hiding inside its source.
   * @returns {string[]} the ids of the pasted roots
   */
  paste(entries, { offset = SIZE_STEP } = {}) {
    if (!entries?.length) return [];
    const fallback = this.selected ?? this.assembly.rootId;
    const made = [];

    for (const entry of entries) {
      const parent = this.assembly.get(entry.parent) ? entry.parent : fallback;
      const base = entry.mount ?? { pos: [0, 0, 0], rot: [0, 0, 0, 1] };
      const mount = {
        pos: [base.pos[0] + offset, base.pos[1], base.pos[2] + offset],
        rot: [...base.rot],
      };
      const doc = Assembly.fromJSON(JSON.parse(JSON.stringify(entry.json)));
      const root = this.assembly.graft(doc, parent, mount);
      if (root) made.push(root.id);
    }
    return made;
  }

  /** Arm the stamp tool with a part document from the library. */
  armStamp(assembly) {
    this.stampSource = assembly;
    if (assembly) {
      // Measure once, so hovering does not rebuild a rig every frame.
      const probe = new Rig(assembly);
      const size = probe.bounds.getSize(_v);
      this.stampSize = [
        Math.max(0.25, size.x), Math.max(0.25, size.y), Math.max(0.25, size.z),
      ];
      probe.dispose();
    }
    return this;
  }

  // ---------------------------------------------------------- connections

  /**
   * Re-home a part onto another one without moving it a millimetre.
   *
   * A part's stored mount is expressed in its PARENT's frame — including for
   * bones, where the frame runs along the shaft from the bone root. So the
   * conversion is the same for every parent kind, and no rebuild is needed
   * in between: the caller rebuilds once at the end.
   */
  _reparentKeepingWorld(id, parentId) {
    if (!this.assembly.canReparent(id, parentId)) return false;
    const node = this.rig.nodes.get(id);
    const host = this.rig.nodes.get(parentId);
    if (!node || !host) return false;

    _m.copy(host.group.matrixWorld).invert().multiply(node.group.matrixWorld);
    _m.decompose(_v, _q, _s);
    return this.assembly.reparent(id, parentId, { pos: _v.toArray(), rot: _q.toArray() });
  }

  /**
   * Which half of a bone a part rides, or null when its parent is a block.
   * Connecting to a bone can legitimately land on the rigid near half, and
   * silently doing nothing when the joint bends is baffling — so this gets
   * surfaced in the inspector and in the connect message.
   * @returns {'far'|'near'|null}
   */
  boneHalfOf(id) {
    const part = this.assembly.get(id);
    const parent = part?.parent ? this.assembly.get(part.parent) : null;
    if (!parent || parent.kind !== 'bone') return null;
    return ridesFarHalf(part, parent) ? 'far' : 'near';
  }

  /** Connections are defined in the rest pose, never in a posed frame. */
  _restPose() {
    this.rig.resetPose();
    this.rig.root.updateMatrixWorld(true);
  }

  /**
   * Connect every selected part to the last-selected one, so they move with
   * it — which is how a block ends up riding a bone's far half.
   * @returns {{connected:number, skipped:number, rigid:number}}
   */
  connectSelected() {
    const anchor = this.anchorId;
    if (!anchor || this.selection.size < 2) return { connected: 0, skipped: 0, rigid: 0 };
    this._restPose();

    // Only the topmost selected parts move; their children come with them,
    // which keeps any structure you already built intact.
    const movers = this._dragRoots().filter((id) => id !== anchor);
    if (movers.length) this.onBeforeChange('連結');
    const done = [];
    let skipped = 0;
    for (const id of movers) {
      const part = this.assembly.get(id);
      if (!part || part.parent === anchor) { skipped++; continue; }
      if (this._reparentKeepingWorld(id, anchor)) done.push(id);
      else skipped++;
    }
    // Landing on a bone's rigid half is legal but will not articulate.
    const rigid = done.filter((id) => this.boneHalfOf(id) === 'near').length;
    if (done.length) this.rebuild();
    return { connected: done.length, skipped, rigid };
  }

  /** Cut the selection loose: back onto the core segment, in place. */
  disconnectSelected() {
    const root = this.assembly.rootId;
    const movers = this._dragRoots().filter((id) => {
      const part = this.assembly.get(id);
      return part && id !== root && part.parent !== root;
    });
    if (!movers.length) return 0;
    this.onBeforeChange('連結解除');
    this._restPose();
    let disconnected = 0;
    for (const id of this._dragRoots()) {
      const part = this.assembly.get(id);
      if (!part || id === root || part.parent === root) continue;
      if (this._reparentKeepingWorld(id, root)) disconnected++;
    }
    if (disconnected) this.rebuild();
    return disconnected;
  }

  // ---------------------------------------------------------- gizmo drag

  /**
   * Selected parts that have no selected ancestor. Only these get the drag
   * applied: descendants ride along through the hierarchy, and moving them
   * as well would apply the delta to them twice.
   */
  _dragRoots() {
    const ids = [...this.selection];
    const set = new Set(ids);
    return ids.filter((id) => {
      let cur = this.assembly.get(id)?.parent;
      while (cur) {
        if (set.has(cur)) return false;
        cur = this.assembly.get(cur)?.parent;
      }
      return true;
    });
  }

  _beginDrag() {
    this.onBeforeChange(this.gizmoMode === 'rotate' ? '回転' : '移動');
    this.rig.root.updateMatrixWorld(true);
    this._dragStart = {
      pivotInverse: this.pivot.matrixWorld.clone().invert(),
      parts: this._dragRoots().map((id) => {
        const node = this.rig.nodes.get(id);
        return node ? { id, world: node.group.matrixWorld.clone() } : null;
      }).filter(Boolean),
    };
  }

  _applyDrag() {
    if (!this._dragStart) return;
    this.pivot.updateMatrixWorld(true);
    _delta.copy(this.pivot.matrixWorld).multiply(this._dragStart.pivotInverse);

    let needsRebuild = false;
    for (const { id, world } of this._dragStart.parts) {
      _next.multiplyMatrices(_delta, world);
      if (!this._applyWorldTransform(id, _next)) needsRebuild = true;
    }
    if (needsRebuild) {
      // A part crossed a bone's midpoint and changed which half it rides.
      this._pendingRebuild = true;
    }
    this._syncSelectionVisualsDuringDrag();
  }

  /** Outlines follow, but the gizmo must not be re-attached mid-drag. */
  _syncSelectionVisualsDuringDrag() {
    this.rig.root.updateMatrixWorld(true);
    [...this.selection].forEach((id, i) => {
      const node = this.rig.nodes.get(id);
      if (node && this._outlinePool[i]) this._partBox(node, this._outlinePool[i]);
    });
  }

  _endDrag() {
    this._dragStart = null;
    if (this._pendingRebuild) {
      this._pendingRebuild = false;
      this.rebuild();
    } else {
      this.refreshStats();
      this._syncSelectionVisuals();
    }
    this.onSelect(this.selectedParts());
  }

  /**
   * Write a world matrix back onto a part's mount, converting through its
   * host group. Returns false when the part has crossed a bone's midpoint
   * and now belongs to the other half of that bone.
   */
  _applyWorldTransform(id, world) {
    const node = this.rig.nodes.get(id);
    if (!node || !node.part.mount) return true;
    const host = node.group.parent;
    host.updateWorldMatrix(true, false);

    _m.copy(host.matrixWorld).invert().multiply(world);
    _m.decompose(_v, _q, _s);

    const parentPart = this.assembly.get(node.part.parent);
    const inFar = parentPart?.kind === 'bone' && node.host === this.rig.nodes.get(parentPart.id).far;
    const y = inFar ? _v.y + parentPart.length / 2 : _v.y;

    this.assembly.setMount(id, { pos: [_v.x, y, _v.z], rot: _q.toArray() });
    node.group.position.copy(_v);
    node.group.quaternion.copy(_q);
    node.group.updateMatrixWorld(true);

    // did it change halves?
    if (parentPart?.kind === 'bone') {
      return ridesFarHalf(node.part, parentPart) === inFar;
    }
    return true;
  }

  // ---------------------------------------------------------- editing ops

  resizeSelected(size) {
    const id = this.selected;
    if (!id) return false;
    const part = this.assembly.get(id);
    if (!part || part.kind === 'bone') return false;
    this.onBeforeChange('寸法変更');
    this.assembly.setSize(id, size);
    this.rig.refreshSize(id);
    this.refreshStats();
    this._syncSelectionVisuals();
    return true;
  }

  /** Swap the fitted plate for another type, in place. */
  setEquipTypeSelected(type) {
    const id = this.selected;
    const part = this.assembly.get(id);
    if (!part || part.kind !== 'equip') return false;
    this.onBeforeChange('装備変更');
    if (!this.assembly.setEquipType(id, type)) {
      this.onReject?.(`${EQUIP_META[type]?.label ?? type}は1枚しか付けられません`);
      return false;
    }
    if (!this.rig.refreshEquip(id)) this.rebuild();
    this.refreshStats();
    this._syncSelectionVisuals();
    return true;
  }

  setEquipSizeSelected(size) {
    const id = this.selected;
    const part = this.assembly.get(id);
    if (!part || part.kind !== 'equip') return false;
    this.onBeforeChange('装備の大きさ');
    this.assembly.setEquipSize(id, size);
    if (!this.rig.refreshEquip(id)) this.rebuild();
    this.refreshStats();
    this._syncSelectionVisuals();
    return true;
  }

  /** Which way and how fast a ROLLING plate turns. */
  setEquipSpinSelected(spin) {
    const id = this.selected;
    const part = this.assembly.get(id);
    if (!part || part.kind !== 'equip' || !part.spin) return false;
    this.onBeforeChange('回転設定');
    this.assembly.setEquipSpin(id, spin);
    this.refreshStats();
    return true;
  }

  /** Bullet colour, for the plates whose meta allows it. */
  setBulletColorSelected(hex) {
    let changed = false;
    for (const p of this.selectedParts()) {
      if (p.kind !== 'equip') continue;
      if (!changed) this.onBeforeChange('弾の色');
      if (this.assembly.setBulletColor(p.id, hex)) {
        this.rig.refreshEquip(p.id);
        changed = true;
      }
    }
    if (changed) this.onSelect(this.selectedParts());
    return changed;
  }

  /**
   * Chain another bone off the far tip of the selected one. Building a leg
   * used to mean clicking exactly on the tip of a rod that is often a few
   * pixels wide.
   */
  addBoneOnTipSelected(opts = {}) {
    const id = this.selected;
    const bone = this.assembly.get(id);
    if (!bone || bone.kind !== 'bone') return false;
    this.onBeforeChange('ボーン追加');
    const made = this.assembly.addBoneOnTip(id, opts.boneType ?? bone.boneType, {
      ...this.boneOpts, ...opts,
    });
    if (!made) return false;
    this.rebuild();
    this.select(made.id);
    return true;
  }

  /**
   * Slide a bone's child along the shaft. `t` is 0..1 of the length, so the
   * caller can say "the tip" or "the root" without knowing the number —
   * which half a child rides on is otherwise a fiddly drag.
   */
  slideAlongBone(t) {
    const id = this.selected;
    const part = this.assembly.get(id);
    const parent = part?.parent ? this.assembly.get(part.parent) : null;
    if (!part || parent?.kind !== 'bone') return false;
    const pos = [...part.mount.pos];
    pos[1] = parent.length * Math.min(1, Math.max(0, t));
    return this.setMountSelected({ pos });
  }

  setBoneShapeSelected(shape) {
    const id = this.selected;
    if (!id) return false;
    const part = this.assembly.get(id);
    if (!part || part.kind !== 'bone') return false;
    this.onBeforeChange('ボーン寸法');
    this.assembly.setBoneShape(id, shape);
    this.rebuild();
    return true;
  }

  setMountSelected({ pos, rot }) {
    const id = this.selected;
    if (!id) return false;
    this.onBeforeChange('位置変更');
    if (!this.assembly.setMount(id, { pos, rot })) return false;
    if (!this.rig.refreshMount(id)) this.rebuild();
    else { this.refreshStats(); this._syncSelectionVisuals(); }
    return true;
  }

  reparentSelected(parentId) {
    const id = this.selected;
    if (!id) return false;
    if (!this.assembly.canReparent(id, parentId)) return false;
    this.onBeforeChange('連結先変更');
    this._restPose();
    if (!this._reparentKeepingWorld(id, parentId)) return false;
    this.rebuild();
    return true;
  }

  /** Duplicate the selection in place, offset slightly so it is visible. */
  duplicateSelected() {
    const parts = this.selectedParts().filter((p) => p.id !== this.assembly.rootId);
    if (!parts.length) return false;
    this.onBeforeChange('複製');
    const made = [];
    for (const p of parts) {
      const mount = {
        pos: [p.mount.pos[0] + SIZE_STEP, p.mount.pos[1], p.mount.pos[2] + SIZE_STEP],
        rot: [...p.mount.rot],
      };
      let copy;
      if (p.kind === 'bone') {
        copy = this.assembly.addBone(p.parent, mount, p.boneType, {
          length: p.length, radius: p.radius, limit: p.limit, invert: p.invert,
          custom: { ...p.custom },
        });
      } else if (p.kind === 'equip') {
        copy = this.assembly.addEquip(p.parent, mount, p.equipType, {
          size: p.size, bulletColor: p.bulletColor,
        });
      } else {
        copy = this.assembly.addBlock(p.parent, mount, this.colorIndex, { size: [...p.size] });
        copy.vox = p.vox.clone();
      }
      if (copy) made.push(copy.id);
    }
    this.rebuild();
    this.select(made);
    return true;
  }

  // ---------------------------------------------------------- pointer

  _bindPointer() {
    const el = this.canvas;
    this.painting = false;

    this._move = (e) => {
      if (!this.active) return;
      this._updateNdc(e);
      this._hover();
    };
    this._down = (e) => {
      if (!this.active || e.button !== 0) return;
      if (this.gizmo.dragging) return;
      this._updateNdc(e);
      this._hover();
      if (SCULPT_TOOLS.has(this.tool)) {
        this.beginStroke();
      } else {
        // Ctrl (or Cmd) adds to the selection.
        this._applyClick(e.ctrlKey || e.metaKey);
      }
    };
    this._up = () => {
      if (this.painting) {
        this.painting = false;
        this.refreshStats();
      }
    };
    this._context = (e) => { if (this.active) e.preventDefault(); };
    this._key = (e) => {
      if (!this.active) return;
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); this.deleteSelected(); }
      if (e.code === 'BracketLeft') this.brushPercent = Math.max(1, this.brushPercent - 1);
      if (e.code === 'BracketRight') this.brushPercent = Math.min(25, this.brushPercent + 1);
    };

    el.addEventListener('pointermove', this._move);
    el.addEventListener('pointerdown', this._down);
    el.addEventListener('contextmenu', this._context);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('keydown', this._key);
  }

  _updateNdc(e) {
    const r = this.canvas.getBoundingClientRect();
    _ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    _ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    _ray.setFromCamera(_ndc, this.camera);
  }

  _hover() {
    this.voxCursor.visible = false;
    this.ghost.visible = false;
    if (SCULPT_TOOLS.has(this.tool)) { this._hoverVoxel(); return; }
    if (PART_TOOLS.has(this.tool)) this._hoverGhost();
  }

  // ---------------------------------------------------------- placement

  /** Where would a new part land, given the current ray? */
  proposePlacement() {
    const forBone = BONE_TOOLS.has(this.tool);
    const forEquip = this.tool === TOOL.EQUIP;
    // A plate is placed like a bone — by its facing, not by its bulk — so it
    // takes no room in the flush-mount calculation.
    const alignY = forBone || forEquip;
    const d = this.newEquipSize;
    const size = forBone ? [0.4, 0.4, 0.4]
      : forEquip ? [d, EQUIP_THICKNESS, d]
        : (this.tool === TOOL.STAMP ? this.stampSize : this.newBlockSize);
    const hits = _ray.intersectObjects(this.rig.pickables, false);

    if (hits.length) {
      const hit = hits[0];
      const parentId = hit.object.userData.partId;
      const parent = this.assembly.get(parentId);
      const node = this.rig.nodes.get(parentId);
      if (!parent || !node) return null;

      if (parent.kind === 'bone') {
        node.group.updateMatrixWorld(true);
        _v.copy(hit.point);
        node.group.worldToLocal(_v);
        const t = this._snapValue(THREE.MathUtils.clamp(_v.y, 0, parent.length));

        if (forEquip) {
          // A sticker on a rod sits on the SURFACE of the rod, facing out —
          // not buried in the middle of it like a threaded block.
          const rl = Math.hypot(_v.x, _v.z);
          const nx = rl > 1e-5 ? _v.x / rl : 1;
          const nz = rl > 1e-5 ? _v.z / rl : 0;
          _q.setFromUnitVectors(UP_VEC, _v.set(nx, 0, nz));
          return {
            parentId,
            mount: { pos: [nx * parent.radius, t, nz * parent.radius], rot: _q.toArray() },
            size,
          };
        }

        // thread it onto the shaft at the height that was clicked
        return {
          parentId,
          mount: { pos: [0, t, 0], rot: forBone ? alignYToFace(2) : [0, 0, 0, 1] },
          size,
        };
      }

      // flush against whichever face was clicked
      _v.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
      node.group.getWorldQuaternion(_q).invert();
      _v.applyQuaternion(_q).normalize();
      const face = dominantFace(_v);
      return {
        parentId,
        mount: {
          pos: faceAnchor(parent, face, alignY ? [0, 0, 0] : size),
          rot: alignY ? alignYToFace(face) : [0, 0, 0, 1],
        },
        size,
      };
    }

    // Empty space: drop it on a horizontal work plane through the selection
    // (or the core), which is what makes detached, floating parts possible.
    const anchorId = this.selected ?? this.assembly.rootId;
    const anchor = this.rig.nodes.get(anchorId);
    if (!anchor) return null;
    anchor.group.updateMatrixWorld(true);
    anchor.group.getWorldPosition(_v2);

    _plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), _v2);
    const point = _ray.ray.intersectPlane(_plane, new THREE.Vector3());
    if (!point) return null;

    const parentId = anchorId === this.assembly.rootId ? this.assembly.rootId : anchorId;
    const host = this.rig.nodes.get(parentId).group;
    host.worldToLocal(point);
    return {
      parentId,
      mount: {
        pos: [this._snapValue(point.x), this._snapValue(point.y), this._snapValue(point.z)],
        rot: forBone ? alignYToFace(3) : [0, 0, 0, 1],
      },
      size,
      floating: true,
    };
  }

  _snapValue(v) {
    return this.snap ? Math.round(v / SIZE_STEP) * SIZE_STEP : v;
  }

  _hoverGhost() {
    const plan = this.proposePlacement();
    this.pendingPlacement = plan;
    if (!plan) return;
    const host = this.rig.nodes.get(plan.parentId);
    if (!host) return;

    host.group.updateMatrixWorld(true);
    _v.fromArray(plan.mount.pos);
    host.group.localToWorld(_v);
    this.ghost.position.copy(_v);
    this.ghost.quaternion.copy(host.group.getWorldQuaternion(_q))
      .multiply(_q.fromArray(plan.mount.rot));

    if (BONE_TOOLS.has(this.tool)) {
      const L = this.boneOpts.length;
      this.ghost.scale.set(this.boneOpts.radius * 3, L, this.boneOpts.radius * 3);
      this.ghost.translateY(L / 2);
    } else if (this.tool === TOOL.EQUIP) {
      this.ghost.scale.fromArray(plan.size);
      this.ghost.translateY(EQUIP_THICKNESS / 2);
    } else {
      this.ghost.scale.fromArray(plan.size);
    }
    if (this.tool === TOOL.STAMP && !this.stampSource) this.ghost.visible = false;
    this.ghost.visible = true;
  }

  // ---------------------------------------------------------- sculpting

  _hoverVoxel() {
    this.hoverVoxel = null;
    const id = this.selected;
    const node = id ? this.rig.nodes.get(id) : null;
    if (!node || !node.part.vox) return;

    const hits = _ray.intersectObject(node.mesh, false);
    if (!hits.length) return;

    const cell = this._voxelAt(node, hits[0], this.tool === TOOL.ADD);
    if (!cell) return;

    const vox = node.part.vox;
    const n = vox.n;
    const [sx, sy, sz] = node.part.size;
    this.hoverVoxel = cell;

    node.mesh.localToWorld(_v.set((cell.x + 0.5) / n, (cell.y + 0.5) / n, (cell.z + 0.5) / n));
    this.voxCursor.position.copy(_v);
    this.voxCursor.quaternion.copy(node.group.getWorldQuaternion(_q));
    const d = (this.brushRadiusCells(vox) * 2 + 1) / n;
    this.voxCursor.scale.set(d * sx, d * sy, d * sz);
    this.voxCursor.material.color.set(
      this.tool === TOOL.CARVE ? 0xff6a5c
        : this.tool === TOOL.ADD ? 0x8effc9
          : this.assembly.palette.get(this.colorIndex),
    );
    this.voxCursor.visible = true;
  }

  /** Brush radius in cells at the current resolution. */
  brushRadiusCells(vox) {
    return Math.max(0, Math.round((this.brushPercent / 100) * vox.n));
  }

  /**
   * Convert a surface hit into voxel coordinates. Geometry is in unit-cube
   * space, so the mesh's own local frame is already 0..1 on every axis.
   */
  _voxelAt(node, hit, outside) {
    const n = node.part.vox.n;
    const step = 0.5 / n;
    const worldNormal = hit.face
      ? _v.copy(hit.face.normal).transformDirection(node.mesh.matrixWorld).normalize()
      : _v.set(0, 0, 0);
    const probe = hit.point.clone().addScaledVector(worldNormal, outside ? step * 2 : -step * 2);
    node.mesh.worldToLocal(probe);

    const x = Math.floor(probe.x * n);
    const y = Math.floor(probe.y * n);
    const z = Math.floor(probe.z * n);
    if (x < 0 || y < 0 || z < 0 || x >= n || y >= n || z >= n) return null;
    return { x, y, z };
  }

  /**
   * Open a sculpting stroke: one undo step per stroke, not per frame of
   * dragging, and then the first dab.
   */
  beginStroke() {
    if (!SCULPT_TOOLS.has(this.tool)) return false;
    if (this.hoverVoxel) {
      this.onBeforeChange({ carve: '削る', add: '盛る', paint: '塗る' }[this.tool]);
    }
    this.painting = true;
    this._applySculpt();
    return true;
  }

  _applySculpt() {
    const id = this.selected;
    const node = id ? this.rig.nodes.get(id) : null;
    if (!node || !node.part.vox || !this.hoverVoxel) return;
    const { x, y, z } = this.hoverVoxel;
    const vox = node.part.vox;
    const r = this.brushRadiusCells(vox);
    let changed = false;

    if (this.tool === TOOL.CARVE) changed = vox.brush(x, y, z, r, 0);
    else if (this.tool === TOOL.ADD) changed = vox.brush(x, y, z, r, this.colorIndex + 1);
    else changed = vox.paint(x, y, z, r, this.colorIndex);

    if (!changed) return;

    // Never let a block be carved out of existence — an invisible mount point
    // is confusing rather than clever.
    if (vox.solid === 0) {
      const c = Math.floor(vox.n / 2);
      vox.set(c, c, c, this.colorIndex + 1);
    }

    this.rig.refreshBlock(node.part.id);
  }

  // ---------------------------------------------------------- click

  setTool(tool) {
    this.tool = tool;
    this.voxCursor.visible = false;
    this.ghost.visible = false;
    if (SCULPT_TOOLS.has(tool) && !this.selected) this.select(this.assembly.rootId);
    this._syncCameraButtons();
    this._syncSelectionVisuals();
  }

  _applyClick(additive = false) {
    if (PART_TOOLS.has(this.tool)) {
      const plan = this.pendingPlacement ?? this.proposePlacement();
      if (!plan) return;
      if (this.tool === TOOL.STAMP && !this.stampSource) return;
      if (this.tool === TOOL.EQUIP && !this.assembly.canAddEquip(this.equipType)) {
        this.onReject?.(`${EQUIP_META[this.equipType].label}は1枚しか付けられません`);
        return;
      }
      this.onBeforeChange(
        this.tool === TOOL.STAMP ? 'パーツ配置'
          : this.tool === TOOL.EQUIP ? '装備配置' : '配置',
      );

      let added;
      if (this.tool === TOOL.STAMP) {
        added = this.assembly.graft(this.stampSource, plan.parentId, plan.mount);
      } else if (this.tool === TOOL.EQUIP) {
        added = this.assembly.addEquip(plan.parentId, plan.mount, this.equipType, {
          size: this.newEquipSize,
        });
      } else if (this.tool === TOOL.BLOCK) {
        added = this.assembly.addBlock(plan.parentId, plan.mount, this.colorIndex, { size: plan.size });
      } else {
        added = this.assembly.addBone(plan.parentId, plan.mount, this.tool, { ...this.boneOpts });
      }
      if (!added) return;
      const made = [added.id];
      if (this.symmetry && this.tool !== TOOL.STAMP) {
        const twin = this._mirror(added);
        if (twin) made.push(twin.id);
      }
      this.rebuild();
      this.select(made);
      return;
    }

    // SELECT: pick a part, shift to add or remove
    const hits = _ray.intersectObjects(this.rig.pickables, false);
    if (hits.length) this.select(hits[0].object.userData.partId, additive);
    else if (!additive) this.select(null);
  }

  /**
   * Mirror a newly added part across the body's X axis. With free placement
   * that is simply a negated X on both position and rotation.
   */
  _mirror(part) {
    if (Math.abs(part.mount.pos[0]) < 1e-6) return null;
    const [x, y, z] = part.mount.pos;
    const q = new THREE.Quaternion().fromArray(part.mount.rot);
    // reflect the rotation through the YZ plane
    const mirroredRot = [q.x, -q.y, -q.z, q.w];
    const mount = { pos: [-x, y, z], rot: mirroredRot };

    if (part.kind === 'bone') {
      const twin = this.assembly.addBone(part.parent, mount, part.boneType, {
        ...this.boneOpts, invert: !this.boneOpts.invert,
      });
      if (twin) twin.custom = { ...part.custom };
      return twin;
    }
    if (part.kind === 'equip') {
      // A unique plate simply has no twin, which is the rule doing its job.
      // A mirrored roller turns the other way, like a mirrored propeller.
      return this.assembly.addEquip(part.parent, mount, part.equipType, {
        size: part.size,
        bulletColor: part.bulletColor,
        spin: part.spin ? { dir: -part.spin.dir, rpm: part.spin.rpm } : null,
      });
    }
    const twin = this.assembly.addBlock(part.parent, mount, this.colorIndex, { size: [...part.size] });
    if (twin) twin.vox = part.vox.clone();
    return twin;
  }

  // ---------------------------------------------------------- frame

  enter() {
    this.active = true;
    this.gizmo.enabled = true;
    this._syncCameraButtons();
    this._syncSelectionVisuals();
  }

  exit() {
    this.active = false;
    this.painting = false;
    // Two editors share one canvas, so the inactive one must stop listening
    // or its gizmo and orbit controls fight the active one for the mouse.
    this.gizmo.detach();
    this.gizmo.enabled = false;
    this.controls.enabled = false;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    this.controls.update();

    if (this.painting) this._applySculpt();

    this.rig.updateRollers(dt);

    if (this.previewMotion && this.animator) {
      // Fake a walk so gaits can be judged without leaving the editor.
      const speed = 6.5;
      _v.set(0, 0, speed);
      this.animator.update({
        dt, speed, planarSpeed: speed, grounded: 1, airborne: 0,
        velocity: _v, bodyQ: this.rig.root.quaternion,
        aimDir: null, locked: 0, thrust: 0.25, jerk: 0,
      });
      this.rig.root.position.y = this.groundOffset + this.animator.bodyBob;
    } else if (this.animator) {
      // Idle: settle to rest so the silhouette is honest — except that
      // selecting a custom bone runs its motion, because every slider in
      // that panel is meaningless until you can see what it does.
      const previewCustom = this.selectedParts().some(
        (p) => p.kind === 'bone' && p.boneType === 'custom',
      );
      const k = 1 - Math.pow(0.001, dt);
      for (const j of this.rig.joints) {
        if (previewCustom && j.part.boneType === 'custom') continue;
        j.joint.quaternion.slerp(_q.identity(), k);
      }
      if (previewCustom) this.animator.updateCustomsOnly(dt);
      this.rig.root.position.y = this.groundOffset;
      this.rig.root.rotation.set(0, 0, 0);
    }

    if (this.selection.size && !this.gizmo.dragging) this._syncSelectionVisualsDuringDrag();

    const pulse = Math.sin(this.time * 3.4) * 0.5 + 0.5;
    this.ghost.material.opacity = 0.14 + pulse * 0.12;
  }

  render() {
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const l of [this.jointArc, this.jointAxis, this.jointFar]) {
      l.geometry.dispose();
      l.material.dispose();
    }
    this.canvas.removeEventListener('pointermove', this._move);
    this.canvas.removeEventListener('pointerdown', this._down);
    this.canvas.removeEventListener('contextmenu', this._context);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('keydown', this._key);
    // three r169's TransformControls.dispose() still calls this.traverse(),
    // but the class no longer extends Object3D — the visual moved to
    // getHelper(). Disconnect, then dispose the helper's resources by hand.
    this.gizmo.detach();
    this.gizmo.disconnect();
    const helper = this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo;
    helper.removeFromParent();
    helper.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.linkLines.geometry.dispose();
    this.linkLines.material.dispose();
    this.outlineGeo.dispose();
    this.outlineMat.dispose();
    this.anchorMat.dispose();
    this.controls.dispose();
  }
}
