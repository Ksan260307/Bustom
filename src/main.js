import * as THREE from 'three';
import { Assembly, PRESETS, PRESET_LIST, starterParts } from './core/Assembly.js';
import { EditorScene, TOOL, PART_TOOLS } from './editor/EditorScene.js';
import { History } from './editor/History.js';
import { PartLibrary } from './editor/PartLibrary.js';
import { FieldScene } from './game/FieldScene.js';
import { ARENAS, DEFAULT_ARENA, getArena } from './game/Arenas.js';
import {
  SoloRun, SOLO_STAGES, DIFFICULTIES, DEFAULT_DIFFICULTY,
} from './game/SoloRun.js';
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

/**
 * Where the machine is kept between one session and the next, without
 * anybody pressing anything.
 *
 * There was no autosave at all: an hour of work lived only in a tab, and a
 * crash, a reload or a stray click on the preset list took all of it. This
 * is a safety net, not the save button — it is written over constantly and
 * is only ever offered back when the deliberate save is older than it.
 */
const DRAFT_KEY = 'blostom.draft.v1';
/** How long the editor has to be quiet before the draft is written. */
const DRAFT_AFTER = 1.5;
/**
 * How many times the last write's own cost to wait before writing again.
 *
 * Serialising a machine costs 55ms at the default sculpting resolution and
 * nearly TWO SECONDS at the finest one — the voxel grids run-length encode
 * to a few kilobytes, but the encoder still walks a million cells a block.
 * A safety net that stops the editor dead for two seconds every time you
 * pause is not a safety net, it is the thing you would turn off.
 *
 * So it pays for itself: the more the last write cost, the longer until the
 * next one. Cheap documents keep the 1.5s promise; expensive ones back off
 * to half a minute, which is still far better than the nothing there was.
 */
const DRAFT_BACKOFF = 20;

/** Named slots, so more than one machine can be kept. */
const SLOTS_KEY = 'blostom.slots.v1';
/** Where the player last chose to fight, and whether the guns were cold. */
const ARENA_KEY = 'blostom.arena.v1';
/** Which setting a run is fought at. */
const DIFFICULTY_KEY = 'blostom.difficulty.v1';
const FIRE_KEY = 'blostom.enemyfire.v1';
export const SLOT_LIMIT = 8;

const TOOL_KEYS = {
  KeyV: TOOL.SELECT,
  KeyB: TOOL.BLOCK,
  KeyG: TOOL.EQUIP,
  KeyL: TOOL.BONE_LEG,
  KeyA: TOOL.BONE_ARM,
  KeyF: TOOL.BONE_FACE,
  KeyC: TOOL.BONE_CUSTOM,
  KeyW: TOOL.BONE_WEAPON,
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
    /** How hard a run is. Chosen on the title, and remembered. */
    this.difficulty = (() => {
      try {
        const id = localStorage.getItem(DIFFICULTY_KEY);
        return DIFFICULTIES[id] ? id : DEFAULT_DIFFICULTY;
      } catch { return DEFAULT_DIFFICULTY; }
    })();

    /** Exposed so the smoke test can ask every preset to stand up. */
    this.PRESET_LIST = PRESET_LIST;

    /** The machine a run is being fought with, when it is not the bench's. */
    this.soloMachine = null;

    this.library = new PartLibrary();
    // A shelf that starts empty is invisible to anyone who has not already
    // built something worth saving, so it starts with a few limbs on it.
    this.library.seed(1, starterParts());
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
    /**
     * Closing the tab with unsaved work says so.
     *
     * The browser decides the wording; all we get to say is that there is
     * something to lose. Without this the tab simply went, and with no
     * autosave either, so did the machine.
     */
    this._onLeave = (e) => {
      if (!this.dirty) return undefined;
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', this._onLeave);
    this.resize();

    this.clock = new THREE.Clock();
    /** True while there are changes nobody has saved. */
    this.dirty = false;
    /** Seconds until the safety-net draft is written. */
    this._draftIn = 0;
    /** How long the next draft may make us wait, in seconds. */
    this._draftDue = DRAFT_AFTER;
    /** What the last one actually cost. */
    this._draftCost = 0;
    /** Real time owed to the simulation but not yet stepped. */
    this.stepBank = 0;
    this.stepsThisFrame = 0;
    // The safety net, offered once, on the way in.
    this.ui.offerDraft?.();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  _makeEditor() {
    const ed = new EditorScene({ renderer: this.renderer, canvas: this.canvas, post: this.post });
    ed.onChange = (stats) => this.ui?.renderStats(stats);
    ed.onSelect = (parts) => this.ui?.renderInspector(parts);
    ed.onBeforeChange = (label) => { this.pushHistory(label); this.touch(); };
    // A drag that lays a row of parts is ONE change, the way a slider drag is.
    ed.onGesture = (open) => (open ? this.beginGesture() : this.endGesture());
    ed.onHint = (hint) => this.ui?.showPlacementHint?.(hint);
    ed.onWorkPlane = (y) => this.ui?.showWorkPlane?.(y);
    ed.onMarquee = (rect) => this.ui?.showMarquee?.(rect);
    ed.onRecipes = (list) => this.ui?.renderRecipes?.(list);
    ed.onConfirm = (_kind, req) => this.ui?.confirmAction?.(req);
    ed.onColor = (i) => this.ui?.syncColor?.(i);
    ed.onHidden = () => this.ui?.syncVisibility?.(ed.hidden.size, ed.locked.size);
    ed.onSelectionSets = (names) => this.ui?.renderSelectionSets?.(names);
    ed.onLocked = () => this.ui?.syncVisibility?.(ed.hidden.size, ed.locked.size);
    ed.onReject = (msg, blame = null) => {
      this.ui?.toastMsg(msg);
      // And WHICH parts are in the way. "武器は4枚までです" is a rule; the
      // four plates it is talking about are the answer.
      if (blame?.length) ed.select(blame);
    };
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
  /**
   * Treat everything until `endGesture` as ONE undoable change.
   *
   * A slider is not a change, it is a hundred of them. Dragging one from 1.0
   * to 3.0 used to leave nine entries behind — nine presses of Ctrl+Z to
   * undo one adjustment — and since every entry is a full snapshot of the
   * machine, seven such drags were enough to push an hour of real work off
   * the end of the history.
   *
   * The gizmo already got this right: it records once when the drag starts
   * (see `_beginDrag`). This is the same idea for anything the player holds
   * on to, and it is opened and closed by the widget rather than guessed at
   * from timing — two deliberate resizes half a second apart are two
   * changes, and no clock can tell that from one slow drag.
   */
  beginGesture() {
    this._gestureOpen = true;
    this._gestureRecorded = false;
  }

  endGesture() { this._gestureOpen = false; }

  pushHistory(label) {
    if (!this.ui) return;                    // still booting
    if (this._gestureOpen) {
      if (this._gestureRecorded) return;     // the "before" is already kept
      this._gestureRecorded = true;
    }
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

  // ------------------------------------------------------------- field

  /**
   * Move the fight somewhere else.
   *
   * Remembered, because a place is a preference: somebody who wants to try
   * everything on the Moon should not have to say so every time.
   */
  _savedArena() {
    try {
      const id = localStorage.getItem(ARENA_KEY);
      return ARENAS[id] ? id : DEFAULT_ARENA;
    } catch { return DEFAULT_ARENA; }
  }

  /**
   * Whether the opponents shoot, in the test field.
   *
   * Off until somebody says otherwise. The test field is where a machine
   * gets tried out, and the first thing anybody does with a machine they
   * just built is watch it walk — which is a poor time to be shot at. Solo
   * play is where the fighting is, and it ignores this entirely.
   */
  _savedFire() {
    try { return localStorage.getItem(FIRE_KEY) === '1'; } catch { return false; }
  }

  setArena(arenaId) {
    this.field.setArena(arenaId);
    try { localStorage.setItem(ARENA_KEY, arenaId); } catch { /* private mode */ }
    this.ui.syncArena(arenaId, this.field.enemyFire, !this.field.director);
    this.ui.toastMsg(`${getArena(arenaId).label} に移動しました`);
    return this;
  }

  /**
   * Turn the opponents' guns on or off.
   *
   * Free play only. Under a set of rules the request is refused rather than
   * silently ignored — a run where nothing shoots is not a run, and it
   * should say so rather than quietly leaving the box ticked.
   */
  setEnemyFire(on) {
    if (this.field.director && !on) {
      this.ui.toastMsg('ソロランでは撃たせないようにはできません');
      this.ui.syncArena(this.field.world.arenaId, true, false);
      return this;
    }
    this.field.setEnemyFire(on);
    try { localStorage.setItem(FIRE_KEY, on ? '1' : '0'); } catch { /* private mode */ }
    this.ui.syncArena(this.field.world.arenaId, this.field.enemyFire, !this.field.director);
    this.ui.toastMsg(on ? '敵が撃ってきます' : '敵は撃ってきません');
    return this;
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

  /**
   * @param {boolean} atCursor put it on the face under the pointer instead
   *   of beside the part it was copied from
   */
  pasteClipboard(atCursor = false) {
    if (!this.clipboard.length) { this.ui.toastMsg('クリップボードが空です'); return 0; }
    if (atCursor) {
      const put = this.editor.pasteHere(this.clipboard);
      if (put.length) {
        this.ui.renderPalette();
        this.ui.toastMsg(`${put.length} パーツをカーソルの面に貼り付けました`);
      }
      return put.length;
    }
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

  save(slot = null) {
    if (this.mode === 'part') { this.savePart(); return; }
    this.mainAssembly.prunePalette();
    const doc = this.mainAssembly.toJSON();
    localStorage.setItem(SAVE_KEY, JSON.stringify(doc));
    if (slot !== null) this._writeSlot(slot, doc);
    this.dirty = false;
    this.ui.renderPalette();
    this.ui.syncDirty?.(false);
    this.ui.toastMsg(`「${this.mainAssembly.name}」を保存しました`);
  }

  /**
   * Mark the document as changed, and start the clock on the draft.
   *
   * Called from the same place undo entries come from, so anything worth
   * being able to take back is also worth not losing.
   */
  touch() {
    this.dirty = true;
    // Never sooner than the last write earned. Restarting the clock on every
    // keystroke is right; restarting it to 1.5s on a document that takes two
    // seconds to write is not.
    if (this._draftIn <= 0) this._draftIn = this._draftDue;
    this.ui?.syncDirty?.(true);
    return this;
  }

  /** Write the safety net, if it is owed. Driven from the frame clock. */
  tickDraft(dt) {
    if (this._draftIn <= 0) return this;
    this._draftIn -= dt;
    if (this._draftIn > 0) return this;
    this._draftIn = 0;
    // Nothing has changed since the last one, so there is nothing to keep.
    if (!this.dirty) return this;
    // Never in the middle of a stroke: the one thing worse than a pause is
    // a pause while the brush is down.
    if (this.editor?.painting) { this._draftIn = DRAFT_AFTER; return this; }

    const began = performance.now();
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        at: Date.now(), json: this.mainAssembly.toJSON(),
      }));
    } catch (e) {
      // A full or private store is not a reason to interrupt anybody.
    }
    // What it cost decides when it may happen again.
    this._draftCost = (performance.now() - began) / 1000;
    this._draftDue = Math.max(DRAFT_AFTER, this._draftCost * DRAFT_BACKOFF);
    return this;
  }

  /** The unsaved draft, if there is one newer than the last real save. */
  draft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return d?.json ? d : null;
    } catch (e) {
      return null;
    }
  }

  /** Take the draft back up where it was left. */
  restoreDraft() {
    const d = this.draft();
    if (!d) { this.ui.toastMsg('復元できる作業がありません'); return false; }
    this._adopt(Assembly.fromJSON(d.json));
    this.ui.toastMsg('前回の続きから復元しました');
    return true;
  }

  /** Throw the draft away, once its offer has been declined. */
  forgetDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* nothing to do */ }
    return this;
  }

  // ---------------------------------------------------------- named slots

  /** Every named save, newest first. */
  slots() {
    try {
      const raw = localStorage.getItem(SLOTS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  _writeSlot(slot, doc) {
    const list = this.slots().filter((x) => x.id !== slot);
    list.unshift({ id: slot, name: this.mainAssembly.name, at: Date.now(), json: doc });
    // A lid on it: this is browser storage, and a machine at the finest
    // sculpting resolution is not small.
    try {
      localStorage.setItem(SLOTS_KEY, JSON.stringify(list.slice(0, SLOT_LIMIT)));
    } catch (e) {
      this.ui.toastMsg('保存できませんでした（容量不足）');
    }
    return this;
  }

  /** Keep the current machine under a name of its own. */
  saveAs(name) {
    const clean = String(name ?? '').trim() || this.mainAssembly.name;
    this.mainAssembly.name = clean.toUpperCase();
    this.ui.syncName(this.mainAssembly.name);
    this.save(`s${Date.now().toString(36)}`);
    this.ui.renderSlots?.();
    return this;
  }

  /** Open one of the named saves. */
  openSlot(id) {
    const entry = this.slots().find((x) => x.id === id);
    if (!entry) { this.ui.toastMsg('見つかりません'); return false; }
    if (!this.confirmDiscard(`「${entry.name}」を開きます`)) return false;
    this.pushHistory(`「${entry.name}」を開く`);
    this._adopt(Assembly.fromJSON(entry.json), { keepHistory: true });
    this.ui.toastMsg(`「${entry.name}」を開きました`);
    return true;
  }

  /** Forget one of the named saves. */
  deleteSlot(id) {
    const list = this.slots().filter((x) => x.id !== id);
    try { localStorage.setItem(SLOTS_KEY, JSON.stringify(list)); } catch (e) { /* full */ }
    this.ui.renderSlots?.();
    return this;
  }

  /**
   * Ask before throwing the current machine away.
   *
   * Loading a preset used to replace an hour of work with no question asked
   * AND clear the history, so undo could not bring it back either.
   */
  confirmDiscard(what = '') {
    if (!this.dirty) return true;
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`保存していない変更があります。${what ? `${what}。` : ''}破棄しますか？`)
      : true;
    return ok;
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

  loadPreset(key, { ask = true } = {}) {
    const p = PRESETS[key];
    if (!p) return;
    if (ask && !this.confirmDiscard(`${p.label} を読み込みます`)) return;
    // Recorded first, and the history KEPT. A preset arriving over an hour
    // of work has to be recoverable, and "a deliberate fresh start" is not
    // a good enough reason to make one keystroke unrecoverable.
    this.pushHistory(`${p.label} を読み込む`);
    this._adopt(p.build(), { keepHistory: true });
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

  /**
   * Push the current machine selection into the library as a reusable part.
   *
   * A selection of several parts saves the topmost one, which takes its
   * children with it — that is what a "part" is here. Saving several
   * unrelated parts as one thing is not possible and used to fail silently
   * by saving whichever happened to be last clicked.
   */
  saveSelectionAsPart() {
    const ids = [...this.mainEditor.selection];
    if (!ids.length) { this.ui.toastMsg('保存するパーツを選んでください'); return null; }

    // The one nearest the core, so a whole limb saves as a whole limb rather
    // than as the fingertip somebody happened to click last.
    const depth = (id) => {
      let d = 0;
      for (let p = this.mainAssembly.get(id); p?.parent; p = this.mainAssembly.get(p.parent)) d++;
      return d;
    };
    const id = ids.slice().sort((a, b) => depth(a) - depth(b))[0];
    const doc = this.mainAssembly.extract(id);
    if (!doc) return null;
    const part = this.mainAssembly.get(id);
    const label = part.label && part.label !== 'BLOCK' ? part.label
      : part.kind === 'bone' ? 'BONE' : 'PART';
    doc.name = `${this.mainAssembly.name}-${label}`.toUpperCase();
    const entry = this.library.put(doc.name, doc);
    this.ui.renderLibrary();
    // How much of the selection actually went, because "save these six" and
    // "save this one and its five children" look identical on screen.
    const took = doc.size;
    this.ui.toastMsg(`パーツ庫に「${entry.name}」を保存しました（${took} パーツ）`);
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

  /**
   * Pick a colour: arm it for the next part, and paint what is selected now.
   *
   * It used to only arm it. Recolouring a block you had already placed meant
   * opening the folded colour section, choosing, scrolling the inspector
   * down to 中身 and pressing 全塗り — four actions for the decision a
   * builder makes most often, and nothing on the swatch to suggest it.
   *
   * Painting the selection as well costs nothing when there is none, and
   * arming stays in place either way: picking a colour and then placing
   * something still gives you that colour.
   */
  setColor(i) {
    this.editor.colorIndex = i;
    this.paintSelected(i);
    this.ui.syncColor(i);
    this.ui.noteColor(i);
  }

  /** Called continuously while the colour wheel is dragged. */
  setCustomColor(hex) {
    const idx = this.assembly.palette.ensure(hex);
    if (idx < 0) { this.ui.toastMsg('カラーが上限に達しました'); return; }
    this.editor.colorIndex = idx;
    // A colour off the wheel is the same decision as a colour off the
    // palette, and has to do the same thing. Two ways to pick a colour that
    // behave differently is one of them being wrong.
    this.paintSelected(idx);
    this.ui.noteColor(idx);
  }

  setVoxResolution(n, { force = false } = {}) {
    if (this.assembly.voxRes === n) return;
    // Coarser means every grid is resampled DOWN, and detail that goes does
    // not come back by setting it fine again.
    const carved = [...this.assembly.parts.values()]
      .filter((p) => p.vox?.isCarved(p.shape)).length;
    if (carved && n < this.assembly.voxRes && !force) {
      this.ui.confirmAction({
        message: `加工したブロックが${carved}個あります。粗くすると細部が失われます。`,
        accept: () => this.setVoxResolution(n, { force: true }),
        cancel: () => this.ui.syncResolution(this.assembly.voxRes),
      });
      return;
    }
    this.pushHistory('加工の細かさ');
    this.assembly.setVoxResolution(n);
    this.editor.rebuild();
    this.ui.syncResolution(n);
    this.ui.renderInspector(this.editor.selectedParts());
    this.ui.toastMsg(`加工の細かさを 1/${n} にしました`);
  }

  /**
   * Push one of the new-bone sliders onto whatever bones are selected.
   *
   * Everything goes through the editor's setter, including the joint limit.
   * It used to be written straight onto the part — no history entry, no
   * rebuild — so the one bone property you tune by feel was the one property
   * you could not undo.
   */
  applyBoneOptionToSelection(key, value) {
    this.editor.setBoneShapeSelected({ [key]: value });
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

  repaintSelected() { return this.paintSelected(this.editor.colorIndex); }

  /**
   * Repaint every block in the selection.
   *
   * One history entry for the lot, and nothing at all when the selection
   * holds no blocks — clicking a swatch with a bone selected should arm the
   * colour and otherwise be silent, not push an empty undo step.
   */
  paintSelected(colorIndex) {
    const blocks = this.editor.selectedParts().filter((p) => p?.vox);
    if (!blocks.length) return 0;
    this.pushHistory('塗る');
    for (const part of blocks) {
      part.vox.repaint(colorIndex);
      this.editor.rig.refreshBlock(part.id);
    }
    this.editor.refreshStats();
    this.ui.renderInspector(this.editor.selectedParts());
    return blocks.length;
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
    // Leaving the editor keeps the view and the selection, so a trip to the
    // field to try something does not cost the framing you set up to work in.
    if (previous === 'edit') { this._keepEditorView(); this.mainEditor.exit(); }
    if (previous === 'part') this.partEditor.exit();
    if (previous === 'title') this.titleScene.exit();

    if (FIELD_MODES.has(mode)) {
      this.hudCanvas.classList.remove('hidden');
      // A run may be fought with a machine other than the one on the bench.
      this.field.load(mode === 'solo' && this.soloMachine
        ? this.soloMachine : this.mainAssembly);
      // Where they last chose to fight, and whether they had the guns off.
      // A solo run is the director's to arrange, so it gets neither.
      const solo = mode === 'solo';
      // A run sets its own place, stage by stage; free play remembers where
      // the player last chose to be.
      this.field.setArena(solo ? SOLO_STAGES[0].arena : this._savedArena());
      this.field.setEnemyFire(solo ? true : this._savedFire());
      // Free play has no rules in charge; a solo run does, and it is the
      // rules that decide who turns up and when the run is over.
      this.field.setDirector(
        mode === 'solo' ? new SoloRun(this.field, { difficulty: this.difficulty }) : null,
      );
      // A fresh draw per run, so two runs are not the same fight — the run
      // is still decided by its seed, it is just a different one each time.
      if (mode === 'solo') this.field.restart(seedFromClock());
      this.field.enter();
      this.ui.syncArena(this.field.world.arenaId, this.field.enemyFire, !solo);
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
      // Back where you were looking, with what you had picked still picked.
      if (mode === 'edit') this._restoreEditorView();
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
    // Paused is exactly when somebody wants to be reminded which key does
    // what, and nothing is happening behind it to be hidden.
    this.ui.showFieldHint(Infinity);
    this.ui.setPaused(true);
  }

  resumeField() {
    // Coming back to the fight, the legend gets out of the way again.
    this.ui?.hideFieldHint?.();
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
  /**
   * Start a run.
   *
   * No asking where: a run is a ladder of places now, taken in order, and
   * choosing the first one would only be choosing which of them to skip.
   */
  /** Choose how hard a run is. Takes effect on the next one, not this one. */
  setDifficulty(id) {
    if (!DIFFICULTIES[id]) return this;
    this.difficulty = id;
    try { localStorage.setItem(DIFFICULTY_KEY, id); } catch { /* private mode */ }
    return this;
  }

  /**
   * Open the check before the door.
   *
   * A run used to start the instant the menu was pressed, so a machine with
   * no weapons on it found that out in wave one — and the difficulty, which
   * decides the whole run, was set on a menu row and then never seen again.
   */
  startSolo() {
    if (this.mode === 'solo') { this.restartField(); return this; }
    this.ui.result.close();
    this.ui.title.close();
    this.ui.sortie.show();
    return this;
  }

  /**
   * Actually go. Called by the sortie screen, and by nothing else.
   *
   * @param {object|null} machine a machine document to fight with, or null
   *   for whatever is on the bench. Taken as a copy either way: a run must
   *   never be a reason to lose what you were building.
   */
  beginSolo(machine = null) {
    this.ui.result.close();
    this.soloMachine = machine ? Assembly.fromJSON(machine) : null;
    this.setMode('solo');
    return this;
  }

  /** Back to the front page from wherever you are. */
  /**
   * Remember where the editor was looking, and what was picked.
   *
   * A trip to the field to try something and back rebuilt the view from
   * nothing, so every test cost the framing you had set up to work in.
   */
  _keepEditorView() {
    const ed = this.editor;
    this._editorView = {
      pos: ed.camera.position.toArray(),
      target: ed.controls.target.toArray(),
      selection: [...ed.selection],
    };
    return this;
  }

  _restoreEditorView() {
    const v = this._editorView;
    const ed = this.editor;
    if (!v) return this;
    ed.camera.position.fromArray(v.pos);
    ed.controls.target.fromArray(v.target);
    ed.controls.update();
    const alive = v.selection.filter((id) => this.assembly.get(id));
    if (alive.length) ed.select(alive);
    return this;
  }

  goTitle() {
    this.ui.result.close();
    this.ui.sortie.close();
    // Whatever the fight was doing, it is not doing it any more.
    this.field.setPaused(false);
    this.feedback.suspend();
    // The sortie screen opens over the title WITHOUT leaving title mode, so
    // backing out of it is a return to a mode we never left: setMode saw no
    // change, did nothing, and the front page stayed as a lit backdrop with
    // no menu on it. The panels are told where they are either way.
    const already = this.mode === 'title';
    this.setMode('title');
    if (already) this.ui.syncMode('title');
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
      // ? and F1 also bring the control legend back, for the times when
      // the question is "which key" rather than "what is this game".
      if ((e.code === 'F1' || (e.code === 'Slash' && e.shiftKey))
        && FIELD_MODES.has(this.mode) && !this.field.paused) {
        e.preventDefault();
        this.ui.showFieldHint();
        return;
      }
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
          // Shift aims the paste at the cursor: moving a detail to the
          // other end of the machine was paste, drag, then re-hang.
          case 'KeyV': e.preventDefault(); this.pasteClipboard(e.shiftKey); break;
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

        // Turn a part round where it stands, rather than making a mirrored
        // copy of it on the other side. Taken BEFORE the tool keys, because
        // F is one of them and switching tools is not what Shift+F means.
        if (e.code === 'KeyF' && e.shiftKey) {
          e.preventDefault();
          this.editor.flipSelected('x');
          return;
        }

        const tool = TOOL_KEYS[e.code];
        if (tool) { e.preventDefault(); this.setTool(tool); }
        if (e.code === 'KeyT') { e.preventDefault(); this.setGizmoMode('translate'); }
        if (e.code === 'KeyR') {
          e.preventDefault();
          // Ctrl+R does the last thing again: placing eight of something was
          // eight trips to the panel for a decision already made once.
          if (e.ctrlKey || e.metaKey) { this.editor.repeatLast(); return; }
          // With a part in hand, R turns the part rather than the gizmo:
          // most of the shapes have a front and a top, and until now the
          // only way to point one was to place it and then type an angle
          // into the inspector.
          if (PART_TOOLS.has(this.editor.tool)) this.editor.turnPlacement(e.shiftKey ? -1 : 1);
          else this.setGizmoMode('rotate');
        }
        if (e.code === 'PageUp' || e.code === 'PageDown') {
          e.preventDefault();
          this.editor.liftWorkPlane(e.code === 'PageUp' ? 1 : -1);
        }
        // Enter puts a part on the selected one. Placement was the only
        // verb in the editor with no key at all.
        if (e.code === 'Enter' && PART_TOOLS.has(this.editor.tool)) {
          e.preventDefault();
          this.editor.placeOnSelected(e.shiftKey ? 3 : 2);
          return;
        }
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
  /**
   * One frame: advance whatever this mode is made of, then draw it.
   *
   * `paint` exists for the browser suite, which drives thousands of frames
   * and looks at the pixels in nine of them. Everything the rules decide is
   * decided either way — what it skips is the draw, which costs about five
   * milliseconds in a visible window and anywhere from ninety to two hundred
   * and sixty in a backgrounded tab, where the suite lives.
   *
   * The scene graph is still brought up to date when the draw is skipped:
   * a renderer updates world matrices on its way through, and a test that
   * asks where a part ENDED UP has to get the same answer either way.
   */
  frame({ paint = true } = {}) {
    const elapsed = Math.min(this.clock.getDelta(), 0.25);
    this.tickDraft(elapsed);

    if (this.mode === 'title') {
      // A turntable and a menu. Nothing here is a fight, so it simply
      // follows the clock.
      this.titleScene.update(Math.min(elapsed, 1 / 20));
      if (paint) this.titleScene.render();
      else this.titleScene.scene?.updateMatrixWorld(true);
      return;
    }

    if (EDIT_MODES.has(this.mode)) {
      // The workbench has no simulation to keep honest; it just follows the
      // clock so dragging stays smooth at any refresh rate.
      this.editor.update(Math.min(elapsed, 1 / 20));
      if (paint) this.editor.render();
      else this.editor.scene.updateMatrixWorld(true);
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

    // Screen furniture runs on real seconds, not on the fight's clock.
    this.ui?.tickFieldHint?.(elapsed);
    // Where the fight IS, not where it was last put by hand. A run walks a
    // ladder of places and moves itself, so a label written only when the
    // player changes the arena goes stale the first time a stage clears.
    if (FIELD_MODES.has(this.mode) && this.field.world.arenaId !== this._shownArena) {
      this._shownArena = this.field.world.arenaId;
      this.ui?.syncArena?.(this._shownArena, this.field.enemyFire, !this.field.director);
    }
    // And the read-out is told how much of the top is spoken for, so it
    // never ends up underneath the legend at any window width.
    this.field.topInset = this.ui?.fieldHintHeight?.() ?? 0;

    this.field.present(elapsed);
    if (paint) this.field.render();
    else this.field.scene.updateMatrixWorld(true);

    // Asked here rather than inside the rules: whether a screen comes up is
    // not something the fight should be deciding.
    if (this.field.director?.finished && !this.ui.result.open) this._showResult();
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('beforeunload', this._onLeave);
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

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    window.__blostom = new App();
  });
}
