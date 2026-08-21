import * as THREE from 'three';
import { Assembly, PRESETS } from './core/Assembly.js';
import { EditorScene, TOOL } from './editor/EditorScene.js';
import { History } from './editor/History.js';
import { PartLibrary } from './editor/PartLibrary.js';
import { FieldScene } from './game/FieldScene.js';
import { EditorUI } from './ui/EditorUI.js';
import { InputManager } from './zmf/InputManager.js';
import { KineticFeedback } from './zmf/KineticFeedback.js';

// ============================================================
//  BroStom — application shell.
//
//  Three modes over one renderer:
//    edit   the machine
//    part   one part on its own, saved to a reusable library
//    field  the debug arena
//
//  The two editing modes are the SAME EditorScene class over two documents,
//  each with its own undo stack. Everything the machine editor can do — free
//  placement, sculpting, colours, connections — works on a part too.
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

const EDIT_MODES = new Set(['edit', 'part']);

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
    this.library = new PartLibrary();
    this.clipboard = [];

    this.mode = 'edit';

    // ---- the machine document
    this.mainAssembly = this._loadInitial();
    this.mainEditor = this._makeEditor();
    this.mainHistory = new History();
    this.mainEditor.setAssembly(this.mainAssembly);

    // ---- the part document
    this.partAssembly = Assembly.createPart('NEW PART');
    this.partEditor = this._makeEditor();
    this.partHistory = new History();
    this.partEditor.setAssembly(this.partAssembly);
    this.partEditor.exit();
    /** Library entry the open part came from, for plain "save". */
    this.partSourceId = null;

    this.field = new FieldScene({
      renderer: this.renderer,
      hudCanvas: this.hudCanvas,
      input: this.input,
      feedback: this.feedback,
    });

    this.ui = new EditorUI(this.overlay, this);
    this.ui.renderStats(this.editor.stats);
    this.ui.renderInspector(null);
    this.ui.renderLibrary();
    this.ui.syncHistory();

    this.mode = null;
    this.setMode('edit');

    this._bindGlobalKeys();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  _makeEditor() {
    const ed = new EditorScene({ renderer: this.renderer, canvas: this.canvas });
    ed.onChange = (stats) => this.ui?.renderStats(stats);
    ed.onSelect = (parts) => this.ui?.renderInspector(parts);
    ed.onBeforeChange = (label) => this.pushHistory(label);
    return ed;
  }

  // ---------------------------------------------------------- active document

  /** In field mode the machine is still the document being referred to. */
  get editing() { return this.mode === 'part' ? 'part' : 'main'; }
  get editor() { return this.editing === 'part' ? this.partEditor : this.mainEditor; }
  get history() { return this.editing === 'part' ? this.partHistory : this.mainHistory; }
  get assembly() { return this.editing === 'part' ? this.partAssembly : this.mainAssembly; }

  set assembly(v) {
    if (this.editing === 'part') this.partAssembly = v;
    else this.mainAssembly = v;
  }

  // ---------------------------------------------------------- undo / redo

  _snapshot() { return JSON.stringify(this.assembly.toJSON()); }

  /** Record the state as it is now, before `label` changes it. */
  pushHistory(label) {
    if (!this.ui) return;                    // still booting
    this.history.push(label, this._snapshot());
    this.ui.syncHistory();
  }

  _restore(snapshot) {
    const next = Assembly.fromJSON(JSON.parse(snapshot));
    this.assembly = next;
    this.editor.setAssembly(next, { keepCamera: true, keepSelection: true });
    this.ui.syncName(next.name);
    this.ui.syncResolution(next.voxRes);
    this.ui.renderPalette();
    this.ui.renderStats(this.editor.stats);
    this.ui.syncHistory();
  }

  undo() {
    if (!EDIT_MODES.has(this.mode)) return false;
    const entry = this.history.undo(this._snapshot());
    if (!entry) { this.ui.toastMsg('これ以上戻せません'); return false; }
    this._restore(entry.snapshot);
    this.ui.toastMsg(`元に戻す: ${entry.label}`);
    return true;
  }

  redo() {
    if (!EDIT_MODES.has(this.mode)) return false;
    const entry = this.history.redo(this._snapshot());
    if (!entry) { this.ui.toastMsg('やり直せる操作がありません'); return false; }
    this._restore(entry.snapshot);
    this.ui.toastMsg(`やり直し: ${entry.label}`);
    return true;
  }

  // ---------------------------------------------------------- clipboard

  copySelected({ cut = false } = {}) {
    const entries = this.editor.copySelected();
    if (!entries.length) { this.ui.toastMsg('コピーするパーツを選んでください'); return 0; }
    this.clipboard = entries;
    if (cut) {
      const removable = entries.filter((e) => e.parent);
      if (removable.length) this.editor.deleteSelected();
      this.ui.toastMsg(`${entries.length} パーツを切り取りました`);
    } else {
      this.ui.toastMsg(`${entries.length} パーツをコピーしました`);
    }
    return entries.length;
  }

  pasteClipboard() {
    if (!this.clipboard.length) { this.ui.toastMsg('クリップボードが空です'); return 0; }
    this.pushHistory('貼り付け');
    const made = this.editor.paste(this.clipboard);
    if (!made.length) { this.ui.toastMsg('貼り付けできませんでした'); return 0; }
    this.editor.rebuild();
    this.editor.select(made);
    this.ui.renderPalette();
    this.ui.toastMsg(`${made.length} パーツを貼り付けました`);
    return made.length;
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
    if (this.mode === 'part') { this.savePart(); return; }
    this.mainAssembly.prunePalette();
    localStorage.setItem(SAVE_KEY, JSON.stringify(this.mainAssembly.toJSON()));
    this.ui.renderPalette();
    this.ui.toastMsg(`「${this.mainAssembly.name}」を保存しました`);
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

  /** Replace the active document wholesale. Undo history starts fresh. */
  _adopt(assembly) {
    this.assembly = assembly;
    this.history.clear();
    this.editor.setAssembly(assembly);
    this.ui.syncName(assembly.name);
    this.ui.syncResolution(assembly.voxRes);
    this.ui.renderPalette();
    this.ui.renderStats(this.editor.stats);
    this.ui.syncHistory();
  }

  // ---------------------------------------------------------- part library

  /** Open the part workbench, optionally on an existing library entry. */
  openPartEditor(libraryId = null) {
    if (libraryId) {
      const doc = this.library.open(libraryId);
      if (!doc) { this.ui.toastMsg('パーツが見つかりません'); return; }
      this.partAssembly = doc;
      this.partSourceId = libraryId;
      this.partHistory.clear();
      this.partEditor.setAssembly(doc);
    }
    this.setMode('part');
  }

  newPart() {
    this.partAssembly = Assembly.createPart('NEW PART', this.editor.colorIndex);
    this.partSourceId = null;
    this.partHistory.clear();
    this.partEditor.setAssembly(this.partAssembly);
    this.ui.syncName(this.partAssembly.name);
    this.ui.renderPalette();
    this.ui.renderStats(this.partEditor.stats);
    this.ui.syncHistory();
    this.ui.toastMsg('新しいパーツを作成しました');
  }

  savePart(name = this.partAssembly.name) {
    this.partAssembly.prunePalette();
    this.partAssembly.name = String(name || 'PART').trim().toUpperCase() || 'PART';
    const entry = this.library.put(this.partAssembly.name, this.partAssembly);
    this.partSourceId = entry.id;
    this.ui.renderLibrary();
    this.ui.syncName(this.partAssembly.name);
    this.ui.toastMsg(`パーツ庫に「${entry.name}」を保存しました`);
    return entry;
  }

  /** Push the current machine selection into the library as a reusable part. */
  saveSelectionAsPart() {
    const id = this.mainEditor.selected;
    if (!id) { this.ui.toastMsg('保存するパーツを選んでください'); return null; }
    const doc = this.mainAssembly.extract(id);
    if (!doc) return null;
    const part = this.mainAssembly.get(id);
    doc.name = `${this.mainAssembly.name}-${part.kind === 'bone' ? 'BONE' : 'PART'}`.toUpperCase();
    const entry = this.library.put(doc.name, doc);
    this.ui.renderLibrary();
    this.ui.toastMsg(`パーツ庫に「${entry.name}」を保存しました`);
    return entry;
  }

  /** Arm the stamp tool so the next click grafts this part into the machine. */
  placePart(libraryId) {
    const doc = this.library.open(libraryId);
    if (!doc) { this.ui.toastMsg('パーツが見つかりません'); return; }
    if (this.mode !== 'edit') this.setMode('edit');
    this.editor.armStamp(doc);
    this.setTool(TOOL.STAMP);
    this.ui.toastMsg(`「${doc.name}」を置く場所をクリック`);
  }

  renamePart(libraryId, name) {
    if (this.library.rename(libraryId, name)) this.ui.renderLibrary();
  }

  deletePart(libraryId) {
    const entry = this.library.get(libraryId);
    if (!this.library.remove(libraryId)) return;
    if (this.partSourceId === libraryId) this.partSourceId = null;
    if (this.editor.stampSource) this.editor.armStamp(null);
    this.ui.renderLibrary();
    this.ui.toastMsg(`「${entry?.name ?? 'パーツ'}」を削除しました`);
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

  /** Link the selection to the last-selected part so they move together. */
  connectSelected() {
    if (this.editor.selection.size < 2) {
      this.ui.toastMsg('2つ以上選んでください。最後に選んだパーツが連結先になります');
      return;
    }
    const anchor = this.assembly.get(this.editor.anchorId);
    const { connected, skipped, rigid } = this.editor.connectSelected();
    if (!connected) {
      this.ui.toastMsg('連結できませんでした（自分の子には連結できません）');
      return;
    }
    const notes = [];
    if (skipped) notes.push(`${skipped} 個は対象外`);
    if (rigid) notes.push(`${rigid} 個はボーンの固定側`);
    const tail = notes.length ? `（${notes.join(' / ')}）` : '';
    this.ui.toastMsg(`${connected} パーツを ${anchor?.label ?? 'パーツ'} に連結しました${tail}`);
  }

  disconnectSelected() {
    const n = this.editor.disconnectSelected();
    this.ui.toastMsg(n ? `${n} パーツの連結を解除しました` : '解除できる連結がありません');
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
    if (this.assembly.voxRes === n) return;
    this.pushHistory('加工の細かさ');
    this.assembly.setVoxResolution(n);
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
    this.pushHistory('全埋め');
    part.vox.fill(this.editor.colorIndex);
    this._afterVoxelEdit(part);
  }

  bevelSelected() {
    const part = this._selectedBlock();
    if (!part) return;
    this.pushHistory('角落とし');
    part.vox.bevel(0.22);
    this._afterVoxelEdit(part);
  }

  repaintSelected() {
    const part = this._selectedBlock();
    if (!part) return;
    this.pushHistory('全塗り');
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
    const previous = this.mode;
    this.mode = mode;

    if (previous === 'field') this.field.exit();
    if (previous === 'edit') this.mainEditor.exit();
    if (previous === 'part') this.partEditor.exit();

    if (mode === 'field') {
      this.hudCanvas.classList.remove('hidden');
      this.field.load(this.mainAssembly);
      this.field.enter();
      // Straight into the action — the pause menu is for Esc, not for entry.
      this.resumeField();
    } else {
      this.hudCanvas.classList.add('hidden');
      this.editor.enter();
      this.ui.syncName(this.assembly.name);
      this.ui.syncResolution(this.assembly.voxRes);
      this.ui.syncTool(this.editor.tool);
      this.ui.renderPalette();
      this.ui.renderStats(this.editor.stats);
      this.ui.renderInspector(this.editor.selectedParts());
      this.ui.syncHistory();
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
      const editing = EDIT_MODES.has(this.mode);

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
        if (!editing) return;
        switch (e.code) {
          case 'KeyZ':
            e.preventDefault();
            if (e.shiftKey) this.redo(); else this.undo();
            break;
          case 'KeyY': e.preventDefault(); this.redo(); break;
          case 'KeyC': e.preventDefault(); this.copySelected(); break;
          case 'KeyX': e.preventDefault(); this.copySelected({ cut: true }); break;
          case 'KeyV': e.preventDefault(); this.pasteClipboard(); break;
          case 'KeyA': e.preventDefault(); this.editor.selectAll(); break;
          case 'KeyD': e.preventDefault(); this.editor.duplicateSelected(); break;
          default: break;
        }
        return;
      }
      if (e.code === 'F5') return;

      if (editing) {
        const tool = TOOL_KEYS[e.code];
        if (tool) { e.preventDefault(); this.setTool(tool); }
        if (e.code === 'KeyT') { e.preventDefault(); this.setGizmoMode('translate'); }
        if (e.code === 'KeyR') { e.preventDefault(); this.setGizmoMode('rotate'); }
        if (e.code === 'KeyJ') {
          e.preventDefault();
          if (e.shiftKey) this.disconnectSelected();
          else this.connectSelected();
        }
        if (e.code === 'Enter' && this.mode === 'edit') { e.preventDefault(); this.setMode('field'); }
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
    this.mainEditor.resize(w, h);
    this.partEditor.resize(w, h);
    this.field.resize(w, h);
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);

    if (EDIT_MODES.has(this.mode)) {
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
    this.mainEditor.dispose();
    this.partEditor.dispose();
    this.input.dispose();
    this.renderer.dispose();
  }
}

if (typeof window !== 'undefined' && !window.__BROSTOM_NO_AUTOBOOT) {
  window.addEventListener('DOMContentLoaded', () => {
    window.__brostom = new App();
  });
}
