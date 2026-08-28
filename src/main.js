import * as THREE from 'three';
import { Assembly, PRESETS } from './core/Assembly.js';
import { EditorScene, TOOL } from './editor/EditorScene.js';
import { History } from './editor/History.js';
import { PartLibrary } from './editor/PartLibrary.js';
import { FieldScene } from './game/FieldScene.js';
import { SoloRun } from './game/SoloRun.js';
import { TitleScene } from './game/TitleScene.js';
import { PostFX } from './game/PostFX.js';
import { seedFromClock } from './core/Random.js';
import { EditorUI } from './ui/EditorUI.js';
import { InputManager, DEFAULT_BINDINGS } from './zmf/InputManager.js';
import { KineticFeedback } from './zmf/KineticFeedback.js';
import { SIZE_STEP } from './core/constants.js';

/** How long one simulation step covers. Everything in the fight uses this. */
export const STEP = 1 / 60;
/**
 * The most steps one frame may run. Past this the game shows time passing
 * more slowly rather than trying to catch up, which is the only choice that
 * cannot make a struggling machine struggle harder.
 */
export const MAX_CATCH_UP = 4;

// ============================================================
//  BLOSTOM — application shell.
//
//  Four screens over one renderer:
//    title  the front page, with your own machine turning on it
//    edit   the machine
//    part   one part on its own, saved to a reusable library
//    field  the arena — free play, or a solo run with rules on top
//
//  The two editing modes are the SAME EditorScene class over two documents,
//  each with its own undo stack. Everything the machine editor can do — free
//  placement, sculpting, colours, connections — works on a part too.
// ============================================================

const SAVE_KEY = 'blostom.assembly.v1';
/** What it was called before the rename. Read as a fallback, never written. */
const SAVE_KEY_WAS = 'brostom.assembly.v1';

const TOOL_KEYS = {
  KeyV: TOOL.SELECT,
  KeyB: TOOL.BLOCK,
  KeyG: TOOL.EQUIP,
  KeyL: TOOL.BONE_LEG,
  KeyA: TOOL.BONE_ARM,
  KeyF: TOOL.BONE_FACE,
  KeyC: TOOL.BONE_CUSTOM,
  KeyX: TOOL.CARVE,
  KeyZ: TOOL.ADD,
  KeyP: TOOL.PAINT,
};

const EDIT_MODES = new Set(['edit', 'part']);
/** The two screens that are the arena: same scene, different rules. */
const FIELD_MODES = new Set(['field', 'solo']);

/** Arrow key -> [screen right, screen forward]. */
const NUDGE = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};
/** Alt gives a step finer than the placement grid, for the last millimetre. */
const FINE_STEP = 0.05;
const KEY_SAVE = 'blostom.keys.v1';
/** What it was called before the rename. Read as a fallback, never written. */
const KEY_SAVE_WAS = 'brostom.keys.v1';

/** Only the rows the player changed are stored, so new defaults still land. */
function loadBindings() {
  try {
    const raw = localStorage.getItem(KEY_SAVE) ?? localStorage.getItem(KEY_SAVE_WAS);
    if (raw) return { ...DEFAULT_BINDINGS, ...JSON.parse(raw) };
  } catch (e) {
    console.warn('key bindings could not be read, using the defaults', e);
  }
  return null;
}

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

    this.input = new InputManager(this.canvas, { bindings: loadBindings() });
    this.feedback = new KineticFeedback();
    this.library = new PartLibrary();
    this.clipboard = [];

    this.mode = 'edit';

    /**
     * One post chain for the whole app. Every screen draws through the same
     * antialiased HDR target and the same bloom, so a machine looks the same
     * on the bench as it does in the arena — and there is one buffer to pay
     * for rather than three.
     */
    this.post = new PostFX(this.renderer);

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
      post: this.post,
    });

    this.titleScene = new TitleScene({ renderer: this.renderer, post: this.post });

    this.ui = new EditorUI(this.overlay, this);
    this.ui.renderStats(this.editor.stats);
    this.ui.renderInspector(null);
    this.ui.renderLibrary();
    this.ui.syncHistory();

    this.mode = null;
    this.setMode('title');

    this._bindGlobalKeys();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    this.clock = new THREE.Clock();
    /** Real time owed to the simulation but not yet stepped. */
    this.stepBank = 0;
    this.stepsThisFrame = 0;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  _makeEditor() {
    const ed = new EditorScene({ renderer: this.renderer, canvas: this.canvas, post: this.post });
    ed.onChange = (stats) => this.ui?.renderStats(stats);
    ed.onSelect = (parts) => this.ui?.renderInspector(parts);
    ed.onBeforeChange = (label) => this.pushHistory(label);
    ed.onReject = (msg) => this.ui?.toastMsg(msg);
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
      const raw = localStorage.getItem(SAVE_KEY) ?? localStorage.getItem(SAVE_KEY_WAS);
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
    const raw = localStorage.getItem(SAVE_KEY) ?? localStorage.getItem(SAVE_KEY_WAS);
    if (!raw) { this.ui.toastMsg('保存データがありません'); return; }
    this._adopt(Assembly.fromJSON(JSON.parse(raw)));
    this.ui.toastMsg('読み込みました');
  }

  exportJson() {
    const blob = new Blob([JSON.stringify(this.assembly.toJSON())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.assembly.name.replace(/\s+/g, '_') || 'robo'}.blostom.json`;
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

  /**
   * Replace the active document wholesale.
   *
   * Loading a preset or a file is a deliberate fresh start, so the history
   * goes with it. A build arriving from a share code is not: dropping
   * someone else's machine over an hour of work has to be recoverable.
   */
  _adopt(assembly, { keepHistory = false } = {}) {
    this.assembly = assembly;
    if (!keepHistory) this.history.clear();
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

  // ---------------------------------------------------------- equipment

  /** Arm a plate type and switch to the tool that sticks it on. */
  setEquipType(type) {
    this.editor.equipType = type;
    this.ui.syncEquipType(type);
    if (this.editor.tool !== TOOL.EQUIP) this.setTool(TOOL.EQUIP);
    // Selecting a plate while one is selected swaps it, which is what the
    // player means far more often than "arm it for the next click".
    const sel = this.editor.selectedParts();
    if (sel.length === 1 && sel[0].kind === 'equip') {
      this.editor.setEquipTypeSelected(type);
      this.ui.renderInspector(this.editor.selectedParts());
    }
  }

  /**
   * Arm the block tool with a shape. If a block is already selected, re-cut
   * that one too: picking a shape while looking at a block almost always
   * means "make this one a sphere", not "make the NEXT one a sphere".
   */
  setNewBlockShape(shape) {
    this.editor.newBlockShape = shape;
    this.ui.syncBlockShape(shape);
    const sel = this.editor.selectedParts();
    if (sel.some((p) => p.vox)) {
      this.editor.setBlockShapeSelected(shape);
      this.ui.renderInspector(this.editor.selectedParts());
    }
  }

  setNewEquipSize(v) {
    this.editor.newEquipSize = v;
    const sel = this.editor.selectedParts();
    if (sel.length === 1 && sel[0].kind === 'equip') this.editor.setEquipSizeSelected(v);
  }

  setBulletColor(hex) {
    if (this.editor.setBulletColorSelected(hex)) {
      this.ui.renderInspector(this.editor.selectedParts());
    }
  }

  /**
   * Take in a build that arrived from somewhere else. A machine replaces
   * what is on the bench; a part goes on the shelf, because dropping it
   * over the machine you are working on is never what was meant.
   * @returns {string} where it went, for the message
   */
  adoptShared(assembly) {
    if (assembly.isPart) {
      const entry = this.library.put(assembly.name, assembly);
      this.ui.renderLibrary();
      return `パーツ庫「${entry.name}」`;
    }
    if (this.mode !== 'edit') this.setMode('edit');
    this.pushHistory('共有コード読み込み');
    this._adopt(assembly, { keepHistory: true });
    return 'メイン編集';
  }

  openShare() { return this.ui.share.show(); }

  /** Persist the key scheme. Called by the key-config screen on every edit. */
  saveBindings() {
    try {
      localStorage.setItem(KEY_SAVE, JSON.stringify(this.input.bindingsToJSON()));
      return true;
    } catch (e) {
      console.warn('key bindings could not be saved', e);
      return false;
    }
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

    if (FIELD_MODES.has(previous)) this.field.exit();
    if (previous === 'edit') this.mainEditor.exit();
    if (previous === 'part') this.partEditor.exit();
    if (previous === 'title') this.titleScene.exit();

    if (FIELD_MODES.has(mode)) {
      this.hudCanvas.classList.remove('hidden');
      this.field.load(this.mainAssembly);
      // Free play has no rules in charge; a solo run does, and it is the
      // rules that decide who turns up and when the run is over.
      this.field.setDirector(mode === 'solo' ? new SoloRun(this.field) : null);
      // A fresh draw per run, so two runs are not the same fight — the run
      // is still decided by its seed, it is just a different one each time.
      if (mode === 'solo') this.field.restart(seedFromClock());
      this.field.enter();
      // Straight into the action — the pause menu is for Esc, not for entry.
      this.resumeField();
    } else if (mode === 'title') {
      this.hudCanvas.classList.add('hidden');
      // Whatever is on the workbench is what stands on the title screen.
      this.titleScene.load(this.mainAssembly);
      this.titleScene.enter();
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
    if (!FIELD_MODES.has(this.mode)) return;
    if (this.ui.result.open) return;      // the run is already over
    this.field.setPaused(true);
    this.input.exitPointerLock();
    this.feedback.suspend();
    this.ui.setPaused(true);
  }

  resumeField() {
    if (!FIELD_MODES.has(this.mode)) return;
    this.field.setPaused(false);
    this.ui.setPaused(false);
    this.input.requestPointerLock();
    this.feedback.init();
    this.feedback.resume();
  }

  restartField() {
    if (!FIELD_MODES.has(this.mode)) return;
    this.ui.result.close();
    // In free play "restart" means stand back up. In a run it means throw
    // the run away and start a new one, from wave one, on a new draw.
    if (this.mode === 'solo') this.field.restart(seedFromClock());
    else this.field.respawn();
    this.resumeField();
  }

  /** Start a solo run, or start this one over if you are already in it. */
  startSolo() {
    if (this.mode === 'solo') { this.restartField(); return this; }
    this.ui.result.close();
    this.setMode('solo');
    return this;
  }

  /** Back to the front page from wherever you are. */
  goTitle() {
    this.ui.result.close();
    this.setMode('title');
    return this;
  }

  /**
   * Called the frame a run ends. The fight stops but the frame keeps being
   * drawn, so the result sits over the wreck rather than over a black
   * screen — and the pause menu stays out of it, because pausing something
   * that has finished is not a thing the player can want.
   */
  _showResult() {
    this.field.setPaused(true);
    this.input.exitPointerLock();
    this.feedback.suspend();
    this.ui.result.show(this.field.director.result);
    return this;
  }

  // ---------------------------------------------------------- input

  _bindGlobalKeys() {
    this._onKey = (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      const editing = EDIT_MODES.has(this.mode);

      // F1 anywhere, and "?" where it is not being typed into something.
      if (e.code === 'F1' || (e.code === 'Slash' && e.shiftKey)) {
        e.preventDefault();
        this.ui.help.toggle();
        return;
      }

      if (e.code === 'Escape') {
        if (this.ui.help.open) { this.ui.help.close(); return; }
        if (this.ui.share.open) { this.ui.share.close(); return; }
        if (this.ui.keyConfig.open) { this.ui.keyConfig.close(); return; }
        if (this.ui.result.open) return;   // the run is over; pick a button
        if (FIELD_MODES.has(this.mode)) {
          if (this.field.paused) this.resumeField();
          else this.pauseField();
        } else if (this.editor.tool !== TOOL.SELECT) {
          // Escape backs out one step: first out of whatever tool you are
          // holding, and only then out of the selection.
          this.setTool(TOOL.SELECT);
        } else {
          this.editor.clearSelection();
        }
        return;
      }

      // On the title screen the menu has the keyboard. Falling through would
      // let a shortcut fire on top of a menu choice — Enter picking "edit"
      // and then the editor's own Enter throwing you into the field.
      if (this.mode === 'title') return;

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
          case 'KeyS': e.preventDefault(); this.save(); break;
          case 'KeyD': e.preventDefault(); this.editor.duplicateSelected(); break;
          default: break;
        }
        return;
      }
      if (e.code === 'F5') return;

      if (editing && NUDGE[e.code]) {
        // Arrow keys inch the selection around. Plain arrows work in the
        // ground plane as seen from the camera; Shift lifts and lowers.
        e.preventDefault();
        const [right, forward] = NUDGE[e.code];
        const step = e.altKey ? FINE_STEP : SIZE_STEP;
        if (e.shiftKey) this.editor.nudgeSelectedByView(0, forward, 0, step);
        else this.editor.nudgeSelectedByView(right, 0, forward, step);
        return;
      }

      if (editing) {
        // Framing. F is a tool key here, so these follow the other
        // convention: full stop for the selection, Home for the lot.
        if (e.code === 'Period') { e.preventDefault(); this.editor.frameSelection(); return; }
        if (e.code === 'Home') { e.preventDefault(); this.editor.frameAll(); return; }

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
      if (FIELD_MODES.has(this.mode) && !document.pointerLockElement && !this.field.paused) {
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
    this.post.setSize(w, h);
    this.mainEditor.resize(w, h);
    this.partEditor.resize(w, h);
    this.field.resize(w, h);
    this.titleScene.resize(w, h);
  }

  /**
   * One displayed frame.
   *
   * The fight advances in FIXED steps, however fast the screen happens to
   * be. Feeding the real frame time straight into the simulation made the
   * result depend on the machine it ran on: the same inputs gave a
   * different fight on a slow frame, nothing could be replayed, and a long
   * frame integrated one huge step that threw machines through walls.
   *
   * Leftover time is carried to the next frame, and at most `MAX_CATCH_UP`
   * steps run in one go. Dropping the rest is deliberate — the alternative
   * is that a slow frame schedules more work, which makes the next frame
   * slower still, and the game spirals down instead of degrading.
   */
  frame() {
    const elapsed = Math.min(this.clock.getDelta(), 0.25);

    if (this.mode === 'title') {
      // A turntable and a menu. Nothing here is a fight, so it simply
      // follows the clock.
      this.titleScene.update(Math.min(elapsed, 1 / 20));
      this.titleScene.render();
      return;
    }

    if (EDIT_MODES.has(this.mode)) {
      // The workbench has no simulation to keep honest; it just follows the
      // clock so dragging stays smooth at any refresh rate.
      this.editor.update(Math.min(elapsed, 1 / 20));
      this.editor.render();
      return;
    }

    this.stepBank = Math.min(this.stepBank + elapsed, STEP * MAX_CATCH_UP);
    let steps = 0;
    while (this.stepBank >= STEP && steps < MAX_CATCH_UP) {
      this.input.update(STEP);
      this.field.update(STEP);
      this.input.endFrame();
      this.stepBank -= STEP;
      steps++;
    }
    this.stepsThisFrame = steps;

    this.field.present(elapsed);
    this.field.render();

    // Asked here rather than inside the rules: whether a screen comes up is
    // not something the fight should be deciding.
    if (this.field.director?.finished && !this.ui.result.open) this._showResult();
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onKey);
    document.removeEventListener('pointerlockchange', this._onLock);
    this.mainEditor.dispose();
    this.partEditor.dispose();
    this.titleScene.dispose();
    this.ui.title.dispose();
    this.post.dispose();
    this.input.dispose();
    this.renderer.dispose();
  }
}

if (typeof window !== 'undefined' && !window.__BLOSTOM_NO_AUTOBOOT) {
  window.addEventListener('DOMContentLoaded', () => {
    window.__blostom = new App();
  });
}
