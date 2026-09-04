// ============================================================
//  The two things a desktop game is expected to remember, and the one
//  thing it has to be able to say afterwards.
//
//  WINDOW STATE. The game opened at 1600x900 in the middle of the screen
//  every single time. Leave it fullscreen, come back to a window; put it on
//  the second monitor, come back to the first. This is the smallest of the
//  things on the list and probably the most often noticed.
//
//  A CRASH LOG. `crashReporter` was never started and nothing was ever
//  written to disk, so "it crashed" from a player was the end of the
//  investigation. This writes the last few failures to a file beside the
//  save data, with the version and the machine it happened on. It is not
//  sent anywhere — there is nowhere to send it — but it can be attached to
//  a message, which is the entire difference.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Where both files live. `userData` is per-user and survives an update. */
function dir(app) {
  return app.getPath('userData');
}

// ---------------------------------------------------------- window state

const STATE_FILE = 'window.json';

const int = (v, fallback) => (Number.isFinite(v) ? Math.round(v) : fallback);

/**
 * What the window looked like last time, if it still makes sense.
 *
 * A position is only restored when some part of the window would land on a
 * screen that exists now — otherwise unplugging a monitor puts the game
 * somewhere it cannot be reached, which is worse than forgetting.
 */
export function loadWindowState(app, screen, defaults = { width: 1600, height: 900 }) {
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(path.join(dir(app), STATE_FILE), 'utf8'));
  } catch {
    return { ...defaults };
  }
  if (!saved || typeof saved !== 'object') return { ...defaults };

  const out = {
    width: Math.max(960, int(saved.width, defaults.width)),
    height: Math.max(540, int(saved.height, defaults.height)),
    fullscreen: saved.fullscreen === true,
    maximized: saved.maximized === true,
  };

  if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const displays = screen?.getAllDisplays?.() ?? [];
    const visible = displays.some((d) => {
      const b = d.workArea ?? d.bounds;
      return saved.x < b.x + b.width && saved.x + out.width > b.x
        && saved.y < b.y + b.height && saved.y + out.height > b.y;
    });
    if (visible) { out.x = int(saved.x, undefined); out.y = int(saved.y, undefined); }
  }
  return out;
}

/**
 * Follow a window and keep its shape on disk.
 *
 * Written on a delay: a drag fires `resize` on every frame, and a hundred
 * file writes a second is a hundred file writes a second.
 *
 * @returns {() => void} stop following
 */
export function trackWindowState(app, win, { delay = 400 } = {}) {
  let timer = null;
  /** The last size and position the window had while it was NORMAL. */
  let box = win.getNormalBounds();

  const write = () => {
    timer = null;
    try {
      fs.writeFileSync(path.join(dir(app), STATE_FILE), JSON.stringify({
        ...box,
        maximized: win.isMaximized(),
        // A window that is fullscreen has no useful size of its own, which
        // is why the normal bounds are tracked separately.
        fullscreen: win.isFullScreen(),
      }), 'utf8');
    } catch {
      // A read-only profile is not worth interrupting a game over.
    }
  };

  const touch = () => {
    if (!win.isDestroyed() && !win.isFullScreen() && !win.isMaximized()) {
      box = win.getNormalBounds();
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, delay);
  };

  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    win.on(ev, touch);
  }
  // And once on the way out, without the delay, because there may not be a
  // process left in four hundred milliseconds.
  win.on('close', () => { if (timer) clearTimeout(timer); write(); });

  return () => { if (timer) clearTimeout(timer); };
}

// ---------------------------------------------------------- crash log

const LOG_FILE = 'crash.log';
/** Keep the file from growing without limit on a machine that always fails. */
const LOG_MAX = 256 * 1024;

/**
 * Write one failure down, with enough context to act on it.
 *
 * @param {import('electron').App} app
 * @param {string} kind  'renderer-gone', 'unresponsive', …
 * @param {object} detail
 */
export function writeCrash(app, kind, detail = {}) {
  const line = [
    '',
    `==== ${new Date().toISOString()}  ${kind}`,
    `version : ${app.getVersion?.() ?? '?'}`,
    `platform: ${process.platform} ${os.release()} ${process.arch}`,
    `electron: ${process.versions.electron}  chrome ${process.versions.chrome}`,
    `detail  : ${JSON.stringify(detail)}`,
  ].join('\n');

  const file = path.join(dir(app), LOG_FILE);
  try {
    // Truncate from the FRONT when it gets long: the most recent failure is
    // the one somebody is asking about.
    let prior = '';
    try { prior = fs.readFileSync(file, 'utf8'); } catch { /* first time */ }
    const next = prior + line + '\n';
    fs.writeFileSync(file, next.length > LOG_MAX ? next.slice(-LOG_MAX) : next, 'utf8');
  } catch {
    // Nothing sensible to do if even the log cannot be written.
  }
  return line;
}

/** Where the log is, for a message that tells the player where to look. */
export function crashLogPath(app) {
  return path.join(dir(app), LOG_FILE);
}
