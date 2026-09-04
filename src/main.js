import * as THREE from 'three';
import { Assembly, PRESETS, PRESET_LIST, starterParts } from './core/Assembly.js';
import { LoopbackHub } from './net/Transport.js';
import { Session } from './net/Session.js';
import { InputFrame } from './net/InputFrame.js';
import { EditorScene, TOOL, PART_TOOLS } from './editor/EditorScene.js';
import { History } from './editor/History.js';
import { PartLibrary } from './editor/PartLibrary.js';
import { FieldScene } from './game/FieldScene.js';
import { ARENAS, DEFAULT_ARENA, getArena } from './game/Arenas.js';
import { loadKit, kitStatus, KIT_SFX, KIT_FX, KIT_LOOPS, sfxName } from './game/Kit.js';
import { Music } from './game/Music.js';
import {
  SoloRun, SOLO_STAGES, DIFFICULTIES, DEFAULT_DIFFICULTY,
} from './game/SoloRun.js';
import { TitleScene } from './game/TitleScene.js';
import { PostFX } from './game/PostFX.js';
import { seedFromClock } from './core/Random.js';
import { EditorUI } from './ui/EditorUI.js';
import { h } from './ui/dom.js';
import { InputManager, DEFAULT_BINDINGS } from './zmf/InputManager.js';
import { KineticFeedback } from './zmf/KineticFeedback.js';
import { SIZE_STEP, ACTION_BITS, STEP } from './core/constants.js';
import { Settings } from './core/Settings.js';
import { packDoc, unpackDoc, isPacked } from './core/Codec.js';
import { Replay, saveReplay } from './game/Replay.js';
import { hashFight } from './net/StateHash.js';
import { Options } from './ui/Options.js';
import { CrashReporter } from './ui/Crash.js';
import { t, onLocaleChange } from './ui/i18n.js';

/** How long one simulation step covers. Everything in the fight uses this. */
export { STEP } from './core/constants.js';
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

/**
 * Which tool each rebindable action selects.
 *
 * The keys themselves live in InputManager now, with the rest of the
 * bindings, so they show up on the key-config screen and can be moved. This
 * is the other half: what the action MEANS to the editor.
 */
const TOOL_OF = {
  toolSelect: TOOL.SELECT,
  toolBlock: TOOL.BLOCK,
  toolEquip: TOOL.EQUIP,
  toolLeg: TOOL.BONE_LEG,
  toolArm: TOOL.BONE_ARM,
  toolFace: TOOL.BONE_FACE,
  toolCustom: TOOL.BONE_CUSTOM,
  toolWeapon: TOOL.BONE_WEAPON,
  toolCarve: TOOL.CARVE,
  toolAdd: TOOL.ADD,
  toolPaint: TOOL.PAINT,
};

const EDIT_MODES = new Set(['edit', 'part']);
/** The two screens that are the arena: same scene, different rules. */
const FIELD_MODES = new Set(['field', 'solo', 'versus']);

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

/**
 * Boot timings, kept because the answer was surprising.
 *
 * The game took 4.7 SECONDS to reach its title screen, and the obvious
 * suspect — a 1.28 MB bundle with no code splitting — turned out to be 130
 * ms of that (73 fetch, 32 compile, measured in the shipped shell on a real
 * GPU and again on software rendering, which made no difference). So the
 * cost is in what the constructor DOES, and the only way to know which part
 * is to have marked them.
 *
 * `window.__blostom.boot` carries the result. It costs a handful of
 * `performance.now()` calls, once.
 */
export const bootMarks = [];
// The clock starts when this module is EVALUATED, which is after the whole
// import graph has been. The gap between that and the constructor is the
// part that turned out to matter.
if (typeof performance !== 'undefined') bootMarks.push(['module', performance.now()]);
const mark = (name) => {
  bootMarks.push([name, performance.now()]);
  return bootMarks;
};

/** The phases, in order, with how long each took. */
export function bootBreakdown(marks = bootMarks) {
  const out = [];
  for (let i = 1; i < marks.length; i++) {
    out.push({ phase: marks[i][0], ms: +(marks[i][1] - marks[i - 1][1]).toFixed(1) });
  }
  out.sort((a, b) => b.ms - a.ms);
  return out;
}

export class App {
  constructor({ canvas, hudCanvas, overlay } = {}) {
    mark('start');
    this.canvas = canvas ?? document.getElementById('gl');
    this.hudCanvas = hudCanvas ?? document.getElementById('hud');
    this.overlay = overlay ?? document.getElementById('overlay');

    /**
     * What the player has asked for. Read before the renderer is built,
     * because the renderer is one of the things it decides.
     */
    this.settings = new Settings();

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;

    mark('renderer');
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

    mark('post');
    // ---- the machine document
    this.mainAssembly = this._loadInitial();
    this.mainEditor = this._makeEditor();
    this.mainHistory = new History();
    this.mainEditor.setAssembly(this.mainAssembly);

    // ---- the part document
    this.partAssembly = Assembly.createPart('NEW PART');
    /*
     * The part editor is built on FIRST USE, not at boot.
     *
     * It is a second complete EditorScene — its own scene graph, its own
     * gizmo, its own rig — and it is reachable only from one button that
     * most sessions never press. Measured, the two editors together were
     * 369 ms of a 2.2 s boot; this is half of that back, paid for once by
     * whoever actually opens a part.
     */
    this._partEditor = null;
    this.partHistory = new History();
    /** Library entry the open part came from, for plain "save". */
    this.partSourceId = null;

    mark('editors');
    this.field = new FieldScene({
      renderer: this.renderer,
      hudCanvas: this.hudCanvas,
      input: this.input,
      feedback: this.feedback,
      post: this.post,
    });

    mark('field');
    this.titleScene = new TitleScene({ renderer: this.renderer, post: this.post });

    mark('titleScene');
    /**
     * The options screen, and the rebuild that a language change needs.
     *
     * Parts of this interface are built in a constructor and never
     * rebuilt — the title's menu rows, the tool buttons — so switching
     * language cannot be done by re-rendering. The whole overlay is torn
     * down and made again, which every panel here already supports because
     * that is how they are made in the first place.
     */
    this.options = new Options({
      settings: this.settings,
      onLanguage: () => this.rebuildInterface(),
    });
    this.overlay.append(this.options.el);

    /**
     * The one thing that speaks when nothing else can.
     *
     * Registered before anything that might throw, so a failure during the
     * rest of the boot still reaches the screen rather than the void.
     */
    this.crash = new CrashReporter({
      canvas: this.canvas,
      hasWork: () => this.dirty || !!this.draft(),
    });
    this.overlay.append(this.crash.el);

    /** The frame-rate read-out. Off by default; see the options screen. */
    this.fpsEl = h('div', { id: 'fps', class: 'hidden' });
    this.overlay.append(this.fpsEl);
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._fpsWorst = 0;

    this.ui = new EditorUI(this.overlay, this);
    this.ui.renderStats(this.editor.stats);
    this.ui.renderInspector(null);
    this.ui.renderLibrary();
    this.ui.syncHistory();

    /**
     * True while the offer to restore is up, so the net is not overwritten.
     *
     * Held from the first frame rather than from the moment the question is
     * asked: the question waits for the workbench, and between launch and
     * there the draft has to survive whatever else the session does.
     */
    /**
     * The soundtrack.
     *
     * Not part of the fight and not on its clock: a networked match that
     * stalls waiting for somebody's input must not take the music with it.
     */
    this.music = new Music();
    this._draftHeld = !!this.draft();
    /** Whether the last session has been offered back yet. */
    this._draftAsked = false;

    mark('ui');
    this.mode = null;
    this.setMode('title');
    mark('setMode');

    /**
     * The files, fetched in the background.
     *
     * Deliberately not awaited. Everything they replace has a procedural
     * version that has always been there and still works, so the title
     * screen comes up on that and the arena picks these up when they land —
     * which for three megabytes off local disk is long before anyone has
     * chosen where to fight. A boot that waits is a boot that can hang.
     */
    this.kitReady = loadKit().then((ok) => {
      // The arena standing when they land was built without them, and it is
      // the one the player walks into if they go straight to a fight —
      // `setArena` will not rebuild somewhere you are already standing, so
      // it has to be told to.
      if (ok) {
        this.field.world.rebuild();
        // The effect pools were built at the boot and the sprites land
        // after it, so the materials are told rather than rebuilt.
        this.field.effects?.useKit();
        // And the machines: a thruster's flame is part of the rig, so a rig
        // built before the sprites arrived has no flame on it. The bench is
        // rebuilt here; a machine in the field gets one when the field is
        // entered, which is always after this.
        this.editor.rebuild();
      }
      return kitStatus();
    });

    // Everything the store decides, applied once now and again on change.
    this.applySettings();
    this._offSettings = this.settings.onChange(() => this.applySettings());
    this._offLocale = onLocaleChange(() => this.ui?.syncAll?.());

    // The machine from last time, when it was written packed and so could
    // not be read synchronously. Lands within a few milliseconds, long
    // before the title screen has been read.
    this._loadPacked().catch((e) => console.warn('saved build not restored', e));

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
    mark('ready');
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /**
   * The frame-rate read-out.
   *
   * Averaged over half a second, and carrying the WORST frame in that
   * window as well as the mean — a game that holds 60 and drops one frame
   * in ten is not a game running at 58, and only the second number says so.
   * Off unless asked for; there was no way to ask before.
   */
  _tickFps(dt) {
    if (!this.fpsEl || !this.settings.get('showFps')) return;
    this._fpsAccum += dt;
    this._fpsFrames++;
    this._fpsWorst = Math.max(this._fpsWorst, dt);
    if (this._fpsAccum < 0.5) return;
    const fps = this._fpsFrames / this._fpsAccum;
    const worst = this._fpsWorst > 0 ? 1 / this._fpsWorst : fps;
    this.fpsEl.replaceChildren(
      h('b', {}, fps.toFixed(0)),
      ` fps ・ ${worst.toFixed(0)} min`,
    );
    this.fpsEl.classList.toggle('low', fps < 50 && fps >= 30);
    this.fpsEl.classList.toggle('bad', fps < 30);
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._fpsWorst = 0;
  }

  // ---------------------------------------------------------- settings

  /**
   * Push every setting out to whatever it governs.
   *
   * Called once at boot and again on any change, rather than each setting
   * knowing how to apply itself: there are eleven of them and four
   * subsystems, and the mapping is easier to get right — and to read — in
   * one place than spread across eleven callbacks.
   */
  applySettings() {
    const s = this.settings;
    const q = s.video;

    // ---- picture
    this.renderer.shadowMap.enabled = q.shadows;
    // The pixel ratio is ALSO re-applied on resize, because the display can
    // change under a window that never changed size — dragging it to a
    // second monitor is the ordinary case, and until now that left the game
    // rendering at the old screen's ratio until it was restarted.
    this._applyPixelRatio();
    this.post?.setQuality?.({ bloom: q.bloom, msaa: q.msaa });

    // ---- sound
    this.music?.setVolume(s.musicGain);
    this.feedback?.setGain?.(s.sfxGain);
    this.music?.setMuted(s.get('muted'));
    this.feedback?.setMuted?.(s.get('muted'));

    // ---- reading it
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(s.get('uiScale')));
    // Three states, not two: `auto` sets nothing and lets the media query
    // in style.css answer, which is what the OS was already told.
    const chosen = s.get('reduceMotion');
    if (chosen === null) delete root.dataset.motion;
    else root.dataset.motion = chosen ? 'reduced' : 'full';
    this.field?.setReducedMotion?.(s.motionReduced);
    this.field?.hud?.setScale?.(s.get('uiScale'));

    // ---- pointing
    this.input.setProfile?.({
      sensitivity: s.get('mouseSensitivity'),
      invertY: s.get('invertY'),
      invertStrafe: s.get('invertStrafe'),
    });

    // ---- the read-out
    this.fpsEl?.classList.toggle('hidden', !s.get('showFps'));
    return this;
  }

  /**
   * Match the renderer to the screen it is actually on.
   *
   * `devicePixelRatio` was read once, at boot. A window dragged from a
   * laptop panel to a 4K monitor kept rendering at the old ratio until the
   * game was restarted, which on Windows is an ordinary afternoon.
   */
  _applyPixelRatio() {
    const cap = this.settings?.video?.pixelCap ?? 2;
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    if (this._dpr === dpr) return false;
    this._dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.field?.hud?.setPixelRatio?.(dpr);
    return true;
  }

  /**
   * Build the interface again, in whatever language is now selected.
   *
   * Not a re-render: the title's menu rows, the workbench's tool buttons
   * and every panel's fixed furniture are made in a constructor and never
   * remade, so a re-render would leave half the screen in the old language.
   * Everything here knows how to build itself from the tables — that is how
   * it was made the first time — so making it again is both correct and
   * less code than tracking which node holds which string.
   */
  rebuildInterface() {
    const mode = this.mode;
    const wasOpen = this.options?.open;

    this.ui?.dispose?.();
    this.options?.dispose?.();
    this.overlay.replaceChildren();

    this.options = new Options({
      settings: this.settings,
      onLanguage: () => this.rebuildInterface(),
    });
    this.overlay.append(this.options.el);
    this.fpsEl = h('div', { id: 'fps', class: this.settings.get('showFps') ? '' : 'hidden' });
    this.overlay.append(this.fpsEl);

    this.ui = new EditorUI(this.overlay, this);
    this.ui.renderStats(this.editor.stats);
    this.ui.renderInspector(this.editor.selectedParts?.() ?? null);
    this.ui.renderLibrary();
    this.ui.syncHistory();

    // setMode is what puts the right panels on screen; it refuses a mode it
    // is already in, so it is told it is nowhere first.
    this.mode = null;
    this.setMode(mode);
    if (wasOpen) this.options.show();
    return this;
  }

  /** Open the options screen. */
  openOptions() {
    this.options?.show();
    return this;
  }

  _makeEditor() {
    const ed = new EditorScene({ renderer: this.renderer, canvas: this.canvas, post: this.post });
    ed.onChange = (stats) => this.ui?.renderStats(stats);
    ed.onSelect = (parts) => this.ui?.renderInspector(parts);
    ed.onBeforeChange = (label) => { this.pushHistory(label); this.touch(); };
    // A drag that lays a row of parts is ONE change, the way a slider drag is.
    ed.onGesture = (open) => (open ? this.beginGesture() : this.endGesture());
    ed.onHint = (hint) => this.ui?.showPlacementHint?.(hint);
    /*
     * A change that turned out to change nothing, taken back off the list.
     *
     * A stroke files its undo step BEFORE it knows whether it will do
     * anything, because it has to — the first dab is already a change by
     * the time it could tell. So a stroke on empty air, or one abandoned
     * halfway, leaves a row in the undo list that undoes nothing, and
     * pressing Ctrl+Z appears not to work.
     */
    ed.onCancelChange = () => this.undo({ quiet: true });
    /** The eyedropper: the colour under the cursor becomes the armed one. */
    ed.onPickColor = (i) => this.setColor(i);
    /** The brush changed — by slider, by key or by changing tool. */
    ed.onBrush = (pct, metres) => this.ui?.syncBrush?.(pct, metres);
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

  /**
   * The second editor, made the first time anybody asks for it.
   *
   * Everything that touches it goes through here, so there is no path that
   * can reach a half-built one — including `resize` and `dispose`, which
   * ask whether it exists rather than making one to tear down.
   */
  get partEditor() {
    if (!this._partEditor) {
      this._partEditor = this._makeEditor();
      this._partEditor.setAssembly(this.partAssembly);
      this._partEditor.exit();
      // It missed every resize that happened before it existed.
      this._partEditor.resize(
        Math.max(1, window.innerWidth), Math.max(1, window.innerHeight),
      );
    }
    return this._partEditor;
  }
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

  undo({ quiet = false } = {}) {
    if (!EDIT_MODES.has(this.mode)) return false;
    const entry = this.history.undo(this._snapshot());
    if (!entry) { this.ui.toastMsg(t('これ以上戻せません')); return false; }
    this._restore(entry.snapshot);
    this.ui.toastMsg(t('元に戻す: {0}', [t(entry.label)]));
    return true;
  }

  redo() {
    if (!EDIT_MODES.has(this.mode)) return false;
    const entry = this.history.redo(this._snapshot());
    if (!entry) { this.ui.toastMsg(t('やり直せる操作がありません')); return false; }
    this._restore(entry.snapshot);
    this.ui.toastMsg(t('やり直し: {0}', [t(entry.label)]));
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
    this.ui.toastMsg(t('{0} に移動しました', [getArena(arenaId).label]));
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
      this.ui.toastMsg(t('ソロランでは撃たせないようにはできません'));
      this.ui.syncArena(this.field.world.arenaId, true, false);
      return this;
    }
    this.field.setEnemyFire(on);
    try { localStorage.setItem(FIRE_KEY, on ? '1' : '0'); } catch { /* private mode */ }
    this.ui.syncArena(this.field.world.arenaId, this.field.enemyFire, !this.field.director);
    this.ui.toastMsg(on ? t('敵が撃ってきます') : t('敵は撃ってきません'));
    return this;
  }

  // ---------------------------------------------------------- clipboard

  copySelected({ cut = false } = {}) {
    const entries = this.editor.copySelected();
    if (!entries.length) { this.ui.toastMsg(t('コピーするパーツを選んでください')); return 0; }
    this.clipboard = entries;
    if (cut) {
      const removable = entries.filter((e) => e.parent);
      if (removable.length) this.editor.deleteSelected();
      this.ui.toastMsg(t('{0} パーツを切り取りました', [entries.length]));
    } else {
      this.ui.toastMsg(t('{0} パーツをコピーしました', [entries.length]));
    }
    return entries.length;
  }

  /**
   * @param {boolean} atCursor put it on the face under the pointer instead
   *   of beside the part it was copied from
   */
  pasteClipboard(atCursor = false) {
    if (!this.clipboard.length) { this.ui.toastMsg(t('クリップボードが空です')); return 0; }
    if (atCursor) {
      const put = this.editor.pasteHere(this.clipboard);
      if (put.length) {
        this.ui.renderPalette();
        this.ui.toastMsg(t('{0} パーツをカーソルの面に貼り付けました', [put.length]));
      }
      return put.length;
    }
    this.pushHistory(t('貼り付け'));
    const made = this.editor.paste(this.clipboard);
    if (!made.length) { this.ui.toastMsg(t('貼り付けできませんでした')); return 0; }
    this.editor.rebuild();
    this.editor.select(made);
    this.ui.renderPalette();
    this.ui.toastMsg(t('{0} パーツを貼り付けました', [made.length]));
    return made.length;
  }

  // ---------------------------------------------------------- state

  /**
   * The machine from last time, as far as can be had synchronously.
   *
   * A document written before the codec existed is plain JSON and comes
   * back here and now. A packed one cannot: inflating is asynchronous, so
   * this hands back a preset and `_loadPacked` swaps the real machine in a
   * few milliseconds later — which lands long before the title screen has
   * been read, let alone left.
   */
  _loadInitial() {
    try {
      const raw = localStorage.getItem(SAVE_KEY) ?? localStorage.getItem(SAVE_KEY_WAS);
      if (!raw) return PRESETS.biped.build();
      if (!isPacked(raw)) return Assembly.fromJSON(JSON.parse(raw));
      this._packedSave = raw;
    } catch (e) {
      console.warn('saved build could not be read, falling back to a preset', e);
    }
    return PRESETS.biped.build();
  }

  /** Finish what `_loadInitial` could not, and put it on the bench. */
  async _loadPacked() {
    const raw = this._packedSave;
    this._packedSave = null;
    if (!raw) return false;
    let asm;
    try {
      asm = Assembly.fromJSON(await unpackDoc(raw));
    } catch (e) {
      console.warn('saved build could not be unpacked, keeping the preset', e);
      return false;
    }
    // If the player has already started building in the meantime, their
    // work wins. It should never happen — this resolves in a few ms and the
    // game opens on the title screen — but "should never" is not "cannot".
    if (this.dirty) return false;
    this.mainAssembly = asm;
    this.mainEditor.setAssembly(asm);
    this.mainHistory.clear();
    if (EDIT_MODES.has(this.mode)) {
      this.ui?.syncName?.(asm.name);
      this.ui?.syncResolution?.(asm.voxRes);
      this.ui?.syncAll?.();
    }
    this.titleScene?.setAssembly?.(asm);
    return true;
  }

  /**
   * Write the machine down.
   *
   * Packed, which took the same document from 1.79 MB to 45 KB — see
   * Codec.js. And WRAPPED, which it never was: this was the one
   * localStorage write in the whole codebase with no try/catch on it, so a
   * full store threw out of a click handler, no toast appeared, and the
   * player was told nothing at all. A save that did not happen has to say
   * so; that is the entire job of a save button.
   */
  async save(slot = null) {
    if (this.mode === 'part') { this.savePart(); return; }
    this.mainAssembly.prunePalette();
    const name = this.mainAssembly.name;
    const packed = await packDoc(this.mainAssembly.toJSON());
    try {
      localStorage.setItem(SAVE_KEY, packed);
    } catch (e) {
      this.ui.toastMsg(t('保存できませんでした（容量不足）'));
      console.warn('save failed', e);
      return;
    }
    if (slot !== null) this._writeSlot(slot, packed);
    this.dirty = false;
    this.ui.renderPalette();
    this.ui.syncDirty?.(false);
    this.ui.toastMsg(t('「{0}」を保存しました', [name]));
  }

  /**
   * Mark the document as changed, and start the clock on the draft.
   *
   * Called from the same place undo entries come from, so anything worth
   * being able to take back is also worth not losing.
   */
  touch() {
    this.dirty = true;
    // The first change makes the offer meaningless — restoring on top of
    // work somebody has already started is the mistake the offer exists to
    // avoid in the other direction. Taking it down here also releases the
    // autosave, so this change is the first thing kept.
    this.ui?.foldDraft?.();
    // Never sooner than the last write earned. Restarting the clock on every
    // keystroke is right; restarting it to 1.5s on a document that takes two
    // seconds to write is not.
    if (this._draftIn <= 0) this._draftIn = this._draftDue;
    this.ui?.syncDirty?.(true);
    return this;
  }

  /**
   * Hold the autosave off while the offer to restore is on screen.
   *
   * Without this the offer goes stale as you look at it: the autosave keeps
   * running, so a minute into a new machine the draft being offered has
   * already been replaced by that machine, and "restore" restores what is
   * in front of you.
   */
  holdDraft(on) {
    this._draftHeld = !!on;
    return this;
  }

  /** Write the safety net, if it is owed. Driven from the frame clock. */
  tickDraft(dt) {
    if (this._draftHeld) return this;
    if (this._draftIn <= 0) return this;
    this._draftIn -= dt;
    if (this._draftIn > 0) return this;
    this._draftIn = 0;
    // Nothing has changed since the last one, so there is nothing to keep.
    if (!this.dirty) return this;
    // Never in the middle of a stroke: the one thing worse than a pause is
    // a pause while the brush is down.
    if (this.editor?.painting) { this._draftIn = DRAFT_AFTER; return this; }

    /*
     * The write itself is asynchronous now, because packing is — see
     * Codec.js. So this is started rather than performed, and the guard
     * stops a second one starting while the first is still going: the
     * document is measured in megabytes before it is packed, and two of
     * those in flight at once is the stutter this backoff exists to avoid.
     */
    if (this._draftWriting) return this;
    this._draftWriting = true;
    const began = performance.now();
    this._writeDraft().catch(() => {
      // A full or private store is not a reason to interrupt anybody.
    }).finally(() => {
      this._draftWriting = false;
      // What it cost decides when it may happen again.
      this._draftCost = (performance.now() - began) / 1000;
      this._draftDue = Math.max(DRAFT_AFTER, this._draftCost * DRAFT_BACKOFF);
    });
    return this;
  }

  async _writeDraft() {
    const packed = await packDoc(this.mainAssembly.toJSON());
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), doc: packed }));
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
  async restoreDraft() {
    const d = this.draft();
    if (!d) { this.ui.toastMsg(t('復元できる作業がありません')); return false; }
    let doc;
    try {
      // `doc` is what this writes now; `json` is what it wrote before the
      // codec existed. A draft left by the previous build still restores.
      doc = d.doc !== undefined ? await unpackDoc(d.doc) : d.json;
    } catch (e) {
      console.warn('draft could not be read', e);
      this.ui.toastMsg(t('読み込みに失敗しました'));
      return false;
    }
    this._adopt(Assembly.fromJSON(doc));
    this.ui.toastMsg(t('前回の続きから復元しました'));
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

  /** @param {string} packed a document already through the codec */
  _writeSlot(slot, packed) {
    const list = this.slots().filter((x) => x.id !== slot);
    list.unshift({
      id: slot, name: this.mainAssembly.name, at: Date.now(), doc: packed,
    });
    try {
      localStorage.setItem(SLOTS_KEY, JSON.stringify(list.slice(0, SLOT_LIMIT)));
    } catch (e) {
      this.ui.toastMsg(t('保存できませんでした（容量不足）'));
      console.warn('slot write failed', e);
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
  async openSlot(id) {
    const entry = this.slots().find((x) => x.id === id);
    if (!entry) { this.ui.toastMsg(t('見つかりません')); return false; }
    if (!this.confirmDiscard(t('「{0}」を開きます', [entry.name]))) return false;
    let doc;
    try {
      // `json` is what slots held before the codec; both still open.
      doc = entry.doc !== undefined ? await unpackDoc(entry.doc) : entry.json;
    } catch (e) {
      console.warn('slot could not be read', e);
      this.ui.toastMsg(t('読み込みに失敗しました'));
      return false;
    }
    this.pushHistory(t('「{0}」を開く', [entry.name]));
    this._adopt(Assembly.fromJSON(doc), { keepHistory: true });
    this.ui.toastMsg(t('「{0}」を開きました', [entry.name]));
    return true;
  }

  /** Forget one of the named saves. */
  deleteSlot(id) {
    const list = this.slots().filter((x) => x.id !== id);
    try {
      localStorage.setItem(SLOTS_KEY, JSON.stringify(list));
    } catch (e) {
      // Removing something cannot make the store fuller, so this is a real
      // failure rather than a full disk — and worth saying so.
      this.ui.toastMsg(t('保存できませんでした（容量不足）'));
      console.warn('slot delete failed', e);
    }
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
      ? window.confirm(t('保存していない変更があります。{0}破棄しますか？', [what ? `${what}。` : '']))
      : true;
    return ok;
  }

  load() {
    const raw = localStorage.getItem(SAVE_KEY) ?? localStorage.getItem(SAVE_KEY_WAS);
    if (!raw) { this.ui.toastMsg(t('保存データがありません')); return; }
    this._adopt(Assembly.fromJSON(JSON.parse(raw)));
    this.ui.toastMsg(t('読み込みました'));
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
        this.ui.toastMsg(t('{0} を読み込みました', [file.name]));
      } catch (e) {
        this.ui.toastMsg(t('読み込みに失敗しました'));
        console.error(e);
      }
    };
    inp.click();
  }

  loadPreset(key, { ask = true } = {}) {
    const p = PRESETS[key];
    if (!p) return;
    if (ask && !this.confirmDiscard(t('{0} を読み込みます', [t(p.label)]))) return;
    // Recorded first, and the history KEPT. A preset arriving over an hour
    // of work has to be recoverable, and "a deliberate fresh start" is not
    // a good enough reason to make one keystroke unrecoverable.
    this.pushHistory(t('{0} を読み込む', [t(p.label)]));
    this._adopt(p.build(), { keepHistory: true });
    this.ui.toastMsg(t('{0} を読み込みました', [t(p.label)]));
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
      if (!doc) { this.ui.toastMsg(t('パーツが見つかりません')); return; }
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
    this.ui.toastMsg(t('新しいパーツを作成しました'));
  }

  savePart(name = this.partAssembly.name) {
    this.partAssembly.prunePalette();
    this.partAssembly.name = String(name || 'PART').trim().toUpperCase() || 'PART';
    const entry = this.library.put(this.partAssembly.name, this.partAssembly);
    this.partSourceId = entry.id;
    this.ui.renderLibrary();
    this.ui.syncName(this.partAssembly.name);
    this.ui.toastMsg(t('パーツ庫に「{0}」を保存しました', [entry.name]));
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
    if (!ids.length) { this.ui.toastMsg(t('保存するパーツを選んでください')); return null; }

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
    const label = t(part.label) && t(part.label) !== 'BLOCK' ? t(part.label)
      : part.kind === 'bone' ? 'BONE' : 'PART';
    doc.name = `${this.mainAssembly.name}-${label}`.toUpperCase();
    const entry = this.library.put(doc.name, doc);
    this.ui.renderLibrary();
    // How much of the selection actually went, because "save these six" and
    // "save this one and its five children" look identical on screen.
    const took = doc.size;
    this.ui.toastMsg(t('パーツ庫に「{0}」を保存しました（{1} パーツ）', [entry.name, took]));
    return entry;
  }

  /** Arm the stamp tool so the next click grafts this part into the machine. */
  placePart(libraryId) {
    const doc = this.library.open(libraryId);
    if (!doc) { this.ui.toastMsg(t('パーツが見つかりません')); return; }
    if (this.mode !== 'edit') this.setMode('edit');
    this.editor.armStamp(doc);
    this.setTool(TOOL.STAMP);
    this.ui.toastMsg(t('「{0}」を置く場所をクリック', [doc.name]));
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
    this.ui.toastMsg(t('「{0}」を削除しました', [entry?.name ?? 'パーツ']));
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
      return t('パーツ庫「{0}」', [entry.name]);
    }
    if (this.mode !== 'edit') this.setMode('edit');
    this.pushHistory(t('共有コード読み込み'));
    this._adopt(assembly, { keepHistory: true });
    return t('メイン編集');
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
      this.ui.toastMsg(t('2つ以上選んでください。最後に選んだパーツが連結先になります'));
      return;
    }
    const anchor = this.assembly.get(this.editor.anchorId);
    const { connected, skipped, rigid } = this.editor.connectSelected();
    if (!connected) {
      this.ui.toastMsg(t('連結できませんでした（自分の子には連結できません）'));
      return;
    }
    const notes = [];
    if (skipped) notes.push(t('{0} 個は対象外', [skipped]));
    if (rigid) notes.push(t('{0} 個はボーンの固定側', [rigid]));
    const tail = notes.length ? `（${notes.join(' / ')}）` : '';
    this.ui.toastMsg(t('{0} パーツを {1} に連結しました{2}', [connected, anchor?.label ?? 'パーツ', tail]));
  }

  disconnectSelected() {
    const n = this.editor.disconnectSelected();
    this.ui.toastMsg(n ? t('{0} パーツの連結を解除しました', [n]) : t('解除できる連結がありません'));
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
    if (idx < 0) { this.ui.toastMsg(t('カラーが上限に達しました')); return; }
    this.editor.colorIndex = idx;
    // A colour off the wheel is the same decision as a colour off the
    // palette, and has to do the same thing. Two ways to pick a colour that
    // behave differently is one of them being wrong.
    this.paintSelected(idx);
    this.ui.noteColor(idx);
  }

  setVoxResolution(n, { force = false } = {}) {
    if (this.assembly.voxRes === n) return;
    /*
     * Finer costs every block at once, not one of them.
     *
     * Rebuilding is what a placement waits on, and it costs about what the
     * cell count says: half a second at a million and a half, eight seconds
     * at forty-eight million. So a machine that cannot be rebuilt in a
     * reasonable time is refused the setting rather than given a workbench
     * that hitches on every click.
     */
    if (n > this.assembly.voxRes && !this.assembly.fitsAtResolution(n)) {
      this.ui.syncResolution(this.assembly.voxRes);
      this.ui.toastMsg(t('この機体には細かすぎます。ブロックを減らすと 1/{0} にできます', [n]));
      return;
    }
    // Coarser means every grid is resampled DOWN, and detail that goes does
    // not come back by setting it fine again.
    const carved = [...this.assembly.parts.values()]
      .filter((p) => p.vox?.isCarved(p.shape)).length;
    if (carved && n < this.assembly.voxRes && !force) {
      this.ui.confirmAction({
        message: t('加工したブロックが{0}個あります。粗くすると細部が失われます。', [carved]),
        accept: () => this.setVoxResolution(n, { force: true }),
        cancel: () => this.ui.syncResolution(this.assembly.voxRes),
      });
      return;
    }
    this.pushHistory(t('加工の細かさ'));
    this.assembly.setVoxResolution(n);
    this.editor.rebuild();
    this.ui.syncResolution(n);
    this.ui.renderInspector(this.editor.selectedParts());
    this.ui.toastMsg(t('加工の細かさを 1/{0} にしました', [n]));
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
    this.pushHistory(t('全埋め'));
    part.vox.fill(this.editor.colorIndex);
    this._afterVoxelEdit(part);
  }

  bevelSelected() {
    const part = this._selectedBlock();
    if (!part) return;
    this.pushHistory(t('角落とし'));
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
    this.pushHistory(t('塗る'));
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


    if (FIELD_MODES.has(previous)) {
      // Leaving a fight ends the recording, and keeps it. Deliberately not
      // awaited: nothing about changing screens should wait on a write.
      const tape = this.field.stopRecording();
      if (tape?.length) {
        this.saveReplayOf(tape, this.mainAssembly?.name)
          .catch((e) => console.warn('replay not kept', e));
      }
      this.field.setReplay(null);
      this.field.exit();
    }
    // A fight against other people ends when you leave it, whichever way
    // you left. Nothing good comes of a socket outliving the screen.
    if (previous === 'versus') {
      this.field.setNetplay(null);
      this.ui.versus?.leave?.();
    }
    // Leaving the editor keeps the view and the selection, so a trip to the
    // field to try something does not cost the framing you set up to work in.
    if (previous === 'edit') { this._keepEditorView(); this.mainEditor.exit(); }
    if (previous === 'part') this._partEditor?.exit();
    if (previous === 'title') this.titleScene.exit();

    if (FIELD_MODES.has(mode)) {
      this.hudCanvas.classList.remove('hidden');
      // A recording, watched back. Set up exactly as a fight is — same
      // seed, same seats, same corners — with the presses coming off the
      // recording instead of off a socket.
      if (mode === 'versus' && this.pendingReplay) {
        const { replay, builds } = this.pendingReplay;
        this.pendingReplay = null;
        this.field.setEnemyFire(true);
        if (replay.arena) this.field.setArena(replay.arena);
        this.field.restart(replay.seed);
        this.field.setReplay(replay, builds);
        this.field.enter();
        this.resumeField();
        this._syncMusic(mode);
        this.ui.syncMode(mode);
        this.resize();
        return;
      }

      if (mode === 'versus' && this.pendingVersus) {
        // Every seat at once, in the order every machine agreed on. The
        // field builds them; nothing else about a fight changes.
        const { session, builds, seat, head } = this.pendingVersus;
        this.pendingVersus = null;
        this.field.setEnemyFire(true);
        this.field.setArena(this._savedArena());
        this.field.restart(session.seed);
        this.field.setNetplay(session, builds, seat);
        // Written down from the first step. One array push a tick, and the
        // whole fight replays from it — which this architecture was already
        // paying for and never spending.
        this.field.startRecording({ ...head, arena: this.field.world.arenaId });
        this.field.enter();
        this.ui.syncArena(this.field.world.arenaId, true, false);
        this.resumeField();
        this._syncMusic(mode);
        this.ui.syncMode(mode);
        this.resize();
        return;
      }
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
      /*
       * The last session, offered back the first time the workbench opens.
       *
       * Not at launch, which is where it used to be asked: at launch the
       * title screen is what is on the glass, so the question went up
       * behind it and timed out unread. Here it is the first thing on the
       * bench, which is also the first moment the answer means anything.
       */
      if (mode === 'edit' && !this._draftAsked) {
        this._draftAsked = true;
        this.ui.offerDraft?.();
        // Only where the draft did not already claim the screen — which it
        // does only for somebody who has been here before, so the two can
        // never both be right.
        this.ui.offerFirstRun?.();
      }
      this.ui.syncName(this.assembly.name);
      this.ui.syncResolution(this.assembly.voxRes);
      this.ui.syncTool(this.editor.tool);
      this.ui.renderPalette();
      this.ui.renderStats(this.editor.stats);
      this.ui.renderInspector(this.editor.selectedParts());
      this.ui.syncHistory();
    }
    this._syncMusic(mode);
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
  /**
   * What is playing, decided by where you are.
   *
   * Called once the arena is settled, not before. Choosing at the top of
   * `setMode` looked right and was not: entering the field REPLACES the
   * arena with the saved one a few lines later, so the music was picked
   * from wherever the player had been standing last time.
   *
   * Space gets its own piece — a track written for a fight on a hillside
   * is the wrong thing over somewhere with no air in it, and it is the one
   * place the game already treats differently in every other respect.
   */
  _syncMusic(mode) {
    if (!this.music) return this;
    if (FIELD_MODES.has(mode)) {
      if (this.field?.world?.arenaId === 'orbit') { this.music.play('space'); return this; }
      /*
       * Which of the three fight tracks.
       *
       * Chosen by the STAGE, so a solo run walks through them as it walks
       * through the arenas — which is the case that needed it: a ladder of
       * seven places took far longer than one 2.5-minute piece. Not random:
       * the same stage always sounds the same, and re-entering a fight does
       * not restart the music on something else.
       */
      this.music.play('fight', this.field?.director?.stage ?? 0);
    } else {
      this.music.play(mode === 'title' ? 'title' : 'garage');
    }
    return this;
  }

  /** The way in to a fight against other people. */
  openVersus() {
    this.ui.versus.show();
    return this;
  }

  /** They backed out of it, or it ended. */
  closeVersus() {
    this.ui.versus.session?.close();
    if (this.mode === 'versus') this.goTitle();
    return this;
  }

  /**
   * Everybody is ready: put the machines on the field.
   *
   * Each seat brings its own build, so what you fight is what they made —
   * that is most of the point of the game being a workbench. A build that
   * did not arrive falls back to the standard machine rather than failing
   * the whole fight over one bad message.
   */
  async beginVersus(session) {
    // Machines arrive PACKED — 45 KB rather than 1.79 MB, which is the
    // difference between a message that crosses the LAN relay and one that
    // silently never does. See Codec.js.
    const builds = await Promise.all(session.order.map(async (id) => {
      const doc = session.players.get(id)?.machine;
      try {
        if (!doc) return PRESETS.biped.build();
        return Assembly.fromJSON(typeof doc === 'string' ? await unpackDoc(doc) : doc);
      } catch (e) {
        console.warn('a machine did not arrive intact; standing in a preset', e);
        return PRESETS.biped.build();
      }
    }));
    this.ui.versus.hide();
    this.pendingVersus = {
      session,
      builds,
      seat: session.slotOf(session.id),
      // What the fight needs to be run again from nothing: the seed, the
      // seat order, and everybody's machine exactly as it arrived. Already
      // packed — that is how it crossed the network.
      head: {
        seed: session.seed,
        order: [...session.order],
        roster: session.roster.map((p) => ({
          id: p.id, name: p.name, machine: p.machine,
        })),
        rules: session.rules,
        mode: 'versus',
      },
    };
    this.setMode('versus');
    return this;
  }

  /**
   * Keep the fight that just finished.
   *
   * Packed like everything else, and quietly: a replay is the least
   * important thing in the store, so a failure here is logged and dropped
   * rather than shown. Nobody lost anything they were trying to keep.
   */
  async saveReplayOf(recorder, name) {
    if (!recorder || !recorder.length) return false;
    const id = `r${Date.now().toString(36)}`;
    try {
      const packed = await packDoc(recorder.toJSON());
      return saveReplay({
        id,
        name: name ?? '',
        at: recorder.head.at,
        ticks: recorder.length,
        mode: recorder.head.mode,
        seats: recorder.head.roster.map((r) => r.name),
      }, packed);
    } catch (e) {
      console.warn('replay not kept', e);
      return false;
    }
  }

  /**
   * Watch one back.
   *
   * The machines are unpacked here rather than in the replay itself, so
   * `Replay` stays a reader of presses and knows nothing about assemblies.
   */
  async watchReplay(doc) {
    const replay = new Replay(doc);
    const builds = await Promise.all(replay.order.map(async (id) => {
      const entry = replay.roster.find((r) => r.id === id);
      try {
        if (!entry?.machine) return PRESETS.biped.build();
        return Assembly.fromJSON(typeof entry.machine === 'string'
          ? await unpackDoc(entry.machine) : entry.machine);
      } catch (e) {
        console.warn('a machine in this recording did not open', e);
        return PRESETS.biped.build();
      }
    }));
    this.pendingReplay = { replay, builds };
    this.setMode('versus');
    return replay;
  }

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
        // Backing out of the offer keeps the draft, the way clicking off it
        // does. Only 破棄 throws it away.
        if (this.ui.draftOpen) { this.ui.foldDraft(); return; }
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

        const tool = TOOL_OF[this.input.toolFor(e.code)];
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
    // Not `w` and `h`: `h` is the DOM helper this module imports, and a
    // local that shadows it here is a bug waiting for the next person who
    // adds a line to this function.
    const winW = Math.max(1, window.innerWidth);
    const winH = Math.max(1, window.innerHeight);
    // The screen can change without the window changing size — dragging it
    // onto a second monitor is the ordinary case — and the pixel ratio was
    // read once at boot, so until now that left the game rendering at the
    // old display's ratio until it was restarted.
    this._applyPixelRatio();
    this.renderer.setSize(winW, winH, false);
    this.post.setSize(winW, winH);
    this.mainEditor.resize(winW, winH);
    this._partEditor?.resize(winW, winH);
    this.field.resize(winW, winH);
    this.titleScene.resize(winW, winH);
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
    this._tickFps(elapsed);
    this.tickDraft(elapsed);
    // Before anything that returns early: the music plays on every screen,
    // and the workbench — where it plays longest — is one of the ones that
    // never reaches the bottom of this function.
    this.music?.update(elapsed);

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
      // A networked fight does not step because time passed; it steps when
      // everybody's presses for the step have arrived. The clock still runs
      // at a steady sixtieth so the presses go out at a steady rate — it is
      // the FIGHT that waits, not the reading of the keyboard.
      if (this.field.netplay) this.field.netAdvance(STEP);
      else this.field.update(STEP);
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
      // A run changes arena without changing MODE, so this is the only
      // place a stage advance is noticed — and the fight track is chosen by
      // stage, so it has to be noticed here too.
      this._syncMusic(this.mode);
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
    this._partEditor?.dispose();
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
    // What the boot actually cost, in phases. See bootMarks.
    window.__blostom.boot = bootBreakdown();
    window.__blostom.bootMarks = bootMarks;
    /*
     * The networking, reachable from outside the app.
     *
     * Only the harness uses it, and only to stand two sessions up in one
     * process — a fight two copies here cannot agree on is a fight two
     * computers have no hope with, and it can be checked in a millisecond.
     * Nothing in the game reads this.
     */
    // The list itself, so a check that counts sounds counts the real list
    // rather than a number somebody has to remember to update.
    window.__blostom.KIT_SFX = KIT_SFX.map(sfxName);
    window.__blostom.KIT_FX = KIT_FX;
    window.__blostom.KIT_LOOPS = KIT_LOOPS;
    window.__blostom_net = {
      LoopbackHub, Session, InputFrame, Replay,
      hashFight,
      forwardAndFire: (1 << ACTION_BITS.indexOf('forward'))
        | (1 << ACTION_BITS.indexOf('fire')),
    };
  });
}
