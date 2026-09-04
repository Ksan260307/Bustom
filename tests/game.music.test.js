import { describe, it, expect } from 'vitest';
import { Music, TRACKS, trackCount } from '../src/game/Music.js';

/** The smallest Audio the player needs, so this can run without a browser. */
function fakeAudio() {
  const made = [];
  class A {
    constructor() {
      this.src = '';
      this.loop = false;
      this.preload = '';
      this.volume = 0;
      this.paused = true;
      this.plays = 0;
      made.push(this);
    }

    play() { this.paused = false; this.plays++; return Promise.resolve(); }

    pause() { this.paused = true; }

    addEventListener() {}
  }
  globalThis.Audio = A;
  globalThis.document = globalThis.document ?? { baseURI: 'http://localhost/' };
  return made;
}

describe('the soundtrack', () => {
  it('has a piece for every screen there is', () => {
    // The game had a title, a workbench and a match, and all three were
    // silent apart from what the machine itself was doing.
    expect(Object.keys(TRACKS).sort()).toEqual(['fight', 'garage', 'space', 'title']);
  });

  it('starts a track when it is asked for, and only once', () => {
    const made = fakeAudio();
    const m = new Music();
    m.play('title');
    m.play('title');
    expect(made.length, 'one element for one track').toBe(1);
    expect(made[0].plays).toBe(1);
    expect(made[0].loop, 'and it loops').toBe(true);
  });

  it('fades between them rather than cutting', () => {
    // A track that stops dead reads as the game having crashed.
    const made = fakeAudio();
    const m = new Music({ volume: 0.5 });
    m.play('title');
    for (let i = 0; i < 60; i++) m.update(1 / 60);
    expect(made[0].volume, 'up to its own level').toBeCloseTo(0.5, 2);

    m.play('fight');
    m.update(0.1);
    expect(made[0].volume, 'the old one is on its way down').toBeLessThan(0.5);
    expect(made[0].volume, 'but not gone in a tenth of a second').toBeGreaterThan(0);
    expect(made[1].volume, 'and the new one on its way up').toBeGreaterThan(0);
  });

  it('stops a track only once it is actually silent', () => {
    const made = fakeAudio();
    const m = new Music({ volume: 0.5 });
    m.play('title');
    for (let i = 0; i < 60; i++) m.update(1 / 60);
    m.play(null);
    m.update(0.1);
    expect(made[0].paused, 'still running while it fades').toBe(false);
    for (let i = 0; i < 120; i++) m.update(1 / 60);
    expect(made[0].volume).toBe(0);
    expect(made[0].paused, 'and stopped once it is').toBe(true);
  });

  it('goes quiet when the game does', () => {
    const made = fakeAudio();
    const m = new Music({ volume: 0.5 });
    m.play('garage');
    for (let i = 0; i < 60; i++) m.update(1 / 60);
    m.setMuted(true);
    for (let i = 0; i < 120; i++) m.update(1 / 60);
    expect(made[0].volume).toBe(0);
  });

  it('carries on without any files at all', () => {
    // The whole kit is optional and the game is built to run with none of
    // it, so a missing track is an ordinary outcome and not an error.
    const saved = globalThis.Audio;
    globalThis.Audio = undefined;
    const m = new Music();
    expect(m.available).toBe(false);
    expect(() => { m.play('title'); m.update(1 / 60); }).not.toThrow();
    globalThis.Audio = saved;
  });
});

describe('three fight tracks, not one', () => {
  it('offers more than one piece for a fight', () => {
    expect(trackCount('fight')).toBeGreaterThan(1);
    expect(trackCount('title')).toBe(1);
    expect(trackCount('nothing')).toBe(0);
  });

  it('walks through them by stage, and comes round', () => {
    const m = new Music();
    const n = trackCount('fight');
    const seen = [];
    for (let stage = 0; stage < n; stage++) seen.push(m.fileFor('fight', stage));
    expect(new Set(seen).size, 'every stage up to the count is a new piece').toBe(n);
    expect(m.fileFor('fight', n), 'and then it repeats').toBe(seen[0]);
  });

  it('gives the same stage the same piece, every time', () => {
    // Not random: re-entering a fight must not restart the music on
    // something else.
    const m = new Music();
    expect(m.fileFor('fight', 3)).toBe(m.fileFor('fight', 3));
  });

  it('survives a pick that is not a number', () => {
    const m = new Music();
    expect(m.fileFor('fight', undefined)).toBeTruthy();
    expect(m.fileFor('fight', NaN)).toBeTruthy();
    expect(m.fileFor('fight', -2)).toBeTruthy();
  });

  it('a name with one piece ignores the pick', () => {
    const m = new Music();
    expect(m.fileFor('title', 7)).toBe(m.fileFor('title', 0));
  });
});
