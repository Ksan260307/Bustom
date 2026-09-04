import { kitURL } from './Kit.js';

/**
 * The music, and the fact that there was none.
 *
 * The game had a title screen, a workbench and a match, and all three were
 * silent apart from what the machine itself was doing. Nothing else about
 * the presentation is as cheap to fix or as loud in its absence.
 *
 * Streamed rather than decoded. Every other sound here is a one-shot that
 * has to be ready the instant something happens, so it is fetched up front
 * and decoded into memory; a piece of music is minutes long, is wanted
 * within a second rather than within a frame, and would be eighteen
 * megabytes of decoded audio sitting in the heap for the whole session. An
 * ordinary audio element streams it, loops it, and costs nothing until it
 * is asked for.
 *
 * Which also means the music does NOT hold up the boot: the title screen
 * comes up first and the music arrives underneath it.
 */

/** How long a change of scene takes, in seconds. */
const FADE = 1.1;

/**
 * What plays where. Everything is CC0 — see LICENSES.md.
 *
 * A value may be a LIST, in which case the caller says which one it wants.
 * That exists for exactly one reason: a solo run walks seven arenas and
 * takes far longer than one 2.5-minute track, so a single fight song meant
 * the place the music is heard longest was the place it repeated soonest.
 */
export const TRACKS = {
  /** Loud and dark: the front page has to have some weight to it. */
  title: 'title.mp3',
  /** Three minutes and calm — this is the one you hear for an hour. */
  garage: 'garage.mp3',
  /**
   * The three brightest and busiest, in the order they were measured:
   * Doomed (bright 2824), Warped (1743), Great mission (1071).
   */
  fight: ['fight.mp3', 'fight2.mp3', 'fight3.mp3'],
  /** Barely there. Space is supposed to be empty. */
  space: 'space.ogg',
};

/** How many pieces are on offer for one name. */
export function trackCount(name) {
  const v = TRACKS[name];
  return Array.isArray(v) ? v.length : (v ? 1 : 0);
}

export class Music {
  constructor({ volume = 0.34 } = {}) {
    /** name -> HTMLAudioElement, made the first time each is asked for. */
    this.tracks = new Map();
    this.current = null;
    this.want = null;
    /** The file behind `want`, since one name can mean several. */
    this.wantFile = null;
    this.volume = volume;
    this.muted = false;
    this.available = typeof Audio !== 'undefined';
  }

  /**
   * One playable piece.
   *
   * Keyed by FILE rather than by name, so the three fight tracks are three
   * elements and switching between them is the same cross-fade as switching
   * screens — not a src swap on one element, which restarts and clicks.
   */
  _element(file) {
    let el = this.tracks.get(file);
    if (el) return el;
    if (!file || !this.available) return null;
    el = new Audio();
    el.src = kitURL(`music/${file}`);
    el.loop = true;
    el.preload = 'none';
    el.volume = 0;
    // A missing file is an ordinary outcome: the whole kit is optional and
    // the game is built to run without any of it.
    el.addEventListener('error', () => this.tracks.set(file, null));
    this.tracks.set(file, el);
    return el;
  }

  /**
   * Which file a name means this time.
   *
   * `pick` is whatever the caller has that varies and is not random — the
   * stage number, the round — so the same fight always sounds the same and
   * a run does not repeat until it has been through all three.
   */
  fileFor(name, pick = 0) {
    const v = TRACKS[name];
    if (!v) return null;
    if (!Array.isArray(v)) return v;
    const i = Number.isFinite(pick) ? Math.abs(Math.floor(pick)) : 0;
    return v[i % v.length];
  }

  /**
   * Ask for a piece. Nothing happens if it is already the one playing.
   *
   * `null` fades everything out, which is what a pause wants — a pause that
   * cuts the music dead reads as the game having crashed.
   */
  play(name, pick = 0) {
    const file = name ? this.fileFor(name, pick) : null;
    if (this.want === name && this.wantFile === file) return this;
    this.want = name;
    this.wantFile = file;
    if (!this.available) return this;
    const el = file ? this._element(file) : null;
    if (name && !el) return this;
    if (el) {
      el.play().catch(() => {
        // Before the first click a browser will refuse. The next call after
        // the player has touched anything succeeds, and everything here is
        // driven by them touching something.
      });
    }
    this.current = el ?? null;
    return this;
  }

  /**
   * Move every track toward where it should be.
   *
   * Called on the real clock rather than the fight's: music does not belong
   * to the simulation, and a fight that stalls waiting for somebody else's
   * input should not make the soundtrack stall with it.
   */
  update(dt) {
    if (!this.available) return this;
    const step = dt / FADE;
    for (const [, el] of this.tracks) {
      if (!el) continue;
      const target = (el === this.current && !this.muted) ? this.volume : 0;
      const v = el.volume;
      el.volume = Math.max(0, Math.min(1,
        v + Math.sign(target - v) * Math.min(step, Math.abs(target - v))));
      // Only stopped once it is actually silent, so a fade is a fade.
      if (el.volume <= 0.001 && el !== this.current && !el.paused) el.pause();
    }
    return this;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    return this;
  }

  setMuted(on) {
    this.muted = !!on;
    return this;
  }

  dispose() {
    for (const [, el] of this.tracks) {
      if (!el) continue;
      el.pause();
      el.src = '';
    }
    this.tracks.clear();
    this.current = null;
    return this;
  }
}
