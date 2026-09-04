import {
  describe, it, expect, beforeEach,
} from 'vitest';
import { Settings } from '../src/core/Settings.js';

/**
 * A check on the settings store's WRITE behaviour, which is the thing the
 * options screen makes easy to get wrong.
 *
 * Every control on that screen is bound to `input`, not `change` — which is
 * right, because a volume slider that only takes effect when you let go is
 * a volume slider you cannot set by ear. But `input` fires on every pixel
 * of a drag, and `Settings.set` writes to localStorage and notifies every
 * listener each time. Dragging one slider across its travel is therefore
 * dozens of synchronous writes and dozens of full re-applies — a renderer
 * target rebuilt, a pixel ratio recomputed — for one adjustment.
 */

function countingStore() {
  const map = new Map();
  const store = {
    writes: 0,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { store.writes++; map.set(k, String(v)); },
    removeItem: (k) => map.delete(k),
  };
  return store;
}

beforeEach(() => { globalThis.localStorage = countingStore(); });

describe('what one drag of a slider costs', () => {
  it('does not write to disk once per pixel', () => {
    const s = new Settings();
    localStorage.writes = 0;

    // What a pointer produces crossing a 150px slider: `input` on every
    // step, most of them landing on the same rounded value.
    for (let i = 0; i <= 60; i++) s.set('volumeMusic', Math.round((i / 60) * 20) / 20);

    // 21 distinct values over that travel (step 0.05), so at most 21 writes
    // if identical values are dropped — and no more than that.
    expect(localStorage.writes,
      `one drag caused ${localStorage.writes} synchronous writes`).toBeLessThanOrEqual(21);
  });

  it('tells listeners only when the value really moved', () => {
    const s = new Settings();
    let told = 0;
    s.onChange(() => { told++; });
    for (let i = 0; i < 30; i++) s.set('volumeMusic', 0.4);
    expect(told, 'the same value thirty times is one change').toBe(1);
  });

  it('and a settled drag leaves the value it ended on', () => {
    const s = new Settings();
    for (let i = 0; i <= 20; i++) s.set('volumeSfx', i / 20);
    expect(s.get('volumeSfx')).toBe(1);
  });
});

describe('applying a change is proportionate to the change', () => {
  it('a volume change does not ask the renderer for anything', () => {
    // The store cannot see the renderer, so this checks the contract the
    // app relies on: `set` reports WHICH key moved, so a listener can do
    // only the work that key needs rather than re-applying everything.
    const s = new Settings();
    const keys = [];
    s.onChange((key) => keys.push(key));
    s.set('volumeMusic', 0.3);
    s.set('quality', 'low');
    expect(keys).toEqual(['volumeMusic', 'quality']);
  });

  it('reset says so, rather than naming a key that did not change', () => {
    const s = new Settings();
    s.set('muted', true);
    const keys = [];
    s.onChange((key) => keys.push(key));
    s.reset();
    expect(keys).toEqual([null]);
  });
});
