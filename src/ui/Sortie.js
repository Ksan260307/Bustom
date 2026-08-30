import { h } from './dom.js';
import { Assembly, computeStats, PRESET_LIST, PRESETS } from '../core/Assembly.js';
import { machinePortrait } from './PartSketch.js';
import {
  DIFFICULTIES, DIFFICULTY_ORDER, SOLO_STAGES, SOLO_WAVES, getDifficulty, powerAt,
} from '../game/SoloRun.js';
import { ARENAS } from '../game/Arenas.js';
import { EQUIP_META } from '../core/constants.js';

// ============================================================
//  The last screen before a run.
//
//  A run used to start the instant the menu was pressed, which is the wrong
//  moment for two reasons. The obvious one is that the machine you are
//  about to fight twenty waves with might have no weapons on it, and you
//  find that out in wave one. The quieter one is that the difficulty was a
//  setting you changed on a menu row and then immediately stopped seeing —
//  so the thing that decides the whole run was chosen with the least
//  attention of anything on screen.
//
//  This is the check before the door: what you are taking, where it goes,
//  and how hard you asked for it to be. All three on one screen, and no
//  step between here and the fight.
// ============================================================

/** What each size class is called where a player will read it. */
const SIZE_LABEL = {
  tiny: '極小', small: '小型', medium: '中型', large: '大型', huge: '超大型',
};

/** A row of the machine's own numbers. */
function stat(label, value, tone = '') {
  return h('div', { class: `sortiestat ${tone}` },
    h('span', { class: 'k' }, label),
    h('span', { class: 'v' }, value));
}

export class SortieScreen {
  /** @param {import('../main.js').App} app */
  constructor(app) {
    this.app = app;
    this.open = false;
    /** Which difficulty row is highlighted. */
    this.index = 0;

    /**
     * Which machine goes out, as a document rather than as a reference.
     *
     * Null means the one on the bench. Anything else is a copy taken when
     * it was chosen, so picking a saved machine here does not disturb what
     * is being worked on in the editor — a run should never be a reason to
     * lose the thing you were building.
     */
    this.picked = null;
    this.pickedFrom = 'bench';

    this.portraitEl = h('div', { class: 'sortieportrait' });
    this.machineEl = h('div', { class: 'sortiecol' });
    this.pickerEl = h('div', { class: 'sortiepicker' });
    this.statsEl = h('div', { class: 'sortiestats' });
    this.warnEl = h('div', { class: 'sortiewarn hidden' });
    this.diffEl = h('div', { class: 'sortiediffs' });
    this.stagesEl = h('div', { class: 'sortiestages' });

    this.el = h('div', { id: 'sortie', class: 'hidden' },
      h('div', { class: 'sortiebox' },
        h('div', { class: 'sortiehead' },
          h('h2', {}, 'SORTIE'),
          h('span', { class: 'sortiesub' }, 'ENTER 出撃 ・ ESC 戻る'),
        ),
        h('div', { class: 'sortiebody' },
          h('div', { class: 'sortiecol' },
            h('h3', {}, 'MACHINE'),
            h('div', { class: 'sortiemachine' },
              this.portraitEl,
              h('div', { class: 'sortiemeta' }, this.machineEl, this.statsEl),
            ),
            this.warnEl,
            h('h3', {}, 'SELECT'),
            this.pickerEl,
          ),
          h('div', { class: 'sortiecol' },
            h('h3', {}, 'DIFFICULTY'),
            this.diffEl,
            h('h3', {}, 'ROUTE'),
            this.stagesEl,
          ),
        ),
        h('div', { class: 'sortiefoot' },
          h('button', { class: 'ghost', onClick: () => this.back() }, '← 戻る'),
          h('button', { class: 'ghost', onClick: () => this.toEditor() }, '機体を組み直す'),
          h('div', { class: 'spacer' }),
          h('button', { class: 'primary', onClick: () => this.launch() }, '出撃 ▶'),
        ),
      ),
    );

    this._onKey = (e) => this._key(e);
    window.addEventListener('keydown', this._onKey);
  }

  show() {
    this.index = Math.max(0, DIFFICULTY_ORDER.indexOf(this.app.difficulty));
    // Back to the bench each time it opens: the machine you just finished
    // is the one you almost always want, and a stale choice from last time
    // is a machine you did not pick going out under your name.
    this.picked = null;
    this.pickedFrom = 'bench';
    this.render();
    this.el.classList.remove('hidden');
    this.open = true;
    return this;
  }

  close() {
    this.el.classList.add('hidden');
    this.open = false;
    return this;
  }

  back() {
    this.close();
    this.app.goTitle();
    return this;
  }

  toEditor() {
    this.close();
    this.app.setMode('edit');
    return this;
  }

  launch() {
    this.close();
    this.app.beginSolo(this.picked);
    return this;
  }

  /**
   * Take a machine for the run.
   *
   * Copied, not referenced. The bench keeps whatever is on it.
   *
   * @param {object|null} json null puts the bench machine back
   * @param {string} from where it came from, for the label
   */
  pick(json, from) {
    this.picked = json ? JSON.parse(JSON.stringify(json)) : null;
    this.pickedFrom = from;
    this.render();
    return this;
  }

  /** The machine that would go out right now. */
  get machine() {
    return this.picked ? Assembly.fromJSON(this.picked) : this.app.mainAssembly;
  }

  move(delta) {
    const n = DIFFICULTY_ORDER.length;
    this.index = ((this.index + delta) % n + n) % n;
    this.app.setDifficulty(DIFFICULTY_ORDER[this.index]);
    this.render();
    return this;
  }

  _key(e) {
    if (!this.open) return;
    const take = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.code === 'ArrowUp' || e.code === 'KeyW') { take(); this.move(-1); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { take(); this.move(1); }
    else if (e.code === 'Enter' || e.code === 'Space') { take(); this.launch(); }
    else if (e.code === 'Escape') { take(); this.back(); }
  }

  render() {
    const asm = this.machine;
    const s = computeStats(asm);
    const doc = this.picked ?? asm.toJSON();

    this.portraitEl.replaceChildren(machinePortrait(doc, 116));

    // Where it came from. A run fought with the wrong machine is a run
    // wasted, and "the one on the bench" and "the one I saved as ACE" are
    // easy to confuse when neither is named on screen.
    const SOURCE = { bench: '編集中', slot: '保存', preset: 'プリセット' };

    this.machineEl.replaceChildren(
      h('div', { class: 'sortiesource' }, SOURCE[this.pickedFrom] ?? ''),
      h('div', { class: 'sortiename' }, asm.name),
      h('div', { class: 'sortiekit' },
        ...(s.weapons.length
          ? s.weapons.map((w) => h('span', { class: 'chip' },
            EQUIP_META[w.equipType]?.label ?? w.equipType))
          : [h('span', { class: 'chip warn' }, '武器なし')]),
      ),
    );

    // The four numbers that decide how it plays, and nothing else: this is
    // a check before the door, not the spec panel.
    this.statsEl.replaceChildren(
      stat('HULL', String(Math.round(s.durability * (1 + (s.hpBonus ?? 0))))),
      stat('MASS', s.mass.toFixed(1)),
      stat('MOBILITY', s.thrustToMass.toFixed(1),
        s.agility > 0.55 ? 'good' : s.agility < 0.22 ? 'warn' : ''),
      stat('WEAPONS', String(s.weapons.length), s.weapons.length ? '' : 'warn'),
    );

    // Said here rather than found out in wave one. Both of these are the
    // difference between a run and a walk to the wreck.
    const problems = [];
    if (!s.weapons.length) problems.push('武器プレートがありません。素の機関砲だけで戦うことになります。');
    if (!s.dashBonus) problems.push('ブーストプレートがありません。ダッシュもブーストも使えません。');
    if (!s.legs && !s.floatPlates) problems.push('脚もフロートもありません。まともに動けません。');
    this.warnEl.replaceChildren(...problems.map((t) => h('div', {}, t)));
    this.warnEl.classList.toggle('hidden', !problems.length);

    this.diffEl.replaceChildren(...DIFFICULTY_ORDER.map((id, i) => {
      const d = DIFFICULTIES[id];
      return h('button', {
        class: `sortiediff${i === this.index ? ' active' : ''}`,
        onClick: () => { this.index = i; this.app.setDifficulty(id); this.render(); },
      },
        h('span', { class: 'dl' }, d.label),
        h('span', { class: 'dn' }, d.blurb),
        // The curve, in the only two places that matter: where it starts and
        // where it ends. A setting you cannot see the effect of is a setting
        // you argue with rather than answer.
        h('span', { class: 'dv' },
          `×${powerAt(id, 1).toFixed(1)} → ×${powerAt(id, SOLO_WAVES).toFixed(1)}`,
          h('br'), `残機 ${d.lives} ・ スコア ${d.score}倍`),
      );
    }));

    // Everything that could go out: what is on the bench, what has been
    // saved, and everything the game ships.
    const slots = this.app.slots();
    const entry = (label, sub, json, from, on) => h('button', {
      class: `sortiepick${on ? ' active' : ''}`,
      title: label,
      onClick: () => this.pick(json, from),
    },
      machinePortrait(json, 52),
      h('span', { class: 'pl' }, label),
      h('span', { class: 'ps' }, sub),
    );

    this.pickerEl.replaceChildren(
      entry(this.app.mainAssembly.name, '編集中', this.app.mainAssembly.toJSON(), 'bench',
        this.pickedFrom === 'bench'),
      ...slots.map((sl) => entry(sl.name, '保存', sl.json, 'slot',
        this.pickedFrom === 'slot' && this.picked?.name === sl.json.name)),
      ...PRESET_LIST.map((p) => {
        const json = PRESETS[p.id].build().toJSON();
        return entry(p.label, SIZE_LABEL[p.size] ?? '', json, 'preset',
          this.pickedFrom === 'preset' && this.picked?.name === json.name);
      }),
    );

    this.stagesEl.replaceChildren(...SOLO_STAGES.map((st, i) => h('div', { class: 'sortiestage' },
      h('span', { class: 'sn' }, String(i + 1).padStart(2, '0')),
      h('span', { class: 'sl' }, ARENAS[st.arena].label),
      h('span', { class: 'sw' }, `${st.waves}W`))));
    return this;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    return this;
  }
}
