import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import {
  Settings, QUALITY, QUALITY_ORDER, UI_SCALE_MIN, UI_SCALE_MAX,
} from '../src/core/Settings.js';

/**
 * The settings store did not exist, and neither did the five features that
 * had nowhere to live: a volume, a quality step, a text size, a reduced-
 * motion switch, an inverted axis. Every one of those was already
 * implemented somewhere and unreachable.
 *
 * What is worth testing here is not that a setter sets. It is that a store
 * READ FROM DISK cannot put a bad value into the renderer — because this
 * file is the one thing in the game a player can edit by hand, and a string
 * where a number goes takes the whole thing down at boot.
 */

function memoryStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}

beforeEach(() => {
  globalThis.localStorage = memoryStore();
});

describe('what the player is allowed to change', () => {
  it('starts somewhere sensible', () => {
    const s = new Settings();
    expect(s.get('volumeMaster')).toBeGreaterThan(0);
    expect(QUALITY[s.get('quality')]).toBeTruthy();
    expect(s.get('uiScale')).toBe(1);
    // Not a boolean: `null` means "whatever the OS was already told", which
    // is a third state and has to survive a round trip as one.
    expect(s.get('reduceMotion')).toBe(null);
  });

  it('remembers a change without being asked twice', () => {
    const a = new Settings();
    a.set('volumeMusic', 0.25);
    a.set('quality', 'low');
    const b = new Settings();
    expect(b.get('volumeMusic')).toBe(0.25);
    expect(b.get('quality')).toBe('low');
  });

  it('says whether anything actually changed', () => {
    const s = new Settings();
    expect(s.set('muted', true)).toBe(true);
    expect(s.set('muted', true), 'setting it to what it already is').toBe(false);
    expect(s.set('nonsense', 1), 'a field that does not exist').toBe(false);
  });

  it('tells whoever is listening, and lets them stop', () => {
    const s = new Settings();
    const seen = [];
    const off = s.onChange((key, value) => seen.push([key, value]));
    s.set('showFps', true);
    off();
    s.set('showFps', false);
    expect(seen).toEqual([['showFps', true]]);
  });

  it('does not let one bad listener stop the others', () => {
    const s = new Settings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen = [];
    s.onChange(() => { throw new Error('no'); });
    s.onChange(() => seen.push('second'));
    s.set('showFps', true);
    expect(seen).toEqual(['second']);
    warn.mockRestore();
  });
});

describe('a store read off disk is not to be trusted', () => {
  const write = (obj) => localStorage.setItem('blostom.settings.v1', JSON.stringify(obj));

  it('refuses a string where a number goes', () => {
    write({ volumeMaster: 'loud', uiScale: 'huge', mouseSensitivity: null });
    const s = new Settings();
    expect(s.get('volumeMaster')).toBe(0.8);
    expect(s.get('uiScale')).toBe(1);
    expect(s.get('mouseSensitivity')).toBe(1);
  });

  it('clamps a number that is out of range rather than passing it on', () => {
    write({ volumeMaster: 40, uiScale: 99, mouseSensitivity: -5 });
    const s = new Settings();
    expect(s.get('volumeMaster')).toBe(1);
    expect(s.get('uiScale')).toBe(UI_SCALE_MAX);
    expect(s.get('mouseSensitivity')).toBe(0.2);
  });

  it('refuses a quality step that is not one of ours', () => {
    write({ quality: 'ultra' });
    expect(new Settings().get('quality')).toBe('high');
  });

  it('takes only true for a switch, so a truthy string is not "on"', () => {
    write({ muted: 'yes', invertY: 1 });
    const s = new Settings();
    expect(s.get('muted')).toBe(false);
    expect(s.get('invertY')).toBe(false);
  });

  it('survives a store that is not JSON at all', () => {
    localStorage.setItem('blostom.settings.v1', '{{{');
    expect(() => new Settings()).not.toThrow();
    expect(new Settings().get('quality')).toBe('high');
  });

  it('survives having no store to read from', () => {
    const gone = globalThis.localStorage;
    globalThis.localStorage = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    };
    const s = new Settings();
    expect(() => s.set('muted', true)).not.toThrow();
    expect(s.get('muted'), 'the setting still applies for this session').toBe(true);
    globalThis.localStorage = gone;
  });
});

describe('the numbers other things actually read', () => {
  it('folds the master into the music and the effects', () => {
    const s = new Settings();
    s.set('volumeMaster', 0.5);
    s.set('volumeMusic', 0.5);
    s.set('volumeSfx', 1);
    expect(s.musicGain).toBeCloseTo(0.25, 6);
    expect(s.sfxGain).toBeCloseTo(0.5, 6);
  });

  it('mute wins over both', () => {
    const s = new Settings();
    s.set('volumeMaster', 1);
    s.set('muted', true);
    expect(s.musicGain).toBe(0);
    expect(s.sfxGain).toBe(0);
  });

  it('reduced motion follows the OS until somebody says otherwise', () => {
    globalThis.matchMedia = (q) => ({ matches: q.includes('reduce') });
    const s = new Settings();
    expect(s.get('reduceMotion'), 'nothing chosen').toBe(null);
    expect(s.motionReduced, 'so the OS answers').toBe(true);

    s.set('reduceMotion', false);
    expect(s.motionReduced, 'an explicit choice beats the OS').toBe(false);
    delete globalThis.matchMedia;
  });

  it('and does not fall over where there is no matchMedia', () => {
    delete globalThis.matchMedia;
    expect(new Settings().motionReduced).toBe(false);
  });

  it('every quality step is complete, and they are ordered cheap to dear', () => {
    for (const id of QUALITY_ORDER) {
      const q = QUALITY[id];
      expect(q, id).toBeTruthy();
      expect(typeof q.shadows, id).toBe('boolean');
      expect(typeof q.bloom, id).toBe('boolean');
      expect(q.msaa, id).toBeGreaterThanOrEqual(0);
      expect(q.pixelCap, id).toBeGreaterThan(0);
      expect(q.label, `${id} needs a name`).toBeTruthy();
      expect(q.blurb, `${id} needs to say what it costs`).toBeTruthy();
    }
    const caps = QUALITY_ORDER.map((id) => QUALITY[id].pixelCap);
    expect(caps, 'cheap to dear').toEqual([...caps].sort((a, b) => a - b));
    expect(QUALITY.low.shadows, 'the cheap one turns something off').toBe(false);
    expect(QUALITY.high.pixelCap).toBe(2);
  });

  it('the interface scale cannot be set below where text is still legible', () => {
    const s = new Settings();
    s.set('uiScale', 0.1);
    expect(s.get('uiScale')).toBe(UI_SCALE_MIN);
  });

  it('reset puts everything back', () => {
    const s = new Settings();
    s.set('quality', 'low');
    s.set('muted', true);
    s.set('uiScale', 1.4);
    s.reset();
    expect(s.get('quality')).toBe('high');
    expect(s.get('muted')).toBe(false);
    expect(s.get('uiScale')).toBe(1);
  });
});
