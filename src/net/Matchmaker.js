import { RtcTransport, rtcAvailable } from './Rtc.js';

/**
 * Standing in a queue until somebody who wants the same fight turns up.
 *
 * The matchmaker introduces people and nothing else — it passes two network
 * descriptions between two computers and then has no further part in
 * anything. The fight goes directly between the players; the queue could be
 * switched off mid-match and nobody in one would notice.
 *
 * Which is why the address of it is a setting rather than something built
 * in. Anybody can run `tools/matchmaker.js` and put the address in, and
 * when whoever was running one stops, the code-swap and the LAN game are
 * both still there.
 */
export class Matchmaker {
  constructor({ name = 'PLAYER', onState = () => {}, onNotice = () => {} } = {}) {
    this.name = name;
    this.onState = onState;
    this.onNotice = onNotice;
    /** 'idle' | 'queued' | 'matched' | 'connecting' | 'ready' | 'failed' */
    this.state = 'idle';
    this.bridge = typeof window !== 'undefined' ? window.desktop?.net?.matchmaker : null;
    this.seat = -1;
    this.players = 0;
    this.waiting = 0;
    this.names = [];
    this.rules = null;
    this.transport = null;
    this._off = null;
    this._pending = null;
  }

  static get available() {
    return typeof window !== 'undefined'
      && !!window.desktop?.net?.matchmaker
      && rtcAvailable();
  }

  _set(state, note) {
    this.state = state;
    if (note) this.onNotice(note);
    this.onState(state, this);
    return this;
  }

  /** Join the queue for a game with these rules. */
  async queue(address, { players = 2, rules = null } = {}) {
    if (!this.bridge) { this._set('failed', 'この環境ではマッチングできません'); return this; }
    const [host, port] = String(address ?? '').split(':');
    this._off?.();
    this._off = this.bridge.onMessage((msg) => this._receive(msg));
    try {
      await this.bridge.connect(host, Number(port) || 45080);
    } catch (e) {
      this._set('failed', `マッチングサーバーにつながりません（${e?.code ?? e?.message ?? 'エラー'}）`);
      return this;
    }
    this.bridge.send({ t: 'queue', name: this.name, want: { players, rules } });
    this._set('queued', '対戦相手を探しています');
    return this;
  }

  cancel() {
    this.bridge?.send({ t: 'cancel' });
    this.bridge?.close();
    this._off?.();
    this._off = null;
    this._set('idle', '');
    return this;
  }

  /** Done with the introduction; the fight does not need it any more. */
  release() {
    this.bridge?.close();
    this._off?.();
    this._off = null;
    return this;
  }

  async _receive(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'queued') {
      this.waiting = msg.waiting | 0;
      this.players = msg.want | 0;
      this.onState(this.state, this);
      return;
    }
    if (msg.t === 'peerGone') {
      this._set('failed', '相手が離脱しました');
      return;
    }
    if (msg.t === 'matched') {
      this.seat = msg.seat | 0;
      this.players = msg.players | 0;
      this.names = msg.names ?? [];
      this.rules = msg.rules ?? null;
      this._set('matched', `${this.names.join(' vs ')} — 接続しています`);
      // Seat zero offers, everybody else answers. Somebody has to go first
      // and the rule has to be one both ends work out the same way, without
      // asking.
      if (msg.offerer) await this._offer();
      return;
    }
    if (msg.t === 'signal') {
      if (msg.kind === 'offer') await this._answer(msg.code);
      else if (msg.kind === 'answer') await this._accept(msg.code);
    }
  }

  async _offer() {
    this._set('connecting');
    const { transport, code, accept } = await RtcTransport.offer('h');
    this.transport = transport;
    this._pending = accept;
    this.bridge.send({ t: 'signal', kind: 'offer', code });
  }

  async _answer(theirCode) {
    this._set('connecting');
    const { transport, code } = await RtcTransport.answer(theirCode, 'g');
    this.transport = transport;
    this.bridge.send({ t: 'signal', kind: 'answer', code });
    await this._settle();
  }

  async _accept(theirCode) {
    await this._pending?.(theirCode);
    this._pending = null;
    await this._settle();
  }

  async _settle() {
    try {
      await this.transport.ready();
      // The introduction is over. Everything from here is between the two
      // computers, and the matchmaker never hears about it.
      this.release();
      this._set('ready', '接続しました');
    } catch {
      this._set('failed', '接続できませんでした（相手のネットワークが厳しいようです）');
    }
  }
}
