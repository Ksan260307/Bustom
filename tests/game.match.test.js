import { describe, it, expect } from 'vitest';
import { Match, ROUND, normaliseRules, DEFAULT_RULES } from '../src/game/Match.js';
import { STEP } from '../src/core/constants.js';

/** Run a match to its end, feeding it a script of who is standing. */
function play(match, standing, maxTicks = 200000) {
  const log = [];
  for (let t = 0; t < maxTicks && !match.over; t++) {
    const alive = standing(t, match);
    const ev = match.update(alive.alive, alive.health);
    if (ev.roundOver || ev.matchOver || ev.started) log.push({ t, ...ev });
  }
  return log;
}

describe('a match is rounds, a clock and a number to win', () => {
  it('counts in ticks, not in seconds', () => {
    // Every machine in a networked fight has to agree about when the round
    // ended. A clock fed by real time gives four computers four answers;
    // ticks are the one thing they already agree about exactly.
    const m = new Match({ roundSeconds: 300, readySeconds: 3 }, 2);
    expect(m.readyTicks).toBe(180);
    expect(m.roundTicks).toBe(18000);
    expect(m.roundTicks * STEP).toBe(300);
  });

  it('holds everybody still before the bell', () => {
    const m = new Match({ readySeconds: 3 }, 2);
    expect(m.phase).toBe(ROUND.READY);
    for (let i = 0; i < 179; i++) m.update([true, true]);
    expect(m.phase, 'still counting in').toBe(ROUND.READY);
    const ev = m.update([true, true]);
    expect(ev.started).toBe(true);
    expect(m.phase).toBe(ROUND.LIVE);
  });

  it('gives the round to the last one standing', () => {
    const m = new Match({ readySeconds: 1, breakSeconds: 1 }, 2);
    for (let i = 0; i < 61; i++) m.update([true, true]);
    const ev = m.update([true, false]);
    expect(ev.roundOver).toBe(true);
    expect(ev.winner).toBe(0);
    expect(m.score).toEqual([1, 0]);
  });

  it('and to whoever has most left when the clock runs out', () => {
    // The only reading of a timeout that is not a coin toss: whoever has
    // been winning it has more of their machine left.
    const m = new Match({ roundSeconds: 60, readySeconds: 0, breakSeconds: 1 }, 2);
    m.update([true, true]);
    for (let i = 0; i < 3600; i++) {
      const ev = m.update([true, true], [0.3, 0.7]);
      if (ev.roundOver) {
        expect(ev.byTime).toBe(true);
        expect(ev.winner).toBe(1);
        return;
      }
    }
    throw new Error('the clock never ran out');
  });

  it('calls a dead heat a draw, and gives it to nobody', () => {
    const m = new Match({ roundSeconds: 60, readySeconds: 0, breakSeconds: 1 }, 2);
    m.update([true, true]);
    let ev = null;
    for (let i = 0; i < 3600 && !ev?.roundOver; i++) ev = m.update([true, true], [0.5, 0.5]);
    expect(ev.winner).toBe(-1);
    expect(m.score).toEqual([0, 0]);
  });

  it('ends when somebody has won enough rounds', () => {
    const m = new Match({ wins: 3, readySeconds: 0, breakSeconds: 0, roundSeconds: 60 }, 2);
    const log = play(m, () => ({ alive: [true, false], health: [1, 0] }));
    expect(m.over).toBe(true);
    expect(m.winner).toBe(0);
    expect(m.score[0]).toBe(3);
    expect(log.filter((e) => e.roundOver).length).toBe(3);
  });

  it('ends even if every single round is a draw', () => {
    // A draw counts for nobody, so without a cap a match of nothing but
    // draws never finishes and everybody sits there.
    const m = new Match({ wins: 3, readySeconds: 0, breakSeconds: 0, roundSeconds: 60 }, 2);
    play(m, () => ({ alive: [true, true], health: [0.5, 0.5] }));
    expect(m.over, 'it stopped').toBe(true);
  });

  it('is the last one standing with four of them, not the first kill', () => {
    const m = new Match({ wins: 1, readySeconds: 0, breakSeconds: 0 }, 4);
    m.update([true, true, true, true]);
    let ev = m.update([true, false, true, true]);
    expect(ev.roundOver, 'three left is still a round').toBeUndefined();
    ev = m.update([false, false, false, true]);
    expect(ev.roundOver).toBe(true);
    expect(ev.winner).toBe(3);
  });
});

describe('the rules are what two people have to agree about', () => {
  it('fills in anything not said', () => {
    expect(normaliseRules({}).roundSeconds).toBe(DEFAULT_RULES.roundSeconds);
    expect(normaliseRules({ wins: 2 }).wins).toBe(2);
  });

  it('will not take a value that would break a match', () => {
    // These arrive over a wire from somebody else's copy of the game.
    expect(normaliseRules({ wins: 0 }).wins).toBe(1);
    expect(normaliseRules({ wins: 99 }).wins).toBe(5);
    expect(normaliseRules({ roundSeconds: -1 }).roundSeconds).toBe(60);
    expect(normaliseRules({ roundSeconds: 'nonsense' }).roundSeconds)
      .toBe(DEFAULT_RULES.roundSeconds);
  });

  it('is five minutes and first to three, unless somebody says otherwise', () => {
    expect(DEFAULT_RULES.roundSeconds).toBe(300);
    expect(DEFAULT_RULES.wins).toBe(3);
  });
});
