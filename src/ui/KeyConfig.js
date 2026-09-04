import { h, resizable } from './dom.js';
import {
  ACTION_GROUPS, ACTION_LABEL, TOOL_ACTIONS, keyLabel,
} from '../zmf/InputManager.js';
import { t } from './i18n.js';

// ============================================================
//  Key config : rebind anything, one key to one job.
//
//  The panel talks only to InputManager, which is the single place that
//  knows what a key means. Assigning a key that is already spoken for
//  takes it away from its old owner and says so — silently ending up with
//  one key doing two things is how a control scheme rots.
// ============================================================

/** Keys the browser or the app itself needs; never let them be captured. */
const RESERVED = new Set(['Escape', 'F5', 'F11', 'F12']);

export class KeyConfig {
  /**
   * @param {import('../zmf/InputManager.js').InputManager} input
   * @param {{ onChange?: () => void }} [opts]
   */
  constructor(input, { onChange = () => {} } = {}) {
    this.input = input;
    this.onChange = onChange;
    /** The row waiting for a key, or null. */
    this.listening = null;
    this.open = false;

    this.rowsEl = h('div', { class: 'keyrows' });
    this.noteEl = h('div', { class: 'keynote' }, '');

    this.box = h('div', { class: 'keybox' },
        h('div', { class: 'keyhead' },
          h('div', { class: 'brand' }, 'KEY', h('small', {}, 'CONFIG')),
          h('div', { class: 'spacer' }),
          h('button', { class: 'icon', title: t('閉じる'), onClick: () => this.close() }, '✕'),
        ),
        this.rowsEl,
        this.noteEl,
        h('div', { class: 'keyfoot' },
          h('button', { onClick: () => this.reset() }, t('初期設定に戻す')),
          h('div', { class: 'spacer' }),
          h('button', { class: 'primary', onClick: () => this.close() }, t('閉じる')),
        ),
    );
    // Centred on screen, so one pixel of drag only moves its edge half a
    // pixel: `speed` is what keeps the grip under the pointer.
    resizable(this.box, { key: 'keyconfig', edges: 'es', minW: 320, minH: 220, speed: 2 });
    this.el = h('div', { id: 'keyconfig', class: 'hidden' }, this.box);

    // Capture phase, so a rebind beats every other handler on the page.
    this._onKey = (e) => this._capture(e, e.code);
    this._onMouse = (e) => this._capture(e, `Mouse${e.button}`);
    window.addEventListener('keydown', this._onKey, true);
    window.addEventListener('mousedown', this._onMouse, true);

    this.render();
  }

  // ---------------------------------------------------------- open / close

  setOpen(on) {
    this.open = on;
    this.el.classList.toggle('hidden', !on);
    this.listening = null;
    if (on) this.render();
    return this;
  }

  show() { return this.setOpen(true); }
  close() { return this.setOpen(false); }
  toggle() { return this.setOpen(!this.open); }

  // ---------------------------------------------------------- rebinding

  /** Arm a row: the next key or button pressed lands here. */
  listen(action, index) {
    this.listening = { action, index };
    this._note(t('「{0}」に割り当てるキーを押してください（Esc で中止）', [t(ACTION_LABEL[action])]));
    this.render();
  }

  _capture(e, code) {
    if (!this.open || !this.listening) return;
    e.preventDefault();
    e.stopPropagation();

    if (code === 'Escape') {
      this.listening = null;
      this._note(t('中止しました'));
      this.render();
      return;
    }
    if (RESERVED.has(code)) {
      this._note(t('{0} は割り当てられません', [keyLabel(code)]));
      return;
    }

    const { action, index } = this.listening;

    /*
     * The workbench's tools are a second, separate set of bindings.
     *
     * They have to be, because they answer a different question on a
     * different screen — and because a key is allowed to mean the weapon
     * bone on the bench and forward in a fight. So a tool row never steals
     * from a fight row and vice versa; each set is only ever compared with
     * itself.
     */
    if (TOOL_ACTIONS.includes(action)) {
      const stolen = this.input.bindTool(action, code);
      this.listening = null;
      this._note(stolen
        ? t('{0} を「{1}」から移しました', [keyLabel(code), t(ACTION_LABEL[stolen])])
        : t('{0} を割り当てました', [keyLabel(code)]));
      this.render();
      this.onChange();
      return;
    }

    const codes = this.input.keysFor(action);
    const previous = this.input.actionFor(code);

    if (index < codes.length) {
      // Replacing a slot: drop the old key, then take the new one.
      codes.splice(index, 1);
      this.input.setBinding(action, codes.length ? codes : [code]);
    }
    this.input.bind(action, code);

    this.listening = null;
    if (previous && previous !== action) {
      // Stealing is allowed — but an action left with nothing is a control
      // that has quietly stopped working, so say it out loud.
      const orphan = this.input.keysFor(previous).length === 0;
      this._note(orphan
        ? t('{0} を「{1}」から移しました — {2}が未設定です', [keyLabel(code), t(ACTION_LABEL[previous]), t(ACTION_LABEL[previous])])
        : t('{0} を「{1}」から移しました', [keyLabel(code), t(ACTION_LABEL[previous])]));
    } else {
      this._note(t('{0} を割り当てました', [keyLabel(code)]));
    }
    this.render();
    this.onChange();
  }

  remove(action, code) {
    if (!this.input.unbind(action, code)) {
      this._note(t('最後のひとつは外せません'));
      this.render();
      return;
    }
    this._note(t('{0} を外しました', [keyLabel(code)]));
    this.render();
    this.onChange();
  }

  reset() {
    this.input.resetBindings();
    this.listening = null;
    this._note(t('初期設定に戻しました'));
    this.render();
    this.onChange();
  }

  _note(msg) { this.noteEl.textContent = msg; }

  // ---------------------------------------------------------- render

  render() {
    const kids = [];
    for (const group of ACTION_GROUPS) {
      kids.push(h('h3', { class: 'inline' }, t(group.label)));
      for (const action of group.actions) {
        kids.push(this._row(action));
      }
    }
    this.rowsEl.replaceChildren(...kids);
    return this;
  }

  _row(action) {
    // A tool row reads from the bench's table, a fight row from the
    // fight's. Everything below is the same either way.
    const tool = TOOL_ACTIONS.includes(action);
    const codes = tool
      ? [...(this.input.toolBindings[action] ?? [])]
      : this.input.keysFor(action);
    const waiting = this.listening?.action === action;

    const chips = codes.map((code, i) => h('span', {
      class: `keychip${waiting && this.listening.index === i ? ' listening' : ''}`,
    },
    h('button', {
      class: 'keychiplabel',
      title: t('クリックして割り当て直す'),
      onClick: () => this.listen(action, i),
    }, waiting && this.listening.index === i ? '…' : keyLabel(code)),
    codes.length > 1
      ? h('button', { class: 'keychipx', title: t('外す'), onClick: () => this.remove(action, code) }, '×')
      : null));

    // One tool, one key: there is no case for two keys selecting the same
    // brush, and the extra chip on eleven rows is eleven chances to make
    // the panel longer than the screen.
    if (tool) {
      return h('div', { class: 'keyrow' },
        h('span', { class: 'keyaction' }, t(ACTION_LABEL[action] ?? action)),
        h('div', { class: 'keychips' }, ...chips));
    }

    return h('div', { class: `keyrow${codes.length ? '' : ' unbound'}` },
      h('span', { class: 'keyaction' }, t(ACTION_LABEL[action] ?? action)),
      h('div', { class: 'keychips' },
        ...chips,
        codes.length ? null : h('span', { class: 'keyunset' }, t('未設定')),
        h('button', {
          class: `keyadd${waiting && this.listening.index >= codes.length ? ' listening' : ''}`,
          title: t('キーを追加'),
          onClick: () => this.listen(action, codes.length),
        }, waiting && this.listening.index >= codes.length ? '…' : '＋'),
      ),
    );
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey, true);
    window.removeEventListener('mousedown', this._onMouse, true);
    this.el.remove();
  }
}
