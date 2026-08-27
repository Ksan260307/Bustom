const { contextBridge, ipcRenderer } = require('electron');

// ============================================================
//  The bridge, and the whole of it.
//
//  This is the only thing the game can see of the machine it is running on.
//  It is deliberately four verbs wide: a window to close, a window to
//  resize, and a way to tell Steam something happened. No file system, no
//  child processes, no `require` — a game that renders whatever a shared
//  build code contains should not be one exploit away from the player's
//  disk.
//
//  In a browser `window.desktop` is simply undefined, and the game checks
//  for it. That is what keeps one codebase running in both places.
// ============================================================

contextBridge.exposeInMainWorld('desktop', {
  /** What we are running inside. The game branches on this, not on a UA string. */
  platform: 'desktop',

  /** Close the game. There is no tab to close, so the menu needs this. */
  quit: () => ipcRenderer.send('app:quit'),

  /** Toggle fullscreen; resolves to whether it ended up fullscreen. */
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),

  /** Whether the window is fullscreen right now. */
  isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen'),

  steam: {
    /**
     * What Steam we are talking to, if any. Read once at boot, so the game
     * can say "STEAM" on the title or say nothing at all without asking
     * every frame.
     */
    status: () => ipcRenderer.invoke('steam:status'),

    /**
     * Mark an achievement as earned. Safe to call when Steam is not
     * running — it is simply dropped — so callers never have to check
     * first.
     */
    unlock: (id) => ipcRenderer.send('steam:unlock', String(id)),
  },
});
