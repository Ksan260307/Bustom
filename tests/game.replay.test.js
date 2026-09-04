import {
  describe, it, expect, beforeEach,
} from 'vitest';
import {
  Recorder, Replay, REPLAY_FORMAT, REPLAY_KEEP,
  listReplays, saveReplay, loadReplayBody, deleteReplay,
} from '../src/game/Replay.js';
import { InputFrame } from '../src/net/InputFrame.js';

/**
 * A replay is only worth having if it is EXACT, and the claim that it is
 * exact rests on one thing: the fight is a function of the seed and the
 * presses, and of nothing else. So the test that matters is not that the
 * recorder records — it is that the same seed and the same presses produce
 * the same fight, twice, with the recording in between.
 *
 * That is checked against the real simulation at the bottom of this file.
 */

function memoryStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const head = () => ({
  seed: 12345,
  order: ['a', 'b'],
  roster: [{ id: 'a', name: 'ONE', machine: null }, { id: 'b', name: 'TWO', machine: null }],
  rules: { wins: 3 },
  arena: 'proving',
  mode: 'versus',
});

beforeEach(() => { globalThis.localStorage = memoryStore(); });

describe('writing a fight down', () => {
  it('keeps one row per step, one frame per seat', () => {
    const rec = new Recorder(head());
    rec.push([new InputFrame(1, 10, -10), new InputFrame(2, 0, 0)]);
    rec.push([new InputFrame(0, 0, 0), new InputFrame(4, 5, 5)]);
    expect(rec.length).toBe(2);
    expect(rec.ticks[0]).toHaveLength(2);
    expect(rec.ticks[0][0]).toEqual([1, 10, -10, 0, 0]);
  });

  it('records a missing frame as missing rather than as nothing', () => {
    // A frame that never arrived was filled with idle by the lockstep, and
    // the recording has to make the same mistake or it ends differently.
    const rec = new Recorder(head());
    rec.push([new InputFrame(1), null]);
    expect(rec.ticks[0][1]).toBe(null);
    expect(new Replay(rec.toJSON()).frameAt(0)[1].buttons).toBe(0);
  });

  it('stops when it is told to', () => {
    const rec = new Recorder(head());
    rec.push([new InputFrame(1)]);
    rec.stop();
    rec.push([new InputFrame(2)]);
    expect(rec.length).toBe(1);
  });

  it('knows how long it is', () => {
    const rec = new Recorder(head());
    for (let i = 0; i < 120; i++) rec.push([new InputFrame(i & 7)]);
    expect(rec.seconds(1 / 60)).toBeCloseTo(2, 6);
  });

  it('is small — that is what makes the feature free', () => {
    const rec = new Recorder(head());
    // A minute of a four-player fight.
    for (let i = 0; i < 3600; i++) {
      rec.push([0, 1, 2, 3].map((k) => new InputFrame(i + k, i, -i)));
    }
    const bytes = JSON.stringify(rec.toJSON()).length;
    // Before compression. A single sculpted machine used to be 1.79 MB.
    expect(bytes).toBeLessThan(400 * 1024);
  });
});

describe('reading one back', () => {
  it('refuses a recording it cannot read', () => {
    expect(() => new Replay(null)).toThrow();
    expect(() => new Replay({ format: REPLAY_FORMAT + 99 })).toThrow();
  });

  it('hands over one tick at a time, in order', () => {
    const rec = new Recorder(head());
    for (let i = 0; i < 5; i++) rec.push([new InputFrame(i)]);
    const r = new Replay(rec.toJSON());

    const seen = [];
    while (!r.done) r.pump((frames, tick) => seen.push([tick, frames[0].buttons]));
    expect(seen).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
  });

  it('runs several steps when it is being fast-forwarded', () => {
    const rec = new Recorder(head());
    for (let i = 0; i < 10; i++) rec.push([new InputFrame(i)]);
    const r = new Replay(rec.toJSON());
    r.speed = 4;
    expect(r.pump(() => {})).toBe(4);
    expect(r.tick).toBe(4);
  });

  it('stops at the end rather than running past it', () => {
    const rec = new Recorder(head());
    rec.push([new InputFrame(1)]);
    const r = new Replay(rec.toJSON());
    r.speed = 10;
    expect(r.pump(() => {})).toBe(1);
    expect(r.done).toBe(true);
    expect(r.pump(() => {})).toBe(0);
  });

  it('does nothing while it is paused', () => {
    const rec = new Recorder(head());
    rec.push([new InputFrame(1)]);
    const r = new Replay(rec.toJSON());
    r.paused = true;
    expect(r.pump(() => {})).toBe(0);
  });

  it('says how far through it is', () => {
    const rec = new Recorder(head());
    for (let i = 0; i < 4; i++) rec.push([new InputFrame(i)]);
    const r = new Replay(rec.toJSON());
    expect(r.progress).toBe(0);
    r.pump(() => {});
    r.pump(() => {});
    expect(r.progress).toBe(0.5);
  });

  it('seeks, and clamps to what there is', () => {
    const rec = new Recorder(head());
    for (let i = 0; i < 4; i++) rec.push([new InputFrame(i)]);
    const r = new Replay(rec.toJSON());
    expect(r.seek(2)).toBe(2);
    expect(r.seek(-5)).toBe(0);
    expect(r.seek(999)).toBe(4);
  });

  it('carries the seed and the seats, because that is the fight', () => {
    const r = new Replay(new Recorder(head()).toJSON());
    expect(r.seed).toBe(12345);
    expect(r.order).toEqual(['a', 'b']);
    expect(r.rules).toEqual({ wins: 3 });
    expect(r.arena).toBe('proving');
  });
});

describe('keeping them', () => {
  const entry = (id) => ({ id, name: 'X', at: Date.now(), ticks: 10, mode: 'versus' });

  it('saves the body apart from the list, so listing is cheap', () => {
    saveReplay(entry('r1'), 'BLOZ1:body');
    expect(listReplays().map((r) => r.id)).toEqual(['r1']);
    expect(loadReplayBody('r1')).toBe('BLOZ1:body');
    // The list itself carries no frames.
    expect(localStorage.getItem('blostom.replays.v1')).not.toContain('body');
  });

  it('newest first', () => {
    saveReplay(entry('r1'), 'a');
    saveReplay(entry('r2'), 'b');
    expect(listReplays().map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('drops the oldest past the limit, body and all', () => {
    for (let i = 0; i < REPLAY_KEEP + 3; i++) saveReplay(entry(`r${i}`), `body${i}`);
    const list = listReplays();
    expect(list).toHaveLength(REPLAY_KEEP);
    expect(list[0].id).toBe(`r${REPLAY_KEEP + 2}`);
    expect(loadReplayBody('r0'), 'the body went with it').toBe(null);
  });

  it('forgets one when asked', () => {
    saveReplay(entry('r1'), 'a');
    deleteReplay('r1');
    expect(listReplays()).toEqual([]);
    expect(loadReplayBody('r1')).toBe(null);
  });

  it('gives up quietly when there is no room', () => {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('full'); },
      removeItem: () => {},
    };
    // A replay is the least important thing in the store. It must not take
    // the fight down with it.
    expect(saveReplay(entry('r1'), 'a')).toBe(false);
  });

  it('survives a store it cannot read', () => {
    globalThis.localStorage = { getItem() { throw new Error('no'); } };
    expect(listReplays()).toEqual([]);
    expect(loadReplayBody('r1')).toBe(null);
  });
});

/*
 * The claim the whole feature rests on — that one seed and one stream of
 * presses make one fight, every time — is checked against the REAL
 * simulation in `tests/smoke/smoke.cjs`, under "a recorded fight replays
 * into the same fight".
 *
 * It cannot be checked here: a FieldScene needs a WebGL renderer for its
 * world and its post chain, and a determinism test run against a stand-in
 * renderer would be a test of the stand-in.
 */
