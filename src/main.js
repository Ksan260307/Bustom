import * as THREE from 'three';
import { Assembly, PRESETS } from './core/Assembly.js';
import { EditorScene, TOOL } from './editor/EditorScene.js';
import { FieldScene } from './game/FieldScene.js';
import { EditorUI } from './ui/EditorUI.js';
import { InputManager } from './zmf/InputManager.js';
import { KineticFeedback } from './zmf/KineticFeedback.js';

// ============================================================
//  BroStom — application shell.
//  Two modes over one renderer: the editor, and the debug field.
// ============================================================

const SAVE_KEY = 'brostom.assembly.v1';

const TOOL_KEYS = {
  KeyV: TOOL.SELECT,
  KeyB: TOOL.BLOCK,
  KeyL: TOOL.BONE_LEG,
  KeyA: TOOL.BONE_ARM,
  KeyF: TOOL.BONE_FACE,
  KeyC: TOOL.BONE_CUSTOM,
  KeyX: TOOL.CARVE,
  KeyZ: TOOL.ADD,
  KeyP: TOOL.PAINT,
};

export class App {
  constructor({ canvas, hudCanvas, overlay } = {}) {
    this.canvas = canvas ?? document.getElementById('gl');
    this.hudCanvas = hudCanvas ?? document.getElementById('hud');
    this.overlay = overlay ?? document.getElementById('overlay');

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;

    this.input = new InputManager(this.canvas);
    this.feedback = new KineticFeedback();

    this.assembly = this._loadInitial();

    this.editor = new EditorScene({ renderer: this.renderer, canvas: this.canvas });
    this.editor.onChange = (stats) => this.ui?.renderStats(stats);
    this.editor.onSelect = (parts) => this.ui?.renderInspector(parts);
    this.editor.setAssembly(this.assembly);

    this.field = new FieldScene({
      renderer: this.renderer,
      hudCanvas: this.hudCanvas,
      input: this.input,
      feedback: this.feedback,
    });

    this.ui = new EditorUI(this.overlay, this);
    this.ui.renderStats(this.editor.stats);
    this.ui.renderInspector(null);

    this.mode = null;
    this.setMode('edit');

    this._bindGlobalKeys();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------- state

  _loadInitial() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) return Assembly.fromJSON(JSON.parse(raw));
    } catch (e) {
      console.warn('saved build could not be read, falling back to a preset', e);
    }
    return PRESETS.biped.build();
  }

  save() {
    this.assembly.prunePalette();
    localStorage.setItem(SAVE_KEY, JSON.stringify(this.assembly.toJSON()));
    this.ui.renderPalette();
    this.ui.toastMsg(`「${this.assembly.name}」を保存しました`);
  }

  load() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { this.ui.toastMsg('保存データがありません'); return; }
    this._adopt(Assembly.fromJSON(JSON.parse(raw)));
    this.ui.toastMsg('読み込みました');
  }

  exportJson() {
    const blob = new Blob([JSON.stringify(this.assembly.toJSON())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.assembly.name.replace(/\s+/g, '_') || 'robo'}.brostom.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  importJson() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;
      try {
        this._adopt(Assembly.fromJSON(JSON.parse(await file.text())));
        this.ui.toastMsg(`${file.name} を読み込みました`);
      } catch (e) {
        this.ui.toastMsg('読み込みに失敗しました');
        console.error(e);
      }
    };
    inp.click();
  }

  loadPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    this._adopt(p.build());
    this.ui.toastMsg(`${p.label} を読み込みました`);
  }

  _adopt(assembly) {
    this.assembly = assembly;
    this.editor.setAssembly(assembly);
    this.ui.syncName(assembly.name);
    this.ui.syncResolution(assembly.voxRes);
    this.ui.renderPalette();
    this.ui.renderStats(this.editor.stats);
  }

  // ---------------------------------------------------------- editor ops

  setTool(tool) {
    this.editor.setTool(tool);
    this.ui.syncTool(tool);
  }

  setGizmoMode(mode) {
    this.editor.setGizmoMode(mode);
    this.ui.syncGizmoMode(this.editor.gizmoMode);
  }

  setColor(i) {
    this.editor.colorIndex = i;
    this.ui.syncColor(i);
  }

  /** Called continuously while the colour wheel is dragged. */
  setCustomColor(hex) {
    const idx = this.assembly.palette.ensure(hex);
    if (idx < 0) { this.ui.toastMsg('カラーが上限に達しました'); return; }
    this.editor.colorIndex = idx;
    this.ui.renderPalette();
  }

  setVoxResolution(n) {
    if (!this.assembly.setVoxResolution(n)) return;
    this.editor.rebuild();
    this.ui.syncResolution(n);
    this.ui.renderInspector(this.editor.selectedParts());
    this.ui.toastMsg(`加工の細かさを 1/${n} にしました`);
  }

  applyBoneOptionToSelection(key, value) {
    const part = this.editor.selected ? this.assembly.get(this.editor.selected) : null;
    if (!part || part.kind !== 'bone') return;
    if (key === 'length' || key === 'radius') this.editor.setBoneShapeSelected({ [key]: value });
    else part[key] = value;
  }

  uniformSize(v) {
    if (!this.editor.selected) return;
    const part = this.assembly.get(this.editor.selected);
    if (!part || part.kind === 'bone') return;
    this.editor.resizeSelected([v, v, v]);
    this.ui.renderInspector(this.editor.selectedParts());
  }

  _selectedBlock() {
    const part = this.editor.selected ? this.assembly.get(this.editor.selected) : null;
    return part && part.kind !== 'bone' ? part : null;
  }

  fillSelected() {
    const part = this._selectedBlock();
    if (!part) return;
    part.vox.fill(this.editor.colorIndex);
    this._afterVoxelEdit(part);
  }

  bevelSelected() {
    const part = this._selectedBlock();
    if (!part) return;
    part.vox.bevel(0.22);
    this._afterVoxelEdit(part);
  }

  repaintSelected() {
    const part = this._selectedBlock();
    if (!part) return;
    part.vox.repaint(this.editor.colorIndex);
    this._afterVoxelEdit(part);
  }

  _afterVoxelEdit(part) {
    this.editor.rig.refreshBlock(part.id);
    this.editor.refreshStats();
    this.ui.renderInspector(this.editor.selectedParts());
  }

  // ---------------------------------------------------------- modes

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;

    if (mode === 'edit') {
      this.field.exit();
      this.editor.enter();
      this.hudCanvas.classList.add('hidden');
    } else {
      this.editor.exit();
      this.hudCanvas.classList.remove('hidden');
      this.field.load(this.assembly);
      this.field.enter();
      // Straight into the action — the pause menu is for Esc, not for entry.
      this.resumeField();
    }
    this.ui.syncMode(mode);
    this.resize();
  }

  pauseField() {
    if (this.mode !== 'field') return;
    this.field.setPaused(true);
    this.input.exitPointerLock();
    this.feedback.suspend();
    this.ui.setPaused(true);
  }

  resumeField() {
    if (this.mode !== 'field') return;
    this.field.setPaused(false);
    this.ui.setPaused(false);
    this.input.requestPointerLock();
    this.feedback.init();
    this.feedback.resume();
  }

  restartField() {
    if (this.mode !== 'field') return;
    this.field.respawn();
    this.resumeField();
  }

  // ---------------------------------------------------------- input

  _bindGlobalKeys() {
    this._onKey = (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;

      if (e.code === 'Escape') {
        if (this.mode === 'field') {
          if (this.field.paused) this.resumeField();
          else this.pauseField();
        } else {
          this.editor.clearSelection();
        }
        return;
      }

      // Ctrl shortcuts, before the plain-key tool bindings swallow the letter.
      if (e.ctrlKey || e.metaKey) {
        if (this.mode !== 'edit') return;
        if (e.code === 'KeyA') { e.preventDefault(); this.editor.selectAll(); }
        if (e.code === 'KeyD') { e.preventDefault(); this.editor.duplicateSelected(); }
        return;
      }
      if (e.code === 'F5') return;

      if (this.mode === 'edit') {
        const tool = TOOL_KEYS[e.code];
        if (tool) { e.preventDefault(); this.setTool(tool); }
        if (e.code === 'KeyT') { e.preventDefault(); this.setGizmoMode('translate'); }
        if (e.code === 'KeyR') { e.preventDefault(); this.setGizmoMode('rotate'); }
        if (e.code === 'Enter') { e.preventDefault(); this.setMode('field'); }
        if (e.code === 'KeyS' && e.shiftKey) { e.preventDefault(); this.save(); }
      }
    };
    window.addEventListener('keydown', this._onKey);

    // Losing the pointer lock in any other way should also stop the action.
    this._onLock = () => {
      if (this.mode === 'field' && !document.pointerLockElement && !this.field.paused) {
        this.pauseField();
      }
    };
    document.addEventListener('pointerlockchange', this._onLock);
  }

  // ---------------------------------------------------------- frame

  resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.editor.resize(w, h);
    this.field.resize(w, h);
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);

    if (this.mode === 'edit') {
      this.editor.update(dt);
      this.editor.render();
    } else {
      this.input.update(dt);
      this.field.update(dt);
      this.field.render();
      this.input.endFrame();
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onKey);
    document.removeEventListener('pointerlockchange', this._onLock);
    this.editor.dispose();
    this.input.dispose();
    this.renderer.dispose();
  }
}

if (typeof window !== 'undefined' && !window.__BROSTOM_NO_AUTOBOOT) {
  window.addEventListener('DOMContentLoaded', () => {
    window.__brostom = new App();
  });
}
