import { h } from './dom.js';
import { DesktopTransport, SteamTransport } from '../net/Transport.js';
import { RtcTransport, rtcAvailable } from '../net/Rtc.js';
import { Matchmaker, DEFAULT_MATCHMAKER } from '../net/Matchmaker.js';

/**
 * The address to start with.
 *
 * Whatever was used last, else whatever this build ships pointing at. The
 * box used to open empty with "enter the matchmaking server address", which
 * is a question most players cannot answer — so internet play was, in
 * practice, off.
 */
function savedMatchmaker() {
  try {
    return localStorage.getItem('blostom.matchmaker') || DEFAULT_MATCHMAKER;
  } catch {
    return DEFAULT_MATCHMAKER;
  }
}
import { packDoc } from '../core/Codec.js';
import { Session, PHASE, MAX_PLAYERS } from '../net/Session.js';
import { DEFAULT_RULES, RULE_LIMITS } from '../game/Match.js';
import { t } from './i18n.js';

/**
 * Getting into a fight with somebody who is not in the room.
 *
 * Three ways in, in the order they are likely to work:
 *
 *   - MATCHING. Stand in a queue on a matchmaker and be introduced to
 *     whoever wants the same rules. Needs somebody to be running one.
 *   - CODE. Swap a code with somebody you already know — over chat, or read
 *     out. Clumsy, but it needs no server at all, so it works today and
 *     will still work when nobody is running a matchmaker.
 *   - LAN. Somebody's address on the same network, or a forwarded port.
 *
 * The rules are set BEFORE any of that, because they are part of what you
 * are queueing for: somebody who wants a five-minute match and somebody who
 * wants two are not waiting for the same game.
 */
export class VersusScreen {
  constructor(app) {
    this.app = app;
    this.session = null;
    this.maker = null;
    this.open = false;
    this.rules = { ...DEFAULT_RULES };
    this.wantPlayers = 2;

    this.addressInput = h('input', {
      type: 'text', class: 'vs-addr', placeholder: '192.168.0.10', maxlength: '64',
    });
    this.serverInput = h('input', {
      type: 'text', class: 'vs-addr', placeholder: 'example.com:45080', maxlength: '128',
      value: savedMatchmaker(),
    });
    this.myCodeEl = h('textarea', { class: 'vs-code', readonly: 'readonly', rows: '3' });
    this.theirCodeEl = h('textarea', {
      class: 'vs-code', rows: '3', placeholder: t('相手のコードを貼り付け'),
    });

    this.rosterEl = h('div', { class: 'vs-roster' });
    this.noteEl = h('div', { class: 'vs-note' });
    this.hostInfoEl = h('div', { class: 'vs-host hidden' });
    this.rulesEl = h('div', { class: 'vs-rules' });

    this.readyBtn = h('button', { class: 'primary', onClick: () => this._toggleReady() }, t('準備完了'));
    this.lobbyEl = h('div', { class: 'vs-lobby hidden' },
      this.hostInfoEl,
      this.rosterEl,
      h('div', { class: 'row vs-actions' }, this.readyBtn,
        h('button', { onClick: () => this.leave() }, t('抜ける'))),
    );

    this.codeEl = h('div', { class: 'vs-pane hidden' },
      h('div', { class: 'vs-paneline' },
        h('span', { class: 'k' }, t('自分のコード（相手に送る）')),
        h('button', { class: 'tiny', onClick: () => this._copy() }, t('コピー'))),
      this.myCodeEl,
      h('div', { class: 'vs-paneline' }, h('span', { class: 'k' }, t('相手のコード'))),
      this.theirCodeEl,
      h('div', { class: 'row vs-actions' },
        h('button', { class: 'primary', onClick: () => this._codeOffer() }, t('部屋を作る')),
        h('button', { onClick: () => this._codeAnswer() }, t('コードで入る')),
        h('button', { onClick: () => this._codeAccept() }, t('返答を取り込む')),
      ),
    );

    this.queueEl = h('div', { class: 'vs-pane hidden' },
      h('div', { class: 'vs-paneline' }, h('span', { class: 'k' }, t('マッチングサーバー'))),
      this.serverInput,
      h('div', { class: 'row vs-actions' },
        h('button', { class: 'primary', onClick: () => this._queue() }, t('対戦相手を探す')),
        // The one thing worth doing while a queue is not moving.
        h('button', { onClick: () => this._waitInField() }, t('待つ間フィールドで遊ぶ')),
        h('button', { onClick: () => this._cancelQueue() }, t('やめる')),
      ),
    );

    this.lobbyListEl = h('div', { class: 'vs-roster' });
    this.steamEl = h('div', { class: 'vs-pane hidden' },
      h('div', { class: 'row vs-actions' },
        h('button', { class: 'primary', onClick: () => this._steamHost() }, t('部屋を作る')),
        h('button', { onClick: () => this._steamList() }, t('部屋をさがす')),
      ),
      this.lobbyListEl,
    );

    this.lanEl = h('div', { class: 'vs-pane hidden' },
      h('div', { class: 'row vs-actions' },
        h('button', { class: 'primary', onClick: () => this.host() }, t('部屋を作る')),
        this.addressInput,
        h('button', { onClick: () => this.join() }, t('接続')),
      ),
    );

    this.tabsEl = h('div', { class: 'vs-tabs' },
      ...[
        ['steam', 'Steam'],
        ['queue', t('マッチング')],
        ['code', t('コード交換')],
        ['lan', 'LAN'],
      ].map(([id, label]) => h('button', {
        class: 'vs-tab', 'data-tab': id, onClick: () => this._tab(id),
      }, label)),
    );

    this.el = h('div', { id: 'versus', class: 'hidden' },
      h('div', { class: 'vs-box' },
        h('div', { class: 'vs-head' },
          h('span', { class: 'vs-title' }, 'VERSUS'),
          h('span', { class: 'vs-sub' }, t('最大 {0} 人', [MAX_PLAYERS]))),
        this.rulesEl,
        this.tabsEl,
        this.steamEl,
        this.queueEl,
        this.codeEl,
        this.lanEl,
        this.lobbyEl,
        this.noteEl,
        h('div', { class: 'row vs-foot' }, h('button', { onClick: () => this.hide() }, t('戻る'))),
      ),
    );
    // Steam first when it is there: no address to type, no code to paste,
    // and nobody has to be running anything.
    this._tab('queue');
    this._renderRules();
  }

  // ---------------------------------------------------------------- rules

  /**
   * The rules, set before anybody is matched.
   *
   * Deliberately few. Round length, how many rounds it takes, and how many
   * machines — the three things two people have to agree about before they
   * can be said to want the same game. Everything else is the same game.
   */
  _renderRules() {
    const row = (label, value, dec, inc, note = '') => h('div', { class: 'vs-rule' },
      h('span', { class: 'k' }, label),
      h('button', { class: 'tiny', onClick: dec }, '−'),
      h('span', { class: 'v' }, value),
      h('button', { class: 'tiny', onClick: inc }, '+'),
      note ? h('span', { class: 'vs-rulenote' }, note) : null);

    const bump = (key, by) => {
      const [lo, hi] = RULE_LIMITS[key];
      this.rules[key] = Math.min(hi, Math.max(lo, this.rules[key] + by));
      this.session?.setRules?.(this.rules);
      this._renderRules();
    };

    this.rulesEl.replaceChildren(
      row(t('1本の時間'), t('{0}分', [Math.round(this.rules.roundSeconds / 60)]),
        () => bump('roundSeconds', -60), () => bump('roundSeconds', 60)),
      row(t('先取'), t('{0}本', [this.rules.wins]),
        () => bump('wins', -1), () => bump('wins', 1)),
      row(t('人数'), t('{0}人', [this.wantPlayers]), () => {
        this.wantPlayers = Math.max(2, this.wantPlayers - 1); this._renderRules();
      }, () => {
        this.wantPlayers = Math.min(MAX_PLAYERS, this.wantPlayers + 1); this._renderRules();
      }, this.wantPlayers > 2 ? t('負けても観戦できます') : ''),
    );
    // Once a match is settled the rules are the host's and are not ours to
    // move; showing them as still adjustable would be a lie.
    const locked = !!this.session && !this.session.isHost;
    this.rulesEl.classList.toggle('locked', locked);
    return this;
  }

  // ----------------------------------------------------------------- tabs

  _tab(id) {
    this.tab = id;
    for (const b of this.tabsEl.querySelectorAll('.vs-tab')) {
      b.classList.toggle('active', b.dataset.tab === id);
    }
    this.steamEl.classList.toggle('hidden', id !== 'steam' || !!this.session);
    this.queueEl.classList.toggle('hidden', id !== 'queue' || !!this.session);
    this.codeEl.classList.toggle('hidden', id !== 'code' || !!this.session);
    this.lanEl.classList.toggle('hidden', id !== 'lan' || !!this.session);
    return this;
  }

  show() {
    this.open = true;
    this.el.classList.remove('hidden');
    if (!DesktopTransport.available) this._note(t('この環境では対戦できません'));
    else if (!rtcAvailable()) this._note(t('インターネット対戦はこの環境では使えません（LANは使えます）'));
    this.render();
    return this;
  }

  hide() {
    this.open = false;
    this.el.classList.add('hidden');
    this.app.closeVersus?.();
    return this;
  }

  _note(text) { this.noteEl.textContent = text ?? ''; return this; }

  // ------------------------------------------------------------ the ways in

  // --------------------------------------------------------------- Steam

  async _steamHost() {
    const support = await SteamTransport.support();
    if (!support.ok) { this._note(support.reason); return; }
    try {
      const transport = await SteamTransport.host({
        players: this.wantPlayers,
        name: (this.app.assembly?.name ?? 'PLAYER').slice(0, 16),
        rules: this.rules,
      });
      await this._joinWith(transport, true, null);
      this._note(t('Steamに部屋を作りました。相手を待っています'));
    } catch (e) {
      this._note(t('部屋を作れませんでした（{0}）', [e?.message ?? 'エラー']));
    }
  }

  async _steamList() {
    const support = await SteamTransport.support();
    if (!support.ok) { this._note(support.reason); return; }
    try {
      const rooms = await SteamTransport.list();
      if (!rooms.length) {
        this.lobbyListEl.replaceChildren(
          h('div', { class: 'vs-slot empty' }, h('span', { class: 'vs-name' }, t('空いている部屋がありません'))),
        );
        return;
      }
      // What the room says about itself, so a player can see what they are
      // joining before they join it.
      this.lobbyListEl.replaceChildren(...rooms.map((r) => h('div', { class: 'vs-slot' },
        h('span', { class: 'vs-name' }, r.name || r.id.slice(-6)),
        h('span', { class: 'vs-state' },
          `${r.players}/${r.limit}`
          + (r.rules ? t(' ・ {0}分 {1}本', [Math.round((r.rules.roundSeconds ?? 300) / 60), r.rules.wins ?? 3]) : '')),
        h('button', { class: 'tiny', onClick: () => this._steamJoin(r.id) }, t('入る')))));
    } catch (e) {
      this._note(t('さがせませんでした（{0}）', [e?.message ?? 'エラー']));
    }
  }

  async _steamJoin(id) {
    try {
      await this._joinWith(await SteamTransport.join(id), false, null);
      this._note(t('部屋に入りました'));
    } catch (e) {
      this._note(t('入れませんでした（{0}）', [e?.message ?? 'エラー']));
    }
  }

  /** A queue on a matchmaker. */
  async _queue() {
    const addr = this.serverInput.value.trim();
    if (!addr) {
      // Not a scolding: this build may simply not point at one, and the two
      // ways to play that need no server are both on this screen.
      this._note(DEFAULT_MATCHMAKER
        ? t('マッチングサーバーのアドレスを入れてください')
        : t('このビルドには公開サーバーがありません。コード交換かLANで対戦できます'));
      return;
    }
    try {
      localStorage.setItem('blostom.matchmaker', addr);
    } catch {
      // Private mode. The queue still runs; it just is not remembered.
    }
    this.maker = new Matchmaker({
      name: (this.app.assembly?.name ?? 'PLAYER').slice(0, 16),
      onNotice: (msg) => this._note(msg),
      onState: async (state, m) => {
        if (state === 'queued') {
          this._note(t('対戦相手を探しています（{0}/{1}人）', [m.waiting, m.players]));
        }
        if (state === 'ready') await this._joinWith(m.transport, m.seat === 0, m.rules, true);
      },
    });
    await this.maker.queue(addr, { players: this.wantPlayers, rules: this.rules });
  }

  _cancelQueue() {
    this.maker?.cancel();
    this.maker = null;
    this._note('');
  }

  /**
   * A queue is a wait, and a wait is better spent doing something.
   *
   * The queue keeps running while the field is open: it is a socket in the
   * shell, not something the screen was holding up. Being matched pulls the
   * player straight out of the field and into the fight.
   */
  _waitInField() {
    if (!this.maker || this.maker.state !== 'queued') {
      this._note(t('先に対戦相手を探してください'));
      return;
    }
    this._note(t('マッチングは続いています。相手が見つかったら戻ります'));
    this.el.classList.add('hidden');
    this.app.setMode('field');
  }

  /** Swap codes by hand: no server anywhere. */
  async _codeOffer() {
    if (!rtcAvailable()) { this._note(t('この環境では使えません')); return; }
    this._note(t('コードを作っています…'));
    const { transport, code, accept } = await RtcTransport.offer('h');
    this._rtc = { transport, accept };
    this.myCodeEl.value = code;
    this._note(t('このコードを相手に送り、返ってきたコードを貼って「返答を取り込む」'));
  }

  async _codeAnswer() {
    const theirs = this.theirCodeEl.value.trim();
    if (!theirs) { this._note(t('相手のコードを貼ってください')); return; }
    try {
      const { transport, code } = await RtcTransport.answer(theirs, 'g');
      this.myCodeEl.value = code;
      this._note(t('このコードを相手に返してください'));
      await transport.ready();
      await this._joinWith(transport, false, null);
    } catch (e) {
      this._note(t('つながりませんでした（{0}）', [e?.message ?? 'エラー']));
    }
  }

  async _codeAccept() {
    const theirs = this.theirCodeEl.value.trim();
    if (!this._rtc || !theirs) { this._note(t('先に部屋を作り、相手の返答を貼ってください')); return; }
    try {
      await this._rtc.accept(theirs);
      await this._rtc.transport.ready();
      await this._joinWith(this._rtc.transport, true, null);
    } catch (e) {
      this._note(t('つながりませんでした（{0}）', [e?.message ?? 'エラー']));
    }
  }

  _copy() {
    this.myCodeEl.select?.();
    navigator.clipboard?.writeText(this.myCodeEl.value).then(
      () => this._note(t('コピーしました')),
      () => this._note(t('選択してコピーしてください')),
    );
  }

  /** Somebody on the same network, or a forwarded port. */
  async host() {
    try {
      const transport = await DesktopTransport.host();
      await this._joinWith(transport, true, null);
      const at = transport.address?.addresses ?? [];
      this.hostInfoEl.classList.remove('hidden');
      this.hostInfoEl.replaceChildren(
        h('span', { class: 'k' }, t('このアドレスを相手に伝えてください')),
        ...(at.length ? at.map((a) => h('span', { class: 'vs-ip' }, a))
          : [h('span', { class: 'vs-ip warn' }, t('ネットワークが見つかりません'))]),
      );
      this._note(t('相手の接続を待っています'));
    } catch (e) {
      this._note(t('部屋を作れませんでした（{0}）', [e?.code ?? e?.message ?? 'エラー']));
    }
  }

  async join() {
    const addr = this.addressInput.value.trim();
    if (!addr) { this._note(t('アドレスを入力してください')); return; }
    try {
      const [host, port] = addr.split(':');
      await this._joinWith(await DesktopTransport.join(host, Number(port) || undefined), false, null);
      this._note(t('接続しました'));
    } catch (e) {
      this._note(t('つながりませんでした（{0}）', [e?.code ?? e?.message ?? 'エラー']));
    }
  }

  // ---------------------------------------------------------------- lobby

  async _joinWith(transport, isHost, rules, matched = false) {
    if (this.session) return this;
    this.session = new Session({
      transport,
      isHost,
      name: (this.app.assembly?.name ?? 'PLAYER').slice(0, 16),
      machine: await packDoc(this.app.assembly.toJSON()),
      rules: rules ?? this.rules,
      // Four steps of input delay. Enough for a house network and about
      // where a person starts to feel it — it is the whole trade, so it is
      // set once here rather than guessed at per fight.
      delay: 4,
    });
    this.session.onRoster = () => this.render();
    this.session.onNotice = (msg) => this._note(msg);
    this.session.onPhase = (p) => {
      this.render();
      // beginVersus is asynchronous now — the machines arrive packed and
      // have to be inflated. Nothing here waits on the result; the phase
      // change has already happened and the field opens when it opens.
      if (p === PHASE.FIGHT) {
        Promise.resolve(this.app.beginVersus?.(this.session))
          .catch((e) => this._note(String(e?.message ?? e)));
      }
    };
    this._tab(this.tab);
    this.lobbyEl.classList.remove('hidden');
    // Back on screen even if the player wandered off to the field while the
    // queue was running — being matched is the thing they were waiting for.
    this.open = true;
    this.el.classList.remove('hidden');
    /*
     * Matched players do not press READY.
     *
     * They already said what they wanted when they joined the queue, and
     * asking again is asking the same question twice — the second time to
     * somebody who may have gone to make tea in the field while they
     * waited.
     */
    if (matched) this.session.setReady(true);
    this.render();
    return this;
  }

  _toggleReady() {
    if (!this.session) return;
    this.session.setReady(!this.session.me.ready);
    this.render();
  }

  leave() {
    this.session?.close();
    this.session = null;
    this.maker?.cancel();
    this.maker = null;
    this._rtc = null;
    this.lobbyEl.classList.add('hidden');
    this.hostInfoEl.classList.add('hidden');
    this._tab(this.tab ?? 'queue');
    this._note('');
    this.render();
    return this;
  }

  render() {
    this._renderRules();
    if (!this.session) { this.rosterEl.replaceChildren(); return this; }
    const rows = this.session.roster.map((p) => h(
      'div',
      { class: `vs-slot ${p.ready ? 'ready' : ''} ${p.here ? '' : 'gone'}` },
      h('span', { class: 'vs-name' }, p.name),
      h('span', { class: 'vs-state' }, p.here ? (p.ready ? 'READY' : 'WAITING') : 'LEFT'),
    ));
    for (let i = this.session.roster.length; i < this.wantPlayers; i++) {
      rows.push(h('div', { class: 'vs-slot empty' }, h('span', { class: 'vs-name' }, t('空き'))));
    }
    this.rosterEl.replaceChildren(...rows);
    this.readyBtn.textContent = this.session.me?.ready ? t('準備を取り消す') : t('準備完了');
    this.readyBtn.classList.toggle('primary', !this.session.me?.ready);
    return this;
  }
}
