import { PALETTE, BONE_META, BONE_GAUGE, FACE_NAME } from '../core/constants.js';
import { PRESETS } from '../core/Assembly.js';
import { TOOL } from '../editor/EditorScene.js';

// ============================================================
//  Editor DOM. Built in code so the whole editor stays one unit.
// ============================================================

function h(tag, attrs = {}, ...kids) {
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

const ASSEMBLE_TOOLS = [
  { tool: TOOL.BLOCK, label: 'ブロック', key: 'B', color: '#c9d2dc' },
  { tool: TOOL.BONE_LEG, label: BONE_META.leg.label, key: 'L', color: '#6fe3ff' },
  { tool: TOOL.BONE_ARM, label: BONE_META.arm.label, key: 'A', color: '#ffc861' },
  { tool: TOOL.BONE_FACE, label: BONE_META.face.label, key: 'F', color: '#ff7ba6' },
  { tool: TOOL.BONE_CUSTOM, label: BONE_META.custom.label, key: 'C', color: '#b98cff' },
  { tool: TOOL.SELECT, label: '選択 / 移動', key: 'V', color: '#ffd166' },
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
    this.els = {};
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
    this.testBtn = h('button', { class: 'primary', onClick: () => app.setMode('field') }, '▶ TEST FIELD');

    this.topbar = h('div', { id: 'topbar' },
      h('div', { class: 'brand' }, 'BroStom', h('small', {}, 'BLOCK ROBO ARENA')),
      h('div', { class: 'sep' }),
      this.nameInput,
      this.presetSelect,
      h('div', { class: 'sep' }),
      h('button', { onClick: () => app.save() }, '保存'),
      h('button', { onClick: () => app.load() }, '読込'),
      h('button', { class: 'ghost', onClick: () => app.exportJson() }, '書出'),
      h('button', { class: 'ghost', onClick: () => app.importJson() }, '取込'),
      h('div', { class: 'spacer' }),
      this.editBtn,
      this.testBtn,
    );

    // ---------------------------------------------------- left panel
    this.toolButtons = new Map();

    const mkTool = (t) => {
      const btn = h('button', {
        class: 'toolbtn', onClick: () => app.setTool(t.tool),
      },
        h('span', { class: 'dot', style: `background:${t.color};color:${t.color}` }),
        h('span', {}, t.label),
        h('span', { class: 'key' }, t.key),
      );
      this.toolButtons.set(t.tool, btn);
      return btn;
    };

    // bone options
    this.boneLen = this._slider('長さ', 2, 8, 1, app.editor.boneOpts.length, (v) => {
      app.editor.boneOpts.length = v;
      app.applyBoneOptionToSelection('length', v);
    });
    this.boneLimit = this._slider('可動域', 10, 170, 5, app.editor.boneOpts.limit, (v) => {
      app.editor.boneOpts.limit = v;
      app.applyBoneOptionToSelection('limit', v);
    }, '°');

    this.gaugeRow = h('div', { class: 'row tight' },
      ...Object.entries(BONE_GAUGE).map(([k, g]) => h('button', {
        class: app.editor.boneOpts.gauge === k ? 'active' : '',
        onClick: () => {
          app.editor.boneOpts.gauge = k;
          this._syncGauge();
          app.applyBoneOptionToSelection('gauge', k);
        },
      }, g.label)),
    );

    this.boneBox = h('div', {},
      this.boneLen, this.gaugeRow, this.boneLimit,
    );

    this.brushSlider = this._slider('ブラシ', 1, 5, 1, app.editor.brushSize, (v) => { app.editor.brushSize = v; });
    this.sculptBox = h('div', {}, this.brushSlider);

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
        h('div', { class: 'sep', style: 'height:1px;width:100%;margin:9px 0' }),
        h('h3', { style: 'border:0;padding:0 0 4px' }, 'ボーン設定'),
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
    this.paletteEl = h('div', { class: 'palette' },
      ...PALETTE.map((c, i) => h('div', {
        class: `swatch${i === app.editor.colorIndex ? ' active' : ''}`,
        style: `background:#${c.toString(16).padStart(6, '0')}`,
        title: i === 0 ? 'コアシルバー' : `色 ${i}`,
        onClick: () => app.setColor(i),
      })),
    );

    this.inspectorEl = h('div', { class: 'body' });
    this.statsEl = h('div', { class: 'body' });

    this.rightPanel = h('div', { class: 'panel', id: 'rightpanel' },
      h('h3', {}, 'カラー'),
      h('div', { class: 'body' }, this.paletteEl),
      h('h3', {}, 'インスペクタ'),
      this.inspectorEl,
      h('h3', {}, 'スペック'),
      this.statsEl,
    );

    // ---------------------------------------------------- hints
    this.hint = h('div', { id: 'hint' },
      h('span', {}, h('b', {}, '左ドラッグ'), '回転'),
      h('span', {}, h('b', {}, 'ホイール'), 'ズーム'),
      h('span', {}, h('b', {}, 'クリック'), '設置 / 選択'),
      h('span', {}, h('b', {}, 'Del'), '削除'),
      h('span', {}, h('b', {}, '[ ]'), 'ブラシ'),
    );

    // ---------------------------------------------------- field bar
    this.fieldBar = h('div', { id: 'fieldbar', class: 'hidden' },
      h('span', { style: 'color:var(--accent);font-family:var(--mono);letter-spacing:.14em' }, 'DEBUG FIELD'),
      h('div', { class: 'sep' }),
      h('span', { style: 'color:var(--dim)' },
        'WASD 移動 / Space 上昇・跳躍 / Shift 下降 / E ブースト / F ロックオン / Tab 切替 / 1·2·3 ABC / R リセット'),
      h('div', { class: 'sep' }),
      h('button', { onClick: () => app.setMode('edit') }, '← EDITOR'),
    );

    this.pointerHint = h('div', { id: 'pointerhint', class: 'hidden', onClick: () => app.capturePointer() },
      h('div', { class: 'big' }, 'CLICK TO ENGAGE'),
      h('div', { class: 'sub' }, 'マウスで視点操作 / Esc で解除'),
    );

    this.toast = h('div', { id: 'toast' });

    this.root.append(
      this.topbar, this.leftPanel, this.rightPanel, this.hint,
      this.fieldBar, this.pointerHint, this.toast,
    );

    this.syncTool(app.editor.tool);
  }

  _slider(label, min, max, step, value, onInput, unit = '') {
    const val = h('span', { class: 'val' }, `${value}${unit}`);
    const input = h('input', {
      type: 'range', min, max, step, value,
      onInput: (e) => { const v = Number(e.target.value); val.textContent = `${v}${unit}`; onInput(v); },
    });
    const wrap = h('div', {}, h('label', { class: 'field' }, h('span', {}, label), val), input);
    wrap._set = (v) => { input.value = v; val.textContent = `${v}${unit}`; };
    return wrap;
  }

  _syncGauge() {
    const g = this.app.editor.boneOpts.gauge;
    [...this.gaugeRow.children].forEach((b, i) => {
      b.classList.toggle('active', Object.keys(BONE_GAUGE)[i] === g);
    });
  }

  // ---------------------------------------------------------- sync

  syncTool(tool) {
    for (const [t, btn] of this.toolButtons) btn.classList.toggle('active', t === tool);
    const isBone = [TOOL.BONE_LEG, TOOL.BONE_ARM, TOOL.BONE_FACE, TOOL.BONE_CUSTOM].includes(tool);
    const isSculpt = [TOOL.CARVE, TOOL.ADD, TOOL.PAINT].includes(tool);
    this.boneBox.style.opacity = isBone ? '1' : '0.35';
    this.boneBox.style.pointerEvents = isBone ? 'auto' : 'none';
    this.sculptBox.style.opacity = isSculpt ? '1' : '0.35';
    this.sculptBox.style.pointerEvents = isSculpt ? 'auto' : 'none';
  }

  syncColor(i) {
    [...this.paletteEl.children].forEach((s, k) => s.classList.toggle('active', k === i));
  }

  syncMode(mode) {
    const edit = mode === 'edit';
    this.editBtn.classList.toggle('active', edit);
    for (const el of [this.leftPanel, this.rightPanel, this.hint, this.topbar]) el.classList.toggle('hidden', !edit);
    this.fieldBar.classList.toggle('hidden', edit);
  }

  setPointerHint(show) {
    this.pointerHint.classList.toggle('hidden', !show);
  }

  toastMsg(msg) {
    this.toast.textContent = msg;
    this.toast.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toast.classList.remove('show'), 1700);
  }

  // ---------------------------------------------------------- inspector

  renderInspector(part) {
    const app = this.app;
    this.inspectorEl.replaceChildren();

    if (!part) {
      this.inspectorEl.append(h('div', { class: 'inspector-empty' },
        'パーツをクリックすると詳細が出ます。',
        h('br'), 'ソケット（青い枠）をクリックで取り付け。'));
      return;
    }

    const isCore = part.kind === 'core';
    const rows = [h('div', { class: 'tag' }, part.kind.toUpperCase() + (part.kind === 'bone' ? ` / ${BONE_META[part.boneType].label}` : ''))];

    if (part.mount) {
      const where = part.mount.slot !== undefined
        ? `スロット ${part.mount.slot === 'tip' ? '先端' : part.mount.slot}`
        : FACE_NAME[part.mount.face];
      rows.push(h('div', { class: 'stat' }, h('span', { class: 'k' }, 'MOUNT'), h('span', { class: 'v' }, where)));
    }

    if (part.kind === 'bone') {
      rows.push(this._slider('長さ', 2, 8, 1, part.length, (v) => { part.length = v; app.editor.rebuild(); }));
      rows.push(this._slider('可動域', 10, 170, 5, part.limit, (v) => { part.limit = v; }, '°'));
      rows.push(h('div', { class: 'row tight' },
        ...Object.entries(BONE_GAUGE).map(([k, g]) => h('button', {
          class: part.gauge === k ? 'active' : '',
          onClick: () => { part.gauge = k; app.editor.rebuild(); },
        }, g.label))));
      rows.push(h('label', { class: 'checkline' },
        h('input', {
          type: 'checkbox', ...(part.invert ? { checked: 'checked' } : {}),
          onChange: (e) => { part.invert = e.target.checked; app.editor.rebuild(); },
        }), '動きを反転'));

      if (part.boneType === 'custom') {
        const c = part.custom;
        rows.push(h('h3', { style: 'border:0;padding:8px 0 2px' }, 'カスタム動作'));
        rows.push(h('div', { class: 'row tight' },
          ...['x', 'y', 'z'].map((ax) => h('button', {
            class: c.axis === ax ? 'active' : '',
            onClick: (e) => {
              c.axis = ax;
              [...e.target.parentElement.children].forEach((b) => b.classList.toggle('active', b === e.target));
            },
          }, ax.toUpperCase() + '軸'))));
        rows.push(this._slider('振幅', 0, 90, 5, c.amp, (v) => { c.amp = v; }, '°'));
        rows.push(this._slider('速さ', 0, 4, 0.1, c.freq, (v) => { c.freq = v; }));
        rows.push(h('label', { class: 'field' }, h('span', {}, '駆動ソース')));
        rows.push(h('select', {
          onChange: (e) => { c.source = e.target.value; },
        }, ...[['time', '常時'], ['speed', '速度'], ['thrust', '推力'], ['jerk', '衝撃'], ['aim', 'ロックオン']]
          .map(([v, l]) => h('option', { value: v, ...(c.source === v ? { selected: 'selected' } : {}) }, l))));
      }
    } else {
      const solid = part.vox.reduce((n, v) => n + (v ? 1 : 0), 0);
      rows.push(h('div', { class: 'stat' },
        h('span', { class: 'k' }, 'VOXEL'), h('span', { class: 'v' }, `${solid} / 512`)));
      rows.push(h('div', { class: 'meter' }, h('i', { style: `width:${(solid / 512) * 100}%` })));
      rows.push(h('div', { class: 'row tight' },
        h('button', { onClick: () => app.fillSelected() }, '全埋め'),
        h('button', { onClick: () => app.bevelSelected() }, '角落とし'),
        h('button', { onClick: () => app.repaintSelected() }, '全塗り'),
      ));
    }

    if (!isCore) {
      rows.push(h('button', {
        class: 'danger', style: 'width:100%;margin-top:8px',
        onClick: () => app.editor.deleteSelected(),
      }, '削除 (Del)'));
    } else {
      rows.push(h('div', { class: 'inspector-empty', style: 'margin-top:6px' },
        'コアブロックは削除できません。前面 (+Z) が進行方向です。'));
    }

    this.inspectorEl.append(...rows);
  }

  // ---------------------------------------------------------- stats

  renderStats(stats) {
    const pct = (v) => `${Math.round(v * 100)}%`;
    const gaitLabel = { hover: 'ホバー', hop: 'ぴょんぴょん', walk: '二足歩行', skitter: 'カサカサ' }[stats.gait];

    this.statsEl.replaceChildren(
      h('div', { style: 'margin-bottom:8px' }, h('span', { class: 'gaitbadge' }, gaitLabel)),

      h('div', { class: 'stat' }, h('span', { class: 'k' }, '質量'),
        h('span', { class: 'v' }, stats.mass.toFixed(2))),
      h('div', { class: 'meter' }, h('i', { style: `width:${stats.weightClass * 100}%` })),

      h('div', { class: 'stat' }, h('span', { class: 'k' }, '機動性'),
        h('span', { class: `v ${stats.agility > 0.55 ? 'good' : stats.agility < 0.22 ? 'warn' : ''}` },
          stats.thrustToMass.toFixed(1))),
      h('div', { class: 'meter' }, h('i', { style: `width:${stats.agility * 100}%` })),

      h('div', { class: 'stat' }, h('span', { class: 'k' }, 'ブロック'), h('span', { class: 'v' }, stats.blockCount)),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, '密度'), h('span', { class: 'v' }, pct(stats.density))),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, '推力'), h('span', { class: 'v' }, stats.thrust.toFixed(0))),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, '慣性'), h('span', { class: 'v' }, stats.inertia.toFixed(1))),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, 'LEG / ARM'),
        h('span', { class: 'v' }, `${stats.legs} / ${stats.arms}`)),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, 'FACE / CUSTOM'),
        h('span', { class: 'v' }, `${stats.faces} / ${stats.customs}`)),
    );
  }

  syncName(name) { this.nameInput.value = name; }
}
