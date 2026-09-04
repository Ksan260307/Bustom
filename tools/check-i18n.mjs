// ============================================================
//  Which strings the game asks for, and which the catalogue answers.
//
//      node tools/check-i18n.mjs           what is missing
//      node tools/check-i18n.mjs --stale   entries nothing asks for any more
//      node tools/check-i18n.mjs --dump    every id, grouped by file
//
//  This is the price of using the Japanese text as the message id: editing
//  the Japanese quietly orphans its translation. Paid by a script rather
//  than by somebody noticing a mixed screen after release.
//
//  Exits non-zero when anything is missing, so CI can hold the line.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SRC = path.join(ROOT, 'src');

/** `t('…')` and `t('…', [ … ])`, single-quoted, which is the house style. */
const CALL = /\bt\(\s*'((?:[^'\\]|\\.)*)'/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/**
 * Japanese sitting in the data tables, which is reached through a variable
 * rather than a literal — `t(EQUIP_META[kind].label)`. The catalogue needs
 * those too, and no `t('…')` anywhere names them.
 */
const TABLES = [
  'src/core/constants.js', 'src/core/Shapes.js', 'src/game/Arenas.js',
  'src/core/Palette.js', 'src/game/SoloRun.js', 'src/zmf/InputManager.js',
  'src/core/Settings.js',
];
const JP = /[ぁ-んァ-ヶ一-龠々ー]/;

function tableStrings() {
  const out = new Map();
  for (const rel of TABLES) {
    let s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of s.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
      const v = m[1].replace(/\\'/g, "'");
      if (JP.test(v)) out.set(v, rel);
    }
  }
  return out;
}

async function main() {
  // A Windows path is not a URL, and the ESM loader only takes URLs.
  const { EN } = await import(pathToFileURL(path.join(ROOT, 'src/ui/strings.en.js')).href);

  const asked = new Map();          // msgid -> first file that asks
  for (const f of walk(SRC)) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (rel.endsWith('i18n.js') || rel.endsWith('strings.en.js')) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(CALL)) {
      const id = m[1].replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
      if (!asked.has(id)) asked.set(id, rel);
    }
  }
  for (const [id, rel] of tableStrings()) if (!asked.has(id)) asked.set(id, rel);

  const missing = [...asked].filter(([id]) => EN[id] === undefined);
  const stale = Object.keys(EN).filter((id) => !asked.has(id));

  if (process.argv.includes('--dump')) {
    const byFile = new Map();
    for (const [id, rel] of asked) {
      if (!byFile.has(rel)) byFile.set(rel, []);
      byFile.get(rel).push(id);
    }
    for (const [rel, ids] of byFile) {
      console.log(`\n### ${rel}  (${ids.length})`);
      for (const id of ids) console.log(id);
    }
    return;
  }

  if (process.argv.includes('--stale')) {
    console.log(`entries nothing asks for: ${stale.length}`);
    stale.forEach((id) => console.log('  ', JSON.stringify(id)));
    return;
  }

  console.log(`asked for : ${asked.size}`);
  console.log(`translated: ${asked.size - missing.length}`);
  console.log(`missing   : ${missing.length}`);
  if (stale.length) console.log(`stale     : ${stale.length}  (run with --stale)`);

  if (missing.length) {
    const byFile = new Map();
    for (const [id, rel] of missing) {
      if (!byFile.has(rel)) byFile.set(rel, []);
      byFile.get(rel).push(id);
    }
    for (const [rel, ids] of byFile) {
      console.log(`\n  // ---- ${rel}  (${ids.length})`);
      for (const id of ids) console.log(`  ${JSON.stringify(id)}: '',`);
    }
    process.exitCode = 1;
  }
}

main();
