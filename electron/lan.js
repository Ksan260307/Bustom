import net from 'node:net';
import os from 'node:os';

/**
 * The socket a networked fight runs over, held by the shell.
 *
 * The game itself never touches one. It asks to host or to join and then
 * sends objects; everything about ports and buffers and half-arrived
 * messages lives here, on the other side of the four-verb bridge that keeps
 * a game which renders shared build codes from being one exploit away from
 * the player's disk.
 *
 * A star, not a mesh: everybody dials the host and the host passes messages
 * on. With four players that is three connections instead of six, one
 * address to tell people instead of a full mesh to negotiate, and — the
 * part that actually matters — every message reaches everybody in the same
 * ORDER, because one machine decides that order. It costs the host's
 * neighbours one extra hop, which the input delay already covers.
 *
 * The host is not a referee. It does not own the fight; it owns the
 * switchboard. Every machine still runs the whole simulation itself.
 */

const PORT = 45071;

/** Newline-delimited JSON. `JSON.stringify` never emits a raw newline. */
function frame(obj) { return `${JSON.stringify(obj)}\n`; }

/** Reads a socket into whole messages, however the packets arrive. */
function reader(onMessage) {
  let buf = '';
  return (chunk) => {
    buf += chunk;
    // A single read can hold two messages, or half of one. Both happen.
    let i = buf.indexOf('\n');
    while (i >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line) {
        try { onMessage(JSON.parse(line)); } catch { /* not ours; drop it */ }
      }
      i = buf.indexOf('\n');
    }
    // A peer that never sends a newline must not be able to grow this for
    // ever.
    if (buf.length > 1 << 20) buf = '';
  };
}

/** The addresses worth telling somebody, which is not 127.0.0.1. */
export function addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family !== 'IPv4' || n.internal) continue;
      out.push(n.address);
    }
  }
  return out;
}

/**
 * One machine's connection to a game — as the host of it or a guest in it.
 *
 * Only one at a time. Hosting one game while playing in another is not a
 * thing anybody wants and is a great deal of state to get wrong.
 */
export class Lan {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.server = null;
    this.socket = null;
    /** id -> socket, for the host. */
    this.clients = new Map();
    this.id = null;
    this.nextId = 1;
  }

  get hosting() { return !!this.server; }

  /** Open a game. Resolves once the port is actually listening. */
  host(port = PORT) {
    this.leave();
    this.id = 'h';
    return new Promise((resolve, reject) => {
      const server = net.createServer((sock) => {
        if (this.clients.size >= 3) { sock.end(); return; }   // four in a fight
        const id = `c${this.nextId++}`;
        sock.setNoDelay(true);
        this.clients.set(id, sock);
        // First thing a guest is told is who they are. Everything after
        // this is the game's own business.
        sock.write(frame({ __id: id }));
        sock.on('data', reader((msg) => {
          this.onMessage(id, msg);
          // Passed on to everybody else, unchanged. The host reads it and
          // relays it; it does not vet it, because there is nothing to vet
          // — a peer cannot lie about the fight, only about its own presses.
          for (const [other, s] of this.clients) {
            if (other !== id) s.write(frame({ __from: id, m: msg }));
          }
        }));
        const gone = () => {
          if (!this.clients.delete(id)) return;
          this.onMessage(id, { t: 'bye' });
          for (const [, s] of this.clients) s.write(frame({ __from: id, m: { t: 'bye' } }));
        };
        sock.on('close', gone);
        sock.on('error', gone);
      });
      server.on('error', reject);
      server.listen(port, () => {
        this.server = server;
        resolve({ id: this.id, port, addresses: addresses() });
      });
    });
  }

  /** Join somebody else's. Resolves once they have told us who we are. */
  join(host, port = PORT) {
    this.leave();
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host, port }, () => {});
      sock.setNoDelay(true);
      let settled = false;
      sock.on('data', reader((msg) => {
        if (msg.__id) {
          this.id = msg.__id;
          if (!settled) { settled = true; resolve({ id: this.id, host, port }); }
          return;
        }
        // From the host itself, or passed on from another guest.
        this.onMessage(msg.__from ?? 'h', msg.__from ? msg.m : msg);
      }));
      sock.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
      sock.on('close', () => this.onMessage('h', { t: 'bye' }));
      this.socket = sock;
    });
  }

  /** To everybody else, whichever end we are. */
  send(msg) {
    const line = frame(msg);
    if (this.server) {
      for (const [, s] of this.clients) s.write(frame({ __from: this.id, m: msg }));
    } else if (this.socket) {
      this.socket.write(line);
    }
    return this;
  }

  leave() {
    for (const [, s] of this.clients) s.destroy();
    this.clients.clear();
    this.server?.close();
    this.server = null;
    this.socket?.destroy();
    this.socket = null;
    this.id = null;
    return this;
  }
}

export const DEFAULT_PORT = PORT;
