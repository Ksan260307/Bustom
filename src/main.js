import * as THREE from 'three';
import { Assembly, PRESETS, computeStats } from './core/Assembly.js';
import { createVoxels, bevel, paintBrush } from './core/Voxel.js';
import { VOX } from './core/constants.js';
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
  KeyB: TOOL.BLOCK,
  KeyL: TOOL.BONE_LEG,
  KeyA: TOOL.BONE_ARM,
  KeyF: TOOL.BONE_FACE,
  KeyC: TOOL.BONE_CUSTOM,
  KeyV: TOOL.SELECT,
  KeyX: TOOL.CARVE,
  KeyZ: TOOL.ADD,
  KeyP: TOOL.PAINT,
};

class App {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.hudCanvas = document.getElementById('hud');
    this.overlay = document.getElementById('overlay');

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
    this.editor.onSelect = (part) => this.ui?.renderInspector(part);
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
    window.addEventListener('resize', () => this.resize());
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
    localStorage.setItem(SAVE_KEY, JSON.stringify(this.assembly.toJSON()));
    this.ui.toastMsg(`「${this.assembly.name}」を保存しました`);
  }

  load() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { this.ui.toastMsg('保存データがありません'); return; }
    this._adopt(Assembly.fromJSON(JSON.parse(raw)));
    this.ui.toastMsg('読み込みました');
  }

  exportJson() {
    const blob = new Blob([JSON.stringify(this.assembly.toJSON(), null, 1)], { type: 'application/json' });
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
        const data = JSON.parse(await file.text());
        this._adopt(Assembly.fromJSON(data));
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
    this.ui.renderStats(this.editor.stats);
  }

  // ---------------------------------------------------------- editor ops

  setTool(tool) {
    this.editor.setTool(tool);
    this.ui.syncTool(tool);
  }

  setColor(i) {
    this.editor.colorIndex = i;
    this.ui.syncColor(i);
  }

  applyBoneOptionToSelection(key, value) {
    const part = this.editor.selected ? this.assembly.get(this.editor.selected) : null;
    if (!part || part.kind !== 'bone') return;
    part[key] = value;
    if (key === 'length' || key === 'gauge') this.editor.rebuild();
  }

  _selectedBlock() {
    const part = this.editor.selected ? this.assembly.get(this.editor.selected) : null;
    return part && part.kind !== 'bone' ? part : null;
  }

  fillSelected() {
    const part = this._selectedBlock();
    if (!part) return;
    part.vox.set(createVoxels(this.editor.colorIndex));
    this._afterVoxelEdit(part);
  }

  bevelSelected() {
    const part = this._selectedBlock();
    if (!part) return;
    bevel(part.vox, 2);
    this._afterVoxelEdit(part);
  }

  repaintSelected() {
    const part = this._selectedBlock();
    if (!part) return;
    paintBrush(part.vox, VOX / 2, VOX / 2, VOX / 2, VOX * 2, this.editor.colorIndex);
    this._afterVoxelEdit(part);
  }

  _afterVoxelEdit(part) {
    this.editor.rig.refreshBlock(part.id);
    this.editor.stats = computeStats(this.assembly, this.editor.rig);
    this.ui.renderStats(this.editor.stats);
    this.ui.renderInspector(part);
  }

  // ---------------------------------------------------------- modes

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;

    if (mode === 'edit') {
      this.field.exit();
      this.editor.enter();
      this.hudCanvas.classList.add('hidden');
      this.ui.setPointerHint(false);
    } else {
      this.editor.exit();
      this.hudCanvas.classList.remove('hidden');
      this.feedback.init();
      this.field.load(this.assembly);
      this.field.enter();
      this.ui.setPointerHint(true);
    }
    this.ui.syncMode(mode);
    this.resize();
  }

  capturePointer() {
    this.input.requestPointerLock();
    this.feedback.init();
    this.feedback.resume();
    this.ui.setPointerHint(false);
  }

  // ---------------------------------------------------------- input

  _bindGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;

      if (e.code === 'Escape') {
        if (this.mode === 'field') this.ui.setPointerHint(true);
        return;
      }
      if (e.code === 'F5' || e.metaKey || e.ctrlKey) return;

      if (this.mode === 'edit') {
        const tool = TOOL_KEYS[e.code];
        if (tool) { e.preventDefault(); this.setTool(tool); }
        if (e.code === 'Enter') { e.preventDefault(); this.setMode('field'); }
        if (e.code === 'KeyS' && e.shiftKey) { e.preventDefault(); this.save(); }
      }
    });

    document.addEventListener('pointerlockchange', () => {
      if (this.mode === 'field') this.ui.setPointerHint(!document.pointerLockElement);
    });
  }

  // ---------------------------------------------------------- frame

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
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
}

window.addEventListener('DOMContentLoaded', () => {
  window.__brostom = new App();
});
