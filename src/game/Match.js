import { STEP } from '../core/constants.js';

/**
 * What a match is: rounds, a clock, and a number of them to win.
 *
 * Everything here counts in STEPS, not seconds. A match is part of the
 * simulation — every machine in a networked fight has to agree about when
 * the round ended, who won it and when the next one starts, and a clock
 * fed by real time would give four machines four different answers. Ticks
 * are the one thing they already agree about exactly.
 *
 * So: no Date, no performance.now, nothing that a slower computer sees
 * differently. Feed it one tick per simulated step and every client walks
 * the same match.
 */

/** The rules, as chosen before anybody connects. */
export const DEFAULT_RULES = {
  /** How long one round runs, in seconds. */
  roundSeconds: 300,
  /** How many rounds it takes to win the match. */
  wins: 3,
  /** Seconds of standing still at the start of a round, before it is live. */
  readySeconds: 3,
  /** Seconds to look at the result of a round before the next one. */
  breakSeconds: 4,
  /** Whether a machine that is destroyed comes back inside the same round. */
  respawn: false,
};

export const RULE_LIMITS = {
  roundSeconds: [60, 600],
  wins: [1, 5],
};

/** The rules, as a thing that can be put on a wire and read back. */
export function normaliseRules(raw = {}) {
  const out = { ...DEFAULT_RULES };
  for (const k of Object.keys(DEFAULT_RULES)) {
    if (raw[k] === undefined) continue;
    if (typeof DEFAULT_RULES[k] === 'boolean') out[k] = !!raw[k];
    else {
      const [lo, hi] = RULE_LIMITS[k] ?? [0, 1e9];
      const n = Math.round(Number(raw[k]));
      out[k] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : DEFAULT_RULES[k];
    }
  }
  return out;
}

export const ROUND = {
  READY: 'ready',
  LIVE: 'live',
  DONE: 'done',
  MATCH: 'match',
};

/**
 * One match, driven a tick at a time.
 *
 * It is told who is still standing and it says what phase the match is in.
 * It does not move anybody, spawn anybody or draw anything — putting the
 * machines back on their corners is the field's job, and it does it when
 * this says a round has started.
 */
export class Match {
  constructor(rules = {}, seats = 2) {
    this.rules = normaliseRules(rules);
    this.seats = seats;
    /** Rounds won, per seat. */
    this.score = new Array(seats).fill(0);
    this.round = 1;
    this.phase = ROUND.READY;
    /** Ticks spent in the current phase. */
    this.clock = 0;
    /** Who won the round just finished, or -1 for a draw. */
    this.lastWinner = -1;
    /** Who won the match, or -1. */
    this.winner = -1;
    /** Set on the tick a round becomes live, so the field can put people back. */
    this.justStarted = true;
  }

  get readyTicks() { return Math.round(this.rules.readySeconds / STEP); }
  get roundTicks() { return Math.round(this.rules.roundSeconds / STEP); }
  get breakTicks() { return Math.round(this.rules.breakSeconds / STEP); }

  /** Seconds left in the round, for the read-out. Never negative. */
  get secondsLeft() {
    if (this.phase !== ROUND.LIVE) return this.rules.roundSeconds;
    return Math.max(0, (this.roundTicks - this.clock) * STEP);
  }

  /** Seconds until a round that has not started yet does. */
  get secondsToGo() {
    if (this.phase !== ROUND.READY) return 0;
    return Math.max(0, (this.readyTicks - this.clock) * STEP);
  }

  get over() { return this.phase === ROUND.MATCH; }

  /**
   * One step of the match.
   *
   * @param alive one entry per seat: is that machine still standing.
   * @param health one entry per seat, 0..1 — how a round that runs out of
   *   time is settled. Whoever has most left has been winning it, which is
   *   the only reading of a timeout that is not a coin toss.
   * @returns what happened this step, for whoever wants to react to it.
   */
  update(alive, health = null) {
    this.justStarted = false;
    if (this.phase === ROUND.MATCH) return { phase: this.phase };
    this.clock++;

    if (this.phase === ROUND.READY) {
      if (this.clock >= this.readyTicks) {
        this.phase = ROUND.LIVE;
        this.clock = 0;
        this.justStarted = true;
        return { phase: this.phase, started: true };
      }
      return { phase: this.phase };
    }

    if (this.phase === ROUND.LIVE) {
      const standing = [];
      for (let i = 0; i < this.seats; i++) if (alive[i]) standing.push(i);

      // Last one standing.
      if (standing.length <= 1) return this._endRound(standing[0] ?? -1);
      // Or the clock. Most left has been winning it.
      if (this.clock >= this.roundTicks) {
        let best = -1;
        let bestHp = -1;
        let tied = false;
        for (const i of standing) {
          const hp = health?.[i] ?? 0;
          if (hp > bestHp + 1e-9) { best = i; bestHp = hp; tied = false; }
          else if (Math.abs(hp - bestHp) <= 1e-9) tied = true;
        }
        return this._endRound(tied ? -1 : best, true);
      }
      return { phase: this.phase };
    }

    // ROUND.DONE — a moment to see the result, then the next round.
    if (this.clock >= this.breakTicks) {
      if (this.winner >= 0) {
        this.phase = ROUND.MATCH;
        this.clock = 0;
        return { phase: this.phase, matchOver: true, winner: this.winner };
      }
      this.round++;
      this.phase = ROUND.READY;
      this.clock = 0;
      return { phase: this.phase, nextRound: this.round };
    }
    return { phase: this.phase };
  }

  _endRound(winner, byTime = false) {
    this.phase = ROUND.DONE;
    this.clock = 0;
    this.lastWinner = winner;
    if (winner >= 0) {
      this.score[winner]++;
      // A draw counts for nobody, which means a match of nothing but draws
      // never ends — hence the round cap below.
      if (this.score[winner] >= this.rules.wins) this.winner = winner;
    }
    // Somebody has to win eventually. Enough rounds for everyone to reach
    // the target and lose the tie-break, and then it is whoever is ahead.
    const cap = this.rules.wins * 2 + 1;
    if (this.winner < 0 && this.round >= cap) {
      let best = -1;
      let bestScore = -1;
      let tied = false;
      this.score.forEach((n, i) => {
        if (n > bestScore) { best = i; bestScore = n; tied = false; }
        else if (n === bestScore) tied = true;
      });
      this.winner = tied ? -1 : best;
      if (this.winner < 0) this.winner = 0;
    }
    return { phase: this.phase, roundOver: true, winner, byTime };
  }

  /** Everything a read-out needs, in one object. */
  status() {
    return {
      phase: this.phase,
      round: this.round,
      score: [...this.score],
      wins: this.rules.wins,
      secondsLeft: this.secondsLeft,
      secondsToGo: this.secondsToGo,
      lastWinner: this.lastWinner,
      winner: this.winner,
    };
  }
}
