import { t } from '../ui/i18n.js';
/**
 * How a message gets from one machine to another — or does not.
 *
 * Everything above this is written against the three verbs below and knows
 * nothing about sockets, which is what lets the same session code run over
 * a real connection, over a recording, and between two copies inside one
 * process. That last one is not a toy: a fight that two copies in one
 * process cannot agree on is a fight two computers have no hope with, and
 * it can be tested in a millisecond instead of over a network.
 *
 *   send(msg)          — to everybody else
 *   onMessage(fn)      — (from, msg)
 *   close()
 *
 * Messages are plain JSON-able objects. Nothing here promises they arrive
 * in order or at all; the layer above is built on the assumption that they
 * sometimes do not.
 */

/** What every transport answers to. Not abstract — it simply does nothing. */
export class Transport {
  constructor(id = 'local') {
    this.id = id;
    this.handlers = new Set();
    this.closed = false;
  }

  send() { return this; }

  onMessage(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  _deliver(from, msg) {
    if (this.closed) return;
    for (const fn of this.handlers) fn(from, msg);
  }

  close() { this.closed = true; this.handlers.clear(); return this; }
}

/**
 * Several transports wired to each other inside one process.
 *
 * With a latency and a loss rate, because a connection that is perfect is
 * the one case that never happens and the one case everything accidentally
 * gets written for. Time is advanced by hand rather than by a clock, so a
 * test can run a minute of bad network in a millisecond and get the same
 * answer every time it does.
 */
export class LoopbackHub {
  /**
   * @param latency steps of delay each way.
   * @param jitter extra steps, up to this many, drawn from `random`.
   * @param loss 0..1, how much simply never arrives.
   */
  constructor({ latency = 0, jitter = 0, loss = 0, random = null } = {}) {
    this.peers = new Map();
    this.latency = latency;
    this.jitter = jitter;
    this.loss = loss;
    this.random = random;
    this.clock = 0;
    /** [dueAt, from, to, msg] */
    this.queue = [];
  }

  connect(id) {
    const hub = this;
    const peer = new Transport(id);
    peer.send = function send(msg) {
      hub._post(id, msg);
      return this;
    };
    const close = peer.close.bind(peer);
    peer.close = function closed() { hub.peers.delete(id); return close(); };
    this.peers.set(id, peer);
    return peer;
  }

  /** 0..1. `next()` hands back a 32-bit word, which is not a probability. */
  _roll() {
    if (this.random) return this.random.unit();
    return 0;
  }

  _post(from, msg) {
    for (const [to] of this.peers) {
      if (to === from) continue;
      if (this.loss > 0 && this._roll() < this.loss) continue;
      const extra = this.jitter > 0 ? Math.floor(this._roll() * (this.jitter + 1)) : 0;
      // Structured-cloned on the way in, the way a real one is. A test that
      // shares an object between two "machines" is testing nothing.
      this.queue.push([this.clock + this.latency + extra, from, to, JSON.parse(JSON.stringify(msg))]);
    }
  }

  /** Move time on, and hand over whatever has come due. */
  pump(steps = 1) {
    for (let i = 0; i < steps; i++) {
      this.clock++;
      const due = this.queue.filter((e) => e[0] <= this.clock);
      if (!due.length) continue;
      this.queue = this.queue.filter((e) => e[0] > this.clock);
      // In send order among those due together, which is the most a real
      // connection promises and rather more than some of them manage.
      for (const [, from, to, msg] of due) this.peers.get(to)?._deliver(from, msg);
    }
    return this;
  }

  get pending() { return this.queue.length; }
}

/**
 * The real one: a socket held by the desktop shell.
 *
 * The renderer never touches a socket. It asks the shell to host or to
 * join, and messages arrive as events — the same four-verb bridge that
 * keeps a game which renders shared build codes from being one exploit away
 * from the player's disk.
 */
export class DesktopTransport extends Transport {
  /** Is there a shell under us that can do this at all? */
  static get available() {
    return typeof window !== 'undefined' && !!window.desktop?.net;
  }

  constructor(id) {
    super(id);
    this.bridge = window.desktop.net;
    this._off = this.bridge.onMessage((from, msg) => this._deliver(from, msg));
  }

  /** Open a game others can join. Resolves to the address to tell them. */
  static async host(port) {
    const info = await window.desktop.net.host(port);
    const link = new DesktopTransport(info.id);
    link.address = info;
    return link;
  }

  /** Join somebody else's. */
  static async join(address, port) {
    const info = await window.desktop.net.join(address, port);
    const link = new DesktopTransport(info.id);
    link.address = info;
    return link;
  }

  send(msg) {
    this.bridge.send(msg);
    return this;
  }

  close() {
    this._off?.();
    this.bridge.leave?.();
    return super.close();
  }
}

/**
 * Through Steam: a lobby instead of a queue, Steam's network instead of a
 * socket.
 *
 * Steam already knows who is online and how to get a packet between two
 * machines that are both behind routers — so where it is there, it is the
 * shortest way into a fight: no address to type, no code to paste, no
 * matchmaker for anybody to run.
 *
 * The same three verbs as every other kind of connection, so nothing above
 * this can tell which one it got.
 */
export class SteamTransport extends Transport {
  static get available() {
    return typeof window !== 'undefined' && !!window.desktop?.net?.steam;
  }

  /** Whether this build of Steam can actually do it, and why not. */
  static async support() {
    if (!SteamTransport.available) return { ok: false, reason: t('Steamがありません') };
    return window.desktop.net.steam.support();
  }

  constructor(id) {
    super(id);
    this.bridge = window.desktop.net.steam;
    // Steam messages arrive on the same channel as every other kind. They
    // are the same messages; only the road was different.
    this._off = window.desktop.net.onMessage((from, msg) => this._deliver(from, msg));
  }

  static async host({ players = 2, name = 'PLAYER', rules = null } = {}) {
    const info = await window.desktop.net.steam.host(players, name, rules);
    const link = new SteamTransport(info.id);
    link.lobby = info;
    return link;
  }

  /** Rooms with space in them. */
  static list() { return window.desktop.net.steam.list(); }

  static async join(lobbyId) {
    const info = await window.desktop.net.steam.join(lobbyId);
    const link = new SteamTransport(info.id);
    link.lobby = info;
    return link;
  }

  send(msg) { this.bridge.send(msg); return this; }

  close() {
    this._off?.();
    this.bridge.leave?.();
    return super.close();
  }
}
