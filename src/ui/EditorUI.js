import * as THREE from 'three';
import {
  BONE_META, BONE_GAUGE, VOX_LEVELS,
  SIZE_MIN, SIZE_MAX, SIZE_STEP,
  BONE_LENGTH_MIN, BONE_LENGTH_MAX, BONE_RADIUS_MIN, BONE_RADIUS_MAX,
  EQUIP_META, WEAPON_TYPES, SYSTEM_TYPES,
  EQUIP_SIZE_MIN, EQUIP_SIZE_MAX, EQUIP_SIZE_STEP,
  SPIN_RPM_MIN, SPIN_RPM_MAX, CUSTOM_WAVES, CUSTOM_SOURCES,
  CIRCLE_RADIUS_MIN, CIRCLE_RADIUS_MAX, CIRCLE_RADIUS_STEP, EQUIP,
  RING_PLANES, RING_PLANE_DEFAULT,
  BONE_GAIN_MAX, BONE_LAG_MAX, LIMIT_MODES, CHAIN_FALLOFF_DEFAULT,
} from '../core/constants.js';
import { PRESETS, PRESET_LIST, SIZE_CLASSES } from '../core/Assembly.js';

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
  { tool: TOOL.BONE_FACE, label: BONE_META.face.label, key: 'F', color: '#ff7ba6' },
  { tool: TOOL.BONE_ARM, label: BONE_META.arm.label, key: 'A', color: '#ffc861' },
  { tool: TOOL.BONE_LEG, label: BONE_META.leg.label, key: 'L', color: '#6fe3ff' },
  { tool: TOOL.BONE_CUSTOM, label: BONE_META.custom.label, key: 'C', color: '#b98cff' },
  { tool: TOOL.BONE_WEAPON, label: BONE_META.weapon.label, key: 'W', color: '#8effc9' },
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
  if (p.kind === 'bone') return BONE_META[p.boneType].label;
  if (p.kind === 'equip') return EQUIP_META[p.equipType]?.label ?? p.label;
  return p.label;
}

/**
 * Below this window width the editor's panels fold to the edge.
 *
 * At 900 they were taking 48% of the screen between them, leaving the
 * machine less room than the controls for shaping it.
 */
const PANEL_FOLD_BELOW = 1024;

export class EditorUI {
  /** @param {HTMLElement} root  @param {object} app */
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this._wasNarrow = null;
    this._build();
    this.syncPanelWidth();
    window.addEventListener('resize', () => this.syncPanelWidth());
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
    if (!b) { el.textContent = '重心を出せません'; el.classList.remove('hidden'); return this; }
    const side = Math.abs(b[0]) < 0.05 ? '中央' : (b[0] > 0 ? `右に ${b[0].toFixed(2)}m` : `左に ${(-b[0]).toFixed(2)}m`);
    const fore = Math.abs(b[2]) < 0.05 ? '' : (b[2] > 0 ? ` / 前に ${b[2].toFixed(2)}m` : ` / 後ろに ${(-b[2]).toFixed(2)}m`);
    el.textContent = `重心: 高さ ${b[1].toFixed(2)}m ・ ${side}${fore}`;
    el.classList.remove('hidden');
    return this;
  }

  /** Redraw the kept mixes. */
  renderRecipes(list) {
    const box = this.recipeRow;
    if (!box) return this;
    const app = this.app;
    box.replaceChildren(
      h('button', { title: 'いまの形・寸法・色を覚えます', onClick: () => app.editor.keepRecipe() }, '＋'),
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
    if (hidden) bits.push(`${hidden}個を隠しています`);
    if (locked) bits.push(`${locked}個を固定しています`);
    el.textContent = bits.join(' / ');
    el.classList.toggle('hidden', !bits.length);
    return this;
  }

  /** Say whether there is anything unsaved, next to the machine's name. */
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
      box.replaceChildren(h('div', { class: 'inspector-empty' }, 'まだ何もしていません。'));
      return this;
    }
    box.replaceChildren(...past.slice(-24).reverse().map((entry, i) => h('button', {
      class: 'historyrow',
      onClick: () => { for (let k = 0; k <= i; k++) this.app.undo(); this.renderHistory(); },
    }, h('span', { class: 'k' }, i === 0 ? '直前' : `${i + 1}手前`), entry.label)));
    return this;
  }

  /** Redraw the list of named saves. */
  renderSlots() {
    const box = this.slotList;
    if (!box) return this;
    const list = this.app.slots();
    if (!list.length) {
      box.replaceChildren(h('div', { class: 'inspector-empty' },
        'まだありません。「名前を付けて保存」で残せます。'));
      return this;
    }
    box.replaceChildren(...list.map((entry) => h('div', { class: 'slotrow' },
      h('button', {
        class: 'slotopen', title: new Date(entry.at).toLocaleString(),
        onClick: () => { this.app.openSlot(entry.id); this._closeMenus(); },
      }, entry.name || 'NO NAME'),
      h('button', {
        class: 'danger', title: 'この保存を削除',
        onClick: (e) => { e.stopPropagation(); this.app.deleteSlot(entry.id); },
      }, '×'),
    )));
    return this;
  }

  /**
   * Offer the safety net back, once, on the way in. Only an offer:
   * restoring over the top of what somebody meant to open would be the same
   * mistake in the other direction.
   */
  offerDraft() {
    const d = this.app.draft();
    if (!d || !this.draftBar) return this;
    this.draftWhen.textContent = new Date(d.at).toLocaleString();
    this.draftBar.classList.remove('hidden');
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
    this.dirtyDot = h('span', { class: 'dirtydot hidden', title: '保存していない変更があります' });

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
      h('option', { value: '' }, 'すべて'),
      h('option', { value: 'block' }, 'ブロックだけ'),
      h('option', { value: 'bone' }, 'ボーンだけ'),
      h('option', { value: 'equip' }, '装備プレートだけ'),
      h('option', { value: 'color' }, '選択中と同じ色だけ'),
      h('option', { value: 'picked' }, '選択中のものだけ'),
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
      type: 'search', placeholder: '名前・形で探す', 'aria-label': 'パーツを探す',
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
    this.draftBar = h('div', { id: 'draftbar', class: 'hidden' },
      h('span', {}, '前回の作業が残っています'),
      this.draftWhen,
      h('button', {
        class: 'primary',
        onClick: () => { this.app.restoreDraft(); this.draftBar.classList.add('hidden'); },
      }, '復元する'),
      h('button', {
        onClick: () => { this.app.forgetDraft(); this.draftBar.classList.add('hidden'); },
      }, '破棄'),
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
      class: 'icon', title: '編集の履歴',
      onClick: (e) => { e.stopPropagation(); this._toggleMenu(this.historyMenu); this.renderHistory(); },
    }, '⋮');

    this.presetSelect = h('select', {
      onChange: (e) => { if (e.target.value) { app.loadPreset(e.target.value); e.target.value = ''; } },
    },
      h('option', { value: '' }, 'プリセット…'),
      // Grouped by size, because twenty names in a flat list is a list you
      // scroll rather than read — and size is the first thing anybody wants
      // to choose by.
      ...SIZE_CLASSES.map((size) => h('optgroup', { label: SIZE_LABEL[size] },
        ...PRESET_LIST.filter((p) => p.size === size)
          .map((p) => h('option', { value: p.id }, p.label)))),
      h('optgroup', { label: 'まっさら' }, h('option', { value: 'core' }, 'コアのみ')),
    );

    this.titleBtn = h('button', { class: 'ghost', title: 'タイトルへ', onClick: () => app.goTitle() }, '⌂');
    this.editBtn = h('button', { class: 'active', onClick: () => app.setMode('edit') }, 'EDIT');
    this.soloBtn = h('button', { onClick: () => app.startSolo() }, '⚔ ソロプレイ');
    this.partBtn = h('button', { onClick: () => app.openPartEditor() }, 'パーツ編集');
    this.testBtn = h('button', { class: 'primary', onClick: () => app.setMode('field') }, '▶ TEST FIELD');

    this.undoBtn = h('button', { class: 'icon', title: '元に戻す (Ctrl+Z)', onClick: () => app.undo() }, '↶');
    this.redoBtn = h('button', { class: 'icon', title: 'やり直し (Ctrl+Y)', onClick: () => app.redo() }, '↷');

    this.fileMenu = h('div', { class: 'menupop hidden' },
      h('button', { onClick: () => { app.save(); this._closeMenus(); } }, '保存（上書き）'),
      h('button', {
        onClick: () => {
          const name = window.prompt('名前を付けて保存', app.assembly.name);
          if (name !== null) app.saveAs(name);
          this._closeMenus();
        },
      }, '名前を付けて保存…'),
      h('button', { onClick: () => { app.load(); this._closeMenus(); } }, '上書き保存から読込'),
      h('div', { class: 'k', style: 'padding:6px 8px 2px' }, '保存したもの'),
      this.slotList,
      h('button', { onClick: () => { app.exportJson(); this._closeMenus(); } }, 'ファイルに書き出す'),
      h('button', { onClick: () => { app.importJson(); this._closeMenus(); } }, 'ファイルから読み込む'),
      h('button', { onClick: () => { this.share.show(); this._closeMenus(); } }, 'QRで共有 / 読み込み'),
    );
    this.fileBtn = h('button', {
      onClick: (e) => { e.stopPropagation(); this._toggleMenu(this.fileMenu); this.renderSlots(); },
    }, 'ファイル ▾');

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
        class: 'icon', title: '使い方 (F1)', onClick: () => this.help.toggle(),
      }, '？'),
      h('button', { class: 'icon', title: 'キー設定', onClick: () => this.keyConfig.show() }, '⌨'),
      h('div', { class: 'spacer' }),
      this.titleBtn,
      this.editBtn,
      this.partBtn,
      this.soloBtn,
      this.testBtn,
    );

    // ---------------------------------------------------- part workbench bar
    this.partNameInput = h('input', {
      type: 'text', value: app.partAssembly.name,
      onInput: (e) => { app.partAssembly.name = e.target.value.toUpperCase(); },
    });

    this.partUndoBtn = h('button', { class: 'icon', title: '元に戻す (Ctrl+Z)', onClick: () => app.undo() }, '↶');
    this.partRedoBtn = h('button', { class: 'icon', title: 'やり直し (Ctrl+Y)', onClick: () => app.redo() }, '↷');

    this.partBar = h('div', { id: 'partbar', class: 'hidden' },
      h('div', { class: 'brand' }, 'PART', h('small', {}, 'WORKBENCH')),
      h('div', { class: 'sep' }),
      this.partNameInput,
      h('div', { class: 'sep' }),
      this.partUndoBtn,
      this.partRedoBtn,
      h('div', { class: 'sep' }),
      h('button', { class: 'primary', onClick: () => app.savePart(this.partNameInput.value) }, 'パーツ庫に保存'),
      h('button', { title: 'QRで共有 / 読み込み', onClick: () => this.share.show() }, '⧉ 共有'),
      h('button', { onClick: () => app.newPart() }, '新規'),
      h('div', { class: 'spacer' }),
      h('span', { class: 'note', style: 'margin:0' }, '「パーツ庫」から呼び出せます'),
      h('button', { onClick: () => app.setMode('edit') }, '← メイン編集'),
    );

    // ---------------------------------------------------- left panel
    this.toolButtons = new Map();

    const mkTool = (t) => {
      if (t.group) return h('div', { class: 'toolgroup' }, t.group);
      const btn = h('button', { class: 'toolbtn', onClick: () => app.setTool(t.tool) },
        h('span', { class: 'dot', style: `background:${t.color};color:${t.color}` }),
        h('span', {}, t.label),
        h('span', { class: 'key' }, t.key),
      );
      this.toolButtons.set(t.tool, btn);
      return btn;
    };

    // --- gizmo
    this.gizmoButtons = [
      h('button', { class: 'active', onClick: () => app.setGizmoMode('translate') }, '移動 (T)'),
      h('button', { onClick: () => app.setGizmoMode('rotate') }, '回転 (R)'),
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
      h('option', { value: '' }, '切らない'),
      h('option', { value: 'x' }, '左右で切る'),
      h('option', { value: 'y' }, '上下で切る'),
      h('option', { value: 'z' }, '前後で切る'),
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
        class: 'active', title: '世界の軸で動かす',
        onClick: () => this.setGizmoSpace('world'),
      }, '世界の軸'),
      h('button', {
        title: 'そのパーツ自身の軸で動かす',
        onClick: () => this.setGizmoSpace('local'),
      }, 'パーツの軸'),
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
    this.moveGroup = collapsible('動かす', h('div', { class: 'body' },
      row(...this.gizmoButtons),
      row(...this.spaceButtons),
      h('label', { class: 'checkline' }, this.snapToggle, 'グリッドと角度にスナップ'),
      h('label', { class: 'field' }, h('span', {}, 'グリッド'), this.snapStep),
      h('label', { class: 'field' }, h('span', {}, '角度'), this.turnStep),
      slider('面からの隙間', {
        min: 0, max: 0.3, step: 0.01, value: 0, unit: ' m', fixed: 2,
      }, (v) => { app.editor.placeGap = v; }),
      row(
        btn('中心へ', 'えらんだパーツを機体の中心線に戻します',
          () => app.editor.centreSelected()),
        btn('世界の軸', '親の傾きを打ち消して、世界の軸に揃えます',
          () => app.editor.straightenSelected()),
        btn('その場で反転', 'コピーせず、その場で向きを反転します（⇧F）',
          () => app.editor.flipSelected('x')),
      ),
      row(
        btn('あいだに置く', '最初に選んだ2つの中間に、残りを置きます',
          () => app.editor.centreBetween()),
        btn('面いっぱい', 'ついている面いっぱいの大きさにします',
          () => app.editor.fitToHost()),
      ),
    ));

    // ---- 選ぶ : getting hold of the right parts in the first place
    this.pickGroup = collapsible('選ぶ', h('div', { class: 'body' },
      row(
        btn('全選択', null, () => app.editor.selectAll()),
        btn('配下ごと', '選んだパーツの下にあるもの全部を足します（削除で消えるのと同じ範囲）',
          () => app.editor.selectSubtree()),
        btn('同じ種類', '同じ形のブロック・同じ種類のプレートを全部足します',
          () => app.editor.selectSimilar()),
      ),
      row(
        btn('同じ色', '同じ色のブロックを全部選びます', () => app.editor.selectByColor()),
        btn('反対側', '反対側の相棒に飛びます', () => app.editor.selectTwin()),
        btn('選択を戻す', 'ひとつ前の選択に戻ります', () => app.editor.selectBack()),
      ),
      row(
        btn('最後に置いたもの', '最後に置いたパーツに戻ります',
          () => app.editor.selectLastPlaced()),
        btn('名前を付ける', 'えらんだパーツに名前を付けます', () => this.askName()),
      ),
      h('h3', { class: 'inline' }, 'まとまりとして残す'),
      this.setRow,
      row(btn('今の選択を残す', '選び出すのに手間のかかる組を、名前を付けて残します',
        () => this.keepSelectionSet())),
    ));

    // ---- ふやす : anything that ends with more parts than it started with
    this.growGroup = collapsible('ふやす', h('div', { class: 'body' },
      row(
        btn('コピー', null, () => app.copySelected()),
        btn('切取', null, () => app.copySelected({ cut: true })),
        btn('貼付', 'Shift+V でカーソルの面に貼れます', () => app.pasteClipboard()),
        btn('複製', null, () => app.editor.duplicateSelected()),
      ),
      row(
        btn('左右反転コピー', '選択したパーツを、機体の中心線の反対側にコピーします',
          () => app.editor.mirrorSelected()),
        btn('もう一度', '直前の操作をもう一度（Ctrl+R）', () => app.editor.repeatLast()),
      ),
      h('h3', { class: 'inline' }, '肢をつくる'),
      row(
        btn('脚', null, () => app.editor.addLimb('leg', { segments: 2 })),
        btn('腕', null, () => app.editor.addLimb('arm', { segments: 2, foot: false })),
        btn('脚（3節）', null, () => app.editor.addLimb('leg', { segments: 3 })),
      ),
      h('h3', { class: 'inline' }, '円周にならべる'),
      row(...[4, 6, 8].map((n) => btn(n + '個', null, () => app.editor.repeatAround(n, 'y')))),
      h('h3', { class: 'inline' }, 'つなぐ'),
      row(
        btn('連結 (J)', null, () => app.connectSelected()),
        btn('解除 (⇧J)', null, () => app.disconnectSelected()),
        btn('つなぎ替え', 'クリックしたパーツを新しい連結先にします',
          () => app.editor.beginReparent()),
      ),
    ), { open: false });

    // ---- そろえる : two or more parts, made to agree with each other
    this.alignGroup = collapsible('そろえる', h('div', { class: 'body' },
      ...['x', 'y', 'z'].map((axis) => row(
        h('span', { class: 'k', style: 'width:14px' }, axis.toUpperCase()),
        btn('揃える', '平均の位置へ。いちばん動かす距離が短くなります',
          () => app.editor.arrangeSelected(axis, 'align')),
        btn('手前で', 'いちばん手前のものに合わせます',
          () => app.editor.arrangeSelected(axis, 'min')),
        btn('奥で', 'いちばん奥のものに合わせます',
          () => app.editor.arrangeSelected(axis, 'max')),
        btn('均等', null, () => app.editor.arrangeSelected(axis, 'spread')),
        btn('×4', 'この向きに、自分の幅ぶんずつ繰り返します',
          () => app.editor.repeatSelected(axis, 3)),
      )),
      h('h3', { class: 'inline' }, '基準に合わせる'),
      h('div', { class: 'note' }, '基準は最後に選んだパーツ（水色の枠）。'),
      row(
        btn('傾き', '最後に選んだパーツの傾きを、他の全部に写します',
          () => app.editor.matchRotationSelected()),
        btn('見た目', '最後に選んだブロックの形と色を、他の全部に写します',
          () => app.editor.matchLookSelected()),
        btn('骨の太さ', 'ボーンの長さと太さを、最後に選んだものに揃えます',
          () => app.editor.matchBoneSelected()),
      ),
    ), { open: false });

    // ---- 見る・確かめる : nothing in here changes the machine
    this.viewGroup = collapsible('見る・確かめる', h('div', { class: 'body' },
      row(...[['front', '正面'], ['left', '側面'], ['top', '上'], ['iso', '斜め']]
        .map(([id, label]) => btn(label, null, () => app.editor.setView(id)))),
      h('h3', { class: 'inline' }, '中を見る'),
      h('label', { class: 'field' }, h('span', {}, '断面'), this.sectionAxis),
      this.sectionAt,
      h('label', { class: 'checkline' }, this.seeThrough, '機体を透かす'),
      h('h3', { class: 'inline' }, '隠す・固定'),
      row(
        btn('隠す', null, () => app.editor.hideSelected()),
        btn('選択だけ', null, () => app.editor.isolateSelected()),
        btn('全部出す', null, () => app.editor.showAll()),
      ),
      row(
        btn('固定する', '選んだパーツを、クリックでもギズモでも掴めなくします',
          () => app.editor.lockSelected(true)),
        btn('固定を解除', null, () => app.editor.unlockAll()),
      ),
      this.hiddenNote,
      h('h3', { class: 'inline' }, '調べる'),
      row(
        btn('左右の食い違い', '左右で相方のいないパーツをえらびます',
          () => app.editor.findAsymmetry()),
        btn('埋まったブロック', '他のブロックの中に完全に埋まっているものを探します',
          () => app.editor.findBuried()),
        btn('重心', '重心の位置を出します', () => this.showBalance()),
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
    this.newSizeSliders = ['X', 'Y', 'Z'].map((axis, i) => slider(`幅 ${axis}`, {
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
      h('h3', { class: 'inline' }, '形'),
      ...this._shapeGrid(
        () => app.editor.newBlockShape,
        (id) => app.setNewBlockShape(id),
        this.newShapeButtons,
      ),
      h('div', { class: 'note' },
        h('b', {}, 'R'), ' 向き　', h('b', {}, 'Shift+ホイール'), ' 高さ　',
        h('b', {}, 'ドラッグ'), ' 連続配置',
        h('br'), h('b', {}, 'Alt+クリック'), ' 写す　', h('b', {}, '右クリック'), ' 削除'),
      h('h3', { class: 'inline' }, '空中の高さ'),
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
      h('h3', { class: 'inline' }, 'よく使う組み合わせ'),
      this.recipeRow,
      h('h3', { class: 'inline' }, '寸法'),
      h('label', { class: 'checkline' }, this.sizeLinked, '縦横高さを揃える'),
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
      const btn = h('button', {
        class: 'equipbtn',
        title: meta.blurb,
        onClick: () => app.setEquipType(type),
      },
      h('span', { class: `equipicon ${meta.category === 'weapon' ? 'round' : 'square'}`,
        style: `background:${hexToCss(meta.accent)}` }),
      h('span', {}, meta.label));
      this.equipButtons.set(type, btn);
      return btn;
    };

    this.equipSize = slider('プレート径', {
      min: EQUIP_SIZE_MIN, max: EQUIP_SIZE_MAX, step: EQUIP_SIZE_STEP,
      value: app.editor.newEquipSize, fixed: 2,
    }, (v) => app.setNewEquipSize(v));

    this.equipHint = h('div', { class: 'note' }, EQUIP_META[app.editor.equipType].blurb);

    this.equipBox = h('div', {},
      h('div', { class: 'equipgrid' }, ...WEAPON_TYPES.map(mkEquip)),
      h('div', { class: 'equipgrid' }, ...SYSTEM_TYPES.map(mkEquip)),
      this.equipSize,
      this.equipHint,
    );

    // --- new bone shape
    this.boneLen = slider('長さ', {
      min: BONE_LENGTH_MIN, max: BONE_LENGTH_MAX, step: 0.25, value: app.editor.boneOpts.length, fixed: 2,
    }, (v) => { app.editor.boneOpts.length = v; app.applyBoneOptionToSelection('length', v); });

    this.boneRadius = slider('太さ', {
      min: BONE_RADIUS_MIN, max: BONE_RADIUS_MAX, step: 0.01, value: app.editor.boneOpts.radius, fixed: 2,
    }, (v) => { app.editor.boneOpts.radius = v; app.applyBoneOptionToSelection('radius', v); });

    this.gaugeRow = h('div', { class: 'row tight' },
      ...Object.entries(BONE_GAUGE).map(([k, g]) => h('button', {
        onClick: () => {
          app.editor.boneOpts.radius = g.radius;
          this.boneRadius.set(g.radius);
          app.applyBoneOptionToSelection('radius', g.radius);
        },
      }, g.label)),
    );

    this.boneLimit = slider('可動域', {
      min: 10, max: 170, step: 5, value: app.editor.boneOpts.limit, unit: '°',
    }, (v) => { app.editor.boneOpts.limit = v; app.applyBoneOptionToSelection('limit', v); });

    this.boneBox = h('div', {}, this.boneLen, this.gaugeRow, this.boneRadius, this.boneLimit);

    // --- sculpt
    this.brushSlider = slider('ブラシ', {
      min: 1, max: 25, step: 1, value: app.editor.brushPercent, unit: '%',
    }, (v) => { app.editor.brushPercent = v; });

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

    this.sculptBox = h('div', {},
      this.brushSlider,
      h('label', { class: 'checkline' }, this.brushShape, '丸いブラシ'),
      h('label', { class: 'checkline' }, this.sculptMirror, '左右対称に削る'),
      h('label', { class: 'field' }, h('span', {}, '加工の細かさ')),
      this.resSelect,
      h('div', { class: 'note' }, '細かいほど重くなります。'),
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
    this.blockSection = toolSection('新規ブロック寸法', this.blockBox);
    this.equipSection = toolSection('装備プレート', this.equipBox);
    this.boneSection = toolSection('新規ボーン寸法', this.boneBox);
    this.sculptSection = toolSection('加工設定', this.sculptBox);
    this.stampSection = toolSection('パーツ配置',
      h('div', { class: 'note' }, '「パーツ庫」の ＜配置＞ で選びます。'));

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
    this.selectSection = toolSection('選択ツール',
      h('div', { class: 'note' }, 'クリックで選択、ドラッグで移動。'));
    this.toolSections.unshift(this.selectSection);

    // The sculpting tools start folded: they are the advanced half, and
    // three more buttons is three more rows between you and everything else.
    this.sculptTools = collapsible('加工 (上級)',
      h('div', { class: 'body' }, ...SCULPT_LIST.map(mkTool)), { open: false });

    // Rides over the viewport, next to the cursor, out of the way of the
    // pointer itself.
    this.placeHint = h('div', { class: 'placehint hidden' });
    this.root.append(this.placeHint);
    this.root.append(this.draftBar);
    this.root.append(this.marquee);
    // A click anywhere else puts the menus away.
    document.addEventListener('pointerdown', () => this._closeMenus());

    this.leftScroll = h('div', { class: 'panelscroll' });
    this.leftPanel = resizable(
      h('div', { class: 'panel', id: 'leftpanel' },
        append(this.leftScroll,
          h('h3', {}, '組み立て'),
          h('div', { class: 'body' }, ...ASSEMBLE_TOOLS.map(mkTool)),
          this.sculptTools,
          h('h3', {}, 'ツール設定'),
          h('div', { class: 'body' },
            ...this.toolSections,
            h('label', { class: 'checkline' }, this.symmetryToggle, '左右対称でつける'),
            h('label', { class: 'checkline' }, this.previewToggle, '歩行プレビュー'),
            h('label', { class: 'checkline' }, this.ringGuideToggle, 'サークルの円線を表示'),
          ),
          // Everything you can do to what is already there, in five groups
          // named after what you are trying to do. Always available: none of
          // it depends on which tool is in hand.
          h('h3', {}, '編集'),
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
        this.wheelToggle.textContent = open ? 'カラーサークル ▾' : 'カラーサークル ▴';
        if (!open) this.wheel.redraw();
      },
    }, 'カラーサークル ▾');

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
    this.librarySection = collapsible('パーツ庫', this.libraryEl, { open: false });

    // Anchored to the right, so its width grip is on the LEFT edge: that is
    // the side that actually moves when the panel gets wider.
    this.treeEl = h('div', { class: 'tree' });
    this.treeCount = h('span', { class: 'note', style: 'margin:0' }, '0');
    this.treeSection = collapsible(
      'パーツ一覧',
      h('div', { class: 'body' },
        h('div', { class: 'row tight' },
          h('span', { class: 'note', style: 'margin:0' }, '見えない所のパーツもここから'),
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
          collapsible('色', h('div', { class: 'body' },
            this.paletteEl,
            h('h3', { class: 'inline' }, '最近使った色'),
            this.recentEl,
            h('h3', { class: 'inline' }, 'カスタム色'),
            this.customEl,
            this.wheelToggle,
            this.wheelWrap,
          )),
          collapsible('インスペクタ', this.inspectorEl),
          collapsible('スペック', this.statsEl, { open: false }),
        ),
      ),
      { key: 'rightpanel', edges: 'ws', minW: 186 },
    );

    // ---------------------------------------------------- hints
    this.hint = h('div', { id: 'hint' },
      h('span', {}, h('b', {}, '左ドラッグ'), '回転'),
      h('span', {}, h('b', {}, '右ドラッグ'), '平行移動'),
      h('span', {}, h('b', {}, 'クリック'), '設置 / 選択'),
      h('span', {}, h('b', {}, 'Ctrl+click'), '複数選択'),
      h('span', {}, h('b', {}, '同じ所を再クリック'), '奥のパーツ'),
      h('span', {}, h('b', {}, '. / Home'), '選択に寄る / 全体'),
      h('span', {}, h('b', {}, 'T / R'), 'ギズモ'),
      h('span', {}, h('b', {}, 'J'), '連結'),
      h('span', {}, h('b', {}, 'Ctrl+Z'), '元に戻す'),
      h('span', {}, h('b', {}, 'Ctrl+C/V'), 'コピー'),
      h('span', {}, h('b', {}, 'Del'), '削除'),
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
      class: 'panelfold', title: 'パネルを開く / たたむ',
      onClick: () => this.leftPanel.classList.toggle('folded'),
    }, '▸');
    this.rightTab = h('button', {
      class: 'panelfold right', title: 'パネルを開く / たたむ',
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
      h('button', { onClick: () => this.keyConfig.show() }, 'キー設定'),
      h('button', { onClick: () => this.help.show('field') }, '使い方'),
    );
    // The legend does not count down any more: it stays up. Anything that
    // needs OPERATING — the arena, the ceasefire — is on the pause menu,
    // where the pointer is free and nothing is trying to shoot you.

    this.pauseRestartBtn = h('button', {
      class: 'wide', onClick: () => app.restartField(),
    }, '⟲ リスポーン');

    // The same two settings again, where somebody who is losing will look
    // for them. A field switch mid-fight is a legitimate thing to want.
    this.pauseArena = h('select', {
      onChange: (e) => app.setArena(e.target.value),
    }, ...ARENA_ORDER.map((id) => h('option', { value: id }, ARENAS[id].label)));
    this.pauseCeasefire = h('label', { class: 'checkline' },
      h('input', {
        type: 'checkbox',
        onChange: (e) => app.setEnemyFire(!e.target.checked),
      }), '敵に撃たせない');

    this.pauseMenu = h('div', { id: 'pause', class: 'hidden' },
      h('div', { class: 'pausebox' },
        h('div', { class: 'pausetitle' }, 'PAUSED'),
        h('div', { class: 'pausesub' }, 'ESC で再開'),
        h('button', { class: 'primary wide', onClick: () => app.resumeField() }, '▶ 再開する'),
        this.pauseRestartBtn,
        // Only where they mean something.
        //
        // A run walks its own ladder of places, so choosing one is choosing
        // which to skip; and a run where nothing shoots is not a run. Both
        // go away rather than sitting there refusing — a control that
        // cannot be moved is still a question the player has to answer.
        this.pauseSettings = h('div', { class: 'pausefield' },
          h('label', { class: 'field' }, h('span', {}, '場所'), this.pauseArena),
          this.pauseCeasefire,
        ),
        h('button', { class: 'wide', onClick: () => this.keyConfig.show() }, '⌨ キー設定'),
        h('button', { class: 'wide', onClick: () => this.help.show('field') }, '？ 使い方'),
        // Nor this, mid-run: the editor rebuilds the machine the run is
        // being fought with, and there is no coming back to the wave you
        // left. Leaving is what タイトルへ is for.
        this.pauseEditBtn = h('button', {
          class: 'wide', onClick: () => app.setMode('edit'),
        }, '← 編集画面に戻る'),
        h('button', { class: 'wide', onClick: () => app.goTitle() }, '⌂ タイトルへ'),
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
    this.result = new ResultScreen(app);

    this.root.append(
      this.topbar, this.partBar, this.leftPanel, this.rightPanel, this.hint,
      this.leftTab, this.rightTab,
      this.fieldBar, this.pauseMenu, this.keyConfig.el, this.share.el,
      this.help.el, this.title.el, this.sortie.el, this.result.el, this.toast,
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
      pair(k('fire'), '武器を撃つ'),
      pair(`${k('weaponNext')} / ${k('weaponPrev')}`, '武器切替'),
      pair(k('lock'), 'ロックオン'),
      pair(k('cycleTarget'), 'ターゲット切替'),
    );
    this.fieldMoveHint.replaceChildren(
      pair(`${k('forward')}${k('left')}${k('back')}${k('right')}`, '移動（2回押しでダッシュ）'),
      pair(k('up'), '上昇・跳躍'),
      pair(k('down'), '下降'),
      pair(k('boost'), 'ブースト'),
      pair(`${k('layerA')}·${k('layerB')}·${k('layerC')}`, 'ABC'),
      pair(k('reset'), 'リスポーン'),
      pair(k('camera'), 'カメラ回転（ホイールでズーム）'),
      pair('Esc', 'ポーズ'),
    );
  }

  // ---------------------------------------------------------- sync

  /**
   * Show the settings the current tool actually uses, and hide the rest.
   * Dimming them was not enough: they still took up the panel.
   */
  syncTool(tool) {
    for (const [t, btn] of this.toolButtons) btn.classList.toggle('active', t === tool);
    const isBone = [
      TOOL.BONE_LEG, TOOL.BONE_ARM, TOOL.BONE_FACE, TOOL.BONE_CUSTOM, TOOL.BONE_WEAPON,
    ].includes(tool);
    const isSculpt = [TOOL.CARVE, TOOL.ADD, TOOL.PAINT].includes(tool);

    this.selectSection.setVisible(tool === TOOL.SELECT);
    this.blockSection.setVisible(tool === TOOL.BLOCK);
    this.equipSection.setVisible(tool === TOOL.EQUIP);
    this.boneSection.setVisible(isBone);
    this.sculptSection.setVisible(isSculpt);
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
      btn.title = hist.canUndo ? `元に戻す: ${hist.undoLabel} (Ctrl+Z)` : '元に戻す (Ctrl+Z)';
    }
    for (const btn of [this.redoBtn, this.partRedoBtn]) {
      btn.disabled = !hist.canRedo;
      btn.title = hist.canRedo ? `やり直し: ${hist.redoLabel} (Ctrl+Y)` : 'やり直し (Ctrl+Y)';
    }
  }

  /** The shelf of saved parts, with what you can do to each. */
  renderLibrary() {
    const app = this.app;
    const items = app.library.list();

    if (!items.length) {
      this.libraryEl.replaceChildren(
        h('div', { class: 'inspector-empty' },
          'まだパーツがありません。',
          h('br'), '「パーツ編集」で作るか、選択中のパーツを下のボタンで登録できます。'),
        h('button', {
          class: 'ghost wide', onClick: () => app.saveSelectionAsPart(),
        }, '選択パーツを登録'),
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
          item.builtin ? h('div', { class: 'libtag' }, '最初から入っているパーツ') : null),
        h('div', { class: 'row tight' },
          h('button', { title: 'メイン編集に置く', onClick: () => app.placePart(item.id) }, '配置'),
          h('button', { title: 'パーツ編集で開く', onClick: () => app.openPartEditor(item.id) }, '編集'),
          h('button', {
            class: 'danger', title: 'パーツ庫から削除', onClick: () => app.deletePart(item.id),
          }, '×'),
        ),
      )),
      h('button', {
        class: 'ghost wide', onClick: () => app.saveSelectionAsPart(),
      }, '選択パーツを登録'),
    );
  }

  /** Highlight the armed plate, and say what it does. */
  syncEquipType(type) {
    for (const [t, btn] of this.equipButtons) btn.classList.toggle('active', t === type);
    this.equipHint.textContent = EQUIP_META[type]?.blurb ?? '';
  }

  /**
   * Name what is selected now, so it can be picked again in one click.
   *
   * Picking out "the eight thruster housings" is a minute of careful
   * clicking that the next click throws away.
   */
  keepSelectionSet() {
    if (!this.app.editor.selection.size) { this.toastMsg('残す選択がありません'); return; }
    const name = window.prompt('このまとまりの名前', '');
    if (name === null) return;
    if (this.app.editor.keepSelection(name)) this.toastMsg(`「${name}」として残しました`);
  }

  /** Draw one button per saved selection, plus a way to forget one. */
  renderSelectionSets(names) {
    const app = this.app;
    this.setRow.replaceChildren(
      ...(names ?? []).map((name) => h('button', {
        title: `${name} を選び直す（右クリックで削除）`,
        onClick: () => app.editor.useSelection(name),
        onContextmenu: (e) => { e.preventDefault(); app.editor.dropSelection(name); },
      }, name)),
      ...(names?.length ? [] : [h('span', { class: 'note', style: 'margin:0' }, 'まだありません')]),
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
    if (!parts.length) { this.toastMsg('名前を付けるパーツを選んでください'); return; }
    const now = parts.length === 1 ? (parts[0].label ?? '') : '';
    const next = window.prompt('パーツの名前', now);
    if (next === null) return;
    const n = this.app.editor.renameSelected(next);
    if (n) { this.renderTree(); this.toastMsg(`${n} 個に名前を付けました`); }
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
    this.fieldPlace.textContent = arena.label;
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
      ...STANDARD_COLORS.map((c, i) => mk(pal.get(i), i, i === 0 ? 'コアシルバー' : `標準色 ${i}`)),
    );

    const custom = pal.customEntries();
    this.customEl.replaceChildren(
      ...custom.map((e) => mk(e.hex, e.index, hexToCss(e.hex))),
      ...(custom.length ? [] : [h('div', { class: 'note', style: 'grid-column:1/-1' }, 'まだありません')]),
    );

    // The last few colours actually used, in the order they were used.
    //
    // A scheme is three or four colours out of thirty-odd swatches, and
    // every switch between them was a hunt across two grids — including the
    // switch back to the one used a second ago.
    this.recentEl.replaceChildren(
      ...this.recentColors
        .filter((i) => pal.get(i) !== undefined)
        .map((i) => mk(pal.get(i), i, `最近使った色 ${hexToCss(pal.get(i))}`)),
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
    this.pauseRestartBtn.textContent = isSolo ? '⟲ 最初からやり直す' : '⟲ リスポーン';
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
      core: { icon: '◈', label: 'コア' },
      block: { icon: '▪', label: 'ブロック' },
      bone: { icon: '⌇', label: 'ボーン' },
      equip: { icon: '⬢', label: 'プレート' },
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
      const hay = `${part.label ?? ''} ${shapeName} ${part.kind} ${hex}`.toLowerCase();
      const kindOk = !this.treeKind
        || (this.treeKind === 'picked' ? selected.has(id)
          : this.treeKind === 'color' ? (wantColor !== null
            && part.vox?.dominantColor?.() === wantColor)
          : part.kind === this.treeKind);
      const wanted = kindOk && (!this.treeQuery || hay.includes(this.treeQuery));
      const kind = KIND[part.kind] ?? KIND.block;
      // A name the builder gave it beats the shape it happens to be cut
      // from: "PELVIS" says more about a row than "面取り" ever will.
      const named = part.label && part.label !== 'BLOCK' ? part.label : null;
      const name = part.kind === 'bone'
        ? (BONE_META[part.boneType]?.label ?? 'ボーン')
        : part.kind === 'equip'
          ? (EQUIP_META[part.equipType]?.label ?? 'プレート')
          : part.kind === 'core' ? 'コア'
            : named ?? (SHAPES[part.shape ?? SHAPE_DEFAULT]?.label ?? 'ブロック');

      const row = h('button', {
        class: `treerow${selected.has(id) ? ' active' : ''}`,
        style: `padding-left:${6 + depth * 11}px`,
        // How deep it is, because a part seven levels down takes everything
        // below it when it goes and nothing on screen said so.
        title: `${kind.label} / 第${depth + 1}階層 / ${id}`,
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
        'パーツをクリックで選択、Ctrl+クリックで複数選択。',
        h('br'), 'ギズモを掴めば任意の位置に動かせます（空中に浮かせてもOK）。',
        h('br'), '設置は、面をクリックでぴったり／何もない所をクリックで浮遊配置。'));
      return;
    }

    if (list.length > 1) {
      const anchor = this.app.assembly.get(this.app.editor.anchorId);
      const anchorName = anchor
        ? `${partName(anchor)} (${anchor.id})`
        : '—';

      this.inspectorEl.append(
        h('div', { class: 'tag' }, `${list.length} パーツ選択中`),
        h('div', { class: 'stat' },
          h('span', { class: 'k' }, '連結先'),
          h('span', { class: 'v', style: 'color:var(--accent)' }, anchorName)),

        h('div', { class: 'row tight', style: 'margin-top:6px' },
          h('button', { onClick: () => this.app.connectSelected() }, '連結 (J)'),
          h('button', { onClick: () => this.app.disconnectSelected() }, '解除 (⇧J)'),
        ),
        h('div', { class: 'row tight' },
          h('button', { onClick: () => this.app.editor.duplicateSelected() }, '複製'),
          h('button', { onClick: () => this.app.editor.clearSelection() }, '選択解除'),
        ),
        ...this._bulkEdits(list),
        h('button', {
          class: 'danger wide', style: 'margin-top:8px',
          onClick: () => this.app.editor.deleteSelected(),
        }, `${this.app.editor.doomedCount()} パーツを削除 (Del)`),
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
      rows.push(h('h3', { class: 'inline' }, `寸法 — ${blocks.length} ブロック`));
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
          'えらんだブロックの寸法はばらばらです。下のスライダーは全部を同じ寸法にします。'));
      }
      rows.push(h('div', { class: 'row tight' },
        h('button', {
          title: 'えらんだものを、それぞれの寸法のまま大きくします',
          onClick: () => app.editor.scaleSelected(1.1),
        }, '× 1.1'),
        h('button', { onClick: () => app.editor.scaleSelected(1 / 1.1) }, '÷ 1.1'),
        h('button', {
          title: '最後にえらんだものの寸法に揃えます',
          onClick: () => app.editor.matchSizeSelected(),
        }, '寸法を揃える'),
      ));
      rows.push(...['X', 'Y', 'Z'].map((axis, i) => slider(`幅 ${axis}`, {
        min: SIZE_MIN, max: SIZE_MAX, step: SIZE_STEP, value: base[i], fixed: 2,
      }, (v) => set(i, v))));
      rows.push(vectorField('寸法', base, SIZE_STEP, (v) => {
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
      rows.push(h('label', { class: 'checkline' }, this.keepAspect, '縦横比を保つ'));

      rows.push(h('h3', { class: 'inline' }, '形'));
      rows.push(...this._shapeGrid(() => blocks[0].shape, (id) => app.editor.setBlockShapeSelected(id)));

    }

    if (bones.length) {
      rows.push(h('h3', { class: 'inline' }, `ボーン — ${bones.length} 本`));
      const b = bones[0];
      rows.push(slider('長さ', {
        min: BONE_LENGTH_MIN, max: BONE_LENGTH_MAX, step: 0.25, value: b.length, fixed: 2,
      }, (v) => app.editor.setBoneShapeSelected({ length: v })));
      rows.push(slider('太さ', {
        min: BONE_RADIUS_MIN, max: BONE_RADIUS_MAX, step: 0.01, value: b.radius, fixed: 2,
      }, (v) => app.editor.setBoneShapeSelected({ radius: v })));
      rows.push(slider('可動域', {
        min: 10, max: 170, step: 5, value: b.limit, unit: '°',
      }, (v) => app.editor.setBoneShapeSelected({ limit: v })));
    }

    if (plates.length) {
      rows.push(h('h3', { class: 'inline' }, `プレート — ${plates.length} 枚`));
      rows.push(slider('プレート径', {
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
        + (part.kind === 'bone' ? ` / ${BONE_META[part.boneType].label}` : '')
        + (part.kind === 'equip' ? ` / ${EQUIP_META[part.equipType]?.label ?? part.equipType}` : '')),
    ];

    if (part.mount) {
      rows.push(h('h3', { class: 'inline' }, '位置'));
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
      rows.push(h('div', { class: 'note' }, 'X → Y → Z の順。'));

      // Where it sits on the machine, not on its parent.
      //
      // The fields above are measured against whatever the part hangs off,
      // so the same height on two limbs reads as two different numbers and
      // "are these level?" had no answer anywhere on screen.
      const world = app.editor.machinePosition(part.id);
      if (world) {
        rows.push(h('div', { class: 'stat' },
          h('span', { class: 'k' }, '機体基準'),
          h('span', { class: 'v' }, world.map((n) => n.toFixed(2)).join(' , '))));
      }

      // Which face it is on. Getting this wrong used to mean deleting the
      // part and placing it again, which loses everything carved into it.
      if (part.mount?.face !== undefined) {
        rows.push(h('h3', { class: 'inline' }, 'ついている面'));
        rows.push(h('div', { class: 'row tight wrap' },
          ...[['右', 0], ['左', 1], ['上', 2], ['下', 3], ['前', 4], ['後', 5]]
            .map(([label, face]) => h('button', {
              class: part.mount.face === face ? 'active' : '',
              onClick: () => app.editor.moveToFace(face),
            }, label)),
        ));
      }

      // --- which segment does it ride with?
      rows.push(h('button', {
        class: 'ghost wide',
        title: 'クリックしたパーツを新しい連結先にします',
        onClick: () => app.editor.beginReparent(),
      }, 'クリックでつなぎ替え'));
      const options = [...app.assembly.parts.values()]
        .filter((p) => app.assembly.canReparent(part.id, p.id))
        .map((p) => h('option', {
          value: p.id, ...(p.id === part.parent ? { selected: 'selected' } : {}),
        }, `${partName(p)} (${p.id})`));

      rows.push(h('h3', { class: 'inline' }, '連結先'));
      rows.push(h('select', {
        onChange: (ev) => app.editor.reparentSelected(ev.target.value),
      }, ...options));
      const half = app.editor.boneHalfOf(part.id);
      if (half) {
        rows.push(h('div', { class: 'stat' },
          h('span', { class: 'k' }, 'ボーン'),
          h('span', { class: `v ${half === 'far' ? 'good' : 'warn'}` },
            half === 'far' ? '可動側' : '固定側')));
        rows.push(h('div', { class: 'note' }, half === 'far'
          ? 'この関節から先なので、ボーンと一緒に振れます。'
          : 'ボーンの手前半分なので動きません。中点より先へ動かすと可動側になります。'));
        rows.push(h('div', { class: 'row tight' },
          h('button', { title: 'ボーンの根元へ', onClick: () => app.editor.slideAlongBone(0) }, '根元へ'),
          h('button', { title: '関節の少し先へ', onClick: () => app.editor.slideAlongBone(0.55) }, '可動側へ'),
          h('button', { title: 'ボーンの先端へ', onClick: () => app.editor.slideAlongBone(1) }, '先端へ'),
        ));
      }

      rows.push(h('button', {
        class: 'ghost wide', onClick: () => app.disconnectSelected(),
      }, '連結を解除 (⇧J)'));
    }

    if (part.kind === 'bone') {
      rows.push(h('h3', { class: 'inline' }, '寸法'));
      rows.push(slider('長さ', {
        min: BONE_LENGTH_MIN, max: BONE_LENGTH_MAX, step: 0.25, value: part.length, fixed: 2,
      }, (v) => app.editor.setBoneShapeSelected({ length: v })));
      rows.push(slider('太さ', {
        min: BONE_RADIUS_MIN, max: BONE_RADIUS_MAX, step: 0.01, value: part.radius, fixed: 2,
      }, (v) => app.editor.setBoneShapeSelected({ radius: v })));
      rows.push(h('label', { class: 'checkline' },
        h('input', {
          type: 'checkbox', ...(part.invert ? { checked: 'checked' } : {}),
          onChange: (ev) => { part.invert = ev.target.checked; app.editor.rebuild(); },
        }), '動きを反転'));

      rows.push(h('button', {
        class: 'ghost wide',
        title: '選んだ他のボーンを、このボーンの長さと太さに揃えます',
        onClick: () => app.editor.matchBoneSelected(),
      }, '他のボーンをこれに揃える'));

      rows.push(...this._boneTravel(part));
      rows.push(...this._boneMotion(part));

      rows.push(h('h3', { class: 'inline' }, 'つなげる'));
      rows.push(h('button', {
        class: 'ghost wide',
        title: 'このボーンの先端に、もう1本つなげます',
        onClick: () => app.editor.addBoneOnTipSelected(),
      }, `＋ 先端に${BONE_META[part.boneType].label}`));
      rows.push(...this._boneLink(part));

      if (part.boneType === 'custom') rows.push(...this._customMotion(part));
      if (part.boneType === 'weapon') rows.push(...this._weaponMotion(part));
      if (part.boneType === 'custom' || part.boneType === 'weapon') {
        rows.push(...this._bonePreview(part));
      }
    } else if (part.kind === 'equip') {
      const meta = EQUIP_META[part.equipType];

      rows.push(h('div', { class: 'note' }, meta.blurb));

      rows.push(h('h3', { class: 'inline' }, '種類'));
      const swap = (type) => h('button', {
        class: part.equipType === type ? 'active' : '',
        title: EQUIP_META[type].blurb,
        onClick: () => app.editor.setEquipTypeSelected(type),
      }, EQUIP_META[type].label);
      rows.push(h('div', { class: 'equipgrid' }, ...WEAPON_TYPES.map(swap)));
      rows.push(h('div', { class: 'equipgrid' }, ...SYSTEM_TYPES.map(swap)));

      rows.push(h('h3', { class: 'inline' }, '大きさ'));
      rows.push(slider('径', {
        min: EQUIP_SIZE_MIN, max: EQUIP_SIZE_MAX, step: EQUIP_SIZE_STEP,
        value: part.size, fixed: 2,
      }, (v) => app.editor.setEquipSizeSelected(v)));

      if (meta.category === 'weapon' && meta.ammo) {
        rows.push(h('div', { class: 'stat' },
          h('span', { class: 'k' }, '装弾 / リロード'),
          h('span', { class: 'v' }, `${meta.ammo} 発 / ${meta.reload.toFixed(1)}s`)));
      }
      if (meta.dps) {
        rows.push(h('div', { class: 'stat' },
          h('span', { class: 'k' }, '接触ダメージ'),
          h('span', { class: 'v' }, `${meta.dps}/s`)));
      }

      if (part.spin) {
        const parent = app.assembly.get(part.parent);
        rows.push(h('h3', { class: 'inline' }, '回転'));

        // A gimmick that never stops is a gimmick you cannot build on: the
        // ring carries its riders out from under the cursor. This stops it
        // here and only here — in the field it turns regardless.
        const running = app.editor.gimmickRunning(part.id);
        rows.push(h('div', { class: 'row tight' },
          ...[[true, '動かす'], [false, '止める']].map(([on, label]) => h('button', {
            class: running === on ? 'active' : '',
            onClick: () => {
              app.editor.setGimmickRunning(part.id, on);
              this.renderInspector(app.editor.selectedParts());
            },
          }, label)),
          h('div', { class: 'spacer' }),
          h('span', { class: 'note', style: 'margin:0' }, '編集中だけ'),
        ));
        rows.push(h('div', { class: 'row tight' },
          ...[[1, '正転 ↻'], [-1, '逆転 ↺']].map(([d, label]) => h('button', {
            class: part.spin.dir === d ? 'active' : '',
            onClick: () => {
              app.editor.setEquipSpinSelected({ dir: d });
              this.renderInspector(app.editor.selectedParts());
            },
          }, label))));
        rows.push(slider('速さ', {
          min: SPIN_RPM_MIN, max: SPIN_RPM_MAX, step: 5, value: part.spin.rpm, unit: ' rpm',
        }, (v) => app.editor.setEquipSpinSelected({ rpm: v })));
        if (meta.ring) {
          rows.push(slider('半径', {
            min: CIRCLE_RADIUS_MIN, max: CIRCLE_RADIUS_MAX, step: CIRCLE_RADIUS_STEP,
            value: part.ringRadius, fixed: 2, unit: ' m',
          }, (v) => app.editor.setEquipRingSelected(v)));

          // Which way the circle lies. Without this the answer is decided
          // entirely by which face the plate went on, and a plate on a chest
          // draws its circle standing on edge — where nothing is standing.
          rows.push(h('h3', { class: 'inline' }, '円線の向き'));
          rows.push(h('div', { class: 'row tight' },
            ...RING_PLANES.map((planeOpt) => h('button', {
              class: (part.ringPlane ?? RING_PLANE_DEFAULT) === planeOpt.id ? 'active' : '',
              title: planeOpt.note,
              onClick: () => {
                app.editor.setEquipRingPlaneSelected(planeOpt.id);
                this.renderInspector(app.editor.selectedParts());
              },
            }, planeOpt.label))));

          const riders = app.editor.rig.nodes.get(part.id)?.ring?.members?.length ?? 0;
          rows.push(h('div', { class: 'stat' },
            h('span', { class: 'k' }, '回るパーツ'),
            h('span', { class: `v ${riders ? 'good' : 'warn'}` }, `${riders}`)));

          // Zero riders is the one state that reads as "broken", so it says
          // what would fix it instead of just showing a 0.
          if (!riders) {
            rows.push(h('div', { class: 'inspector-empty warn' },
              '線の上にパーツがありません。よくある原因は4つ:',
              h('br'), '① 円線の向きが違う（上のボタンで変える）',
              h('br'), '② 円の', h('b', {}, '中'), 'に置いてある（線の上に動かすか半径を合わせる）',
              h('br'), '③ 線から', h('b', {}, '軸の方向に離れている'),
              '（半径は合っていても、線の高さから外れていると乗りません）',
              h('br'), '④ 回したいパーツが、プレートより先の',
              h('b', {}, '関節にぶら下がっている'),
              '（関節から先は、その関節が動かすので巻き取りません）',
              h('br'), 'パーツを先に置いてからプレートを貼ると、',
              h('b', {}, '半径はそれに合わせて決まります'), '。'));
          }

          rows.push(h('div', { class: 'note' },
            '円線に触れているパーツが回ります。',
            h('br'), '円の中に置いただけ・線から高さがずれているものは回りません。',
            h('br'), '線の上に立っていれば、足元が触れているので、',
            h('br'), '高く伸びたパーツもまるごと一緒に回ります。',
            h('br'), '円線は編集画面だけの表示です（左パネルで消せます）。'));
        } else {
          rows.push(h('div', { class: 'note' },
            '貼った面の向きが回転軸。'));
        }
        if (parent?.kind === 'bone' && !meta.ring) {
          rows.push(h('div', { class: 'inspector-empty warn' },
            'ボーンに貼っても回りません。ブロックに貼ってください。'));
        } else if (part.parent === app.assembly.rootId) {
          rows.push(h('div', { class: 'inspector-empty warn' },
            'コアは回せません（機体ごと回ってしまうため）。'));
        }
      }

      rows.push(h('h3', { class: 'inline' }, '弾の色'));
      if (meta.colorable) {
        rows.push(h('div', { class: 'palette' },
          ...BULLET_COLORS.map((hex) => h('button', {
            class: `swatch${part.bulletColor === hex ? ' active' : ''}`,
            style: `background:${hexToCss(hex)}`,
            title: hexToCss(hex),
            onClick: () => app.setBulletColor(hex),
          }))));
        rows.push(h('label', { class: 'field' },
          h('span', {}, '自由な色'),
          h('input', {
            type: 'color', value: hexToCss(part.bulletColor ?? meta.bullet),
            onInput: (ev) => app.setBulletColor(parseInt(ev.target.value.slice(1), 16)),
          })));
      } else {
        rows.push(h('div', { class: 'inspector-empty' },
          `${meta.label}は弾の色を変えられません。`));
      }
    } else {
      rows.push(h('h3', { class: 'inline' }, '寸法'));
      rows.push(vectorField('数値', part.size, SIZE_STEP,
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
      const label = (open) => `形: ${SHAPES[now]?.label ?? now} ${open ? '▴' : '▾'}`;
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
      rows.push(h('h3', { class: 'inline' }, '形'), shapeBtn, shapeGrid);

      rows.push(h('h3', { class: 'inline' }, '中身'));
      const vox = part.vox;
      rows.push(h('div', { class: 'stat' },
        h('span', { class: 'k' }, `1/${vox.n}`),
        h('span', { class: 'v' }, `${Math.round((vox.solid / vox.total) * 100)}% 充填`)));
      rows.push(h('div', { class: 'meter' }, h('i', { style: `width:${(vox.solid / vox.total) * 100}%` })));
      rows.push(h('div', { class: 'row tight' },
        h('button', { onClick: () => app.fillSelected() }, '全埋め'),
        h('button', { onClick: () => app.bevelSelected() }, '角落とし'),
        h('button', { onClick: () => app.repaintSelected() }, '全塗り'),
      ));
    }

    if (!isCore) {
      rows.push(h('div', { class: 'row tight', style: 'margin-top:8px' },
        h('button', { onClick: () => app.editor.duplicateSelected() }, '複製'),
        h('button', {
          class: 'danger',
          onClick: () => app.editor.deleteSelected(),
        }, (() => {
          // Say what goes WITH it. Deleting one block takes everything
          // standing on it, and the outline only ever drew the one.
          const n = app.editor.doomedCount();
          return n > 1 ? `削除 ${n}個 (Del)` : '削除 (Del)';
        })()),
      ));
    } else {
      rows.push(h('div', { class: 'inspector-empty', style: 'margin-top:6px' },
        'コアブロックは削除できません。前面 (+Z) が進行方向です。'));
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
          title: `${SHAPES[id].group} / ${SHAPES[id].label}`,
          onClick: () => onPick(id),
        }, SHAPES[id].label);
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
    const rows = [h('h3', { class: 'inline' }, '可動域')];

    const even = (part.limitBack ?? null) === null;
    rows.push(slider('前へ', {
      min: 0, max: 170, step: 5, value: part.limit, unit: '°',
    }, (v) => set({ limit: v })));
    rows.push(h('label', { class: 'checkline' },
      h('input', {
        type: 'checkbox', ...(even ? { checked: 'checked' } : {}),
        onChange: (ev) => { set({ limitBack: ev.target.checked ? null : part.limit }); redraw(); },
      }), '前後おなじ'));
    if (!even) {
      rows.push(slider('後ろへ', {
        min: 0, max: 170, step: 5, value: part.limitBack, unit: '°',
      }, (v) => set({ limitBack: v })));
    }

    rows.push(h('div', { class: 'row tight' },
      ...LIMIT_MODES.map(([id, label]) => h('button', {
        class: (part.limitMode ?? 'clamp') === id ? 'active' : '',
        onClick: () => { set({ limitMode: id }); redraw(); },
      }, label))));

    rows.push(h('label', { class: 'checkline' },
      h('input', {
        type: 'checkbox', ...(part.hinge ? { checked: 'checked' } : {}),
        onChange: (ev) => set({ hinge: ev.target.checked }),
      }), '1軸だけ動く'));

    // What it is actually reaching, as opposed to what it is allowed to.
    // The arc drawn round a joint is the setting; whether the motion under
    // it ever gets there was not knowable from looking.
    const reach = app.editor.boneReach(part.id);
    if (reach > 0) {
      rows.push(h('div', { class: 'stat' },
        h('span', { class: 'k' }, '実測'),
        h('span', { class: 'v' }, reach + '° / ' + part.limit + '°')));
    }

    rows.push(h('h3', { class: 'inline' }, '追従'));
    rows.push(slider('なじみ', {
      min: 0, max: 0.6, step: 0.02, value: part.follow?.ease ?? 0, fixed: 2, unit: ' 秒',
    }, (v) => set({ follow: { ease: v } })));
    rows.push(slider('ゆれ戻り', {
      min: 0.2, max: 1, step: 0.05, value: part.follow?.damping ?? 1, fixed: 2,
    }, (v) => set({ follow: { damping: v } })));
    rows.push(slider('先へ伝わる量', {
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

    const rows = [h('h3', { class: 'inline' }, '連動')];
    rows.push(h('select', {
      onChange: (ev) => {
        const to = ev.target.value;
        app.editor.setBoneTravelSelected({
          link: to ? { to, ratio: part.link?.ratio ?? 1 } : null,
        });
        redraw();
      },
    },
    h('option', { value: '', ...(part.link?.to ? {} : { selected: 'selected' }) }, 'なし'),
    ...others.map((p) => h('option', {
      value: p.id, ...(part.link?.to === p.id ? { selected: 'selected' } : {}),
    }, BONE_META[p.boneType].label + ' ' + p.id))));

    if (part.link?.to) {
      rows.push(slider('比率', {
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
    const rows = [h('h3', { class: 'inline' }, '構える武器')];

    rows.push(h('select', { onChange: (ev) => { set({ when: ev.target.value }); redraw(); } },
      h('option', { value: 'any', ...(w.when === 'any' ? { selected: 'selected' } : {}) }, 'どれでも'),
      ...WEAPON_TYPES.map((t) => h('option', {
        value: t, ...(w.when === t ? { selected: 'selected' } : {}),
      }, EQUIP_META[t].label))));

    rows.push(h('div', { class: 'row tight' },
      ...['x', 'y', 'z'].map((ax) => h('button', {
        class: (w.axis ?? 'x') === ax ? 'active' : '',
        onClick: () => { set({ axis: ax }); redraw(); },
      }, { x: '前後', y: 'ひねり', z: '上下' }[ax]))));

    rows.push(slider('しまう角度', {
      min: -170, max: 170, step: 5, value: w.stowed ?? 0, unit: '°',
    }, (v) => set({ stowed: v })));
    rows.push(slider('構える角度', {
      min: -170, max: 170, step: 5, value: w.deployed ?? -60, unit: '°',
    }, (v) => set({ deployed: v })));
    rows.push(slider('速さ', {
      min: 0.5, max: 12, step: 0.1, value: w.speed ?? 3.2, fixed: 1,
    }, (v) => set({ speed: v })));
    rows.push(slider('行き過ぎ', {
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
    const rows = [h('h3', { class: 'inline' }, '動作テスト')];

    rows.push(slider('走らせる', {
      min: 0, max: 1, step: 0.05, value: ed.bonePreview.run, fixed: 2,
    }, (v) => ed.setBonePreview({ run: v })));
    rows.push(h('div', { class: 'row tight' },
      h('button', { onClick: () => ed.setBonePreview({ fire: true }) }, '撃つ'),
      h('button', {
        class: ed.bonePreview.solo ? 'active' : '',
        onClick: () => { ed.setBonePreview({ solo: !ed.bonePreview.solo }); redraw(); },
      }, '選択中だけ'),
    ));

    if (part.boneType === 'weapon') {
      rows.push(h('select', {
        onChange: (ev) => ed.setBonePreview({ weapon: ev.target.value || null }),
      },
      h('option', { value: '' }, '武器なし'),
      ...WEAPON_TYPES.map((t) => h('option', {
        value: t, ...(ed.bonePreview.weapon === t ? { selected: 'selected' } : {}),
      }, EQUIP_META[t].label))));
    }

    rows.push(h('button', {
      class: 'ghost wide',
      title: '反対側の同じボーンに、この設定をそのまま写します',
      onClick: () => ed.copyBoneSettingsToTwin(),
    }, '反対側にも同じ設定'));
    rows.push(h('div', { class: 'row tight' },
      h('button', { onClick: () => ed.scaleChainGainSelected(0.8) }, '先まで弱く'),
      h('button', { onClick: () => ed.scaleChainGainSelected(1.25) }, '先まで強く'),
    ));

    return rows;
  }

  _boneMotion(part) {
    const app = this.app;
    const redraw = () => this.renderInspector(app.editor.selectedParts());
    const rows = [h('h3', { class: 'inline' }, '関節の効き')];

    rows.push(slider('効き', {
      min: 0, max: BONE_GAIN_MAX, step: 0.05, value: part.gain ?? 1, fixed: 2,
    }, (v) => app.editor.setBoneMotionSelected({ gain: v })));
    rows.push(slider('ずらし', {
      min: 0, max: BONE_LAG_MAX, step: 0.05, value: part.lag ?? 0, fixed: 2,
    }, (v) => app.editor.setBoneMotionSelected({ lag: v })));

    const recipe = (label, title, motion) => h('button', {
      title, onClick: () => app.editor.setBoneMotionSelected(motion),
    }, label);
    rows.push(h('div', { class: 'row tight' },
      recipe('肩', 'アームの根元。振りを抑えて、腕全体の付け根らしく', { gain: 0.4, lag: 0 }),
      recipe('股関節', 'レッグの根元。しっかり踏み出す', { gain: 1, lag: 0 }),
      recipe('しなり', 'ひと呼吸遅れて追従。先端側に付けるとムチのように動く', { gain: 0.8, lag: 0.12 }),
      recipe('固定', 'まったく動かさない', { gain: 0, lag: 0 }),
    ));
    // The travel is part of the joint, not a separate decision: a knee that
    // takes the full swing and can also bend backwards is not a knee.
    const shape = (label, title, patch) => h('button', {
      title, onClick: () => { app.editor.setBoneTravelSelected(patch); redraw(); },
    }, label);
    rows.push(h('div', { class: 'row tight' },
      shape('ひざ', '片方にだけ深く曲がる', {
        limit: 130, limitBack: 4, hinge: true, limitMode: 'clamp',
      }),
      shape('ひじ', 'ひざより浅く、同じく片方だけ', {
        limit: 105, limitBack: 6, hinge: true, limitMode: 'clamp',
      }),
      shape('球', '前後にも横にも自由', {
        limit: 70, limitBack: null, hinge: false, limitMode: 'clamp',
      }),
      shape('バネ', '端まで行くと跳ね返る', {
        limit: 55, limitBack: null, hinge: false, limitMode: 'bounce',
      }),
    ));



    return rows;
  }

  _customMotion(part) {
    const app = this.app;
    const c = part.custom;
    const rows = [h('h3', { class: 'inline' }, 'カスタム動作')];

    const redraw = () => this.renderInspector(app.editor.selectedParts());

    rows.push(h('label', { class: 'field' }, h('span', {}, '軸')));
    rows.push(h('div', { class: 'row tight' },
      ...['x', 'y', 'z'].map((ax) => h('button', {
        class: c.axis === ax ? 'active' : '',
        onClick: () => { c.axis = ax; redraw(); },
      }, { x: '前後', y: 'ひねり', z: '上下' }[ax]))));

    rows.push(h('label', { class: 'field' }, h('span', {}, '動き方')));
    rows.push(h('div', { class: 'equipgrid' },
      ...Object.entries(CUSTOM_WAVES).map(([k, w]) => h('button', {
        class: c.wave === k ? 'active' : '',
        onClick: () => { c.wave = k; redraw(); },
      }, w.label))));

    const spins = CUSTOM_WAVES[c.wave]?.spins && !c.bounded;
    if (spins) {
      // A propeller ignores both the amplitude and the joint limit, which
      // is right for a propeller and wrong for anything that has to stay
      // inside a machine.
      rows.push(h('label', { class: 'checkline' },
        h('input', {
          type: 'checkbox', ...(c.bounded ? { checked: 'checked' } : {}),
          onChange: (ev) => { c.bounded = ev.target.checked; redraw(); },
        }), '可動域で止める'));
    } else {
      rows.push(slider('振幅', { min: 0, max: 90, step: 5, value: c.amp, unit: '°' },
        (v) => { c.amp = v; }));
      if (CUSTOM_WAVES[c.wave]?.spins) {
        rows.push(h('label', { class: 'checkline' },
          h('input', {
            type: 'checkbox', checked: 'checked',
            onChange: (ev) => { c.bounded = ev.target.checked; redraw(); },
          }), '可動域で止める'));
      }
    }

    rows.push(slider(spins ? '回転速度' : '速さ',
      { min: 0, max: 4, step: 0.1, value: c.freq, fixed: 1, unit: spins ? ' 回転/秒' : ' Hz' },
      (v) => { c.freq = v; }));

    rows.push(slider('中心角', { min: -90, max: 90, step: 5, value: c.offset ?? 0, unit: '°' },
      (v) => { c.offset = v; }));
    // The resting angle itself can move with the drive: a waist that leans
    // forward the faster you go, rather than only twisting harder.
    rows.push(slider('中心角も動かす', {
      min: -1, max: 1, step: 0.05, value: c.offsetGain ?? 0, fixed: 2,
    }, (v) => { c.offsetGain = v; }));
    rows.push(slider('位相ずらし', { min: 0, max: 1, step: 0.05, value: c.phase ?? 0, fixed: 2 },
      (v) => { c.phase = v; }));

    /**
     * A second wave, laid over the first.
     *
     * One wave is either slow and wide or quick and small; it cannot be
     * both, so "sways heavily while trembling" was not expressible at all.
     */
    rows.push(h('h3', { class: 'inline' }, '重ねる動き'));
    rows.push(slider('振幅', { min: 0, max: 45, step: 1, value: c.amp2 ?? 0, unit: '°' },
      (v) => { c.amp2 = v; redraw(); }));
    if (c.amp2) {
      rows.push(slider('速さ', {
        min: 0, max: 12, step: 0.5, value: c.freq2 ?? 4, fixed: 1, unit: ' Hz',
      }, (v) => { c.freq2 = v; }));
      rows.push(h('div', { class: 'equipgrid' },
        ...Object.entries(CUSTOM_WAVES).map(([k, w]) => h('button', {
          class: (c.wave2 ?? 'sine') === k ? 'active' : '',
          onClick: () => { c.wave2 = k; redraw(); },
        }, w.label))));
    }

    rows.push(h('label', { class: 'field' }, h('span', {}, '駆動ソース')));
    rows.push(h('select', { onChange: (ev) => { c.source = ev.target.value; } },
      ...CUSTOM_SOURCES.map(([v, l]) => h('option', {
        value: v, ...(c.source === v ? { selected: 'selected' } : {}),
      }, l))));

    // Ready-made joints. These used to live in the help text as prose, so
    // building a waist meant reading a paragraph and then guessing at five
    // sliders that would produce it.
    const recipe = (label, title, motion) => h('button', {
      title,
      onClick: () => { Object.assign(c, motion); redraw(); },
    }, label);
    rows.push(h('div', { class: 'row tight' },
      recipe('腰', '歩調に合わせてひねる', {
        axis: 'y', wave: 'sine', amp: 14, freq: 1, source: 'stride', offsetGain: 0,
      }),
      recipe('首', 'ロックオン中だけゆっくり動く', {
        axis: 'y', wave: 'sine', amp: 10, freq: 0.4, source: 'aim',
      }),
      recipe('尾', '走るほど大きく揺れる', {
        axis: 'x', wave: 'sine', amp: 26, freq: 1.2, source: 'speed', amp2: 6, freq2: 5,
      }),
    ));
    rows.push(h('div', { class: 'row tight' },
      recipe('プロペラ', '回りっぱなし', {
        axis: 'y', wave: 'saw', freq: 2, source: 'time', bounded: false,
      }),
      recipe('排熱フィン', 'ENが減るほど開く', {
        axis: 'x', wave: 'sine', amp: 0, freq: 0, source: 'energy', offsetGain: 1, amp2: 0,
      }),
      recipe('反動', '撃った瞬間だけ跳ねる', {
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
      cell('質量', stats.mass.toFixed(1), delta('mass', stats.mass)),
      cell('機動', stats.thrustToMass.toFixed(1),
        delta('thrustToMass', stats.thrustToMass)
        || (stats.agility > 0.55 ? 'good' : stats.agility < 0.22 ? 'warn' : '')),
      cell('耐久', String(Math.round(stats.durability * (1 + (stats.hpBonus ?? 0)))),
        delta('durability', stats.durability)),
      cell('脚', String(stats.legs)),
      // How big the thing is. A builder of robots never said.
      cell('全高', `${(this.app.editor.measure().whole.y).toFixed(1)}m`),
      // Only when there is something to say. A row reading "x1.0" on every
      // machine that has never fitted a tank is a row nobody reads.
      ...((stats.energyCapacity ?? 1) > 1
        ? [cell('EN', `x${stats.energyCapacity.toFixed(2)}`, 'good')] : []),
      // Part count, which is what decides how heavy the editor itself feels.
      cell('パーツ', String(this.app.assembly.parts.size),
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
      h('div', { class: 'stat' }, h('span', { class: 'k' }, '質量'),
        h('span', { class: 'v' }, stats.mass.toFixed(2))),
      h('div', { class: 'meter' }, h('i', { style: `width:${stats.weightClass * 100}%` })),

      h('div', { class: 'stat' }, h('span', { class: 'k' }, '機動性'),
        h('span', { class: `v ${stats.agility > 0.55 ? 'good' : stats.agility < 0.22 ? 'warn' : ''}` },
          stats.thrustToMass.toFixed(1))),
      h('div', { class: 'meter' }, h('i', { style: `width:${stats.agility * 100}%` })),

      h('div', { class: 'stat' }, h('span', { class: 'k' }, 'ブロック'), h('span', { class: 'v' }, stats.blockCount)),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, '体積'), h('span', { class: 'v' }, stats.volume.toFixed(2))),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, '密度'), h('span', { class: 'v' }, pct(stats.density))),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, '推力'), h('span', { class: 'v' }, stats.thrust.toFixed(0))),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, '慣性'), h('span', { class: 'v' }, stats.inertia.toFixed(1))),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, '脚 / 腕'),
        h('span', { class: 'v' }, `${stats.legs} / ${stats.arms}`)),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, '顔 / カスタム'),
        h('span', { class: 'v' }, `${stats.faces} / ${stats.customs}`)),

      h('div', { class: 'stat' }, h('span', { class: 'k' }, '装備 / 武装'),
        h('span', { class: 'v' }, `${stats.equipCount ?? 0} / ${stats.weaponCount ?? 0}`)),
      ...(stats.dashBonus
        ? [h('div', { class: 'stat' }, h('span', { class: 'k' }, 'ダッシュ'),
          h('span', { class: 'v good' }, `+${Math.round(stats.dashBonus * 100)}%`))]
        : []),
      ...(stats.noFly
        ? [h('div', { class: 'stat' }, h('span', { class: 'k' }, 'グラビティ'),
          h('span', { class: 'v warn' }, `浮遊不可 / 耐久 +${Math.round(stats.hpBonus * 100)}%`))]
        : []),
    );
  }

  syncName(name) {
    if (this.app.mode === 'part') this.partNameInput.value = name;
    else this.nameInput.value = name;
  }
}
