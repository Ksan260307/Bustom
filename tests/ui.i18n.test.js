import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import { EN } from '../src/ui/strings.en.js';

/**
 * The catalogue is keyed by the Japanese source string, which buys a
 * readable call site and costs one thing: editing the Japanese orphans its
 * translation silently. `tools/check-i18n.mjs` is what pays that cost, and
 * it runs in CI.
 *
 * What is left for a unit test is the ENGINE — the fallback, the
 * substitution, the listeners — and one structural check on the catalogue
 * itself that a script cannot make: that nothing in it is empty, which
 * would render as a blank button rather than as Japanese.
 */

async function freshI18n() {
  // Each test gets its own module instance, because the locale is module
  // state — read from storage at import — and a test that changes it must
  // not change the next one. A query string would do it in the browser;
  // under Vite the specifier has to stay static, so the registry is reset.
  vi.resetModules();
  return import('../src/ui/i18n.js');
}

beforeEach(() => {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  setNavigator(['ja']);
});

/** `navigator` is a getter on globalThis in Node, so it is redefined. */
function setNavigator(languages) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { languages, language: languages[0] },
    configurable: true,
    writable: true,
  });
}

describe('two languages, one source of truth', () => {
  it('hands back the Japanese it was given when that is the language', async () => {
    const { t } = await freshI18n();
    expect(t('設定')).toBe('設定');
  });

  it('and the English when that is', async () => {
    const { t, setLocale } = await freshI18n();
    setLocale('en');
    expect(t('設定')).toBe('Options');
  });

  it('falls back to the Japanese rather than showing a key', async () => {
    const { t, setLocale } = await freshI18n();
    setLocale('en');
    // A string added to the source and not yet translated. This is the
    // whole reason the message id IS the source text: a missing entry is a
    // mixed screen, not a broken one.
    expect(t('まだ訳していない文')).toBe('まだ訳していない文');
  });

  it('fills the holes, in either language', async () => {
    const { t, setLocale } = await freshI18n();
    expect(t('{0} パーツをコピーしました', [3])).toBe('3 パーツをコピーしました');
    setLocale('en');
    expect(t('{0} パーツをコピーしました', [3])).toBe('Copied 3 parts');
  });

  it('leaves a hole alone when nothing was passed for it', async () => {
    const { t } = await freshI18n();
    expect(t('{0} と {1}', [1])).toBe('1 と {1}');
    expect(t('{0} パーツをコピーしました')).toBe('{0} パーツをコピーしました');
  });

  it('substitutes positionally, so a translation may move the holes', async () => {
    const { t } = await freshI18n();
    // Not a real string; the point is that {1} can come first.
    expect(t('{1}{0}', ['a', 'b'])).toBe('ba');
  });

  it('remembers the choice', async () => {
    const a = await freshI18n();
    a.setLocale('en');
    const b = await freshI18n();
    expect(b.locale()).toBe('en');
  });

  it('refuses a language it does not have', async () => {
    const { setLocale, locale } = await freshI18n();
    setLocale('fr');
    expect(locale()).toBe('ja');
  });

  it('tells whoever is listening, once, and lets them stop', async () => {
    const { setLocale, onLocaleChange } = await freshI18n();
    const seen = [];
    const off = onLocaleChange((id) => seen.push(id));
    setLocale('en');
    setLocale('en');              // already there: nothing to say
    off();
    setLocale('ja');
    expect(seen).toEqual(['en']);
  });

  it('picks a starting language off the browser when nobody has chosen', async () => {
    setNavigator(['en-GB', 'ja']);
    expect((await freshI18n()).locale()).toBe('en');

    setNavigator(['ja-JP']);
    expect((await freshI18n()).locale()).toBe('ja');

    // Something we do not have: Japanese, because that is what the game is.
    setNavigator(['de']);
    expect((await freshI18n()).locale()).toBe('ja');
  });

  it('survives a store it cannot read or write', async () => {
    globalThis.localStorage = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    };
    const { setLocale, locale } = await freshI18n();
    expect(() => setLocale('en')).not.toThrow();
    expect(locale(), 'the choice still applies for this session').toBe('en');
  });
});

describe('numbers and clocks read differently in the two languages', () => {
  it('groups a score the way the reader expects', async () => {
    const { num, setLocale } = await freshI18n();
    expect(num(1234567)).toBe((1234567).toLocaleString('ja-JP'));
    setLocale('en');
    expect(num(1234567)).toBe('1,234,567');
  });

  it('a clock is m:ss either way', async () => {
    const { clock } = await freshI18n();
    expect(clock(0)).toBe('0:00');
    expect(clock(65)).toBe('1:05');
    expect(clock(600)).toBe('10:00');
    expect(clock(-5), 'never negative').toBe('0:00');
  });
});

describe('pick, for the tables that already carry both', () => {
  it('takes the English when there is one', async () => {
    const { pick, setLocale } = await freshI18n();
    expect(pick('ビーム', 'BEAM')).toBe('ビーム');
    setLocale('en');
    expect(pick('ビーム', 'BEAM')).toBe('BEAM');
  });

  it('and the Japanese when there is not', async () => {
    const { pick, setLocale } = await freshI18n();
    setLocale('en');
    expect(pick('ビーム', null)).toBe('ビーム');
    expect(pick('ビーム')).toBe('ビーム');
  });
});

describe('the catalogue itself', () => {
  it('has no empty translation, which would render as a blank control', () => {
    const blank = Object.entries(EN)
      // One deliberate exception: 「個」 is a counter suffix that English
      // does not have — "3 around a circle", not "3 items around a circle".
      .filter(([k, v]) => v === '' && k !== '個')
      .map(([k]) => k);
    expect(blank, `empty: ${blank.join(', ')}`).toEqual([]);
  });

  it('translates every key to a string', () => {
    const bad = Object.entries(EN).filter(([, v]) => typeof v !== 'string').map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it('keeps every placeholder the Japanese had', () => {
    const holes = (s) => (String(s).match(/\{\d+\}/g) ?? []).sort().join(',');
    const wrong = Object.entries(EN)
      .filter(([k, v]) => holes(k) !== holes(v))
      .map(([k, v]) => `${k} -> ${v}`);
    // A dropped {0} is a message that silently loses its number.
    expect(wrong, wrong.join(' | ')).toEqual([]);
  });

  it('is big enough to be the real thing rather than a stub', () => {
    expect(Object.keys(EN).length).toBeGreaterThan(1000);
  });
});
