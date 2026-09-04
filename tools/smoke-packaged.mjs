// ============================================================
//  Does the PACKAGED game start?
//
//  `electron/main.js` has carried a self-check for this since it was
//  written, behind BLOSTOM_SMOKE — and nothing ever ran it. No npm script,
//  no CI step. So it sat there asserting that clicking the second row of
//  the front page opens the workbench, which it does not and never did (the
//  second row is 「対戦」), and nobody found out.
//
//      npm run smoke:packaged
//
//  Different question from `npm run smoke`, and both are worth asking. That
//  one drives the built game in a development shell; this one drives the
//  .exe electron-builder produced, with the asar packed, the file list
//  applied, and every path resolved the way it will be on a player's
//  machine. Packaging is where a missing file is found.
// ============================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Wherever electron-builder put it, on whichever platform. */
function findApp() {
  const out = path.join(ROOT, 'release');
  if (!fs.existsSync(out)) return null;
  const candidates = [
    ['win-unpacked', 'BLOSTOM.exe'],
    ['linux-unpacked', 'BLOSTOM'],
    ['mac', 'BLOSTOM.app', 'Contents', 'MacOS', 'BLOSTOM'],
    ['mac-arm64', 'BLOSTOM.app', 'Contents', 'MacOS', 'BLOSTOM'],
  ];
  for (const parts of candidates) {
    const p = path.join(out, ...parts);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const app = findApp();
if (!app) {
  console.error('No packaged build found. Run `npm run pack` first.');
  process.exit(1);
}

console.log(`driving ${path.relative(ROOT, app)}`);
const child = spawn(app, [], {
  env: { ...process.env, BLOSTOM_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let said = '';
child.stdout.on('data', (b) => { said += b; process.stdout.write(b); });
child.stderr.on('data', (b) => { said += b; process.stderr.write(b); });

// The shell exits itself when the check finishes; this is only here so a
// build that hangs fails the run rather than holding it for ever.
const timer = setTimeout(() => {
  console.error('the packaged game did not answer in time');
  child.kill();
  process.exit(1);
}, 120_000);

child.on('exit', (code) => {
  clearTimeout(timer);
  if (code === 0 && said.includes('SMOKE OK')) process.exit(0);
  console.error(`packaged smoke failed (exit ${code})`);
  process.exit(1);
});
