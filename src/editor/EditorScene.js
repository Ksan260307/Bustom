import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Rig, ridesFarHalf } from '../core/Rig.js';
import { Assembly, computeStats, faceAnchor, alignYToFace } from '../core/Assembly.js';
import { Animator } from '../anim/Animator.js';
import { SHAPE_DEFAULT, SHAPES } from '../core/Shapes.js';
import { makeSky, EDITOR_SKY } from '../game/Sky.js';
import { PostFX } from '../game/PostFX.js';
import { VoxelBlock } from '../core/VoxelBlock.js';
import {
  SIZE_STEP, SIZE_MAX, EQUIP, EQUIP_META, EQUIP_THICKNESS, EQUIP_SIZE_DEFAULT,
  FACE_NORMAL, FACE_AXIS,
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
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
/** Separate from _m: _applyWorldTransform reuses _m, and the drag delta must
 *  survive the whole loop over the selection. */
const _delta = new THREE.Matrix4();
const _next = new THREE.Matrix4();
const _plane = new THREE.Plane();
const _box = new THREE.Box3();
const _box2 = new THREE.Box3();
const UP_VEC = new THREE.Vector3(0, 1, 0);

/**
 * How far the pointer may travel and still count as a click.
 *
 * The camera and the tools share the pointer, so "did you mean to press
 * here, or to look over there?" has to be answered by something. A few
 * pixels of slop covers the wobble in a real hand on a real mouse.
 */
const CLICK_SLOP = 4;

/** How high the free-placement plane can be lifted off the floor. */
const PLANE_MAX = 12;

/** The block the brush slider is calibrated against, in metres. */
const BRUSH_REFERENCE = 1;

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
  constructor({ renderer, canvas, post = null }) {
    this.renderer = renderer;
    /** Shared with every other scene: one HDR target for the whole app. */
    this.post = post;
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
    this.newBlockShape = SHAPE_DEFAULT;
    this.boneOpts = { length: 3, radius: 0.22, limit: 70, invert: false };

    /** @type {Set<string>} every selected part id. */
    this.selection = new Set();
    this.gizmoMode = 'translate';
    this.snap = true;
    /** How coarse the placement grid is, in metres. */
    this.snapStep = SIZE_STEP;
    this.hoverVoxel = null;
    this.previewMotion = false;
    /** Circle lines are a building aid, so they are on while building. */
    this.showRingGuides = true;
    /** Plates whose gimmick the builder has stopped, by part id. */
    this.gimmickOff = new Set();
    /** A mount moved, so which parts a circle carries needs deciding again. */
    this._ringsStale = false;
    /**
     * Mirrored placement, ON by default.
     *
     * Nearly every machine anyone builds is symmetrical, so the default that
     * costs nothing is the one that puts the other arm on for you. Turning
     * it off is one click; noticing it exists after building half a machine
     * by hand is not.
     */
    this.symmetry = true;

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
    /** Where the stamp's own root sits inside those bounds. */
    this.stampOffset = [0, 0, 0];

    /**
     * Quarter turns applied to the part about to be placed, about the face
     * it is landing on.
     *
     * Fourteen of the twenty-one shapes have a front and a top — a wedge, a
     * stair, an arch — and without this the only way to point one was to
     * place it and then type into the rotation field.
     */
    this.placeTurn = 0;
    /**
     * Height of the plane a free-floating part lands on. The floor to begin
     * with, so a machine can be built up from the ground; raised and lowered
     * with the wheel.
     */
    this.workPlaneY = 0;
    /** True while the ghost is overlapping something it is not resting on. */
    this.placeBlocked = false;
    /** What the read-out beside the cursor should say, or null for nothing. */
    this.placementHint = null;
    this.onHint = () => {};
    /** Opened and closed around a drag that lays a row of parts. */
    this.onGesture = () => {};

    this._buildEnvironment();
    this._buildOverlays();
    this._buildJointGizmo();
    this._buildGizmo();
    this._bindPointer();
    this._syncCameraButtons();
    this._cursor = { x: 0, y: 0 };
    /** The spot the last part in a drag went, so the next one is elsewhere. */
    this._lastLaid = null;
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
    // The workbench gets the same kind of sky the arena has, a shade
    // lighter. It is mostly here for what it does to the metal: bone shafts
    // and plate accents have nothing to reflect without it.
    this.sky = makeSky(this.renderer, EDITOR_SKY);
    this.scene.background = this.sky.texture;
    this.scene.backgroundIntensity = 0.4;
    this.scene.environment = this.sky.environment;

    const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x3c4964, 0.8);
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

    const rim = new THREE.DirectionalLight(0xffe0bd, 0.38);
    rim.position.set(2, 5, -12);
    this.scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 64),
      new THREE.MeshStandardMaterial({
        color: 0x141b25, roughness: 0.58, metalness: 0.2, envMapIntensity: 0.55,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.001;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(24, 24, 0x4f9fd0, 0x232f3d);
    grid.material.transparent = true;
    grid.material.opacity = 0.6;
    this.scene.add(grid);
    this.grid = grid;

    // A lit ring at the edge of the pad, matching the arena's.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(13.6, 14, 96),
      new THREE.MeshBasicMaterial({
        color: 0x5fc8ff, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.004;
    this.scene.add(ring);

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
    this.ghostBox = new THREE.BoxGeometry(1, 1, 1);
    /** Ghost bodies for each block shape, cut once and kept. */
    this.ghostShapes = new Map();
    /** And their outlines. */
    this.ghostEdgeGeos = new Map();
    this.boxEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.ghost = new THREE.Mesh(
      this.ghostBox,
      new THREE.MeshBasicMaterial({
        color: 0x4fd2ff, transparent: true, opacity: 0.22, depthWrite: false,
      }),
    );
    this.ghostWire = new THREE.LineSegments(
      this.boxEdges,
      new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.8, depthTest: false }),
    );
    this.ghost.add(this.ghostWire);
    /**
     * The room the block takes up, under the outline of its actual shape.
     *
     * The outline used to be a box and only a box, which drew a crate round
     * a sphere — but the box is not nothing either: it is the footprint that
     * decides where the next one can go. So both, and the footprint faint.
     */
    this.ghostFootprint = new THREE.LineSegments(this.boxEdges, new THREE.LineBasicMaterial({
      color: 0x9fe8ff, transparent: true, opacity: 0.22, depthTest: false,
    }));
    this.ghostFootprint.visible = false;
    this.ghost.add(this.ghostFootprint);
    this.ghost.visible = false;
    this.ghost.renderOrder = 9;
    this.scene.add(this.ghost);

    /**
     * The other one, when mirrored placement is on.
     *
     * Symmetry is on by default because almost every machine is symmetrical
     * and it halves the work — but "one click puts down two parts" is a
     * surprising thing to learn AFTER clicking. Showing the twin before the
     * click makes the setting explain itself, and a checkbox nobody has to
     * find is worth more than one they have to be told about.
     */
    this.ghostTwin = new THREE.Mesh(this.ghost.geometry, this.ghost.material);
    this.ghostTwin.add(new THREE.LineSegments(
      this.ghostWire.geometry, this.ghostWire.material,
    ));
    this.ghostTwin.visible = false;
    this.ghostTwin.renderOrder = 9;
    this.scene.add(this.ghostTwin);

    /** Which part the next click would attach to. */
    this.hostOutline = new THREE.LineSegments(this.outlineGeo, new THREE.LineBasicMaterial({
      color: 0x8effc9, transparent: true, opacity: 0.55, depthTest: false,
    }));
    this.hostOutline.visible = false;
    this.hostOutline.renderOrder = 10;
    this.scene.add(this.hostOutline);

    /**
     * Where the floor is, for a part being dropped in mid-air.
     *
     * A part hanging in space with nothing under it gives the eye nothing to
     * measure its height against, and height is the one thing the ghost
     * cannot show on its own.
     */
    const markGeo = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 33 }, (_, i) => new THREE.Vector3(
        Math.cos((i / 32) * Math.PI * 2) * 0.5, 0, Math.sin((i / 32) * Math.PI * 2) * 0.5,
      )),
    );
    this.planeMark = new THREE.Line(markGeo, new THREE.LineBasicMaterial({
      color: 0x4fd2ff, transparent: true, opacity: 0.55,
    }));
    this.planeDrop = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]),
      new THREE.LineBasicMaterial({ color: 0x4fd2ff, transparent: true, opacity: 0.4 }),
    );
    this.planeMark.visible = false;
    this.planeDrop.visible = false;
    this.scene.add(this.planeMark);
    this.scene.add(this.planeDrop);

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
   * Working needs the left button, so the camera moves to the right one.
   *
   * Placing used to SHARE the left button with the camera: the press landed
   * a part and the drag then swung the view, so every attempt to look round
   * the machine dropped a block first. Sculpting had already been given the
   * button to itself for exactly this reason; placing gets the same deal.
   */
  _syncCameraButtons() {
    const working = SCULPT_TOOLS.has(this.tool) || PART_TOOLS.has(this.tool);
    this.controls.mouseButtons = working
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
    // The rig is thrown away and rebuilt on every structural edit, so
    // anything the BUILDER has switched has to be put back on the new one.
    this.rig.setRingGuides(this.showRingGuides);
    for (const id of this.gimmickOff) this.rig.setGimmickPaused(id, true);
  }

  /** Show or hide the circle a CIRCLE plate draws around itself. */
  setRingGuides(on) {
    this.showRingGuides = !!on;
    this.rig.setRingGuides(this.showRingGuides);
    return this;
  }

  /**
   * Stop or start one plate's gimmick.
   *
   * A building aid, not a property of the machine: a ring turning under the
   * cursor is a ring you cannot place anything on. Whatever is switched off
   * here is still switched on in the field.
   */
  setGimmickRunning(partId, running) {
    if (running) this.gimmickOff.delete(partId);
    else this.gimmickOff.add(partId);
    this.rig.setGimmickPaused(partId, !running);
    return this;
  }

  /** Is this plate's gimmick running in the editor? */
  gimmickRunning(partId) { return !this.gimmickOff.has(partId); }

  /** Rebuild the rig after a structural edit, keeping the selection if we can. */
  rebuild() {
    this._ringsStale = false;
    const keep = [...this.selection].filter((id) => this.assembly.get(id));
    this.rig.dispose();
    this._makeRig();
    this.selection = new Set(keep);
    this._syncSelectionVisuals();
    this.onChange(this.stats);
    this.onSelect(this.selectedParts());
  }

  /**
   * Turn the walk preview on or off. Switching it OFF snaps straight back to
   * the rest pose — easing out of a stride over a second reads as "it did not
   * reset", and every measurement the editor makes (bounds, ground offset,
   * the framing) assumes the machine is standing still.
   */
  setPreviewMotion(on) {
    this.previewMotion = !!on;
    if (!this.previewMotion) this.resetPose();
    return this;
  }

  /** Put every joint back to rest and the body back on the floor, now. */
  resetPose() {
    if (!this.rig) return this;
    this.rig.resetPose();
    this.rig.root.position.set(0, this.groundOffset, 0);
    this.rig.root.rotation.set(0, 0, 0);
    this.rig.root.updateMatrixWorld(true);
    if (this.animator) {
      this.animator.bodyBob = 0;
      this.animator.bodyLean.set(0, 0);
    }
    this._syncSelectionVisuals();
    return this;
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

  /**
   * Everything that would go if the selection were deleted, including the
   * parts standing on it. Removing a block takes its whole subtree, and a
   * count is the least the button can say before it happens.
   */
  doomedCount() {
    const doomed = new Set();
    for (const id of this.selection) {
      if (id === this.assembly.rootId) continue;
      for (const d of this.assembly.subtree(id)) doomed.add(d);
    }
    return doomed.size;
  }

  deleteSelected() {
    const doomed = [...this.selection].filter((id) => id !== this.assembly.rootId);
    if (!doomed.length) return false;
    const n = this.doomedCount();
    this.onBeforeChange(n > doomed.length ? `削除 (${n})` : '削除');
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

    // The gizmo follows the SELECTION, not the tool.
    //
    // It used to appear only under the select tool, so the loop everybody
    // actually runs — place a part, then nudge it into place — cost a mode
    // switch every single time, on a part that was already selected and
    // already showing its numbers in the inspector.
    //
    // It shrinks while a placement tool is armed: the handles sit right over
    // the faces you would click to place the NEXT part, and a smaller arm
    // keeps them out of the way while still being there to grab.
    if (SCULPT_TOOLS.has(this.tool)) {
      this.gizmo.detach();
    } else {
      this.gizmo.attach(this.pivot);
      this.gizmo.setSize(this.tool === TOOL.SELECT ? 0.85 : 0.55);
    }

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
        // A block's size is three numbers; a plate's is one. Spreading the
        // one throws, and copying a plate is a perfectly ordinary thing to do.
        size: Array.isArray(part.size) ? [...part.size] : (part.size ?? null),
        mount: part.mount ? { ...part.mount, pos: [...part.mount.pos], rot: [...part.mount.rot] } : null,
      });
    }
    return out;
  }

  /**
   * Paste clipboard entries back in, nudged off the original so the copy is
   * visible rather than hiding inside its source.
   * @returns {string[]} the ids of the pasted roots
   */
  paste(entries, { offset = null } = {}) {
    if (!entries?.length) return [];
    const fallback = this.selected ?? this.assembly.rootId;
    const made = [];

    for (const entry of entries) {
      const parent = this.assembly.get(entry.parent) ? entry.parent : fallback;
      const base = entry.mount ?? { pos: [0, 0, 0], rot: [0, 0, 0, 1] };
      // Clear of the original rather than a fixed quarter of a metre. A
      // copy of a two-metre block landed all but exactly on top of the block
      // it came from, and a paste you cannot see is a paste you press again.
      const span = Array.isArray(entry.size)
        ? ((entry.size[0] ?? 1) + (entry.size[2] ?? 1)) / 2
        : (entry.size ?? 1);
      const step = offset ?? Math.max(SIZE_STEP, span * 0.7);
      const mount = {
        ...base,
        pos: [base.pos[0] + step, base.pos[1], base.pos[2] + step],
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
      const size = probe.bounds.getSize(_v).clone();
      const mid = probe.bounds.getCenter(_v2).clone();
      this.stampSize = [
        Math.max(0.25, size.x), Math.max(0.25, size.y), Math.max(0.25, size.z),
      ];
      // A grafted part is hung by its ROOT, and a part's root is hardly ever
      // the middle of the box it fits in. Without this the ghost was drawn
      // round the root while the part itself arrived somewhere else, and the
      // flush mount pushed out by half a box the part did not fill.
      const root = probe.nodes.get(assembly.rootId);
      if (root) {
        root.group.getWorldPosition(_v);
        this.stampOffset = [_v.x - mid.x, _v.y - mid.y, _v.z - mid.z];
      } else {
        this.stampOffset = [0, 0, 0];
      }
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
    if (this._pendingRebuild || this._ringsStale) {
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
    // Moving anything can change which parts a circle is carrying — the
    // plate as much as the riders. Deciding that means rebuilding the rig,
    // which is too heavy to do on every mouse move, so it is noted here and
    // acted on when the move is finished.
    if (this.rig.rings.length) this._ringsStale = true;

    // A mount is written in the frame the part was BUILT in. That is not
    // always the frame it is sitting in: a circle lends itself its riders,
    // and reading one's new place out of the ring would write the plate's
    // own offset into the machine. It moved the part every time it was
    // nudged, which nothing noticed because it slid along the line it was
    // already on.
    const frame = node.host ?? node.group.parent;
    frame.updateWorldMatrix(true, false);
    _m.copy(frame.matrixWorld).invert().multiply(world);
    _m.decompose(_v, _q, _s);

    const parentPart = this.assembly.get(node.part.parent);
    const inFar = parentPart?.kind === 'bone' && node.host === this.rig.nodes.get(parentPart.id).far;
    const y = inFar ? _v.y + parentPart.length / 2 : _v.y;

    this.assembly.setMount(id, { pos: [_v.x, y, _v.z], rot: _q.toArray() });

    // And put the group itself wherever it actually hangs. For a rider that
    // means inside the ring, and its remembered home has to move with it or
    // the next frame's sync drags it back under the cursor.
    this.rig.rehomeRider(id, world);
    const parent = node.group.parent;
    if (parent === frame) {
      node.group.position.copy(_v);
      node.group.quaternion.copy(_q);
    } else {
      parent.updateWorldMatrix(true, false);
      _m.copy(parent.matrixWorld).invert().multiply(world).decompose(_v2, _q, _s);
      node.group.position.copy(_v2);
      node.group.quaternion.copy(_q);
    }
    node.group.updateMatrixWorld(true);

    // did it change halves?
    if (parentPart?.kind === 'bone') {
      return ridesFarHalf(node.part, parentPart) === inFar;
    }
    return true;
  }

  // ---------------------------------------------------------- editing ops

  /**
   * Resize every block in the selection.
   *
   * All of them, not just the one that happens to be primary. Selecting four
   * legs and dragging the width slider is the whole reason multi-select
   * exists, and it used to change exactly one of them with nothing on screen
   * to say so.
   */
  resizeSelected(size) {
    const ids = [...this.selection].filter((id) => {
      const p = this.assembly.get(id);
      return p && p.kind !== 'bone';
    });
    if (!ids.length) return false;
    this.onBeforeChange('寸法変更');
    let moved = false;
    for (const id of ids) {
      const part = this.assembly.get(id);
      const before = part.size ? [...part.size] : null;
      this.assembly.setSize(id, size);
      this.rig.refreshSize(id);
      // A part put down flush against a face STAYS flush. A block grows about
      // its own middle, so half of every millimetre added used to disappear
      // into whatever it was standing on — quietly, from the inside.
      const face = part.mount?.face;
      if (before && face !== undefined && FACE_AXIS[face] !== undefined) {
        const axis = FACE_AXIS[face];
        const grew = ((part.size[axis] ?? 0) - (before[axis] ?? 0)) / 2;
        if (grew) {
          part.mount.pos[axis] += FACE_NORMAL[face][axis] * grew;
          if (!this.rig.refreshMount(id)) moved = true;
        }
      }
    }
    if (moved) { this.rebuild(); return true; }
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

  /** Resize every PLATE in the selection; blocks and bones are skipped. */
  setEquipSizeSelected(size) {
    const ids = [...this.selection].filter((id) => this.assembly.get(id)?.kind === 'equip');
    if (!ids.length) return false;
    this.onBeforeChange('装備の大きさ');
    let rebuilt = false;
    for (const id of ids) {
      this.assembly.setEquipSize(id, size);
      if (!this.rig.refreshEquip(id)) rebuilt = true;
    }
    if (rebuilt) this.rebuild();
    this.refreshStats();
    this._syncSelectionVisuals();
    return true;
  }

  /**
   * Shift the selection by a world-space delta. Same path the gizmo drag
   * uses, so multi-selections move as one rigid group and children are not
   * moved twice.
   */
  nudgeSelected(delta, label = '微調整') {
    const roots = this._dragRoots();
    if (!roots.length) return false;
    this.onBeforeChange(label);

    // _applyWorldTransform takes an absolute matrix, so the delta has to be
    // applied on top of where each part currently is.
    _delta.makeTranslation(delta.x, delta.y, delta.z);
    let needsRebuild = false;
    for (const id of roots) {
      const node = this.rig.nodes.get(id);
      if (!node) continue;
      node.group.updateWorldMatrix(true, false);
      _next.multiplyMatrices(_delta, node.group.matrixWorld);
      if (!this._applyWorldTransform(id, _next)) needsRebuild = true;
    }
    if (needsRebuild || this._ringsStale) {
      // Something crossed a bone's midpoint and changed which half it rides,
      // or a circle has to work out who is on its line again. A nudge is one
      // discrete move, so this is the end of the gesture already.
      this.rebuild();
      return true;
    }

    this.refreshStats();
    this._syncSelectionVisuals();
    this.onSelect(this.selectedParts());
    return true;
  }

  /**
   * A nudge in the direction the player is looking rather than in world axes.
   * "Left" has to mean left on screen, or arrow keys are a puzzle.
   */
  nudgeSelectedByView(right, up, forward, step) {
    if (!this.selection.size) return false;
    this.camera.updateMatrixWorld(true);

    // Screen right and the horizontal "into the screen", both flattened so a
    // tilted camera still nudges along the floor.
    _v.setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0);
    if (_v.lengthSq() < 1e-6) _v.set(1, 0, 0);
    _v.normalize();
    _v2.set(_v.z, 0, -_v.x);              // right x world-up = into the screen

    _s.set(
      (_v.x * right + _v2.x * forward) * step,
      up * step,
      (_v.z * right + _v2.z * forward) * step,
    );
    return this.nudgeSelected(_s);
  }

  /** Which way and how fast the selected SPINNING plates turn. */
  setEquipSpinSelected(spin) {
    const ids = [...this.selection]
      .filter((id) => { const p = this.assembly.get(id); return p?.kind === 'equip' && p.spin; });
    if (!ids.length) return false;
    this.onBeforeChange('回転設定');
    for (const id of ids) this.assembly.setEquipSpin(id, spin);
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

  /** Reshape every BONE in the selection; anything else is skipped. */
  setBoneShapeSelected(shape) {
    const ids = [...this.selection].filter((id) => this.assembly.get(id)?.kind === 'bone');
    if (!ids.length) return false;
    this.onBeforeChange('ボーン寸法');
    for (const id of ids) this.assembly.setBoneShape(id, shape);
    this.rebuild();
    return true;
  }

  /**
   * Re-cut every selected block to a shape. Bones and plates in the
   * selection are simply skipped rather than refusing the whole action.
   */
  setBlockShapeSelected(shape) {
    const ids = [...this.selection].filter((id) => this.assembly.get(id)?.vox);
    if (!ids.length) return false;
    this.onBeforeChange('形状');
    let changed = false;
    for (const id of ids) if (this.assembly.setBlockShape(id, shape)) changed = true;
    if (!changed) return false;
    for (const id of ids) this.rig.refreshBlock(id);
    this.refreshStats();
    return true;
  }

  /** How wide a ring the selected CIRCLE plate turns. */
  setEquipRingSelected(radius) {
    const id = this.selected;
    if (!id) return false;
    this.onBeforeChange('サークル半径');
    if (!this.assembly.setEquipRing(id, radius)) return false;
    // Which parts ride the ring is decided when the rig is built, so the
    // scene graph has to be rebuilt for a new radius to mean anything.
    this.rebuild();
    return true;
  }

  /**
   * Size a freshly placed circle to the machine it landed on.
   *
   * Only ever for a plate that has just been put down, and only when the
   * fitted circle would pick something up. A plate placed on a machine and
   * left at a fixed default draws its line outside everything and turns
   * nothing at all, which reads as a broken part rather than as a number
   * that wants adjusting.
   */
  _fitNewRings(ids) {
    let changed = false;
    for (const id of ids) {
      const part = this.assembly.get(id);
      if (!part || part.kind !== 'equip' || !EQUIP_META[part.equipType]?.ring) continue;
      const fitted = this.rig.fitRingRadius(id);
      if (fitted === null || fitted === part.ringRadius) continue;
      if (this.assembly.setEquipRing(id, fitted)) changed = true;
    }
    // One rebuild for the lot: the ring decides who is on it as it is built.
    if (changed) this.rebuild();
    return changed;
  }

  /** Which way the selected plate's circle lies. */
  setEquipRingPlaneSelected(plane) {
    const id = this.selected;
    if (!id) return false;
    this.onBeforeChange('サークルの向き');
    if (!this.assembly.setEquipRingPlane(id, plane)) return false;
    // Same reason as the radius: turning the ring re-decides who is on it.
    this.rebuild();
    return true;
  }

  /** How much of their attribute's motion the selected bones take, and when. */
  setBoneMotionSelected(motion) {
    const ids = [...this.selection].filter((id) => this.assembly.get(id)?.kind === 'bone');
    if (!ids.length) return false;
    this.onBeforeChange('関節の効き');
    for (const id of ids) this.assembly.setBoneMotion(id, motion);
    this.rebuild();
    return true;
  }

  setMountSelected({ pos, rot }) {
    const id = this.selected;
    if (!id) return false;
    this.onBeforeChange('位置変更');
    if (!this.assembly.setMount(id, { pos, rot })) return false;
    // A typed position is a finished move, so a circle can settle who is on
    // it straight away.
    if (this.rig.rings.length || !this.rig.refreshMount(id)) this.rebuild();
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
        copy = this.assembly.addBlock(p.parent, mount, this.colorIndex, {
          size: [...p.size], shape: p.shape,
        });
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
    /**
     * Where a press began, so a drag can be told from a click.
     *
     * Everything used to happen on the press itself, which is why looking
     * round the machine dropped a part first. Waiting for the release also
     * buys the one thing a touch screen never had: the ghost is up, and the
     * finger can be moved to aim it, before anything is committed.
     */
    this._press = null;

    this._move = (e) => {
      if (!this.active) return;
      this._updateNdc(e);
      const press = this._press;
      if (press && !press.moved
        && Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP) {
        press.moved = true;
      }
      this._hover();
      // Holding the button and dragging lays a row rather than making one
      // careful click per part.
      if (press?.button === 0 && press.moved && PART_TOOLS.has(this.tool)) this._layAlong();
    };
    this._down = (e) => {
      if (!this.active || (e.button !== 0 && e.button !== 2)) return;
      // `dragging` is only true once the gizmo's own handler has run, and
      // which listener goes first is not ours to decide. `axis` is set the
      // moment the pointer is over a handle, so it answers the question that
      // actually matters: is this press meant for the gizmo? Getting it
      // wrong now drops a block every time you reach for an arrow.
      if (this.gizmo.dragging || (this.gizmo.object && this.gizmo.axis)) return;
      this._updateNdc(e);
      this._press = {
        x: e.clientX, y: e.clientY, button: e.button, moved: false, laid: 0,
        // Read from the PRESS, not the release: holding Ctrl and letting go
        // of it a moment early still means "add to the selection", and it is
        // the press that the person was thinking about.
        additive: e.ctrlKey || e.metaKey,
        pick: e.altKey,
      };
      this._hover();
      if (e.button === 0 && SCULPT_TOOLS.has(this.tool)) this.beginStroke();
    };
    this._up = (e) => {
      if (this.painting) {
        this.painting = false;
        this.refreshStats();
      }
      const press = this._press;
      this._press = null;
      this._lastLaid = null;
      if (!press || !this.active) return;
      if (press.laid) { this.onGesture(false); return; }
      if (press.moved) return;                  // that was the camera, or a row
      if (press.button === 2) { this.deleteUnderCursor(); return; }
      if (SCULPT_TOOLS.has(this.tool)) return;
      // Alt picks the part up instead of putting one down; Ctrl (or Cmd)
      // adds to the selection.
      if (press.pick || e.altKey) this.pickUnderCursor();
      else this._applyClick(press.additive || e.ctrlKey || e.metaKey);
    };
    this._context = (e) => { if (this.active) e.preventDefault(); };
    /**
     * Shift and the wheel lift the plane a free-floating part lands on.
     *
     * Taken before the camera sees it, or the view zooms at the same time.
     */
    this._wheel = (e) => {
      if (!this.active || !e.shiftKey || !PART_TOOLS.has(this.tool)) return;
      e.preventDefault();
      e.stopPropagation();
      this.liftWorkPlane(e.deltaY < 0 ? 1 : -1);
    };
    this._key = (e) => {
      if (!this.active) return;
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); this.deleteSelected(); }
      if (e.code === 'BracketLeft') this.brushPercent = Math.max(1, this.brushPercent - 1);
      if (e.code === 'BracketRight') this.brushPercent = Math.min(25, this.brushPercent + 1);
    };

    el.addEventListener('wheel', this._wheel, { capture: true, passive: false });
    el.addEventListener('pointermove', this._move);
    el.addEventListener('pointerdown', this._down);
    el.addEventListener('contextmenu', this._context);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('keydown', this._key);
  }

  _updateNdc(e) {
    const r = this.canvas.getBoundingClientRect();
    this._cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
    _ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    _ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    _ray.setFromCamera(_ndc, this.camera);
  }

  _hover() {
    this.voxCursor.visible = false;
    this.ghost.visible = false;
    this.ghostTwin.visible = false;
    this.hostOutline.visible = false;
    this.planeMark.visible = false;
    this.planeDrop.visible = false;
    if (!this.rig) return;
    if (SCULPT_TOOLS.has(this.tool)) { this._hoverVoxel(); this._sayHint(null); return; }
    if (PART_TOOLS.has(this.tool)) this._hoverGhost();
    else this._sayHint(null);
  }

  /** Tell whoever is drawing the read-out what the cursor is about to do. */
  _sayHint(hint) {
    this.placementHint = hint;
    this.onHint(hint);
  }

  // ---------------------------------------------------------- placement

  /** Where would a new part land, given the current ray? */
  proposePlacement() {
    const plan = this._proposeRaw();
    if (!plan || this.tool !== TOOL.STAMP) return plan;
    // A graft hangs the part by its ROOT; the ghost and the flush mount are
    // both about the box the part fills. Those are the same point only for a
    // part whose root happens to sit at its own centre, which is not the
    // usual shape of a saved part at all.
    _v.fromArray(this.stampOffset).applyQuaternion(_q.fromArray(plan.mount.rot));
    plan.ghostOffset = [_v.x, _v.y, _v.z];
    plan.mount.pos = [
      plan.mount.pos[0] + _v.x,
      plan.mount.pos[1] + _v.y,
      plan.mount.pos[2] + _v.z,
    ];
    return plan;
  }

  _proposeRaw() {
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

      // WHERE on the face, not just which one. Every placement used to land
      // on the middle of the face it was made against, so a row of three
      // across a chest plate meant placing one and dragging the other two.
      // The parent's own frame is the right one to measure in even when the
      // machine is mid-stride: a posed part still knows its own inside.
      _v2.copy(hit.point);
      node.group.worldToLocal(_v2);
      const at = [this._snapValue(_v2.x), this._snapValue(_v2.y), this._snapValue(_v2.z)];

      return {
        parentId,
        mount: {
          pos: faceAnchor(parent, face, alignY ? [0, 0, 0] : size, at),
          rot: this._turned(alignY ? alignYToFace(face) : [0, 0, 0, 1], face),
          // Kept with the part: resizing it later has to know which way is
          // "out" to stay flush, and that is not recoverable afterwards.
          face,
        },
        size,
      };
    }

    // Empty space: drop it on a horizontal work plane, which is what makes
    // detached, floating parts possible. The plane starts ON THE FLOOR, so
    // "click the ground and build upwards" works; the wheel lifts it.
    //
    // It used to sit at the height of whatever happened to be selected,
    // which meant the height could only be chosen by selecting something
    // else first — a rule written down nowhere.
    _plane.setFromNormalAndCoplanarPoint(
      _v2.set(0, 1, 0), _v.set(0, this.groundOffset + this.workPlaneY, 0),
    );
    const point = _ray.ray.intersectPlane(_plane, new THREE.Vector3());
    if (!point) return null;

    // Measured against the root's REST frame, which we know exactly, rather
    // than through whatever matrix the walk preview has the machine in this
    // frame. Placing during the preview used to leave the part somewhere
    // else the moment the machine stood still again.
    const parentId = this.assembly.rootId;
    const rest = [point.x, point.y - this.groundOffset, point.z];
    // A part dropped on the plane STANDS on it rather than being buried to
    // the waist in it.
    const lift = forBone || forEquip ? 0 : (size[1] ?? 0) / 2;
    return {
      parentId,
      mount: {
        pos: [
          this._snapValue(rest[0]),
          this._snapValue(rest[1]) + lift,
          this._snapValue(rest[2]),
        ],
        rot: this._turned(forBone ? alignYToFace(3) : [0, 0, 0, 1], 2),
      },
      size,
      floating: true,
    };
  }

  /**
   * The placement rotation with the builder's quarter turns folded in,
   * about the face the part is landing on.
   */
  _turned(rot, face) {
    if (!this.placeTurn) return rot;
    _q.fromArray(rot);
    _v.fromArray(FACE_NORMAL[face]);
    _q2.setFromAxisAngle(_v, (this.placeTurn * Math.PI) / 2);
    return _q2.multiply(_q).toArray();
  }

  /**
   * Would this land inside something that is not what it is resting on?
   *
   * Nothing is refused — burying a block on purpose is a real way to build —
   * but the ghost says so, because the alternative is finding out later by
   * noticing a part is missing from the inside of a machine.
   */
  _overlaps(plan) {
    const host = this.rig.nodes.get(plan.parentId);
    if (!host || BONE_TOOLS.has(this.tool) || this.tool === TOOL.EQUIP) return false;
    host.group.updateMatrixWorld(true);
    const centre = host.group.localToWorld(_v.fromArray(plan.mount.pos)).clone();
    // A hair inside its own footprint, so merely TOUCHING a neighbour — which
    // is exactly what a flush mount is — does not read as a collision.
    const half = new THREE.Vector3().fromArray(plan.size).multiplyScalar(0.5).subScalar(0.06);
    if (half.x <= 0 || half.y <= 0 || half.z <= 0) return false;
    _box.setFromCenterAndSize(centre, half.multiplyScalar(2));

    for (const [id, node] of this.rig.nodes) {
      if (id === plan.parentId) continue;
      if (!this._worldAabb(node, _box2)) continue;
      if (_box.intersectsBox(_box2)) return true;
    }
    return false;
  }

  /**
   * Axis-aligned world bounds of one solid part, for coarse overlap tests.
   * Bones and plates are skipped: they are meant to pass through things.
   */
  _worldAabb(node, out) {
    const part = node.part;
    if (!part || part.kind === 'bone' || part.kind === 'equip') return null;
    node.group.updateMatrixWorld(true);
    _s.fromArray(part.size).multiplyScalar(0.5);
    _m.compose(
      node.group.getWorldPosition(_v),
      node.group.getWorldQuaternion(_q),
      _v2.set(1, 1, 1),
    );
    out.makeEmpty();
    for (let i = 0; i < 8; i++) {
      _v.set(
        (i & 1 ? _s.x : -_s.x), (i & 2 ? _s.y : -_s.y), (i & 4 ? _s.z : -_s.z),
      ).applyMatrix4(_m);
      out.expandByPoint(_v);
    }
    return out;
  }

  _snapValue(v) {
    const step = this.snapStep || SIZE_STEP;
    return this.snap ? Math.round(v / step) * step : v;
  }

  _hoverGhost() {
    // An unarmed stamp has nothing to show. The old guard set the ghost
    // invisible and then the next line turned it straight back on.
    if (this.tool === TOOL.STAMP && !this.stampSource) {
      this.pendingPlacement = null;
      this._sayHint(null);
      return;
    }
    const plan = this.proposePlacement();
    this.pendingPlacement = plan;
    if (!plan) { this._sayHint(null); return; }
    const host = this.rig.nodes.get(plan.parentId);
    if (!host) { this._sayHint(null); return; }

    host.group.updateMatrixWorld(true);
    _v.fromArray(plan.mount.pos);
    if (plan.ghostOffset) _v.sub(_v2.fromArray(plan.ghostOffset));
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
    // The preview shows the SHAPE that is armed, not a stand-in box: picking
    // "球" and being shown a cube is the cursor telling you the wrong thing.
    this.ghost.geometry = this.tool === TOOL.BLOCK
      ? this._ghostGeometry(this.newBlockShape)
      : this.ghostBox;
    // The outline follows the same shape. A box drawn round a sphere is the
    // cursor telling you the wrong thing twice over — once in the fill, and
    // again in the only part of it that shows through the machine.
    this.ghostWire.geometry = this.tool === TOOL.BLOCK
      ? this._ghostEdges(this.newBlockShape)
      : this.boxEdges;
    this.ghostFootprint.visible = this.ghostWire.geometry !== this.boxEdges;

    this.placeBlocked = this._overlaps(plan);
    this.ghost.material.color.setHex(this.placeBlocked ? 0xff6a5c : 0x4fd2ff);
    this.ghostWire.material.color.setHex(this.placeBlocked ? 0xffb0a8 : 0x9fe8ff);

    this.ghost.visible = true;

    // Who it will belong to. Half of what a placement decides is invisible
    // otherwise: the parent is what the part moves with once the machine is
    // on its feet.
    if (!plan.floating) {
      this._partBox(host, this.hostOutline);
      this.hostOutline.visible = true;
    }

    // And, in mid-air, how high off the floor it is.
    if (plan.floating) {
      const y = this.groundOffset + this.workPlaneY;
      this.planeMark.position.set(this.ghost.position.x, y + 0.004, this.ghost.position.z);
      this.planeMark.scale.setScalar(Math.max(1, plan.size[0] * 1.6));
      this.planeMark.visible = true;
      this.planeDrop.position.copy(this.planeMark.position);
      this.planeDrop.scale.set(1, Math.max(0.001, this.ghost.position.y - y), 1);
      this.planeDrop.visible = true;
    }

    this._sayHint({
      text: this._planLabel(plan),
      blocked: this.placeBlocked,
      x: this._cursor.x,
      y: this._cursor.y,
    });
    this._hoverGhostTwin(plan);
  }

  /** One line describing what a click would put down, and where. */
  _planLabel(plan) {
    const d = plan.size.map((n) => n.toFixed(2)).join('x');
    if (BONE_TOOLS.has(this.tool)) return `ボーン ${this.boneOpts.length.toFixed(2)}`;
    if (this.tool === TOOL.EQUIP) {
      return `${EQUIP_META[this.equipType]?.label ?? ''} ${this.newEquipSize.toFixed(2)}`;
    }
    if (this.tool === TOOL.STAMP) return `パーツ ${d}`;
    const shape = SHAPES[this.newBlockShape]?.label ?? '';
    const turn = this.placeTurn ? ` ${this.placeTurn * 90}°` : '';
    const high = plan.floating ? ` 高さ ${this.workPlaneY.toFixed(2)}` : '';
    return `${shape} ${d}${turn}${high}`;
  }

  /** Edges of one shape's ghost body, cut once and kept. */
  _ghostEdges(shape) {
    if (!shape || shape === SHAPE_DEFAULT) return this.boxEdges;
    let geo = this.ghostEdgeGeos.get(shape);
    if (!geo) {
      geo = new THREE.EdgesGeometry(this._ghostGeometry(shape), 24);
      this.ghostEdgeGeos.set(shape, geo);
    }
    return geo;
  }

  /**
   * Show where the mirrored copy would land, if one would.
   *
   * Drawn from the same calculation the placement itself uses, so the twin
   * is a promise the editor keeps. Nothing is shown for a part on the centre
   * line, because nothing is made there either.
   */
  _hoverGhostTwin(plan) {
    const twin = this.ghostTwin;
    twin.visible = false;
    if (!this.symmetry || this.tool === TOOL.STAMP) return;
    const mirrored = this._mirrorPlan(plan);
    if (!mirrored) return;
    const target = this.rig.nodes.get(mirrored.parentId);
    if (!target) return;

    target.group.updateMatrixWorld(true);
    _v.fromArray(mirrored.mount.pos);
    twin.position.copy(target.group.localToWorld(_v));
    twin.quaternion.copy(target.group.getWorldQuaternion(_q2))
      .multiply(_q.fromArray(mirrored.mount.rot));
    twin.geometry = this.ghost.geometry;
    twin.scale.copy(this.ghost.scale);
    if (BONE_TOOLS.has(this.tool)) twin.translateY(this.boneOpts.length / 2);
    else if (this.tool === TOOL.EQUIP) twin.translateY(EQUIP_THICKNESS / 2);
    twin.visible = true;
  }

  /**
   * Where the mirrored copy of a placement goes.
   *
   * Reflected through the MACHINE's centre line, not through whatever the
   * part happens to be attached to. The old rule negated X in the parent's
   * own frame, which is only the body's centre line when the parent is
   * itself centred — so a detail put on the left shoulder came back on the
   * same left shoulder, and the checkbox saying "左右対称" was telling the
   * truth about the wrong plane.
   *
   * It hangs the twin off the parent's own mirror image when the machine has
   * one, so the two sides ride with their own halves; otherwise off the same
   * parent, which still lands in the right place.
   *
   * Measured in whatever pose the machine is in. That is exact while it is
   * standing still, which is when placement happens — `_applyClick` puts it
   * back on its feet first.
   */
  _mirrorPlan(plan) {
    const host = this.rig.nodes.get(plan.parentId);
    if (!host) return null;
    this.rig.root.updateMatrixWorld(true);
    host.group.updateMatrixWorld(true);

    // Which parent first: working it out walks the whole rig, and it reads
    // the same scratch vectors the mirrored mount is about to live in.
    const parentId = this._mirrorHost(plan.parentId);
    const target = this.rig.nodes.get(parentId);
    if (!target) return null;
    target.group.updateMatrixWorld(true);

    // The placement, expressed in the machine's own frame.
    _m.compose(_v.fromArray(plan.mount.pos), _q.fromArray(plan.mount.rot), _s.set(1, 1, 1));
    _next.multiplyMatrices(host.group.matrixWorld, _m);
    _delta.copy(this.rig.root.matrixWorld).invert();
    _next.premultiply(_delta);
    _next.decompose(_v, _q, _s);
    if (Math.abs(_v.x) < 1e-6) return null;

    _v.x = -_v.x;
    _q.set(_q.x, -_q.y, -_q.z, _q.w);

    _next.compose(_v, _q, _s.set(1, 1, 1));
    _next.premultiply(this.rig.root.matrixWorld);
    _delta.copy(target.group.matrixWorld).invert();
    _next.premultiply(_delta);
    _next.decompose(_v, _q, _s);
    return { parentId, mount: { pos: _v.toArray(), rot: _q.toArray() } };
  }

  /** The part on the other side of the machine that matches this one. */
  _mirrorHost(id) {
    const part = this.assembly.get(id);
    const node = this.rig.nodes.get(id);
    if (!part || !node || id === this.assembly.rootId) return this.assembly.rootId;
    this.rig.root.updateMatrixWorld(true);
    node.group.getWorldPosition(_v);
    this.rig.root.worldToLocal(_v);
    if (Math.abs(_v.x) < 1e-4) return id;          // already on the centre line
    const want = -_v.x;
    const y = _v.y;
    const z = _v.z;

    let best = id;
    let bestD = 0.25;
    for (const [otherId, other] of this.rig.nodes) {
      if (otherId === id) continue;
      const p = this.assembly.get(otherId);
      if (!p || p.kind !== part.kind) continue;
      other.group.getWorldPosition(_v2);
      this.rig.root.worldToLocal(_v2);
      const d = Math.hypot(_v2.x - want, _v2.y - y, _v2.z - z);
      if (d < bestD) { bestD = d; best = otherId; }
    }
    return best;
  }

  /**
   * A ghost body for one shape, in the same centred unit cube the box ghost
   * uses. Cut through the real VoxelBlock and mesher, so the preview is made
   * the same way the block will be — but capped at 1/32, because nobody can
   * see the difference through a translucent overlay and a 1/100 grid is a
   * million cells to chew through on a mouse move.
   */
  _ghostGeometry(shape) {
    if (!shape || shape === SHAPE_DEFAULT) return this.ghostBox;
    const n = Math.min(32, this.assembly.voxRes);
    const key = `${shape}:${n}`;
    let geo = this.ghostShapes.get(key);
    if (!geo) {
      const vox = new VoxelBlock(n, 0).fillShape(shape, 0);
      geo = vox.geometry(this.assembly.palette).clone();
      geo.translate(-0.5, -0.5, -0.5);   // block meshes are 0..1; the ghost is centred
      vox.disposeGeometry();
      this.ghostShapes.set(key, geo);
    }
    return geo;
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
    const d = (this.brushRadiusCells(vox, node.part) * 2 + 1) / n;
    this.voxCursor.scale.set(d * sx, d * sy, d * sz);
    this.voxCursor.material.color.set(
      cell.grow ? 0xffd166                      // about to enlarge the block
        : this.tool === TOOL.CARVE ? 0xff6a5c
          : this.tool === TOOL.ADD ? 0x8effc9
            : this.assembly.palette.get(this.colorIndex),
    );
    this.voxCursor.visible = true;
  }

  /**
   * Enlarge the block one step on the face the brush ran off, then work out
   * where the cursor lands on the new, bigger grid.
   * @returns {boolean} whether there is room to keep going
   */
  _growForAdd(node, grow) {
    const part = node.part;
    if (part.size[grow.axis] >= SIZE_MAX - 1e-6) {
      this.onReject?.(`ブロックはこれ以上大きくできません（上限 ${SIZE_MAX}）`);
      this.hoverVoxel = null;
      return false;
    }
    const hadChildren = part.children.length > 0;
    if (!this.assembly.growBlock(part.id, grow.axis, grow.dir, SIZE_STEP)) return false;

    // The box, the contents, the mount and every child mount moved. A lone
    // block can be patched in place; anything with parts hanging off it is
    // cheaper and safer to rebuild than to fix up node by node.
    if (hadChildren) {
      this.rebuild();
    } else {
      this.rig.refreshSize(part.id);
      this.rig.refreshBlock(part.id);
      this.rig.refreshMount(part.id);
    }
    this.rig.root.updateMatrixWorld(true);
    this.refreshStats();
    this._hoverVoxel();
    return !!this.hoverVoxel;
  }

  /**
   * Brush radius in cells, at whatever resolution this block happens to be.
   *
   * Measured against a fixed metre rather than against the block. The grid
   * always spans the block it belongs to, so a fixed share of the grid is
   * not a fixed size in the world: the same slider used to cut a hole four
   * times wider on a four-metre block than on a one-metre one, on the same
   * machine, with nothing on screen to say why.
   */
  brushRadiusCells(vox, part = null) {
    const edge = Math.max(0.05, ...(part?.size ?? [BRUSH_REFERENCE]));
    const metres = (this.brushPercent / 100) * BRUSH_REFERENCE;
    return Math.max(0, Math.round((metres / edge) * vox.n));
  }

  /** How big one sculpting cell is, in metres, on the selected block. */
  cellSize() {
    const part = this.assembly.get(this.selected);
    const edge = Math.max(...(part?.size ?? [1, 1, 1]));
    return edge / (part?.vox?.n ?? this.assembly.voxRes);
  }

  /**
   * Convert a surface hit into voxel coordinates. Geometry is in unit-cube
   * space, so the mesh's own local frame is already 0..1 on every axis.
   */
  /**
   * Which cell a click lands on. For ADD the probe steps OUT of the surface,
   * so it can legitimately land one cell past the edge of the block — that is
   * the case that used to just fail, and is now a request to grow the block.
   */
  _voxelAt(node, hit, outside) {
    const n = node.part.vox.n;
    const step = 0.5 / n;
    const worldNormal = hit.face
      ? _v.copy(hit.face.normal).transformDirection(node.mesh.matrixWorld).normalize()
      : _v.set(0, 0, 0);
    const probe = hit.point.clone().addScaledVector(worldNormal, outside ? step * 2 : -step * 2);
    node.mesh.worldToLocal(probe);

    const cell = {
      x: Math.floor(probe.x * n),
      y: Math.floor(probe.y * n),
      z: Math.floor(probe.z * n),
    };
    const over = [cell.x, cell.y, cell.z].findIndex((v) => v < 0 || v >= n);
    if (over < 0) return cell;
    if (!outside) return null;

    // Just past a face: say which one. The probe steps a full cell clear of
    // the surface it hit, so landing one or two cells outside is the normal
    // case, not a stray click.
    const v = [cell.x, cell.y, cell.z][over];
    if (v < -2 || v > n + 1) return null;
    cell.grow = { axis: over, dir: v < 0 ? -1 : 1 };
    return cell;
  }

  /**
   * Open a sculpting stroke: one undo step per stroke, not per frame of
   * dragging, and then the first dab.
   */
  beginStroke() {
    if (!SCULPT_TOOLS.has(this.tool)) return false;
    if (this.hoverVoxel) {
      this.onBeforeChange(this.hoverVoxel.grow && this.tool === TOOL.ADD
        ? '盛る（ブロック拡張）'
        : { carve: '削る', add: '盛る', paint: '塗る' }[this.tool]);
    }
    this.painting = true;
    this._applySculpt();
    return true;
  }

  _applySculpt() {
    let id = this.selected;
    let node = id ? this.rig.nodes.get(id) : null;
    if (!node || !node.part.vox || !this.hoverVoxel) return;

    // Adding past the edge enlarges the block rather than doing nothing.
    if (this.hoverVoxel.grow && this.tool === TOOL.ADD) {
      if (!this._growForAdd(node, this.hoverVoxel.grow)) return;
      id = this.selected;
      node = this.rig.nodes.get(id);
      if (!node || !this.hoverVoxel || this.hoverVoxel.grow) return;
    }

    const { x, y, z } = this.hoverVoxel;
    const vox = node.part.vox;
    const r = this.brushRadiusCells(vox, node.part);
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
    this.placeTurn = 0;
    if (SCULPT_TOOLS.has(tool) && !this.selected) this.select(this.assembly.rootId);
    this._syncCameraButtons();
    this._syncSelectionVisuals();
    // Arming a tool and being shown nothing until the mouse happens to move
    // reads as "that did not work". The ray from the last known cursor
    // position is still good, so answer with it now.
    this._hover();
  }

  /**
   * Turn the part about to be placed a quarter turn about the face it lands
   * on. Four presses come back where it started.
   */
  turnPlacement(dir = 1) {
    this.placeTurn = (((this.placeTurn + dir) % 4) + 4) % 4;
    this._hover();
    return this.placeTurn;
  }

  /** Raise or lower the plane that free-floating parts land on. */
  liftWorkPlane(delta) {
    const step = this.snap ? SIZE_STEP : 0.05;
    this.workPlaneY = Math.min(PLANE_MAX, Math.max(0, this.workPlaneY + delta * step));
    this._hover();
    return this.workPlaneY;
  }

  /**
   * Take the shape, size and colour of the part under the cursor into the
   * armed tool, so the next one matches without hunting three sliders.
   */
  pickUnderCursor() {
    const hits = _ray.intersectObjects(this.rig.pickables, false);
    const part = hits.length ? this.assembly.get(hits[0].object.userData.partId) : null;
    if (!part) return null;
    if (part.kind === 'block' || part.kind === 'core') {
      this.newBlockSize = [...(part.size ?? [1, 1, 1])];
      this.newBlockShape = part.shape ?? SHAPE_DEFAULT;
      const c = part.vox?.dominantColor?.();
      if (typeof c === 'number' && c >= 0) this.colorIndex = c;
    } else if (part.kind === 'equip') {
      this.equipType = part.equipType;
      this.newEquipSize = part.size?.[0] ?? this.newEquipSize;
    } else if (part.kind === 'bone') {
      this.boneOpts = { ...this.boneOpts, length: part.length, radius: part.radius };
    }
    this._hover();
    return part;
  }

  /** Delete whatever the cursor is over, without leaving the tool. */
  deleteUnderCursor() {
    const hits = _ray.intersectObjects(this.rig.pickables, false);
    const id = hits.length ? hits[0].object.userData.partId : null;
    if (!id || id === this.assembly.rootId) return false;
    this.select(id);
    return this.deleteSelected();
  }

  /**
   * Put another part down, once the cursor has moved off the last one.
   *
   * The whole drag is one undo step. Twenty blocks laid along an arm used to
   * be twenty presses of Ctrl+Z, and since every entry is a whole snapshot
   * of the machine, three such arms were enough to push the start of the
   * session off the end of the history.
   */
  _layAlong() {
    const plan = this.pendingPlacement;
    if (!plan) return;
    const key = `${plan.parentId}:${plan.mount.pos.map((n) => n.toFixed(3)).join(',')}`;
    if (key === this._lastLaid) return;
    this._lastLaid = key;
    if (!this._press.laid) this.onGesture(true);
    this._press.laid++;
    this._applyClick(false);
  }

  _applyClick(additive = false) {
    if (PART_TOOLS.has(this.tool)) {
      const plan = this.pendingPlacement ?? this.proposePlacement();
      if (!plan) return;
      if (this.tool === TOOL.STAMP && !this.stampSource) return;
      if (this.tool === TOOL.EQUIP) {
        const blocked = this.assembly.blockedBy(this.equipType);
        if (blocked) {
          const label = EQUIP_META[this.equipType].label;
          this.onReject?.(blocked === 'unique'
            ? `${label}は1枚しか付けられません`
            : `${label}は${EQUIP_META[blocked]?.label ?? blocked}と一緒には付けられません`);
          return;
        }
      }
      // On its feet before anything is measured against the machine as a
      // whole. The walk preview poses the rig, and a rebuild drops the pose
      // anyway, so nothing is lost by putting it back first — and the
      // mirrored twin is worked out in the machine's frame.
      if (this.previewMotion) this._restPose();
      const twinPlan = (this.symmetry && this.tool !== TOOL.STAMP)
        ? this._mirrorPlan(plan) : null;

      this.onBeforeChange(this._changeLabel());

      let added;
      if (this.tool === TOOL.STAMP) {
        added = this.assembly.graft(this.stampSource, plan.parentId, plan.mount);
      } else if (this.tool === TOOL.EQUIP) {
        added = this.assembly.addEquip(plan.parentId, plan.mount, this.equipType, {
          size: this.newEquipSize,
        });
      } else if (this.tool === TOOL.BLOCK) {
        added = this.assembly.addBlock(plan.parentId, plan.mount, this.colorIndex, {
          size: plan.size, shape: this.newBlockShape,
        });
      } else {
        added = this.assembly.addBone(plan.parentId, plan.mount, this.tool, { ...this.boneOpts });
      }
      if (!added) return;
      const made = [added.id];
      if (this.symmetry && this.tool !== TOOL.STAMP) {
        const twin = this._mirror(added, twinPlan);
        if (twin) made.push(twin.id);
      }
      this.rebuild();
      this._fitNewRings(made);
      this.select(made);
      return;
    }

    // SELECT: pick a part, shift to add or remove
    const hits = _ray.intersectObjects(this.rig.pickables, false);
    if (hits.length) this.select(this._pickFrom(hits, additive), additive);
    else if (!additive) this.select(null);
  }

  /**
   * What the undo entry for this placement should say.
   *
   * Twenty entries all reading "配置" tell you nothing about how far back
   * you have gone, which is the one thing the label is for.
   */
  _changeLabel() {
    if (this.tool === TOOL.STAMP) return 'パーツ配置';
    if (this.tool === TOOL.EQUIP) return `配置 ${EQUIP_META[this.equipType]?.label ?? ''}`;
    if (BONE_TOOLS.has(this.tool)) return 'ボーン配置';
    return `配置 ${SHAPES[this.newBlockShape]?.label ?? ''}`;
  }

  /**
   * Which part a click on this ray means.
   *
   * The nearest hit, EXCEPT when it is already the selected one — then it is
   * whatever is behind it, and clicking again keeps going deeper before
   * coming back round to the front.
   *
   * Without this, a part that something else encloses can never be selected
   * at all: a raycast only ever returns what is in front, and a well-built
   * machine hides its core inside a hull on purpose. Cycling costs nothing
   * when there is only one thing under the cursor, which is most clicks.
   */
  _pickFrom(hits, additive) {
    const order = [];
    for (const hit of hits) {
      const id = hit.object.userData.partId;
      if (id && !order.includes(id)) order.push(id);
    }
    if (order.length < 2 || additive) return order[0];
    const at = order.indexOf(this.selected);
    return at < 0 ? order[0] : order[(at + 1) % order.length];
  }

  /**
   * Put the camera on the selection, or on the whole machine when nothing is
   * selected. Needed the moment a part can be selected without being
   * visible — otherwise the panel says you have it and the screen does not
   * show you where.
   */
  /** Put the camera back on the whole machine. */
  frameAll() { this._frameCamera(); return this; }

  frameSelection() {
    const parts = this.selectedParts();
    if (!parts.length) { this._frameCamera(); return this; }

    this.rig.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const part of parts) {
      const node = this.rig.nodes.get(part.id);
      if (!node) continue;
      // The part itself, not its children: framing a shoulder should not
      // pull the camera back far enough to hold the whole arm.
      box.expandByObject(node.mesh ?? node.joint ?? node.group);
    }
    if (box.isEmpty()) { this._frameCamera(); return this; }

    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(0.5, box.getSize(new THREE.Vector3()).length() * 0.5);
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0.68, 0.46, 0.86);
    dir.normalize();
    this.controls.target.copy(c);
    this.camera.position.copy(c).addScaledVector(dir, r * 3.2 + 1.2);
    this.controls.update();
    return this;
  }

  /**
   * Mirror a newly added part across the MACHINE's centre line.
   *
   * `plan` is the mirrored mount worked out by `_mirrorPlan` before the
   * original went down, so the twin lands exactly where the preview said it
   * would rather than on a second, slightly different calculation.
   */
  _mirror(part, plan = null) {
    const mirrored = plan ?? this._mirrorPlan({
      parentId: part.parent, mount: part.mount, size: part.size ?? [1, 1, 1],
    });
    if (!mirrored) return null;
    const { mount } = mirrored;
    const parentId = this.assembly.get(mirrored.parentId) ? mirrored.parentId : part.parent;

    if (part.kind === 'bone') {
      const twin = this.assembly.addBone(parentId, mount, part.boneType, {
        ...this.boneOpts, invert: !this.boneOpts.invert,
      });
      if (twin) twin.custom = { ...part.custom };
      return twin;
    }
    if (part.kind === 'equip') {
      // A unique plate simply has no twin, which is the rule doing its job.
      // A mirrored roller turns the other way, like a mirrored propeller.
      return this.assembly.addEquip(parentId, mount, part.equipType, {
        size: part.size,
        bulletColor: part.bulletColor,
        spin: part.spin ? { dir: -part.spin.dir, rpm: part.spin.rpm } : null,
      });
    }
    const twin = this.assembly.addBlock(parentId, mount, this.colorIndex, {
      size: [...part.size], shape: part.shape,
    });
    if (twin) twin.vox = part.vox.clone();
    return twin;
  }

  // ---------------------------------------------------------- frame

  enter() {
    this.active = true;
    this.workPlaneY = 0;
    this.placeTurn = 0;
    this.gizmo.enabled = true;
    this._syncCameraButtons();
    this._syncSelectionVisuals();
  }

  exit() {
    if (this.previewMotion) this.setPreviewMotion(false);
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

    // Mounts change under the builder's hands — a drag, an arrow key, a
    // typed position, an undo — and a ring is positioned from its plate's
    // mount. Re-deriving it here means the line never has to be told: it is
    // simply always where the plate is.
    this.rig.syncRings();
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
    // The workbench gets bloom and the antialiased target too. It shows the
    // same machines the arena does, and a plate that glows in the fight but
    // not while you are fitting it is a plate you cannot judge.
    if (this.post) {
      this.post.set({ chroma: 0, lines: 0, noise: 0, flash: 0 }, 0);
      this.post.render(this.scene, this.camera);
      return;
    }
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const geo of this.ghostShapes.values()) geo.dispose();
    this.ghostShapes.clear();
    this.ghostBox.dispose();
    for (const l of [this.jointArc, this.jointAxis, this.jointFar]) {
      l.geometry.dispose();
      l.material.dispose();
    }
    this.canvas.removeEventListener('wheel', this._wheel, { capture: true });
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
    this.boxEdges.dispose();
    for (const g of this.ghostEdgeGeos.values()) g.dispose();
    this.ghostEdgeGeos.clear();
    this.planeMark.geometry.dispose();
    this.planeMark.material.dispose();
    this.planeDrop.geometry.dispose();
    this.planeDrop.material.dispose();
    this.hostOutline.material.dispose();
    this.outlineMat.dispose();
    this.anchorMat.dispose();
    this.controls.dispose();
  }
}
