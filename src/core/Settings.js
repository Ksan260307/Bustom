// ============================================================
//  Everything the player is allowed to change about the game itself.
//
//  There was no such place before this. Sound had a master gain of 0.22 and
//  music a volume of 0.34, both written into the source; `setMuted` existed
//  on both mixers and was called by nothing; `profile.invertY` was read on
//  every mouse move and could not be set; shadows, bloom and MSAA were all
//  forced on with no way down. Each of those is a small omission and they
//  add up to one large one: a player whose machine cannot run the game, or
//  who is made ill by the camera, or who cannot hear it over a stream, had
//  nothing to do about any of it.
//
//  Design notes:
//
//  - ONE STORE, WRITTEN ONCE PER CHANGE. Not one key per setting: reading
//    eleven keys at boot is eleven synchronous localStorage hits before the
//    first frame.
//
//  - EVERY VALUE IS VALIDATED ON THE WAY IN. This file is read from disk,
//    and disk is not to be trusted — a hand-edited store, or one written by
//    an older build, must not be able to put a string where a number goes
//    and take the renderer down with it.
//
//  - DEFAULTS COME FROM THE MACHINE WHERE THE MACHINE KNOWS BETTER. Reduced
//    motion follows the OS setting, so somebody who has already told their
//    computer they get motion sick does not have to tell us as well.
// ============================================================

const STORE = 'blostom.settings.v1';

/** Quality steps, coarse on purpose: three real choices beat nine knobs. */
export const QUALITY = {
  low: {
    label: '軽い', shadows: false, bloom: false, msaa: 0, pixelCap: 1,
    blurb: '影とにじみを切り、描画も等倍。古いノートPC向け',
  },
  medium: {
    label: 'ふつう', shadows: true, bloom: true, msaa: 2, pixelCap: 1.5,
    blurb: '影は出す。にじみは軽く、描画は少し粗く',
  },
  high: {
    label: 'きれい', shadows: true, bloom: true, msaa: 4, pixelCap: 2,
    blurb: 'すべて有効。これまでの見た目',
  },
};

export const QUALITY_ORDER = ['low', 'medium', 'high'];

/**
 * How big the interface is drawn.
 *
 * The whole UI was written in hard pixels — twenty-five rules at 11px,
 * twenty-two at 10px, five at 9px — which is legible on the 1080p screen it
 * was built on and genuinely unreadable on a 4K panel at 100%. This scales
 * the lot from one place; see `--ui-scale` in style.css.
 */
export const UI_SCALE_MIN = 0.85;
export const UI_SCALE_MAX = 1.6;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function prefersReducedMotion() {
  try {
    return typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * The shape of the store, and how to read each field safely.
 *
 * `read` is handed whatever was on disk and must return something valid or
 * the default. There is no path through this table that can produce a bad
 * value, which is the point of writing it as a table.
 */
const FIELDS = {
  // ---- sound
  volumeMaster: { def: 0.8, read: (v) => (Number.isFinite(v) ? clamp(v, 0, 1) : 0.8) },
  volumeMusic: { def: 0.5, read: (v) => (Number.isFinite(v) ? clamp(v, 0, 1) : 0.5) },
  volumeSfx: { def: 0.85, read: (v) => (Number.isFinite(v) ? clamp(v, 0, 1) : 0.85) },
  muted: { def: false, read: (v) => v === true },

  // ---- picture
  quality: { def: 'high', read: (v) => (QUALITY[v] ? v : 'high') },
  showFps: { def: false, read: (v) => v === true },

  // ---- reading it
  uiScale: {
    def: 1,
    read: (v) => (Number.isFinite(v) ? clamp(v, UI_SCALE_MIN, UI_SCALE_MAX) : 1),
  },
  reduceMotion: { def: null, read: (v) => (v === true || v === false ? v : null) },

  // ---- pointing
  mouseSensitivity: { def: 1, read: (v) => (Number.isFinite(v) ? clamp(v, 0.2, 3) : 1) },
  invertY: { def: false, read: (v) => v === true },
  /*
   * Strafing was inverted by default and could not be changed. That is a
   * defensible choice for a machine seen from behind — but it has to be a
   * choice the player can make, and until now nobody could.
   */
  invertStrafe: { def: true, read: (v) => v === true },
};

export class Settings {
  constructor(initial = null) {
    this.values = {};
    for (const [k, f] of Object.entries(FIELDS)) this.values[k] = f.def;
    this.listeners = new Set();
    if (initial) this._merge(initial);
    else this.load();
  }

  _merge(raw) {
    if (!raw || typeof raw !== 'object') return this;
    for (const [k, f] of Object.entries(FIELDS)) {
      if (raw[k] !== undefined) this.values[k] = f.read(raw[k]);
    }
    return this;
  }

  load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) this._merge(JSON.parse(raw));
    } catch {
      // A store we cannot read is a store we replace on the next change.
    }
    return this;
  }

  save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.values));
    } catch {
      // Private mode. The settings still apply for this session.
    }
    return this;
  }

  get(key) { return this.values[key]; }

  /** @returns {boolean} whether anything actually changed */
  set(key, value) {
    const f = FIELDS[key];
    if (!f) return false;
    const next = f.read(value);
    if (next === this.values[key]) return false;
    this.values[key] = next;
    this.save();
    for (const fn of [...this.listeners]) {
      try { fn(key, next, this); } catch (e) { console.warn('settings listener failed', e); }
    }
    return true;
  }

  /** @returns {() => void} unsubscribe */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  reset() {
    for (const [k, f] of Object.entries(FIELDS)) this.values[k] = f.def;
    this.save();
    for (const fn of [...this.listeners]) {
      try { fn(null, null, this); } catch (e) { console.warn('settings listener failed', e); }
    }
    return this;
  }

  // ---------------------------------------------------------- derived

  /** The quality preset now selected, as its table row. */
  get video() { return QUALITY[this.values.quality] ?? QUALITY.high; }

  /**
   * Whether to hold the camera and the effects still.
   *
   * `null` — which is the default — means "whatever the operating system
   * was already told". Only an explicit choice in the options overrides it,
   * so the setting reads as three states and stores as three.
   */
  get motionReduced() {
    const v = this.values.reduceMotion;
    return v === null ? prefersReducedMotion() : v;
  }

  /** Music gain, after the master and the mute. */
  get musicGain() {
    return this.values.muted ? 0 : this.values.volumeMaster * this.values.volumeMusic;
  }

  /** Effect gain, after the master and the mute. */
  get sfxGain() {
    return this.values.muted ? 0 : this.values.volumeMaster * this.values.volumeSfx;
  }
}

export { prefersReducedMotion };
