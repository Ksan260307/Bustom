import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Rig, ridesFarHalf } from '../core/Rig.js';
import { computeStats, faceAnchor, alignYToFace } from '../core/Assembly.js';
import { Animator } from '../anim/Animator.js';
import { SIZE_STEP } from '../core/constants.js';

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

export const TOOL = {
  SELECT: 'select',
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
const PART_TOOLS = new Set([TOOL.BLOCK, TOOL.BONE_LEG, TOOL.BONE_ARM, TOOL.BONE_FACE, TOOL.BONE_CUSTOM]);
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

    this._buildEnvironment();
    this._buildOverlays();
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
    this.outlineGroup = new THREE.Group();
    this.scene.add(this.outlineGroup);
    this._outlinePool = [];

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

  setAssembly(assembly) {
    if (this.rig) this.rig.dispose();
    this.assembly = assembly;
    this.selection.clear();
    this._makeRig();
    this._frameCamera();
    this._syncSelectionVisuals();
    this.onChange(this.stats);
    this.onSelect(null);
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
      return;
    }

    this.rig.root.updateMatrixWorld(true);
    _v2.set(0, 0, 0);
    ids.forEach((id, i) => {
      const node = this.rig.nodes.get(id);
      if (!node) return;
      this._partBox(node, this._outlinePool[i]);
      _v2.add(this._outlinePool[i].position);
    });
    _v2.divideScalar(ids.length);

    this.pivot.position.copy(_v2);
    this.pivot.quaternion.identity();
    this.pivot.updateMatrixWorld(true);

    if (this.tool === TOOL.SELECT) this.gizmo.attach(this.pivot);
    else this.gizmo.detach();
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
    this.assembly.setSize(id, size);
    this.rig.refreshSize(id);
    this.refreshStats();
    this._syncSelectionVisuals();
    return true;
  }

  setBoneShapeSelected(shape) {
    const id = this.selected;
    if (!id) return false;
    const part = this.assembly.get(id);
    if (!part || part.kind !== 'bone') return false;
    this.assembly.setBoneShape(id, shape);
    this.rebuild();
    return true;
  }

  setMountSelected({ pos, rot }) {
    const id = this.selected;
    if (!id) return false;
    if (!this.assembly.setMount(id, { pos, rot })) return false;
    if (!this.rig.refreshMount(id)) this.rebuild();
    else { this.refreshStats(); this._syncSelectionVisuals(); }
    return true;
  }

  reparentSelected(parentId) {
    const id = this.selected;
    if (!id) return false;
    // Keep it visually where it is: convert its world transform into the new frame.
    const node = this.rig.nodes.get(id);
    const world = node ? node.group.matrixWorld.clone() : null;
    if (!this.assembly.reparent(id, parentId)) return false;
    this.rebuild();
    if (world) {
      this._applyWorldTransform(id, world);
      this.rebuild();
    }
    return true;
  }

  /** Duplicate the selection in place, offset slightly so it is visible. */
  duplicateSelected() {
    const parts = this.selectedParts().filter((p) => p.kind !== 'core');
    if (!parts.length) return false;
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
        this.painting = true;
        this._applySculpt();
      } else {
        this._applyClick(e.shiftKey);
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
    const size = forBone ? [0.4, 0.4, 0.4] : this.newBlockSize;
    const hits = _ray.intersectObjects(this.rig.pickables, false);

    if (hits.length) {
      const hit = hits[0];
      const parentId = hit.object.userData.partId;
      const parent = this.assembly.get(parentId);
      const node = this.rig.nodes.get(parentId);
      if (!parent || !node) return null;

      if (parent.kind === 'bone') {
        // thread it onto the shaft at the height that was clicked
        node.group.updateMatrixWorld(true);
        _v.copy(hit.point);
        node.group.worldToLocal(_v);
        const t = this._snapValue(THREE.MathUtils.clamp(_v.y, 0, parent.length));
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
          pos: faceAnchor(parent, face, forBone ? [0, 0, 0] : size),
          rot: forBone ? alignYToFace(face) : [0, 0, 0, 1],
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
    } else {
      this.ghost.scale.fromArray(plan.size);
    }
    this.ghost.visible = true;
  }

  // ---------------------------------------------------------- sculpting

  _hoverVoxel() {
    this.hoverVoxel = null;
    const id = this.selected;
    const node = id ? this.rig.nodes.get(id) : null;
    if (!node || node.part.kind === 'bone') return;

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

  _applySculpt() {
    const id = this.selected;
    const node = id ? this.rig.nodes.get(id) : null;
    if (!node || node.part.kind === 'bone' || !this.hoverVoxel) return;
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
      let added;
      if (this.tool === TOOL.BLOCK) {
        added = this.assembly.addBlock(plan.parentId, plan.mount, this.colorIndex, { size: plan.size });
      } else {
        added = this.assembly.addBone(plan.parentId, plan.mount, this.tool, { ...this.boneOpts });
      }
      if (!added) return;
      const made = [added.id];
      if (this.symmetry) {
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
    const twin = this.assembly.addBlock(part.parent, mount, this.colorIndex, { size: [...part.size] });
    if (twin) twin.vox = part.vox.clone();
    return twin;
  }

  // ---------------------------------------------------------- frame

  enter() { this.active = true; this._syncCameraButtons(); }

  exit() {
    this.active = false;
    this.painting = false;
    this.gizmo.detach();
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
      // Idle: settle to rest so the silhouette is honest.
      const k = 1 - Math.pow(0.001, dt);
      for (const j of this.rig.joints) j.joint.quaternion.slerp(_q.identity(), k);
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
    this.controls.dispose();
  }
}
