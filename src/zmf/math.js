// ============================================================
//  ZMF : shared scalar helpers
//  Everything here is framerate-independent by construction.
// ============================================================

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mix = lerp;

/** Logistic curve centred on 0. `k` is the steepness. */
export const sigmoid = (x, k = 1) => 1 / (1 + Math.exp(-x * k));

/**
 * Sigmoid remapped so that s(edge0)=~0 and s(edge1)=~1, with soft shoulders.
 * edge1 may be below edge0 for a descending ramp.
 */
export function softStep(x, edge0, edge1, steepness = 6) {
  const half = (edge1 - edge0) * 0.5;
  if (Math.abs(half) < 1e-9) return x >= edge1 ? 1 : 0;
  return sigmoid(((x - (edge0 + edge1) * 0.5) / half) * steepness);
}

/**
 * Classic smoothstep, used where we want hard 0/1 clamping at the ends.
 * edge1 may be below edge0: smoothstep(0.28, 0.02, x) is a descending ramp
 * that reaches 1 as x falls, which is how "closeness to empty" is expressed.
 */
export function smoothstep(edge0, edge1, x) {
  const d = edge1 - edge0;
  if (Math.abs(d) < 1e-9) return x >= edge1 ? 1 : 0;
  const t = clamp01((x - edge0) / d);
  return t * t * (3 - 2 * t);
}

/**
 * Exponential approach that is stable at any dt.
 * `halfLife` is the time to close half the remaining gap.
 */
export function damp(current, target, halfLife, dt) {
  if (halfLife <= 0) return target;
  const t = 1 - Math.pow(2, -dt / halfLife);
  return current + (target - current) * t;
}

/** Move `current` toward `target` no faster than `rate` units/second. */
export function approach(current, target, rate, dt) {
  const d = target - current;
  const step = rate * dt;
  if (Math.abs(d) <= step) return target;
  return current + Math.sign(d) * step;
}

/**
 * Asymmetric rate limiter: separate rise and fall speeds.
 *
 * A reversal counts as rising (you are commanding thrust the other way), but
 * releasing to zero does NOT — otherwise every stick release would use the
 * spool-up rate and the asymmetric braking the model depends on would never
 * happen.
 */
export function slew(current, target, riseRate, fallRate, dt) {
  const reversing = current !== 0 && target !== 0 && Math.sign(target) !== Math.sign(current);
  const rising = reversing || Math.abs(target) > Math.abs(current);
  return approach(current, target, rising ? riseRate : fallRate, dt);
}

/** Deadzone with a smooth re-normalised ramp so the stick never "pops". */
export function deadzone(v, dz = 0.12) {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return Math.sign(v) * ((a - dz) / (1 - dz));
}

/** Sensitivity curve: `expo`=0 is linear, 1 is fully cubic. */
export function expoCurve(v, expo = 0.45) {
  const a = Math.abs(v);
  return Math.sign(v) * ((1 - expo) * a + expo * a * a * a);
}

/** A small ring buffer used by the target predictor and jerk meters. */
export class RingBuffer {
  constructor(size) {
    this.size = size;
    this.data = new Array(size).fill(null);
    this.head = 0;
    this.count = 0;
  }

  push(v) {
    this.data[this.head] = v;
    this.head = (this.head + 1) % this.size;
    this.count = Math.min(this.count + 1, this.size);
    return v;
  }

  /** `back(0)` is the newest sample. */
  back(i = 0) {
    if (i >= this.count) return null;
    return this.data[(this.head - 1 - i + this.size * 2) % this.size];
  }

  clear() { this.count = 0; this.head = 0; this.data.fill(null); }
}
