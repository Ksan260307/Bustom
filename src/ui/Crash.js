// ============================================================
//  When something goes wrong, say so.
//
//  Three ways this game could fail without telling anybody:
//
//    1. An uncaught exception. There are no developer tools open in a
//       shipped Electron app, so the message went nowhere at all — the
//       frame simply stopped and the window sat there looking fine.
//    2. A rejected promise nobody caught. Same, and now more of them:
//       saving and loading are asynchronous since the codec went in.
//    3. The GPU context going away. Windows resets a driver and the canvas
//       goes black for ever, taking the machine on the workbench with it.
//
//  The third is the one worth real effort, because it is RECOVERABLE and
//  because what it costs is somebody's work. The context comes back on its
//  own most of the time; what has to survive in the meantime is the
//  document, and there is already an autosaved draft for exactly that.
//
//  Nothing here tries to be clever about the error. It says what happened,
//  offers the one action that helps, and keeps the text somewhere it can be
//  copied into a bug report — because "it crashed" from a player who had no
//  way to see anything is a report nobody can act on.
// ============================================================

import { h } from './dom.js';
import { t } from './i18n.js';

/** How many to keep. A crash loop should not eat the heap. */
const MAX_LOG = 40;

export class CrashReporter {
  /**
   * @param {object} deps
   * @param {HTMLCanvasElement} deps.canvas   the WebGL canvas to watch
   * @param {() => boolean} [deps.hasWork]    is there unsaved work?
   * @param {() => void} [deps.onReload]
   */
  constructor({ canvas, hasWork = () => false, onReload = null } = {}) {
    this.canvas = canvas;
    this.hasWork = hasWork;
    this.onReload = onReload ?? (() => window.location.reload());
    /** Everything that has gone wrong this session, newest last. */
    this.log = [];
    this.shown = false;

    this.titleEl = h('div', { class: 'crashtitle' });
    this.bodyEl = h('div', { class: 'crashbody' });
    this.detailEl = h('pre', { class: 'crashdetail' });
    this.actionsEl = h('div', { class: 'crashactions' });

    this.el = h('div', { id: 'crash', class: 'hidden' },
      h('div', { class: 'crashbox' },
        this.titleEl, this.bodyEl, this.detailEl, this.actionsEl));

    this._onError = (e) => this.record('error', e?.error ?? e?.message ?? e, {
      at: `${e?.filename ?? ''}:${e?.lineno ?? ''}`,
    });
    this._onRejection = (e) => this.record('unhandledrejection', e?.reason);
    this._onLost = (e) => {
      // Asking to keep the context is what makes `webglcontextrestored`
      // possible at all; without it the loss is final.
      e.preventDefault();
      this.showContextLost();
    };
    this._onRestored = () => this.hide();

    window.addEventListener('error', this._onError);
    window.addEventListener('unhandledrejection', this._onRejection);
    canvas?.addEventListener('webglcontextlost', this._onLost, false);
    canvas?.addEventListener('webglcontextrestored', this._onRestored, false);
  }

  dispose() {
    window.removeEventListener('error', this._onError);
    window.removeEventListener('unhandledrejection', this._onRejection);
    this.canvas?.removeEventListener('webglcontextlost', this._onLost);
    this.canvas?.removeEventListener('webglcontextrestored', this._onRestored);
    return this;
  }

  /**
   * Keep one failure, and show the panel if it is the first.
   *
   * Only the FIRST is put on screen. A crash usually arrives as a hundred
   * of itself — one per frame — and a dialog that redraws sixty times a
   * second is worse than the crash.
   */
  record(kind, err, extra = {}) {
    const entry = {
      kind,
      at: new Date().toISOString(),
      message: String(err?.message ?? err ?? 'unknown'),
      stack: String(err?.stack ?? ''),
      ...extra,
    };
    this.log.push(entry);
    if (this.log.length > MAX_LOG) this.log.shift();
    // Still worth putting in the console: somebody running the dev build
    // has one open, and it costs nothing.
    console.error(`[${kind}]`, err);
    if (!this.shown) this.show(entry);
    return entry;
  }

  /** Everything that went wrong, as text a person can paste somewhere. */
  report() {
    const head = [
      `BLOSTOM ${new Date().toISOString()}`,
      typeof navigator !== 'undefined' ? navigator.userAgent : '',
      '',
    ].join('\n');
    return head + this.log.map((e) => (
      `[${e.at}] ${e.kind}: ${e.message}${e.at2 ? ` (${e.at2})` : ''}\n${e.stack}`
    )).join('\n\n');
  }

  hide() {
    this.shown = false;
    this.el.classList.add('hidden');
    return this;
  }

  _render(title, body, detail, actions) {
    this.titleEl.textContent = title;
    this.bodyEl.replaceChildren(...body);
    this.detailEl.textContent = detail;
    this.actionsEl.replaceChildren(...actions);
    this.el.classList.remove('hidden');
    this.shown = true;
    return this;
  }

  /** An exception or a rejected promise. */
  show(entry) {
    const saved = this.hasWork()
      ? t('作業中の内容は自動保存されています。次に編集画面を開いたときに復元できます。')
      : t('保存していない変更はありません。');
    return this._render(
      t('問題が起きました'),
      [
        h('p', {}, t('ゲームは動き続けているかもしれませんが、何かが失敗しました。')),
        h('p', {}, saved),
      ],
      `${entry.message}\n${entry.stack}`.slice(0, 1200),
      [
        h('button', { onClick: () => this._copy() }, t('内容をコピー')),
        h('div', { class: 'spacer' }),
        h('button', { onClick: () => this.hide() }, t('閉じる')),
        h('button', { class: 'primary', onClick: () => this.onReload() }, t('再起動')),
      ],
    );
  }

  /** The GPU went away. */
  showContextLost() {
    this.record('webglcontextlost', new Error('WebGL context lost'));
    return this._render(
      t('描画が停止しました'),
      [
        h('p', {}, t('グラフィックドライバがリセットされたようです。')),
        h('p', {}, this.hasWork()
          ? t('作業中の内容は自動保存されています。次に編集画面を開いたときに復元できます。')
          : t('保存していない変更はありません。')),
      ],
      '',
      [
        h('div', { class: 'spacer' }),
        h('button', { class: 'primary', onClick: () => this.onReload() }, t('再起動')),
      ],
    );
  }

  async _copy() {
    try {
      await navigator.clipboard.writeText(this.report());
    } catch {
      // Falls back to selecting it, which is what the box is for.
      const range = document.createRange();
      range.selectNodeContents(this.detailEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    return this;
  }
}
