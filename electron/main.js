import { app, BrowserWindow, protocol, net, shell, ipcMain, screen, dialog } from 'electron';
import { Lan, DEFAULT_PORT } from './lan.js';
import { SteamNet, steamNetSupport } from './steamnet.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openSteam } from './steam.js';
import { loadWindowState, trackWindowState, writeCrash, crashLogPath } from './session.js';

// ============================================================
//  BLOSTOM — the desktop shell.
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
 * Set BLOSTOM_DEV_SERVER (or pass --dev-server=…) and the window loads that
 * URL, so the desktop build can be worked on with hot reload rather than a
 * rebuild between every change.
 */
function devServerUrl() {
  const flag = process.argv.find((a) => a.startsWith('--dev-server='));
  return flag ? flag.slice('--dev-server='.length) : (process.env.BLOSTOM_DEV_SERVER ?? '');
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

  /*
   * The socket a networked fight runs over.
   *
   * The renderer sends and receives objects and never sees a socket. Note
   * that `net:send` takes only what the game itself put in the message —
   * there is no address in it, no path, nothing the page could aim
   * somewhere. Where it goes was settled when the game was hosted or
   * joined, by a person, and cannot be changed by a message.
   */
  let lan = null;
  const post = (from, msg) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('net:message', from, msg);
    }
  };

  ipcMain.handle('net:host', async (event, port) => {
    lan?.leave();
    lan = new Lan(post);
    return lan.host(Number(port) || DEFAULT_PORT);
  });

  ipcMain.handle('net:join', async (event, host, port) => {
    lan?.leave();
    lan = new Lan(post);
    return lan.join(String(host ?? '').slice(0, 64), Number(port) || DEFAULT_PORT);
  });

  ipcMain.on('net:send', (event, msg) => { lan?.send(msg); });
  ipcMain.on('net:leave', () => { lan?.leave(); lan = null; });

  /*
   * A second socket, to the matchmaker.
   *
   * Kept apart from the game one on purpose. The matchmaker is a stranger
   * that introduces people; the game socket is the fight. Mixing them would
   * mean the fight and the introductions could be confused for each other,
   * and would leave the matchmaker connected for the whole match when its
   * job ended before the first shot.
   */
  let mm = null;
  ipcMain.handle('net:mm-connect', async (event, host, port) => {
    mm?.leave();
    mm = new Lan((from, msg) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('net:mm-message', msg);
    });
    return mm.join(String(host ?? '').slice(0, 128), Number(port) || 45080);
  });
  ipcMain.on('net:mm-send', (event, msg) => { mm?.send(msg); });
  ipcMain.on('net:mm-close', () => { mm?.leave(); mm = null; });

  /*
   * And through Steam, where Steam is there.
   *
   * Steam already knows who is online and how to get a packet between two
   * machines behind routers, so there is no queue to run and no way through
   * the network to arrange. The messages are the same messages: a lobby is
   * a room and the packets are the fight, exactly as over a socket.
   */
  let sn = null;
  const steamPost = (from, msg) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('net:message', from, msg);
  };
  ipcMain.handle('net:steam-support', () => steamNetSupport(steam.client ?? null));
  ipcMain.handle('net:steam-host', async (event, players, name, rules) => {
    sn?.leave();
    sn = new SteamNet(steam.client, steamPost);
    const info = await sn.host(Number(players) || 2);
    sn.describe(name, rules);
    return info;
  });
  ipcMain.handle('net:steam-list', async () => {
    const probe = sn ?? new SteamNet(steam.client, () => {});
    return probe.list();
  });
  ipcMain.handle('net:steam-join', async (event, lobbyId) => {
    sn?.leave();
    sn = new SteamNet(steam.client, steamPost);
    return sn.join(String(lobbyId ?? ''));
  });
  ipcMain.on('net:steam-send', (event, msg) => { sn?.send(msg); });
  ipcMain.on('net:steam-leave', () => { sn?.leave(); sn = null; });
}

/**
 * The window's icon.
 *
 * Set here rather than stamped onto the executable, because stamping it
 * means letting electron-builder edit the .exe, which means downloading a
 * code-signing bundle full of macOS symlinks that Windows will not extract
 * without the symlink privilege. That fails, retries three times, and
 * fails — which is why `signAndEditExecutable` is off in package.json.
 *
 * This covers the window and the taskbar, which is where anybody actually
 * looks. Steam supplies its own library art.
 */
function windowIcon() {
  const file = path.join(ROOT, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  return fs.existsSync(file) ? file : undefined;
}

function createWindow(steam) {
  // Where it was last time, if that place still exists. The game used to
  // open at 1600x900 in the middle of the primary screen every single
  // launch, whatever you had done with it before.
  const state = loadWindowState(app, screen);

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 960,
    minHeight: 540,
    icon: windowIcon(),
    backgroundColor: '#070a10',       // the game's own background, not white
    show: false,                      // no empty frame while it boots
    autoHideMenuBar: true,
    title: 'BLOSTOM',
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

  win.once('ready-to-show', () => {
    // Applied after the window exists rather than in the options above,
    // because neither of these is a constructor option.
    if (state.maximized) win.maximize();
    if (state.fullscreen) win.setFullScreen(true);
    win.show();
  });
  trackWindowState(app, win);

  /*
   * The renderer dying, in the SHIPPED game.
   *
   * This handler existed already — inside `smokeTest`, which only runs on a
   * build machine. So the one situation it was written for, a player's game
   * falling over, was the one situation it was not attached for: the window
   * simply stopped and sat there looking fine.
   *
   * Now it is written down and the player is told, with the path to the
   * file, because "it crashed" with nothing attached is not a bug report.
   */
  win.webContents.on('render-process-gone', (event, details) => {
    writeCrash(app, 'render-process-gone', details);
    const { response } = { response: dialog.showMessageBoxSync(win, {
      type: 'error',
      title: 'BLOSTOM',
      message: 'ゲームが停止しました / The game stopped',
      detail: `${details.reason} (exit ${details.exitCode})

`
        + `作業中の内容は自動保存されています。
Your work was saved automatically.

`
        + `${crashLogPath(app)}`,
      buttons: ['再起動 / Restart', '終了 / Quit'],
      defaultId: 0,
      cancelId: 1,
    }) };
    if (response === 0) win.reload();
    else app.quit();
  });

  win.webContents.on('unresponsive', () => writeCrash(app, 'unresponsive', {}));
  win.webContents.on('preload-error', (e, file, error) => writeCrash(app, 'preload-error', {
    file, message: String(error?.message ?? error),
  }));

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

  if (process.env.BLOSTOM_SMOKE) smokeTest(win);

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
/**
 * Click one row of the front page, by what it DOES.
 *
 * It used to click a row by index, and the index it used was wrong: entry 1
 * is 「対戦」, and the check asserted that clicking it opened the workbench.
 * Nothing runs this — there is no npm script for it — so a self-check that
 * could never pass sat in the shipped shell unnoticed. Choosing by id
 * cannot go stale when a row is added, which is exactly what happened.
 */
async function clickTitleEntry(win, wantId) {
  const at = await win.webContents.executeJavaScript(`(() => {
    const items = window.__blostom?.ui?.title?.items ?? [];
    const i = items.findIndex((e) => e.id === ${JSON.stringify(wantId)});
    if (i < 0) return null;
    const b = document.querySelectorAll('#title .titleitem')[i];
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!at) return 'no such entry';

  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
    win.webContents.sendInputEvent({ type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  }
  return win.webContents.executeJavaScript(
    'new Promise((done) => setTimeout(() => done(window.__blostom?.mode ?? null), 300));',
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
            localStorage.setItem('blostom.smoke', 'ok');
            saves = localStorage.getItem('blostom.smoke') === 'ok';
            localStorage.removeItem('blostom.smoke');
          } catch (e) { saves = false; }
          done({
            mode: window.__blostom?.mode ?? null,
            drawn: window.__blostom?.renderer?.info?.render?.calls ?? 0,
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

      // Let the page lay out again before anything is measured against it.
      // Leaving fullscreen resizes the window, and the DOM catches up a
      // frame or two later — so a rect read immediately is a rect from the
      // wrong size, and a click at those coordinates lands on the row
      // below. Which is exactly what it did.
      await win.webContents.executeJavaScript(
        'new Promise((r) => setTimeout(() => requestAnimationFrame(() => r(1)), 250))',
      );

      // And it has to answer a real click. Not a dispatched event — an
      // actual press and release through the input pipeline, because the
      // ways a menu goes dead (something covering it, a button rebuilt
      // between the press and the release) are invisible to anything that
      // calls the handler directly.
      const clicked = await clickTitleEntry(win, 'edit');
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
