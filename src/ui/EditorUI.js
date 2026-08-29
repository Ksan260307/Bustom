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
  BONE_GAIN_MAX, BONE_LAG_MAX,
} from '../core/constants.js';
import { PRESETS } from '../core/Assembly.js';
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
      ...Object.entries(PRESETS).map(([k, v]) => h('option', { value: k }, v.label)),
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
      h('span', { class: 'note', style: 'margin:0' }, '作ったパーツはメイン編集の「パーツ庫」から呼び出せます'),
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

    this.gizmoBox = h('div', {},
      h('div', { class: 'row tight' }, ...this.gizmoButtons),
      h('div', { class: 'row tight' }, ...this.spaceButtons),
      h('label', { class: 'checkline' }, this.snapToggle, 'グリッドと角度にスナップ'),
      h('label', { class: 'field' }, h('span', {}, 'グリッド'), this.snapStep),
      h('label', { class: 'field' }, h('span', {}, '角度'), this.turnStep),
      slider('面からの隙間', {
        min: 0, max: 0.3, step: 0.01, value: 0, unit: ' m', fixed: 2,
      }, (v) => { app.editor.placeGap = v; }),
      h('div', { class: 'note' }, '0 なら面にぴったり。少し空けるとフィンや装甲の重なりが作れます。'),
      h('h3', { class: 'inline' }, '中を見る'),
      h('label', { class: 'field' }, h('span', {}, '断面'), this.sectionAxis),
      this.sectionAt,
      h('label', { class: 'checkline' }, this.seeThrough, '機体を透かす'),
      h('div', { class: 'note' }, '床のマスは 1m。機体の全高は右上のスペック帯に出ます。'),
      h('div', { class: 'row tight' },
        h('button', { onClick: () => app.editor.selectAll() }, '全選択'),
        h('button', { onClick: () => app.editor.duplicateSelected() }, '複製'),
      ),
      h('h3', { class: 'inline' }, '選ぶ'),
      h('div', { class: 'row tight' },
        h('button', {
          title: '選んだパーツの下にあるもの全部を足します（削除で消えるのと同じ範囲）',
          onClick: () => app.editor.selectSubtree(),
        }, '配下ごと'),
        h('button', {
          title: '同じ形のブロック・同じ種類のプレートを全部足します',
          onClick: () => app.editor.selectSimilar(),
        }, '同じ種類'),
      ),
      h('div', { class: 'note' }, 'Shift+ドラッグで、囲んだ範囲のパーツを選べます。'),
      h('h3', { class: 'inline' }, '隠す・固定'),
      h('div', { class: 'row tight' },
        h('button', { onClick: () => app.editor.hideSelected() }, '隠す'),
        h('button', { onClick: () => app.editor.isolateSelected() }, '選択だけ'),
        h('button', { onClick: () => app.editor.showAll() }, '全部出す'),
      ),
      h('div', { class: 'row tight' },
        h('button', {
          title: '選んだパーツを、クリックでもギズモでも掴めなくします',
          onClick: () => app.editor.lockSelected(true),
        }, '固定する'),
        h('button', { onClick: () => app.editor.unlockAll() }, '固定を解除'),
      ),
      this.hiddenNote,
      h('h3', { class: 'inline' }, '直す'),
      h('div', { class: 'row tight' },
        h('button', {
          title: 'えらんだパーツを機体の中心線に戻します',
          onClick: () => app.editor.centreSelected(),
        }, '中心へ'),
        h('button', {
          title: '親の傾きを打ち消して、世界の軸に揃えます',
          onClick: () => app.editor.straightenSelected(),
        }, '世界の軸'),
        h('button', {
          title: 'ひとつ前の選択に戻ります',
          onClick: () => app.editor.selectBack(),
        }, '選択を戻す'),
      ),
      h('div', { class: 'row tight' },
        h('button', {
          title: 'コピーせず、その場で向きを反転します',
          onClick: () => app.editor.flipSelected('x'),
        }, 'その場で反転'),
        h('button', {
          title: '最後に選んだパーツの傾きを、他の全部に写します',
          onClick: () => app.editor.matchRotationSelected(),
        }, '傾きを揃える'),
        h('button', {
          title: '最後に選んだブロックの形と色を、他の全部に写します',
          onClick: () => app.editor.matchLookSelected(),
        }, '見た目を揃える'),
      ),
      h('div', { class: 'row tight' },
        h('button', {
          title: '最初に選んだ2つの中間に、残りを置きます',
          onClick: () => app.editor.centreBetween(),
        }, 'あいだに置く'),
        h('button', {
          title: 'ついている面いっぱいの大きさにします',
          onClick: () => app.editor.fitToHost(),
        }, '面いっぱい'),
        h('button', {
          title: 'ボーンの長さと太さを、最後に選んだものに揃えます',
          onClick: () => app.editor.matchBoneSelected(),
        }, '骨を揃える'),
      ),
      h('h3', { class: 'inline' }, '探す'),
      h('div', { class: 'row tight' },
        h('button', {
          title: '他のブロックの中に完全に埋まっているものを探します',
          onClick: () => app.editor.findBuried(),
        }, '埋まったブロック'),
        h('button', {
          title: '同じ色のブロックを全部選びます',
          onClick: () => app.editor.selectByColor(),
        }, '同じ色'),
        h('button', {
          title: '反対側の相棒に飛びます',
          onClick: () => app.editor.selectTwin(),
        }, '反対側'),
        h('button', {
          title: '最後に置いたパーツに戻ります',
          onClick: () => app.editor.selectLastPlaced(),
        }, '最後に置いたもの'),
      ),
      h('h3', { class: 'inline' }, '選択のまとまり'),
      h('div', { class: 'note' }, '選び出すのに手間のかかる組を、名前を付けて残しておけます。'),
      this.setRow,
      h('div', { class: 'row tight' },
        h('button', {
          onClick: () => this.keepSelectionSet(),
        }, '今の選択を残す'),
      ),
      h('div', { class: 'row tight' },
        h('button', {
          title: 'クリックしたパーツを新しい連結先にします',
          onClick: () => app.editor.beginReparent(),
        }, 'つなぎ替え'),
        h('button', {
          title: '直前の操作をもう一度（Ctrl+R）',
          onClick: () => app.editor.repeatLast(),
        }, 'もう一度'),
        h('button', {
          title: 'えらんだパーツに名前を付けます',
          onClick: () => this.askName(),
        }, '名前'),
      ),
      h('h3', { class: 'inline' }, '肢をつくる'),
      h('div', { class: 'note' }, 'えらんだパーツから、骨2本と足先を一度に生やします。'),
      h('div', { class: 'row tight' },
        h('button', { onClick: () => app.editor.addLimb('leg', { segments: 2 }) }, '脚'),
        h('button', { onClick: () => app.editor.addLimb('arm', { segments: 2, foot: false }) }, '腕'),
        h('button', { onClick: () => app.editor.addLimb('leg', { segments: 3 }) }, '脚（3節）'),
      ),
      h('h3', { class: 'inline' }, '円周にならべる'),
      h('div', { class: 'row tight' },
        ...[4, 6, 8].map((n) => h('button', {
          onClick: () => app.editor.repeatAround(n, 'y'),
        }, `${n}個`)),
      ),
      h('h3', { class: 'inline' }, '確かめる'),
      h('div', { class: 'row tight' },
        h('button', {
          title: '左右で相方のいないパーツをえらびます',
          onClick: () => app.editor.findAsymmetry(),
        }, '左右の食い違い'),
        h('button', {
          title: '重心の位置を出します',
          onClick: () => this.showBalance(),
        }, '重心'),
      ),
      this.balanceNote,
      h('h3', { class: 'inline' }, '視点'),
      h('div', { class: 'row tight' },
        ...[['front', '正面'], ['left', '側面'], ['top', '上'], ['iso', '斜め']]
          .map(([id, label]) => h('button', { onClick: () => app.editor.setView(id) }, label)),
      ),
      h('div', { class: 'row tight' },
        h('button', {
          title: '選択したパーツを、機体の中心線の反対側にコピーします',
          onClick: () => app.editor.mirrorSelected(),
        }, '左右反転コピー'),
      ),
      h('h3', { class: 'inline' }, 'ならべる'),
      h('div', { class: 'note' }, '2つ以上えらんでから。同じパーツにつながっているもの同士で働きます。'),
      ...['x', 'y', 'z'].map((axis) => h('div', { class: 'row tight' },
        h('span', { class: 'k', style: 'width:14px' }, axis.toUpperCase()),
        h('button', {
          title: '平均の位置へ。いちばん動かす距離が短くなります',
          onClick: () => app.editor.arrangeSelected(axis, 'align'),
        }, '揃える'),
        h('button', {
          title: 'いちばん手前のものに合わせます',
          onClick: () => app.editor.arrangeSelected(axis, 'min'),
        }, '手前で'),
        h('button', {
          title: 'いちばん奥のものに合わせます',
          onClick: () => app.editor.arrangeSelected(axis, 'max'),
        }, '奥で'),
        h('button', { onClick: () => app.editor.arrangeSelected(axis, 'spread') }, '均等'),
        h('button', {
          title: 'この向きに、自分の幅ぶんずつ繰り返します',
          onClick: () => app.editor.repeatSelected(axis, 3),
        }, '×4'),
      )),
      h('div', { class: 'row tight' },
        h('button', { onClick: () => app.copySelected() }, 'コピー'),
        h('button', { onClick: () => app.copySelected({ cut: true }) }, '切取'),
        h('button', { onClick: () => app.pasteClipboard() }, '貼付'),
      ),
      h('h3', { class: 'inline' }, '連結'),
      h('div', { class: 'row tight' },
        h('button', { onClick: () => app.connectSelected() }, '連結 (J)'),
        h('button', { onClick: () => app.disconnectSelected() }, '解除 (⇧J)'),
      ),
      h('div', { class: 'note' },
        'Ctrl+クリックで複数選択。',
        h('br'), '連結すると、最後に選んだパーツ（水色の枠）と一緒に動くようになります。',
        h('br'), 'ボーンの先のブロックに連結すれば、その関節で一緒に振れます。'),
    );

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
        '面をクリックすると、押した所にぴったり付きます。',
        h('br'), '何もない所をクリックすると、床の上に置きます（',
        h('b', {}, 'Shift+ホイール'), 'で高さ）。',
        h('br'), h('b', {}, 'R'), 'で向きを90°回す。', h('b', {}, 'ドラッグ'), 'で連続配置。',
        h('br'), h('b', {}, 'Alt+クリック'), 'でその部品の形・寸法・色を写す。',
        h('b', {}, '右クリック'), 'で削除。'),
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
      h('div', { class: 'note' },
        'Shift+ホイールでも変えられます。0 は床の上。'),
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
      h('div', { class: 'note' },
        '1/100 は最も細かい代わりに重くなります。加工中もカメラは右ドラッグで回転・ホイールでズームできます。'),
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
    this.gizmoSection = toolSection('ギズモ', this.gizmoBox);
    this.blockSection = toolSection('新規ブロック寸法', this.blockBox);
    this.equipSection = toolSection('装備プレート', this.equipBox);
    this.boneSection = toolSection('新規ボーン寸法', this.boneBox);
    this.sculptSection = toolSection('加工設定', this.sculptBox);
    this.stampSection = toolSection('パーツ配置',
      h('div', { class: 'note' },
        '右の「パーツ庫」で ＜配置＞ を押すと、そのパーツを置く場所を選べます。'));

    this.toolSections = [
      this.gizmoSection, this.blockSection, this.equipSection,
      this.boneSection, this.sculptSection, this.stampSection,
    ];

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
    }, 'DEBUG FIELD');

    // The tab that brings a folded panel back.
    this.leftTab = h('button', {
      class: 'panelfold', title: 'パネルを開く / たたむ',
      onClick: () => this.leftPanel.classList.toggle('folded'),
    }, '▸');
    this.rightTab = h('button', {
      class: 'panelfold right', title: 'パネルを開く / たたむ',
      onClick: () => this.rightPanel.classList.toggle('folded'),
    }, '◂');

    this.fieldBar = h('div', { id: 'fieldbar', class: 'hidden' },
      this.fieldLabel,
      h('div', { class: 'sep' }),
      this.fieldWeaponHint,
      h('div', { class: 'sep' }),
      this.fieldMoveHint,
      h('div', { class: 'spacer' }),
      h('button', { onClick: () => this.keyConfig.show() }, 'キー設定'),
      h('button', { onClick: () => this.help.show('field') }, '使い方'),
    );
    /** Counts down while the control legend is still on screen. */
    this._fieldBarFor = 0;

    this.pauseRestartBtn = h('button', {
      class: 'wide', onClick: () => app.restartField(),
    }, '⟲ リスポーン');

    this.pauseMenu = h('div', { id: 'pause', class: 'hidden' },
      h('div', { class: 'pausebox' },
        h('div', { class: 'pausetitle' }, 'PAUSED'),
        h('div', { class: 'pausesub' }, 'ESC で再開'),
        h('button', { class: 'primary wide', onClick: () => app.resumeField() }, '▶ 再開する'),
        this.pauseRestartBtn,
        h('button', { class: 'wide', onClick: () => this.keyConfig.show() }, '⌨ キー設定'),
        h('button', { class: 'wide', onClick: () => this.help.show('field') }, '？ 使い方'),
        h('button', { class: 'wide', onClick: () => app.setMode('edit') }, '← 編集画面に戻る'),
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
    this.result = new ResultScreen(app);

    this.root.append(
      this.topbar, this.partBar, this.leftPanel, this.rightPanel, this.hint,
      this.leftTab, this.rightTab,
      this.fieldBar, this.pauseMenu, this.keyConfig.el, this.share.el,
      this.help.el, this.title.el, this.result.el, this.toast,
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
    const isBone = [TOOL.BONE_LEG, TOOL.BONE_ARM, TOOL.BONE_FACE, TOOL.BONE_CUSTOM].includes(tool);
    const isSculpt = [TOOL.CARVE, TOOL.ADD, TOOL.PAINT].includes(tool);

    this.gizmoSection.setVisible(tool === TOOL.SELECT);
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
   * Put the control legend up for a few seconds.
   *
   * Called when the field opens, and by ? / F1. Kept as a method rather
   * than a timer inside the show/hide so that asking for it again while it
   * is already up simply restarts the clock.
   */
  showFieldHint(seconds = 6) {
    this._fieldBarFor = seconds;
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

  /** Fold it away now. */
  hideFieldHint() {
    this._fieldBarFor = 0;
    this.fieldBar.classList.add('folded');
    return this;
  }

  /**
   * Run the legend's clock. Driven from the app's frame, in real seconds:
   * this is a piece of screen furniture, not part of the fight.
   */
  tickFieldHint(dt) {
    if (this._fieldBarFor <= 0) return this;
    this._fieldBarFor -= dt;
    if (this._fieldBarFor <= 0) this.fieldBar.classList.add('folded');
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
    const wantBar = !editing && !isTitle;
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
    this.fieldLabel.textContent = isSolo ? 'SOLO PLAY' : 'DEBUG FIELD';
    // In a run, restarting means starting the run over, not just standing
    // back up — those are different enough to be worth different words.
    this.pauseRestartBtn.textContent = isSolo ? '⟲ 最初からやり直す' : '⟲ リスポーン';

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
        h('div', { class: 'note' }, '最後に選んだパーツが連結先（水色の枠）になります。'),
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
      rows.push(h('div', { class: 'note' },
        '色は右の「色」から。選んでいるブロック全部が塗り替わります。'));
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
      rows.push(h('div', { class: 'note' },
        '角度は X → Y → Z の順にかかります。親の傾きごと戻すなら「世界の軸」。'));

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
      rows.push(h('div', { class: 'note' },
        'どのパーツと一緒に動くか。ボーンを選ぶと、その関節から先で動きます。',
        h('br'), '変更しても見た目の位置は動きません。'));
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
      rows.push(slider('可動域', {
        min: 10, max: 170, step: 5, value: part.limit, unit: '°',
      }, (v) => { part.limit = v; }));
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

      rows.push(...this._boneMotion(part));

      rows.push(h('h3', { class: 'inline' }, 'つなげる'));
      rows.push(h('button', {
        class: 'ghost wide',
        title: 'このボーンの先端に、もう1本つなげます',
        onClick: () => app.editor.addBoneOnTipSelected(),
      }, `＋ 先端に${BONE_META[part.boneType].label}`));
      rows.push(h('div', { class: 'note' },
        '関節は中央。青い弧が可動範囲、緑の線が動く側（先端半分）です。'));

      if (part.boneType === 'custom') rows.push(...this._customMotion(part));
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
            '貼った場所を中心に、この半径の', h('b', {}, '円線'), 'が出ます。',
            h('br'), 'その線に', h('b', {}, '触れているパーツ'), 'が、線に沿って回ります',
            '（別のブロックに付いていても構いません）。',
            h('br'), '円の中に置いただけ・線から高さがずれているものは回りません。',
            h('br'), '線の上に立っていれば、足元が触れているので、',
            h('br'), '高く伸びたパーツもまるごと一緒に回ります。',
            h('br'), '円線は編集画面だけの表示です（左パネルで消せます）。'));
        } else {
          rows.push(h('div', { class: 'note' },
            '貼った面の向きが回転軸になります。ブロックごと、載っているものも一緒に回ります。'));
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
        h('div', { class: 'note' },
          '形を変えると、そのブロックの中身は作り直されます（彫った跡は消えます）。',
          h('br'), '寸法を変えれば、球は楕円に、円柱は角柱のように潰れます。'),
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

  _boneMotion(part) {
    const app = this.app;
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

    rows.push(h('div', { class: 'note' },
      '効き0で動かない関節、1で標準、2で大振り。',
      h('br'), 'ずらしは歩調1周のうちどこで動くか。先端ほど遅らせるとしなります。',
      h('br'), '腰は「カスタム」でひねり軸＋駆動ソース「歩調」。'));

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

    const spinning = CUSTOM_WAVES[c.wave]?.spins;
    if (spinning) {
      rows.push(h('div', { class: 'note' },
        '回転は可動域を無視してぐるぐる回り続けます。プロペラやレーダー向け。'));
    } else {
      rows.push(slider('振幅', { min: 0, max: 90, step: 5, value: c.amp, unit: '°' },
        (v) => { c.amp = v; }));
    }

    rows.push(slider(spinning ? '回転速度' : '速さ',
      { min: 0, max: 4, step: 0.1, value: c.freq, fixed: 1, unit: spinning ? ' 回転/秒' : ' Hz' },
      (v) => { c.freq = v; }));

    rows.push(slider('中心角', { min: -90, max: 90, step: 5, value: c.offset ?? 0, unit: '°' },
      (v) => { c.offset = v; }));
    rows.push(slider('位相ずらし', { min: 0, max: 1, step: 0.05, value: c.phase ?? 0, fixed: 2 },
      (v) => { c.phase = v; }));
    rows.push(h('div', { class: 'note' },
      '位相をずらすと、同じ設定のボーン同士でも動きがそろわずに波打ちます。'));

    rows.push(h('label', { class: 'field' }, h('span', {}, '駆動ソース')));
    rows.push(h('select', { onChange: (ev) => { c.source = ev.target.value; } },
      ...CUSTOM_SOURCES.map(([v, l]) => h('option', {
        value: v, ...(c.source === v ? { selected: 'selected' } : {}),
      }, l))));
    rows.push(h('div', { class: 'note' },
      '「歩調」は足の運びに同期します。腰のひねりはこれ。',
      h('br'), '選択している間、編集画面でもこの動きが再生されます。'));

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
