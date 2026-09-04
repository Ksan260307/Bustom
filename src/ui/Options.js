import { h, resizable } from './dom.js';
import {
  QUALITY, QUALITY_ORDER, UI_SCALE_MIN, UI_SCALE_MAX,
} from '../core/Settings.js';
import {
  t, locale, setLocale, LOCALES, LOCALE_ORDER,
} from './i18n.js';

// ============================================================
//  Options.
//
//  The screen that was missing. Five of the things this game could not do
//  were not missing features at all — the mixer had a mute, the input had
//  an invert, the renderer had every knob — they were features with no
//  door on them. This is the door.
//
//  Laid out as sections rather than tabs: there are four of them and they
//  fit, and a tab you have to find is how the invert-Y setting stays lost.
//
//  Changing the language REBUILDS the interface rather than patching it.
//  Every panel here already knows how to render itself from the tables, so
//  rebuilding is both correct and less code than tracking which text nodes
//  hold which string — and it is the only way the parts of the UI built in
//  a constructor pick the new language up.
// ============================================================

/** A labelled row with a control on the right. */
function row(label, control, note = null) {
  return h('div', { class: 'optrow' },
    h('div', { class: 'optlabel' },
      h('span', {}, label),
      note ? h('small', {}, note) : null),
    h('div', { class: 'optctl' }, control));
}

/** A row of buttons where exactly one is on. */
function choice(options, current, onPick) {
  return h('div', { class: 'optchoice' },
    ...options.map((o) => h('button', {
      class: o.id === current ? 'active' : '',
      title: o.blurb ?? null,
      onClick: () => onPick(o.id),
    }, o.label)));
}

export class Options {
  /**
   * @param {object} deps
   * @param {import('../core/Settings.js').Settings} deps.settings
   * @param {() => void} [deps.onLanguage]  rebuild the interface
   */
  constructor({ settings, onLanguage = () => {} }) {
    this.settings = settings;
    this.onLanguage = onLanguage;
    this.open = false;

    this.bodyEl = h('div', { class: 'optbody' });
    this.box = h('div', { class: 'keybox optbox' },
      h('div', { class: 'keyhead' },
        h('div', { class: 'brand' }, 'OPTIONS', h('small', {}, 'BLOSTOM')),
        h('div', { class: 'spacer' }),
        h('button', { class: 'icon', title: t('閉じる'), onClick: () => this.close() }, '✕'),
      ),
      this.bodyEl,
      h('div', { class: 'keyfoot' },
        h('button', { onClick: () => this._reset() }, t('初期設定に戻す')),
        h('div', { class: 'spacer' }),
        h('button', { class: 'primary', onClick: () => this.close() }, t('閉じる')),
      ),
    );
    resizable(this.box, {
      key: 'options', edges: 'es', minW: 360, minH: 300, speed: 2,
    });
    this.el = h('div', { id: 'options', class: 'hidden' }, this.box);

    this._onKey = (e) => {
      if (!this.open) return;
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    };
    window.addEventListener('keydown', this._onKey);
  }

  // ---------------------------------------------------------- open / close

  setOpen(on) {
    this.open = !!on;
    this.el.classList.toggle('hidden', !this.open);
    if (this.open) this.render();
    return this;
  }

  show() { return this.setOpen(true); }

  close() { return this.setOpen(false); }

  toggle() { return this.setOpen(!this.open); }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    return this;
  }

  _reset() {
    this.settings.reset();
    this.render();
  }

  /** A 0..1 setting, shown as a percentage. */
  _pct(key) {
    const s = this.settings;
    const out = h('span', { class: 'optval' }, `${Math.round(s.get(key) * 100)}%`);
    const input = h('input', {
      type: 'range',
      min: 0,
      max: 1,
      step: 0.05,
      value: s.get(key),
      onInput: (e) => {
        const v = Number(e.target.value);
        out.textContent = `${Math.round(v * 100)}%`;
        s.set(key, v);
      },
    });
    return h('div', { class: 'optslider' }, input, out);
  }

  // ---------------------------------------------------------- render

  render() {
    const s = this.settings;
    this.bodyEl.replaceChildren(
      ...this._language(),
      ...this._sound(s),
      ...this._picture(s),
      ...this._controls(s),
    );
    this.bodyEl.scrollTop = 0;
    return this;
  }

  _language() {
    return [
      h('h4', { class: 'opthead' }, t('言語')),
      row(t('表示言語'), choice(
        LOCALE_ORDER.map((id) => ({ id, label: LOCALES[id].label })),
        locale(),
        (id) => {
          if (!setLocale(id)) return;
          // The whole interface is rebuilt, this panel included, so it is
          // reopened afterwards rather than re-rendered in place.
          this.onLanguage(id);
        },
      ), t('切り替えると画面を作り直します')),
    ];
  }

  _sound(s) {
    return [
      h('h4', { class: 'opthead' }, t('音')),
      row(t('全体の音量'), this._pct('volumeMaster')),
      row(t('音楽'), this._pct('volumeMusic')),
      row(t('効果音'), this._pct('volumeSfx')),
      row(t('消音'), h('label', { class: 'optswitch' },
        h('input', {
          type: 'checkbox',
          ...(s.get('muted') ? { checked: 'checked' } : {}),
          onChange: (e) => s.set('muted', e.target.checked),
        }),
        h('span', {}, t('すべての音を止める')))),
    ];
  }

  _picture(s) {
    const q = s.get('quality');
    return [
      h('h4', { class: 'opthead' }, t('画質')),
      row(t('描画の重さ'), choice(
        QUALITY_ORDER.map((id) => ({
          id, label: t(QUALITY[id].label), blurb: t(QUALITY[id].blurb),
        })),
        q,
        (id) => { s.set('quality', id); this.render(); },
      ), t(QUALITY[q].blurb)),

      row(t('フレームレート表示'), h('label', { class: 'optswitch' },
        h('input', {
          type: 'checkbox',
          ...(s.get('showFps') ? { checked: 'checked' } : {}),
          onChange: (e) => s.set('showFps', e.target.checked),
        }),
        h('span', {}, t('画面の隅に出す')))),

      h('h4', { class: 'opthead' }, t('読みやすさ')),
      row(t('文字の大きさ'), (() => {
        const out = h('span', { class: 'optval' }, `${Math.round(s.get('uiScale') * 100)}%`);
        return h('div', { class: 'optslider' },
          h('input', {
            type: 'range',
            min: UI_SCALE_MIN,
            max: UI_SCALE_MAX,
            step: 0.05,
            value: s.get('uiScale'),
            onInput: (e) => {
              const v = Number(e.target.value);
              out.textContent = `${Math.round(v * 100)}%`;
              s.set('uiScale', v);
            },
          }), out);
      })(), t('高解像度の画面で小さすぎるときに')),

      row(t('動きを抑える'), choice([
        { id: 'auto', label: t('OSに従う') },
        { id: 'on', label: t('抑える') },
        { id: 'off', label: t('抑えない') },
      ], (() => {
        const v = s.get('reduceMotion');
        return v === null ? 'auto' : (v ? 'on' : 'off');
      })(), (id) => {
        s.set('reduceMotion', id === 'auto' ? null : id === 'on');
        this.render();
      }), t('画面の揺れ・にじみ・カメラの慣性を弱めます')),
    ];
  }

  _controls(s) {
    return [
      h('h4', { class: 'opthead' }, t('操作')),
      row(t('マウス感度'), (() => {
        const out = h('span', { class: 'optval' }, s.get('mouseSensitivity').toFixed(2));
        return h('div', { class: 'optslider' },
          h('input', {
            type: 'range',
            min: 0.2,
            max: 3,
            step: 0.05,
            value: s.get('mouseSensitivity'),
            onInput: (e) => {
              const v = Number(e.target.value);
              out.textContent = v.toFixed(2);
              s.set('mouseSensitivity', v);
            },
          }), out);
      })()),
      row(t('上下を反転'), h('label', { class: 'optswitch' },
        h('input', {
          type: 'checkbox',
          ...(s.get('invertY') ? { checked: 'checked' } : {}),
          onChange: (e) => s.set('invertY', e.target.checked),
        }),
        h('span', {}, t('マウスを上げると下を向く')))),
      row(t('横移動を反転'), h('label', { class: 'optswitch' },
        h('input', {
          type: 'checkbox',
          ...(s.get('invertStrafe') ? { checked: 'checked' } : {}),
          onChange: (e) => s.set('invertStrafe', e.target.checked),
        }),
        h('span', {}, t('左右の移動キーを入れ替える')))),
      h('div', { class: 'keynote' }, t('キーの割り当ては「キー設定」から変えられます')),
    ];
  }
}
