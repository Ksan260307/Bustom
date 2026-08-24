// ============================================================
//  A random number generator you can replay.
//
//  `Math.random()` cannot be repeated, so anything that used it made the
//  match unrepeatable: the same inputs from the same start would produce a
//  different fight every time, and a test that caught a bug could not be
//  re-run to confirm the fix.
//
//  This is a small integer hash generator instead. It carries its own seed,
//  so a match is fully described by "which seed, and which keys were
//  pressed on which step" — nothing else.
//
//  Simulation and presentation get SEPARATE streams. Sparks and screen
//  shake must never be able to shift where a bullet goes, and keeping them
//  on their own stream makes that impossible rather than merely unlikely.
// ============================================================

/** 2^32, as a float. Used to turn the 32-bit state into 0..1. */
const TWO32 = 4294967296;

export class Random {
  constructor(seed = 1) {
    this.reseed(seed);
  }

  reseed(seed) {
    // Any seed lands somewhere usable, including 0, which a plain LCG
    // would otherwise get stuck on.
    this.state = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
    if (this.state === 0) this.state = 0x6d2b79f5;
    this.count = 0;
    return this;
  }

  /** Next 32-bit value. This is the only place the state advances. */
  next() {
    // xorshift32: three shifts, no multiply, identical on every engine
    // because it never leaves the integer domain.
    let x = this.state;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.state = x;
    this.count++;
    return x;
  }

  /** 0 ≤ v < 1. */
  unit() { return this.next() / TWO32; }

  /** -1 ≤ v < 1 — the shape most of the callers actually wanted. */
  signed() { return this.unit() * 2 - 1; }

  /** a ≤ v < b. */
  range(a, b) { return a + this.unit() * (b - a); }

  /** -1 or +1. */
  sign() { return (this.next() & 1) ? 1 : -1; }

  /** True with probability `p`. */
  chance(p) { return this.unit() < p; }

  /** A point on the unit sphere, written into `out`. */
  direction(out) {
    // Cosine-uniform in z, uniform in angle: the naive "three random
    // components, normalised" clumps at the cube's corners.
    const z = this.signed();
    const a = this.unit() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return out.set(Math.cos(a) * r, z, Math.sin(a) * r);
  }

  /** Enough to restore this generator exactly. */
  save() { return { state: this.state, count: this.count }; }

  restore({ state, count = 0 }) {
    this.state = state >>> 0;
    this.count = count;
    return this;
  }
}

/** A seed from the clock, for when nobody asked for a particular one. */
export const seedFromClock = () => (Date.now() ^ (performance.now() * 1000)) >>> 0;
