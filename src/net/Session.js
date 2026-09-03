import { Lockstep } from './Lockstep.js';
import { InputFrame } from './InputFrame.js';
import { normaliseRules, DEFAULT_RULES } from '../game/Match.js';

/** How many machines one fight will hold. */
export const MAX_PLAYERS = 4;

/** What a session is doing, in the order it does it. */
export const PHASE = {
  LOBBY: 'lobby',
  READY: 'ready',
  FIGHT: 'fight',
  OVER: 'over',
  BROKEN: 'broken',
};

/**
 * A fight between people on different machines.
 *
 * One player hosts. That is not a claim about who is in charge of the
 * simulation — everybody runs the whole fight themselves, and the host's
 * copy has no more authority than anyone else's — it is only about who
 * holds the socket everyone else dials, and who gets to settle the two
 * things that must be settled once: the seed, and the order the players
 * are in. Both go out before the fight starts and neither changes after.
 *
 * Why it matters that the host is not authoritative: an authoritative host
 * is a player with lower latency to themselves than anybody else has to
 * them, and every close call goes their way. Here the fight is the same
 * fight on every machine, or it is stopped.
 */
export class Session {
  /**
   * @param transport how messages get out.
   * @param isHost who settles the seed and the roster.
   * @param name what to call us in the lobby.
   * @param delay steps of input delay; see Lockstep.
   */
  constructor({
    transport, isHost = false, name = 'PLAYER', delay = 3, machine = null, rules = null,
  } = {}) {
    this.transport = transport;
    this.isHost = isHost;
    this.id = transport?.id ?? 'local';
    this.phase = PHASE.LOBBY;
    this.delay = delay;

    /** id -> { id, name, machine, ready }. The roster, in join order. */
    this.players = new Map();
    this.players.set(this.id, { id: this.id, name, machine, ready: false, here: true });

    this.seed = 0;
    /**
     * The rules of the match, settled before anybody connects.
     *
     * The host's copy is the one that counts, and it goes out with the
     * start. Rules each side could edit after that would be two matches.
     */
    this.rules = normaliseRules(rules ?? DEFAULT_RULES);
    /** The agreed player order. Everything indexed by player uses THIS. */
    this.order = [];
    this.net = null;
    /** Anything worth saying to the person watching. */
    this.notice = '';
    this.onPhase = () => {};
    this.onRoster = () => {};
    this.onNotice = () => {};

    this._off = transport?.onMessage((from, msg) => this._receive(from, msg));
    if (!this.isHost) this._say({ t: 'hello', name, machine });
  }

  get me() { return this.players.get(this.id); }
  get roster() { return [...this.players.values()]; }
  get full() { return this.players.size >= MAX_PLAYERS; }
  get everyoneReady() {
    return this.players.size >= 2 && this.roster.every((p) => p.ready);
  }

  _say(msg) { this.transport?.send(msg); return this; }

  _notify(text) {
    this.notice = text;
    this.onNotice(text);
    return this;
  }

  _setPhase(p) {
    if (this.phase === p) return this;
    this.phase = p;
    this.onPhase(p);
    return this;
  }

  /**
   * Change the rules. The host's only, and only before it starts.
   *
   * Everybody else sees them, so nobody joins a five-minute match expecting
   * a two-minute one, but only one machine decides.
   */
  setRules(rules) {
    if (!this.isHost || this.phase !== PHASE.LOBBY) return this;
    this.rules = normaliseRules({ ...this.rules, ...rules });
    this._say({ t: 'rules', rules: this.rules });
    this.onRoster(this.roster);
    return this;
  }

  /** What machine we are bringing. Only meaningful in the lobby. */
  setMachine(machine) {
    this.me.machine = machine;
    this._say({ t: 'machine', machine });
    this.onRoster(this.roster);
    return this;
  }

  setReady(on = true) {
    this.me.ready = !!on;
    this._say({ t: 'ready', ready: this.me.ready });
    this.onRoster(this.roster);
    if (this.isHost) this._maybeStart();
    return this;
  }

  _maybeStart() {
    if (!this.isHost || this.phase !== PHASE.LOBBY) return this;
    if (!this.everyoneReady) return this;
    // The two things that have to be settled once, settled here and sent.
    // A seed each side picked for itself is two fights.
    const seed = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
    const order = this.roster.map((p) => p.id);
    this._say({
      t: 'start', seed, order, roster: this._rosterWire(), rules: this.rules,
    });
    this._begin(seed, order);
    return this;
  }

  _rosterWire() {
    return this.roster.map((p) => ({ id: p.id, name: p.name, machine: p.machine }));
  }

  _begin(seed, order) {
    this.seed = seed >>> 0;
    this.order = [...order];
    this.net = new Lockstep({
      players: this.order,
      localId: this.id,
      delay: this.delay,
    });
    this._setPhase(PHASE.FIGHT);
    return this;
  }

  /**
   * One step's worth of network, run before the simulation steps.
   *
   * Returns how many simulation steps actually ran, which is not always one
   * — it is zero while waiting on somebody and more than one while catching
   * up. Whoever calls this drives the fight off the number it returns
   * rather than off the wall clock.
   */
  pump(localFrame, step) {
    if (this.phase !== PHASE.FIGHT || !this.net) return 0;
    // Nothing to file when we are already as far ahead as the delay allows.
    const sent = this.net.submitLocal(localFrame ?? InputFrame.idle());
    if (sent) this._say({ t: 'in', k: sent.tick, f: sent.frame.toArray() });
    const ran = this.net.advance(step);
    if (this.net.desync) {
      this._setPhase(PHASE.BROKEN);
      const d = this.net.desync;
      this._notify(`同期がずれました（${d.tick}歩目）`);
    }
    return ran;
  }

  /** Publish our fingerprint of the fight so far. */
  reportHash(tick, hash) {
    if (!this.net) return this;
    this.net.reportHash(this.id, tick, hash);
    this._say({ t: 'h', k: tick, v: hash >>> 0 });
    return this;
  }

  /**
   * Messages, all of them.
   *
   * Every one is treated as coming from somebody who might send anything:
   * a lobby message during a fight is ignored rather than acted on, and a
   * roster only ever arrives from the host. Nothing here trusts a peer
   * about the state of the fight, because nothing has to — the fight is
   * computed, not received.
   */
  _receive(from, msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'hello': {
        if (this.phase !== PHASE.LOBBY) return;
        if (!this.players.has(from) && this.players.size < MAX_PLAYERS) {
          this.players.set(from, {
            id: from, name: String(msg.name ?? 'PLAYER').slice(0, 16),
            machine: msg.machine ?? null, ready: false, here: true,
          });
        }
        // The host is the one who knows the whole room, so it answers.
        if (this.isHost) this._say({ t: 'roster', roster: this._rosterWire() });
        this.onRoster(this.roster);
        return;
      }
      case 'roster': {
        if (this.phase !== PHASE.LOBBY || this.isHost) return;
        for (const p of msg.roster ?? []) {
          if (p.id === this.id) continue;
          const was = this.players.get(p.id);
          this.players.set(p.id, {
            id: p.id, name: p.name, machine: p.machine,
            ready: was?.ready ?? false, here: true,
          });
        }
        this.onRoster(this.roster);
        return;
      }
      case 'rules': {
        if (this.isHost) return;
        this.rules = normaliseRules(msg.rules ?? {});
        this.onRoster(this.roster);
        return;
      }
      case 'machine': {
        const p = this.players.get(from);
        if (p) { p.machine = msg.machine ?? null; this.onRoster(this.roster); }
        return;
      }
      case 'ready': {
        const p = this.players.get(from);
        if (p) { p.ready = !!msg.ready; this.onRoster(this.roster); }
        if (this.isHost) this._maybeStart();
        return;
      }
      case 'start': {
        if (this.isHost || this.phase !== PHASE.LOBBY) return;
        for (const p of msg.roster ?? []) {
          if (p.id === this.id) continue;
          this.players.set(p.id, {
            ...this.players.get(p.id), id: p.id, name: p.name, machine: p.machine, here: true,
          });
        }
        // The host's rules, not ours. Ours were only ever a suggestion.
        this.rules = normaliseRules(msg.rules ?? {});
        this._begin(msg.seed, msg.order ?? this.roster.map((p) => p.id));
        return;
      }
      case 'in': {
        this.net?.receive(from, msg.k | 0, msg.f);
        return;
      }
      case 'h': {
        const bad = this.net?.reportHash(from, msg.k | 0, msg.v);
        if (bad) {
          this._setPhase(PHASE.BROKEN);
          this._notify(`同期がずれました（${bad.tick}歩目）`);
        }
        return;
      }
      case 'bye': {
        this.leave(from);
        return;
      }
      case 'gone': {
        // Somebody else noticed first. Take their step, not our own — two
        // clients that each pick their own would fork the fight.
        const at = msg.k | 0;
        const who = String(msg.who ?? '');
        if (!this.players.has(who)) return;
        const p2 = this.players.get(who);
        if (p2) p2.here = false;
        this.net?.drop(who, at);
        this.onRoster(this.roster);
        return;
      }
      default:
    }
  }

  /**
   * Somebody has gone.
   *
   * Their machine keeps standing where it was, pressing nothing. Taking it
   * off the field would need every client to agree about WHICH step it
   * disappeared on; "it stops moving from the next step nobody is waiting
   * on" is a rule each client can apply on its own and get the same answer.
   */
  leave(id) {
    const p = this.players.get(id);
    if (p) p.here = false;
    /*
     * Which step they stopped on, decided by ONE of us.
     *
     * Handing a machine to the computer changes the fight, so it has to
     * happen on the same step everywhere or the fight has forked. Two
     * clients each picking their own step would pick differently, so the
     * choice belongs to whoever is first in the agreed order and still
     * here — a rule everybody can apply without asking anyone.
     *
     * Everybody else waits to be told, and takes the step they are given.
     */
    if (this.net && this.callsIt(id)) {
      const at = this.net.firstMissing(id);
      this.net.drop(id, at);
      this._say({ t: 'gone', who: id, k: at });
    }
    this.onRoster(this.roster);
    /*
     * The fight does not stop because somebody left it.
     *
     * It used to: the last person standing in a one-on-one was left with
     * nothing to do and the match simply ended, which rewards walking out
     * of a round you are losing. The computer picks the machine up instead
     * and the match is played to its end, so leaving costs you the match
     * rather than erasing it.
     *
     * A fight where EVERYBODY has gone is a different matter — there is
     * nobody left to watch it.
     */
    if (this.phase === PHASE.FIGHT) {
      this._notify(`${p?.name ?? '相手'}が抜けました（CPUが引き継ぎます）`);
      if (!this.roster.some((x) => x.here)) this._setPhase(PHASE.OVER);
    } else if (this.phase === PHASE.LOBBY && !this.roster.some((x) => x.here && x.id !== this.id)) {
      this._notify('相手が抜けました');
    }
    return this;
  }

  /**
   * Is it our place to say when somebody stopped?
   *
   * First in the running order who is still here, not counting the one who
   * left. No vote, no negotiation: every client works out the same answer
   * from what it already knows.
   */
  callsIt(about) {
    for (const id of this.order) {
      if (id === about) continue;
      if (this.net?.isGone(id, this.net.tick)) continue;
      if (this.players.get(id)?.here === false) continue;
      return id === this.id;
    }
    return false;
  }

  /** Which slot a player fights in — the same on every machine. */
  slotOf(id) { return this.order.indexOf(id); }

  close() {
    this._say({ t: 'bye' });
    this._off?.();
    this.transport?.close();
    this._setPhase(PHASE.OVER);
    return this;
  }

  /** Everything worth putting on a connection read-out. */
  status() {
    const s = this.net?.status() ?? { tick: 0, stalled: 0, waiting: [], dropped: [] };
    return {
      phase: this.phase,
      players: this.roster.length,
      host: this.isHost,
      ...s,
      waitingNames: s.waiting.map((id) => this.players.get(id)?.name ?? id),
    };
  }
}
