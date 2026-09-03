import { InputFrame } from './InputFrame.js';
import { hex } from './StateHash.js';

/**
 * Everybody takes the same step at the same time, or nobody does.
 *
 * The fight is not sent. Each machine runs the whole simulation itself,
 * from one agreed seed, and the only thing that crosses the network is what
 * each player pressed. That is a few bytes a step instead of every position
 * of every machine and every round in the air, it cannot be cheated by
 * lying about where you are, and a replay is a seed and a list of presses.
 *
 * The price is that a step cannot run until EVERY player's input for it has
 * arrived. Two things pay it:
 *
 *   - Delay. A press is scheduled a few steps into the future rather than
 *     for now, so it has that long to cross the network before anybody is
 *     waiting on it. This is why netplay feels heavier than solo: the delay
 *     is real and it is the whole trade.
 *
 *   - Waiting. If a frame is late anyway, everyone stops together. Stopping
 *     together is not a bug — the alternative is one machine running a step
 *     the others have not, which is a fight that has forked, and a forked
 *     fight cannot be repaired by carrying on.
 *
 * Nothing here knows about sockets. It is handed frames and it hands back
 * ticks, so the same object drives a fight over a wire, a fight against a
 * recording, and a fight between two copies in one process — which is what
 * the tests use to prove the simulation is deterministic at all.
 */
export class Lockstep {
  /**
   * @param players ids, in an order every machine agrees on.
   * @param localId which of them is us.
   * @param delay how many steps ahead a press is scheduled. Two is tight
   *   and unforgiving; four rides out a bad connection and can be felt.
   * @param checkEvery how often to compare fingerprints, in steps.
   */
  constructor({ players, localId, delay = 3, checkEvery = 30 } = {}) {
    this.players = [...players];
    this.localId = localId;
    this.delay = Math.max(1, delay | 0);
    this.checkEvery = Math.max(0, checkEvery | 0);

    /** The next step to run. Nothing has run yet. */
    this.tick = 0;
    /**
     * The next step OUR press will be filed for.
     *
     * It counts on its own, one per press, rather than being worked out
     * from the current step. Working it out was a deadlock: while waiting
     * for somebody, the current step does not move, so every press went to
     * the same future step and the ones in between were never filled — and
     * those are exactly the steps everybody would go on to wait for.
     *
     * A press is produced once per sixtieth of a second whether or not the
     * fight is moving, so this walks forward at a steady rate and the steps
     * come out consecutive however badly the line is behaving.
     */
    this.sendTick = this.delay;
    /** tick -> playerId -> InputFrame */
    this.frames = new Map();
    /** tick -> playerId -> hash, for spotting a fork. */
    this.hashes = new Map();
    /** Steps spent waiting on somebody, which is the number worth showing. */
    this.stalled = 0;
    /** Set once the fight has forked. It does not un-fork. */
    this.desync = null;
    /** Who has gone away. Their machine keeps standing there. */
    this.dropped = new Set();
    /**
     * The step each of them stopped on.
     *
     * The step matters as much as the fact. Something has to take over a
     * machine whose player has gone, and if one client hands it to the
     * computer three steps before another does, those two clients are
     * running different fights from then on — the takeover is a change to
     * the simulation, so it happens on an agreed step or it is a fork.
     */
    this.dropAt = new Map();

    // The opening steps have nobody's input in them yet — the whole point
    // of the delay is that those steps were scheduled before the fight
    // began, so they are filled in now rather than waited for.
    for (let t = 0; t < this.delay; t++) {
      for (const p of this.players) this._put(t, p, InputFrame.idle());
    }
  }

  get localPlayers() { return this.players.filter((p) => p === this.localId); }

  /** The step a press made now will actually be played on. */
  get scheduledTick() { return this.tick + this.delay; }

  _put(tick, player, frame) {
    let row = this.frames.get(tick);
    if (!row) { row = new Map(); this.frames.set(tick, row); }
    // First one wins. A second frame for a step already decided would
    // rewrite history, and everybody else has already played it.
    if (!row.has(player)) row.set(player, frame);
    return row;
  }

  /**
   * Our own press, scheduled `delay` steps out.
   *
   * Returns what was scheduled and for when, which is exactly what has to
   * be sent — the receiving side must not guess the tick.
   */
  submitLocal(frame) {
    // Strictly the next one. Rounding this up to "at least the delay ahead
    // of the current step" looks harmless and is the same deadlock again:
    // the step in hand only moves when a press for it arrives, so raising
    // the floor skips the very steps everybody is about to wait for.
    let tick = this.sendTick;
    // Belt and braces, and STRICTLY behind: `tick` is the step about to
    // run, not one that has run, so filing for it is both legal and
    // necessary. Treating it as too late skipped it and every step up to
    // the delay — which is the deadlock this guard was meant to prevent,
    // arriving by the other door.
    if (tick < this.tick) tick = this.tick + this.delay;
    // And not so far ahead that a machine running fast has queued a second
    // of input nobody has asked for.
    if (tick > this.tick + this.delay * 4) return null;
    this.sendTick = tick + 1;
    this._put(tick, this.localId, frame);
    return { tick, frame, player: this.localId };
  }

  /** Somebody else's press, for the step they say it is for. */
  receive(player, tick, frame) {
    if (tick < this.tick) return false;      // already played without them
    if (!this.players.includes(player)) return false;
    this._put(tick, player, frame instanceof InputFrame ? frame : InputFrame.fromArray(frame));
    return true;
  }

  /**
   * A player has gone.
   *
   * Their machine stops pressing anything rather than vanishing: a fight
   * that removes a machine mid-step has to agree about WHICH step, and
   * "they stand still from the next one nobody is waiting on" is a rule
   * every client can apply to the same tick without being told.
   */
  drop(player, at) {
    const tick = Number.isFinite(at) ? Math.max(this.tick, at | 0) : this.firstMissing(player);
    this.dropped.add(player);
    // Never later than one already agreed. Two clients announcing the same
    // departure a step apart must not end up with two different answers.
    const had = this.dropAt.get(player);
    this.dropAt.set(player, had === undefined ? tick : Math.min(had, tick));
    return this;
  }

  /**
   * The first step we have nothing from this player for.
   *
   * This, and not "a few steps from now", is where a departure has to take
   * effect. Everything before it we have and everybody else has; everything
   * after it nobody will ever have. Picking a step further out would mean
   * waiting for input that is not coming.
   */
  firstMissing(player) {
    let t = this.tick;
    while (this.frames.get(t)?.has(player)) t++;
    return t;
  }

  /**
   * Has this player stopped, as of this step?
   *
   * From the agreed step onward their frames are IGNORED even if some
   * client happens to have them. One client playing a frame that another
   * never received is exactly the fork this is here to prevent.
   */
  isGone(player, tick) {
    const at = this.dropAt.get(player);
    return at !== undefined && tick >= at;
  }

  /** Everyone who has stopped, as of this step, in the agreed order. */
  goneAt(tick) { return this.players.filter((p) => this.isGone(p, tick)); }

  /** Is every player's input for this step in hand? */
  ready(tick = this.tick) {
    const row = this.frames.get(tick);
    for (const p of this.players) {
      if (this.isGone(p, tick)) continue;
      if (!row?.has(p)) return false;
    }
    return true;
  }

  /** Who is holding everybody up, so the wait can be explained. */
  waitingOn(tick = this.tick) {
    const row = this.frames.get(tick);
    return this.players.filter((p) => !row?.has(p) && !this.isGone(p, tick));
  }

  /** What every player pressed on this step, in player order. */
  framesFor(tick) {
    const row = this.frames.get(tick);
    return this.players.map((p) => (this.isGone(p, tick)
      ? InputFrame.idle()
      : row?.get(p) ?? InputFrame.idle()));
  }

  /**
   * Run every step that can be run, and no more.
   *
   * `step(frames, tick)` is the simulation. `max` stops one machine from
   * sprinting a hundred steps ahead after a hiccup and dropping the frame
   * it was trying to catch up for.
   */
  advance(step, max = 8) {
    let ran = 0;
    while (ran < max) {
      if (this.desync) break;
      if (!this.ready()) { this.stalled++; break; }
      const t = this.tick;
      step(this.framesFor(t), t);
      this.frames.delete(t);
      this.tick = t + 1;
      ran++;
    }
    return ran;
  }

  /** True on the steps everybody should be comparing fingerprints. */
  shouldCheck(tick) {
    return this.checkEvery > 0 && tick % this.checkEvery === 0;
  }

  /**
   * File a fingerprint, ours or theirs, and say whether the fight has
   * forked.
   *
   * The first disagreement is the only one worth reporting. After it the
   * two simulations are different fights and every later step will differ
   * too, so continuing to shout about it says nothing new.
   */
  reportHash(player, tick, hash) {
    if (this.desync) return this.desync;
    let row = this.hashes.get(tick);
    if (!row) { row = new Map(); this.hashes.set(tick, row); }
    row.set(player, hash >>> 0);

    let first = null;
    for (const [who, h] of row) {
      if (first === null) { first = { who, h }; continue; }
      if (h !== first.h) {
        this.desync = {
          tick,
          between: [first.who, who],
          hashes: [hex(first.h), hex(h)],
        };
        return this.desync;
      }
    }
    // Nothing older than the last agreed step is worth keeping.
    for (const t of this.hashes.keys()) if (t < tick - 4 * (this.checkEvery || 1)) this.hashes.delete(t);
    return null;
  }

  /** Everything worth putting on screen about the connection. */
  status() {
    return {
      tick: this.tick,
      delay: this.delay,
      stalled: this.stalled,
      waiting: this.waitingOn(),
      dropped: [...this.dropped],
      desync: this.desync,
    };
  }
}
