/**
 * Finding a game through Steam, and playing it through Steam.
 *
 * Steam already knows who is online, who is a friend of whom, and how to
 * get a packet between two machines that are both behind routers. Every one
 * of those is work the game would otherwise have to do itself — a
 * matchmaker to run, a queue to hold, a way through the network — so where
 * Steam is there, it is worth using instead.
 *
 * Two pieces:
 *
 *   - A LOBBY is the room. Steam holds it, lists it, and tells everybody
 *     who is in it. This replaces the matchmaker.
 *   - PACKETS between the members are the fight. Steam gets them through
 *     whatever is in the way, relaying them through its own network if it
 *     has to. This replaces the socket.
 *
 * The simulation above this does not change at all. It sends objects and
 * gets objects, exactly as it does over a LAN socket or a direct
 * connection, because it was written against three verbs and never learned
 * what was underneath them.
 *
 * Everything here is written to be ABSENT gracefully. Steam not running,
 * the binding not installed, an older binding without the matchmaking
 * calls: all of them are ordinary outcomes, and the game keeps its other
 * three ways of starting a fight.
 */

/** How often to look for packets, in ms. Steam has no "tell me" callback. */
const POLL_MS = 8;

/** A fight holds four. */
const MAX_MEMBERS = 4;

/**
 * What this build needs from a Steam binding.
 *
 * Checked by hand rather than assumed, because `steamworks.js` has grown
 * these calls over time and a build with an older one should say so plainly
 * instead of throwing halfway through hosting a game.
 */
export function steamNetSupport(client) {
  if (!client) return { ok: false, reason: 'Steamに接続していません' };
  const mm = client.matchmaking;
  const net = client.networking;
  if (!mm || typeof mm.createLobby !== 'function') {
    return { ok: false, reason: 'このSteam連携ではロビーを作れません' };
  }
  if (!net || typeof net.sendP2PPacket !== 'function') {
    return { ok: false, reason: 'このSteam連携ではP2P通信ができません' };
  }
  return { ok: true, reason: '' };
}

/**
 * One machine's place in a Steam game — the room it is in, and the packets
 * going in and out of it.
 */
export class SteamNet {
  /**
   * @param client the live steamworks client.
   * @param onMessage (fromSteamId, msg)
   */
  constructor(client, onMessage) {
    this.client = client;
    this.onMessage = onMessage;
    this.lobby = null;
    this.timer = null;
    this.id = null;
    /** Steam ids of everybody in the room, ours included. */
    this.members = [];
  }

  get hosting() { return !!this.lobby && this.isOwner; }

  /** Open a room others can find. */
  async host(maxPlayers = MAX_MEMBERS) {
    const support = steamNetSupport(this.client);
    if (!support.ok) throw new Error(support.reason);
    this.leave();
    // Public, so it turns up in the list. A friends-only game is a lobby
    // somebody was invited to, which is Steam's own overlay's job.
    const lobby = await this.client.matchmaking.createLobby(
      this.client.matchmaking.LobbyType?.Public ?? 2,
      Math.min(MAX_MEMBERS, Math.max(2, maxPlayers)),
    );
    return this._settle(lobby);
  }

  /** Rooms with space in them, for this game. */
  async list(max = 30) {
    const support = steamNetSupport(this.client);
    if (!support.ok) throw new Error(support.reason);
    const found = await this.client.matchmaking.getLobbies?.() ?? [];
    return found.slice(0, max).map((l) => ({
      id: String(l.id ?? l),
      players: l.memberCount?.() ?? l.members?.length ?? 0,
      limit: l.memberLimit?.() ?? MAX_MEMBERS,
      // Whatever the host wrote on the door. The rules live here so a
      // player can see what they are joining before they join it.
      rules: safeJson(l.getData?.('rules')),
      name: l.getData?.('name') ?? '',
    }));
  }

  /** Go into one. */
  async join(lobbyId) {
    const support = steamNetSupport(this.client);
    if (!support.ok) throw new Error(support.reason);
    this.leave();
    const lobby = await this.client.matchmaking.joinLobby(lobbyId);
    return this._settle(lobby);
  }

  _settle(lobby) {
    this.lobby = lobby;
    this.id = String(this.client.localplayer.getSteamId?.().steamId64 ?? 'me');
    this.isOwner = String(lobby.getOwner?.()?.steamId64 ?? '') === this.id;
    this.members = (lobby.getMembers?.() ?? []).map((m) => String(m.steamId64 ?? m));
    // Steam has no "a packet arrived" callback, so this is a poll. Eight
    // milliseconds is under half a simulation step, which is as much as an
    // input frame can afford to sit and wait.
    clearInterval(this.timer);
    this.timer = setInterval(() => this._drain(), POLL_MS);
    return {
      id: this.id,
      lobby: String(lobby.id ?? lobby),
      owner: this.isOwner,
      members: this.members,
    };
  }

  /** What the room says about itself, so joiners can see it from outside. */
  describe(name, rules) {
    try {
      this.lobby?.setData?.('name', String(name ?? '').slice(0, 32));
      this.lobby?.setData?.('rules', JSON.stringify(rules ?? {}));
    } catch { /* an older binding, or not the owner */ }
    return this;
  }

  _drain() {
    const net = this.client?.networking;
    if (!net) return;
    // Everything waiting, not one per tick: a frame that sat in the queue
    // for four polls is four steps of the fight nobody could take.
    for (let i = 0; i < 64; i++) {
      const size = net.getP2PPacketSize?.() ?? 0;
      if (!size) return;
      const packet = net.readP2PPacket?.(size);
      if (!packet) return;
      const from = String(packet.steamId?.steamId64 ?? packet.steamId ?? 'peer');
      const text = Buffer.from(packet.data ?? packet).toString('utf8');
      let msg;
      try { msg = JSON.parse(text); } catch { continue; }
      this.onMessage(from, msg);
    }
  }

  /** To everybody else in the room. */
  send(msg) {
    const net = this.client?.networking;
    if (!net || !this.lobby) return this;
    const text = Buffer.from(JSON.stringify(msg), 'utf8');
    const members = (this.lobby.getMembers?.() ?? []).map((m) => m);
    for (const m of members) {
      const id = String(m.steamId64 ?? m);
      if (id === this.id) continue;
      // Reliable, because lockstep needs every frame: a lost one stops the
      // fight for everybody, which costs far more than a retransmit.
      net.sendP2PPacket(m, net.SendType?.Reliable ?? 2, text);
    }
    return this;
  }

  leave() {
    clearInterval(this.timer);
    this.timer = null;
    try { this.lobby?.leave?.(); } catch { /* already gone */ }
    this.lobby = null;
    this.members = [];
    return this;
  }
}

function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}
