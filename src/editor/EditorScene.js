import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Rig, enumerateSockets } from '../core/Rig.js';
import { computeStats } from '../core/Assembly.js';
import { Animator } from '../anim/Animator.js';
import { BLOCK, VOX, VOXEL, PALETTE } from '../core/constants.js';
import { brush, paintBrush, voxelCount } from '../core/Voxel.js';

// ============================================================
//  Editor : attach parts to sockets, then carve the blocks.
//
//  Two tiers, exactly as specified:
//    ASSEMBLE  snap whole blocks and bones onto sockets
//    SCULPT    carve / add / paint individual voxels inside one block
// ============================================================

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _v = new THREE.Vector3();
const _local = new THREE.Vector3();

export const TOOL = {
  BLOCK: 'block',
  BONE_LEG: 'leg',
  BONE_ARM: 'arm',
  BONE_FACE: 'face',
  BONE_CUSTOM: 'custom',
  SELECT: 'select',
  CARVE: 'carve',
  ADD: 'add',
  PAINT: 'paint',
};

const SCULPT_TOOLS = new Set([TOOL.CARVE, TOOL.ADD, TOOL.PAINT]);

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
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 46;
    this.controls.target.set(0, 1.2, 0);

    this.tool = TOOL.BLOCK;
    this.colorIndex = 2;
    this.brushSize = 2;
    this.boneOpts = { length: 3, gauge: 'thick', limit: 70, invert: false };
    this.selected = null;
    this.hoverSocket = null;
    /** Sockets are only drawn for this part — see _hover(). */
    this.socketFocus = null;
    this.previewMotion = false;
    this.symmetry = false;

    this.onChange = () => {};
    this.onSelect = () => {};

    this._buildEnvironment();
    this._buildOverlays();
    this._bindPointer();
    this.time = 0;
    this.active = false;
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
    this.socketGroup = new THREE.Group();
    this.scene.add(this.socketGroup);

    // A socket is a wire outline of the volume the new part will occupy,
    // with a nearly invisible solid inside it purely so it can be picked.
    this.socketGeoFace = new THREE.BoxGeometry(BLOCK * 0.94, BLOCK * 0.94, BLOCK * 0.94);
    this.socketGeoSlot = new THREE.TorusGeometry(0.30, 0.04, 6, 14);
    this.socketWireFace = new THREE.EdgesGeometry(this.socketGeoFace);
    this.socketMat = new THREE.MeshBasicMaterial({
      color: 0x4fd2ff, transparent: true, opacity: 0.05, depthWrite: false,
    });
    this.socketMatHover = new THREE.MeshBasicMaterial({
      color: 0x9fe8ff, transparent: true, opacity: 0.34, depthWrite: false,
    });
    this.socketWireMat = new THREE.LineBasicMaterial({
      color: 0x4fd2ff, transparent: true, opacity: 0.34, depthWrite: false,
    });

    // selection outline
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04)),
      new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.95, depthTest: false }),
    );
    this.outline.visible = false;
    this.outline.renderOrder = 10;
    this.scene.add(this.outline);

    // voxel cursor
    this.voxCursor = new THREE.Mesh(
      new THREE.BoxGeometry(VOXEL, VOXEL, VOXEL),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthTest: false }),
    );
    this.voxCursor.visible = false;
    this.voxCursor.renderOrder = 11;
    this.scene.add(this.voxCursor);
  }

  // ---------------------------------------------------------- assembly

  setAssembly(assembly) {
    if (this.rig) { this.scene.remove(this.rig.root); this.rig.dispose(); }
    this.assembly = assembly;
    this.rig = new Rig(assembly);
    this.scene.add(this.rig.root);
    this.stats = computeStats(assembly, this.rig);
    this.animator = new Animator(this.rig, this.stats);
    this.groundOffset = -this.rig.restLowestY;
    this.rig.root.position.y = this.groundOffset;
    this.selected = null;
    this.rebuildSockets();
    this._frameCamera();
    this.onChange(this.stats);
    this.onSelect(null);
    return this;
  }

  /** Rebuild the rig after a structural edit, keeping the selection if we can. */
  rebuild(keepSelection = true) {
    const keep = keepSelection ? this.selected : null;
    this.scene.remove(this.rig.root);
    this.rig.dispose();
    this.rig = new Rig(this.assembly);
    this.scene.add(this.rig.root);
    this.stats = computeStats(this.assembly, this.rig);
    this.animator = new Animator(this.rig, this.stats);
    this.groundOffset = -this.rig.restLowestY;
    this.rig.root.position.y = this.groundOffset;
    this.select(keep && this.assembly.get(keep) ? keep : null);
    this.rebuildSockets();
    this.onChange(this.stats);
  }

  _frameCamera() {
    this.rig.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.rig.root);
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(1.4, this.rig.boundingRadius);
    this.controls.target.copy(c);
    const dir = new THREE.Vector3(0.68, 0.46, 0.86).normalize();
    this.camera.position.copy(c).addScaledVector(dir, r * 2.4 + 2.0);
    this.controls.update();
  }

  rebuildSockets() {
    this.socketGroup.clear();
    this.hoverSocket = null;
    this.hoverSocketMesh = null;
    this.sockets = [];
    if (SCULPT_TOOLS.has(this.tool) || this.tool === TOOL.SELECT) return;

    // Only the focused part offers sockets. Pointing at a shoulder should
    // show you where a shoulder part goes, not light up the whole machine.
    const focus = this.socketFocus && this.assembly.get(this.socketFocus)
      ? this.socketFocus
      : (this.selected && this.assembly.get(this.selected) ? this.selected : this.assembly.rootId);
    this.socketFocus = focus;

    const forBone = this.tool !== TOOL.BLOCK;
    this.sockets = enumerateSockets(this.assembly, this.rig, { forBone, only: new Set([focus]) });

    for (const s of this.sockets) {
      const mesh = new THREE.Mesh(
        s.kind === 'slot' ? this.socketGeoSlot : this.socketGeoFace,
        this.socketMat,
      );
      mesh.position.copy(s.position);
      if (s.kind === 'slot') mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), s.normal);
      if (s.kind === 'tip') mesh.scale.setScalar(0.55);
      mesh.userData.socket = s;
      mesh.renderOrder = 5;

      if (s.kind !== 'slot') {
        const wire = new THREE.LineSegments(this.socketWireFace, this.socketWireMat);
        wire.raycast = () => {};            // the solid does the picking
        wire.renderOrder = 6;
        mesh.add(wire);
      }
      this.socketGroup.add(mesh);
    }
  }

  // ---------------------------------------------------------- tools

  setTool(tool) {
    this.tool = tool;
    this.socketFocus = this.selected ?? this.socketFocus;
    this.voxCursor.visible = false;
    if (SCULPT_TOOLS.has(tool) && !this.selected) {
      // Sculpting needs a subject; fall back to the core.
      this.select(this.assembly.rootId);
    }
    this.rebuildSockets();
  }

  select(partId) {
    this.selected = partId ?? null;
    const node = partId ? this.rig.nodes.get(partId) : null;
    if (!node) {
      this.outline.visible = false;
      this.onSelect(null);
      return;
    }
    this.outline.visible = true;
    node.group.updateMatrixWorld(true);
    if (node.part.kind === 'bone') {
      const L = node.part.length;
      this.outline.scale.set(node.radius * 3.4, L, node.radius * 3.4);
      node.group.localToWorld(_v.set(0, L / 2, 0));
      this.outline.position.copy(_v);
      this.outline.quaternion.copy(node.group.getWorldQuaternion(new THREE.Quaternion()));
    } else {
      this.outline.scale.set(1, 1, 1);
      this.outline.position.copy(node.group.getWorldPosition(new THREE.Vector3()));
      this.outline.quaternion.copy(node.group.getWorldQuaternion(new THREE.Quaternion()));
    }
    this.onSelect(this.assembly.get(partId));
  }

  deleteSelected() {
    if (!this.selected || this.selected === this.assembly.rootId) return false;
    const parent = this.assembly.get(this.selected)?.parent;
    this.assembly.remove(this.selected);
    this.selected = parent ?? null;
    this.rebuild();
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
      this._updateNdc(e);
      this._hover();
      if (SCULPT_TOOLS.has(this.tool)) {
        this.painting = true;
        this.controls.enabled = false;
        this._applySculpt();
      } else {
        this._applyClick();
      }
    };
    this._up = () => {
      if (this.painting) { this.painting = false; this.controls.enabled = true; }
    };
    this._key = (e) => {
      if (!this.active) return;
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); this.deleteSelected(); }
      if (e.code === 'BracketLeft') this.brushSize = Math.max(1, this.brushSize - 1);
      if (e.code === 'BracketRight') this.brushSize = Math.min(5, this.brushSize + 1);
    };

    el.addEventListener('pointermove', this._move);
    el.addEventListener('pointerdown', this._down);
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
    if (SCULPT_TOOLS.has(this.tool)) { this._hoverVoxel(); return; }

    // 1. sockets already on screen win — you are aiming at one on purpose
    if (this.socketGroup.children.length) {
      const hits = _ray.intersectObjects(this.socketGroup.children, false);
      const next = hits.length ? hits[0].object : null;
      if (next !== this.hoverSocketMesh) {
        if (this.hoverSocketMesh) this.hoverSocketMesh.material = this.socketMat;
        this.hoverSocketMesh = next;
        if (next) next.material = this.socketMatHover;
      }
      this.hoverSocket = next ? next.userData.socket : null;
      if (next) return;
    }

    // 2. otherwise move the socket focus to whatever part is under the cursor
    if (this.tool !== TOOL.SELECT) {
      const partHits = _ray.intersectObjects(this.rig.pickables, false);
      const id = partHits.length ? partHits[0].object.userData.partId : null;
      if (id && id !== this.socketFocus) {
        this.socketFocus = id;
        this.rebuildSockets();
      }
    }
  }

  _hoverVoxel() {
    this.hoverSocket = null;
    const node = this.selected ? this.rig.nodes.get(this.selected) : null;
    if (!node || node.part.kind === 'bone') { this.voxCursor.visible = false; return; }

    const hits = _ray.intersectObject(node.mesh, false);
    if (!hits.length) { this.voxCursor.visible = false; return; }

    const hit = hits[0];
    const cell = this._voxelAt(node, hit, this.tool === TOOL.ADD);
    if (!cell) { this.voxCursor.visible = false; return; }

    this.hoverVoxel = cell;
    node.mesh.localToWorld(_v.set((cell.x + 0.5) * VOXEL, (cell.y + 0.5) * VOXEL, (cell.z + 0.5) * VOXEL));
    this.voxCursor.position.copy(_v);
    this.voxCursor.quaternion.copy(node.group.getWorldQuaternion(new THREE.Quaternion()));
    this.voxCursor.scale.setScalar(Math.max(1, this.brushSize * 2 - 1));
    this.voxCursor.material.color.set(
      this.tool === TOOL.CARVE ? 0xff6a5c : this.tool === TOOL.ADD ? 0x8effc9 : PALETTE[this.colorIndex],
    );
    this.voxCursor.visible = true;
  }

  /** Convert a surface hit into voxel coordinates, inside or just outside. */
  _voxelAt(node, hit, outside) {
    node.mesh.worldToLocal(_local.copy(hit.point));
    const n = hit.face
      ? _v.copy(hit.face.normal).transformDirection(node.mesh.matrixWorld)
      : _v.set(0, 0, 0);
    node.mesh.worldToLocal(_v.copy(hit.point).addScaledVector(n, outside ? VOXEL * 0.5 : -VOXEL * 0.5));

    const x = Math.floor(_v.x / VOXEL);
    const y = Math.floor(_v.y / VOXEL);
    const z = Math.floor(_v.z / VOXEL);
    if (x < 0 || y < 0 || z < 0 || x >= VOX || y >= VOX || z >= VOX) return null;
    return { x, y, z };
  }

  _applySculpt() {
    const node = this.selected ? this.rig.nodes.get(this.selected) : null;
    if (!node || node.part.kind === 'bone' || !this.voxCursor.visible || !this.hoverVoxel) return;
    const { x, y, z } = this.hoverVoxel;
    const vox = node.part.vox;
    let changed = false;

    if (this.tool === TOOL.CARVE) changed = brush(vox, x, y, z, this.brushSize, 0);
    else if (this.tool === TOOL.ADD) changed = brush(vox, x, y, z, this.brushSize, this.colorIndex + 1);
    else changed = paintBrush(vox, x, y, z, this.brushSize, this.colorIndex);

    if (!changed) return;

    // Never let a block be carved out of existence — an empty block is an
    // invisible mount point, which is confusing rather than clever.
    if (voxelCount(vox) === 0) { vox[0] = this.colorIndex + 1; }

    this.rig.refreshBlock(node.part.id);
    this.stats = computeStats(this.assembly, this.rig);
    this.onChange(this.stats);
  }

  _applyClick() {
    // 1. socket -> attach
    if (this.hoverSocket) {
      const s = this.hoverSocket;
      let added;
      if (this.tool === TOOL.BLOCK) {
        added = this.assembly.addBlock(s.parentId, s.mount, this.colorIndex);
      } else {
        added = this.assembly.addBone(s.parentId, s.mount, this.tool, { ...this.boneOpts });
      }
      if (added) {
        if (this.symmetry) this._mirror(added);
        this.selected = added.id;
        this.socketFocus = added.id;   // keep building outward from here
        this.rebuild();
      }
      return;
    }

    // 2. part -> select
    const hits = _ray.intersectObjects(this.rig.pickables, false);
    if (hits.length) {
      const id = hits[0].object.userData.partId;
      this.socketFocus = id;
      this.select(id);
      this.rebuildSockets();
    } else {
      this.select(null);
    }
  }

  /**
   * Mirror a newly added part across the body's X axis when its mount is
   * left/right facing. Cheap, but it halves the work of building anything
   * with limbs.
   */
  _mirror(part) {
    const m = part.mount;
    if (!m || m.face === undefined || (m.face !== 0 && m.face !== 1)) return;
    const parent = this.assembly.get(part.parent);
    if (!parent) return;
    const mirrorFace = m.face === 0 ? 1 : 0;
    if (this.assembly.isFaceOccupied(parent.id, mirrorFace)) return;

    if (part.kind === 'bone') {
      const twin = this.assembly.addBone(parent.id, { ...m, face: mirrorFace }, part.boneType, {
        ...this.boneOpts, invert: !this.boneOpts.invert,
      });
      if (twin) twin.custom = { ...part.custom };
    } else {
      this.assembly.addBlock(parent.id, { ...m, face: mirrorFace }, this.colorIndex);
    }
  }

  // ---------------------------------------------------------- frame

  enter() { this.active = true; }
  exit() { this.active = false; this.painting = false; this.controls.enabled = true; }

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
      const v = new THREE.Vector3(0, 0, speed);
      this.animator.update({
        dt, speed, planarSpeed: speed, grounded: 1, airborne: 0,
        velocity: v, bodyQ: this.rig.root.quaternion,
        aimDir: null, locked: 0, thrust: 0.25, jerk: 0,
      });
      this.rig.root.position.y = this.groundOffset + this.animator.bodyBob;
    } else if (this.animator) {
      // Idle: settle to rest so the silhouette is honest.
      for (const j of this.rig.joints) j.joint.quaternion.slerp(new THREE.Quaternion(), 1 - Math.pow(0.001, dt));
      this.rig.root.position.y = this.groundOffset;
      this.rig.root.rotation.set(0, 0, 0);
    }

    // keep the outline glued to a moving selection
    if (this.outline.visible && this.selected) {
      const node = this.rig.nodes.get(this.selected);
      if (node) {
        node.group.updateMatrixWorld(true);
        if (node.part.kind === 'bone') {
          node.group.localToWorld(_v.set(0, node.part.length / 2, 0));
          this.outline.position.copy(_v);
        } else {
          this.outline.position.copy(node.group.getWorldPosition(_v));
        }
      }
    }

    const pulse = Math.sin(this.time * 3.4) * 0.5 + 0.5;
    this.socketMat.opacity = 0.035 + pulse * 0.03;
    this.socketWireMat.opacity = 0.24 + pulse * 0.16;
  }

  render() {
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.canvas.removeEventListener('pointermove', this._move);
    this.canvas.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('keydown', this._key);
    this.controls.dispose();
  }
}
