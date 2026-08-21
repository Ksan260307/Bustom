import * as THREE from 'three';
import { describe, it, expect, shouldNotThrow, run } from './runner.js';
import { App } from '../../src/main.js';
import { TOOL } from '../../src/editor/EditorScene.js';
import { PRESETS, computeStats } from '../../src/core/Assembly.js';
import { STANDARD_COLORS, hexToCss } from '../../src/core/Palette.js';
import { VOX_LEVELS } from '../../src/core/constants.js';
import { ColorWheel } from '../../src/ui/ColorWheel.js';
import { Hud } from '../../src/game/Hud.js';

// ============================================================
//  Browser suite: everything that needs WebGL, a 2D canvas or the DOM.
//  The node suites cover the pure logic; this covers the wiring.
// ============================================================

let app;

/** Build a real App against off-screen canvases. */
function boot() {
  const host = document.getElementById('harness');
  host.replaceChildren();

  const gl = document.createElement('canvas');
  gl.id = 'gl';
  const hud = document.createElement('canvas');
  hud.id = 'hud';
  const overlay = document.createElement('div');
  overlay.id = 'overlay';
  host.append(gl, hud, overlay);

  localStorage.removeItem('brostom.assembly.v1');
  const a = new App({ canvas: gl, hudCanvas: hud, overlay });
  // Drive frames by hand at a fixed step: rAF is throttled in hidden tabs.
  a.renderer.setAnimationLoop(null);
  a.clock.getDelta = () => 1 / 60;
  return a;
}

const step = (n = 1) => { for (let i = 0; i < n; i++) app.frame(); };

/** Aim the editor camera at a world point from a given direction. */
function aimCamera(target, offset) {
  const rect = app.canvas.getBoundingClientRect();
  const cam = app.editor.camera;
  cam.aspect = rect.width / rect.height;
  cam.position.copy(target).add(offset);
  cam.up.set(0, 1, 0);
  cam.lookAt(target);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return rect;
}

/** Move the pointer to a world point, then optionally click it. */
function pointAt(worldPoint, { click = false, shift = false } = {}) {
  const rect = app.canvas.getBoundingClientRect();
  const ndc = worldPoint.clone().project(app.editor.camera);
  const clientX = rect.left + ((ndc.x * 0.5) + 0.5) * rect.width;
  const clientY = rect.top + ((-ndc.y * 0.5) + 0.5) * rect.height;
  app.canvas.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY, bubbles: true }));
  if (click) {
    app.canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX, clientY, button: 0, shiftKey: shift, bubbles: true,
    }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }
  return { clientX, clientY };
}

function worldOf(id) {
  app.editor.rig.root.updateMatrixWorld(true);
  return app.editor.rig.nodes.get(id).group.getWorldPosition(new THREE.Vector3());
}

function sculptAt(x, y, z) {
  app.editor.hoverVoxel = { x, y, z };
  app.editor._applySculpt();
}

// ============================================================

describe('boot', () => {
  it('constructs without throwing and starts in the editor', () => {
    app = boot();
    expect(app.mode).toBe('edit');
    expect(app.assembly).toBeTruthy();
    expect(app.editor.rig).toBeTruthy();
    expect(app.editor.tool).toBe(TOOL.SELECT);
  });

  it('renders an editor frame', () => {
    shouldNotThrow(() => step(3), 'editor frame');
    expect(app.renderer.info.render.calls).toBeGreaterThan(0);
  });

  it('builds the whole editor DOM', () => {
    for (const id of ['topbar', 'leftpanel', 'rightpanel', 'hint', 'fieldbar', 'pause', 'toast']) {
      expect(document.getElementById(id), id).toBeTruthy();
    }
    expect(document.querySelectorAll('.toolbtn').length).toBe(9);
  });

  it('shows the standard palette', () => {
    const swatches = document.querySelectorAll('#rightpanel .swatch');
    expect(swatches.length).toBeGreaterThanOrEqual(STANDARD_COLORS.length);
  });

  it('survives a resize', () => {
    shouldNotThrow(() => app.resize(), 'resize');
    step(1);
  });
});

describe('presets', () => {
  it('loads every preset and reports the advertised gait', () => {
    for (const [key, meta] of Object.entries(PRESETS)) {
      app.loadPreset(key);
      step(2);
      expect(app.editor.stats.gait, `${key} (${meta.label})`).toBe(computeStats(app.assembly).gait);
      expect(app.editor.rig.nodes.size, key).toBe(app.assembly.size);
    }
  });

  it('stands the build on the grid rather than through it', () => {
    app.loadPreset('biped');
    step(2);
    expect(app.editor.groundOffset).toBeCloseTo(-app.editor.rig.restLowestY, 6);
    expect(app.editor.rig.root.position.y).toBeGreaterThan(0);
  });

  it('renders the floating-bit preset with parts detached from the body', () => {
    app.loadPreset('bits');
    step(2);
    const core = worldOf(app.assembly.rootId);
    const far = [...app.assembly.parts.values()]
      .filter((p) => p.mount)
      .map((p) => worldOf(p.id).distanceTo(core));
    expect(Math.max(...far)).toBeGreaterThan(1.5);
  });
});

describe('tools', () => {
  it('every tool selects without error and syncs the UI', () => {
    for (const tool of Object.values(TOOL)) {
      shouldNotThrow(() => app.setTool(tool), tool);
      expect(app.editor.tool, tool).toBe(tool);
      step(1);
    }
    expect(document.querySelectorAll('.toolbtn.active').length).toBe(1);
  });

  it('there is no separate move tool any more', () => {
    expect(TOOL.MOVE).toBe(undefined);
    expect(Object.values(TOOL)).toContain('select');
  });

  it('keyboard shortcuts pick tools and gizmo modes', () => {
    app.setMode('edit');
    for (const [code, tool] of [['KeyV', TOOL.SELECT], ['KeyB', TOOL.BLOCK], ['KeyL', TOOL.BONE_LEG]]) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      expect(app.editor.tool, code).toBe(tool);
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', bubbles: true }));
    expect(app.editor.gizmoMode).toBe('rotate');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', bubbles: true }));
    expect(app.editor.gizmoMode).toBe('translate');
  });
});

describe('placing parts', () => {
  it('snaps a block flush against the face that was clicked', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BLOCK);
    app.editor.newBlockSize = [1, 1, 1];
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(6, 0, 0));
    pointAt(core.clone().add(new THREE.Vector3(0.49, 0, 0)), { click: true });

    expect(app.assembly.size).toBe(2);
    const placed = app.assembly.get(app.editor.selected);
    expect(placed.mount.pos[0]).toBeCloseTo(1, 3);   // half + half
    expect(placed.mount.pos[1]).toBeCloseTo(0, 3);
  });

  it('drops a part in mid-air when nothing is under the cursor', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BLOCK);
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(0, 5, 12));
    // a point on the work plane, well clear of the core
    pointAt(core.clone().add(new THREE.Vector3(3.5, 0, 0)), { click: true });

    expect(app.assembly.size).toBe(2);
    const placed = app.assembly.get(app.editor.selected);
    expect(Math.hypot(...placed.mount.pos), 'genuinely detached').toBeGreaterThan(2);
    expect(placed.parent).toBe(app.assembly.rootId);
  });

  it('places a bone pointing away from the surface', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BONE_LEG);
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(0, -6, 0.01));
    pointAt(core.clone().add(new THREE.Vector3(0, -0.49, 0)), { click: true });

    expect(app.editor.rig.joints.length).toBe(1);
    expect(app.editor.stats.legs).toBe(1);
    const bone = app.assembly.get(app.editor.selected);
    const dir = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(new THREE.Quaternion().fromArray(bone.mount.rot));
    expect(dir.y, 'points down').toBeLessThan(-0.9);
  });

  it('symmetry places a mirrored twin in one click', () => {
    app.loadPreset('core');
    app.editor.symmetry = true;
    app.setTool(TOOL.BLOCK);
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(6, 0, 0));
    pointAt(core.clone().add(new THREE.Vector3(0.49, 0, 0)), { click: true });
    app.editor.symmetry = false;

    expect(app.assembly.size).toBe(3);
    const xs = [...app.assembly.parts.values()].filter((p) => p.mount).map((p) => p.mount.pos[0]);
    expect(xs.sort()).toEqual([-1, 1]);
  });

  it('places a block at the size chosen in the panel', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BLOCK);
    app.editor.newBlockSize = [2, 0.5, 1.5];
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(0, 6, 0.01));
    pointAt(core.clone().add(new THREE.Vector3(0, 0.49, 0)), { click: true });
    expect(app.assembly.get(app.editor.selected).size).toEqual([2, 0.5, 1.5]);
    app.editor.newBlockSize = [1, 1, 1];
  });

  it('shows a ghost of what is about to be placed', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BLOCK);
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(6, 0, 0));
    pointAt(core.clone().add(new THREE.Vector3(0.49, 0, 0)));
    expect(app.editor.ghost.visible).toBe(true);
    expect(app.editor.pendingPlacement).toBeTruthy();
  });
});

describe('selection', () => {
  it('clicking a part selects it', () => {
    app.loadPreset('biped');
    app.setTool(TOOL.SELECT);
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(6, 0, 0));
    pointAt(core.clone().add(new THREE.Vector3(0.49, 0, 0)), { click: true });
    expect(app.editor.selection.size).toBe(1);
  });

  it('shift-clicking adds a second part, and clicking it again removes it', () => {
    app.loadPreset('biped');
    app.setTool(TOOL.SELECT);
    const ids = [...app.assembly.parts.keys()].slice(0, 3);
    app.editor.select(ids[0]);
    app.editor.select(ids[1], true);
    expect(app.editor.selection.size).toBe(2);
    app.editor.select(ids[1], true);
    expect(app.editor.selection.size).toBe(1);
  });

  it('select-all and clear work', () => {
    app.loadPreset('biped');
    app.editor.selectAll();
    expect(app.editor.selection.size).toBe(app.assembly.size);
    app.editor.clearSelection();
    expect(app.editor.selection.size).toBe(0);
  });

  it('Ctrl+A selects everything', () => {
    app.loadPreset('biped');
    app.setMode('edit');
    app.editor.clearSelection();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', ctrlKey: true, bubbles: true }));
    expect(app.editor.selection.size).toBe(app.assembly.size);
  });

  it('shows one outline per selected part', () => {
    app.loadPreset('biped');
    const ids = [...app.assembly.parts.keys()].slice(0, 3);
    app.editor.select(ids);
    expect(app.editor._outlinePool.filter((o) => o.visible).length).toBe(3);
  });

  it('deletes every selected part at once', () => {
    app.loadPreset('biped');
    const arms = [...app.assembly.parts.values()].filter((p) => p.boneType === 'arm');
    expect(arms.length).toBe(2);
    const before = app.assembly.size;
    app.editor.select(arms.map((p) => p.id));
    app.editor.deleteSelected();
    expect(app.assembly.size).toBeLessThan(before - 2);
    for (const p of arms) expect(app.assembly.get(p.id)).toBe(undefined);
  });

  it('refuses to delete the core', () => {
    app.loadPreset('core');
    app.editor.select(app.assembly.rootId);
    expect(app.editor.deleteSelected()).toBe(false);
  });
});

describe('free movement', () => {
  it('the gizmo is attached to the selection centroid', () => {
    app.loadPreset('biped');
    app.setTool(TOOL.SELECT);
    const ids = [...app.assembly.parts.keys()].slice(0, 2);
    app.editor.select(ids);
    expect(app.editor.gizmo.object).toBe(app.editor.pivot);
    const mid = worldOf(ids[0]).add(worldOf(ids[1])).multiplyScalar(0.5);
    expect(app.editor.pivot.position.distanceTo(mid)).toBeCloseTo(0, 2);
  });

  it('dragging the gizmo translates the selection in world space', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BLOCK);
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(6, 0, 0));
    pointAt(core.clone().add(new THREE.Vector3(0.49, 0, 0)), { click: true });

    app.setTool(TOOL.SELECT);
    const id = app.editor.selected;
    const before = worldOf(id).clone();

    app.editor._beginDrag();
    app.editor.pivot.position.x += 2.5;
    app.editor.pivot.position.y += 1.25;
    app.editor._applyDrag();
    app.editor._endDrag();

    const after = worldOf(id);
    expect(after.x - before.x).toBeCloseTo(2.5, 2);
    expect(after.y - before.y).toBeCloseTo(1.25, 2);
    expect(app.assembly.get(id).mount.pos[0]).toBeCloseTo(3.5, 2);
  });

  it('a multi-selection moves as one rigid group', () => {
    app.loadPreset('biped');
    app.setTool(TOOL.SELECT);
    const ids = [...app.assembly.parts.keys()].filter((id) => id !== app.assembly.rootId).slice(0, 3);
    app.editor.select(ids);
    const before = ids.map((id) => worldOf(id).clone());

    app.editor._beginDrag();
    app.editor.pivot.position.z -= 1.5;
    app.editor._applyDrag();
    app.editor._endDrag();

    ids.forEach((id, i) => {
      const d = worldOf(id).sub(before[i]);
      expect(d.z, id).toBeCloseTo(-1.5, 2);
      expect(d.x, id).toBeCloseTo(0, 2);
    });
  });

  it('rotating the gizmo orbits a multi-selection about the pivot', () => {
    app.loadPreset('biped');
    app.setTool(TOOL.SELECT);
    app.setGizmoMode('rotate');
    const ids = [...app.assembly.parts.keys()].filter((id) => id !== app.assembly.rootId).slice(0, 2);
    app.editor.select(ids);
    const pivot = app.editor.pivot.position.clone();
    const before = ids.map((id) => worldOf(id).clone());

    app.editor._beginDrag();
    app.editor.pivot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    app.editor._applyDrag();
    app.editor._endDrag();

    ids.forEach((id, i) => {
      const expected = before[i].clone().sub(pivot)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).add(pivot);
      expect(worldOf(id).distanceTo(expected), id).toBeCloseTo(0, 2);
    });
    app.setGizmoMode('translate');
  });

  it('dragging a part past a bone midpoint moves it to the other half', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BONE_LEG);
    app.editor.boneOpts.length = 4;
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(0, 6, 0.01));
    pointAt(core.clone().add(new THREE.Vector3(0, 0.49, 0)), { click: true });
    const boneId = app.editor.selected;

    const block = app.assembly.addBlock(boneId, { pos: [0, 0.5, 0] }, 4, { size: [0.5, 0.5, 0.5] });
    app.editor.rebuild();
    expect(app.editor.rig.nodes.get(block.id).host).toBe(app.editor.rig.nodes.get(boneId).near);

    app.editor.select(block.id);
    app.editor._beginDrag();
    app.editor.pivot.position.y += 3;      // now past the midpoint
    app.editor._applyDrag();
    app.editor._endDrag();

    expect(app.editor.rig.nodes.get(block.id).host).toBe(app.editor.rig.nodes.get(boneId).far);
    app.editor.boneOpts.length = 3;
  });

  it('the inspector can type an exact position', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BLOCK);
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(6, 0, 0));
    pointAt(core.clone().add(new THREE.Vector3(0.49, 0, 0)), { click: true });

    app.editor.setMountSelected({ pos: [1.75, -0.5, 2] });
    expect(app.assembly.get(app.editor.selected).mount.pos).toEqual([1.75, -0.5, 2]);
    expect(worldOf(app.editor.selected).z).toBeCloseTo(2, 2);
  });

  it('reparenting keeps the part where it looks', () => {
    app.loadPreset('biped');
    const bone = [...app.assembly.parts.values()].find((p) => p.boneType === 'arm');
    // a block that is NOT an ancestor of the bone, or the move is illegal
    const block = [...app.assembly.parts.values()]
      .find((p) => p.kind === 'block' && app.assembly.canReparent(p.id, bone.id));
    expect(block, 'found a legal source part').toBeTruthy();

    app.editor.select(block.id);
    const before = worldOf(block.id).clone();

    expect(app.editor.reparentSelected(bone.id)).toBe(true);
    expect(app.assembly.get(block.id).parent).toBe(bone.id);
    expect(worldOf(block.id).distanceTo(before)).toBeCloseTo(0, 2);
  });

  it('refuses a reparent that would swallow its own parent', () => {
    app.loadPreset('biped');
    const bone = [...app.assembly.parts.values()].find((p) => p.boneType === 'arm');
    const ancestor = app.assembly.ancestry(bone.id).find((p) => p.kind !== 'core');
    app.editor.select(ancestor.id);
    expect(app.editor.reparentSelected(bone.id)).toBe(false);
    expect(app.assembly.get(ancestor.id).parent).not.toBe(bone.id);
  });

  it('dragging a parent carries its children exactly once', () => {
    app.loadPreset('biped');
    app.setTool(TOOL.SELECT);
    const parent = [...app.assembly.parts.values()]
      .find((p) => p.kind === 'block' && p.children.length);
    const child = parent.children[0];

    // select BOTH — the child must not be moved twice
    app.editor.select([parent.id, child]);
    const before = worldOf(child).clone();

    app.editor._beginDrag();
    app.editor.pivot.position.x += 2;
    app.editor._applyDrag();
    app.editor._endDrag();

    expect(worldOf(child).x - before.x).toBeCloseTo(2, 2);
  });

  it('duplicate makes an independent copy', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BLOCK);
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(6, 0, 0));
    pointAt(core.clone().add(new THREE.Vector3(0.49, 0, 0)), { click: true });
    const original = app.editor.selected;

    const before = app.assembly.size;
    app.editor.duplicateSelected();
    expect(app.assembly.size).toBe(before + 1);
    expect(app.editor.selected).not.toBe(original);
    expect(app.assembly.get(app.editor.selected).vox).not.toBe(app.assembly.get(original).vox);
  });
});

describe('resizing parts', () => {
  it('resizes a block and the mesh follows', () => {
    app.loadPreset('core');
    app.editor.select(app.assembly.rootId);
    app.editor.resizeSelected([2, 1, 0.5]);
    const mesh = app.editor.rig.nodes.get(app.assembly.rootId).mesh;
    expect(mesh.scale.toArray()).toEqual([2, 1, 0.5]);
    expect(app.editor.stats.volume).toBeCloseTo(1, 4);
  });

  it('resizes a bone, both length and thickness', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BONE_LEG);
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(0, -6, 0.01));
    pointAt(core.clone().add(new THREE.Vector3(0, -0.49, 0)), { click: true });
    const id = app.editor.selected;

    app.editor.setBoneShapeSelected({ length: 5, radius: 0.4 });
    expect(app.assembly.get(id).length).toBe(5);
    expect(app.assembly.get(id).radius).toBeCloseTo(0.4, 6);
    expect(app.editor.rig.nodes.get(id).joint.position.y).toBeCloseTo(2.5, 4);
  });

  it('the uniform size buttons work through the app', () => {
    app.loadPreset('core');
    app.editor.select(app.assembly.rootId);
    app.uniformSize(2);
    expect(app.assembly.core.size).toEqual([2, 2, 2]);
    app.uniformSize(1);
    expect(app.assembly.core.size).toEqual([1, 1, 1]);
  });
});

describe('sculpting', () => {
  it('carves, adds and paints at the default resolution', () => {
    app.loadPreset('core');
    app.editor.select(app.assembly.rootId);
    const vox = app.assembly.core.vox;
    const mid = Math.floor(vox.n / 2);

    app.setTool(TOOL.CARVE);
    const before = vox.solid;
    sculptAt(mid, mid, mid);
    expect(vox.solid).toBeLessThan(before);

    app.setTool(TOOL.ADD);
    const carved = vox.solid;
    sculptAt(mid, mid, mid);
    expect(vox.solid).toBeGreaterThan(carved);

    app.setTool(TOOL.PAINT);
    app.setColor(4);
    sculptAt(mid, mid, mid);
    expect(vox.get(mid, mid, mid)).toBe(5);
  });

  it('keeps the camera usable: right button orbits, wheel zooms', () => {
    app.setTool(TOOL.CARVE);
    expect(app.editor.controls.enabled, 'orbit stays live').toBe(true);
    expect(app.editor.controls.enableZoom).toBe(true);
    expect(app.editor.controls.mouseButtons.LEFT, 'left is the brush').toBe(null);
    expect(app.editor.controls.mouseButtons.RIGHT).toBe(THREE.MOUSE.ROTATE);
    expect(app.editor.controls.mouseButtons.MIDDLE).toBe(THREE.MOUSE.PAN);

    app.setTool(TOOL.SELECT);
    expect(app.editor.controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
  });

  it('the camera still moves while the brush is held down', () => {
    app.loadPreset('core');
    app.editor.select(app.assembly.rootId);
    app.setTool(TOOL.CARVE);
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(6, 0, 0));
    pointAt(core.clone().add(new THREE.Vector3(0.49, 0, 0)), { click: true });
    expect(app.editor.controls.enabled, 'orbit not disabled by painting').toBe(true);
  });

  it('picks the voxel under the pointer through a real raycast', () => {
    app.loadPreset('core');
    app.editor.select(app.assembly.rootId);
    app.editor.resizeSelected([1, 1, 1]);
    app.setTool(TOOL.CARVE);

    const core = worldOf(app.assembly.rootId);
    const rect = aimCamera(core, new THREE.Vector3(6, 0, 0));
    expect(rect.width, 'the harness canvas has a size').toBeGreaterThan(10);

    app.canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      bubbles: true,
    }));

    const cell = app.editor.hoverVoxel;
    expect(cell, 'the ray found a voxel').toBeTruthy();
    const n = app.assembly.core.vox.n;
    expect(cell.x, 'landed on the +X side').toBeGreaterThan(n * 0.6);
    expect(app.editor.voxCursor.visible).toBe(true);
  });

  it('never lets a block be carved out of existence', () => {
    app.loadPreset('core');
    app.editor.select(app.assembly.rootId);
    app.setTool(TOOL.CARVE);
    app.editor.brushPercent = 25;
    const vox = app.assembly.core.vox;
    for (let x = 0; x < vox.n; x += 4) {
      for (let y = 0; y < vox.n; y += 4) {
        for (let z = 0; z < vox.n; z += 4) sculptAt(x, y, z);
      }
    }
    app.editor.brushPercent = 6;
    expect(vox.solid).toBeGreaterThan(0);
  });

  it('the brush is the same fraction of the block at every resolution', () => {
    app.loadPreset('core');
    app.editor.brushPercent = 10;
    for (const n of VOX_LEVELS) {
      app.setVoxResolution(n);
      const vox = app.assembly.core.vox;
      const cells = app.editor.brushRadiusCells(vox);
      const err = Math.abs(cells / vox.n - 0.1);
      expect(err, `1/${n} -> ${cells} cells`).toBeLessThan(0.5 / n + 1e-9);
    }
    app.setVoxResolution(32);
    app.editor.brushPercent = 6;
  });

  it('switches through every resolution, keeping the shape', () => {
    app.loadPreset('core');
    app.editor.select(app.assembly.rootId);
    app.setTool(TOOL.CARVE);
    const vox0 = app.assembly.core.vox;
    sculptAt(Math.floor(vox0.n / 2), Math.floor(vox0.n / 2), Math.floor(vox0.n / 2));
    const fill0 = vox0.solid / vox0.total;

    for (const n of VOX_LEVELS) {
      app.setVoxResolution(n);
      const vox = app.assembly.core.vox;
      expect(vox.n, `1/${n}`).toBe(n);
      expect(vox.solid / vox.total, `1/${n} fill`).toBeCloseTo(fill0, 1);
      step(1);
    }
    app.setVoxResolution(32);
  });

  it('sculpts at 1/100 without blowing up', () => {
    app.loadPreset('core');
    app.setVoxResolution(100);
    app.editor.select(app.assembly.rootId);
    app.setTool(TOOL.CARVE);
    const vox = app.assembly.core.vox;
    expect(vox.n).toBe(100);
    const t0 = performance.now();
    sculptAt(50, 50, 50);
    app.editor.rig.refreshBlock(app.assembly.rootId);
    const elapsed = performance.now() - t0;
    expect(vox.solid).toBeLessThan(vox.total);
    expect(elapsed, `${elapsed.toFixed(0)}ms per stroke`).toBeLessThan(400);
    app.setVoxResolution(32);
  });

  it('fill, bevel and repaint act on the selection', () => {
    app.loadPreset('core');
    app.editor.select(app.assembly.rootId);
    app.setColor(9);
    app.fillSelected();
    expect(app.assembly.core.vox.solid).toBe(app.assembly.core.vox.total);
    app.bevelSelected();
    expect(app.assembly.core.vox.solid).toBeLessThan(app.assembly.core.vox.total);
    app.setColor(6);
    app.repaintSelected();
    expect([...app.assembly.core.vox.usedColors()]).toEqual([6]);
  });
});

describe('colour', () => {
  it('picks a standard swatch', () => {
    app.setColor(4);
    expect(app.editor.colorIndex).toBe(4);
    expect(document.querySelector('#rightpanel .swatch.active').dataset.index).toBe('4');
  });

  it('the wheel appends a custom colour and selects it', () => {
    app.loadPreset('core');
    const before = app.assembly.palette.size;
    app.setCustomColor(0x123456);
    expect(app.assembly.palette.size).toBe(before + 1);
    expect(app.assembly.palette.get(app.editor.colorIndex)).toBe(0x123456);
  });

  it('the custom colour reaches the voxels and the geometry', () => {
    app.loadPreset('core');
    app.setCustomColor(0x00ff88);
    const idx = app.editor.colorIndex;
    app.editor.select(app.assembly.rootId);
    app.repaintSelected();
    expect([...app.assembly.core.vox.usedColors()]).toEqual([idx]);

    const colors = app.editor.rig.nodes.get(app.assembly.rootId).mesh.geometry.getAttribute('color');
    expect(colors.getX(0)).toBeCloseTo(0, 2);
    expect(colors.getY(0)).toBeGreaterThan(0.5);
  });

  it('renders a custom swatch in the panel', () => {
    app.loadPreset('core');
    app.setCustomColor(0xff00aa);
    const swatches = [...document.querySelectorAll('#rightpanel .swatch')];
    const hit = swatches.find((s) => s.style.background === hexToCss(0xff00aa)
      || s.title === hexToCss(0xff00aa));
    expect(hit).toBeTruthy();
  });

  it('the colour wheel component maps position to hue', () => {
    let picked = null;
    const wheel = new ColorWheel((hex) => { picked = hex; });
    document.getElementById('harness').append(wheel.el);
    wheel.setHex(0xd8463c);
    expect(wheel.hex).toBe(0xd8463c);

    wheel.h = 120; wheel.s = 1; wheel.v = 1;
    wheel._sync(true);
    expect(picked).toBeTruthy();
    expect((picked >> 8) & 0xff).toBeGreaterThan(200);   // green channel
    wheel.el.remove();
  });

  it('pruning on save drops unused custom colours', () => {
    app.loadPreset('core');
    app.setCustomColor(0x111111);
    app.setCustomColor(0x222222);   // never applied to any voxel
    const before = app.assembly.palette.size;
    app.save();
    expect(app.assembly.palette.size).toBeLessThan(before);
  });
});

describe('save and load', () => {
  it('round-trips a build, free positions included', () => {
    app.loadPreset('bits');
    app.editor.select(app.assembly.rootId);
    app.setTool(TOOL.CARVE);
    sculptAt(10, 10, 10);
    const before = {
      size: app.assembly.size,
      gait: app.editor.stats.gait,
      solid: app.assembly.core.vox.solid,
      positions: [...app.assembly.parts.values()]
        .filter((p) => p.mount).map((p) => p.mount.pos.join()).sort(),
    };
    app.save();
    app.loadPreset('core');
    app.load();

    expect(app.assembly.size).toBe(before.size);
    expect(app.editor.stats.gait).toBe(before.gait);
    expect(app.assembly.core.vox.solid).toBe(before.solid);
    const after = [...app.assembly.parts.values()]
      .filter((p) => p.mount).map((p) => p.mount.pos.join()).sort();
    expect(after.join('|')).toBe(before.positions.join('|'));
  });
});

describe('field mode', () => {
  it('drops straight into the action, with no pause menu', () => {
    app.loadPreset('biped');
    app.setMode('field');
    expect(app.mode).toBe('field');
    expect(app.field.paused, 'running immediately').toBe(false);
    expect(document.getElementById('pause').classList.contains('hidden')).toBe(true);
    expect(app.field.player).toBeTruthy();
    expect(app.field.enemies.length).toBe(3);
  });

  it('simulates as soon as it opens', () => {
    const before = app.field.player.position.clone();
    app.input.setEnabled(true);
    app.input.keys.add('KeyW');
    step(60);
    app.input.keys.clear();
    expect(app.field.player.position.distanceTo(before)).toBeGreaterThan(0.5);
  });

  it('Escape pauses and un-pauses', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    expect(app.field.paused).toBe(true);
    expect(document.getElementById('pause').classList.contains('hidden')).toBe(false);

    const held = app.field.player.position.clone();
    step(30);
    expect(app.field.player.position.distanceTo(held)).toBeCloseTo(0, 4);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    expect(app.field.paused).toBe(false);
  });

  it('the pause menu buttons work', () => {
    app.pauseField();
    const buttons = [...document.querySelectorAll('#pause button')];
    expect(buttons.length).toBe(3);

    buttons[1].click();                       // respawn
    expect(app.field.paused).toBe(false);
    expect(app.field.player.position.z).toBeCloseTo(-18, 0);

    app.pauseField();
    buttons[2].click();                       // back to the editor
    expect(app.mode).toBe('edit');
    expect(document.getElementById('pause').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('topbar').classList.contains('hidden')).toBe(false);
  });

  it('A strafes left and D strafes right', () => {
    app.setMode('field');
    app.input.setEnabled(true);
    const runKey = (code) => {
      app.field.respawn();
      app.field.player.body.angular.reset(new THREE.Vector3(0, 0, 1));
      app.input.keys.clear();
      app.input.keys.add(code);
      step(45);
      app.input.keys.clear();
      return app.field.player.position.x;
    };
    expect(runKey('KeyA'), 'A goes -X').toBeLessThan(-0.5);
    expect(runKey('KeyD'), 'D goes +X').toBeGreaterThan(0.5);
  });

  it('a backward double tap dashes backwards', () => {
    app.field.respawn();
    app.field.player.body.angular.reset(new THREE.Vector3(0, 0, 1));
    step(20);
    const before = app.field.player.position.z;
    app.input.dash = { dir: new THREE.Vector3(0, 0, -1), t: app.input.time };
    step(20);
    expect(app.field.player.position.z).toBeLessThan(before - 1);
  });

  it('lock-on acquires a target and drives the HUD', () => {
    app.field.respawn();
    app.input.setEnabled(true);
    app.input.buffer.push({ action: 'lock', t: app.input.time });
    step(60);
    expect(app.field.lock).toBeTruthy();
    expect(app.field.player.body.assist.hasTarget).toBe(true);
    expect(app.hudCanvas.width).toBeGreaterThan(0);
  });

  it('firing damages the locked target', () => {
    const hp = app.field.lock.robot.hp;
    app.input.keys.add('Mouse0');
    step(60);
    app.input.keys.clear();
    expect(app.field.lock.robot.hp).toBeLessThan(hp);
  });

  it('every preset can be flown', () => {
    for (const key of Object.keys(PRESETS)) {
      app.setMode('edit');
      app.loadPreset(key);
      app.setMode('field');
      app.input.keys.add('KeyW');
      app.input.keys.add('Space');
      shouldNotThrow(() => step(60), key);
      app.input.keys.clear();
      const t = app.field.player.body.telemetry();
      expect(Number.isFinite(t.speed), key).toBe(true);
      expect(Number.isFinite(app.field.player.position.y), key).toBe(true);
    }
    app.setMode('edit');
  });
});

describe('rendering', () => {
  it('the post pass runs: scene into a target, then a fullscreen resolve', () => {
    app.setMode('field');
    app.renderer.info.autoReset = false;
    app.renderer.info.reset();
    step(1);
    expect(app.renderer.info.render.calls).toBeGreaterThan(1);
    expect(app.field.post.target.width).toBeGreaterThan(0);
    expect(app.field.post.uniforms.tDiffuse.value).toBe(app.field.post.target.texture);
    app.renderer.info.autoReset = true;
    app.setMode('edit');
  });

  it('the HUD draws a reticle without throwing', () => {
    const canvas = document.createElement('canvas');
    const hud = new Hud(canvas);
    hud.resize(640, 400);
    const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 900);
    camera.position.set(0, 3, -10);
    camera.lookAt(0, 2, 0);
    camera.updateMatrixWorld(true);

    const fakeTarget = { position: new THREE.Vector3(0, 2, 20), radius: 2, hp: 50, maxHp: 100 };
    shouldNotThrow(() => {
      hud.draw({
        camera,
        player: { position: new THREE.Vector3() },
        targets: [fakeTarget],
        lock: { robot: fakeTarget, aimPoint: new THREE.Vector3(1, 2, 22) },
        telemetry: {
          speed: 18, thrust: 0.6, jerk: 40, zeta: 1.8, mass: 12,
          layer: { key: 'B', label: 'BALANCE', color: '#4fd2ff' },
          energy: 0.7, grounded: 1, assist: 1, frameLock: 0, range: 20, closing: 4,
        },
        gait: 'multileg',
      }, 1 / 60);
    }, 'hud.draw');

    const px = hud.ctx.getImageData(0, 0, 640, 400).data;
    let lit = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
    expect(lit, 'the HUD actually drew something').toBeGreaterThan(500);
  });

  it('projects world points into screen space', () => {
    const canvas = document.createElement('canvas');
    const hud = new Hud(canvas);
    hud.resize(800, 600);
    const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 900);
    camera.position.set(0, 0, -10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const p = hud.project(new THREE.Vector3(0, 0, 0), camera);
    expect(p.x).toBeCloseTo(400, -1);
    expect(p.y).toBeCloseTo(300, -1);
    expect(p.behind).toBe(false);
  });
});

describe('teardown', () => {
  it('disposes cleanly', () => {
    shouldNotThrow(() => app.dispose(), 'dispose');
  });
});

// ============================================================
//  Report
// ============================================================

const out = document.getElementById('results');
const summary = document.getElementById('summary');

function render(results) {
  summary.textContent = `${results.passed} passed / ${results.failed} failed / ${results.total} run`;
  summary.className = results.failed ? 'bad' : 'good';
}

const rows = new Map();

run((results) => {
  render(results);
  for (const suite of results.suites) {
    for (const t of suite.tests) {
      const key = `${suite.name} > ${t.name}`;
      if (rows.has(key)) continue;
      const li = document.createElement('li');
      li.className = t.ok ? 'ok' : 'fail';
      li.innerHTML = `<b>${suite.name}</b> ${t.name}${t.error ? `<em>${t.error}</em>` : ''}`;
      out.append(li);
      rows.set(key, li);
    }
  }
}).then((results) => {
  render(results);
  window.__TEST_RESULTS = results;
  document.body.dataset.done = 'true';
  console.log(`browser suite: ${results.passed}/${results.total} passed`);
  if (results.failures.length) console.table(results.failures);
});
