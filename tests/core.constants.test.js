import { describe, it, expect } from 'vitest';
import {
  FACE, FACE_NORMAL, FACE_AXIS, FACE_OPPOSITE, FACE_NAME,
  VOX_LEVELS, DEFAULT_VOX, chunkSizeFor, snapSize,
  SIZE_MIN, SIZE_MAX, BONE_GAUGE, BONE_META, BONE, GAIT_LABEL,
} from '../src/core/constants.js';

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

describe('gait labels', () => {
  it('labels every gait, and calls 3+ legs multileg', () => {
    expect(Object.keys(GAIT_LABEL).sort()).toEqual(['hop', 'hover', 'multileg', 'walk']);
    expect(GAIT_LABEL.multileg).toBe('多脚');
  });
});
