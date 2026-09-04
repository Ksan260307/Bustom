// ============================================================
//  Two languages, one source of truth.
//
//  The message id IS the Japanese string. `t('機体を組む')` looks '機体を組む'
//  up in the catalogue and returns 'Build a machine', or — when there is no
//  entry — hands back exactly what it was given.
//
//  That last part is the whole design. The alternative, naming every string
//  ('title.menu.build'), buys nothing here and costs three things:
//
//    1. The source stops saying what it puts on screen. `t('保存しました')`
//       is readable at the call site; `t('editor.toast.saved')` is a lookup
//       into another file for anyone reading the code.
//    2. Two things can drift — the key and the text — instead of one.
//    3. A missing entry renders as a raw key on somebody's screen. Here a
//       missing entry renders as Japanese, which is a smaller failure and
//       the one the game already shipped with.
//
//  The cost is that editing the Japanese means editing the catalogue too.
//  `npm run i18n:check` (tools/check-i18n.mjs) finds every string in `src`
//  that has no entry, so that cost is paid by a script rather than by
//  noticing.
//
//  WHEN THE LANGUAGE CHANGES the whole interface is rebuilt rather than
//  patched. Every panel here already knows how to render itself from the
//  tables — that is how the help screen has always worked — so rebuilding
//  is both correct and less code than tracking which nodes hold text.
// ============================================================

import { EN } from './strings.en.js';

/** What the picker offers, in the order it offers it. */
export const LOCALES = {
  ja: { label: '日本語', html: 'ja' },
  en: { label: 'English', html: 'en' },
};

export const LOCALE_ORDER = ['ja', 'en'];

const STORE = 'blostom.locale.v1';

/** Catalogues, keyed by locale. Japanese needs none: it is the message id. */
const CATALOGUE = { ja: null, en: EN };

/**
 * Which language to start in when nobody has chosen yet.
 *
 * The browser's own list, first match wins. A Japanese player should not
 * have to find the option, and neither should anybody else.
 */
function detect() {
  const list = (typeof navigator !== 'undefined' && navigator.languages)
    ? navigator.languages
    : [(typeof navigator !== 'undefined' && navigator.language) || 'ja'];
  for (const tag of list) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (base === 'ja') return 'ja';
    if (base === 'en') return 'en';
  }
  return 'ja';
}

function stored() {
  try {
    const v = localStorage.getItem(STORE);
    return LOCALES[v] ? v : null;
  } catch {
    return null;
  }
}

let current = stored() ?? detect();

const listeners = new Set();

/** @returns {'ja'|'en'} */
export function locale() { return current; }

/**
 * Ask to be told when the language changes.
 *
 * @returns {() => void} a function that unsubscribes
 */
export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Switch language.
 *
 * Also stamps `<html lang>`, because the font stack, line breaking and any
 * assistive technology all key off it — a page that says it is Japanese
 * while showing English breaks all three.
 */
export function setLocale(id) {
  if (!LOCALES[id] || id === current) return current;
  current = id;
  try { localStorage.setItem(STORE, id); } catch { /* private mode */ }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = LOCALES[id].html;
    document.documentElement.dataset.locale = id;
  }
  for (const fn of [...listeners]) {
    try { fn(id); } catch (e) { console.warn('locale listener failed', e); }
  }
  return current;
}

/**
 * One string, in the language now selected.
 *
 * `vars` fills positional holes written as `{0}`, `{1}` — positional rather
 * than named because word order is exactly what changes between these two
 * languages, and a translator has to be free to move them:
 *
 *     t('{0} パーツを貼り付けました', [n])   →  'Pasted {0} parts'
 *     t('{0} / {1} 機', [a, b])              →  '{0} of {1}'
 *
 * @param {string} msg  the Japanese text, exactly as it appears in source
 * @param {Array<string|number>} [vars]
 */
export function t(msg, vars) {
  const table = CATALOGUE[current];
  let s = (table && table[msg] !== undefined) ? table[msg] : msg;
  if (vars && vars.length) {
    s = String(s).replace(/\{(\d+)\}/g, (whole, i) => {
      const v = vars[Number(i)];
      return v === undefined || v === null ? whole : String(v);
    });
  }
  return s;
}

/**
 * Pick between two spellings without going through the catalogue.
 *
 * For the handful of places that already carry both — `EQUIP_META` has an
 * `en` field on every entry and always has — reading it directly is more
 * honest than routing a string that is already translated through a table
 * that would only translate it again.
 */
export function pick(ja, en) {
  return current === 'en' && en !== undefined && en !== null ? en : ja;
}

/**
 * A number, in the reader's convention.
 *
 * Scores are read at a glance in both languages and the grouping differs,
 * so this is not decoration.
 */
export function num(n) {
  return Number(n).toLocaleString(current === 'en' ? 'en-US' : 'ja-JP');
}

/** Seconds as m:ss, which is the same in both but wanted in one place. */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Stamp the document as soon as this module is pulled in, so the very first
// paint is already in the right language rather than switching under the
// player a frame later.
if (typeof document !== 'undefined') {
  document.documentElement.lang = LOCALES[current].html;
  document.documentElement.dataset.locale = current;
}
