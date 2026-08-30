import { describe, it, expect } from 'vitest';
import {
  FACE, FACE_NORMAL, FACE_AXIS, FACE_OPPOSITE, FACE_NAME,
  VOX_LEVELS, DEFAULT_VOX, chunkSizeFor, snapSize,
  SIZE_MIN, SIZE_MAX, BONE_GAUGE, BONE_META, BONE, GAITS, EQUIP_META,
} from '../src/core/constants.js';

describe('every plate has a name for both screens', () => {
  it('the editor keeps Japanese, the fight speaks English', () => {
    // A katakana word in a strip of monospaced numerals reads as two
    // designs sharing a panel, and the read-out is the one screen where
    // that matters most.
    for (const [key, meta] of Object.entries(EQUIP_META)) {
      expect(meta.label, `${key} has an editor name`).toBeTruthy();
      expect(meta.en, `${key} has a read-out name`).toBeTruthy();
      expect(/^[A-Z0-9-]+$/.test(meta.en), `${key}: ${meta.en} is plain caps`).toBe(true);
    }
    // And no two plates share one, or the rack cannot be read.
    const names = Object.values(EQUIP_META).map((m) => m.en);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('face tables', () => {
  it('has six of everything, consistently indexed', () => {
    expect(FACE_NORMAL).toHaveLength(6);
    expect(FACE_AXIS).toHaveLength(6);
    expect(FACE_OPPOSITE).toHaveLength(6);
    expect(FACE_NAME).toHaveLength(6);
    expect(Object.keys(FACE)).toHaveLength(6);
  });

  it('normals are unit vectors along exactly one axis', () => {
    for (const n of FACE_NORMAL) {
      const nonZero = n.filter((v) => v !== 0);
      expect(nonZero).toHaveLength(1);
      expect(Math.abs(nonZero[0])).toBe(1);
    }
  });

  it('FACE_AXIS names the axis the normal runs along', () => {
    FACE_NORMAL.forEach((n, i) => {
      expect(n[FACE_AXIS[i]]).not.toBe(0);
    });
  });

  it('opposites are mutual and actually opposed', () => {
    FACE_OPPOSITE.forEach((o, i) => {
      expect(FACE_OPPOSITE[o]).toBe(i);
      // toBeCloseTo, because negating a zero component gives -0
      for (let a = 0; a < 3; a++) expect(FACE_NORMAL[o][a]).toBeCloseTo(-FACE_NORMAL[i][a], 10);
    });
  });

  it('maps the named faces to the expected normals', () => {
    expect(FACE_NORMAL[FACE.PZ]).toEqual([0, 0, 1]);   // forward
    expect(FACE_NORMAL[FACE.PY]).toEqual([0, 1, 0]);   // up
  });
});

describe('sculpt resolutions', () => {
  it('offers 1/16 through 1/100 with a sane default', () => {
    expect(VOX_LEVELS).toEqual([16, 32, 50, 100]);
    expect(VOX_LEVELS).toContain(DEFAULT_VOX);
  });

  it('picks a chunk size that divides the grid into a handful of chunks', () => {
    for (const n of VOX_LEVELS) {
      const cs = chunkSizeFor(n);
      expect(cs).toBeGreaterThan(0);
      const chunks = Math.ceil(n / cs);
      expect(chunks).toBeGreaterThanOrEqual(2);
      expect(chunks).toBeLessThanOrEqual(6);
    }
  });
});

describe('snapSize', () => {
  it('quantises to the 0.25 grid', () => {
    expect(snapSize(1.13)).toBeCloseTo(1.25, 6);
    expect(snapSize(1.1)).toBeCloseTo(1.0, 6);
    expect(snapSize(2.5)).toBeCloseTo(2.5, 6);
  });

  it('clamps to the allowed range', () => {
    expect(snapSize(-5)).toBe(SIZE_MIN);
    expect(snapSize(99)).toBe(SIZE_MAX);
  });
});

describe('bone metadata', () => {
  it('describes every bone attribute', () => {
    for (const key of Object.values(BONE)) {
      expect(BONE_META[key]).toBeTruthy();
      expect(typeof BONE_META[key].label).toBe('string');
    }
  });

  it('gauges are ordered thin < mid < thick', () => {
    expect(BONE_GAUGE.thin.radius).toBeLessThan(BONE_GAUGE.mid.radius);
    expect(BONE_GAUGE.mid.radius).toBeLessThan(BONE_GAUGE.thick.radius);
  });
});

describe('gaits', () => {
  it('are a set of keys and nothing a player is ever shown', () => {
    // The gait is how the code decides which legs to swing. It is not a
    // class of machine, and the moment it is put on screen it becomes one:
    // the next thing anyone builds is built toward the label rather than
    // toward the shape they wanted. There are no display names to show.
    expect([...GAITS].sort()).toEqual(['hop', 'hover', 'multileg', 'walk']);
  });
});
