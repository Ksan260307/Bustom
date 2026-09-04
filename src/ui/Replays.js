import { h, resizable } from './dom.js';
import {
  listReplays, loadReplayBody, deleteReplay,
} from '../game/Replay.js';
import { unpackDoc } from '../core/Codec.js';
import { t, num, clock } from './i18n.js';

// ============================================================
//  The recordings, and a way to watch one.
//
//  Deliberately plain. A replay browser can grow scrubbing, per-seat
//  cameras, export — and all of that is worth having later; none of it is
//  worth having before the list exists, because a feature nobody can reach
//  is the state this whole thing was already in.
// ============================================================

/** dd/mm hh:mm, which is as much as anybody needs to tell two runs apart. */
function when(at) {
  const d = new Date(at);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export class Replays {
  /** @param {object} app */
  constructor(app) {
    this.app = app;
    this.open = false;
    this.busy = false;

    this.listEl = h('div', { class: 'keyrows' });
    this.noteEl = h('div', { class: 'keynote' }, '');

    this.box = h('div', { class: 'keybox' },
      h('div', { class: 'keyhead' },
        h('div', { class: 'brand' }, 'REPLAY', h('small', {}, 'BLOSTOM')),
        h('div', { class: 'spacer' }),
        h('button', { class: 'icon', title: t('閉じる'), onClick: () => this.close() }, '✕'),
      ),
      this.listEl,
      this.noteEl,
      h('div', { class: 'keyfoot' },
        h('div', { class: 'spacer' }),
        h('button', { class: 'primary', onClick: () => this.close() }, t('閉じる')),
      ),
    );
    resizable(this.box, {
      key: 'replays', edges: 'es', minW: 340, minH: 260, speed: 2,
    });
    this.el = h('div', { id: 'replays', class: 'hidden' }, this.box);

    this._onKey = (e) => {
      if (this.open && e.key === 'Escape') { e.preventDefault(); this.close(); }
    };
    window.addEventListener('keydown', this._onKey);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    return this;
  }

  setOpen(on) {
    this.open = !!on;
    this.el.classList.toggle('hidden', !this.open);
    if (this.open) this.render();
    return this;
  }

  show() { return this.setOpen(true); }

  close() { return this.setOpen(false); }

  _note(text) { this.noteEl.textContent = text ?? ''; return this; }

  async _watch(entry) {
    if (this.busy) return false;
    this.busy = true;
    this._note(t('読み込んでいます…'));
    try {
      const body = loadReplayBody(entry.id);
      if (!body) throw new Error(t('見つかりません'));
      await this.app.watchReplay(await unpackDoc(body));
      this.close();
      return true;
    } catch (e) {
      this._note(t('この記録は読めません'));
      console.warn('replay would not open', e);
      return false;
    } finally {
      this.busy = false;
    }
  }

  render() {
    const list = listReplays();
    if (!list.length) {
      this.listEl.replaceChildren(
        h('div', { class: 'inspector-empty' }, t('まだ記録がありません。対戦すると自動で残ります。')),
      );
      return this;
    }

    this.listEl.replaceChildren(...list.map((entry) => h('div', { class: 'keyrow' },
      h('span', { class: 'keyaction' },
        h('b', {}, entry.seats?.length ? entry.seats.join(' vs ') : (entry.name || 'BLOSTOM')),
        h('small', { class: 'dim' },
          ` ${when(entry.at)} ・ ${clock((entry.ticks ?? 0) / 60)} ・ ${num(entry.ticks ?? 0)}`)),
      h('div', { class: 'keychips' },
        h('button', {
          class: 'tiny',
          onClick: () => this._watch(entry),
        }, t('見る')),
        h('button', {
          class: 'tiny danger',
          title: t('この記録を削除'),
          onClick: () => { deleteReplay(entry.id); this.render(); },
        }, '✕'),
      ))));
    return this;
  }
}
