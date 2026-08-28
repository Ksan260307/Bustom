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

export class EditorUI {
  /** @param {HTMLElement} root  @param {object} app */
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this._build();
  }

  // ---------------------------------------------------------- build

  _build() {
    const app = this.app;

    // ---------------------------------------------------- top bar
    this.nameInput = h('input', {
      type: 'text', value: app.assembly.name,
      onInput: (e) => { app.assembly.name = e.target.value.toUpperCase(); },
    });

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

    this.topbar = h('div', { id: 'topbar' },
      h('div', { class: 'brand' }, 'BLOSTOM', h('small', {}, 'BLOCK ROBO ARENA')),
      h('div', { class: 'sep' }),
      this.nameInput,
      this.presetSelect,
      h('div', { class: 'sep' }),
      this.undoBtn,
      this.redoBtn,
      h('button', {
        class: 'icon', title: '使い方 (F1)', onClick: () => this.help.toggle(),
      }, '？'),
      h('button', { class: 'icon', title: 'キー設定', onClick: () => this.keyConfig.show() }, '⌨'),
      h('button', { class: 'icon', title: 'QRで共有 / 読み込み', onClick: () => this.share.show() }, '⧉'),
      h('div', { class: 'sep' }),
      h('button', { onClick: () => app.save() }, '保存'),
      h('button', { onClick: () => app.load() }, '読込'),
      h('button', { class: 'ghost', onClick: () => app.exportJson() }, '書出'),
      h('button', { class: 'ghost', onClick: () => app.importJson() }, '取込'),
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

    this.gizmoBox = h('div', {},
      h('div', { class: 'row tight' }, ...this.gizmoButtons),
      h('label', { class: 'checkline' }, this.snapToggle, `0.25 / 15° にスナップ`),
      h('div', { class: 'row tight' },
        h('button', { onClick: () => app.editor.selectAll() }, '全選択'),
        h('button', { onClick: () => app.editor.duplicateSelected() }, '複製'),
      ),
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
    this.newSizeSliders = ['X', 'Y', 'Z'].map((axis, i) => slider(`幅 ${axis}`, {
      min: SIZE_MIN, max: SIZE_MAX, step: SIZE_STEP, value: 1, fixed: 2,
    }, (v) => { app.editor.newBlockSize[i] = v; }));

    this.newShapeButtons = new Map();
    this.blockBox = h('div', {},
      h('h3', { class: 'inline' }, '形'),
      ...this._shapeGrid(
        () => app.editor.newBlockShape,
        (id) => app.setNewBlockShape(id),
        this.newShapeButtons,
      ),
      h('div', { class: 'note' }, 'この形で新しいブロックを置きます。あとから変えられます。'),
      h('h3', { class: 'inline' }, '寸法'),
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

    this.sculptBox = h('div', {},
      this.brushSlider,
      h('label', { class: 'field' }, h('span', {}, '加工の細かさ')),
      this.resSelect,
      h('div', { class: 'note' },
        '1/100 は最も細かい代わりに重くなります。加工中もカメラは右ドラッグで回転・ホイールでズームできます。'),
    );

    this.symmetryToggle = h('input', {
      type: 'checkbox', onChange: (e) => { app.editor.symmetry = e.target.checked; },
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
          h('span', { class: 'note', style: 'margin:0' }, '見えない所のパーツもここから選べます'),
          h('div', { class: 'spacer' }),
          this.treeCount,
        ),
        this.treeEl,
      ),
      { open: false },
    );

    this.rightScroll = h('div', { class: 'panelscroll' });
    this.rightPanel = resizable(
      h('div', { class: 'panel', id: 'rightpanel' },
        append(this.rightScroll,
          this.treeSection,
          this.librarySection,
          collapsible('色', h('div', { class: 'body' },
            this.paletteEl,
            h('h3', { class: 'inline' }, 'カスタム色'),
            this.customEl,
            this.wheelToggle,
            this.wheelWrap,
          ), { open: false }),
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
      this.fieldBar, this.pauseMenu, this.keyConfig.el, this.share.el,
      this.help.el, this.title.el, this.result.el, this.toast,
    );

    this.renderPalette();
    this.syncTool(app.editor.tool);
    this.syncResolution(app.assembly.voxRes);
    this.syncFieldHint();
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
        h('div', { class: 'libname', title: item.name }, item.name),
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

  syncGizmoMode(mode) {
    this.gizmoButtons[0].classList.toggle('active', mode === 'translate');
    this.gizmoButtons[1].classList.toggle('active', mode === 'rotate');
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
    this.fieldBar.classList.toggle('hidden', editing || isTitle);

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
        title: `${kind.label} / ${id}`,
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
      rows.push(row);
      for (const child of part.children) walk(child, depth + 1);
    };

    if (asm.rootId) walk(asm.rootId, 0);
    this.treeEl.replaceChildren(...rows);
    this.treeCount.textContent = `${asm.size}`;
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
        h('button', {
          class: 'danger wide', style: 'margin-top:8px',
          onClick: () => this.app.editor.deleteSelected(),
        }, `${list.filter((p) => p.kind !== 'core').length} パーツを削除 (Del)`),
      );
      return;
    }

    this.inspectorEl.append(...this._singleInspector(list[0]));
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

      // --- which segment does it ride with?
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

      rows.push(h('h3', { class: 'inline' }, '形'));
      rows.push(...this._shapeGrid(
        () => part.shape ?? SHAPE_DEFAULT,
        (id) => {
          app.editor.setBlockShapeSelected(id);
          this.renderInspector(app.editor.selectedParts());
        },
      ));
      rows.push(h('div', { class: 'note' },
        '形を変えると、そのブロックの中身は作り直されます（彫った跡は消えます）。',
        h('br'), '寸法を変えれば、球は楕円に、円柱は角柱のように潰れます。'));

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
        h('button', { class: 'danger', onClick: () => app.editor.deleteSelected() }, '削除 (Del)'),
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
