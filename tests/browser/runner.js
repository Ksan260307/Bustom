// ============================================================
//  A very small test runner for the things Node cannot host:
//  WebGL, 2D canvas, pointer events and the editor DOM.
//
//  Deliberately tiny — it exists so the browser suite reads the same
//  way the vitest suites do, not to be a framework.
// ============================================================

const suites = [];
let current = null;

export function describe(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

export function it(name, fn) {
  if (!current) throw new Error('it() outside describe()');
  current.tests.push({ name, fn });
}

class Assertion {
  constructor(actual, label) {
    this.actual = actual;
    this.label = label ? ` (${label})` : '';
  }

  _fail(msg) { throw new Error(`${msg}${this.label}`); }

  toBe(expected) {
    if (!Object.is(this.actual, expected)) this._fail(`expected ${fmt(expected)}, got ${fmt(this.actual)}`);
  }

  toEqual(expected) {
    const a = JSON.stringify(this.actual);
    const b = JSON.stringify(expected);
    if (a !== b) this._fail(`expected ${b}, got ${a}`);
  }

  toBeTruthy() { if (!this.actual) this._fail(`expected truthy, got ${fmt(this.actual)}`); }
  toBeFalsy() { if (this.actual) this._fail(`expected falsy, got ${fmt(this.actual)}`); }
  toBeNull() { if (this.actual !== null) this._fail(`expected null, got ${fmt(this.actual)}`); }

  toBeGreaterThan(n) {
    if (!(this.actual > n)) this._fail(`expected > ${n}, got ${fmt(this.actual)}`);
  }

  toBeLessThan(n) {
    if (!(this.actual < n)) this._fail(`expected < ${n}, got ${fmt(this.actual)}`);
  }

  toBeGreaterThanOrEqual(n) {
    if (!(this.actual >= n)) this._fail(`expected >= ${n}, got ${fmt(this.actual)}`);
  }

  toBeLessThanOrEqual(n) {
    if (!(this.actual <= n)) this._fail(`expected <= ${n}, got ${fmt(this.actual)}`);
  }

  toBeCloseTo(n, digits = 2) {
    const tol = 10 ** -digits / 2;
    if (!(Math.abs(this.actual - n) <= tol)) this._fail(`expected ~${n}, got ${fmt(this.actual)}`);
  }

  toContain(v) {
    const ok = typeof this.actual === 'string'
      ? this.actual.includes(v)
      : Array.from(this.actual ?? []).includes(v);
    if (!ok) this._fail(`expected to contain ${fmt(v)}`);
  }

  toHaveLength(n) {
    if (this.actual?.length !== n) this._fail(`expected length ${n}, got ${this.actual?.length}`);
  }

  toBeInstanceOf(cls) {
    if (!(this.actual instanceof cls)) this._fail(`expected an instance of ${cls.name}`);
  }

  /** Inverts every matcher: expect(x).not.toBe(y) */
  get not() {
    const base = this;
    const out = {};
    for (const key of Object.getOwnPropertyNames(Assertion.prototype)) {
      if (key === 'constructor' || key === '_fail' || key === 'not') continue;
      out[key] = (...args) => {
        let threw = false;
        try { base[key](...args); } catch { threw = true; }
        if (!threw) base._fail(`expected NOT ${key}(${args.map(fmt).join(', ')})`);
      };
    }
    return out;
  }
}

const fmt = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(4);
  if (typeof v === 'string') return JSON.stringify(v);
  if (v && v.isVector3) return `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
  try { return JSON.stringify(v); } catch { return String(v); }
};

export function expect(actual, label) { return new Assertion(actual, label); }

/** Assert that `fn` does not throw. */
export function shouldNotThrow(fn, what = 'call') {
  try { fn(); } catch (e) { throw new Error(`${what} threw: ${e.message}`); }
}

/**
 * Yield to the event loop between tests, so the page can paint.
 *
 * A MessageChannel rather than setTimeout(0): a backgrounded tab clamps
 * timers to roughly once a MINUTE, which does not slow the suite down so
 * much as stop it. Channel messages are not throttled that way.
 */
function yieldToLoop() {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
    ch.port2.postMessage(0);
  });
}

export async function run(onProgress = () => {}) {
  const results = { passed: 0, failed: 0, total: 0, failures: [], suites: [] };

  for (const suite of suites) {
    const entry = { name: suite.name, tests: [] };
    results.suites.push(entry);
    for (const test of suite.tests) {
      results.total++;
      try {
        await test.fn();
        results.passed++;
        entry.tests.push({ name: test.name, ok: true });
      } catch (e) {
        results.failed++;
        const failure = { suite: suite.name, name: test.name, error: e.message || String(e) };
        results.failures.push(failure);
        entry.tests.push({ name: test.name, ok: false, error: failure.error });
        console.error(`FAIL ${suite.name} > ${test.name}\n  ${failure.error}`);
      }
      onProgress(results);
      await yieldToLoop();
    }
  }
  return results;
}

/**
 * Wait for the next animation frame. A hidden tab never paints, so fall back
 * to a plain event-loop turn rather than hanging on rAF that will not fire.
 */
export function nextFrame() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(finish);
    yieldToLoop().then(finish);
  });
}
