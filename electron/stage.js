import { app, BrowserWindow, protocol, net } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ============================================================
//  The stage editor's shell.
//
//  A second, much smaller program. It shares nothing with the game's shell
//  but the trick that makes a build run at all — a registered standard
//  scheme, because Chromium will not load ES modules over file://.
//
//  Deliberately separate rather than a mode of the game's window:
//
//    * The game must not be able to reach it. A menu entry is a way in, and
//      a way in is a way for a half-finished layout to end up in a fight.
//    * It has none of the game's shell: no Steam, no fullscreen, no bridge.
//      Nothing here can quit the game or write a save, because none of that
//      exists in this process.
//    * It is not in the game's build. `npm run game` cannot ship it even by
//      accident, because the two builds do not share an output folder.
//
//  Run it with:  npm run stage
// ============================================================

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist-stage');

const SCHEME = 'stage';
const HOME = `${SCHEME}://app/stage.html`;

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

app.whenReady().then(() => {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(DIST, rel || 'stage.html');
    // Resolved inside the build and then checked to be still inside it: a
    // page that asked for `../../` anything would be reading the disk.
    if (!file.startsWith(DIST)) return new Response('no', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0b0e13',
    title: 'BLOSTOM — STAGE EDITOR',
    webPreferences: {
      // The same rules as the game: nothing in the page reaches the disk or
      // the network on its own. The editor hands back text to paste, which
      // is the whole of how a layout leaves this window.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadURL(HOME);

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
});

app.on('window-all-closed', () => app.quit());
