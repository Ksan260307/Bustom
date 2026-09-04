import { h } from './dom.js';
import { onDesktop, quitGame, toggleFullscreen, steamStatus } from '../platform/desktop.js';
import {
  DIFFICULTY_ORDER, SOLO_STAGES, getDifficulty, DEFAULT_DIFFICULTY,
} from '../game/SoloRun.js';
import { t, num } from './i18n.js';

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
/** One record per difficulty. See loadBests. */
const BESTS_KEY = 'blostom.solo.bests.v1';

/**
 * The best run at each difficulty.
 *
 * ONE PER SETTING, which it was not. There was a single record for the
 * whole game, and the score multiplier runs from 0.6 on the easiest to 4.0
 * on the hardest — so one run on HELL buried every other difficulty
 * permanently, and somebody getting better on かんたん could never set a
 * record again. A record that cannot be beaten is not a record.
 *
 * The old single-record store is read once and filed under whatever
 * difficulty it was set on, so nobody loses the run they already have.
 *
 * @returns {Record<string, object>}
 */
export function loadBests() {
  let out = {};
  try {
    const raw = localStorage.getItem(BESTS_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object') out = v;
  } catch (e) {
    out = {};
  }

  // The one-record store, from before this was per-difficulty.
  try {
    const raw = localStorage.getItem(BEST_KEY) ?? localStorage.getItem(BEST_KEY_WAS);
    const old = raw ? JSON.parse(raw) : null;
    if (typeof old?.score === 'number') {
      const id = old.difficulty ?? DEFAULT_DIFFICULTY;
      if (!out[id] || out[id].score < old.score) out[id] = old;
    }
  } catch (e) {
    // Nothing to carry over.
  }
  return out;
}

/** The best run at one difficulty, or null. */
export function loadBest(difficulty = null) {
  const all = loadBests();
  if (difficulty) return all[difficulty] ?? null;
  // No difficulty asked for: the best of all of them, which is what the
  // front page shows when nothing is selected.
  let top = null;
  for (const v of Object.values(all)) {
    if (typeof v?.score === 'number' && (!top || v.score > top.score)) top = v;
  }
  return top;
}

/**
 * Keep `result` if it beats the record. Returns true when it did, because
 * the one thing the player wants to know at the end of a run is whether it
 * counted for anything.
 */
export function recordBest(result) {
  const id = result.difficulty ?? DEFAULT_DIFFICULTY;
  const all = loadBests();
  if (all[id] && all[id].score >= result.score) return false;
  all[id] = result;
  try {
    localStorage.setItem(BESTS_KEY, JSON.stringify(all));
    // The old key is not written any more; it is read once, above, so a
    // record set before this change is not lost.
    localStorage.removeItem(BEST_KEY);
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
        label: t('ソロプレイ'),
        // The setting is part of the row rather than a screen of its own:
        // it is one choice out of five, made once, and a whole page to make
        // it would be a page you walk through without reading.
        note: () => `${SOLO_STAGES.length} STAGES ・ ${getDifficulty(this.app.difficulty).label}`,
        /** Left and right on this row change the setting instead of moving. */
        cycle: (dir) => {
          const at = DIFFICULTY_ORDER.indexOf(this.app.difficulty);
          const n = DIFFICULTY_ORDER.length;
          this.app.setDifficulty(DIFFICULTY_ORDER[(((at + dir) % n) + n) % n]);
          this.render();
        },
        run: () => this.app.startSolo(),
      },
      {
        id: 'versus',
        label: t('対戦'),
        note: 'VERSUS ・ 2-4 PLAYERS',
        run: () => this.app.openVersus(),
      },
      {
        id: 'edit',
        label: t('ガレージ'),
        note: 'EDITOR',
        run: () => this.app.setMode('edit'),
      },
      {
        id: 'field',
        label: t('テストフィールド'),
        note: 'FREE PLAY',
        run: () => this.app.setMode('field'),
      },
      {
        id: 'replays',
        label: t('リプレイ'),
        note: 'REPLAY',
        run: () => this.app.ui.replays.show(),
      },
      {
        id: 'options',
        label: t('設定'),
        note: 'OPTIONS',
        run: () => this.app.openOptions(),
      },
      {
        id: 'keys',
        label: t('キー設定'),
        note: 'CONTROLS',
        run: () => this.app.ui.keyConfig.show(),
      },
      {
        id: 'help',
        label: t('使い方'),
        note: 'HELP',
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
        ),
        this.listEl,
        this.bestEl,
        h('div', { class: 'titlefoot' },
          h('span', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), t(' 選択')),
          h('span', {}, h('kbd', {}, '←'), h('kbd', {}, '→'), t(' 難易度')),
          h('span', {}, h('kbd', {}, 'Enter'), t(' 決定')),
          h('span', {}, h('kbd', {}, 'F11'), t(' 全画面')),
          h('span', {}, h('kbd', {}, 'F1'), t(' 使い方')),
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
      label: t('フルスクリーン'),
      note: 'F11',
      run: () => { toggleFullscreen(); },
    }];
    if (onDesktop()) {
      extra.push({
        id: 'quit',
        label: t('ゲームを終了'),
        note: 'EXIT',
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
    // The front page was silent, which reads as a page that has not
    // finished loading. It is also the only place the player can hear that
    // the sound is working before a fight starts.
    this.app.field?.feedback?.ui?.('move');
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
    this.app.field?.feedback?.ui?.('select');
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
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { take(); this._cycle(-1); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { take(); this._cycle(1); }
    else if (e.code === 'Enter' || e.code === 'Space') { take(); this.choose(); }
  }

  /** Left / right on a row that offers a choice. */
  _cycle(dir) {
    const item = this.items[this.index];
    if (item?.cycle) item.cycle(dir);
    return this;
  }

  render() {
    this.listEl.replaceChildren(...this.items.map((item, i) => h('button', {
      class: `titleitem${i === this.index ? ' active' : ''}`,
      onClick: () => { this.index = i; this.choose(); },
      onMouseEnter: () => this.highlight(i),
    },
      h('span', { class: 'ti-label' }, t(item.label)),
      h('span', { class: 'ti-note' }, typeof t(item.note) === 'function' ? t(item.note)() : t(item.note)),
      // Only where there is something to turn. An arrow on every row would
      // promise a choice that four of them do not have.
      item.cycle ? h('span', { class: 'ti-cycle' }, '◂ ▸') : null,
    )));

    this._showPlatform();

    // The record for the difficulty the player is looking at, so changing
    // the setting on the Solo row changes the number underneath it. A
    // single global best told somebody on かんたん about a run on HELL.
    const best = loadBest(this.app.difficulty);
    this.bestEl.replaceChildren(
      best
        ? h('span', {},
          `${getDifficulty(this.app.difficulty).label} `,
          'BEST ', h('b', {}, num(best.score)),
          ' / WAVE ', h('b', {}, String(best.wave)))
        : h('span', { class: 'dim' }, t('まだ記録がありません')),
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
          h('button', { class: 'primary wide', onClick: () => this.app.startSolo() }, t('▶ もう一度')),
          h('button', { class: 'wide', onClick: () => this.app.setMode('edit') }, t('🔧 機体を組む')),
          h('button', { class: 'wide', onClick: () => this.app.goTitle() }, t('← タイトルへ')),
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
      // How far up the ladder, first: a run is a walk through the places
      // now, and that is what the player was trying to do.
      this._row(t('難易度'), result.difficultyLabel ?? '—'),
      this._row(t('到達ステージ'), result.cleared
        ? `ALL CLEAR (${result.stages})`
        : `${result.stage} / ${result.stages}`),
      this._row(t('到達ウェーブ'), String(result.wave)),
      this._row(t('撃破'), String(result.kills)),
      this._row(t('生存時間'), clock(result.time)),
      this._row(t('スコア'), result.score.toLocaleString('en-US'), true),
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
