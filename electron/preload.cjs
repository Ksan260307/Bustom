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

  /*
   * A fight against somebody on another machine.
   *
   * `send` carries whatever the game put in it and nothing else — no
   * address, no path. Where it goes was decided when a person hosted or
   * joined a game, and no message can change that.
   */
  net: {
    host: (port) => ipcRenderer.invoke('net:host', port),
    join: (host, port) => ipcRenderer.invoke('net:join', host, port),
    send: (msg) => ipcRenderer.send('net:send', msg),
    leave: () => ipcRenderer.send('net:leave'),
    onMessage: (fn) => {
      const h = (_e, from, msg) => fn(from, msg);
      ipcRenderer.on('net:message', h);
      return () => ipcRenderer.removeListener('net:message', h);
    },

    /*
     * Through Steam: a lobby instead of a queue, and Steam's own network
     * instead of a socket. Messages arrive on the same channel as every
     * other kind of connection, because they are the same messages.
     */
    steam: {
      support: () => ipcRenderer.invoke('net:steam-support'),
      host: (players, name, rules) => ipcRenderer.invoke('net:steam-host', players, name, rules),
      list: () => ipcRenderer.invoke('net:steam-list'),
      join: (lobbyId) => ipcRenderer.invoke('net:steam-join', lobbyId),
      send: (msg) => ipcRenderer.send('net:steam-send', msg),
      leave: () => ipcRenderer.send('net:steam-leave'),
    },

    /* The matchmaker: a stranger who introduces people, on its own socket. */
    matchmaker: {
      connect: (host, port) => ipcRenderer.invoke('net:mm-connect', host, port),
      send: (msg) => ipcRenderer.send('net:mm-send', msg),
      close: () => ipcRenderer.send('net:mm-close'),
      onMessage: (fn) => {
        const h = (_e, msg) => fn(msg);
        ipcRenderer.on('net:mm-message', h);
        return () => ipcRenderer.removeListener('net:mm-message', h);
      },
    },
  },

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
