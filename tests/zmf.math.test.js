import { describe, it, expect } from 'vitest';
import {
  clamp, clamp01, lerp, sigmoid, softStep, smoothstep,
  damp, approach, slew, deadzone, expoCurve, RingBuffer,
} from '../src/zmf/math.js';

describe('scalar helpers', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });

  it('lerps', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(lerp(-1, 1, 0.5)).toBe(0);
  });

  it('sigmoid is centred and monotonic', () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 9);
    expect(sigmoid(6)).toBeGreaterThan(0.99);
    expect(sigmoid(-6)).toBeLessThan(0.01);
    let prev = -Infinity;
    for (let x = -5; x <= 5; x += 0.5) {
      const v = sigmoid(x);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('softStep crosses 0.5 at the midpoint', () => {
    expect(softStep(5, 0, 10)).toBeCloseTo(0.5, 6);
    expect(softStep(-20, 0, 10)).toBeLessThan(0.01);
    expect(softStep(30, 0, 10)).toBeGreaterThan(0.99);
  });

  it('smoothstep clamps hard at the ends', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 9);
  });

  it('smoothstep handles a descending ramp', () => {
    // "how close to empty": 1 at zero, 0 once comfortably above the edge
    expect(smoothstep(0.28, 0.02, 0)).toBe(1);
    expect(smoothstep(0.28, 0.02, 0.02)).toBe(1);
    expect(smoothstep(0.28, 0.02, 0.28)).toBe(0);
    expect(smoothstep(0.28, 0.02, 1)).toBe(0);
    expect(smoothstep(0.28, 0.02, 0.15)).toBeGreaterThan(0);
    expect(smoothstep(0.28, 0.02, 0.15)).toBeLessThan(1);
  });

  it('softStep handles a descending ramp too', () => {
    expect(softStep(0, 10, 0)).toBeGreaterThan(0.99);
    expect(softStep(10, 10, 0)).toBeLessThan(0.01);
  });

  it('degenerate edges do not divide by zero', () => {
    expect(smoothstep(1, 1, 0)).toBe(0);
    expect(smoothstep(1, 1, 2)).toBe(1);
    expect(Number.isFinite(softStep(0, 5, 5))).toBe(true);
  });
});

describe('damp', () => {
  it('closes half the gap in one half-life', () => {
    expect(damp(0, 1, 0.5, 0.5)).toBeCloseTo(0.5, 9);
    expect(damp(0, 1, 0.5, 1.0)).toBeCloseTo(0.75, 9);
  });

  it('is framerate independent', () => {
    let coarse = 0;
    coarse = damp(coarse, 1, 0.2, 0.1);
    let fine = 0;
    for (let i = 0; i < 10; i++) fine = damp(fine, 1, 0.2, 0.01);
    expect(fine).toBeCloseTo(coarse, 9);
  });

  it('snaps when the half-life is zero', () => {
    expect(damp(0, 5, 0, 0.016)).toBe(5);
  });
});

describe('approach and slew', () => {
  it('approach never overshoots', () => {
    expect(approach(0, 1, 100, 1)).toBe(1);
    expect(approach(0, 1, 0.5, 1)).toBeCloseTo(0.5, 9);
    expect(approach(1, 0, 0.5, 1)).toBeCloseTo(0.5, 9);
  });

  it('slew uses the rise rate when growing and the fall rate when shrinking', () => {
    expect(slew(0, 1, 10, 0.1, 0.1)).toBeCloseTo(1, 9);      // rise is fast
    expect(slew(1, 0, 10, 0.1, 0.1)).toBeCloseTo(0.99, 9);   // fall is slow
  });

  it('a sign flip counts as rising', () => {
    // crossing zero should use the rise rate, not decay through it
    expect(slew(0.1, -1, 10, 0.01, 0.1)).toBeCloseTo(-0.9, 6);
  });
});

describe('input shaping', () => {
  it('deadzone is silent inside and renormalised outside', () => {
    expect(deadzone(0.05, 0.1)).toBe(0);
    expect(deadzone(-0.05, 0.1)).toBe(0);
    expect(deadzone(1, 0.1)).toBeCloseTo(1, 9);
    expect(deadzone(0.55, 0.1)).toBeCloseTo(0.5, 9);
  });

  it('expo is identity at the extremes and softer in the middle', () => {
    expect(expoCurve(0, 0.5)).toBe(0);
    expect(expoCurve(1, 0.5)).toBeCloseTo(1, 9);
    expect(expoCurve(-1, 0.5)).toBeCloseTo(-1, 9);
    expect(Math.abs(expoCurve(0.5, 0.5))).toBeLessThan(0.5);
  });

  it('expo of zero is linear', () => {
    expect(expoCurve(0.3, 0)).toBeCloseTo(0.3, 9);
  });
});

describe('RingBuffer', () => {
  it('reports the newest sample first', () => {
    const r = new RingBuffer(3);
    r.push('a'); r.push('b'); r.push('c');
    expect(r.back(0)).toBe('c');
    expect(r.back(2)).toBe('a');
    expect(r.count).toBe(3);
  });

  it('overwrites the oldest once full', () => {
    const r = new RingBuffer(3);
    for (const v of ['a', 'b', 'c', 'd']) r.push(v);
    expect(r.count).toBe(3);
    expect(r.back(0)).toBe('d');
    expect(r.back(2)).toBe('b');
  });

  it('returns null past the end and after a clear', () => {
    const r = new RingBuffer(3);
    r.push('a');
    expect(r.back(1)).toBeNull();
    r.clear();
    expect(r.count).toBe(0);
    expect(r.back(0)).toBeNull();
  });
});
