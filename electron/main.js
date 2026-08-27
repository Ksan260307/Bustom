import { app, BrowserWindow, protocol, net, shell, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openSteam } from './steam.js';

// ============================================================
//  BroStom — the desktop shell.
//
//  The game itself is unchanged: it is the same renderer, the same fixed
//  step, the same DOM. What this adds is everything a browser was doing for
//  us and a shipped game has to do for itself — owning a window, going
//  fullscreen, quitting, and being one process that Steam can launch and
//  watch.
//
//  Two things are worth knowing before changing anything here:
//
//  1. The built game is served over a CUSTOM SCHEME (game://), not file://.
//     Chromium refuses to load ES modules over file:// (they are treated as
//     cross-origin), and localStorage is unavailable there — which would
//     take the machine you built and the key bindings with it. A registered
//     standard scheme behaves like a normal secure origin, so the build runs
//     exactly as it does on a server.
//
//  2. Nothing in the game may reach the file system or the network on its
//     own. Context isolation is on, node integration is off, and the only
//     way across is the small, named bridge in preload.cjs.
// ============================================================

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DIST = path.join(ROOT, 'dist');

/** Where the game is served from once it is packaged. */
const SCHEME = 'game';
const HOME = `${SCHEME}://app/index.html`;

/**
 * Point the shell at a running Vite server instead of the build.
 *
 * Set BROSTOM_DEV_SERVER (or pass --dev-server=…) and the window loads that
 * URL, so the desktop build can be worked on with hot reload rather than a
 * rebuild between every change.
 */
function devServerUrl() {
  const flag = process.argv.find((a) => a.startsWith('--dev-server='));
  return flag ? flag.slice('--dev-server='.length) : (process.env.BROSTOM_DEV_SERVER ?? '');
}

// Must be declared before the app is ready, and before any window exists.
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true,       // a real origin: localStorage, modules, workers
    secure: true,         // treated as https, so nothing is blocked as mixed
    supportFetchAPI: true,
    stream: true,
  },
}]);

/**
 * Serve the build, and only the build.
 *
 * Every request is resolved inside `dist` and then checked to be still
 * inside it: a page that asked for `../../` anything would otherwise be
 * reading the player's disk through us.
 */
function serveBuild() {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(DIST, rel || 'index.html');
    if (!file.startsWith(DIST)) return new Response('no', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

/**
 * Wire up the bridge's other end.
 *
 * Each one is deliberately dull: the renderer asks, the shell does it. No
 * handler takes a path, a URL or anything else the page could aim
 * somewhere — the whole surface is "close the window", "resize the window",
 * and "tell Steam a name".
 */
function wireBridge(steam) {
  const windowOf = (event) => BrowserWindow.fromWebContents(event.sender);

  ipcMain.on('app:quit', () => app.quit());

  ipcMain.handle('window:toggle-fullscreen', (event) => {
    const win = windowOf(event);
    if (!win) return false;
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
  });

  ipcMain.handle('window:is-fullscreen', (event) => windowOf(event)?.isFullScreen() ?? false);

  ipcMain.handle('steam:status', () => ({
    available: steam.available,
    reason: steam.reason,
    appId: steam.appId,
    playerName: steam.playerName,
  }));

  ipcMain.on('steam:unlock', (event, id) => { steam.unlock(id); });
}

function createWindow(steam) {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#070a10',       // the game's own background, not white
    show: false,                      // no empty frame while it boots
    autoHideMenuBar: true,
    title: 'BroStom',
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A game canvas that stops rendering when the window is behind
      // another one is a game that stutters on the way back.
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // The game asks for pointer lock the moment it takes you into the field.
  // Everything else a page can ask for — camera, microphone, location — this
  // game has no business with, so the answer is no.
  win.webContents.session.setPermissionRequestHandler((wc, permission, done) => {
    done(permission === 'pointerLock' || permission === 'fullscreen');
  });

  // Fullscreen belongs to the window, so it is handled here rather than in
  // the game: it has to work whichever screen the player is on and whatever
  // has focus inside the page.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const altEnter = input.key === 'Enter' && input.alt;
    if (input.key === 'F11' || altEnter) {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });

  // Nothing in this game navigates anywhere. Anything that tries is either a
  // mistake or something we did not write, and both should stay out.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const home = devServerUrl() || HOME;
    if (!url.startsWith(home.replace(/index\.html$/, ''))) event.preventDefault();
  });

  // A window that shows nothing and says nothing is the worst way to fail.
  win.webContents.on('did-fail-load', (event, code, description, url) => {
    console.error(`could not load ${url}: ${description} (${code})`);
  });

  const dev = devServerUrl();
  if (dev) win.loadURL(dev);
  else win.loadURL(HOME);

  if (process.env.BROSTOM_SMOKE) smokeTest(win);

  win.on('closed', () => { steam?.shutdown(); });
  return win;
}

/**
 * Press one entry on the title menu the way a player would, and report
 * where it took us.
 *
 * The press and the release are sent separately and with a move in front of
 * them, because that is the sequence a mouse actually produces — and it is
 * the sequence that catches a menu which rebuilds itself on hover, where
 * the press lands on one element and the release on its replacement, so the
 * browser never fires a click at all.
 */
async function clickTitleEntry(win, index) {
  const at = await win.webContents.executeJavaScript(`(() => {
    const b = document.querySelectorAll('#title .titleitem')[${index}];
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!at) return 'no such entry';

  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
    win.webContents.sendInputEvent({ type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  }
  return win.webContents.executeJavaScript(
    'new Promise((done) => setTimeout(() => done(window.__brostom?.mode ?? null), 300));',
  );
}

/**
 * Start the game, check that it really came up, and exit.
 *
 * Packaging can go wrong in ways that still produce a window: a missing
 * asset, a script the scheme would not serve, a renderer that threw on the
 * first frame. This drives the real build far enough to answer "does the
 * shipped thing start", which is the one question a build machine has to
 * be able to ask without a person watching.
 */
function smokeTest(win) {
  const fail = (why) => { console.error(`SMOKE FAIL: ${why}`); app.exit(1); };
  const timer = setTimeout(() => fail('the game did not start in time'), 30000);

  win.webContents.on('render-process-gone', (e, details) => fail(`renderer gone: ${details.reason}`));
  win.webContents.once('did-finish-load', async () => {
    try {
      // Give it a few frames of its own clock before asking, so this covers
      // rendering rather than only parsing.
      const state = await win.webContents.executeJavaScript(`
        new Promise((done) => setTimeout(async () => {
          let saves = false;
          try {
            localStorage.setItem('brostom.smoke', 'ok');
            saves = localStorage.getItem('brostom.smoke') === 'ok';
            localStorage.removeItem('brostom.smoke');
          } catch (e) { saves = false; }
          done({
            mode: window.__brostom?.mode ?? null,
            drawn: window.__brostom?.renderer?.info?.render?.calls ?? 0,
            desktop: !!window.desktop,
            saves,
            steam: await window.desktop.steam.status(),
          });
        }, 1200));
      `);
      clearTimeout(timer);
      if (state.mode !== 'title') return fail(`expected the title screen, got ${state.mode}`);
      if (!state.drawn) return fail('nothing was rendered');
      if (!state.desktop) return fail('the desktop bridge is missing');
      // The build you save a machine into and the build you load it from are
      // the same build; a scheme that cannot store is a game that forgets.
      if (!state.saves) return fail('this build cannot save anything');

      // The window has to be able to go fullscreen and come back, because
      // that is where a shipped game spends most of its life.
      win.setFullScreen(true);
      const wentFull = win.isFullScreen();
      win.setFullScreen(false);
      if (!wentFull) return fail('the window will not go fullscreen');

      // And it has to answer a real click. Not a dispatched event — an
      // actual press and release through the input pipeline, because the
      // ways a menu goes dead (something covering it, a button rebuilt
      // between the press and the release) are invisible to anything that
      // calls the handler directly.
      const clicked = await clickTitleEntry(win, 1);
      if (clicked !== 'edit') return fail(`the front page ignored a mouse click (mode: ${clicked})`);

      const steam = state.steam.available
        ? `steam ${state.steam.appId} (${state.steam.playerName})`
        : `no steam (${state.steam.reason})`;
      console.log(`SMOKE OK: ${state.mode}, ${state.drawn} draw calls, saves, fullscreen, clicks, ${steam}`);
      app.exit(0);
    } catch (e) {
      fail(e.message);
    }
  });
}

// Steam launches one copy and expects one copy. A second launch should wake
// the window that is already open, not start a second game on top of it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow = null;

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    serveBuild();
    const steam = openSteam();
    wireBridge(steam);
    mainWindow = createWindow(steam);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(steam);
    });
  });

  // A game is not a document editor: closing the window means you are done,
  // on every platform including macOS.
  app.on('window-all-closed', () => app.quit());
}
