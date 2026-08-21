import * as THREE from 'three';
import {
  BONE_META, BONE_GAUGE, GAIT_LABEL, VOX_LEVELS,
  SIZE_MIN, SIZE_MAX, SIZE_STEP,
  BONE_LENGTH_MIN, BONE_LENGTH_MAX, BONE_RADIUS_MIN, BONE_RADIUS_MAX,
} from '../core/constants.js';
import { PRESETS } from '../core/Assembly.js';
import { STANDARD_COLORS, hexToCss } from '../core/Palette.js';
import { TOOL } from '../editor/EditorScene.js';
import { ColorWheel } from './ColorWheel.js';

// ============================================================
//  Editor DOM. Built in code so the whole editor stays one unit.
// ============================================================

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/** Labelled slider that reports its own value. */
export function slider(label, { min, max, step, value, unit = '', fixed = 0 }, onInput) {
  const fmt = (v) => `${fixed ? v.toFixed(fixed) : v}${unit}`;
  const val = h('span', { class: 'val' }, fmt(value));
  const input = h('input', {
    type: 'range', min, max, step, value,
    onInput: (e) => { const v = Number(e.target.value); val.textContent = fmt(v); onInput(v); },
  });
  const wrap = h('div', { class: 'sliderbox' },
    h('label', { class: 'field' }, h('span', {}, label), val), input);
  wrap.set = (v) => { input.value = v; val.textContent = fmt(v); };
  return wrap;
}

/** Three numeric fields in a row — for free positions and rotations. */
export function vectorField(label, value, step, onChange) {
  const inputs = ['X', 'Y', 'Z'].map((axis, i) => h('input', {
    type: 'number', step, value: Number(value[i]).toFixed(2), 'aria-label': `${label} ${axis}`,
    onChange: (e) => {
      const next = inputs.map((el) => Number(el.value) || 0);
      onChange(next);
    },
  }));
  const wrap = h('div', { class: 'vecbox' },
    h('label', { class: 'field' }, h('span', {}, label)),
    h('div', { class: 'vecrow' }, ...inputs),
  );
  wrap.set = (v) => inputs.forEach((el, i) => { el.value = Number(v[i]).toFixed(2); });
  return wrap;
}

const ASSEMBLE_TOOLS = [
  { tool: TOOL.SELECT, label: '選択 / 移動', key: 'V', color: '#ffd166' },
  { tool: TOOL.STAMP, label: 'パーツ配置', key: '—', color: '#8effc9' },
  { tool: TOOL.BLOCK, label: 'ブロック', key: 'B', color: '#c9d2dc' },
  { tool: TOOL.BONE_LEG, label: BONE_META.leg.label, key: 'L', color: '#6fe3ff' },
  { tool: TOOL.BONE_ARM, label: BONE_META.arm.label, key: 'A', color: '#ffc861' },
  { tool: TOOL.BONE_FACE, label: BONE_META.face.label, key: 'F', color: '#ff7ba6' },
  { tool: TOOL.BONE_CUSTOM, label: BONE_META.custom.label, key: 'C', color: '#b98cff' },
];

const SCULPT_LIST = [
  { tool: TOOL.CARVE, label: '削る', key: 'X', color: '#ff6a5c' },
  { tool: TOOL.ADD, label: '盛る', key: 'Z', color: '#8effc9' },
  { tool: TOOL.PAINT, label: '塗る', key: 'P', color: '#4fd2ff' },
];

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

    this.editBtn = h('button', { class: 'active', onClick: () => app.setMode('edit') }, 'EDIT');
    this.partBtn = h('button', { onClick: () => app.openPartEditor() }, 'パーツ編集');
    this.testBtn = h('button', { class: 'primary', onClick: () => app.setMode('field') }, '▶ TEST FIELD');

    this.undoBtn = h('button', { class: 'icon', title: '元に戻す (Ctrl+Z)', onClick: () => app.undo() }, '↶');
    this.redoBtn = h('button', { class: 'icon', title: 'やり直し (Ctrl+Y)', onClick: () => app.redo() }, '↷');

    this.topbar = h('div', { id: 'topbar' },
      h('div', { class: 'brand' }, 'BroStom', h('small', {}, 'BLOCK ROBO ARENA')),
      h('div', { class: 'sep' }),
      this.nameInput,
      this.presetSelect,
      h('div', { class: 'sep' }),
      this.undoBtn,
      this.redoBtn,
      h('div', { class: 'sep' }),
      h('button', { onClick: () => app.save() }, '保存'),
      h('button', { onClick: () => app.load() }, '読込'),
      h('button', { class: 'ghost', onClick: () => app.exportJson() }, '書出'),
      h('button', { class: 'ghost', onClick: () => app.importJson() }, '取込'),
      h('div', { class: 'spacer' }),
      this.editBtn,
      this.partBtn,
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
      h('button', { onClick: () => app.newPart() }, '新規'),
      h('div', { class: 'spacer' }),
      h('span', { class: 'note', style: 'margin:0' }, '作ったパーツはメイン編集の「パーツ庫」から呼び出せます'),
      h('button', { onClick: () => app.setMode('edit') }, '← メイン編集'),
    );

    // ---------------------------------------------------- left panel
    this.toolButtons = new Map();

    const mkTool = (t) => {
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

    this.blockBox = h('div', {}, ...this.newSizeSliders);

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
      type: 'checkbox', onChange: (e) => { app.editor.previewMotion = e.target.checked; },
    });

    this.leftPanel = h('div', { class: 'panel', id: 'leftpanel' },
      h('h3', {}, '組み立て'),
      h('div', { class: 'body' },
        ...ASSEMBLE_TOOLS.map(mkTool),
        h('h3', { class: 'inline' }, 'ギズモ'),
        this.gizmoBox,
        h('h3', { class: 'inline' }, '新規ブロック寸法'),
        this.blockBox,
        h('h3', { class: 'inline' }, '新規ボーン寸法'),
        this.boneBox,
      ),
      h('h3', {}, '加工 (上級)'),
      h('div', { class: 'body' },
        ...SCULPT_LIST.map(mkTool),
        this.sculptBox,
        h('label', { class: 'checkline' }, this.symmetryToggle, '左右対称でつける'),
        h('label', { class: 'checkline' }, this.previewToggle, '歩行プレビュー'),
      ),
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
    this.librarySection = h('div', {},
      h('h3', {}, 'パーツ庫'),
      this.libraryEl,
    );

    this.rightPanel = h('div', { class: 'panel', id: 'rightpanel' },
      this.librarySection,
      h('h3', {}, '標準色'),
      h('div', { class: 'body' },
        this.paletteEl,
        h('h3', { class: 'inline' }, 'カスタム色'),
        this.customEl,
        this.wheelToggle,
        this.wheelWrap,
      ),
      h('h3', {}, 'インスペクタ'),
      this.inspectorEl,
      h('h3', {}, 'スペック'),
      this.statsEl,
    );

    // ---------------------------------------------------- hints
    this.hint = h('div', { id: 'hint' },
      h('span', {}, h('b', {}, '左ドラッグ'), '回転'),
      h('span', {}, h('b', {}, '右ドラッグ'), '平行移動'),
      h('span', {}, h('b', {}, 'クリック'), '設置 / 選択'),
      h('span', {}, h('b', {}, 'Ctrl+click'), '複数選択'),
      h('span', {}, h('b', {}, 'T / R'), 'ギズモ'),
      h('span', {}, h('b', {}, 'J'), '連結'),
      h('span', {}, h('b', {}, 'Ctrl+Z'), '元に戻す'),
      h('span', {}, h('b', {}, 'Ctrl+C/V'), 'コピー'),
      h('span', {}, h('b', {}, 'Del'), '削除'),
    );

    // ---------------------------------------------------- field mode
    this.fieldBar = h('div', { id: 'fieldbar', class: 'hidden' },
      h('span', { style: 'color:var(--accent);font-family:var(--mono);letter-spacing:.14em' }, 'DEBUG FIELD'),
      h('div', { class: 'sep' }),
      h('span', { style: 'color:var(--dim)' },
        'W/S 前後・A 右/D 左（2回押しでダッシュ・後ろも可） / Space 上昇・跳躍 / Shift 下降 / '
        + 'E ブースト / F ロックオン / Tab 切替 / 1·2·3 ABC / R リセット / '
        + '右ドラッグ（Alt）カメラ回転・ホイールでズーム'),
      h('div', { class: 'sep' }),
      h('span', { style: 'color:var(--dim)' }, 'Esc でポーズ'),
    );

    this.pauseMenu = h('div', { id: 'pause', class: 'hidden' },
      h('div', { class: 'pausebox' },
        h('div', { class: 'pausetitle' }, 'PAUSED'),
        h('div', { class: 'pausesub' }, 'ESC で再開'),
        h('button', { class: 'primary wide', onClick: () => app.resumeField() }, '▶ 再開する'),
        h('button', { class: 'wide', onClick: () => app.restartField() }, '⟲ リスポーン'),
        h('button', { class: 'wide', onClick: () => app.setMode('edit') }, '← 編集画面に戻る'),
      ),
    );

    this.toast = h('div', { id: 'toast' });

    this.root.append(
      this.topbar, this.partBar, this.leftPanel, this.rightPanel, this.hint,
      this.fieldBar, this.pauseMenu, this.toast,
    );

    this.renderPalette();
    this.syncTool(app.editor.tool);
    this.syncResolution(app.assembly.voxRes);
  }

  // ---------------------------------------------------------- sync

  syncTool(tool) {
    for (const [t, btn] of this.toolButtons) btn.classList.toggle('active', t === tool);
    const isBone = [TOOL.BONE_LEG, TOOL.BONE_ARM, TOOL.BONE_FACE, TOOL.BONE_CUSTOM].includes(tool);
    const isSculpt = [TOOL.CARVE, TOOL.ADD, TOOL.PAINT].includes(tool);
    const dim = (el, on) => {
      el.style.opacity = on ? '1' : '0.35';
      el.style.pointerEvents = on ? 'auto' : 'none';
    };
    dim(this.boneBox, isBone);
    dim(this.blockBox, tool === TOOL.BLOCK);
    dim(this.sculptBox, isSculpt);
    dim(this.gizmoBox, tool === TOOL.SELECT);
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

    this.editBtn.classList.toggle('active', mode === 'edit');
    this.partBtn.classList.toggle('active', isPart);

    for (const el of [this.leftPanel, this.rightPanel, this.hint]) {
      el.classList.toggle('hidden', !editing);
    }
    this.topbar.classList.toggle('hidden', mode !== 'edit');
    this.partBar.classList.toggle('hidden', !isPart);
    this.fieldBar.classList.toggle('hidden', editing);

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
  renderInspector(parts) {
    const list = Array.isArray(parts) ? parts : (parts ? [parts] : []);
    this.inspectorEl.replaceChildren();

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
        ? `${anchor.kind === 'bone' ? BONE_META[anchor.boneType].label : anchor.label} (${anchor.id})`
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
        part.kind.toUpperCase() + (part.kind === 'bone' ? ` / ${BONE_META[part.boneType].label}` : '')),
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
        }, `${p.kind === 'bone' ? BONE_META[p.boneType].label : p.label} (${p.id})`));

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

      if (part.boneType === 'custom') {
        const c = part.custom;
        rows.push(h('h3', { class: 'inline' }, 'カスタム動作'));
        rows.push(h('div', { class: 'row tight' },
          ...['x', 'y', 'z'].map((ax) => h('button', {
            class: c.axis === ax ? 'active' : '',
            onClick: (ev) => {
              c.axis = ax;
              [...ev.target.parentElement.children].forEach((b) => b.classList.toggle('active', b === ev.target));
            },
          }, { x: '前後', y: 'ひねり', z: '上下' }[ax]))));
        rows.push(slider('振幅', { min: 0, max: 90, step: 5, value: c.amp, unit: '°' }, (v) => { c.amp = v; }));
        rows.push(slider('速さ', { min: 0, max: 4, step: 0.1, value: c.freq, fixed: 1 }, (v) => { c.freq = v; }));
        rows.push(h('label', { class: 'field' }, h('span', {}, '駆動ソース')));
        rows.push(h('select', { onChange: (ev) => { c.source = ev.target.value; } },
          ...[['time', '常時'], ['speed', '速度'], ['thrust', '推力'], ['jerk', '衝撃'], ['aim', 'ロックオン']]
            .map(([v, l]) => h('option', { value: v, ...(c.source === v ? { selected: 'selected' } : {}) }, l))));
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

  // ---------------------------------------------------------- stats

  renderStats(stats) {
    const pct = (v) => `${Math.round(v * 100)}%`;

    this.statsEl.replaceChildren(
      h('div', { style: 'margin-bottom:8px' },
        h('span', { class: 'gaitbadge' }, GAIT_LABEL[stats.gait] ?? stats.gait)),

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
    );
  }

  syncName(name) {
    if (this.app.mode === 'part') this.partNameInput.value = name;
    else this.nameInput.value = name;
  }
}
