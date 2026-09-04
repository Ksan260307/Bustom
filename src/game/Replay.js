// ============================================================
//  Replays, which this game was already most of the way to having.
//
//  A fight here is deterministic: one seed, a fixed step, two seeded random
//  streams, and inputs quantised to integers before ANYBODY acts on them —
//  including the player who moved the mouse. All of that was built so that
//  two computers could run the same fight from the same commands. A replay
//  is the same trick with the second computer removed.
//
//  So a recording is not video. It is:
//
//      the seed  ・  who was in it  ・  their machines  ・  every press
//
//  A minute of a four-player fight is 3,600 ticks x 4 frames x 9 bytes,
//  which packs to a few kilobytes. Compare that with the 1.79 MB a single
//  machine used to take, and the whole feature costs less than one save.
//
//  WHAT MAKES A REPLAY WRONG, and what this is careful about:
//
//    - Anything read from the wall clock. The fight already has none.
//    - Anything read from `Math.random`. The fight already has none, and
//      the presentation layer has its own stream that is deliberately NOT
//      the fight's — so a replay looks slightly different in its sparks
//      and is identical in its outcome, which is the correct trade.
//    - The frame rate. Steps are fixed; a replay of a fight recorded at
//      144 Hz plays back the same on a machine managing 30.
// ============================================================

import { InputFrame } from '../net/InputFrame.js';

/** Bumped when the recorded shape changes in a way that cannot be read. */
export const REPLAY_FORMAT = 1;

/** How many recordings to keep. They are small, but not free. */
export const REPLAY_KEEP = 12;

/**
 * A fight, being written down as it happens.
 *
 * One entry per tick, each an array of one frame per seat, so the shape on
 * disk is exactly the shape the simulation asks for on the way back.
 */
export class Recorder {
  /**
   * @param {object} head
   * @param {number} head.seed
   * @param {string[]} head.order        seat order, as the session settled it
   * @param {Array} head.roster          [{ id, name, machine }] — machines packed
   * @param {object|null} [head.rules]
   * @param {string} [head.arena]
   * @param {string} [head.mode]         'versus' | 'solo' | 'field'
   */
  constructor(head) {
    this.head = {
      format: REPLAY_FORMAT,
      at: Date.now(),
      seed: head.seed >>> 0,
      order: [...(head.order ?? [])],
      roster: head.roster ?? [],
      rules: head.rules ?? null,
      arena: head.arena ?? null,
      mode: head.mode ?? 'versus',
    };
    /** ticks[i] is an array of packed frames, one per seat. */
    this.ticks = [];
    this.recording = true;
  }

  get length() { return this.ticks.length; }

  /** How long the recording covers, in seconds at the fixed step. */
  seconds(step = 1 / 60) { return this.ticks.length * step; }

  /**
   * One step of the fight.
   *
   * `frames` is what the simulation was actually handed — not what any one
   * player pressed. That distinction is the whole reliability of this: a
   * frame that arrived late and was filled with idle is recorded as idle,
   * so the replay makes the same mistake the fight did and ends the same
   * way.
   */
  push(frames) {
    if (!this.recording) return this;
    const row = [];
    for (const f of frames) {
      row.push(f ? [f.buttons | 0, f.yaw | 0, f.pitch | 0, f.zoom | 0, f.dash | 0] : null);
    }
    this.ticks.push(row);
    return this;
  }

  stop() { this.recording = false; return this; }

  /** The whole recording, as something the codec can pack. */
  toJSON() {
    return { ...this.head, ticks: this.ticks };
  }
}

/**
 * A recording, being read back.
 *
 * Deliberately shaped like the thing the fight already takes: `pump` hands
 * over one tick's frames and runs the caller's step, exactly as the lockstep
 * session does. Nothing in FieldScene needs to know which one it is talking
 * to.
 */
export class Replay {
  constructor(doc) {
    if (!doc || doc.format !== REPLAY_FORMAT) {
      throw new Error('この記録は読めません');
    }
    this.doc = doc;
    this.seed = doc.seed >>> 0;
    this.order = [...doc.order];
    this.roster = doc.roster ?? [];
    this.rules = doc.rules ?? null;
    this.arena = doc.arena ?? null;
    this.mode = doc.mode ?? 'versus';
    this.ticks = doc.ticks ?? [];
    this.tick = 0;
    /** 1 is real time; 2 is twice as fast. Whole steps either way. */
    this.speed = 1;
    this.paused = false;
  }

  get length() { return this.ticks.length; }

  get done() { return this.tick >= this.ticks.length; }

  seconds(step = 1 / 60) { return this.ticks.length * step; }

  /** Where we are, 0..1. */
  get progress() {
    return this.ticks.length ? Math.min(1, this.tick / this.ticks.length) : 1;
  }

  /**
   * Jump. Only backwards is free — going forward means running the fight,
   * because there is nothing else that knows what the world looked like.
   *
   * @returns {number} the tick actually landed on
   */
  seek(tick) {
    this.tick = Math.max(0, Math.min(this.ticks.length, Math.floor(tick)));
    return this.tick;
  }

  /** The frames for one tick, as InputFrames. */
  frameAt(tick) {
    const row = this.ticks[tick];
    if (!row) return this.order.map(() => InputFrame.idle());
    return row.map((f) => (f ? new InputFrame(f[0], f[1], f[2], f[3], f[4]) : InputFrame.idle()));
  }

  /**
   * Run up to `speed` steps, handing each one to `step(frames, tick)`.
   *
   * @returns {number} how many steps actually ran
   */
  pump(step) {
    if (this.paused) return 0;
    let ran = 0;
    for (let i = 0; i < Math.max(1, Math.round(this.speed)); i++) {
      if (this.done) break;
      step(this.frameAt(this.tick), this.tick);
      this.tick++;
      ran++;
    }
    return ran;
  }
}

// ---------------------------------------------------------- storage

const STORE = 'blostom.replays.v1';

/**
 * The saved recordings, newest first, as headers only.
 *
 * The frames are kept beside them under their own key, so opening the list
 * does not read a megabyte of presses nobody is going to watch.
 */
export function listReplays() {
  try {
    const raw = localStorage.getItem(STORE);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const bodyKey = (id) => `${STORE}.${id}`;

/**
 * Keep one, and drop the oldest past the limit.
 *
 * @param {object} head     what the list shows: id, name, at, ticks, mode
 * @param {string} packed   the whole recording, through the codec
 */
export function saveReplay(head, packed) {
  const list = listReplays().filter((r) => r.id !== head.id);
  list.unshift(head);
  const keep = list.slice(0, REPLAY_KEEP);
  const dropped = list.slice(REPLAY_KEEP);
  try {
    localStorage.setItem(bodyKey(head.id), packed);
    localStorage.setItem(STORE, JSON.stringify(keep));
    for (const r of dropped) localStorage.removeItem(bodyKey(r.id));
  } catch (e) {
    // Out of room. Drop this recording rather than the game: a replay is
    // the least important thing being stored.
    try { localStorage.removeItem(bodyKey(head.id)); } catch { /* nothing */ }
    return false;
  }
  return true;
}

/** The packed body of one recording, or null. */
export function loadReplayBody(id) {
  try {
    return localStorage.getItem(bodyKey(id));
  } catch {
    return null;
  }
}

export function deleteReplay(id) {
  const list = listReplays().filter((r) => r.id !== id);
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
    localStorage.removeItem(bodyKey(id));
  } catch {
    return false;
  }
  return true;
}
