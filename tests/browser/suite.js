import * as THREE from 'three';
import { describe, it, expect, shouldNotThrow, run } from './runner.js';
import { App } from '../../src/main.js';
import { TOOL } from '../../src/editor/EditorScene.js';
import { PRESETS, computeStats } from '../../src/core/Assembly.js';
import { STANDARD_COLORS, hexToCss } from '../../src/core/Palette.js';
import { VOX_LEVELS, EQUIP, EQUIP_META } from '../../src/core/constants.js';
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
  localStorage.removeItem('brostom.parts.v1');
  localStorage.removeItem('brostom.keys.v1');
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
function pointAt(worldPoint, { click = false, ctrl = false } = {}) {
  const rect = app.canvas.getBoundingClientRect();
  const ndc = worldPoint.clone().project(app.editor.camera);
  const clientX = rect.left + ((ndc.x * 0.5) + 0.5) * rect.width;
  const clientY = rect.top + ((-ndc.y * 0.5) + 0.5) * rect.height;
  app.canvas.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY, bubbles: true }));
  if (click) {
    app.canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX, clientY, button: 0, ctrlKey: ctrl, bubbles: true,
    }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }
  return { clientX, clientY };
}

function worldOf(id) {
  app.editor.rig.root.updateMatrixWorld(true);
  return app.editor.rig.nodes.get(id).group.getWorldPosition(new THREE.Vector3());
}

/**
 * Put a lock on a live enemy without depending on where the camera happens
 * to be pointing. Acquisition itself is covered in the field-mode suite;
 * everything else just needs a lock to exist.
 */
function forceLock() {
  const target = app.field.enemies.find((e) => e.alive);
  if (!target) return null;
  app.field.lock = { robot: target, aimPoint: target.position.clone() };
  app.field._applyLock();
  step(2);
  return app.field.lock;
}

function sculptAt(x, y, z) {
  app.editor.hoverVoxel = { x, y, z };
  app.editor._applySculpt();
}

/** A whole stroke, the way a pointer press starts one — undo step included. */
function strokeAt(x, y, z) {
  app.editor.hoverVoxel = { x, y, z };
  app.editor.beginStroke();
  app.editor.painting = false;
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
    for (const id of ['topbar', 'partbar', 'leftpanel', 'rightpanel', 'hint',
      'fieldbar', 'pause', 'toast']) {
      expect(document.getElementById(id), id).toBeTruthy();
    }
    expect(document.querySelectorAll('.toolbtn').length).toBe(11);
  });

  it('dresses the native widgets dark, so the dropdowns are readable', () => {
    // A <select> paints its popup list from the page's colour scheme; without
    // this the preset list comes out white on a black page.
    expect(getComputedStyle(document.documentElement).colorScheme).toBe('dark');

    const sel = document.querySelector('#topbar select');
    expect(sel, 'the preset list is a real select').toBeTruthy();
    const bg = getComputedStyle(sel).backgroundColor;
    expect(bg, 'and it is opaque, not see-through white').not.toContain('rgba');
    const rgb = bg.match(/\d+/g).map(Number);
    expect(Math.max(...rgb), 'a dark background').toBeLessThan(60);

    const optRgb = getComputedStyle(sel.querySelector('option')).backgroundColor.match(/\d+/g).map(Number);
    expect(Math.max(...optRgb), 'the options too').toBeLessThan(60);
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

describe('escape', () => {
  const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));

  it('backs out of the tool first, then out of the selection', () => {
    app.setMode('edit');
    app.loadPreset('biped');
    app.setTool(TOOL.BLOCK);
    app.editor.select(app.assembly.rootId);

    esc();
    expect(app.editor.tool, 'first press: back to select').toBe(TOOL.SELECT);
    expect(app.editor.selection.size, 'the selection survives it').toBe(1);

    esc();
    expect(app.editor.selection.size, 'second press: clear').toBe(0);
    expect(app.editor.tool).toBe(TOOL.SELECT);
  });

  it('works from every tool, including sculpting', () => {
    app.setMode('edit');
    for (const tool of [TOOL.EQUIP, TOOL.BONE_LEG, TOOL.CARVE, TOOL.STAMP]) {
      app.setTool(tool);
      esc();
      expect(app.editor.tool, tool).toBe(TOOL.SELECT);
    }
  });

  it('closes the key config before anything else', () => {
    app.setMode('edit');
    app.setTool(TOOL.BLOCK);
    app.ui.keyConfig.show();
    esc();
    expect(app.ui.keyConfig.open).toBe(false);
    expect(app.editor.tool, 'the tool is untouched by that press').toBe(TOOL.BLOCK);
    esc();
    expect(app.editor.tool).toBe(TOOL.SELECT);
  });
});

describe('the rolling plate', () => {
  const stickRoller = () => {
    app.setMode('edit');
    app.loadPreset('core');
    const a = app.assembly;
    const dish = a.addBlockOnFace(a.rootId, 2, 5, { size: [1.5, 0.25, 0.5] });
    app.editor.rebuild();

    app.setEquipType(EQUIP.ROLLING);
    const at = worldOf(dish.id);
    aimCamera(at, new THREE.Vector3(0, 6, 0.01));
    pointAt(at.clone().add(new THREE.Vector3(0, 0.13, 0)), { click: true });
    return { dish, plate: app.assembly.get(app.editor.selected) };
  };

  it('sticks on like any other plate, and is square', () => {
    const { dish, plate } = stickRoller();
    expect(plate.kind).toBe('equip');
    expect(plate.equipType).toBe(EQUIP.ROLLING);
    expect(plate.parent).toBe(dish.id);
    expect(plate.spin).toEqual({ dir: 1, rpm: EQUIP_META.rolling.rpm });
  });

  it('turns the block it is stuck to, and keeps turning', () => {
    const { dish } = stickRoller();
    const node = app.editor.rig.nodes.get(dish.id);
    expect(node.spin, 'the block got a group to turn in').toBeTruthy();
    expect(app.editor.rig.rollers).toHaveLength(1);

    const before = node.spin.quaternion.clone();
    step(20);
    expect(before.angleTo(node.spin.quaternion)).toBeGreaterThan(0.2);
  });

  it('runs in the editor without the walk preview turned on', () => {
    stickRoller();
    expect(app.editor.previewMotion).toBe(false);
    const a0 = app.editor.rig.rollers[0].angle;
    step(20);
    expect(app.editor.rig.rollers[0].angle).not.toBe(a0);
  });

  it('the panel sets the direction and the speed', () => {
    const { plate } = stickRoller();
    app.ui.renderInspector(app.editor.selectedParts());
    expect(app.ui.inspectorEl.textContent).toContain('逆転');

    app.editor.setEquipSpinSelected({ dir: -1, rpm: 180 });
    expect(app.assembly.get(plate.id).spin).toEqual({ dir: -1, rpm: 180 });

    const before = app.editor.rig.rollers[0].angle;
    step(10);
    expect(app.editor.rig.rollers[0].angle, 'and it now turns the other way')
      .toBeLessThan(before);
  });

  it('warns when it is stuck somewhere it cannot work', () => {
    app.setMode('edit');
    app.loadPreset('core');
    const plate = app.assembly.addEquipOnFace(app.assembly.rootId, 2, EQUIP.ROLLING);
    app.editor.rebuild();
    app.editor.select(plate.id);
    app.ui.renderInspector(app.editor.selectedParts());
    expect(app.ui.inspectorEl.textContent).toContain('コアは回せません');
    expect(app.editor.rig.rollers).toHaveLength(0);
  });

  it('a mirrored roller turns the other way, like a mirrored propeller', () => {
    app.setMode('edit');
    app.loadPreset('core');
    const a = app.assembly;
    // Symmetry mirrors a part inside its own parent, so the plate has to sit
    // off-centre ON that parent for there to be anything to mirror.
    const hub = a.addBlockOnFace(a.rootId, 2, 3, { size: [1, 1, 1] });
    app.editor.rebuild();

    app.setEquipType(EQUIP.ROLLING);
    app.editor.symmetry = true;
    const at = worldOf(hub.id);
    aimCamera(at, new THREE.Vector3(6, 0, 0.01));
    pointAt(at.clone().add(new THREE.Vector3(0.49, 0, 0)), { click: true });
    app.editor.symmetry = false;

    const plates = app.assembly.equips();
    expect(plates).toHaveLength(2);
    expect(plates.map((p) => p.mount.pos[0]).sort()).toEqual([-0.5, 0.5]);
    expect(plates.map((p) => p.spin.dir).sort()).toEqual([-1, 1]);
  });

  it('survives a save and load', () => {
    const { plate } = stickRoller();
    app.editor.setEquipSpinSelected({ dir: -1, rpm: 240 });
    app.save();
    app.loadPreset('core');
    app.load();
    expect(app.assembly.equips()[0].spin).toEqual({ dir: -1, rpm: 240 });
    expect(app.editor.rig.rollers).toHaveLength(1);
  });
});

describe('working with bones', () => {
  const pickArm = () => {
    app.setMode('edit');
    app.loadPreset('biped');
    app.setTool(TOOL.SELECT);
    const arm = [...app.assembly.parts.values()].find((p) => p.boneType === 'arm');
    app.editor.select(arm.id);
    return arm;
  };

  it('a selected bone shows where its joint is and how far it swings', () => {
    const arm = pickArm();
    const g = app.editor.jointGizmo;
    expect(g.visible).toBe(true);
    expect(g.parent, 'rides the bone, so it tracks the machine')
      .toBe(app.editor.rig.nodes.get(arm.id).group);

    // the far-half marker runs from the joint to the tip
    const far = app.editor.jointFar.geometry.attributes.position;
    expect(far.getY(0)).toBeCloseTo(arm.length / 2, 4);
    expect(far.getY(1)).toBeCloseTo(arm.length, 4);
  });

  it('the arc really is the swing limit', () => {
    const arm = pickArm();
    const span = () => {
      const p = app.editor.jointArc.geometry.attributes.position;
      const n = p.count - 1;
      return Math.hypot(p.getX(0) - p.getX(n), p.getY(0) - p.getY(n), p.getZ(0) - p.getZ(n));
    };
    const wide = span();
    arm.limit = 20;
    app.editor.select(arm.id);
    expect(span(), 'a tighter limit draws a tighter arc').toBeLessThan(wide);
  });

  it('it goes away when the selection is not a single bone', () => {
    pickArm();
    app.editor.clearSelection();
    expect(app.editor.jointGizmo.visible).toBe(false);

    app.editor.select(app.assembly.rootId);
    expect(app.editor.jointGizmo.visible, 'a block has no joint').toBe(false);
  });

  it('chains another bone off the tip in one click', () => {
    const arm = pickArm();
    const before = app.assembly.size;
    expect(app.editor.addBoneOnTipSelected()).toBe(true);

    const made = app.assembly.get(app.editor.selected);
    expect(app.assembly.size).toBe(before + 1);
    expect(made.kind).toBe('bone');
    expect(made.boneType, 'same attribute as the bone it grew from').toBe('arm');
    expect(made.parent).toBe(arm.id);
    expect(made.mount.pos[1], 'at the tip').toBeCloseTo(arm.length, 4);
    expect(app.editor.rig.nodes.get(made.id)).toBeTruthy();
  });

  it('chaining is one undo step', () => {
    pickArm();
    const before = app.assembly.size;
    app.editor.addBoneOnTipSelected();
    app.undo();
    expect(app.assembly.size).toBe(before);
  });

  it('slides a child across the joint without hunting for the midpoint', () => {
    const arm = pickArm();
    const hand = [...app.assembly.parts.values()]
      .find((p) => p.parent === arm.id && p.kind === 'block');
    app.editor.select(hand.id);

    app.editor.slideAlongBone(0);
    expect(app.editor.boneHalfOf(hand.id)).toBe('near');
    app.editor.slideAlongBone(1);
    expect(app.editor.boneHalfOf(hand.id)).toBe('far');
    expect(app.assembly.get(hand.id).mount.pos[1]).toBeCloseTo(arm.length, 4);
  });

  it('sliding does nothing to a part that is not on a bone', () => {
    app.setMode('edit');
    app.loadPreset('biped');
    const block = [...app.assembly.parts.values()]
      .find((p) => p.kind === 'block' && app.assembly.get(p.parent)?.kind !== 'bone');
    app.editor.select(block.id);
    expect(app.editor.slideAlongBone(1)).toBe(false);
  });
});

describe('the custom bone', () => {
  const rotor = (custom = {}) => {
    app.setMode('edit');
    app.loadPreset('core');
    const a = app.assembly;
    const bone = a.addBoneOnFace(a.rootId, 2, 'custom', { length: 1.5 });
    Object.assign(bone.custom, custom);
    a.addBlockOnBone(bone.id, 1.2, 7, { size: [1.5, 0.25, 0.25] });
    app.editor.rebuild();
    return bone;
  };

  it('holds still until you select it, then shows you the motion', () => {
    const bone = rotor({ amp: 60, freq: 2 });
    const node = app.editor.rig.nodes.get(bone.id);
    step(30);
    const resting = node.joint.quaternion.clone();
    step(60);
    expect(resting.angleTo(node.joint.quaternion), 'idle machines stand still')
      .toBeLessThan(0.01);

    app.editor.select(bone.id);
    const before = node.joint.quaternion.clone();
    step(30);
    expect(before.angleTo(node.joint.quaternion)).toBeGreaterThan(0.05);
  });

  it('previewing it leaves the rest of the machine at rest', () => {
    app.setMode('edit');
    app.loadPreset('biped');
    const a = app.assembly;
    const bone = a.addBoneOnFace(a.core.id, 2, 'custom', { length: 1.2 });
    bone.custom.amp = 60;
    app.editor.rebuild();
    app.editor.select(bone.id);
    step(60);

    const leg = app.editor.rig.joints.find((n) => n.part.boneType === 'leg');
    expect(leg.joint.quaternion.w, 'the legs stayed put').toBeCloseTo(1, 3);
  });

  it('a rotation goes right round, past the joint limit', () => {
    const bone = rotor({ wave: 'saw', freq: 2 });
    bone.limit = 30;
    app.editor.select(bone.id);
    const node = app.editor.rig.nodes.get(bone.id);
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      step(1);
      peak = Math.max(peak, 2 * Math.acos(Math.min(1, Math.abs(node.joint.quaternion.w))));
    }
    expect(peak * (180 / Math.PI)).toBeGreaterThan(120);
  });

  it('the panel offers every knob, and hides the ones that do not apply', () => {
    const bone = rotor();
    app.editor.select(bone.id);
    app.ui.renderInspector(app.editor.selectedParts());
    let text = app.ui.inspectorEl.textContent;
    for (const k of ['動き方', '振幅', '中心角', '位相ずらし', '駆動ソース']) {
      expect(text, k).toContain(k);
    }

    bone.custom.wave = 'saw';
    app.ui.renderInspector(app.editor.selectedParts());
    text = app.ui.inspectorEl.textContent;
    expect(text).toContain('回転速度');
    expect(text, 'a rotation has no amplitude to set').not.toContain('振幅');
  });

  it('the joint read-out follows the axis the motion uses', () => {
    const bone = rotor({ axis: 'x' });
    app.editor.select(bone.id);
    const axisPos = () => {
      const p = app.editor.jointAxis.geometry.attributes.position;
      return new THREE.Vector3(p.getX(1) - p.getX(0), p.getY(1) - p.getY(0), p.getZ(1) - p.getZ(0))
        .normalize();
    };
    const onX = axisPos();
    bone.custom.axis = 'y';
    app.editor.select(bone.id);
    expect(axisPos().dot(onX), 'a different axis draws a different hinge')
      .toBeLessThan(0.9);
  });
});

describe('tool settings panel', () => {
  const shown = () => ({
    gizmo: !app.ui.gizmoSection.classList.contains('hidden'),
    block: !app.ui.blockSection.classList.contains('hidden'),
    equip: !app.ui.equipSection.classList.contains('hidden'),
    bone: !app.ui.boneSection.classList.contains('hidden'),
    sculpt: !app.ui.sculptSection.classList.contains('hidden'),
    stamp: !app.ui.stampSection.classList.contains('hidden'),
  });
  const only = (key) => {
    const v = shown();
    return Object.keys(v).every((k) => v[k] === (k === key));
  };

  it('shows the settings for the tool in hand, and only those', () => {
    app.setMode('edit');
    app.setTool(TOOL.SELECT);
    expect(only('gizmo'), JSON.stringify(shown())).toBe(true);
    app.setTool(TOOL.BLOCK);
    expect(only('block')).toBe(true);
    app.setTool(TOOL.EQUIP);
    expect(only('equip')).toBe(true);
    app.setTool(TOOL.BONE_LEG);
    expect(only('bone')).toBe(true);
    app.setTool(TOOL.CARVE);
    expect(only('sculpt')).toBe(true);
    app.setTool(TOOL.STAMP);
    expect(only('stamp')).toBe(true);
    app.setTool(TOOL.SELECT);
  });

  it('that is most of the panel it used to be', () => {
    app.setMode('edit');
    app.setTool(TOOL.SELECT);
    const focused = app.ui.leftPanel.scrollHeight;
    for (const sec of app.ui.toolSections) sec.classList.remove('hidden');
    const everything = app.ui.leftPanel.scrollHeight;
    app.setTool(TOOL.SELECT);
    expect(focused).toBeLessThan(everything * 0.65);
  });

  it('reaching a sculpt tool by key unfolds its buttons', () => {
    app.setMode('edit');
    app.ui.sculptTools.setOpen(false);
    expect(app.ui.sculptTools.classList.contains('folded')).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX', bubbles: true }));
    expect(app.editor.tool).toBe(TOOL.CARVE);
    expect(app.ui.sculptTools.classList.contains('folded')).toBe(false);
    app.setTool(TOOL.SELECT);
  });

  it('the right-hand sections fold away', () => {
    const section = app.ui.librarySection;
    section.setOpen(true);
    expect(section.classList.contains('folded')).toBe(false);
    section.querySelector('.sectionhead').click();
    expect(section.classList.contains('folded')).toBe(true);
    section.querySelector('.sectionhead').click();
    expect(section.classList.contains('folded')).toBe(false);
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

  it('an additive select adds a second part, and repeating it drops that part', () => {
    app.loadPreset('biped');
    app.setTool(TOOL.SELECT);
    const ids = [...app.assembly.parts.keys()].slice(0, 3);
    app.editor.select(ids[0]);
    app.editor.select(ids[1], true);
    expect(app.editor.selection.size).toBe(2);
    app.editor.select(ids[1], true);
    expect(app.editor.selection.size).toBe(1);
  });

  it('ctrl-clicking a second part adds it, and a plain click replaces the lot', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BLOCK);
    app.editor.newBlockSize = [1, 1, 1];
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(0, 5, 12));
    pointAt(core.clone().add(new THREE.Vector3(-2.5, 0, 0)), { click: true });
    pointAt(core.clone().add(new THREE.Vector3(2.5, 0, 0)), { click: true });
    const [left, right] = [...app.assembly.parts.values()]
      .filter((p) => p.mount).sort((a, b) => a.mount.pos[0] - b.mount.pos[0]);

    app.setTool(TOOL.SELECT);
    pointAt(worldOf(left.id), { click: true });
    expect(app.editor.selection.size, 'plain click').toBe(1);

    pointAt(worldOf(right.id), { click: true, ctrl: true });
    expect(app.editor.selection.size, 'ctrl adds').toBe(2);

    pointAt(worldOf(right.id), { click: true, ctrl: true });
    expect(app.editor.selection.size, 'ctrl again removes it').toBe(1);

    pointAt(worldOf(right.id), { click: true });
    expect(app.editor.selection.size, 'plain click replaces').toBe(1);
    expect(app.editor.selected).toBe(right.id);
  });

  it('a plain shift-click no longer accumulates', () => {
    app.loadPreset('biped');
    app.setTool(TOOL.SELECT);
    const core = worldOf(app.assembly.rootId);
    const rect = aimCamera(core, new THREE.Vector3(6, 0, 0));
    const ndc = core.clone().add(new THREE.Vector3(0.49, 0, 0)).project(app.editor.camera);
    const clientX = rect.left + ((ndc.x * 0.5) + 0.5) * rect.width;
    const clientY = rect.top + ((-ndc.y * 0.5) + 0.5) * rect.height;
    app.canvas.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY, bubbles: true }));
    for (let i = 0; i < 2; i++) {
      app.canvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX, clientY, button: 0, shiftKey: true, bubbles: true,
      }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    }
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

describe('connecting blocks', () => {
  /**
   * Build the case the feature exists for: a bone with a block on its far
   * half, and a loose block floating beside it.
   * @returns {{boneId:string, riderId:string, looseId:string}}
   */
  function boneWithRiderAndLooseBlock() {
    app.loadPreset('core');
    app.setTool(TOOL.SELECT);
    const asm = app.assembly;
    const bone = asm.addBoneOnFace(asm.rootId, 2, 'leg', { length: 4, gauge: 'mid' });
    const rider = asm.addBlock(bone.id, { pos: [0, 3.2, 0] }, 4, { size: [0.5, 0.5, 0.5] });
    // beside the rider and at the same height: the bone root sits 0.5 above
    // the core, so bone-frame 3.2 is core-frame 3.7
    const loose = asm.addBlock(asm.rootId, { pos: [1.6, 3.7, 0] }, 15, { size: [0.5, 0.5, 0.5] });
    app.editor.rebuild();
    return { boneId: bone.id, riderId: rider.id, looseId: loose.id };
  }

  it('the anchor is whichever part was selected last', () => {
    app.loadPreset('biped');
    const ids = [...app.assembly.parts.keys()].slice(0, 3);
    app.editor.select(ids[0]);
    app.editor.select(ids[1], true);
    app.editor.select(ids[2], true);
    expect(app.editor.anchorId).toBe(ids[2]);

    app.editor.select(ids[0]);
    app.editor.select(ids[1], true);
    expect(app.editor.anchorId).toBe(ids[1]);
  });

  it('connects a loose block to a block that rides a bone', () => {
    const { boneId, riderId, looseId } = boneWithRiderAndLooseBlock();
    expect(app.assembly.get(looseId).parent).toBe(app.assembly.rootId);

    // select the loose block, then the rider — the rider becomes the anchor
    app.editor.select(looseId);
    app.editor.select(riderId, true);
    const res = app.editor.connectSelected();

    expect(res.connected).toBe(1);
    expect(app.assembly.get(looseId).parent).toBe(riderId);
    // and both now ride the same articulated half of the bone
    expect(app.editor.rig.nodes.get(looseId).group.parent)
      .toBe(app.editor.rig.nodes.get(riderId).group);
    expect(boneId).toBeTruthy();
  });

  it('the connected block then swings with the bone', () => {
    const { boneId, riderId, looseId } = boneWithRiderAndLooseBlock();
    app.editor.select(looseId);
    app.editor.select(riderId, true);
    app.editor.connectSelected();

    const before = worldOf(looseId).clone();
    // bend the joint the way the animator would
    app.editor.rig.nodes.get(boneId).joint.quaternion
      .setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.7);
    app.editor.rig.root.updateMatrixWorld(true);

    expect(worldOf(looseId).distanceTo(before), 'it moved with the joint').toBeGreaterThan(0.5);
  });

  it('connecting does not move anything', () => {
    const { riderId, looseId } = boneWithRiderAndLooseBlock();
    const before = worldOf(looseId).clone();
    app.editor.select(looseId);
    app.editor.select(riderId, true);
    app.editor.connectSelected();
    expect(worldOf(looseId).distanceTo(before)).toBeCloseTo(0, 4);
  });

  it('connects several parts at once', () => {
    app.loadPreset('bits');
    app.setTool(TOOL.SELECT);
    const bits = [...app.assembly.parts.values()]
      .filter((p) => p.mount && Math.hypot(...p.mount.pos) > 1.5)
      .slice(0, 4);
    const anchor = [...app.assembly.parts.values()].find((p) => p.kind === 'bone');

    app.editor.select(bits.map((p) => p.id));
    app.editor.select(anchor.id, true);
    const res = app.editor.connectSelected();

    expect(res.connected).toBe(bits.length);
    for (const b of bits) expect(app.assembly.get(b.id).parent, b.id).toBe(anchor.id);
  });

  it('disconnects several parts at once, back onto the core', () => {
    app.loadPreset('bits');
    const bits = [...app.assembly.parts.values()]
      .filter((p) => p.mount && Math.hypot(...p.mount.pos) > 1.5)
      .slice(0, 4);
    const anchor = [...app.assembly.parts.values()].find((p) => p.kind === 'bone');
    app.editor.select(bits.map((p) => p.id));
    app.editor.select(anchor.id, true);
    app.editor.connectSelected();

    const positions = bits.map((b) => worldOf(b.id).clone());
    app.editor.select(bits.map((b) => b.id));
    expect(app.editor.disconnectSelected()).toBe(bits.length);

    bits.forEach((b, i) => {
      expect(app.assembly.get(b.id).parent, b.id).toBe(app.assembly.rootId);
      expect(worldOf(b.id).distanceTo(positions[i]), 'stayed put').toBeCloseTo(0, 4);
    });
  });

  it('refuses to connect a part to its own descendant', () => {
    app.loadPreset('biped');
    const arm = [...app.assembly.parts.values()].find((p) => p.boneType === 'arm');
    const ancestor = app.assembly.ancestry(arm.id).find((p) => p.kind !== 'core');
    app.editor.select(ancestor.id);
    app.editor.select(arm.id, true);      // arm is the anchor, and a descendant
    const res = app.editor.connectSelected();
    expect(res.connected).toBe(0);
    expect(res.skipped).toBeGreaterThan(0);
    expect(app.assembly.get(ancestor.id).parent).not.toBe(arm.id);
  });

  it('does nothing with fewer than two parts selected', () => {
    app.loadPreset('biped');
    app.editor.select(app.assembly.rootId);
    expect(app.editor.connectSelected().connected).toBe(0);
    app.editor.clearSelection();
    expect(app.editor.connectSelected().connected).toBe(0);
  });

  it('keeps existing structure: only the topmost selected parts re-home', () => {
    app.loadPreset('biped');
    const parent = [...app.assembly.parts.values()]
      .find((p) => p.kind === 'block' && p.children.length);
    const child = parent.children[0];
    const anchor = [...app.assembly.parts.values()]
      .find((p) => p.kind === 'block' && app.assembly.canReparent(parent.id, p.id));

    app.editor.select([parent.id, child]);
    app.editor.select(anchor.id, true);
    app.editor.connectSelected();

    expect(app.assembly.get(parent.id).parent).toBe(anchor.id);
    expect(app.assembly.get(child).parent, 'child stayed under its parent').toBe(parent.id);
  });

  it('reports which half of a bone a connection landed on', () => {
    app.loadPreset('core');
    app.setTool(TOOL.SELECT);
    const asm = app.assembly;
    const bone = asm.addBoneOnFace(asm.rootId, 2, 'leg', { length: 4, gauge: 'mid' });
    // one block near the base, one out past the joint
    const nearBlock = asm.addBlock(asm.rootId, { pos: [1.2, 1.0, 0] }, 4, { size: [0.5, 0.5, 0.5] });
    const farBlock = asm.addBlock(asm.rootId, { pos: [1.2, 4.0, 0] }, 4, { size: [0.5, 0.5, 0.5] });
    app.editor.rebuild();

    app.editor.select([nearBlock.id, farBlock.id]);
    app.editor.select(bone.id, true);
    const res = app.editor.connectSelected();

    expect(res.connected).toBe(2);
    expect(res.rigid, 'one landed on the rigid half').toBe(1);
    expect(app.editor.boneHalfOf(nearBlock.id)).toBe('near');
    expect(app.editor.boneHalfOf(farBlock.id)).toBe('far');
    // and only the far one actually swings
    const beforeNear = worldOf(nearBlock.id).clone();
    const beforeFar = worldOf(farBlock.id).clone();
    app.editor.rig.nodes.get(bone.id).joint.quaternion
      .setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.6);
    app.editor.rig.root.updateMatrixWorld(true);
    expect(worldOf(nearBlock.id).distanceTo(beforeNear)).toBeCloseTo(0, 4);
    expect(worldOf(farBlock.id).distanceTo(beforeFar)).toBeGreaterThan(0.5);
  });

  it('boneHalfOf is null for a part hanging off a block', () => {
    app.loadPreset('biped');
    const block = [...app.assembly.parts.values()]
      .find((p) => p.kind === 'block' && app.assembly.get(p.parent)?.kind !== 'bone' && p.parent);
    expect(app.editor.boneHalfOf(block.id)).toBeNull();
  });

  it('draws a link line for every connected selection', () => {
    app.loadPreset('biped');
    const ids = [...app.assembly.parts.keys()].filter((id) => id !== app.assembly.rootId).slice(0, 3);
    app.editor.select(ids);
    expect(app.editor.linkLines.visible).toBe(true);
    expect(app.editor.linkLines.geometry.drawRange.count).toBe(ids.length * 2);

    app.editor.clearSelection();
    expect(app.editor.linkLines.visible).toBe(false);
  });

  it('marks the anchor with its own outline colour', () => {
    app.loadPreset('biped');
    const ids = [...app.assembly.parts.keys()].slice(0, 2);
    app.editor.select(ids);
    const mats = app.editor._outlinePool.slice(0, 2).map((o) => o.material);
    expect(mats[1]).toBe(app.editor.anchorMat);
    expect(mats[0]).toBe(app.editor.outlineMat);
  });

  it('J and Shift+J drive it from the keyboard', () => {
    const { riderId, looseId } = boneWithRiderAndLooseBlock();
    app.setMode('edit');
    app.editor.select(looseId);
    app.editor.select(riderId, true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true }));
    expect(app.assembly.get(looseId).parent).toBe(riderId);

    app.editor.select(looseId);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', shiftKey: true, bubbles: true }));
    expect(app.assembly.get(looseId).parent).toBe(app.assembly.rootId);
  });

  it('survives a save and load', () => {
    const { riderId, looseId } = boneWithRiderAndLooseBlock();
    app.editor.select(looseId);
    app.editor.select(riderId, true);
    app.editor.connectSelected();
    app.save();
    app.loadPreset('core');
    app.load();
    expect(app.assembly.get(looseId).parent).toBe(riderId);
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
  it('Ctrl+S saves, and does not hand the page to the browser', () => {
    app.setMode('edit');
    app.loadPreset('biped');
    app.assembly.name = 'CTRL S';
    localStorage.removeItem('brostom.assembly.v1');

    const ev = new KeyboardEvent('keydown', {
      code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true,
    });
    window.dispatchEvent(ev);

    expect(ev.defaultPrevented, 'the browser save dialog is suppressed').toBe(true);
    const raw = localStorage.getItem('brostom.assembly.v1');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw).name).toBe('CTRL S');
    expect(app.ui.toast.textContent).toContain('保存');
  });

  it('does not fire while typing in a field', () => {
    app.setMode('edit');
    localStorage.removeItem('brostom.assembly.v1');
    app.ui.nameInput.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true,
    }));
    expect(localStorage.getItem('brostom.assembly.v1')).toBeNull();
  });

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
    // By label, not by index: the menu grows, and a shifted index silently
    // leaves the field paused for every test that follows.
    const button = (text) => [...document.querySelectorAll('#pause button')]
      .find((b) => b.textContent.includes(text));
    expect(button('再開')).toBeTruthy();
    expect(button('キー設定')).toBeTruthy();

    button('リスポーン').click();
    expect(app.field.paused).toBe(false);
    expect(app.field.player.position.z).toBeCloseTo(-18, 0);

    app.pauseField();
    button('編集画面に戻る').click();
    expect(app.mode).toBe('edit');
    expect(document.getElementById('pause').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('topbar').classList.contains('hidden')).toBe(false);
  });

  it('A strafes right and D strafes left, as configured', () => {
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
    expect(runKey('KeyA'), 'A goes +X').toBeGreaterThan(0.5);
    expect(runKey('KeyD'), 'D goes -X').toBeLessThan(-0.5);
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

  it('keeps the chassis level on the ground, however steeply it is aiming', () => {
    app.setMode('edit');
    app.loadPreset('biped');
    app.setMode('field');
    app.input.setEnabled(true);
    app.field.respawn();

    // Park a target overhead and hold the lock while walking at it.
    const p = app.field.player;
    const target = app.field.enemies.find((e) => e.alive);
    target.body.reset(new THREE.Vector3(4, 30, -10));
    target.syncTransform();
    app.field.lock = { robot: target, aimPoint: target.position.clone() };
    app.field._applyLock();
    step(60);

    let steepestAim = 0;
    let worstTilt = 0;
    app.input.keys.add('KeyW');
    for (let i = 0; i < 150; i++) {
      step(1);
      steepestAim = Math.max(steepestAim, p.body.aimForward.y);
      if (p.body.env.grounded > 0.9) worstTilt = Math.max(worstTilt, Math.abs(p.body.forward.y));
    }
    app.input.keys.clear();

    expect(steepestAim, 'it really was aiming up').toBeGreaterThan(0.3);
    expect(worstTilt, 'and never tipped the chassis').toBeLessThan(0.05);
    expect(p.body.env.grounded, 'still on its feet').toBeGreaterThan(0.9);
  });

  it('closing on a locked target does not lift the machine off the ground', () => {
    app.setMode('edit');
    app.loadPreset('biped');
    app.setMode('field');
    app.input.setEnabled(true);
    app.field.respawn();

    app.input.buffer.push({ action: 'lock', t: app.input.time });
    step(30);
    expect(app.field.lock, 'locked on').toBeTruthy();

    const start = app.field.player.position.y;
    let peak = start;
    let closest = Infinity;
    app.input.keys.add('KeyW');
    for (let i = 0; i < 260; i++) {
      step(1);
      peak = Math.max(peak, app.field.player.position.y);
      if (app.field.lock) {
        closest = Math.min(closest, app.field.player.position.distanceTo(app.field.lock.robot.position));
      }
    }
    app.input.keys.clear();

    expect(closest, 'we really did get close').toBeLessThan(8);
    expect(peak - start, 'and never left the floor').toBeLessThan(0.5);
    expect(app.field.player.body.env.grounded).toBeGreaterThan(0.9);
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

describe('equipment plates', () => {
  /** Put a plate on the chest by actually clicking the chest. */
  const stick = (type, face = 0.49) => {
    app.setEquipType(type);
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(0, 1, 7));
    const chest = [...app.assembly.parts.values()].find((p) => p.size?.[0] === 1.5);
    const at = worldOf(chest.id).add(new THREE.Vector3(0, 0, face));
    pointAt(at, { click: true });
    return app.assembly.get(app.editor.selected);
  };

  it('the tool is armed by picking a plate, and the ghost shows it', () => {
    app.setMode('edit');
    app.loadPreset('biped');
    app.setEquipType(EQUIP.BEAM);
    expect(app.editor.tool).toBe(TOOL.EQUIP);
    expect(app.editor.equipType).toBe(EQUIP.BEAM);

    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(0, 1, 7));
    pointAt(core.clone().add(new THREE.Vector3(0, 0, 0.49)));
    expect(app.editor.ghost.visible).toBe(true);
  });

  it('a click sticks a plate flat on the surface it hit', () => {
    app.loadPreset('biped');
    const before = app.assembly.size;
    const e = stick(EQUIP.BEAM);

    expect(app.assembly.size).toBe(before + 1);
    expect(e.kind).toBe('equip');
    expect(e.equipType).toBe(EQUIP.BEAM);
    // laid on the surface: its facing is the face normal, and it has no depth
    const up = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(new THREE.Quaternion().fromArray(e.mount.rot));
    expect(Math.abs(up.z), 'points out of the face it was stuck to').toBeGreaterThan(0.9);
    expect(app.editor.stats.weaponCount).toBe(1);
  });

  it('the plate really is in the scene, and it is a plate', () => {
    app.loadPreset('biped');
    const e = stick(EQUIP.GATLING);
    const node = app.editor.rig.nodes.get(e.id);
    expect(node).toBeTruthy();
    expect(node.plate).toBeTruthy();
    expect(node.accent).toBeTruthy();
    expect(app.editor.rig.equipNodes).toHaveLength(1);
    // thin: the slab is far wider than it is deep
    const box = new THREE.Box3().setFromObject(node.plate);
    const size = box.getSize(new THREE.Vector3());
    expect(Math.min(size.x, size.y, size.z)).toBeLessThan(0.2);
  });

  it('picks up a plate when you click it', () => {
    app.loadPreset('biped');
    const e = stick(EQUIP.BEAM);
    app.editor.clearSelection();
    app.setTool(TOOL.SELECT);
    pointAt(worldOf(e.id), { click: true });
    expect(app.editor.selected).toBe(e.id);
  });

  it('swapping the type re-cuts the plate without rebuilding the world', () => {
    app.loadPreset('biped');
    const e = stick(EQUIP.BEAM);
    const node = app.editor.rig.nodes.get(e.id);
    app.editor.setEquipTypeSelected(EQUIP.BOOST);
    expect(app.assembly.get(e.id).equipType).toBe(EQUIP.BOOST);
    expect(app.editor.rig.nodes.get(e.id), 'same node, re-cut in place').toBe(node);
    expect(app.editor.stats.weaponCount).toBe(0);
    expect(app.editor.stats.dashBonus).toBeGreaterThan(0);
  });

  it('resizing a plate is undoable like anything else', () => {
    app.loadPreset('biped');
    const e = stick(EQUIP.BEAM);
    app.editor.setEquipSizeSelected(1.4);
    expect(app.assembly.get(e.id).size).toBeCloseTo(1.4, 3);
    app.undo();
    expect(app.assembly.get(e.id).size).toBeCloseTo(0.7, 3);
  });

  it('the bullet colour reaches the plate you can see', () => {
    app.loadPreset('biped');
    const e = stick(EQUIP.BEAM);
    app.setBulletColor(0x6bff6b);
    expect(app.assembly.get(e.id).bulletColor).toBe(0x6bff6b);
    expect(app.editor.rig.nodes.get(e.id).accent.material.color.getHex()).toBe(0x6bff6b);
  });

  it('a blade refuses a bullet colour, and says so in the panel', () => {
    app.loadPreset('biped');
    const e = stick(EQUIP.BLADE);
    expect(app.editor.setBulletColorSelected(0x6bff6b)).toBe(false);
    expect(app.assembly.get(e.id).bulletColor).toBeNull();
    app.ui.renderInspector(app.editor.selectedParts());
    expect(app.ui.inspectorEl.textContent).toContain('弾の色を変えられません');
  });

  it('the panel offers the plate controls, and names the plate', () => {
    app.loadPreset('biped');
    stick(EQUIP.SHOT);
    app.ui.renderInspector(app.editor.selectedParts());
    const text = app.ui.inspectorEl.textContent;
    expect(text).toContain('ショット');
    expect(text).toContain('装弾');
    expect(text).toContain('弾の色');
  });

  it('a second gravity plate is refused, with a reason', () => {
    app.loadPreset('biped');
    stick(EQUIP.GRAVITY);
    expect(app.assembly.countEquip(EQUIP.GRAVITY)).toBe(1);
    const size = app.assembly.size;

    stick(EQUIP.GRAVITY);
    expect(app.assembly.size, 'nothing was placed').toBe(size);
    expect(app.assembly.countEquip(EQUIP.GRAVITY)).toBe(1);
    expect(app.ui.toast.textContent).toContain('1枚');
  });

  it('symmetry mirrors a plate across the machine', () => {
    app.loadPreset('biped');
    app.setEquipType(EQUIP.GATLING);
    app.editor.symmetry = true;
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(0, 5, 12));
    pointAt(core.clone().add(new THREE.Vector3(2.5, 0, 0)), { click: true });
    app.editor.symmetry = false;

    const plates = app.assembly.equips();
    expect(plates).toHaveLength(2);
    const xs = plates.map((e) => e.mount.pos[0]).sort((x, y) => x - y);
    expect(xs[0]).toBeCloseTo(-xs[1], 5);
  });

  it('plates travel with copy and paste', () => {
    app.loadPreset('biped');
    const e = stick(EQUIP.BEAM);
    app.setTool(TOOL.SELECT);
    app.editor.select(e.id);
    app.copySelected();
    app.pasteClipboard();
    expect(app.assembly.equips()).toHaveLength(2);
    expect(app.assembly.get(app.editor.selected).equipType).toBe(EQUIP.BEAM);
  });

  it('a plate survives save and load', () => {
    app.loadPreset('biped');
    stick(EQUIP.SHOT);
    app.setBulletColor(0xff2fb0);
    app.save();
    app.loadPreset('core');
    app.load();
    const [e] = app.assembly.equips();
    expect(e.equipType).toBe(EQUIP.SHOT);
    expect(e.bulletColor).toBe(0xff2fb0);
  });

  it('deletes like any other part', () => {
    app.loadPreset('biped');
    const e = stick(EQUIP.BEAM);
    app.setTool(TOOL.SELECT);
    app.editor.select(e.id);
    app.editor.deleteSelected();
    expect(app.assembly.get(e.id)).toBe(undefined);
    expect(app.editor.stats.weaponCount).toBe(0);
  });
});

describe('weapons in the field', () => {
  /** A biped wearing one plate of each named type, already in the field. */
  const deploy = (...types) => {
    app.setMode('edit');
    app.loadPreset('biped');
    const a = app.assembly;
    const chest = [...a.parts.values()].find((p) => p.size?.[0] === 1.5);
    for (const t of types) a.addEquipOnFace(chest.id, 4, t);
    app.editor.rebuild();
    app.setMode('field');
    app.input.setEnabled(true);
    app.field.respawn();
    return app.field.player;
  };

  const lockOn = () => forceLock();

  it('builds one weapon slot per plate, in the field too', () => {
    const p = deploy(EQUIP.BEAM, EQUIP.GATLING, EQUIP.BOOST);
    expect(p.weapons.slots.map((s) => s.type)).toEqual([EQUIP.BEAM, EQUIP.GATLING]);
  });

  it('the trigger sends real projectiles down range', () => {
    deploy(EQUIP.GATLING);
    lockOn();
    // Sample across the burst: at close range a round can be spawned and
    // spent inside a couple of frames, so the count on any ONE frame proves
    // nothing either way.
    let peak = 0;
    app.input.keys.add('Mouse0');
    for (let i = 0; i < 30; i++) {
      step(1);
      peak = Math.max(peak, app.field.projectiles.liveCount);
    }
    app.input.keys.clear();
    expect(peak, 'rounds were in the air').toBeGreaterThan(0);
    expect(app.field.player.weapons.slots[0].ammo).toBeLessThan(30);
  });

  it('runs a magazine dry and reloads on the clock', () => {
    const p = deploy(EQUIP.GATLING);
    lockOn();
    app.input.keys.add('Mouse0');
    step(180);
    app.input.keys.clear();
    const slot = p.weapons.slots[0];
    expect(slot.ammo === 0 || slot.reloadT > 0, 'it ran out and started reloading').toBe(true);
    step(240);
    expect(p.weapons.slots[0].ammo).toBeGreaterThan(0);
  });

  it('shots that connect actually hurt', () => {
    deploy(EQUIP.GATLING, EQUIP.BEAM, EQUIP.SHOT);
    const lock = lockOn();
    expect(lock).toBeTruthy();
    const hp = lock.robot.hp;
    for (let i = 0; i < 300; i++) {
      if (i % 24 === 0) app.input.keys.delete('Mouse0');
      if (i % 24 === 2) app.input.keys.add('Mouse0');
      step(1);
    }
    app.input.keys.clear();
    expect(lock.robot.hp).toBeLessThan(hp);
  });

  it('a missile chases what you locked', () => {
    const p = deploy(EQUIP.MISSILE);
    const lock = lockOn();
    let missile = null;
    const spawn = app.field.projectiles.spawn.bind(app.field.projectiles);
    app.field.projectiles.spawn = (o) => {
      const shot = spawn(o);
      if (o.kind === 'missile') missile = shot;
      return shot;
    };
    app.input.keys.add('Mouse0');
    step(2);
    app.input.keys.clear();
    app.field.projectiles.spawn = spawn;

    expect(missile, 'a missile went out').toBeTruthy();
    expect(missile.turn).toBeGreaterThan(0);
    const start = missile.mesh.position.distanceTo(lock.robot.position);
    step(60);
    const now = missile.life > 0
      ? missile.mesh.position.distanceTo(lock.robot.position)
      : 0;
    expect(now, 'and it closed the distance').toBeLessThan(start);
  });

  it('a blade lights the block it is stuck to while you hold the trigger', () => {
    const p = deploy(EQUIP.BLADE);
    const glow = p.rig.equipNodes[0].bladeGlow;
    expect(glow, 'the shell exists').toBeTruthy();
    expect(glow.visible).toBe(false);

    app.input.keys.add('Mouse0');
    step(30);
    expect(p.weapons.bladeGlow).toBeGreaterThan(0.7);
    expect(glow.visible).toBe(true);
    expect(glow.material.opacity).toBeGreaterThan(0.1);

    app.input.keys.clear();
    step(90);
    expect(glow.visible).toBe(false);
  });

  it('the HUD lists every plate with its magazine', () => {
    deploy(EQUIP.BEAM, EQUIP.BLADE);
    const rows = app.field.player.weapons.readout();
    expect(rows.map((r) => r.label)).toEqual(['ビーム', 'ブレード']);
    expect(rows[0].max).toBe(EQUIP_META.beam.ammo);
    expect(rows[1].melee).toBe(true);
    shouldNotThrow(() => step(3), 'hud with weapons');
  });

  it('a respawn reloads everything', () => {
    const p = deploy(EQUIP.BEAM);
    lockOn();
    app.input.keys.add('Mouse0');
    step(20);
    app.input.keys.clear();
    expect(p.weapons.slots[0].ammo).toBeLessThan(6);
    app.field.respawn();
    expect(app.field.player.weapons.slots[0].ammo).toBe(6);
    expect(app.field.projectiles.liveCount).toBe(0);
  });

  it('a bare chassis still has its built-in vulcan', () => {
    app.setMode('edit');
    app.loadPreset('biped');
    app.setMode('field');
    app.field.respawn();
    const lock = lockOn();
    const hp = lock.robot.hp;
    app.input.keys.add('Mouse0');
    step(60);
    app.input.keys.clear();
    expect(app.field.player.weapons.hasWeapons).toBe(false);
    expect(lock.robot.hp).toBeLessThan(hp);
  });

  it('a gravity plate keeps the machine on the deck', () => {
    const p = deploy(EQUIP.GRAVITY);
    expect(p.body.noFly).toBe(true);
    const y0 = p.position.y;
    app.input.keys.add('Space');
    step(180);
    app.input.keys.clear();
    expect(p.position.y - y0, 'it can hop, but it cannot fly').toBeLessThan(4);
  });

  it('and gives back durability for it', () => {
    const bare = deploy();
    const bareHp = bare.maxHp;
    const heavy = deploy(EQUIP.GRAVITY);
    expect(heavy.maxHp).toBeGreaterThan(bareHp * 1.3);
  });

  it('a boost plate makes the dash bite harder', () => {
    const bare = deploy();
    const bareDash = bare.body.dashSpeed;
    const boosted = deploy(EQUIP.BOOST, EQUIP.BOOST);
    expect(boosted.body.dashSpeed).toBeGreaterThan(bareDash);
  });

  it('without a boost plate, the boost key does nothing', () => {
    const p = deploy();
    expect(p.body.canBoost).toBe(false);
    app.input.keys.add('KeyW');
    app.input.keys.add('KeyE');
    step(150);
    app.input.keys.clear();
    expect(p.body.boosting).toBe(false);
    expect(p.body.boostOutput).toBe(0);
  });

  it('with one fitted, it burns and it is faster', () => {
    // PEAK speed, not the speed at the end: the arena has furniture in it, and
    // a machine that boosted harder is exactly the one that reaches a pillar.
    const topSpeed = (plated) => {
      const p = plated ? deploy(EQUIP.BOOST) : deploy();
      let peak = 0;
      app.input.keys.add('KeyW');
      app.input.keys.add('KeyE');
      for (let i = 0; i < 150; i++) {
        step(1);
        peak = Math.max(peak, p.body.speed);
      }
      app.input.keys.clear();
      return { peak, p };
    };
    const bare = topSpeed(false);
    const boosted = topSpeed(true);

    expect(boosted.p.body.canBoost).toBe(true);
    expect(boosted.p.body.boosting).toBe(true);
    expect(boosted.peak, 'and it genuinely moves faster').toBeGreaterThan(bare.peak + 2);
  });

  it('the flame comes out of the plate itself', () => {
    const p = deploy(EQUIP.BOOST);
    const node = p.rig.equipNodes.find((n) => n.part.equipType === EQUIP.BOOST);
    expect(node.boostFlare, 'the plate carries it').toBeTruthy();
    expect(node.boostFlare.group.visible, 'dark at rest').toBe(false);

    app.input.keys.add('KeyE');
    step(60);
    expect(p.body.boostOutput).toBeGreaterThan(0.8);
    expect(node.boostFlare.group.visible).toBe(true);
    expect(node.boostFlare.cone.material.opacity).toBeGreaterThan(0.2);
    expect(node.accent.material.emissiveIntensity, 'and the plate itself glows')
      .toBeGreaterThan(2);

    app.input.keys.clear();
    step(60);
    expect(node.boostFlare.group.visible, 'and goes out again').toBe(false);
  });

  it('every fitted plate fires, wherever it is stuck', () => {
    app.setMode('edit');
    app.loadPreset('biped');
    const a = app.assembly;
    const chest = [...a.parts.values()].find((x) => x.size?.[0] === 1.5);
    a.addEquipOnFace(chest.id, 5, EQUIP.BOOST);
    a.addEquipOnFace(chest.id, 3, EQUIP.BOOST);
    app.editor.rebuild();
    app.setMode('field');
    app.input.setEnabled(true);
    app.field.respawn();

    app.input.keys.add('KeyE');
    step(60);
    const flares = app.field.player.rig.equipNodes
      .filter((n) => n.boostFlare).map((n) => n.boostFlare.group.visible);
    app.input.keys.clear();
    expect(flares).toEqual([true, true]);
  });
});

describe('key config', () => {
  const kc = () => app.ui.keyConfig;
  const rowFor = (label) => [...kc().rowsEl.querySelectorAll('.keyrow')]
    .find((r) => r.querySelector('.keyaction').textContent === label);

  const press = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));

  it('opens from the topbar and lists every action', () => {
    app.setMode('edit');
    app.input.resetBindings();
    kc().show();
    expect(kc().el.classList.contains('hidden')).toBe(false);
    expect(kc().rowsEl.querySelectorAll('.keyrow').length).toBe(17);
    expect(rowFor('武器を撃つ')).toBeTruthy();
  });

  it('rebinds a key by clicking the chip and pressing one', () => {
    app.input.resetBindings();
    kc().show();
    rowFor('ブースト').querySelector('.keychiplabel').click();
    press('KeyH');
    expect(app.input.keysFor('boost')).toEqual(['KeyH']);
    expect(kc().noteEl.textContent).toContain('H');
  });

  it('a key can only do one job, and it says where it went', () => {
    app.input.resetBindings();
    kc().show();
    rowFor('ブースト').querySelector('.keyadd').click();
    press('KeyW');
    expect(app.input.keysFor('boost')).toContain('KeyW');
    expect(app.input.keysFor('forward'), 'taken off the old owner').not.toContain('KeyW');
    expect(kc().noteEl.textContent).toContain('前進');
  });

  it('says so when an action is left with nothing', () => {
    app.input.resetBindings();
    kc().show();
    rowFor('ブースト').querySelector('.keyadd').click();
    press('Space');                            // Space was the only lift key
    expect(app.input.keysFor('up')).toEqual([]);
    expect(kc().noteEl.textContent).toContain('未設定');
    expect(rowFor('上昇 / ジャンプ').classList.contains('unbound')).toBe(true);
    expect(rowFor('上昇 / ジャンプ').textContent).toContain('未設定');
  });

  it('Escape cancels a pending rebind rather than binding Escape', () => {
    app.input.resetBindings();
    kc().show();
    rowFor('ブースト').querySelector('.keychiplabel').click();
    press('Escape');
    expect(app.input.keysFor('boost')).toEqual(['KeyE']);
    expect(kc().listening).toBeNull();
  });

  it('refuses to swallow the browser keys', () => {
    app.input.resetBindings();
    kc().show();
    rowFor('ブースト').querySelector('.keychiplabel').click();
    press('F5');
    expect(app.input.keysFor('boost')).toEqual(['KeyE']);
    expect(kc().noteEl.textContent).toContain('割り当てられません');
    press('KeyH');                              // still listening, so this lands
    expect(app.input.keysFor('boost')).toEqual(['KeyH']);
  });

  it('drops a spare key, but never the last one', () => {
    app.input.resetBindings();
    kc().show();
    const row = () => rowFor('前進');
    expect(row().querySelectorAll('.keychipx')).toHaveLength(2);
    row().querySelector('.keychipx').click();
    expect(app.input.keysFor('forward')).toEqual(['ArrowUp']);
    expect(row().querySelectorAll('.keychipx'), 'the last chip loses its ×').toHaveLength(0);
  });

  it('the change is written through to storage, and reset clears it', () => {
    app.input.resetBindings();
    kc().show();
    rowFor('ブースト').querySelector('.keychiplabel').click();
    press('KeyH');
    expect(JSON.parse(localStorage.getItem('brostom.keys.v1'))).toEqual({ boost: ['KeyH'] });

    kc().reset();
    expect(JSON.parse(localStorage.getItem('brostom.keys.v1'))).toEqual({});
    expect(app.input.keysFor('boost')).toEqual(['KeyE']);
  });

  it('a rebound key really drives the machine', () => {
    app.input.resetBindings();
    app.input.setBinding('forward', ['KeyI']);
    kc().close();
    app.setMode('field');
    app.input.setEnabled(true);
    app.field.respawn();

    const before = app.field.player.position.clone();
    app.input.keys.add('KeyW');
    step(40);
    app.input.keys.clear();
    expect(app.field.player.position.distanceTo(before), 'W is dead now').toBeLessThan(1);

    app.input.keys.add('KeyI');
    step(40);
    app.input.keys.clear();
    expect(app.field.player.position.distanceTo(before)).toBeGreaterThan(1);

    app.input.resetBindings();
    app.setMode('edit');
  });

  it('the field control strip follows the bindings', () => {
    app.input.resetBindings();
    app.ui.syncFieldHint();
    expect(app.ui.fieldWeaponHint.textContent).toContain('左クリック');
    expect(app.ui.fieldWeaponHint.textContent).toContain('武器を撃つ');
    expect(app.ui.fieldWeaponHint.textContent).toContain('武器切替');

    app.input.setBinding('fire', ['KeyJ']);
    app.ui.syncFieldHint();
    expect(app.ui.fieldWeaponHint.textContent).toContain('J');
    app.input.resetBindings();
    app.ui.syncFieldHint();
  });
});

describe('switching weapons', () => {
  const deploy = (...types) => {
    app.setMode('edit');
    app.loadPreset('biped');
    const a = app.assembly;
    const chest = [...a.parts.values()].find((p) => p.size?.[0] === 1.5);
    for (const t of types) a.addEquipOnFace(chest.id, 4, t);
    app.editor.rebuild();
    app.setMode('field');
    app.input.setEnabled(true);
    app.field.respawn();
    return app.field.player;
  };

  const tap = (code) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    step(1);
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  };

  it('the switch key cycles the set and names what came up', () => {
    const p = deploy(EQUIP.BEAM, EQUIP.GATLING, EQUIP.SHOT);
    expect(p.weapons.active.type).toBe(EQUIP.BEAM);

    tap('KeyC');
    expect(p.weapons.active.type).toBe(EQUIP.GATLING);
    expect(app.field.hud.weaponFlashLabel).toBe('ガトリング');
    expect(app.field.hud.weaponFlash).toBeGreaterThan(0);

    tap('KeyX');
    expect(p.weapons.active.type).toBe(EQUIP.BEAM);
  });

  it('only the selected plate spends ammo', () => {
    const p = deploy(EQUIP.BEAM, EQUIP.GATLING);
    p.weapons.select(1);
    forceLock();
    app.input.keys.add('Mouse0');
    step(30);
    app.input.keys.clear();
    expect(p.weapons.slots[0].ammo, 'the beam sat it out').toBe(6);
    expect(p.weapons.slots[1].ammo).toBeLessThan(30);
  });

  it('a rebound switch key works too', () => {
    const p = deploy(EQUIP.BEAM, EQUIP.GATLING);
    app.input.setBinding('weaponNext', ['KeyN']);
    tap('KeyN');
    expect(p.weapons.active.type).toBe(EQUIP.GATLING);
    app.input.resetBindings();
  });

  it('one plate means nothing to switch to', () => {
    const p = deploy(EQUIP.BEAM);
    tap('KeyC');
    expect(p.weapons.active.type).toBe(EQUIP.BEAM);
  });
});

describe('field camera', () => {
  const rig = () => app.field.cameraRig;
  const boom = () => rig().position.clone().sub(app.field.player.position);

  const enterField = () => {
    app.setMode('edit');
    app.loadPreset('biped');
    app.setMode('field');
    app.input.setEnabled(true);
    // Pointer lock cannot be granted to a headless test, so say it happened.
    app.input.pointerLocked = true;
    app.field.respawn();
    rig().recenter();
    rig().zoom = 1;
    step(40);
  };

  const drag = (dx, dy, frames = 20) => {
    for (let i = 0; i < frames; i++) {
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy, bubbles: true }));
      step(1);
    }
  };

  const wheel = (deltaY, notches) => {
    for (let i = 0; i < notches; i++) {
      window.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true }));
      step(1);
    }
  };

  it('sits behind the machine to start with', () => {
    enterField();
    const b = boom();
    expect(b.z, 'behind').toBeLessThan(-2);
    expect(b.y, 'and a little above').toBeGreaterThan(0);
  });

  it('right-drag swings the camera round without turning the machine', () => {
    enterField();
    const heading = app.field.player.body.forward.clone();
    const before = boom();

    window.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
    drag(-30, 0, 20);
    const swung = boom();
    window.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));

    expect(rig().orbit.yaw, 'the boom really swung').toBeGreaterThan(0.5);
    expect(Math.abs(swung.x), 'and moved round the side').toBeGreaterThan(Math.abs(before.x) + 2);
    expect(app.field.player.body.forward.dot(heading), 'machine kept its heading')
      .toBeGreaterThan(0.99);
  });

  it('the swing does not count as aim, so it cannot shake a lock', () => {
    enterField();
    expect(forceLock()).toBeTruthy();

    window.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
    drag(-40, 0, 25);
    window.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));
    expect(app.field.lock, 'still locked').toBeTruthy();
    expect(app.input.lookMagnitude).toBe(0);
  });

  it('dragging up lifts the camera over the machine', () => {
    enterField();
    const level = boom().y;
    window.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
    drag(0, -30, 20);
    window.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));
    step(20);
    expect(boom().y).toBeGreaterThan(level + 1);
  });

  it('the wheel zooms the boom out and back in', () => {
    enterField();
    const base = boom().length();

    wheel(100, 6);
    step(45);
    const far = boom().length();
    expect(rig().zoom).toBeGreaterThan(1.5);
    expect(far).toBeGreaterThan(base + 2);

    wheel(-100, 12);
    step(45);
    expect(rig().zoom).toBeLessThan(1);
    expect(boom().length()).toBeLessThan(base);
  });

  it('zoom stops at both ends rather than turning inside out', () => {
    enterField();
    wheel(-100, 60);
    expect(rig().zoom).toBe(rig().config.zoomMin);
    expect(boom().length()).toBeGreaterThan(0.5);
    wheel(100, 120);
    expect(rig().zoom).toBe(rig().config.zoomMax);
  });

  it('a respawn recentres the swing but keeps the zoom', () => {
    enterField();
    rig().orbitBy(1.5, 0.4);
    rig().zoom = 1.8;
    app.field.respawn();
    expect(rig().orbit.yaw).toBe(0);
    expect(rig().orbit.pitch).toBe(0);
    expect(rig().zoom, 'zoom is a preference, not a state').toBe(1.8);
  });

  it('the boom eases back behind the machine once it is travelling', () => {
    enterField();
    rig().orbitBy(1.6, 0);
    step(90);
    expect(rig().orbit.yaw, 'parked, it holds').toBeGreaterThan(1.4);

    app.input.keys.add('KeyW');
    step(150);
    app.input.keys.clear();
    expect(rig().orbit.yaw, 'under way, it comes back').toBeLessThan(0.6);
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

describe('undo and redo', () => {
  const place = (dx) => {
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(0, 5, 12));
    pointAt(core.clone().add(new THREE.Vector3(dx, 0, 0)), { click: true });
  };

  it('starts with nothing to undo', () => {
    app.loadPreset('core');
    expect(app.history.canUndo).toBe(false);
    expect(app.undo()).toBe(false);
    expect(app.ui.undoBtn.disabled).toBe(true);
  });

  it('takes back a placement and puts it back again', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BLOCK);
    app.editor.newBlockSize = [1, 1, 1];
    place(2.5);
    expect(app.assembly.size).toBe(2);

    expect(app.undo()).toBe(true);
    expect(app.assembly.size).toBe(1);
    expect(app.editor.rig.nodes.size, 'the rig follows the document').toBe(1);

    expect(app.redo()).toBe(true);
    expect(app.assembly.size).toBe(2);
    expect(app.editor.rig.nodes.size).toBe(2);
  });

  it('brings a deleted subtree back whole, ids and all', () => {
    app.loadPreset('biped');
    const arm = [...app.assembly.parts.values()].find((p) => p.boneType === 'arm');
    const under = app.assembly.subtree(arm.id).length;
    const before = app.assembly.size;

    app.editor.select(arm.id);
    app.editor.deleteSelected();
    expect(app.assembly.size).toBe(before - under);

    app.undo();
    expect(app.assembly.size).toBe(before);
    expect(app.assembly.get(arm.id).boneType).toBe('arm');
  });

  it('reverses sculpting one stroke at a time', () => {
    app.loadPreset('core');
    app.editor.select(app.assembly.rootId);
    app.setTool(TOOL.CARVE);
    const solid = app.assembly.core.vox.solid;
    strokeAt(8, 8, 8);
    const carved = app.assembly.core.vox.solid;
    expect(carved).toBeLessThan(solid);

    app.undo();
    expect(app.assembly.core.vox.solid).toBe(solid);
    app.redo();
    expect(app.assembly.core.vox.solid).toBe(carved);
    app.setTool(TOOL.SELECT);
  });

  it('reverses a resize', () => {
    app.loadPreset('core');
    app.editor.select(app.assembly.rootId);
    app.editor.resizeSelected([2, 2, 2]);
    expect(app.assembly.core.size).toEqual([2, 2, 2]);
    app.undo();
    expect(app.assembly.core.size).toEqual([1, 1, 1]);
  });

  it('a fresh change abandons the redo branch', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BLOCK);
    place(2.5);
    app.undo();
    expect(app.history.canRedo).toBe(true);
    place(-2.5);
    expect(app.history.canRedo).toBe(false);
    expect(app.ui.redoBtn.disabled).toBe(true);
    app.setTool(TOOL.SELECT);
  });

  it('says what it would undo', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BLOCK);
    place(2.5);
    expect(app.history.undoLabel).toBe('配置');
    expect(app.ui.undoBtn.disabled).toBe(false);
    expect(app.ui.undoBtn.title).toContain('配置');
    app.setTool(TOOL.SELECT);
  });

  it('Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z are wired to the keyboard', () => {
    app.loadPreset('core');
    app.setMode('edit');
    app.setTool(TOOL.BLOCK);
    place(2.5);
    const key = (code, mods = {}) => window.dispatchEvent(
      new KeyboardEvent('keydown', { code, ctrlKey: true, bubbles: true, ...mods }));

    key('KeyZ');
    expect(app.assembly.size).toBe(1);
    key('KeyY');
    expect(app.assembly.size).toBe(2);
    key('KeyZ');
    expect(app.assembly.size).toBe(1);
    key('KeyZ', { shiftKey: true });
    expect(app.assembly.size).toBe(2);
    app.setTool(TOOL.SELECT);
  });

  it('leaves the field alone', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BLOCK);
    place(2.5);
    app.setTool(TOOL.SELECT);
    app.setMode('field');
    expect(app.undo()).toBe(false);
    expect(app.assembly.size).toBe(2);
    app.setMode('edit');
    expect(app.undo()).toBe(true);
  });

  it('keeps the machine and the workbench on separate stacks', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BLOCK);
    place(2.5);
    app.setTool(TOOL.SELECT);
    expect(app.history.canUndo).toBe(true);

    app.newPart();
    app.openPartEditor();
    expect(app.history.canUndo, 'the workbench starts clean').toBe(false);

    app.setMode('edit');
    expect(app.history.canUndo, 'the machine kept its own stack').toBe(true);
    expect(app.history.undoLabel).toBe('配置');
  });
});

describe('clipboard', () => {
  it('copies a subtree and pastes it beside the original', () => {
    app.loadPreset('biped');
    app.setMode('edit');
    const arm = [...app.assembly.parts.values()].find((p) => p.boneType === 'arm');
    const under = app.assembly.subtree(arm.id).length;
    const before = app.assembly.size;

    app.editor.select(arm.id);
    expect(app.copySelected()).toBe(1);
    expect(app.pasteClipboard()).toBe(1);

    expect(app.assembly.size).toBe(before + under);
    const made = app.assembly.get(app.editor.selected);
    expect(made.boneType).toBe('arm');
    expect(made.id).not.toBe(arm.id);
    expect(made.mount.pos[0], 'nudged clear of its source')
      .toBeGreaterThan(arm.mount.pos[0]);
  });

  it('pastes several parts at once', () => {
    app.loadPreset('bits');
    const bits = [...app.assembly.parts.values()].filter((p) => p.mount).slice(0, 3);
    const before = app.assembly.size;
    app.editor.select(bits.map((p) => p.id));
    expect(app.copySelected()).toBe(3);
    expect(app.pasteClipboard()).toBe(3);
    expect(app.assembly.size).toBeGreaterThan(before + 2);
    expect(app.editor.selection.size, 'the copies end up selected').toBe(3);
  });

  it('cut removes the original but keeps it on the clipboard', () => {
    app.loadPreset('biped');
    const arm = [...app.assembly.parts.values()].find((p) => p.boneType === 'arm');
    app.editor.select(arm.id);
    app.copySelected({ cut: true });
    expect(app.assembly.get(arm.id)).toBe(undefined);
    expect(app.pasteClipboard()).toBe(1);
    expect([...app.assembly.parts.values()].filter((p) => p.boneType === 'arm'))
      .toHaveLength(2);
  });

  it('a paste can be undone in one step', () => {
    app.loadPreset('bits');
    const bits = [...app.assembly.parts.values()].filter((p) => p.mount).slice(0, 2);
    const before = app.assembly.size;
    app.editor.select(bits.map((p) => p.id));
    app.copySelected();
    app.pasteClipboard();
    expect(app.assembly.size).toBe(before + 2);
    app.undo();
    expect(app.assembly.size).toBe(before);
  });

  it('copying nothing does nothing', () => {
    app.loadPreset('core');
    app.editor.clearSelection();
    expect(app.copySelected()).toBe(0);
    app.clipboard = [];
    expect(app.pasteClipboard()).toBe(0);
  });

  it('copies the core as a plain block rather than a second core', () => {
    app.loadPreset('core');
    app.editor.select(app.assembly.rootId);
    app.copySelected();
    app.pasteClipboard();
    expect(app.assembly.size).toBe(2);
    expect([...app.assembly.parts.values()].filter((p) => p.kind === 'core'))
      .toHaveLength(1);
  });

  it('Ctrl+C, Ctrl+X and Ctrl+V are wired to the keyboard', () => {
    app.loadPreset('biped');
    app.setMode('edit');
    const key = (code) => window.dispatchEvent(
      new KeyboardEvent('keydown', { code, ctrlKey: true, bubbles: true }));

    const arm = [...app.assembly.parts.values()].find((p) => p.boneType === 'arm');
    const before = app.assembly.size;
    app.editor.select(arm.id);
    key('KeyC');
    expect(app.clipboard).toHaveLength(1);
    key('KeyV');
    expect(app.assembly.size).toBeGreaterThan(before);

    app.editor.select(arm.id);
    key('KeyX');
    expect(app.assembly.get(arm.id)).toBe(undefined);
  });

  it('carries the colours of what was copied', () => {
    app.loadPreset('core');
    app.setTool(TOOL.BLOCK);
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(0, 5, 12));
    pointAt(core.clone().add(new THREE.Vector3(2.5, 0, 0)), { click: true });
    app.setTool(TOOL.SELECT);
    const blockId = app.editor.selected;

    app.setCustomColor(0x8844ff);
    app.editor.select(blockId);
    app.repaintSelected();
    const used = [...app.assembly.get(blockId).vox.usedColors()];
    expect(app.assembly.palette.get(used[0])).toBe(0x8844ff);

    app.editor.select(blockId);
    app.copySelected();
    app.pasteClipboard();
    const copy = app.assembly.get(app.editor.selected);
    expect(app.assembly.palette.get([...copy.vox.usedColors()][0])).toBe(0x8844ff);
  });
});

describe('part workbench', () => {
  it('opens on a document rooted at a plain block', () => {
    app.newPart();
    app.openPartEditor();
    expect(app.mode).toBe('part');
    expect(app.editing).toBe('part');
    expect(app.assembly.isPart).toBe(true);
    expect(app.assembly.core.kind).toBe('block');
    expect(app.assembly.size).toBe(1);
    app.setMode('edit');
  });

  it('shows the workbench bar and hides the machine topbar', () => {
    app.openPartEditor();
    expect(app.ui.partBar.classList.contains('hidden')).toBe(false);
    expect(app.ui.topbar.classList.contains('hidden')).toBe(true);
    expect(app.ui.librarySection.classList.contains('hidden'),
      'no shelf while you are standing on it').toBe(true);
    app.setMode('edit');
    expect(app.ui.partBar.classList.contains('hidden')).toBe(true);
    expect(app.ui.topbar.classList.contains('hidden')).toBe(false);
    expect(app.ui.librarySection.classList.contains('hidden')).toBe(false);
  });

  it('edits the part without touching the machine', () => {
    app.loadPreset('biped');
    const machine = app.mainAssembly.size;
    app.newPart();
    app.openPartEditor();

    app.setTool(TOOL.BLOCK);
    const root = worldOf(app.assembly.rootId);
    aimCamera(root, new THREE.Vector3(0, 5, 12));
    pointAt(root.clone().add(new THREE.Vector3(2.5, 0, 0)), { click: true });
    app.setTool(TOOL.SELECT);
    expect(app.partAssembly.size).toBe(2);
    expect(app.mainAssembly.size, 'the machine is untouched').toBe(machine);

    app.undo();
    expect(app.partAssembly.size).toBe(1);
    app.setMode('edit');
    expect(app.assembly.size).toBe(machine);
  });

  it('sculpts on the workbench too', () => {
    app.newPart();
    app.openPartEditor();
    app.editor.select(app.assembly.rootId);
    const solid = app.assembly.core.vox.solid;
    app.setTool(TOOL.CARVE);
    strokeAt(4, 4, 4);
    expect(app.assembly.core.vox.solid).toBeLessThan(solid);
    app.undo();
    expect(app.assembly.core.vox.solid).toBe(solid);
    app.setTool(TOOL.SELECT);
    app.setMode('edit');
  });

  it('cannot delete the part root', () => {
    app.newPart();
    app.openPartEditor();
    app.editor.select(app.assembly.rootId);
    expect(app.editor.deleteSelected()).toBe(false);
    app.setMode('edit');
  });

  it('only one editor drives the canvas at a time', () => {
    app.setMode('edit');
    expect(app.mainEditor.controls.enabled).toBe(true);
    expect(app.partEditor.controls.enabled).toBe(false);
    app.openPartEditor();
    expect(app.mainEditor.controls.enabled).toBe(false);
    expect(app.partEditor.controls.enabled).toBe(true);
    app.setMode('edit');
  });
});

describe('part library', () => {
  const clearShelf = () => { app.library.clear(); app.ui.renderLibrary(); };

  const buildPart = (name) => {
    app.newPart();
    app.openPartEditor();
    app.partAssembly.addBlockOnFace(app.partAssembly.rootId, 2, 5, { size: [0.5, 0.5, 0.5] });
    app.partEditor.rebuild();
    const entry = app.savePart(name);
    app.setMode('edit');
    return entry;
  };

  it('saves the open part onto the shelf', () => {
    clearShelf();
    const entry = buildPart('POD');
    expect(entry.name).toBe('POD');
    expect(app.library.size).toBe(1);
    expect(app.ui.libraryEl.querySelectorAll('.libitem')).toHaveLength(1);
    expect(app.ui.libraryEl.textContent).toContain('POD');
  });

  it('the shelf is written through to storage', () => {
    clearShelf();
    buildPart('POD');
    const raw = localStorage.getItem('brostom.parts.v1');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw).items).toHaveLength(1);
  });

  it('re-opening a saved part gives an independent copy', () => {
    clearShelf();
    const entry = buildPart('POD');
    app.openPartEditor(entry.id);
    expect(app.assembly.size).toBe(2);
    expect(app.assembly.name).toBe('POD');
    app.editor.select(app.assembly.core.children[0]);
    app.editor.deleteSelected();
    expect(app.assembly.size).toBe(1);
    app.setMode('edit');
    expect(app.library.open(entry.id).size, 'the shelf copy is untouched').toBe(2);
  });

  it('placing a part arms the stamp instead of dropping it blind', () => {
    clearShelf();
    const entry = buildPart('POD');
    app.loadPreset('core');
    app.placePart(entry.id);
    expect(app.mode).toBe('edit');
    expect(app.editor.tool).toBe(TOOL.STAMP);
    expect(app.editor.stampSource).toBeTruthy();
    expect(app.assembly.size, 'nothing placed until you click').toBe(1);
    app.setTool(TOOL.SELECT);
  });

  it('a stamp click grafts the whole part into the machine', () => {
    clearShelf();
    const entry = buildPart('POD');
    app.loadPreset('core');
    app.placePart(entry.id);

    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(0, 5, 12));
    pointAt(core.clone().add(new THREE.Vector3(3, 0, 0)), { click: true });

    expect(app.assembly.size).toBe(3);            // the part root plus its child
    const root = app.assembly.get(app.editor.selected);
    expect(root.kind).toBe('block');
    expect(root.children).toHaveLength(1);
    expect(app.editor.rig.nodes.size).toBe(3);

    app.undo();
    expect(app.assembly.size).toBe(1);
    app.setTool(TOOL.SELECT);
  });

  it('the same part can be stamped twice with no id collision', () => {
    clearShelf();
    const entry = buildPart('POD');
    app.loadPreset('core');
    app.placePart(entry.id);
    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(0, 5, 12));
    pointAt(core.clone().add(new THREE.Vector3(3, 0, 0)), { click: true });
    pointAt(core.clone().add(new THREE.Vector3(-3, 0, 0)), { click: true });

    expect(app.assembly.size).toBe(5);
    const ids = [...app.assembly.parts.keys()];
    expect(new Set(ids).size).toBe(ids.length);
    app.setTool(TOOL.SELECT);
  });

  it('registers a machine selection as a reusable part', () => {
    clearShelf();
    app.loadPreset('biped');
    const arm = [...app.assembly.parts.values()].find((p) => p.boneType === 'arm');
    const under = app.assembly.subtree(arm.id).length;
    app.editor.select(arm.id);

    const entry = app.saveSelectionAsPart();
    expect(entry).toBeTruthy();
    expect(app.library.size).toBe(1);
    const doc = app.library.open(entry.id);
    expect(doc.size).toBe(under);
    expect(doc.core.mount, 'the shelf copy stands alone').toBeNull();
  });

  it('registering with nothing selected is refused', () => {
    clearShelf();
    app.loadPreset('core');
    app.editor.clearSelection();
    expect(app.saveSelectionAsPart()).toBeNull();
    expect(app.library.size).toBe(0);
  });

  it('renames and deletes shelf entries', () => {
    clearShelf();
    const entry = buildPart('POD');
    app.renamePart(entry.id, 'SHIELD');
    expect(app.library.list()[0].name).toBe('SHIELD');
    expect(app.ui.libraryEl.textContent).toContain('SHIELD');

    app.deletePart(entry.id);
    expect(app.library.size).toBe(0);
    expect(app.ui.libraryEl.querySelectorAll('.libitem')).toHaveLength(0);
  });

  it('deleting the armed part disarms the stamp', () => {
    clearShelf();
    const entry = buildPart('POD');
    app.loadPreset('core');
    app.placePart(entry.id);
    app.deletePart(entry.id);
    expect(app.editor.stampSource).toBeNull();

    const core = worldOf(app.assembly.rootId);
    aimCamera(core, new THREE.Vector3(0, 5, 12));
    pointAt(core.clone().add(new THREE.Vector3(3, 0, 0)), { click: true });
    expect(app.assembly.size, 'a disarmed stamp places nothing').toBe(1);
    app.setTool(TOOL.SELECT);
  });

  it('an empty shelf still offers the register button', () => {
    clearShelf();
    expect(app.ui.libraryEl.textContent).toContain('選択パーツを登録');
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
