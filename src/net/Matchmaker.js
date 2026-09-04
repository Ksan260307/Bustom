import { RtcTransport, rtcAvailable } from './Rtc.js';
import { t } from '../ui/i18n.js';

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
 *
 * There is a DEFAULT now, which there was not. The screen used to open
 * with an empty box and "enter the matchmaking server address", which is a
 * question almost nobody can answer — so internet play shipped switched off
 * for everyone who was not already running their own. Setting
 * `DEFAULT_MATCHMAKER` below to a running instance is the whole of turning
 * it on; leaving it empty is honest about there not being one, and the
 * screen says so rather than asking for something the player has not got.
 */

/**
 * The queue this build points at, or '' for none.
 *
 * One line to fill in when a server is running. It is not a secret and not
 * a credential — the matchmaker introduces two people and then has nothing
 * further to do with the fight.
 */
export const DEFAULT_MATCHMAKER = '';

/**
 * How long to stand in a queue before saying something.
 *
 * A queue with nobody in it looked exactly like a queue that was about to
 * find somebody: "looking for an opponent (0/2)", for ever. At a quiet hour
 * that is the whole of the player's experience of internet play.
 */
export const QUEUE_PATIENCE = 90;
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
    /** Seconds spent queued, so a quiet hour can say so. */
    this.waited = 0;
    this._timer = null;
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

  /**
   * Count the wait, and speak up when it has gone on.
   *
   * Not a failure and not a cancel: the queue keeps running, because
   * somebody may still turn up. It just stops pretending that silence is
   * progress, and points at the two things that work with nobody else
   * online.
   */
  _startPatience() {
    this._stopPatience();
    this.waited = 0;
    this._timer = setInterval(() => {
      this.waited += 5;
      if (this.state !== 'queued') { this._stopPatience(); return; }
      if (this.waited === QUEUE_PATIENCE) {
        this.onNotice(t('まだ相手が見つかりません。ソロプレイかコード交換も使えます'));
      }
    }, 5000);
    return this;
  }

  _stopPatience() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    return this;
  }

  /** Join the queue for a game with these rules. */
  async queue(address, { players = 2, rules = null } = {}) {
    if (!this.bridge) { this._set('failed', t('この環境ではマッチングできません')); return this; }
    const [host, port] = String(address ?? '').split(':');
    this._off?.();
    this._off = this.bridge.onMessage((msg) => this._receive(msg));
    try {
      await this.bridge.connect(host, Number(port) || 45080);
    } catch (e) {
      this._set('failed', t('マッチングサーバーにつながりません（{0}）', [e?.code ?? e?.message ?? 'エラー']));
      return this;
    }
    this.bridge.send({ t: 'queue', name: this.name, want: { players, rules } });
    this._set('queued', t('対戦相手を探しています'));
    this._startPatience();
    return this;
  }

  cancel() {
    this._stopPatience();
    this.bridge?.send({ t: 'cancel' });
    this.bridge?.close();
    this._off?.();
    this._off = null;
    this._set('idle', '');
    return this;
  }

  /** Done with the introduction; the fight does not need it any more. */
  release() {
    this._stopPatience();
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
      this._set('failed', t('相手が離脱しました'));
      return;
    }
    if (msg.t === 'matched') {
      this.seat = msg.seat | 0;
      this.players = msg.players | 0;
      this.names = msg.names ?? [];
      this.rules = msg.rules ?? null;
      this._set('matched', t('{0} — 接続しています', [this.names.join(' vs ')]));
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
      this._set('ready', t('接続しました'));
    } catch {
      this._set('failed', t('接続できませんでした（相手のネットワークが厳しいようです）'));
    }
  }
}
