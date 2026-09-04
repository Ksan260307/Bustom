import * as THREE from 'three';
import {
  BONE_META, BONE_GAUGE, VOX_LEVELS,
  SIZE_MIN, SIZE_MAX, SIZE_STEP,
  BONE_LENGTH_MIN, BONE_LENGTH_MAX, BONE_RADIUS_MIN, BONE_RADIUS_MAX,
  EQUIP_META, WEAPON_TYPES, SYSTEM_TYPES,
  EQUIP_SIZE_MIN, EQUIP_SIZE_MAX, EQUIP_SIZE_STEP,
  SPIN_RPM_MIN, SPIN_RPM_MAX, CUSTOM_WAVES, CUSTOM_SOURCES,
  CIRCLE_RADIUS_MIN, CIRCLE_RADIUS_MAX, CIRCLE_RADIUS_STEP,
  RING_PLANES, RING_PLANE_DEFAULT,
  BONE_GAIN_MAX, BONE_LAG_MAX, LIMIT_MODES, CHAIN_FALLOFF_DEFAULT,
  BUDGET, BUDGET_LABEL,
} from '../core/constants.js';
import { PRESET_LIST, SIZE_CLASSES } from '../core/Assembly.js';

/** What each size class is called where a player will read it. */
const SIZE_LABEL = {
  tiny: '極小', small: '小型', medium: '中型', large: '大型', huge: '超大型',
};
import { ARENAS, ARENA_ORDER } from '../game/Arenas.js';
import { SHAPES, SHAPE_GROUPS, SHAPE_DEFAULT } from '../core/Shapes.js';
import { STANDARD_COLORS, hexToCss } from '../core/Palette.js';
import { TOOL } from '../editor/EditorScene.js';
import { ColorWheel } from './ColorWheel.js';
import { h, slider, vectorField, collapsible, toolSection, resizable, append } from './dom.js';
import { KeyConfig } from './KeyConfig.js';
import { ShareDialog } from './ShareDialog.js';
import { Help } from './Help.js';
import { partSketch } from './PartSketch.js';
import { TitleScreen, ResultScreen } from './Title.js';
import { SortieScreen } from './Sortie.js';
import { VersusScreen } from './Versus.js';
import { Replays } from './Replays.js';
import { t } from './i18n.js';

export { h, slider, vectorField };

// ============================================================
//  Editor DOM. Built in code so the whole editor stays one unit.
// ============================================================


/**
 * The order you actually work in: pick things up, then build the body, then
 * hang limbs off it head-downward, then drop in a saved part. The bones read
 * face -> arm -> leg -> custom because that is the order they sit on a robot.
 */
export const ASSEMBLE_TOOLS = [
  { group: '選ぶ' },
  { tool: TOOL.SELECT, label: '選択 / 移動', key: 'V', color: '#ffd166' },
  { group: '組む' },
  { tool: TOOL.BLOCK, label: 'ブロック', key: 'B', color: '#c9d2dc' },
  { tool: TOOL.EQUIP, label: '装備プレート', key: 'G', color: '#8fd9ff' },
  { group: 'ボーン' },
  { tool: TOOL.BONE_FACE, label: t(BONE_META.face.label), key: 'F', color: '#ff7ba6' },
  { tool: TOOL.BONE_ARM, label: t(BONE_META.arm.label), key: 'A', color: '#ffc861' },
  { tool: TOOL.BONE_LEG, label: t(BONE_META.leg.label), key: 'L', color: '#6fe3ff' },
  { tool: TOOL.BONE_WEAPON, label: t(BONE_META.weapon.label), key: 'W', color: '#8effc9' },
  { tool: TOOL.BONE_CUSTOM, label: t(BONE_META.custom.label), key: 'C', color: '#b98cff' },
  { group: '呼び出す' },
  { tool: TOOL.STAMP, label: 'パーツ配置', key: '—', color: '#8effc9' },
];

export const SCULPT_LIST = [
  { tool: TOOL.CARVE, label: '削る', key: 'X', color: '#ff6a5c' },
  { tool: TOOL.ADD, label: '盛る', key: 'Z', color: '#8effc9' },
  { tool: TOOL.PAINT, label: '塗る', key: 'P', color: '#4fd2ff' },
];

/** Standard bullet colours: bright, saturated, and legible against the field. */
const BULLET_COLORS = [
  0x7fd4ff, 0x4fd2ff, 0x8effc9, 0xffd166, 0xff9f5c,
  0xff5c7a, 0xb98cff, 0xffffff, 0x6bff6b, 0xff2fb0,
];

/** How a part reads in a list: its attribute if it has one, else its label. */
function partName(p) {
  if (p.kind === 'bone') return t(BONE_META[p.boneType].label);
  if (p.kind === 'equip') return EQUIP_META[p.equipType]?.label ?? t(p.label);
  return t(p.label);
}

/**
 * Below this window width the editor's panels fold to the edge.
 *
 * At 900 they were taking 48% of the screen between them, leaving the
 * machine less room than the controls for shaping it.
 */
const PANEL_FOLD_BELOW = 1024;

/** Shown once, ever: see offerFirstRun. */
const FIRST_RUN_KEY = 'blostom.seen.v1';

export class EditorUI {
  /** @param {HTMLElement} root  @param {object} app */
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this._wasNarrow = null;
    this._build();
    this.syncPanelWidth();
    // Named, so `dispose` can actually take it off again: an anonymous
    // handler here survives every rebuild of the interface and goes on
    // calling a panel that is no longer on screen.
    this._onWinResize = () => this.syncPanelWidth();
    window.addEventListener('resize', this._onWinResize);
  }

  /** Keep the free-placement height read-out in step with the scene. */
  showWorkPlane(y) {
    if (this.planeReadout) this.planeReadout.textContent = Number(y).toFixed(2);
    return this;
  }

  _toggleMenu(menu) {
    const wasOpen = !menu.classList.contains('hidden');
    this._closeMenus();
    if (!wasOpen) menu.classList.remove('hidden');
    return this;
  }

  _closeMenus() {
    for (const m of [this.fileMenu, this.historyMenu]) m?.classList.add('hidden');
    return this;
  }

  /**
   * Say where the weight sits, in words.
   *
   * Mass was reported and its PLACE was not, so "why does this keep tipping"
   * had no answer anywhere on screen.
   */
  showBalance() {
    const s = this.app.editor.stats;
    const b = s?.balance;
    const el = this.balanceNote;
    if (!el) return this;
    if (!b) { el.textContent = t('重心を出せません'); el.classList.remove('hidden'); return this; }
    const side = Math.abs(b[0]) < 0.05 ? t('中央') : (b[0] > 0 ? t('右に {0}m', [b[0].toFixed(2)]) : t('左に {0}m', [(-b[0]).toFixed(2)]));
    const fore = Math.abs(b[2]) < 0.05 ? '' : (b[2] > 0 ? t(' / 前に {0}m', [b[2].toFixed(2)]) : t(' / 後ろに {0}m', [(-b[2]).toFixed(2)]));
    el.textContent = t('重心: 高さ {0}m ・ {1}{2}', [b[1].toFixed(2), side, fore]);
    el.classList.remove('hidden');
    return this;
  }

  /** Redraw the kept mixes. */
  renderRecipes(list) {
    const box = this.recipeRow;
    if (!box) return this;
    const app = this.app;
    box.replaceChildren(
      h('button', { title: t('いまの形・寸法・色を覚えます'), onClick: () => app.editor.keepRecipe() }, '＋'),
      ...(list ?? []).map((r, i) => h('button', {
        class: 'recipe',
        title: `${SHAPES[r.shape]?.label ?? ''} ${r.size.map((n) => n.toFixed(2)).join('x')}`,
        style: `border-color:${hexToCss(app.assembly.palette.get(r.color))}`,
        onClick: () => app.editor.useRecipe(i),
      }, SHAPES[r.shape]?.label?.slice(0, 2) ?? '？')),
    );
    return this;
  }

  /**
   * Ask before something takes work away.
   *
   * Undo can put it back, but a carve is the slowest thing anybody does
   * here and losing one silently is not a thing to find out about later.
   */
  confirmAction({ message, accept, cancel }) {
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(message)
      : true;
    if (ok) accept?.(); else cancel?.();
    return ok;
  }

  /** Draw the selection rectangle, or take it away. */
  showMarquee(rect) {
    const el = this.marquee;
    if (!el) return this;
    if (!rect || rect.w < 2 || rect.h < 2) { el.classList.add('hidden'); return this; }
    el.classList.remove('hidden');
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
    return this;
  }

  /** Say how much of the machine is currently out of sight or pinned down. */
  syncVisibility(hidden, locked) {
    const el = this.hiddenNote;
    if (!el) return this;
    const bits = [];
    if (hidden) bits.push(t('{0}個を隠しています', [hidden]));
    if (locked) bits.push(t('{0}個を固定しています', [locked]));
    el.textContent = bits.join(' / ');
    el.classList.toggle('hidden', !bits.length);
    return this;
  }

  /** Say whether there is anything unsaved, next to the machine's name. */
  /**
   * Take the interface down.
   *
   * Only needed because the language can change, and the language cannot be
   * changed by re-rendering: half of what is on screen — the tool buttons,
   * the title's menu rows — is built in a constructor. So the whole thing
   * is made again, and this is the half of that which the DOM cannot do by
   * itself: the listeners that live on `window` and `document`.
   */
  dispose() {
    window.removeEventListener('resize', this._onWinResize);
    document.removeEventListener('pointerdown', this._onDocDown);
    this.keyConfig?.dispose?.();
    this.title?.dispose?.();
    this.sortie?.dispose?.();
    this.help?.dispose?.();
    this.share?.dispose?.();
    this.versus?.dispose?.();
    this.replays?.dispose?.();
    return this;
  }

  /** Repaint everything that is generated from a table. */
  syncAll() {
    this.renderPalette?.();
    this.renderLibrary?.();
    this.syncHistory?.();
    this.renderInspector?.(this.app?.editor?.selectedParts?.() ?? null);
    this.renderStats?.(this.app?.editor?.stats);
    return this;
  }

  syncDirty(dirty) {
    this.dirtyDot?.classList.toggle('hidden', !dirty);
    return this;
  }

  /**
   * The undo stack, newest first, with how far back each one is. Clicking a
   * row walks back to it — the same thing as pressing Ctrl+Z that many
   * times, except you can see where you are going.
   */
  renderHistory() {
    const box = this.historyList;
    if (!box) return this;
    const past = this.app.history.past;
    if (!past.length) {
      box.replaceChildren(h('div', { class: 'inspector-empty' }, t('まだ何もしていません。')));
      return this;
    }
    box.replaceChildren(...past.slice(-24).reverse().map((entry, i) => h('button', {
      class: 'historyrow',
      onClick: () => { for (let k = 0; k <= i; k++) this.app.undo(); this.renderHistory(); },
    }, h('span', { class: 'k' }, i === 0 ? t('直前') : t('{0}手前', [i + 1])), t(entry.label))));
    return this;
  }

  /** Redraw the list of named saves. */
  renderSlots() {
    const box = this.slotList;
    if (!box) return this;
    const list = this.app.slots();
    if (!list.length) {
      box.replaceChildren(h('div', { class: 'inspector-empty' },
        t('まだありません。「名前を付けて保存」で残せます。')));
      return this;
    }
    box.replaceChildren(...list.map((entry) => h('div', { class: 'slotrow' },
      h('button', {
        class: 'slotopen', title: new Date(entry.at).toLocaleString(),
        onClick: () => { this.app.openSlot(entry.id); this._closeMenus(); },
      }, entry.name || 'NO NAME'),
      h('button', {
        class: 'danger', title: t('この保存を削除'),
        onClick: (e) => { e.stopPropagation(); this.app.deleteSlot(entry.id); },
      }, '×'),
    )));
    return this;
  }

  /** True while the offer to restore is on screen. */
  get draftOpen() {
    return !!this.draftBar && !this.draftBar.classList.contains('hidden');
  }

  /**
   * Offer the safety net back, once, when the workbench first opens.
   *
   * Only an offer: restoring over the top of what somebody meant to open
   * would be the same mistake in the other direction.
   *
   * It used to be a strip across the top of the workbench, put up at launch
   * and taken down again on a timer. Both of those were wrong. A bar at the
   * top of the screen is the shape of a notice, so it got read as one and
   * ignored — and being put up at launch meant it was raised behind the
   * title screen, so by the time anybody reached the workbench the timer
   * had run it out. The one question worth asking about the last session
   * was being asked to nobody.
   *
   * So it is a small window now, in the middle, and it waits: it is asked
   * on the way into the workbench, which is the first moment the answer
   * means anything, and it stays until it is answered. That is affordable
   * because while it is up the autosave holds off — the draft cannot be
   * quietly replaced by the machine on the bench behind it, so the offer is
   * still true whenever it is finally read.
   */
  offerDraft() {
    const d = this.app.draft();
    if (!d || !this.draftBar) return this;
    this.draftWhen.textContent = new Date(d.at).toLocaleString();
    this.draftBar.classList.remove('hidden');
    this.app.holdDraft?.(true);
    return this;
  }

  /**
   * Take the offer down without answering it.
   *
   * Not the same as declining: the draft stays on disk, and the file menu
   * still has "前回の作業を復元" in it. Only the window goes.
   */
  /**
   * Show the welcome, once ever.
   *
   * Not shown at all when there is a draft to restore: two dialogs at once
   * on the first screen is worse than either, and somebody with a draft has
   * been here before by definition.
   */
  offerFirstRun() {
    if (!this.firstRun) return this;
    try {
      if (localStorage.getItem(FIRST_RUN_KEY)) return this;
    } catch {
      return this;               // no store, no way to stop showing it again
    }
    if (this.draftOpen) return this;
    this.firstRun.classList.remove('hidden');
    return this;
  }

  foldFirstRun() {
    this.firstRun?.classList.add('hidden');
    try { localStorage.setItem(FIRST_RUN_KEY, '1'); } catch { /* private mode */ }
    return this;
  }

  foldDraft() {
    if (!this.draftOpen) return this;
    this.draftBar.classList.add('hidden');
    // The net is let go here, not before: from now on this session's own
    // work is what gets kept.
    this.app.holdDraft?.(false);
    return this;
  }

  /** Set the size the next block will be placed at, sliders and all. */
  _setNewSize(size) {
    this.app.editor.newBlockSize = [...size];
    this.newSizeSliders.forEach((s, i) => s.set(size[i]));
    return size;
  }

  /**
   * What the cursor is about to put down, beside the cursor.
   *
   * The shape is picked on the left, the colour on the right and the spot in
   * the middle, so placing one block meant reading three corners of the
   * screen. This is the answer where the question is being asked.
   */
  showPlacementHint(hint) {
    const el = this.placeHint;
    if (!el) return;
    if (!hint) { el.classList.add('hidden'); return; }
    el.replaceChildren();
    if (typeof hint.tint === 'number') {
      el.append(h('span', {
        class: 'tintchip',
        style: `background:${hexToCss(hint.tint)}`,
      }));
    }
    el.append(hint.text);
    el.classList.toggle('blocked', !!hint.blocked);
    el.classList.remove('hidden');
    el.style.left = `${hint.x + 16}px`;
    el.style.top = `${hint.y + 18}px`;
  }

  // ---------------------------------------------------------- build

  _build() {
    const app = this.app;

    // ---------------------------------------------------- top bar
    this.nameInput = h('input', {
      type: 'text', value: app.assembly.name,
      onInput: (e) => { app.assembly.name = e.target.value.toUpperCase(); },
    });

    // A dot beside the name, lit while there is unsaved work. There was no
    // sign at all: the only way to know whether the last hour was safe was
    // to remember whether you had pressed the button.
    this.dirtyDot = h('span', { class: 'dirtydot hidden', title: t('保存していない変更があります') });

    this.slotList = h('div', { class: 'slotlist' });

    /**
     * Narrow the parts list to one kind of thing.
     *
     * The list was the tree and only the tree, so "every plate on this
     * machine" meant reading forty rows looking for the plate icon.
     */
    this.treeFilter = h('select', {
      onChange: (e) => { this.treeKind = e.target.value; this.renderTree(); },
    },
      h('option', { value: '' }, t('すべて')),
      h('option', { value: 'block' }, t('ブロックだけ')),
      h('option', { value: 'bone' }, t('ボーンだけ')),
      h('option', { value: 'equip' }, t('装備プレートだけ')),
      h('option', { value: 'color' }, t('選択中と同じ色だけ')),
      h('option', { value: 'picked' }, t('選択中のものだけ')),
    );
    this.treeKind = '';

    /**
     * Find a row by what it is called or what it is cut from.
     *
     * On a machine of forty parts the list is a wall, and the thing you want
     * is usually one you named — but naming it bought you nothing, because
     * there was no way to ask for it back.
     */
    this.treeSearch = h('input', {
      type: 'search', placeholder: t('名前・形で探す'), 'aria-label': t('パーツを探す'),
      onInput: (e) => { this.treeQuery = e.target.value.trim().toLowerCase(); this.renderTree(); },
    });
    this.treeQuery = '';

    /** Whether typing one size changes the other two to match. */
    this.keepAspect = h('input', { type: 'checkbox' });

    /** Named selections: the row of them, and the verb that makes one. */
    this.setRow = h('div', { class: 'row tight wrap' });

    /** The last few colours used, most recent first. */
    this.recentColors = [];
    this.recentEl = h('div', { class: 'swatches hidden' });

    /** Says how much is out of sight, because hidden work is easy to forget. */
    this.hiddenNote = h('div', { class: 'note hidden' });

    /** Where the weight sits, when somebody asks. */
    this.balanceNote = h('div', { class: 'note hidden' });

    /** Mixes worth keeping: shape, size and colour together. */
    this.recipeRow = h('div', { class: 'row tight recipes' });

    /** The rectangle drawn while Shift-dragging a selection. */
    this.marquee = h('div', { class: 'marquee hidden' });

    this.draftWhen = h('span', { class: 'k' }, '');
    /*
     * The first time anybody opens the workbench.
     *
     * The help screen is good and generated from the real tables — and it
     * is behind F1, which somebody who has never played has no reason to
     * press. So the hardest question in this game (「何を作ればいいのか」,
     * not 「どのボタンか」) was answered nowhere anyone would look.
     *
     * Four lines, once, dismissed for ever. Not a tutorial: a tutorial that
     * takes the mouse away from somebody who wants to build a robot is
     * worse than nothing.
     */
    this.firstRun = h('div', {
      id: 'firstrun',
      class: 'hidden',
      onClick: (e) => { if (e.target === this.firstRun) this.foldFirstRun(); },
    },
      h('div', { class: 'draftbox' },
        h('div', { class: 'drafthead' }, t('ようこそ')),
        h('div', { class: 'firstlist' },
          h('p', {}, t('① 上の「プリセット」から機体を選ぶ。まずはそれで十分です')),
          h('p', {}, t('② 左のツールでブロックを足し、ボーンで関節を作る')),
          h('p', {}, t('③ 「装備プレート」で武器とブーストを貼る')),
          h('p', {}, t('④ 右上の「テスト」で動かしてみる')),
        ),
        h('div', { class: 'row draftrow' },
          h('button', {
            class: 'primary',
            onClick: () => this.foldFirstRun(),
          }, t('はじめる')),
          h('button', {
            onClick: () => { this.foldFirstRun(); this.help.show('start'); },
          }, t('もっと詳しく')),
        ),
      ),
    );

    this.draftBar = h('div', {
      id: 'draftbar',
      class: 'hidden',
      // Clicking off it is the same as 「あとで」: the draft keeps, and the
      // file menu still has it. Only a click on the dimmed part counts, or
      // every button inside would close the window under its own answer.
      onClick: (e) => { if (e.target === this.draftBar) this.foldDraft(); },
    },
      h('div', { class: 'draftbox' },
        h('div', { class: 'drafthead' }, t('前回の作業が残っています')),
        this.draftWhen,
        h('div', { class: 'row draftrow' },
          h('button', {
            class: 'primary',
            onClick: () => { this.app.restoreDraft(); this.foldDraft(); },
          }, t('復元する')),
          h('button', { onClick: () => this.foldDraft() }, t('あとで')),
          h('button', {
            class: 'danger',
            onClick: () => { this.app.forgetDraft(); this.foldDraft(); },
          }, t('破棄')),
        ),
      ),
    );

    /**
     * The undo stack, as a list.
     *
     * Sixty snapshots were kept and none could be seen: going back twenty
     * steps meant pressing Ctrl+Z twenty times and watching for the moment
     * it looked right.
     */
    this.historyList = h('div', { class: 'historylist' });
    this.historyMenu = h('div', { class: 'menupop hidden' }, this.historyList);
    this.historyBtn = h('button', {
      class: 'icon', title: t('編集の履歴'),
      onClick: (e) => { e.stopPropagation(); this._toggleMenu(this.historyMenu); this.renderHistory(); },
    }, '⋮');

    this.presetSelect = h('select', {
      onChange: (e) => { if (e.target.value) { app.loadPreset(e.target.value); e.target.value = ''; } },
    },
      h('option', { value: '' }, t('プリセット…')),
      // Grouped by size, because twenty names in a flat list is a list you
      // scroll rather than read — and size is the first thing anybody wants
      // to choose by.
      ...SIZE_CLASSES.map((size) => h('optgroup', { label: SIZE_LABEL[size] },
        ...PRESET_LIST.filter((p) => p.size === size)
          .map((p) => h('option', { value: p.id }, t(p.label))))),
      h('optgroup', { label: t('まっさら') }, h('option', { value: 'core' }, t('コアのみ'))),
    );

    /*
     * The way back to the front page.
     *
     * It was a house glyph and nothing else, which is a symbol you have to
     * already know. Everything either side of it in that bar is a word, so
     * this is one too — a picture among words reads as decoration.
     */
    this.titleBtn = h('button', {
      class: 'ghost', title: t('タイトル画面に戻ります'), onClick: () => app.goTitle(),
    }, t('⌂ タイトル'));
    this.editBtn = h('button', { class: 'active', onClick: () => app.setMode('edit') }, 'EDIT');
    this.partBtn = h('button', { onClick: () => app.openPartEditor() }, t('パーツ編集'));
    this.testBtn = h('button', { class: 'primary', onClick: () => app.setMode('field') }, '▶ TEST FIELD');

    this.undoBtn = h('button', { class: 'icon', title: t('元に戻す (Ctrl+Z)'), onClick: () => app.undo() }, '↶');
    this.redoBtn = h('button', { class: 'icon', title: t('やり直し (Ctrl+Y)'), onClick: () => app.redo() }, '↷');

    this.fileMenu = h('div', { class: 'menupop hidden' },
      h('button', { onClick: () => { app.save(); this._closeMenus(); } }, t('保存（上書き）')),
      h('button', {
        onClick: () => {
          const name = window.prompt(t('名前を付けて保存'), app.assembly.name);
          if (name !== null) app.saveAs(name);
          this._closeMenus();
        },
      }, t('名前を付けて保存…')),
      h('button', { onClick: () => { app.load(); this._closeMenus(); } }, t('上書き保存から読込')),
      h('button', {
        onClick: () => { app.restoreDraft(); this.foldDraft(); this._closeMenus(); },
      }, t('前回の作業を復元')),
      h('div', { class: 'k', style: 'padding:6px 8px 2px' }, t('保存したもの')),
      this.slotList,
      h('button', { onClick: () => { app.exportJson(); this._closeMenus(); } }, t('ファイルに書き出す')),
      h('button', { onClick: () => { app.importJson(); this._closeMenus(); } }, t('ファイルから読み込む')),
      h('button', { onClick: () => { this.share.show(); this._closeMenus(); } }, t('QRで共有 / 読み込み')),
    );
    this.fileBtn = h('button', {
      onClick: (e) => { e.stopPropagation(); this._toggleMenu(this.fileMenu); this.renderSlots(); },
    }, t('ファイル ▾'));

    this.topbar = h('div', { id: 'topbar' },
      h('div', { class: 'brand' }, 'BLOSTOM', h('small', {}, 'BLOCK ROBO ARENA')),
      h('div', { class: 'sep' }),
      this.nameInput,
      this.dirtyDot,
      this.presetSelect,
      h('div', { class: 'sep' }),
      this.undoBtn,
      this.redoBtn,
      this.historyBtn,
      h('div', { class: 'sep' }),
      // Sixteen controls in one undifferentiated row is sixteen things to
      // read every time you want one of them. Everything to do with keeping
      // the machine now lives behind one word.
      h('div', { class: 'menuwrap' }, this.fileBtn, this.fileMenu),
      h('button', {
        class: 'icon', title: t('使い方 (F1)'), onClick: () => this.help.toggle(),
      }, '？'),
      h('button', { class: 'icon', title: t('設定'), onClick: () => app.openOptions() }, '⚙'),
      h('button', { class: 'icon', title: t('キー設定'), onClick: () => this.keyConfig.show() }, '⌨'),
      h('div', { class: 'spacer' }),
      this.titleBtn,
      this.editBtn,
      this.partBtn,
      this.testBtn,
    );

    // ---------------------------------------------------- part workbench bar
    this.partNameInput = h('input', {
      type: 'text', value: app.partAssembly.name,
      onInput: (e) => { app.partAssembly.name = e.target.value.toUpperCase(); },
    });

    this.partUndoBtn = h('button', { class: 'icon', title: t('元に戻す (Ctrl+Z)'), onClick: () => app.undo() }, '↶');
    this.partRedoBtn = h('button', { class: 'icon', title: t('やり直し (Ctrl+Y)'), onClick: () => app.redo() }, '↷');

    this.partBar = h('div', { id: 'partbar', class: 'hidden' },
      h('div', { class: 'brand' }, 'PART', h('small', {}, 'WORKBENCH')),
      h('div', { class: 'sep' }),
      this.partNameInput,
      h('div', { class: 'sep' }),
      this.partUndoBtn,
      this.partRedoBtn,
      h('div', { class: 'sep' }),
      h('button', { class: 'primary', onClick: () => app.savePart(this.partNameInput.value) }, t('パーツ庫に保存')),
      h('button', { title: t('QRで共有 / 読み込み'), onClick: () => this.share.show() }, t('⧉ 共有')),
      h('button', { onClick: () => app.newPart() }, t('新規')),
      h('div', { class: 'spacer' }),
      h('span', { class: 'note', style: 'margin:0' }, t('「パーツ庫」から呼び出せます')),
      h('button', { onClick: () => app.setMode('edit') }, t('← メイン編集')),
    );

    // ---------------------------------------------------- left panel
    this.toolButtons = new Map();

    const mkTool = (spec) => {
      if (t(spec.group)) return h('div', { class: 'toolgroup' }, t(spec.group));
      const btn = h('button', { class: 'toolbtn', onClick: () => app.setTool(spec.tool) },
        h('span', { class: 'dot', style: `background:${spec.color};color:${spec.color}` }),
        h('span', {}, t(spec.label)),
        h('span', { class: 'key' }, spec.key),
      );
      this.toolButtons.set(spec.tool, btn);
      return btn;
    };

    // --- gizmo
    this.gizmoButtons = [
      h('button', { class: 'active', onClick: () => app.setGizmoMode('translate') }, t('移動 (T)')),
      h('button', { onClick: () => app.setGizmoMode('rotate') }, t('回転 (R)')),
    ];
    this.snapToggle = h('input', {
      type: 'checkbox', checked: 'checked',
      onChange: (e) => app.editor.setSnap(e.target.checked),
    });
    /**
     * How coarse the grid is.
     *
     * One fixed quarter of a metre is too coarse for a small detail and too
     * fine for a big frame, and the same person wants both within a minute.
     */
    this.snapStep = h('select', {
      onChange: (e) => { app.editor.snapStep = Number(e.target.value); },
    }, ...[0.05, 0.125, 0.25, 0.5].map((n) => h('option', {
      value: n, ...(n === SIZE_STEP ? { selected: 'selected' } : {}),
    }, `${n} m`)));

    /**
     * How far one notch of the rotation gizmo turns.
     *
     * Fifteen degrees was fixed while the placement grid became adjustable:
     * a quarter turn was six drags, and five degrees was not available at
     * all — so anything deliberately off-square had to be typed in.
     */
    this.turnStep = h('select', {
      onChange: (e) => { app.editor.setTurnStep(Number(e.target.value)); },
    }, ...[5, 15, 30, 45, 90].map((n) => h('option', {
      value: n, ...(n === 15 ? { selected: 'selected' } : {}),
    }, `${n}°`)));

    /**
     * Which way the machine is cut open, and how far along.
     *
     * Everything past the first layer of armour was invisible, so a block
     * buried in the chest could not be inspected or even known about.
     */
    this.sectionAxis = h('select', {
      onChange: () => this._applySection(),
    },
      h('option', { value: '' }, t('切らない')),
      h('option', { value: 'x' }, t('左右で切る')),
      h('option', { value: 'y' }, t('上下で切る')),
      h('option', { value: 'z' }, t('前後で切る')),
    );
    this.sectionAt = h('input', {
      type: 'range', min: -3, max: 3, step: 0.05, value: 0,
      onInput: () => this._applySection(),
    });
    this.seeThrough = h('input', {
      type: 'checkbox',
      onChange: (e) => app.editor.setSeeThrough(e.target.checked),
    });

    /** World axes or the part's own. */
    this.spaceButtons = [
      h('button', {
        class: 'active', title: t('上下・前後・左右のまま動かします'),
        onClick: () => this.setGizmoSpace('world'),
      }, t('地面の向き')),
      h('button', {
        title: t('そのパーツが向いている方向に沿って動かします'),
        onClick: () => this.setGizmoSpace('local'),
      }, t('パーツの向き')),
    ];

    // ============================================================
    //  What you can do to whatever is selected.
    //
    //  This was one unbroken column of about sixty controls under a heading
    //  that said "ギズモ" — snapping, hiding, aligning, limb-building, camera
    //  angles and the clipboard, in the order they happened to be written.
    //  Nothing said what any group was for, so finding a verb meant reading
    //  all of them, and it sat behind the select tool even though most of it
    //  applies whatever tool is in hand.
    //
    //  Now it is five groups named after what you are trying to DO, with the
    //  two reached for constantly open and the rest folded. The contents are
    //  unchanged: this is about being able to find them.
    // ============================================================
    const row = (...kids) => h('div', { class: 'row tight' }, ...kids);
    const btn = (label, title, onClick) => h('button', { title, onClick }, label);

    // ---- 動かす : the gizmo, and the rules it snaps to
    this.moveGroup = collapsible(t('動かす'), h('div', { class: 'body' },
      row(...this.gizmoButtons),
      row(...this.spaceButtons),
      h('label', { class: 'checkline' }, this.snapToggle, t('グリッドと角度にスナップ')),
      h('label', { class: 'field' }, h('span', {}, t('グリッド')), this.snapStep),
      h('label', { class: 'field' }, h('span', {}, t('角度')), this.turnStep),
      slider(t('面からの隙間'), {
        min: 0, max: 0.3, step: 0.01, value: 0, unit: ' m', fixed: 2,
      }, (v) => { app.editor.placeGap = v; }),
      row(
        btn(t('中心へ'), t('えらんだパーツを機体の中心線に戻します'),
          () => app.editor.centreSelected()),
        btn(t('傾きを戻す'), t('親から受け継いだ傾きを打ち消して、まっすぐにします'),
          () => app.editor.straightenSelected()),
        btn(t('その場で反転'), t('コピーせず、その場で向きを反転します（⇧F）'),
          () => app.editor.flipSelected('x')),
      ),
      row(
        btn(t('あいだに置く'), t('最初に選んだ2つの中間に、残りを置きます'),
          () => app.editor.centreBetween()),
        btn(t('面いっぱい'), t('ついている面いっぱいの大きさにします'),
          () => app.editor.fitToHost()),
      ),
    ));

    // ---- 選ぶ : getting hold of the right parts in the first place
    this.pickGroup = collapsible(t('選ぶ'), h('div', { class: 'body' },
      row(
        btn(t('全選択'), null, () => app.editor.selectAll()),
        btn(t('配下ごと'), t('選んだパーツの下にあるもの全部を足します（削除で消えるのと同じ範囲）'),
          () => app.editor.selectSubtree()),
        btn(t('同じ種類'), t('同じ形のブロック・同じ種類のプレートを全部足します'),
          () => app.editor.selectSimilar()),
      ),
      row(
        btn(t('同じ色'), t('同じ色のブロックを全部選びます'), () => app.editor.selectByColor()),
        btn(t('反対側'), t('反対側の相棒に飛びます'), () => app.editor.selectTwin()),
        btn(t('選択を戻す'), t('ひとつ前の選択に戻ります'), () => app.editor.selectBack()),
      ),
      row(
        btn(t('最後に置いたもの'), t('最後に置いたパーツに戻ります'),
          () => app.editor.selectLastPlaced()),
        btn(t('名前を付ける'), t('えらんだパーツに名前を付けます'), () => this.askName()),
      ),
      h('h3', { class: 'inline' }, t('まとまりとして残す')),
      this.setRow,
      row(btn(t('今の選択を残す'), t('選び出すのに手間のかかる組を、名前を付けて残します'),
        () => this.keepSelectionSet())),
    ));

    // ---- ふやす : anything that ends with more parts than it started with
    this.growGroup = collapsible(t('ふやす'), h('div', { class: 'body' },
      row(
        btn(t('コピー'), null, () => app.copySelected()),
        btn(t('切取'), null, () => app.copySelected({ cut: true })),
        btn(t('貼付'), t('Shift+V でカーソルの面に貼れます'), () => app.pasteClipboard()),
        btn(t('複製'), null, () => app.editor.duplicateSelected()),
      ),
      row(
        btn(t('左右反転コピー'), t('選択したパーツを、機体の中心線の反対側にコピーします'),
          () => app.editor.mirrorSelected()),
        btn(t('もう一度'), t('直前の操作をもう一度（Ctrl+R）'), () => app.editor.repeatLast()),
      ),
      h('h3', { class: 'inline' }, t('肢をつくる')),
      row(
        btn(t('脚'), null, () => app.editor.addLimb('leg', { segments: 2 })),
        btn(t('腕'), null, () => app.editor.addLimb('arm', { segments: 2, foot: false })),
        btn(t('脚（3節）'), null, () => app.editor.addLimb('leg', { segments: 3 })),
      ),
      h('h3', { class: 'inline' }, t('円周にならべる')),
      row(...[4, 6, 8].map((n) => btn(n + t('個'), null, () => app.editor.repeatAround(n, 'y')))),
      h('h3', { class: 'inline' }, t('つなぐ')),
      row(
        btn(t('連結 (J)'), null, () => app.connectSelected()),
        btn(t('解除 (⇧J)'), null, () => app.disconnectSelected()),
        btn(t('つなぎ替え'), t('クリックしたパーツを新しい連結先にします'),
          () => app.editor.beginReparent()),
      ),
    ), { open: false });

    // ---- そろえる : two or more parts, made to agree with each other
    this.alignGroup = collapsible(t('そろえる'), h('div', { class: 'body' },
      ...['x', 'y', 'z'].map((axis) => row(
        h('span', { class: 'k', style: 'width:14px' }, axis.toUpperCase()),
        btn(t('揃える'), t('平均の位置へ。いちばん動かす距離が短くなります'),
          () => app.editor.arrangeSelected(axis, 'align')),
        btn(t('手前で'), t('いちばん手前のものに合わせます'),
          () => app.editor.arrangeSelected(axis, 'min')),
        btn(t('奥で'), t('いちばん奥のものに合わせます'),
          () => app.editor.arrangeSelected(axis, 'max')),
        btn(t('均等'), null, () => app.editor.arrangeSelected(axis, 'spread')),
        btn('×4', t('この向きに、自分の幅ぶんずつ繰り返します'),
          () => app.editor.repeatSelected(axis, 3)),
      )),
      h('h3', { class: 'inline' }, t('基準に合わせる')),
      h('div', { class: 'note' }, t('基準は最後に選んだパーツ（水色の枠）。')),
      row(
        btn(t('傾き'), t('最後に選んだパーツの傾きを、他の全部に写します'),
          () => app.editor.matchRotationSelected()),
        btn(t('見た目'), t('最後に選んだブロックの形と色を、他の全部に写します'),
          () => app.editor.matchLookSelected()),
        btn(t('骨の太さ'), t('ボーンの長さと太さを、最後に選んだものに揃えます'),
          () => app.editor.matchBoneSelected()),
      ),
    ), { open: false });

    // ---- 見る・確かめる : nothing in here changes the machine
    this.viewGroup = collapsible(t('見る・確かめる'), h('div', { class: 'body' },
      row(...[['front', t('正面')], ['left', t('側面')], ['top', t('上')], ['iso', t('斜め')]]
        .map(([id, label]) => btn(label, null, () => app.editor.setView(id)))),
      h('h3', { class: 'inline' }, t('中を見る')),
      h('label', { class: 'field' }, h('span', {}, t('断面')), this.sectionAxis),
      this.sectionAt,
      h('label', { class: 'checkline' }, this.seeThrough, t('機体を透かす')),
      h('h3', { class: 'inline' }, t('隠す・固定')),
      row(
        btn(t('隠す'), null, () => app.editor.hideSelected()),
        btn(t('選択だけ'), null, () => app.editor.isolateSelected()),
        btn(t('全部出す'), null, () => app.editor.showAll()),
      ),
      row(
        btn(t('固定する'), t('選んだパーツを、クリックでもギズモでも掴めなくします'),
          () => app.editor.lockSelected(true)),
        btn(t('固定を解除'), null, () => app.editor.unlockAll()),
      ),
      this.hiddenNote,
      h('h3', { class: 'inline' }, t('調べる')),
      row(
        btn(t('左右の食い違い'), t('左右で相方のいないパーツをえらびます'),
          () => app.editor.findAsymmetry()),
        btn(t('埋まったブロック'), t('他のブロックの中に完全に埋まっているものを探します'),
          () => app.editor.findBuried()),
        btn(t('重心'), t('重心の位置を出します'), () => this.showBalance()),
      ),
      this.balanceNote,
    ), { open: false });

    this.editGroups = [
      this.moveGroup, this.pickGroup, this.growGroup,
      this.alignGroup, this.viewGroup,
    ];

    // --- new block size
    /** Linked by default: most blocks anyone places are cubes. */
    this.sizeLinked = h('input', { type: 'checkbox', checked: 'checked' });
    this.newSizeSliders = ['X', 'Y', 'Z'].map((axis, i) => slider(t('幅 {0}', [axis]), {
      min: SIZE_MIN, max: SIZE_MAX, step: SIZE_STEP, value: 1, fixed: 2,
    }, (v) => {
      app.editor.newBlockSize[i] = v;
      // Three sliders to make a cube bigger was three chances to make it
      // very slightly not a cube.
      if (this.sizeLinked.checked) this._setNewSize([v, v, v]);
    }));

    this.planeReadout = h('span', { class: 'val', style: 'min-width:52px;text-align:center' }, '0.00');

    this.newShapeButtons = new Map();
    this.blockBox = h('div', {},
      h('h3', { class: 'inline' }, t('形')),
      ...this._shapeGrid(
        () => app.editor.newBlockShape,
        (id) => app.setNewBlockShape(id),
        this.newShapeButtons,
      ),
      h('div', { class: 'note' },
        h('b', {}, 'R'), t(' 向き　'), h('b', {}, t('Shift+ホイール')), t(' 高さ　'),
        h('b', {}, t('ドラッグ')), t(' 連続配置'),
        h('br'), h('b', {}, t('Alt+クリック')), t(' 写す　'), h('b', {}, t('右クリック')), t(' 削除')),
      h('h3', { class: 'inline' }, t('空中の高さ')),
      // Reachable by tapping.
      //
      // The height of the free-placement plane was on Shift+wheel, the
      // eyedropper on Alt+click and deleting on the right button — three
      // things a touch screen simply cannot do, which left a tablet unable
      // to place anything above the floor or take anything back off.
      h('div', { class: 'row tight' },
        h('button', { onClick: () => app.editor.liftWorkPlane(-1) }, '−'),
        this.planeReadout,
        h('button', { onClick: () => app.editor.liftWorkPlane(1) }, '＋'),
      ),
      h('h3', { class: 'inline' }, t('よく使う組み合わせ')),
      this.recipeRow,
      h('h3', { class: 'inline' }, t('寸法')),
      h('label', { class: 'checkline' }, this.sizeLinked, t('縦横高さを揃える')),
      h('div', { class: 'row tight' },
        ...[0.25, 0.5, 1, 2].map((n) => h('button', {
          onClick: () => this._setNewSize([n, n, n]),
        }, String(n))),
      ),
      ...this.newSizeSliders,
    );

    // --- equipment: pick a plate, then click the machine to stick it on
    this.equipButtons = new Map();
    const mkEquip = (type) => {
      const meta = EQUIP_META[type];
      const plate = h('button', {
        class: 'equipbtn',
        title: t(meta.blurb),
        onClick: () => app.setEquipType(type),
      },
      h('span', { class: `equipicon ${meta.category === 'weapon' ? 'round' : 'square'}`,
        style: `background:${hexToCss(meta.accent)}` }),
      h('span', {}, t(meta.label)));
      this.equipButtons.set(type, plate);
      return plate;
    };

    this.equipSize = slider(t('プレート径'), {
      min: EQUIP_SIZE_MIN, max: EQUIP_SIZE_MAX, step: EQUIP_SIZE_STEP,
      value: app.editor.newEquipSize, fixed: 2,
    }, (v) => app.setNewEquipSize(v));

    this.equipHint = h('div', { class: 'note' }, t(EQUIP_META[app.editor.equipType].blurb));

    this.equipBox = h('div', {},
      h('div', { class: 'equipgrid' }, ...WEAPON_TYPES.map(mkEquip)),
      h('div', { class: 'equipgrid' }, ...SYSTEM_TYPES.map(mkEquip)),
      this.equipSize,
      this.equipHint,
    );

    // --- new bone shape
    this.boneLen = slider(t('長さ'), {
      min: BONE_LENGTH_MIN, max: BONE_LENGTH_MAX, step: 0.25, value: app.editor.boneOpts.length, fixed: 2,
    }, (v) => { app.editor.boneOpts.length = v; app.applyBoneOptionToSelection('length', v); });

    this.boneRadius = slider(t('太さ'), {
      min: BONE_RADIUS_MIN, max: BONE_RADIUS_MAX, step: 0.01, value: app.editor.boneOpts.radius, fixed: 2,
    }, (v) => { app.editor.boneOpts.radius = v; app.applyBoneOptionToSelection('radius', v); });

    this.gaugeRow = h('div', { class: 'row tight' },
      ...Object.entries(BONE_GAUGE).map(([k, g]) => h('button', {
        onClick: () => {
          app.editor.boneOpts.radius = g.radius;
          this.boneRadius.set(g.radius);
          app.applyBoneOptionToSelection('radius', g.radius);
        },
      }, t(g.label))),
    );

    this.boneLimit = slider(t('可動域'), {
      min: 10, max: 170, step: 5, value: app.editor.boneOpts.limit, unit: '°',
    }, (v) => { app.editor.boneOpts.limit = v; app.applyBoneOptionToSelection('limit', v); });

    this.boneBox = h('div', {}, this.boneLen, this.gaugeRow, this.boneRadius, this.boneLimit);

    // --- sculpt
    this.brushSlider = slider(t('ブラシ'), {
      min: 1, max: 25, step: 1, value: app.editor.brushPercent, unit: '%',
    }, (v) => { app.editor.setBrush(v); });

    this.resSelect = h('select', {
      onChange: (e) => app.setVoxResolution(Number(e.target.value)),
    }, ...VOX_LEVELS.map((n) => h('option', { value: n }, `1/${n}`)));

    /**
     * The ordinary brush cuts cubes, so every carved edge has corners in it.
     * This one cuts spheres: drilled holes, and recesses that curve.
     */
    this.brushShape = h('input', {
      type: 'checkbox',
      onChange: (e) => { app.editor.brushRound = e.target.checked; },
    });

    /** The same cut on both sides at once. */
    this.sculptMirror = h('input', {
      type: 'checkbox', checked: 'checked',
      onChange: (e) => this.syncSymmetry(e.target.checked),
    });

    /*
     * How big the brush actually is, in the world.
     *
     * The slider is a percentage of a fixed metre, which is a number about
     * the tool rather than about the machine. What a builder needs to know
     * is whether this cut will be wider than the strut they are cutting it
     * into, and that is a length.
     */
    this.brushSize = h('span', { class: 'brushsize' }, '');
    /** How much of the block being carved is still there. */
    this.blockLeft = h('span', { class: 'brushsize' }, '');

    this.sculptAxis = h('select', {
      onChange: (e) => { app.editor.sculptAxis = Number(e.target.value); },
    },
    h('option', { value: '0' }, t('左右')),
    h('option', { value: '1' }, t('上下')),
    h('option', { value: '2' }, t('前後')));

    /** The cuts a brush cannot make, each one press and one undo step. */
    const once = (label, what, title) => h('button', {
      title, onClick: () => app.editor.sculptOnce(what),
    }, label);

    this.sculptBox = h('div', {},
      this.brushSlider,
      h('div', { class: 'row tight' }, this.brushSize, this.blockLeft),
      h('label', { class: 'checkline' }, this.brushShape, t('丸いブラシ')),
      h('label', { class: 'checkline' }, this.sculptMirror, t('対称に加工する')),
      h('label', { class: 'field' }, h('span', {}, t('対称の向き')), this.sculptAxis),
      h('div', { class: 'row tight' },
        once(t('ならす'), 'smooth', t('カーソルの周りの段差をなだらかにします（K）')),
        once(t('平らに'), 'flatten', t('見ている面から手前を平らに削ります（⇧J）')),
      ),
      h('div', { class: 'row tight' },
        once(t('穴をあける'), 'drill', t('ブロックを貫通する穴をあけます（O）')),
        once(t('塗りつぶし'), 'fill', t('つながっている同じ色をまとめて塗ります')),
      ),
      h('div', { class: 'row tight' },
        h('button', {
          title: t('カーソルの下の色を取ります（I）'),
          onClick: () => {
            const i = app.editor.pickColorUnderCursor();
            if (i >= 0) app.setColor(i);
          },
        }, t('スポイト')),
        h('button', {
          class: 'danger',
          title: t('このブロックの加工をすべて取り消し、元の形に戻します'),
          onClick: () => app.editor.resetBlock(),
        }, t('形に戻す')),
      ),
      h('label', { class: 'field' }, h('span', {}, t('加工の細かさ'))),
      this.resSelect,
      h('div', { class: 'note' }, t('細かいほど重くなります。')),
    );

    this.symmetryToggle = h('input', {
      type: 'checkbox', checked: 'checked',
      onChange: (e) => this.syncSymmetry(e.target.checked),
    });
    this.previewToggle = h('input', {
      type: 'checkbox', onChange: (e) => app.editor.setPreviewMotion(e.target.checked),
    });
    this.ringGuideToggle = h('input', {
      type: 'checkbox', checked: 'checked',
      onChange: (e) => app.editor.setRingGuides(e.target.checked),
    });

    // Each tool brings its own settings and takes them away again: with a
    // dozen sliders stacked up, the panel is longer than the screen and the
    // three that matter right now are lost in it.
    this.blockSection = toolSection(t('新規ブロック寸法'), this.blockBox);
    this.equipSection = toolSection(t('装備プレート'), this.equipBox);
    this.boneSection = toolSection(t('新規ボーン寸法'), this.boneBox);
    this.sculptSection = toolSection(t('加工設定'), this.sculptBox);
    this.stampSection = toolSection(t('パーツ配置'),
      h('div', { class: 'note' }, t('「パーツ庫」の ＜配置＞ で選びます。')));

    this.toolSections = [
      this.blockSection, this.equipSection,
      this.boneSection, this.sculptSection, this.stampSection,
    ];

    /**
     * What the SELECT tool has to say for itself.
     *
     * Nothing: the five edit groups below apply whatever tool is in hand,
     * and hiding them behind one tool was most of why they were hard to
     * find. This says so, rather than leaving an empty gap.
     */
    this.selectSection = toolSection(t('選択ツール'),
      h('div', { class: 'note' }, t('クリックで選択、ドラッグで移動。')));
    this.toolSections.unshift(this.selectSection);

    // The sculpting tools start folded: they are the advanced half, and
    // three more buttons is three more rows between you and everything else.
    this.sculptTools = collapsible(t('加工 (上級)'),
      h('div', { class: 'body' }, ...SCULPT_LIST.map(mkTool)), { open: false });

    // Rides over the viewport, next to the cursor, out of the way of the
    // pointer itself.
    this.placeHint = h('div', { class: 'placehint hidden' });
    this.root.append(this.placeHint);
    this.root.append(this.draftBar);
    this.root.append(this.marquee);
    // A click anywhere else puts the menus away.
    this._onDocDown = () => this._closeMenus();
    document.addEventListener('pointerdown', this._onDocDown);

    this.leftScroll = h('div', { class: 'panelscroll' });
    this.leftPanel = resizable(
      h('div', { class: 'panel', id: 'leftpanel' },
        append(this.leftScroll,
          h('h3', {}, t('組み立て')),
          h('div', { class: 'body' }, ...ASSEMBLE_TOOLS.map(mkTool)),
          this.sculptTools,
          h('h3', {}, t('ツール設定')),
          h('div', { class: 'body' },
            ...this.toolSections,
            h('label', { class: 'checkline' }, this.symmetryToggle, t('左右対称でつける')),
            h('label', { class: 'checkline' }, this.previewToggle, t('歩行プレビュー')),
            h('label', { class: 'checkline' }, this.ringGuideToggle, t('サークルの円線を表示')),
          ),
          // Everything you can do to what is already there, in five groups
          // named after what you are trying to do. Always available: none of
          // it depends on which tool is in hand.
          h('h3', {}, t('編集')),
          ...this.editGroups,
        ),
      ),
      { key: 'leftpanel', edges: 'es', minW: 168 },
    );

    // ---------------------------------------------------- right panel
    this.paletteEl = h('div', { class: 'palette' });
    this.customEl = h('div', { class: 'palette' });

    this.wheel = new ColorWheel((hex) => app.setCustomColor(hex));
    this.wheelWrap = h('div', { class: 'collapsed' }, this.wheel.el);
    this.wheelToggle = h('button', {
      class: 'ghost wide',
      onClick: () => {
        const open = this.wheelWrap.classList.toggle('collapsed');
        this.wheelToggle.textContent = open ? t('カラーサークル ▾') : t('カラーサークル ▴');
        if (!open) this.wheel.redraw();
      },
    }, t('カラーサークル ▾'));

    this.inspectorEl = h('div', { class: 'body' });
    this.statsEl = h('div', { class: 'body' });
    /**
     * The three numbers that decide how the machine will PLAY, on screen at
     * all times.
     *
     * They used to live in a panel that started folded, so a builder could
     * add twenty blocks and get no hint that the thing now handles like a
     * filing cabinet. This is the feedback loop the editor is missing
     * without it — the full panel is still there for the rest.
     */
    this.specStrip = h('div', { class: 'specstrip' });
    this.libraryEl = h('div', { class: 'body' });
    this.librarySection = collapsible(t('パーツ庫'), this.libraryEl, { open: false });

    // Anchored to the right, so its width grip is on the LEFT edge: that is
    // the side that actually moves when the panel gets wider.
    this.treeEl = h('div', { class: 'tree' });
    this.treeCount = h('span', { class: 'note', style: 'margin:0' }, '0');
    this.treeSection = collapsible(
      t('パーツ一覧'),
      h('div', { class: 'body' },
        h('div', { class: 'row tight' },
          h('span', { class: 'note', style: 'margin:0' }, t('見えない所のパーツもここから')),
          this.treeFilter,
          h('div', { class: 'spacer' }),
          this.treeCount,
        ),
        this.treeSearch,
        this.treeEl,
      ),
      // Open: this is the only way to reach a part that something else is
      // covering, which is most of them on a finished machine.
      { open: true },
    );

    this.rightScroll = h('div', { class: 'panelscroll' });
    this.rightPanel = resizable(
      h('div', { class: 'panel', id: 'rightpanel' },
        append(this.rightScroll,
          this.specStrip,
          this.treeSection,
          this.librarySection,
          // Open. Colour is picked as often as anything on this panel, and
          // folded away it is four actions from "I want that one red".
          collapsible(t('色'), h('div', { class: 'body' },
            this.paletteEl,
            h('h3', { class: 'inline' }, t('最近使った色')),
            this.recentEl,
            h('h3', { class: 'inline' }, t('カスタム色')),
            this.customEl,
            this.wheelToggle,
            this.wheelWrap,
          )),
          collapsible(t('インスペクタ'), this.inspectorEl),
          collapsible(t('スペック'), this.statsEl, { open: false }),
        ),
      ),
      { key: 'rightpanel', edges: 'ws', minW: 186 },
    );

    // ---------------------------------------------------- hints
    this.hint = h('div', { id: 'hint' },
      h('span', {}, h('b', {}, t('左ドラッグ')), t('回転')),
      h('span', {}, h('b', {}, t('右ドラッグ')), t('平行移動')),
      h('span', {}, h('b', {}, t('クリック')), t('設置 / 選択')),
      h('span', {}, h('b', {}, 'Ctrl+click'), t('複数選択')),
      h('span', {}, h('b', {}, t('同じ所を再クリック')), t('奥のパーツ')),
      h('span', {}, h('b', {}, '. / Home'), t('選択に寄る / 全体')),
      h('span', {}, h('b', {}, 'T / R'), t('ギズモ')),
      h('span', {}, h('b', {}, 'J'), t('連結')),
      h('span', {}, h('b', {}, 'Ctrl+Z'), t('元に戻す')),
      h('span', {}, h('b', {}, 'Ctrl+C/V'), t('コピー')),
      h('span', {}, h('b', {}, 'Del'), t('削除')),
    );

    // ---------------------------------------------------- field mode
    // Built from the live bindings, so it stays true after a rebind — and
    // the weapon keys come FIRST, because "how do I shoot" is the one
    // question a control hint has to answer.
    this.fieldWeaponHint = h('span', { class: 'fieldkeys hot' });
    this.fieldMoveHint = h('span', { class: 'fieldkeys' });

    this.fieldLabel = h('span', {
      style: 'color:var(--accent);font-family:var(--mono);letter-spacing:.14em',
    }, 'TEST FIELD');

    // The tab that brings a folded panel back.
    this.leftTab = h('button', {
      class: 'panelfold', title: t('パネルを開く / たたむ'),
      onClick: () => this.leftPanel.classList.toggle('folded'),
    }, '▸');
    this.rightTab = h('button', {
      class: 'panelfold right', title: t('パネルを開く / たたむ'),
      onClick: () => this.rightPanel.classList.toggle('folded'),
    }, '◂');

    /** Which place this is. Read-only: changing it is a pause-menu job. */
    this.fieldPlace = h('span', { class: 'fieldplace' }, '');

    this.fieldBar = h('div', { id: 'fieldbar', class: 'hidden' },
      this.fieldLabel,
      this.fieldPlace,
      h('div', { class: 'sep' }),
      this.fieldWeaponHint,
      h('div', { class: 'sep' }),
      this.fieldMoveHint,
      h('div', { class: 'spacer' }),
      h('button', { onClick: () => this.app.openOptions() }, t('設定')),
      h('button', { onClick: () => this.keyConfig.show() }, t('キー設定')),
      h('button', { onClick: () => this.help.show('field') }, t('使い方')),
    );
    // The legend does not count down any more: it stays up. Anything that
    // needs OPERATING — the arena, the ceasefire — is on the pause menu,
    // where the pointer is free and nothing is trying to shoot you.

    this.pauseRestartBtn = h('button', {
      class: 'wide', onClick: () => app.restartField(),
    }, t('⟲ リスポーン'));

    // The same two settings again, where somebody who is losing will look
    // for them. A field switch mid-fight is a legitimate thing to want.
    this.pauseArena = h('select', {
      onChange: (e) => app.setArena(e.target.value),
    }, ...ARENA_ORDER.map((id) => h('option', { value: id }, t(ARENAS[id].label))));
    this.pauseCeasefire = h('label', { class: 'checkline' },
      h('input', {
        type: 'checkbox',
        onChange: (e) => app.setEnemyFire(!e.target.checked),
      }), t('敵に撃たせない'));

    this.pauseMenu = h('div', { id: 'pause', class: 'hidden' },
      h('div', { class: 'pausebox' },
        h('div', { class: 'pausetitle' }, 'PAUSED'),
        h('div', { class: 'pausesub' }, t('ESC で再開')),
        h('button', { class: 'primary wide', onClick: () => app.resumeField() }, t('▶ 再開する')),
        this.pauseRestartBtn,
        // Only where they mean something.
        //
        // A run walks its own ladder of places, so choosing one is choosing
        // which to skip; and a run where nothing shoots is not a run. Both
        // go away rather than sitting there refusing — a control that
        // cannot be moved is still a question the player has to answer.
        this.pauseSettings = h('div', { class: 'pausefield' },
          h('label', { class: 'field' }, h('span', {}, t('場所')), this.pauseArena),
          this.pauseCeasefire,
        ),
        h('button', { class: 'wide', onClick: () => app.openOptions() }, t('⚙ 設定')),
        h('button', { class: 'wide', onClick: () => this.keyConfig.show() }, t('⌨ キー設定')),
        h('button', { class: 'wide', onClick: () => this.help.show('field') }, t('？ 使い方')),
        // Nor this, mid-run: the editor rebuilds the machine the run is
        // being fought with, and there is no coming back to the wave you
        // left. Leaving is what タイトルへ is for.
        this.pauseEditBtn = h('button', {
          class: 'wide', onClick: () => app.setMode('edit'),
        }, t('← 編集画面に戻る')),
        h('button', { class: 'wide', onClick: () => app.goTitle() }, t('⌂ タイトルへ')),
      ),
    );

    this.toast = h('div', { id: 'toast' });

    this.keyConfig = new KeyConfig(app.input, {
      onChange: () => { app.saveBindings(); this.syncFieldHint(); },
    });
    this.share = new ShareDialog(app);
    this.help = new Help(app);
    this.title = new TitleScreen(app);
    this.sortie = new SortieScreen(app);
    this.versus = new VersusScreen(app);
    this.replays = new Replays(app);
    this.result = new ResultScreen(app);

    this.root.append(
      this.topbar, this.partBar, this.leftPanel, this.rightPanel, this.hint,
      this.leftTab, this.rightTab,
      this.fieldBar, this.pauseMenu, this.keyConfig.el, this.share.el,
      this.firstRun,
      this.help.el, this.title.el, this.sortie.el, this.versus.el, this.replays.el,
      this.result.el, this.toast,
    );

    this._bindGestures();
    this.renderPalette();
    this.syncTool(app.editor.tool);
    this.syncResolution(app.assembly.voxRes);
    this.syncFieldHint();
  }

  /**
   * Treat a held slider as ONE change, everywhere, forever.
   *
   * Bound once by delegation rather than passed into fifteen slider call
   * sites: every slider on the panel is covered, including the ones that do
   * not exist yet, and no future one can forget to opt in. A range input is
   * the only control here that a player holds on to — everything else
   * commits on release already.
   */
  _bindGestures() {
    const app = this.app;
    const isSlider = (el) => el && el.tagName === 'INPUT' && el.type === 'range';

    this.root.addEventListener('pointerdown', (e) => {
      if (isSlider(e.target)) app.beginGesture();
    }, true);
    // On the window, because a drag that leaves the panel still ends.
    for (const type of ['pointerup', 'pointercancel']) {
      window.addEventListener(type, () => app.endGesture(), true);
    }
    // Arrow keys nudge a focused slider, and holding one repeats: same deal.
    this.root.addEventListener('keydown', (e) => {
      if (isSlider(e.target) && !e.repeat) app.beginGesture();
    }, true);
    this.root.addEventListener('keyup', (e) => {
      if (isSlider(e.target)) app.endGesture();
    }, true);
  }

  /** Redraw the field control strip from whatever the keys are bound to now. */
  syncFieldHint() {
    const k = (a) => this.app.input.primary(a);
    const pair = (keys, what) => h('span', { class: 'keypair' }, h('b', {}, keys), what);
    this.fieldWeaponHint.replaceChildren(
      pair(k('fire'), t('武器を撃つ')),
      pair(`${k('weaponNext')} / ${k('weaponPrev')}`, t('武器切替')),
      pair(k('lock'), t('ロックオン')),
      pair(k('cycleTarget'), t('ターゲット切替')),
    );
    this.fieldMoveHint.replaceChildren(
      pair(`${k('forward')}${k('left')}${k('back')}${k('right')}`, t('移動（2回押しでダッシュ）')),
      pair(k('up'), t('上昇・跳躍')),
      pair(k('down'), t('下降')),
      pair(k('boost'), t('ブースト')),
      pair(`${k('layerA')}·${k('layerB')}·${k('layerC')}`, 'ABC'),
      pair(k('reset'), t('リスポーン')),
      pair(k('camera'), t('カメラ回転（ホイールでズーム）')),
      pair('Esc', t('ポーズ')),
    );
  }

  // ---------------------------------------------------------- sync

  /**
   * Show the settings the current tool actually uses, and hide the rest.
   * Dimming them was not enough: they still took up the panel.
   */
  syncTool(tool) {
    for (const [id, b] of this.toolButtons) b.classList.toggle('active', id === tool);
    const isBone = [
      TOOL.BONE_LEG, TOOL.BONE_ARM, TOOL.BONE_FACE, TOOL.BONE_CUSTOM, TOOL.BONE_WEAPON,
    ].includes(tool);
    const isSculpt = [TOOL.CARVE, TOOL.ADD, TOOL.PAINT].includes(tool);

    this.selectSection.setVisible(tool === TOOL.SELECT);
    this.blockSection.setVisible(tool === TOOL.BLOCK);
    this.equipSection.setVisible(tool === TOOL.EQUIP);
    this.boneSection.setVisible(isBone);
    this.sculptSection.setVisible(isSculpt);
    if (isSculpt) {
      this.syncBrush(this.app.editor.brushPercent, this.app.editor.brushMetres());
      this.sculptAxis.value = String(this.app.editor.sculptAxis ?? 0);
      this.brushShape.checked = !!this.app.editor.brushRound;
    }
    this.stampSection.setVisible(tool === TOOL.STAMP);

    // Reaching a sculpt tool by keyboard should not leave its button folded away.
    if (isSculpt) this.sculptTools.setOpen(true);

    this.syncEquipType(this.app.editor.equipType);
    this._revealToolSettings();
  }

  /**
   * Bring the armed tool's own settings into view.
   *
   * The tool list above them is a fixed 312 pixels and never folds, so on a
   * 720-high window the settings for whatever you just picked start below
   * the fold — the plate-size slider sat a hundred pixels past the bottom of
   * the panel. Arming a tool and not being shown its settings is the panel
   * hiding the one thing you just asked for.
   */
  _revealToolSettings() {
    const section = this.toolSections.find((sec) => !sec.classList.contains('hidden'));
    const scroll = this.leftScroll;
    if (!section || !scroll?.isConnected) return;
    const box = section.getBoundingClientRect();
    const view = scroll.getBoundingClientRect();
    if (!view.height) return;
    // Rects come back in screen pixels and scrollTop is in layout pixels.
    // They are the same number until something up the tree is scaled, and
    // then scrolling by a measured rect moves a fraction of the distance it
    // was asked for.
    const scale = view.height / (scroll.offsetHeight || view.height) || 1;
    const over = (box.bottom - view.bottom) / scale;
    // Only ever scrolls DOWN to reveal, and never past the section's own top:
    // yanking the panel about when nothing was hidden is its own annoyance.
    if (over > 1) {
      const room = Math.max(0, (box.top - view.top) / scale);
      scroll.scrollTop += Math.min(over, room);
    }
  }

  /**
   * Keep the machine bigger than the tools that shape it.
   *
   * The panels are a fixed width, so on a 1440-wide window they take 30% of
   * it and on a 900-wide one they take 48% — the thing being built ends up
   * with less room than the controls for building it. Under that width they
   * fold to their edge, and the button on each edge brings them back.
   */
  syncPanelWidth() {
    // The legend wraps to more lines in a narrower window, so its height is
    // one of the things a resize changes.
    this._forgetFieldHintHeight();
    const narrow = window.innerWidth < PANEL_FOLD_BELOW;
    if (narrow === this._wasNarrow) return this;
    this._wasNarrow = narrow;
    // Only ever folds them ON THE WAY DOWN. Someone who opened a panel in a
    // narrow window meant it, and having it shut again on the next resize
    // tick would be the window arguing with them.
    if (narrow) {
      this.leftPanel.classList.add('folded');
      this.rightPanel.classList.add('folded');
    } else {
      this.leftPanel.classList.remove('folded');
      this.rightPanel.classList.remove('folded');
    }
    return this;
  }

  /**
   * Put the control legend up, and leave it there.
   *
   * It used to fold itself away after six seconds and there was no way to
   * bring it back — F1 opens the help panel, not this — so anything on it
   * was readable exactly once per visit to the field. A legend you cannot
   * consult is a legend for somebody who did not need it.
   *
   * The parameter is kept so old callers still read sensibly; a positive
   * number no longer starts a clock.
   */
  showFieldHint() {
    this.fieldBar.classList.remove('folded');
    this._forgetFieldHintHeight();
    return this;
  }

  /**
   * How much of the top of the screen the control legend is covering, in
   * layout pixels. Zero when it is folded or not up at all.
   */
  fieldHintHeight() {
    const bar = this.fieldBar;
    if (!bar || bar.classList.contains('hidden') || bar.classList.contains('folded')) return 0;
    // Remembered, not measured.
    //
    // This is read once a frame, and `offsetHeight` forces the browser to
    // recompute layout to answer it — which doubled the running time of
    // everything in the app. It only changes when the legend appears or the
    // window resizes, so it is measured there instead.
    if (!this._fieldHintH) this._fieldHintH = bar.offsetTop + bar.offsetHeight;
    return this._fieldHintH;
  }

  /** Forget the remembered height, so the next read measures again. */
  _forgetFieldHintHeight() {
    this._fieldHintH = 0;
    return this;
  }

  /** Fold it away now. Nothing does this by itself any more. */
  hideFieldHint() {
    this.fieldBar.classList.add('folded');
    return this;
  }

  /**
   * Run the legend's clock. Driven from the app's frame, in real seconds:
   * this is a piece of screen furniture, not part of the fight.
   */
  tickFieldHint() {
    // Nothing to run any more: the legend stays up. Kept so the app's frame
    // does not have to know that.
    return this;
  }

  /** Enable / disable the undo buttons and say what they would reverse. */
  syncHistory() {
    const hist = this.app.history;
    for (const btn of [this.undoBtn, this.partUndoBtn]) {
      btn.disabled = !hist.canUndo;
      btn.title = hist.canUndo ? t('元に戻す: {0} (Ctrl+Z)', [hist.undoLabel]) : t('元に戻す (Ctrl+Z)');
    }
    for (const btn of [this.redoBtn, this.partRedoBtn]) {
      btn.disabled = !hist.canRedo;
      btn.title = hist.canRedo ? t('やり直し: {0} (Ctrl+Y)', [hist.redoLabel]) : t('やり直し (Ctrl+Y)');
    }
  }

  /** The shelf of saved parts, with what you can do to each. */
  renderLibrary() {
    const app = this.app;
    const items = app.library.list();

    if (!items.length) {
      this.libraryEl.replaceChildren(
        h('div', { class: 'inspector-empty' },
          t('まだパーツがありません。'),
          h('br'), t('「パーツ編集」で作るか、選択中のパーツを下のボタンで登録できます。')),
        h('button', {
          class: 'ghost wide', onClick: () => app.saveSelectionAsPart(),
        }, t('選択パーツを登録')),
      );
      return;
    }

    this.libraryEl.replaceChildren(
      ...items.map((item) => h('div', { class: 'libitem' },
        partSketch(item.json, 40),
        h('div', { class: 'libname', title: item.name },
          item.name,
          // Which of these you made and which came with the game. Deleting
          // your own work and deleting a starter part are not the same act,
          // and the row said nothing either way.
          item.builtin ? h('div', { class: 'libtag' }, t('最初から入っているパーツ')) : null),
        h('div', { class: 'row tight' },
          h('button', { title: t('メイン編集に置く'), onClick: () => app.placePart(item.id) }, t('配置')),
          h('button', { title: t('パーツ編集で開く'), onClick: () => app.openPartEditor(item.id) }, t('編集')),
          h('button', {
            class: 'danger', title: t('パーツ庫から削除'), onClick: () => app.deletePart(item.id),
          }, '×'),
        ),
      )),
      h('button', {
        class: 'ghost wide', onClick: () => app.saveSelectionAsPart(),
      }, t('選択パーツを登録')),
    );
  }

  /** Highlight the armed plate, and say what it does. */
  syncEquipType(type) {
    for (const [id, b] of this.equipButtons) b.classList.toggle('active', id === type);
    this.equipHint.textContent = EQUIP_META[type]?.blurb ?? '';
  }

  /**
   * Name what is selected now, so it can be picked again in one click.
   *
   * Picking out "the eight thruster housings" is a minute of careful
   * clicking that the next click throws away.
   */
  keepSelectionSet() {
    if (!this.app.editor.selection.size) { this.toastMsg(t('残す選択がありません')); return; }
    const name = window.prompt(t('このまとまりの名前'), '');
    if (name === null) return;
    if (this.app.editor.keepSelection(name)) this.toastMsg(t('「{0}」として残しました', [name]));
  }

  /** Draw one button per saved selection, plus a way to forget one. */
  renderSelectionSets(names) {
    const app = this.app;
    this.setRow.replaceChildren(
      ...(names ?? []).map((name) => h('button', {
        title: t('{0} を選び直す（右クリックで削除）', [name]),
        onClick: () => app.editor.useSelection(name),
        onContextmenu: (e) => { e.preventDefault(); app.editor.dropSelection(name); },
      }, name)),
      ...(names?.length ? [] : [h('span', { class: 'note', style: 'margin:0' }, t('まだありません'))]),
    );
    return this;
  }

  /** One of two axis frames, and the buttons say which. */
  setGizmoSpace(space) {
    this.app.editor.setGizmoSpace(space);
    this.spaceButtons[0].classList.toggle('active', space !== 'local');
    this.spaceButtons[1].classList.toggle('active', space === 'local');
    return this;
  }

  _applySection() {
    const axis = this.sectionAxis.value || null;
    this.app.editor.setSection(axis, Number(this.sectionAt.value));
    this.sectionAt.classList.toggle('hidden', !axis);
    return this;
  }

  syncGizmoMode(mode) {
    this.gizmoButtons[0].classList.toggle('active', mode === 'translate');
    this.gizmoButtons[1].classList.toggle('active', mode === 'rotate');
  }

  /**
   * Symmetry is one setting with a box in two places — beside placement and
   * beside carving — because it matters in both and walking to the other
   * panel to find it is how people end up carving one side only.
   */
  syncSymmetry(on) {
    this.app.editor.setSymmetry(on);
    this.symmetryToggle.checked = on;
    this.sculptMirror.checked = on;
    return this;
  }

  /**
   * Name the selection.
   *
   * A machine of forty parts is forty rows called 「ブロック」, and the one
   * you want is the one you would have named if naming had been possible.
   */
  askName() {
    const parts = this.app.editor.selectedParts();
    if (!parts.length) { this.toastMsg(t('名前を付けるパーツを選んでください')); return; }
    const now = parts.length === 1 ? (t(parts[0].label) ?? '') : '';
    const next = window.prompt(t('パーツの名前'), now);
    if (next === null) return;
    const n = this.app.editor.renameSelected(next);
    if (n) { this.renderTree(); this.toastMsg(t('{0} 個に名前を付けました', [n])); }
  }

  /**
   * Show which place is being fought in, and whether the guns are cold.
   *
   * The controls appear twice — on the field bar and in the pause menu —
   * so this is the one place that decides what either of them says.
   *
   * @param {string} arenaId
   * @param {boolean} enemyFire
   * @param {boolean} canCeasefire false under a set of rules: a run where
   *   nothing shoots is not a run
   */
  syncArena(arenaId, enemyFire, canCeasefire) {
    const arena = ARENAS[arenaId] ?? ARENAS[ARENA_ORDER[0]];
    this.pauseArena.value = arenaId;
    this.pauseCeasefire.firstChild.checked = !enemyFire;
    // The whole block goes in a run: the ladder decides the place, and a
    // run with the guns off is not a run.
    this.pauseSettings.classList.toggle('hidden', !canCeasefire);
    this.pauseEditBtn.classList.toggle('hidden', !canCeasefire);
    // The legend says where you are, since it is no longer where you change it.
    this.fieldPlace.textContent = t(arena.label);
    return this;
  }

  syncResolution(n) { this.resSelect.value = String(n); }

  syncColor(i) {
    for (const el of this.root.querySelectorAll('.swatch')) {
      el.classList.toggle('active', Number(el.dataset.index) === i);
    }
    const hex = this.app.assembly.palette.get(i);
    if (hex !== undefined) this.wheel.setHex(hex);
  }

  /** Standard swatches are fixed; custom ones grow as the wheel is used. */
  renderPalette() {
    const app = this.app;
    const pal = app.assembly.palette;

    const mk = (hex, index, title) => h('div', {
      class: `swatch${index === app.editor.colorIndex ? ' active' : ''}`,
      style: `background:${hexToCss(hex)}`,
      title,
      'data-index': index,
      onClick: () => app.setColor(index),
    });

    this.paletteEl.replaceChildren(
      ...STANDARD_COLORS.map((c, i) => mk(pal.get(i), i, i === 0 ? t('コアシルバー') : t('標準色 {0}', [i]))),
    );

    const custom = pal.customEntries();
    this.customEl.replaceChildren(
      ...custom.map((e) => mk(e.hex, e.index, hexToCss(e.hex))),
      ...(custom.length ? [] : [h('div', { class: 'note', style: 'grid-column:1/-1' }, t('まだありません'))]),
    );

    // The last few colours actually used, in the order they were used.
    //
    // A scheme is three or four colours out of thirty-odd swatches, and
    // every switch between them was a hunt across two grids — including the
    // switch back to the one used a second ago.
    this.recentEl.replaceChildren(
      ...this.recentColors
        .filter((i) => pal.get(i) !== undefined)
        .map((i) => mk(pal.get(i), i, t('最近使った色 {0}', [hexToCss(pal.get(i))]))),
    );
    this.recentEl.classList.toggle('hidden', !this.recentColors.length);
  }

  /** Remember a colour the moment it is chosen, most recent first. */
  noteColor(index) {
    this.recentColors = [index, ...this.recentColors.filter((i) => i !== index)].slice(0, 8);
    this.renderPalette();
    return this;
  }

  syncMode(mode) {
    const editing = mode === 'edit' || mode === 'part';
    const isPart = mode === 'part';
    const isTitle = mode === 'title';
    const isSolo = mode === 'solo';

    this.editBtn.classList.toggle('active', mode === 'edit');
    this.partBtn.classList.toggle('active', isPart);

    for (const el of [this.leftPanel, this.rightPanel, this.hint]) {
      el.classList.toggle('hidden', !editing);
    }
    this.topbar.classList.toggle('hidden', mode !== 'edit');
    this.partBar.classList.toggle('hidden', !isPart);
    // The control legend is a greeting, not furniture.
    //
    // It is 98% of the screen wide and sits across the top — which is where
    // the run's own read-out is drawn, so for the whole of solo play the
    // wave, the count of what is left, the score and the LIVES were behind
    // it. It says its piece for a few seconds now and folds away; ? or F1
    // brings it back, and so does pausing.
    // Not in a run.
    //
    // The legend is 98% of the screen wide and sits across the top, which
    // is exactly where the run's own read-out is drawn — so for the whole
    // of a run the stage, the wave, the score and the LIVES were behind a
    // strip of key hints. The test field is where you are learning the
    // controls; a run is where you are using them.
    const wantBar = !editing && !isTitle && !isSolo;
    this.fieldBar.classList.toggle('hidden', !wantBar);
    // A pause menu belongs to a fight and to nothing else.
    //
    // It was only ever put away by whoever opened it, so leaving a paused
    // fight for the title screen — which does not go through resume — left
    // it sitting over the menu. Owning it here means no exit can forget.
    if (!wantBar) this.setPaused(false);
    if (wantBar && !this._fieldBarWasOn) this.showFieldHint();
    this._fieldBarWasOn = wantBar;

    // The title owns the whole screen; a run keeps its own read-out.
    this.title.setOpen(isTitle);
    if (!isSolo) this.result.close();
    this.fieldLabel.textContent = isSolo ? 'SOLO PLAY' : 'TEST FIELD';
    // In a run, restarting means starting the run over, not just standing
    // back up — those are different enough to be worth different words.
    this.pauseRestartBtn.textContent = isSolo ? t('⟲ 最初からやり直す') : t('⟲ リスポーン');
    // The read-out owns the top of the screen in a run, so nothing else may
    // reserve space up there.
    if (isSolo) this._fieldHintH = 0;

    // The library is a machine-editor concern; on the workbench you ARE the part.
    this.librarySection.classList.toggle('hidden', isPart);
    if (isPart) this.partNameInput.value = this.app.partAssembly.name;
    if (editing) this.setPaused(false);
  }

  setPaused(on) { this.pauseMenu.classList.toggle('hidden', !on); }

  toastMsg(msg) {
    this.toast.textContent = msg;
    this.toast.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toast.classList.remove('show'), 1700);
  }

  // ---------------------------------------------------------- inspector

  /** @param {Array} parts every selected part */
  /**
   * The parts list: every part in the build, as the tree it actually is.
   *
   * The 3D view can only ever select what a ray can reach, and a machine
   * worth building hides things on purpose — a core inside a hull, a bone
   * inside a limb, a plate under armour. Before this there was no way to
   * select those at all. Indentation is the parent chain, so it also answers
   * "what is this hanging off?", which the viewport cannot show either.
   */
  renderTree() {
    const app = this.app;
    const asm = app.assembly;
    const selected = new Set(app.editor.selection ?? []);
    // Which colour "the same colour" means: the one the selection is wearing.
    const seed = asm.get(app.editor.selected);
    const wantColor = seed?.vox?.dominantColor?.() ?? null;
    const rows = [];

    const KIND = {
      core: { icon: '◈', label: t('コア') },
      block: { icon: '▪', label: t('ブロック') },
      bone: { icon: '⌇', label: t('ボーン') },
      equip: { icon: '⬢', label: t('プレート') },
    };

    const walk = (id, depth) => {
      const part = asm.get(id);
      if (!part) return;
      // Narrowed to one kind: the tree was the tree and only the tree, so
      // "every plate on this machine" meant reading forty rows looking for
      // an icon. The shape of the tree is kept — a hidden row's children
      // still hang off where it was.
      const shapeName = SHAPES[part.shape ?? SHAPE_DEFAULT]?.label ?? '';
      // The colour is in the haystack too: "the red ones" is how people
      // describe a part far more often than by the shape it was cut from.
      const hex = part.vox?.dominantColor?.() >= 0
        ? hexToCss(asm.palette.get(part.vox.dominantColor()) ?? 0)
        : '';
      const hay = `${t(part.label) ?? ''} ${shapeName} ${part.kind} ${hex}`.toLowerCase();
      const kindOk = !this.treeKind
        || (this.treeKind === 'picked' ? selected.has(id)
          : this.treeKind === 'color' ? (wantColor !== null
            && part.vox?.dominantColor?.() === wantColor)
          : part.kind === this.treeKind);
      const wanted = kindOk && (!this.treeQuery || hay.includes(this.treeQuery));
      const kind = KIND[part.kind] ?? KIND.block;
      // A name the builder gave it beats the shape it happens to be cut
      // from: "PELVIS" says more about a row than "面取り" ever will.
      const named = t(part.label) && t(part.label) !== 'BLOCK' ? t(part.label) : null;
      const name = part.kind === 'bone'
        ? (BONE_META[part.boneType]?.label ?? t('ボーン'))
        : part.kind === 'equip'
          ? (EQUIP_META[part.equipType]?.label ?? t('プレート'))
          : part.kind === 'core' ? t('コア')
            : named ?? (SHAPES[part.shape ?? SHAPE_DEFAULT]?.label ?? t('ブロック'));

      const row = h('button', {
        class: `treerow${selected.has(id) ? ' active' : ''}`,
        style: `padding-left:${6 + depth * 11}px`,
        // How deep it is, because a part seven levels down takes everything
        // below it when it goes and nothing on screen said so.
        title: t('{0} / 第{1}階層 / {2}', [t(kind.label), depth + 1, id]),
        onClick: (e) => {
          app.editor.select(id, e.ctrlKey || e.metaKey);
          // Selecting something you cannot see is only useful if the view
          // then goes and finds it.
          if (!(e.ctrlKey || e.metaKey)) app.editor.frameSelection();
        },
      },
        h('span', { class: 'tk' }, kind.icon),
        h('span', { class: 'tn' }, name),
      );
      if (wanted) rows.push(row);
      for (const child of part.children) walk(child, depth + 1);
    };

    if (asm.rootId) walk(asm.rootId, 0);
    this.treeEl.replaceChildren(...rows);
    this.treeCount.textContent = this.treeKind ? `${rows.length} / ${asm.size}` : `${asm.size}`;
    return this;
  }

  renderInspector(parts) {
    const list = Array.isArray(parts) ? parts : (parts ? [parts] : []);
    this.inspectorEl.replaceChildren();

    this.renderTree();

    if (!list.length) {
      this.inspectorEl.append(h('div', { class: 'inspector-empty' },
        t('パーツをクリックで選択、Ctrl+クリックで複数選択。'),
        h('br'), t('ギズモを掴めば任意の位置に動かせます（空中に浮かせてもOK）。'),
        h('br'), t('設置は、面をクリックでぴったり／何もない所をクリックで浮遊配置。')));
      return;
    }

    if (list.length > 1) {
      const anchor = this.app.assembly.get(this.app.editor.anchorId);
      const anchorName = anchor
        ? `${partName(anchor)} (${anchor.id})`
        : '—';

      this.inspectorEl.append(
        h('div', { class: 'tag' }, t('{0} パーツ選択中', [list.length])),
        h('div', { class: 'stat' },
          h('span', { class: 'k' }, t('連結先')),
          h('span', { class: 'v', style: 'color:var(--accent)' }, anchorName)),

        h('div', { class: 'row tight', style: 'margin-top:6px' },
          h('button', { onClick: () => this.app.connectSelected() }, t('連結 (J)')),
          h('button', { onClick: () => this.app.disconnectSelected() }, t('解除 (⇧J)')),
        ),
        h('div', { class: 'row tight' },
          h('button', { onClick: () => this.app.editor.duplicateSelected() }, t('複製')),
          h('button', { onClick: () => this.app.editor.clearSelection() }, t('選択解除')),
        ),
        ...this._bulkEdits(list),
        h('button', {
          class: 'danger wide', style: 'margin-top:8px',
          onClick: () => this.app.editor.deleteSelected(),
        }, t('{0} パーツを削除 (Del)', [this.app.editor.doomedCount()])),
      );
      return;
    }

    this.inspectorEl.append(...this._singleInspector(list[0]));
  }

  /**
   * What can be changed about a whole selection at once.
   *
   * Selecting four legs and making them all thicker is the entire reason to
   * select four things, and this panel used to offer connect, duplicate and
   * delete — the operations that do not care WHAT you picked. Everything
   * that describes a part was single-only, so the shortest route to "these
   * four, but wider" was to do it four times.
   *
   * Each block only appears when the selection actually holds something it
   * applies to, so a mixed bag of blocks and bones shows the blocks' row and
   * says nothing about bones.
   */
  _bulkEdits(list) {
    const app = this.app;
    const rows = [];
    const blocks = list.filter((p) => p.kind === 'block' || p.kind === 'core');
    const bones = list.filter((p) => p.kind === 'bone');
    const plates = list.filter((p) => p.kind === 'equip');

    if (blocks.length) {
      rows.push(h('h3', { class: 'inline' }, t('寸法 — {0} ブロック', [blocks.length])));
      // Started from the first one rather than from nothing: a slider with
      // no value is a slider you have to find the right end of first.
      const base = blocks[0].size;
      const set = (i, v) => {
        const size = [...(app.editor.assembly.get(blocks[0].id)?.size ?? base)];
        size[i] = v;
        app.editor.resizeSelected(size);
      };
      // Sliders set ONE size on all of them, which is right for four
      // identical legs and destructive for anything else. Say so, and put
      // the thing people actually mean next to it.
      if (blocks.length > 1 && new Set(blocks.map((b) => b.size.join())).size > 1) {
        rows.push(h('div', { class: 'note warn' },
          t('えらんだブロックの寸法はばらばらです。下のスライダーは全部を同じ寸法にします。')));
      }
      rows.push(h('div', { class: 'row tight' },
        h('button', {
          title: t('えらんだものを、それぞれの寸法のまま大きくします'),
          onClick: () => app.editor.scaleSelected(1.1),
        }, '× 1.1'),
        h('button', { onClick: () => app.editor.scaleSelected(1 / 1.1) }, '÷ 1.1'),
        h('button', {
          title: t('最後にえらんだものの寸法に揃えます'),
          onClick: () => app.editor.matchSizeSelected(),
        }, t('寸法を揃える')),
      ));
      rows.push(...['X', 'Y', 'Z'].map((axis, i) => slider(t('幅 {0}', [axis]), {
        min: SIZE_MIN, max: SIZE_MAX, step: SIZE_STEP, value: base[i], fixed: 2,
      }, (v) => set(i, v))));
      rows.push(vectorField(t('寸法'), base, SIZE_STEP, (v) => {
        // Three independent fields, unless the lock says otherwise: making
        // a part "a bit bigger" without squashing it meant working out two
        // more numbers by hand, every time.
        if (!this.keepAspect.checked || blocks.length !== 1) {
          app.editor.resizeSelected(v);
          return;
        }
        const was = blocks[0].size;
        const axis = v.findIndex((n, i) => Math.abs(n - was[i]) > 1e-6);
        if (axis < 0) return;
        app.editor.resizeKeepingShape(axis, v[axis]);
        this.renderInspector(app.editor.selectedParts());
      }));
      rows.push(h('label', { class: 'checkline' }, this.keepAspect, t('縦横比を保つ')));

      rows.push(h('h3', { class: 'inline' }, t('形')));
      rows.push(...this._shapeGrid(() => blocks[0].shape, (id) => app.editor.setBlockShapeSelected(id)));

    }

    if (bones.length) {
      rows.push(h('h3', { class: 'inline' }, t('ボーン — {0} 本', [bones.length])));
      const b = bones[0];
      rows.push(slider(t('長さ'), {
        min: BONE_LENGTH_MIN, max: BONE_LENGTH_MAX, step: 0.25, value: b.length, fixed: 2,
      }, (v) => app.editor.setBoneShapeSelected({ length: v })));
      rows.push(slider(t('太さ'), {
        min: BONE_RADIUS_MIN, max: BONE_RADIUS_MAX, step: 0.01, value: b.radius, fixed: 2,
      }, (v) => app.editor.setBoneShapeSelected({ radius: v })));
      rows.push(slider(t('可動域'), {
        min: 10, max: 170, step: 5, value: b.limit, unit: '°',
      }, (v) => app.editor.setBoneShapeSelected({ limit: v })));
    }

    if (plates.length) {
      rows.push(h('h3', { class: 'inline' }, t('プレート — {0} 枚', [plates.length])));
      rows.push(slider(t('プレート径'), {
        min: EQUIP_SIZE_MIN, max: EQUIP_SIZE_MAX, step: EQUIP_SIZE_STEP,
        value: plates[0].size, fixed: 2,
      }, (v) => app.editor.setEquipSizeSelected(v)));
    }

    return rows;
  }

  _singleInspector(part) {
    const app = this.app;
    const isCore = part.kind === 'core';
    const rows = [
      h('div', { class: 'tag' },
        part.kind.toUpperCase()
        + (part.kind === 'bone' ? ` / ${t(BONE_META[part.boneType].label)}` : '')
        + (part.kind === 'equip' ? ` / ${EQUIP_META[part.equipType]?.label ?? part.equipType}` : '')),
    ];

    if (part.mount) {
      rows.push(h('h3', { class: 'inline' }, t('位置')));
      rows.push(vectorField('POS', part.mount.pos, SIZE_STEP, (v) => {
        app.editor.setMountSelected({ pos: v });
      }));

      const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(part.mount.rot), 'XYZ');
      const deg = [e.x, e.y, e.z].map((r) => THREE.MathUtils.radToDeg(r));
      rows.push(vectorField('ROT°', deg, 15, (v) => {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
          ...v.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ',
        ));
        app.editor.setMountSelected({ rot: q.toArray() });
      }));
      // Three angles do not commute, and the order they are applied in
      // decides where the part ends up. Typing 90 into Y after 90 into X
      // gives a different answer than the other way round, and the panel
      // never said which one it was doing.
      rows.push(h('div', { class: 'note' }, t('X → Y → Z の順。')));

      // Where it sits on the machine, not on its parent.
      //
      // The fields above are measured against whatever the part hangs off,
      // so the same height on two limbs reads as two different numbers and
      // "are these level?" had no answer anywhere on screen.
      const world = app.editor.machinePosition(part.id);
      if (world) {
        rows.push(h('div', { class: 'stat' },
          h('span', { class: 'k' }, t('機体基準')),
          h('span', { class: 'v' }, world.map((n) => n.toFixed(2)).join(' , '))));
      }

      // Which face it is on. Getting this wrong used to mean deleting the
      // part and placing it again, which loses everything carved into it.
      if (part.mount?.face !== undefined) {
        rows.push(h('h3', { class: 'inline' }, t('ついている面')));
        rows.push(h('div', { class: 'row tight wrap' },
          ...[[t('右'), 0], [t('左'), 1], [t('上'), 2], [t('下'), 3], [t('前'), 4], [t('後'), 5]]
            .map(([label, face]) => h('button', {
              class: part.mount.face === face ? 'active' : '',
              onClick: () => app.editor.moveToFace(face),
            }, label)),
        ));
      }

      // --- which segment does it ride with?
      rows.push(h('button', {
        class: 'ghost wide',
        title: t('クリックしたパーツを新しい連結先にします'),
        onClick: () => app.editor.beginReparent(),
      }, t('クリックでつなぎ替え')));
      const options = [...app.assembly.parts.values()]
        .filter((p) => app.assembly.canReparent(part.id, p.id))
        .map((p) => h('option', {
          value: p.id, ...(p.id === part.parent ? { selected: 'selected' } : {}),
        }, `${partName(p)} (${p.id})`));

      rows.push(h('h3', { class: 'inline' }, t('連結先')));
      rows.push(h('select', {
        onChange: (ev) => app.editor.reparentSelected(ev.target.value),
      }, ...options));
      const half = app.editor.boneHalfOf(part.id);
      if (half) {
        rows.push(h('div', { class: 'stat' },
          h('span', { class: 'k' }, t('ボーン')),
          h('span', { class: `v ${half === 'far' ? 'good' : 'warn'}` },
            half === 'far' ? t('可動側') : t('固定側'))));
        rows.push(h('div', { class: 'note' }, half === 'far'
          ? t('この関節から先なので、ボーンと一緒に振れます。')
          : t('ボーンの手前半分なので動きません。中点より先へ動かすと可動側になります。')));
        rows.push(h('div', { class: 'row tight' },
          h('button', { title: t('ボーンの根元へ'), onClick: () => app.editor.slideAlongBone(0) }, t('根元へ')),
          h('button', { title: t('関節の少し先へ'), onClick: () => app.editor.slideAlongBone(0.55) }, t('可動側へ')),
          h('button', { title: t('ボーンの先端へ'), onClick: () => app.editor.slideAlongBone(1) }, t('先端へ')),
        ));
      }

      rows.push(h('button', {
        class: 'ghost wide', onClick: () => app.disconnectSelected(),
      }, t('連結を解除 (⇧J)')));
    }

    if (part.kind === 'bone') {
      rows.push(h('h3', { class: 'inline' }, t('寸法')));
      rows.push(slider(t('長さ'), {
        min: BONE_LENGTH_MIN, max: BONE_LENGTH_MAX, step: 0.25, value: part.length, fixed: 2,
      }, (v) => app.editor.setBoneShapeSelected({ length: v })));
      rows.push(slider(t('太さ'), {
        min: BONE_RADIUS_MIN, max: BONE_RADIUS_MAX, step: 0.01, value: part.radius, fixed: 2,
      }, (v) => app.editor.setBoneShapeSelected({ radius: v })));
      rows.push(h('label', { class: 'checkline' },
        h('input', {
          type: 'checkbox', ...(part.invert ? { checked: 'checked' } : {}),
          onChange: (ev) => { part.invert = ev.target.checked; app.editor.rebuild(); },
        }), t('動きを反転')));

      rows.push(h('button', {
        class: 'ghost wide',
        title: t('選んだ他のボーンを、このボーンの長さと太さに揃えます'),
        onClick: () => app.editor.matchBoneSelected(),
      }, t('他のボーンをこれに揃える')));

      rows.push(...this._boneTravel(part));
      rows.push(...this._boneMotion(part));

      rows.push(h('h3', { class: 'inline' }, t('つなげる')));
      rows.push(h('button', {
        class: 'ghost wide',
        title: t('このボーンの先端に、もう1本つなげます'),
        onClick: () => app.editor.addBoneOnTipSelected(),
      }, t('＋ 先端に{0}', [t(BONE_META[part.boneType].label)])));
      rows.push(...this._boneLink(part));

      if (part.boneType === 'custom') rows.push(...this._customMotion(part));
      if (part.boneType === 'weapon') rows.push(...this._weaponMotion(part));
      if (part.boneType === 'custom' || part.boneType === 'weapon') {
        rows.push(...this._bonePreview(part));
      }
    } else if (part.kind === 'equip') {
      const meta = EQUIP_META[part.equipType];

      rows.push(h('div', { class: 'note' }, t(meta.blurb)));

      rows.push(h('h3', { class: 'inline' }, t('種類')));
      const swap = (type) => h('button', {
        class: part.equipType === type ? 'active' : '',
        title: t(EQUIP_META[type].blurb),
        onClick: () => app.editor.setEquipTypeSelected(type),
      }, t(EQUIP_META[type].label));
      rows.push(h('div', { class: 'equipgrid' }, ...WEAPON_TYPES.map(swap)));
      rows.push(h('div', { class: 'equipgrid' }, ...SYSTEM_TYPES.map(swap)));

      rows.push(h('h3', { class: 'inline' }, t('大きさ')));
      rows.push(slider(t('径'), {
        min: EQUIP_SIZE_MIN, max: EQUIP_SIZE_MAX, step: EQUIP_SIZE_STEP,
        value: part.size, fixed: 2,
      }, (v) => app.editor.setEquipSizeSelected(v)));

      if (meta.category === 'weapon' && meta.ammo) {
        rows.push(h('div', { class: 'stat' },
          h('span', { class: 'k' }, t('装弾 / リロード')),
          h('span', { class: 'v' }, t('{0} 発 / {1}s', [meta.ammo, meta.reload.toFixed(1)]))));
      }
      if (meta.dps) {
        rows.push(h('div', { class: 'stat' },
          h('span', { class: 'k' }, t('接触ダメージ')),
          h('span', { class: 'v' }, `${meta.dps}/s`)));
      }

      if (part.spin) {
        const parent = app.assembly.get(part.parent);
        rows.push(h('h3', { class: 'inline' }, t('回転')));

        // A gimmick that never stops is a gimmick you cannot build on: the
        // ring carries its riders out from under the cursor. This stops it
        // here and only here — in the field it turns regardless.
        const running = app.editor.gimmickRunning(part.id);
        rows.push(h('div', { class: 'row tight' },
          ...[[true, t('動かす')], [false, t('止める')]].map(([on, label]) => h('button', {
            class: running === on ? 'active' : '',
            onClick: () => {
              app.editor.setGimmickRunning(part.id, on);
              this.renderInspector(app.editor.selectedParts());
            },
          }, label)),
          h('div', { class: 'spacer' }),
          h('span', { class: 'note', style: 'margin:0' }, t('編集中だけ')),
        ));
        rows.push(h('div', { class: 'row tight' },
          ...[[1, t('正転 ↻')], [-1, t('逆転 ↺')]].map(([d, label]) => h('button', {
            class: part.spin.dir === d ? 'active' : '',
            onClick: () => {
              app.editor.setEquipSpinSelected({ dir: d });
              this.renderInspector(app.editor.selectedParts());
            },
          }, label))));
        rows.push(slider(t('速さ'), {
          min: SPIN_RPM_MIN, max: SPIN_RPM_MAX, step: 5, value: part.spin.rpm, unit: ' rpm',
        }, (v) => app.editor.setEquipSpinSelected({ rpm: v })));
        if (meta.ring) {
          rows.push(slider(t('半径'), {
            min: CIRCLE_RADIUS_MIN, max: CIRCLE_RADIUS_MAX, step: CIRCLE_RADIUS_STEP,
            value: part.ringRadius, fixed: 2, unit: ' m',
          }, (v) => app.editor.setEquipRingSelected(v)));

          // Which way the circle lies. Without this the answer is decided
          // entirely by which face the plate went on, and a plate on a chest
          // draws its circle standing on edge — where nothing is standing.
          rows.push(h('h3', { class: 'inline' }, t('円線の向き')));
          rows.push(h('div', { class: 'row tight' },
            ...RING_PLANES.map((planeOpt) => h('button', {
              class: (part.ringPlane ?? RING_PLANE_DEFAULT) === planeOpt.id ? 'active' : '',
              title: t(planeOpt.note),
              onClick: () => {
                app.editor.setEquipRingPlaneSelected(planeOpt.id);
                this.renderInspector(app.editor.selectedParts());
              },
            }, t(planeOpt.label)))));

          const riders = app.editor.rig.nodes.get(part.id)?.ring?.members?.length ?? 0;
          rows.push(h('div', { class: 'stat' },
            h('span', { class: 'k' }, t('回るパーツ')),
            h('span', { class: `v ${riders ? 'good' : 'warn'}` }, `${riders}`)));

          // Zero riders is the one state that reads as "broken", so it says
          // what would fix it instead of just showing a 0.
          if (!riders) {
            rows.push(h('div', { class: 'inspector-empty warn' },
              t('線の上にパーツがありません。よくある原因は4つ:'),
              h('br'), t('① 円線の向きが違う（上のボタンで変える）'),
              h('br'), t('② 円の'), h('b', {}, t('中')), t('に置いてある（線の上に動かすか半径を合わせる）'),
              h('br'), t('③ 線から'), h('b', {}, t('軸の方向に離れている')),
              t('（半径は合っていても、線の高さから外れていると乗りません）'),
              h('br'), t('④ 回したいパーツが、プレートより先の'),
              h('b', {}, t('関節にぶら下がっている')),
              t('（関節から先は、その関節が動かすので巻き取りません）'),
              h('br'), t('パーツを先に置いてからプレートを貼ると、'),
              h('b', {}, t('半径はそれに合わせて決まります')), '。'));
          }

          rows.push(h('div', { class: 'note' },
            t('円線に触れているパーツが回ります。'),
            h('br'), t('円の中に置いただけ・線から高さがずれているものは回りません。'),
            h('br'), t('線の上に立っていれば、足元が触れているので、'),
            h('br'), t('高く伸びたパーツもまるごと一緒に回ります。'),
            h('br'), t('円線は編集画面だけの表示です（左パネルで消せます）。')));
        } else {
          rows.push(h('div', { class: 'note' },
            t('貼った面の向きが回転軸。')));
        }
        if (parent?.kind === 'bone' && !meta.ring) {
          rows.push(h('div', { class: 'inspector-empty warn' },
            t('ボーンに貼っても回りません。ブロックに貼ってください。')));
        } else if (part.parent === app.assembly.rootId) {
          rows.push(h('div', { class: 'inspector-empty warn' },
            t('コアは回せません（機体ごと回ってしまうため）。')));
        }
      }

      rows.push(h('h3', { class: 'inline' }, t('弾の色')));
      if (meta.colorable) {
        rows.push(h('div', { class: 'palette' },
          ...BULLET_COLORS.map((hex) => h('button', {
            class: `swatch${part.bulletColor === hex ? ' active' : ''}`,
            style: `background:${hexToCss(hex)}`,
            title: hexToCss(hex),
            onClick: () => app.setBulletColor(hex),
          }))));
        rows.push(h('label', { class: 'field' },
          h('span', {}, t('自由な色')),
          h('input', {
            type: 'color', value: hexToCss(part.bulletColor ?? meta.bullet),
            onInput: (ev) => app.setBulletColor(parseInt(ev.target.value.slice(1), 16)),
          })));
      } else {
        rows.push(h('div', { class: 'inspector-empty' },
          t('{0}は弾の色を変えられません。', [t(meta.label)])));
      }
    } else {
      rows.push(h('h3', { class: 'inline' }, t('寸法')));
      rows.push(vectorField(t('数値'), part.size, SIZE_STEP,
        (v) => app.editor.resizeSelected(v)));
      rows.push(h('div', { class: 'row tight' },
        h('button', { onClick: () => app.editor.scaleSelected(1.1) }, '× 1.1'),
        h('button', { onClick: () => app.editor.scaleSelected(1 / 1.1) }, '÷ 1.1'),
      ));
      ['X', 'Y', 'Z'].forEach((axis, i) => {
        rows.push(slider(axis, {
          min: SIZE_MIN, max: SIZE_MAX, step: SIZE_STEP, value: part.size[i], fixed: 2,
        }, (v) => {
          const next = part.size.slice();
          next[i] = v;
          app.editor.resizeSelected(next);
        }));
      });
      rows.push(h('div', { class: 'row tight' },
        h('button', { onClick: () => app.uniformSize(1) }, '1.0'),
        h('button', { onClick: () => app.uniformSize(2) }, '2.0'),
        h('button', { onClick: () => app.uniformSize(0.5) }, '0.5'),
      ));

      // Twenty buttons is most of the panel's height, and a block's shape is
      // settled long before its size is. Say what it IS, and open the rack
      // on request.
      const now = part.shape ?? SHAPE_DEFAULT;
      const label = (open) => t('形: {0} {1}', [SHAPES[now]?.label ?? now, open ? '▴' : '▾']);
      const shapeGrid = h('div', { class: 'collapsed' },
        ...this._shapeGrid(
          () => now,
          (id) => {
            app.editor.setBlockShapeSelected(id);
            this.renderInspector(app.editor.selectedParts());
          },
        ),

      );
      const shapeBtn = h('button', { class: 'ghost wide' }, label(false));
      shapeBtn.addEventListener('click', () => {
        shapeBtn.textContent = label(!shapeGrid.classList.toggle('collapsed'));
      });
      rows.push(h('h3', { class: 'inline' }, t('形')), shapeBtn, shapeGrid);

      rows.push(h('h3', { class: 'inline' }, t('中身')));
      const vox = part.vox;
      rows.push(h('div', { class: 'stat' },
        h('span', { class: 'k' }, `1/${vox.n}`),
        h('span', { class: 'v' }, t('{0}% 充填', [Math.round((vox.solid / vox.total) * 100)]))));
      rows.push(h('div', { class: 'meter' }, h('i', { style: `width:${(vox.solid / vox.total) * 100}%` })));
      rows.push(h('div', { class: 'row tight' },
        h('button', { onClick: () => app.fillSelected() }, t('全埋め')),
        h('button', { onClick: () => app.bevelSelected() }, t('角落とし')),
        h('button', { onClick: () => app.repaintSelected() }, t('全塗り')),
      ));
    }

    if (!isCore) {
      rows.push(h('div', { class: 'row tight', style: 'margin-top:8px' },
        h('button', { onClick: () => app.editor.duplicateSelected() }, t('複製')),
        h('button', {
          class: 'danger',
          onClick: () => app.editor.deleteSelected(),
        }, (() => {
          // Say what goes WITH it. Deleting one block takes everything
          // standing on it, and the outline only ever drew the one.
          const n = app.editor.doomedCount();
          return n > 1 ? t('削除 {0}個 (Del)', [n]) : t('削除 (Del)');
        })()),
      ));
    } else {
      rows.push(h('div', { class: 'inspector-empty', style: 'margin-top:6px' },
        t('コアブロックは削除できません。前面 (+Z) が進行方向です。')));
    }

    return rows;
  }

  /**
   * The custom bone's motion, laid out as "what moves / how / how fast".
   * It used to be three unlabelled sliders and a dropdown; the shape of the
   * motion was invisible until you deployed.
   */
  /**
   * Shoulders, hips and waists without adding bone types.
   *
   * The four attributes say WHAT a bone does; these two say how much of it
   * and when. A shoulder is an arm bone that only takes a little of the
   * swing; a hip is the leg bone at the root of the chain; a waist is a
   * custom bone twisting on Y off the stride.
   */
  /**
   * The 20 shapes, five to a row, grouped the way they are in the table.
   *
   * `current` is a getter rather than a value so the same rows can be reused
   * by the tool panel, which outlives any one selection.
   */
  /** Light up the shape the block tool is armed with. */
  syncBlockShape(shape) {
    for (const [id, btn] of this.newShapeButtons) btn.classList.toggle('active', id === shape);
  }

  _shapeGrid(current, onPick, registry = null) {
    const now = current();
    return SHAPE_GROUPS.map((row) => h('div', { class: 'shapegrid' },
      ...row.ids.map((id) => {
        const btn = h('button', {
          class: id === now ? 'active' : '',
          title: `${t(SHAPES[id].group)} / ${t(SHAPES[id].label)}`,
          onClick: () => onPick(id),
        }, t(SHAPES[id].label));
        registry?.set(id, btn);
        return btn;
      }),
    ));
  }

  /**
   * How far the joint goes, and what happens when it gets there.
   *
   * A joint used to be one number: a cone, as far back as forward. A knee
   * bends one way and there was no way to say so, so every knee in the game
   * could hyperextend exactly as far as it could bend.
   */
  _boneTravel(part) {
    const app = this.app;
    const set = (patch) => app.editor.setBoneTravelSelected(patch);
    const redraw = () => this.renderInspector(app.editor.selectedParts());
    const rows = [h('h3', { class: 'inline' }, t('可動域'))];

    const even = (part.limitBack ?? null) === null;
    rows.push(slider(t('前へ'), {
      min: 0, max: 170, step: 5, value: part.limit, unit: '°',
    }, (v) => set({ limit: v })));
    rows.push(h('label', { class: 'checkline' },
      h('input', {
        type: 'checkbox', ...(even ? { checked: 'checked' } : {}),
        onChange: (ev) => { set({ limitBack: ev.target.checked ? null : part.limit }); redraw(); },
      }), t('前後おなじ')));
    if (!even) {
      rows.push(slider(t('後ろへ'), {
        min: 0, max: 170, step: 5, value: part.limitBack, unit: '°',
      }, (v) => set({ limitBack: v })));
    }

    rows.push(h('div', { class: 'row tight' },
      ...LIMIT_MODES.map(([id, label]) => h('button', {
        class: (part.limitMode ?? 'clamp') === id ? 'active' : '',
        onClick: () => { set({ limitMode: id }); redraw(); },
      }, t(label)))));

    rows.push(h('label', { class: 'checkline' },
      h('input', {
        type: 'checkbox', ...(part.hinge ? { checked: 'checked' } : {}),
        onChange: (ev) => set({ hinge: ev.target.checked }),
      }), t('1軸だけ動く')));

    // What it is actually reaching, as opposed to what it is allowed to.
    // The arc drawn round a joint is the setting; whether the motion under
    // it ever gets there was not knowable from looking.
    const reach = app.editor.boneReach(part.id);
    if (reach > 0) {
      rows.push(h('div', { class: 'stat' },
        h('span', { class: 'k' }, t('実測')),
        h('span', { class: 'v' }, reach + '° / ' + part.limit + '°')));
    }

    rows.push(h('h3', { class: 'inline' }, t('追従')));
    rows.push(slider(t('なじみ'), {
      min: 0, max: 0.6, step: 0.02, value: part.follow?.ease ?? 0, fixed: 2, unit: t(' 秒'),
    }, (v) => set({ follow: { ease: v } })));
    rows.push(slider(t('ゆれ戻り'), {
      min: 0.2, max: 1, step: 0.05, value: part.follow?.damping ?? 1, fixed: 2,
    }, (v) => set({ follow: { damping: v } })));
    rows.push(slider(t('先へ伝わる量'), {
      min: 0, max: 1, step: 0.05, value: part.chain ?? CHAIN_FALLOFF_DEFAULT, fixed: 2,
    }, (v) => set({ chain: v })));

    return rows;
  }

  /**
   * One bone driven by another, as a fraction of its angle.
   *
   * A mechanical linkage: armour that opens as the joint under it bends, a
   * counterweight that swings the other way.
   */
  _boneLink(part) {
    const app = this.app;
    const redraw = () => this.renderInspector(app.editor.selectedParts());
    const others = [];
    app.assembly.walk((p) => {
      if (p.kind === 'bone' && p.id !== part.id) others.push(p);
    });
    if (!others.length) return [];

    const rows = [h('h3', { class: 'inline' }, t('連動'))];
    rows.push(h('select', {
      onChange: (ev) => {
        const to = ev.target.value;
        app.editor.setBoneTravelSelected({
          link: to ? { to, ratio: part.link?.ratio ?? 1 } : null,
        });
        redraw();
      },
    },
    h('option', { value: '', ...(part.link?.to ? {} : { selected: 'selected' }) }, t('なし')),
    ...others.map((p) => h('option', {
      value: p.id, ...(part.link?.to === p.id ? { selected: 'selected' } : {}),
    }, t(BONE_META[p.boneType].label) + ' ' + p.id))));

    if (part.link?.to) {
      rows.push(slider(t('比率'), {
        min: -1.5, max: 1.5, step: 0.05, value: part.link.ratio ?? 1, fixed: 2,
      }, (v) => app.editor.setBoneTravelSelected({ link: { to: part.link.to, ratio: v } })));
    }
    return rows;
  }

  /**
   * The weapon bone: the stance a machine takes for the gun in its hands.
   *
   * Bound to a weapon TYPE rather than to a rack position, because a rack
   * position changes the moment another plate is fitted — and "the arm that
   * raises for the sniper" should stay that arm for ever.
   */
  _weaponMotion(part) {
    const app = this.app;
    const w = part.weapon ?? {};
    const set = (patch) => app.editor.setWeaponMotionSelected(patch);
    const redraw = () => this.renderInspector(app.editor.selectedParts());
    const rows = [h('h3', { class: 'inline' }, t('構える武器'))];

    rows.push(h('select', { onChange: (ev) => { set({ when: ev.target.value }); redraw(); } },
      h('option', { value: 'any', ...(w.when === 'any' ? { selected: 'selected' } : {}) }, t('どれでも')),
      ...WEAPON_TYPES.map((kind) => h('option', {
        value: kind, ...(w.when === kind ? { selected: 'selected' } : {}),
      }, t(EQUIP_META[kind].label)))));

    rows.push(h('div', { class: 'row tight' },
      ...['x', 'y', 'z'].map((ax) => h('button', {
        class: (w.axis ?? 'x') === ax ? 'active' : '',
        onClick: () => { set({ axis: ax }); redraw(); },
      }, { x: t('前後'), y: t('ひねり'), z: t('上下') }[ax]))));

    rows.push(slider(t('しまう角度'), {
      min: -170, max: 170, step: 5, value: w.stowed ?? 0, unit: '°',
    }, (v) => set({ stowed: v })));
    rows.push(slider(t('構える角度'), {
      min: -170, max: 170, step: 5, value: w.deployed ?? -60, unit: '°',
    }, (v) => set({ deployed: v })));
    rows.push(slider(t('速さ'), {
      min: 0.5, max: 12, step: 0.1, value: w.speed ?? 3.2, fixed: 1,
    }, (v) => set({ speed: v })));
    rows.push(slider(t('行き過ぎ'), {
      min: 0, max: 0.9, step: 0.05, value: w.overshoot ?? 0, fixed: 2,
    }, (v) => set({ overshoot: v })));

    return rows;
  }

  /**
   * The bench, pretending.
   *
   * A machine on the workbench stands still with full hit points, full
   * energy and nothing in its hands, so every drive except the clock read
   * zero: a bone set to move with speed, with boost or with damage did not
   * move at all while you were setting it up, and every slider above this
   * was a guess.
   */
  _bonePreview(part) {
    const app = this.app;
    const ed = app.editor;
    const redraw = () => this.renderInspector(ed.selectedParts());
    const rows = [h('h3', { class: 'inline' }, t('動作テスト'))];

    rows.push(slider(t('走らせる'), {
      min: 0, max: 1, step: 0.05, value: ed.bonePreview.run, fixed: 2,
    }, (v) => ed.setBonePreview({ run: v })));
    rows.push(h('div', { class: 'row tight' },
      h('button', { onClick: () => ed.setBonePreview({ fire: true }) }, t('撃つ')),
      h('button', {
        class: ed.bonePreview.solo ? 'active' : '',
        onClick: () => { ed.setBonePreview({ solo: !ed.bonePreview.solo }); redraw(); },
      }, t('選択中だけ')),
    ));

    if (part.boneType === 'weapon') {
      rows.push(h('select', {
        onChange: (ev) => ed.setBonePreview({ weapon: ev.target.value || null }),
      },
      h('option', { value: '' }, t('武器なし')),
      ...WEAPON_TYPES.map((kind) => h('option', {
        value: kind, ...(ed.bonePreview.weapon === kind ? { selected: 'selected' } : {}),
      }, t(EQUIP_META[kind].label)))));
    }

    rows.push(h('button', {
      class: 'ghost wide',
      title: t('反対側の同じボーンに、この設定をそのまま写します'),
      onClick: () => ed.copyBoneSettingsToTwin(),
    }, t('反対側にも同じ設定')));
    rows.push(h('div', { class: 'row tight' },
      h('button', { onClick: () => ed.scaleChainGainSelected(0.8) }, t('先まで弱く')),
      h('button', { onClick: () => ed.scaleChainGainSelected(1.25) }, t('先まで強く')),
    ));

    return rows;
  }

  _boneMotion(part) {
    const app = this.app;
    const redraw = () => this.renderInspector(app.editor.selectedParts());
    const rows = [h('h3', { class: 'inline' }, t('関節の効き'))];

    rows.push(slider(t('効き'), {
      min: 0, max: BONE_GAIN_MAX, step: 0.05, value: part.gain ?? 1, fixed: 2,
    }, (v) => app.editor.setBoneMotionSelected({ gain: v })));
    rows.push(slider(t('ずらし'), {
      min: 0, max: BONE_LAG_MAX, step: 0.05, value: part.lag ?? 0, fixed: 2,
    }, (v) => app.editor.setBoneMotionSelected({ lag: v })));

    const recipe = (label, title, motion) => h('button', {
      title, onClick: () => app.editor.setBoneMotionSelected(motion),
    }, label);
    rows.push(h('div', { class: 'row tight' },
      recipe(t('肩'), t('アームの根元。振りを抑えて、腕全体の付け根らしく'), { gain: 0.4, lag: 0 }),
      recipe(t('股関節'), t('レッグの根元。しっかり踏み出す'), { gain: 1, lag: 0 }),
      recipe(t('しなり'), t('ひと呼吸遅れて追従。先端側に付けるとムチのように動く'), { gain: 0.8, lag: 0.12 }),
      recipe(t('固定'), t('まったく動かさない'), { gain: 0, lag: 0 }),
    ));
    // The travel is part of the joint, not a separate decision: a knee that
    // takes the full swing and can also bend backwards is not a knee.
    const shape = (label, title, patch) => h('button', {
      title, onClick: () => { app.editor.setBoneTravelSelected(patch); redraw(); },
    }, label);
    rows.push(h('div', { class: 'row tight' },
      shape(t('ひざ'), t('片方にだけ深く曲がる'), {
        limit: 130, limitBack: 4, hinge: true, limitMode: 'clamp',
      }),
      shape(t('ひじ'), t('ひざより浅く、同じく片方だけ'), {
        limit: 105, limitBack: 6, hinge: true, limitMode: 'clamp',
      }),
      shape(t('球'), t('前後にも横にも自由'), {
        limit: 70, limitBack: null, hinge: false, limitMode: 'clamp',
      }),
      shape(t('バネ'), t('端まで行くと跳ね返る'), {
        limit: 55, limitBack: null, hinge: false, limitMode: 'bounce',
      }),
    ));



    return rows;
  }

  _customMotion(part) {
    const app = this.app;
    const c = part.custom;
    const rows = [h('h3', { class: 'inline' }, t('カスタム動作'))];

    const redraw = () => this.renderInspector(app.editor.selectedParts());

    rows.push(h('label', { class: 'field' }, h('span', {}, t('軸'))));
    rows.push(h('div', { class: 'row tight' },
      ...['x', 'y', 'z'].map((ax) => h('button', {
        class: c.axis === ax ? 'active' : '',
        onClick: () => { c.axis = ax; redraw(); },
      }, { x: t('前後'), y: t('ひねり'), z: t('上下') }[ax]))));

    rows.push(h('label', { class: 'field' }, h('span', {}, t('動き方'))));
    rows.push(h('div', { class: 'equipgrid' },
      ...Object.entries(CUSTOM_WAVES).map(([k, w]) => h('button', {
        class: c.wave === k ? 'active' : '',
        onClick: () => { c.wave = k; redraw(); },
      }, t(w.label)))));

    const spins = CUSTOM_WAVES[c.wave]?.spins && !c.bounded;
    if (spins) {
      // A propeller ignores both the amplitude and the joint limit, which
      // is right for a propeller and wrong for anything that has to stay
      // inside a machine.
      rows.push(h('label', { class: 'checkline' },
        h('input', {
          type: 'checkbox', ...(c.bounded ? { checked: 'checked' } : {}),
          onChange: (ev) => { c.bounded = ev.target.checked; redraw(); },
        }), t('可動域で止める')));
    } else {
      rows.push(slider(t('振幅'), { min: 0, max: 90, step: 5, value: c.amp, unit: '°' },
        (v) => { c.amp = v; }));
      if (CUSTOM_WAVES[c.wave]?.spins) {
        rows.push(h('label', { class: 'checkline' },
          h('input', {
            type: 'checkbox', checked: 'checked',
            onChange: (ev) => { c.bounded = ev.target.checked; redraw(); },
          }), t('可動域で止める')));
      }
    }

    rows.push(slider(spins ? t('回転速度') : t('速さ'),
      { min: 0, max: 4, step: 0.1, value: c.freq, fixed: 1, unit: spins ? t(' 回転/秒') : ' Hz' },
      (v) => { c.freq = v; }));

    rows.push(slider(t('中心角'), { min: -90, max: 90, step: 5, value: c.offset ?? 0, unit: '°' },
      (v) => { c.offset = v; }));
    // The resting angle itself can move with the drive: a waist that leans
    // forward the faster you go, rather than only twisting harder.
    rows.push(slider(t('中心角も動かす'), {
      min: -1, max: 1, step: 0.05, value: c.offsetGain ?? 0, fixed: 2,
    }, (v) => { c.offsetGain = v; }));
    rows.push(slider(t('位相ずらし'), { min: 0, max: 1, step: 0.05, value: c.phase ?? 0, fixed: 2 },
      (v) => { c.phase = v; }));

    /**
     * A second wave, laid over the first.
     *
     * One wave is either slow and wide or quick and small; it cannot be
     * both, so "sways heavily while trembling" was not expressible at all.
     */
    rows.push(h('h3', { class: 'inline' }, t('重ねる動き')));
    rows.push(slider(t('振幅'), { min: 0, max: 45, step: 1, value: c.amp2 ?? 0, unit: '°' },
      (v) => { c.amp2 = v; redraw(); }));
    if (c.amp2) {
      rows.push(slider(t('速さ'), {
        min: 0, max: 12, step: 0.5, value: c.freq2 ?? 4, fixed: 1, unit: ' Hz',
      }, (v) => { c.freq2 = v; }));
      rows.push(h('div', { class: 'equipgrid' },
        ...Object.entries(CUSTOM_WAVES).map(([k, w]) => h('button', {
          class: (c.wave2 ?? 'sine') === k ? 'active' : '',
          onClick: () => { c.wave2 = k; redraw(); },
        }, t(w.label)))));
    }

    rows.push(h('label', { class: 'field' }, h('span', {}, t('駆動ソース'))));
    rows.push(h('select', { onChange: (ev) => { c.source = ev.target.value; } },
      ...CUSTOM_SOURCES.map(([v, l]) => h('option', {
        value: v, ...(c.source === v ? { selected: 'selected' } : {}),
      }, t(l)))));

    // Ready-made joints. These used to live in the help text as prose, so
    // building a waist meant reading a paragraph and then guessing at five
    // sliders that would produce it.
    const recipe = (label, title, motion) => h('button', {
      title,
      onClick: () => { Object.assign(c, motion); redraw(); },
    }, label);
    rows.push(h('div', { class: 'row tight' },
      recipe(t('腰'), t('歩調に合わせてひねる'), {
        axis: 'y', wave: 'sine', amp: 14, freq: 1, source: 'stride', offsetGain: 0,
      }),
      recipe(t('首'), t('ロックオン中だけゆっくり動く'), {
        axis: 'y', wave: 'sine', amp: 10, freq: 0.4, source: 'aim',
      }),
      recipe(t('尾'), t('走るほど大きく揺れる'), {
        axis: 'x', wave: 'sine', amp: 26, freq: 1.2, source: 'speed', amp2: 6, freq2: 5,
      }),
    ));
    rows.push(h('div', { class: 'row tight' },
      recipe(t('プロペラ'), t('回りっぱなし'), {
        axis: 'y', wave: 'saw', freq: 2, source: 'time', bounded: false,
      }),
      recipe(t('排熱フィン'), t('ENが減るほど開く'), {
        axis: 'x', wave: 'sine', amp: 0, freq: 0, source: 'energy', offsetGain: 1, amp2: 0,
      }),
      recipe(t('反動'), t('撃った瞬間だけ跳ねる'), {
        axis: 'x', wave: 'pulse', amp: 18, freq: 3, source: 'recoil',
      }),
    ));

    return rows;
  }

  // ---------------------------------------------------------- stats

  renderStats(stats) {
    const pct = (v) => `${Math.round(v * 100)}%`;

    // What moved since the last time this was drawn.
    //
    // The numbers changed as you built and never said which way, so whether
    // the last five minutes made the machine better or worse was something
    // you had to have written down beforehand.
    const was = this._lastStats;
    const delta = (key, now) => {
      const before = was?.[key];
      if (before === undefined || Math.abs(now - before) < 0.05) return '';
      return now > before ? 'up' : 'down';
    };
    const cell = (k, v, cls = '') => h('div', { class: 'speccell' },
      h('span', { class: 'k' }, k), h('span', { class: `v ${cls}` }, v));
    this.specStrip.replaceChildren(
      cell(t('質量'), stats.mass.toFixed(1), delta('mass', stats.mass)),
      cell(t('機動'), stats.thrustToMass.toFixed(1),
        delta('thrustToMass', stats.thrustToMass)
        || (stats.agility > 0.55 ? 'good' : stats.agility < 0.22 ? 'warn' : '')),
      cell(t('耐久'), String(Math.round(stats.durability * (1 + (stats.hpBonus ?? 0)))),
        delta('durability', stats.durability)),
      cell(t('脚'), String(stats.legs)),
      // How big the thing is. A builder of robots never said.
      cell(t('全高'), `${(this.app.editor.measure().whole.y).toFixed(1)}m`),
      // Only when there is something to say. A row reading "x1.0" on every
      // machine that has never fitted a tank is a row nobody reads.
      ...((stats.energyCapacity ?? 1) > 1
        ? [cell('EN', `x${stats.energyCapacity.toFixed(2)}`, 'good')] : []),
      // Part count, which is what decides how heavy the editor itself feels.
      cell(t('パーツ'), String(this.app.assembly.parts.size),
        this.app.assembly.parts.size > 220 ? 'warn' : ''),
    );
    this._lastStats = {
      mass: stats.mass, thrustToMass: stats.thrustToMass, durability: stats.durability,
    };

    this.statsEl.replaceChildren(
      // The machine's gait is not named here, and deliberately. Stamping a
      // build with "one leg" / "two legs" / "many" turns something you MADE
      // into something that belongs to a category, and the next thing you
      // do is build toward the label. The leg COUNT is below, because that
      // is a fact about the parts; what it implies, the machine shows you
      // by moving.
      h('div', { class: 'stat' }, h('span', { class: 'k' }, t('質量')),
        h('span', { class: 'v' }, stats.mass.toFixed(2))),
      h('div', { class: 'meter' }, h('i', { style: `width:${stats.weightClass * 100}%` })),

      h('div', { class: 'stat' }, h('span', { class: 'k' }, t('機動性')),
        h('span', { class: `v ${stats.agility > 0.55 ? 'good' : stats.agility < 0.22 ? 'warn' : ''}` },
          stats.thrustToMass.toFixed(1))),
      h('div', { class: 'meter' }, h('i', { style: `width:${stats.agility * 100}%` })),

      h('div', { class: 'stat' }, h('span', { class: 'k' }, t('ブロック')), h('span', { class: 'v' }, stats.blockCount)),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, t('体積')), h('span', { class: 'v' }, stats.volume.toFixed(2))),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, t('密度')), h('span', { class: 'v' }, pct(stats.density))),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, t('推力')), h('span', { class: 'v' }, stats.thrust.toFixed(0))),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, t('慣性')), h('span', { class: 'v' }, stats.inertia.toFixed(1))),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, t('脚 / 腕')),
        h('span', { class: 'v' }, `${stats.legs} / ${stats.arms}`)),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, t('顔 / カスタム')),
        h('span', { class: 'v' }, `${stats.faces} / ${stats.customs}`)),

      h('div', { class: 'stat' }, h('span', { class: 'k' }, t('装備 / 武装')),
        h('span', { class: 'v' }, `${stats.equipCount ?? 0} / ${stats.weaponCount ?? 0}`)),
      this._budgetBars(),
      ...(stats.dashBonus
        ? [h('div', { class: 'stat' }, h('span', { class: 'k' }, t('ダッシュ')),
          h('span', { class: 'v good' }, `+${Math.round(stats.dashBonus * 100)}%`))]
        : []),
      ...(stats.noFly
        ? [h('div', { class: 'stat' }, h('span', { class: 'k' }, t('グラビティ')),
          h('span', { class: 'v warn' }, t('浮遊不可 / 耐久 +{0}%', [Math.round(stats.hpBonus * 100)])))]
        : []),
    );
  }

  /**
   * What the machine is made of, against what it is allowed to be made of.
   *
   * Three bars rather than three numbers. The question this answers is not
   * "how many blocks is that" — it is "have I got room for more", and that
   * is a question about a proportion, which a bar answers at a glance and a
   * fraction makes you do arithmetic for.
   *
   * The bar turns as it fills, so running out is something you see coming
   * rather than something you are told about when a placement is refused.
   */
  _budgetBars() {
    const used = this.app.assembly.usage();
    return h('div', { class: 'budget' },
      ...['block', 'bone', 'equip', 'voxel'].map((kind) => {
        const cap = BUDGET[kind];
        const n = used[kind];
        const frac = Math.min(1, n / cap);
        const tone = frac >= 1 ? 'full' : frac > 0.85 ? 'tight' : '';
        // Seven digits is not a reading. What the sculpting grid costs is
        // worth knowing as a proportion and nothing else — the exact cell
        // count is a number nobody can do anything with.
        const shown = kind === 'voxel'
          ? `${Math.round(frac * 100)}%`
          : `${n}/${cap}`;
        return h('div', {
          class: `budgetrow ${tone}`,
          title: kind === 'voxel'
            ? t('加工グリッド {0}M / {1}M セル', [(n / 1e6).toFixed(2), (cap / 1e6).toFixed(0)])
            : `${t(BUDGET_LABEL[kind])} ${n} / ${cap}`,
        },
        h('span', { class: 'k' }, t(BUDGET_LABEL[kind])),
        h('span', { class: 'budgetbar' },
          h('span', { class: 'budgetfill', style: `width:${(frac * 100).toFixed(1)}%` })),
        h('span', { class: 'v' }, shown));
      }),
    );
  }

  /**
   * The brush, in metres, and how much of the block is left.
   *
   * The bracket keys used to move a slider nobody was looking at, so the
   * feedback for pressing one was nothing. This is the readout they move.
   */
  syncBrush(percent, metres) {
    if (this.brushSlider?.set) this.brushSlider.set(percent);
    const ed = this.app.editor;
    if (this.brushSize) {
      // The brush, and how fine one cell of the grid is — the two lengths
      // that decide whether a cut will land where it is meant to.
      const cell = ed?.cellSize?.() ?? 0;
      this.brushSize.textContent = t('太さ {0}cm', [(metres * 100).toFixed(0)])
        + (cell ? t(' ・ 1マス {0}cm', [(cell * 100).toFixed(1)]) : '');
      // Bigger than the block is a brush that takes the whole thing out in
      // one dab, which reads as the tool being broken.
      const big = !!ed?.brushTooBig?.();
      this.brushSize.classList.toggle('warn', big);
      this.brushSize.title = big ? t('ブラシがブロックより大きくなっています') : '';
    }
    this.syncBlockLeft();
    return this;
  }

  /** How much of the block being carved is still there. */
  syncBlockLeft() {
    if (!this.blockLeft) return this;
    const left = this.app.editor?.blockSolidShare?.() ?? 1;
    this.blockLeft.textContent = t('残り {0}%', [Math.round(left * 100)]);
    this.blockLeft.classList.toggle('warn', left < 0.15);
    return this;
  }

  syncName(name) {
    if (this.app.mode === 'part') this.partNameInput.value = name;
    else this.nameInput.value = name;
  }
}
