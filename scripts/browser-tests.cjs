// ============================================================
//  Run the browser suite from the command line, headless.
//
//  The suite needs a real browser: WebGL, a 2D canvas, pointer events and
//  the editor's DOM are the whole reason it exists. What it did NOT need
//  was a human keeping a tab open — which meant it could only be run by
//  hand, could not be run in CI, and (because `npm run test:browser` opens
//  the DEV server) restarted from the first test every time a source file
//  was saved underneath it.
//
//  Electron is already a dependency, and Electron is Chromium. So this
//  serves the built page with Vite's own preview server, opens it in a
//  hidden window, waits for the suite to finish and reports what it found.
//
//    npm run test:browser
//
//  Exits non-zero when anything failed, so it can gate a commit.
// ============================================================

const path = require('path');
const { app, BrowserWindow } = require('electron');

/** How long to wait for the whole suite before calling it stuck. */
const TIMEOUT_MS = Number(process.env.BROWSER_TEST_TIMEOUT ?? 10 * 60 * 1000);
/** Only run tests whose "describe > it" line matches this. */
const ONLY = process.env.ONLY ?? '';

const root = path.resolve(__dirname, '..');

/** Colours, when the terminal will take them. */
const tty = process.stdout.isTTY;
const red = (s) => (tty ? `\x1b[31m${s}\x1b[0m` : s);
const green = (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s);
const dim = (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s);

async function main() {
  const { preview } = await import('vite');
  const server = await preview({
    root,
    preview: { port: 0, open: false },
    logLevel: 'warn',
  });
  const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.preview.port}/`;
  const url = `${base.replace(/\/$/, '')}/tests.html${ONLY ? `?only=${encodeURIComponent(ONLY)}` : ''}`;

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });

  const started = Date.now();
  win.webContents.on('console-message', (_e, level, message) => {
    // The suite logs its own failures as it goes; anything at error level is
    // worth seeing while it happens rather than only at the end.
    if (level >= 2 && !message.startsWith('FAIL ')) console.error(dim(message));
  });

  await win.loadURL(url);

  const results = await new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error(`the suite did not finish within ${TIMEOUT_MS / 1000}s`)),
      TIMEOUT_MS,
    );
    let last = -1;
    const poll = setInterval(async () => {
      try {
        const state = await win.webContents.executeJavaScript(
          '({ done: document.body.dataset.done === "true", r: window.__TEST_RESULTS ?? null,'
          + ' seen: window.__TEST_SEEN ?? 0 })',
        );
        if (state.seen !== last) {
          last = state.seen;
          if (tty && state.seen) process.stdout.write(`\r  ${state.seen} tests…   `);
        }
        if (!state.done || !state.r) return;
        clearInterval(poll);
        clearTimeout(deadline);
        resolve(state.r);
      } catch (e) {
        clearInterval(poll);
        clearTimeout(deadline);
        reject(e);
      }
    }, 250);
  });

  if (tty) process.stdout.write('\r');
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  for (const f of results.failures) {
    console.error(`${red('FAIL')} ${f.suite} > ${f.name}\n      ${f.error}`);
  }
  if (process.env.SLOWEST) {
    console.log(dim('  slowest:'));
    for (const t of (results.slowest ?? []).slice(0, Number(process.env.SLOWEST) || 15)) {
      console.log(dim(`    ${(t.ms / 1000).toFixed(1)}s  ${t.suite} > ${t.name}`));
    }
  }
  const line = `${results.passed} passed / ${results.failed} failed / ${results.total} run  ${dim(`(${secs}s)`)}`;
  console.log(results.failed ? red(line) : green(line));

  await server.close();
  win.destroy();
  app.exit(results.failed ? 1 : 0);
}

// Nothing may be throttled for being out of sight: the window is hidden on
// purpose, and a suite that runs at a tenth speed because nobody is looking
// at it is a suite that does not get run.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// The GPU is left ON. Software WebGL made every drawn frame roughly four
// times slower AND changed what the bloom test could see, which is the one
// thing a renderer test is for. When there is no GPU to be had — a bare CI
// box — this at least keeps WebGL working rather than failing to a context
// that returns nothing.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

app.whenReady().then(() => {
  main().catch((e) => {
    console.error(red(String(e?.stack ?? e)));
    app.exit(1);
  });
});

app.on('window-all-closed', () => {});
