import { h } from './dom.js';
import { onDesktop, quitGame, toggleFullscreen, steamStatus } from '../platform/desktop.js';

// ============================================================
//  The title screen and the result screen.
//
//  Both are plain DOM over the 3D backdrop. They are menus, not part of any
//  fight, so nothing in here runs on the simulation clock or touches the
//  arena directly — they call the app, and the app decides.
// ============================================================

const BEST_KEY = 'blostom.solo.best.v1';
/** What it was called before the rename. Read as a fallback, never written. */
const BEST_KEY_WAS = 'brostom.solo.best.v1';

/** The best solo run so far, or null if nobody has finished one yet. */
export function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY) ?? localStorage.getItem(BEST_KEY_WAS);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v?.score === 'number' ? v : null;
  } catch (e) {
    return null;
  }
}

/**
 * Keep `result` if it beats the record. Returns true when it did, because
 * the one thing the player wants to know at the end of a run is whether it
 * counted for anything.
 */
export function recordBest(result) {
  const best = loadBest();
  if (best && best.score >= result.score) return false;
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(result));
  } catch (e) {
    // Private mode: the run still happened, it just is not remembered.
    return true;
  }
  return true;
}

/** mm:ss — seconds alone stop being readable about a minute into a run. */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ============================================================
//  Title
// ============================================================

export class TitleScreen {
  constructor(app) {
    this.app = app;
    this.open = false;
    this.index = 0;

    /**
     * The menu, in the order a new player should meet it: the game first,
     * then the workshop, then the things you only want once you have
     * played. `run` is called on the app, never on the scene.
     */
    /**
     * The menu, before the platform has its say. Everything in here works
     * anywhere the game runs.
     */
    this.baseItems = [
      {
        id: 'solo',
        label: 'ソロプレイ',
        note: '押し寄せる敵をウェーブで迎え撃つ',
        run: () => this.app.startSolo(),
      },
      {
        id: 'edit',
        label: '機体を組む',
        note: 'ブロックとボーンで自分の機体をつくる',
        run: () => this.app.setMode('edit'),
      },
      {
        id: 'field',
        label: 'テストフィールド',
        note: 'ルール無しの練習場。動きを確かめる',
        run: () => this.app.setMode('field'),
      },
      {
        id: 'keys',
        label: 'キー設定',
        note: '操作を割り当てなおす',
        run: () => this.app.ui.keyConfig.show(),
      },
      {
        id: 'help',
        label: '使い方',
        note: 'はじめての人はこちら',
        run: () => this.app.ui.help.show('start'),
      },
    ];

    this.listEl = h('div', { class: 'titlemenu' });
    this.bestEl = h('div', { class: 'titlebest' });
    this.platformEl = h('span', { class: 'titleplatform' });

    this.el = h('div', { id: 'title', class: 'hidden' },
      h('div', { class: 'titleinner' },
        h('div', { class: 'titlebrand' },
          h('h1', {}, 'BLOSTOM'),
          h('p', {}, 'ブロックで組んで、戦う'),
        ),
        this.listEl,
        this.bestEl,
        h('div', { class: 'titlefoot' },
          h('span', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), ' 選択'),
          h('span', {}, h('kbd', {}, 'Enter'), ' 決定'),
          h('span', {}, h('kbd', {}, 'F11'), ' 全画面'),
          h('span', {}, h('kbd', {}, 'F1'), ' 使い方'),
          this.platformEl,
        ),
      ),
    );

    this._onKey = (e) => this._key(e);
    window.addEventListener('keydown', this._onKey);
  }

  /**
   * The menu as it stands on THIS machine.
   *
   * Composed on read rather than built once, because what the platform can
   * offer is not known for certain when this object is constructed — and
   * because a browser tab genuinely has no "quit the game" to offer.
   */
  get items() {
    const extra = [{
      id: 'fullscreen',
      label: 'フルスクリーン',
      note: '画面いっぱいに表示する（F11）',
      run: () => { toggleFullscreen(); },
    }];
    if (onDesktop()) {
      extra.push({
        id: 'quit',
        label: 'ゲームを終了',
        note: 'ウインドウを閉じてゲームを終わる',
        run: () => quitGame(),
      });
    }
    return [...this.baseItems, ...extra];
  }

  setOpen(on) {
    this.open = !!on;
    this.el.classList.toggle('hidden', !this.open);
    if (this.open) this.render();
    return this;
  }

  show() { return this.setOpen(true); }

  close() { return this.setOpen(false); }

  /** Move the highlight, wrapping at both ends. */
  move(delta) {
    const n = this.items.length;
    return this.highlight(((this.index + delta) % n + n) % n);
  }

  /**
   * Put the highlight on one entry.
   *
   * This repaints the existing buttons rather than rebuilding them, and
   * that is not an optimisation — it is the difference between a menu that
   * works and one that does not. Rebuilding on hover destroys the very
   * button the pointer is over: the mouse goes down on one element and up
   * on its replacement, the browser sees no single target for the pair, and
   * NO CLICK IS EVER FIRED. The menu still lights up under the cursor, so
   * it looks alive while being completely dead.
   */
  highlight(index) {
    this.index = index;
    const nodes = this.listEl.children;
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('active', i === this.index);
    }
    return this;
  }

  /** Run whatever is highlighted, or the item named. */
  choose(id = null) {
    const item = id ? this.items.find((x) => x.id === id) : this.items[this.index];
    if (!item) return null;
    item.run();
    return item;
  }

  _key(e) {
    // Only while the title is the screen, and never over a dialog that has
    // opened on top of it.
    if (!this.open) return;
    if (this.app.ui.help.open || this.app.ui.keyConfig.open || this.app.ui.share.open) return;
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;

    // Taken, not shared. Both this and the app's shortcuts listen on the
    // window, and this one runs first — so without stopping the event here,
    // Enter would pick "edit" and the editor's own Enter would immediately
    // throw the player into the field on top of it.
    const take = () => { e.preventDefault(); e.stopImmediatePropagation(); };

    if (e.code === 'ArrowUp' || e.code === 'KeyW') { take(); this.move(-1); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { take(); this.move(1); }
    else if (e.code === 'Enter' || e.code === 'Space') { take(); this.choose(); }
  }

  render() {
    this.listEl.replaceChildren(...this.items.map((item, i) => h('button', {
      class: `titleitem${i === this.index ? ' active' : ''}`,
      onClick: () => { this.index = i; this.choose(); },
      onMouseEnter: () => this.highlight(i),
    },
      h('span', { class: 'ti-label' }, item.label),
      h('span', { class: 'ti-note' }, item.note),
    )));

    this._showPlatform();

    const best = loadBest();
    this.bestEl.replaceChildren(
      best
        ? h('span', {},
          'BEST ', h('b', {}, best.score.toLocaleString('en-US')),
          ' / WAVE ', h('b', {}, String(best.wave)))
        : h('span', { class: 'dim' }, 'まだ記録がありません'),
    );
    return this;
  }

  /**
   * Name the platform in the footer, once. Asked for at most once per
   * session: it cannot change while the game is running, and the answer
   * crosses a process boundary.
   */
  _showPlatform() {
    if (!onDesktop() || this._platformAsked) return this;
    this._platformAsked = true;
    steamStatus().then((s) => {
      if (!s.available) return;
      this.platformEl.textContent = s.playerName ? `STEAM ・ ${s.playerName}` : 'STEAM';
    });
    return this;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
  }
}

// ============================================================
//  Result
// ============================================================

export class ResultScreen {
  constructor(app) {
    this.app = app;
    this.open = false;

    this.headEl = h('div', { class: 'resulthead' }, 'RESULT');
    this.rowsEl = h('div', { class: 'resultrows' });
    this.recordEl = h('div', { class: 'resultrecord hidden' }, 'NEW RECORD');

    this.el = h('div', { id: 'result', class: 'hidden' },
      h('div', { class: 'resultbox' },
        this.headEl,
        this.recordEl,
        this.rowsEl,
        h('div', { class: 'resultbuttons' },
          h('button', { class: 'primary wide', onClick: () => this.app.startSolo() }, '▶ もう一度'),
          h('button', { class: 'wide', onClick: () => this.app.setMode('edit') }, '🔧 機体を組む'),
          h('button', { class: 'wide', onClick: () => this.app.goTitle() }, '← タイトルへ'),
        ),
      ),
    );
  }

  /**
   * Show what the run came to.
   *
   * The record is written here, on the way to the screen, so that a run
   * always counts exactly once — whichever button the player presses next,
   * and whether or not they press one at all.
   */
  show(result) {
    const isBest = recordBest(result);
    this.recordEl.classList.toggle('hidden', !isBest);
    this.rowsEl.replaceChildren(
      this._row('到達ウェーブ', String(result.wave)),
      this._row('撃破', String(result.kills)),
      this._row('生存時間', clock(result.time)),
      this._row('スコア', result.score.toLocaleString('en-US'), true),
    );
    this.open = true;
    this.el.classList.remove('hidden');
    return this;
  }

  close() {
    this.open = false;
    this.el.classList.add('hidden');
    return this;
  }

  _row(label, value, big = false) {
    return h('div', { class: `resultrow${big ? ' big' : ''}` },
      h('span', { class: 'rr-label' }, label),
      h('span', { class: 'rr-value' }, value),
    );
  }
}
