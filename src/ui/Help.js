import { h, resizable } from './dom.js';
import {
  BONE_META, EQUIP_META, WEAPON_TYPES, SYSTEM_TYPES, GAIT_LABEL, VOX_LEVELS,
  SIZE_MIN, SIZE_MAX, BONE_GAIN_MAX,
} from '../core/constants.js';
import { SHAPE_GROUPS, SHAPES } from '../core/Shapes.js';
import { ACTION_GROUPS, ACTION_LABEL, keyLabel } from '../zmf/InputManager.js';
import { ASSEMBLE_TOOLS, SCULPT_LIST } from './EditorUI.js';

// ============================================================
//  Help.
//
//  Everything here is GENERATED from the tables the game actually runs on —
//  the equipment table, the shape table, the bone table, the player's own
//  key bindings. A help screen that restates them by hand is a help screen
//  that is wrong a week later, and wrong help is worse than none: it costs
//  the reader the time to try it before they find out.
//
//  So: add a plate to EQUIP_META and it appears here, with its own numbers.
// ============================================================

/** Rows of `[keys, what it does]`, rendered as a two-column table. */
function keyTable(rows) {
  return h('div', { class: 'helpkeys' },
    ...rows.flatMap(([k, v]) => [
      h('div', { class: 'hk' }, ...[].concat(k).map((s) => h('kbd', {}, s))),
      h('div', { class: 'hv' }, v),
    ]));
}

const para = (...kids) => h('p', { class: 'helpp' }, ...kids);

export class Help {
  constructor(app) {
    this.app = app;
    this.open = false;
    this.section = 'start';

    this.tabsEl = h('div', { class: 'helptabs' });
    this.bodyEl = h('div', { class: 'helpbody' });

    this.box = h('div', { class: 'keybox helpbox' },
      h('div', { class: 'keyhead' },
        h('div', { class: 'brand' }, 'HELP', h('small', {}, 'BroStom')),
        h('div', { class: 'spacer' }),
        h('button', { class: 'icon', title: '閉じる', onClick: () => this.close() }, '✕'),
      ),
      this.tabsEl,
      this.bodyEl,
      h('div', { class: 'keyfoot' },
        h('span', { class: 'keynote' }, 'F1 または ？ で開閉 / Esc で閉じる'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'primary', onClick: () => this.close() }, '閉じる'),
      ),
    );
    resizable(this.box, { key: 'help', edges: 'es', minW: 380, minH: 300, speed: 2 });
    this.el = h('div', { id: 'help', class: 'hidden' }, this.box);
  }

  // ---------------------------------------------------------- open / close

  setOpen(on) {
    this.open = on;
    this.el.classList.toggle('hidden', !on);
    if (on) this.render();
    return this;
  }

  show(section = null) {
    if (section) this.section = section;
    return this.setOpen(true);
  }

  close() { return this.setOpen(false); }
  toggle() { return this.setOpen(!this.open); }

  // ---------------------------------------------------------- render

  render() {
    const pages = this.pages();
    this.tabsEl.replaceChildren(...pages.map((p) => h('button', {
      class: p.id === this.section ? 'active' : '',
      onClick: () => { this.section = p.id; this.render(); },
    }, p.label)));

    const page = pages.find((p) => p.id === this.section) ?? pages[0];
    this.bodyEl.replaceChildren(...page.body());
    this.bodyEl.scrollTop = 0;
    return this;
  }

  pages() {
    return [
      { id: 'start', label: 'はじめに', body: () => this._start() },
      { id: 'editor', label: '編集画面', body: () => this._editor() },
      { id: 'shapes', label: '形', body: () => this._shapes() },
      { id: 'bones', label: 'ボーン', body: () => this._bones() },
      { id: 'equip', label: '装備', body: () => this._equip() },
      { id: 'field', label: 'テスト', body: () => this._field() },
    ];
  }

  // ---------------------------------------------------------- pages

  _start() {
    return [
      h('h4', {}, 'ブロックでロボを組んで、戦わせる'),
      para('画面はふたつあります。'),
      keyTable([
        ['編集', 'ブロックとボーンで機体を組み、装備を貼る'],
        ['テスト', '組んだ機体で実際に飛び、撃ち、戦ってみる'],
        ['パーツ', '部品だけを作り、パーツ庫に貯めて呼び出す'],
      ]),
      h('h4', {}, '最初の一歩'),
      h('ol', { class: 'helplist' },
        h('li', {}, '上の「プリセット」から機体を選ぶ。まずはこれで十分です'),
        h('li', {}, '左の「ブロック」でブロックを、「レッグ」などでボーンを生やす'),
        h('li', {}, '「装備プレート」で武器やブーストを貼る（ブーストが無いとダッシュできません）'),
        h('li', {}, '右上の「テスト」で出撃'),
      ),
      h('h4', {}, '覚えておくと楽なこと'),
      keyTable([
        [['Ctrl', 'Z'], '元に戻す（ほぼ全ての操作が1手で戻せます）'],
        [['Ctrl', 'S'], '保存'],
        ['Esc', 'ツールを解除 → 選択を解除。ウインドウが開いていればそれを閉じる'],
        ['⧉', 'QRコードで機体やパーツを持ち出す・読み込む'],
      ]),
      para('パネルやこのウインドウは、',
        h('b', {}, '縁をドラッグするとサイズを変えられます'),
        '（ダブルクリックで元に戻ります）。'),
    ];
  }

  _editor() {
    return [
      h('h4', {}, 'マウス'),
      keyTable([
        ['左ドラッグ', '視点を回す（ツールを持っている間はそのツールの操作）'],
        ['右ドラッグ', '平行移動'],
        ['ホイール', 'ズーム'],
        ['クリック', 'パーツを置く / 選ぶ'],
        [['Ctrl', 'クリック'], '複数選択'],
      ]),

      h('h4', {}, 'ツール'),
      keyTable([...ASSEMBLE_TOOLS, ...SCULPT_LIST]
        .filter((t) => t.tool)
        .map((t) => [t.key === '—' ? [] : t.key, t.label])),

      h('h4', {}, 'キーボード'),
      keyTable([
        ['矢印', '選んだパーツを画面基準で微調整'],
        [['Shift', '↑↓'], '上下に微調整'],
        [['Alt', '矢印'], 'さらに細かく（0.05刻み）'],
        ['T / R', '移動ギズモ / 回転ギズモ'],
        ['J', '選んだパーツを連結（最後に選んだものと一緒に動く）'],
        [['Shift', 'J'], '連結を解除'],
        ['Del', '選んだパーツを削除（付いているものごと）'],
        [['Ctrl', 'C/X/V'], 'コピー / 切り取り / 貼り付け'],
        [['Ctrl', 'D'], '複製'],
        [['Ctrl', 'A'], '全選択'],
        ['[ ]', '加工ブラシの大きさ'],
      ]),

      h('h4', {}, '寸法と加工'),
      para(`ブロックの寸法は XYZ 個別に ${SIZE_MIN}〜${SIZE_MAX} の範囲で変えられます。`,
        h('br'),
        `中身は 1辺あたり ${VOX_LEVELS.map((n) => `1/${n}`).join('・')} の細かさで削る・盛る・塗るができ、`,
        'ブラシは立方体です。'),
      para('「盛る」でブロックの外側をクリックすると、その方向にブロックが 0.25 伸びます。'),
    ];
  }

  _shapes() {
    return [
      h('h4', {}, `ブロックの形は ${SHAPE_GROUPS.reduce((n, g) => n + g.ids.length, 0)} 種類`),
      para('「ブロック」ツールの「形」で選んでから置くか、',
        '置いたブロックを選んでインスペクタの「形」で後から変えられます。'),
      ...SHAPE_GROUPS.flatMap((g) => [
        h('h5', {}, g.group),
        h('div', { class: 'helpchips' },
          ...g.ids.map((id) => h('span', { class: 'chip' }, SHAPES[id].label))),
      ]),
      h('h4', {}, '知っておくと便利'),
      keyTable([
        ['寸法で伸びる', '球を平たいブロックに入れれば楕円、円柱を潰せば板になります'],
        ['彫れる', 'どの形でも削る・盛る・塗るがそのまま効きます'],
        ['軽くなる', '中身の詰まり具合がそのまま重さです。球は同じ箱の約半分'],
        ['作り直し', '形を変えると中身は作り直されます（彫った跡は消えます）'],
      ]),
    ];
  }

  _bones() {
    return [
      h('h4', {}, '4種類の属性が、動きを決める'),
      keyTable(Object.entries(BONE_META).map(([, m]) => [m.label, m.blurb ?? ''])),
      para('脚の本数で歩き方が決まります：',
        Object.entries(GAIT_LABEL).map(([, v]) => v).join(' / '), '。',
        h('br'), '腿と脛のようにボーンを繋いだ場合も、脚は1本と数えます。'),

      h('h4', {}, '肩・股関節・腰は「効き」と「ずらし」で作る'),
      para('ボーンの種類は増やさず、どのボーンにも2つの数値を持たせてあります。'),
      keyTable([
        ['効き', `その属性の動きをどれだけ取るか。0で固定、1で標準、${BONE_GAIN_MAX}で大振り`],
        ['ずらし', '歩調1周のうちいつ動くか。先端側ほど遅らせるとしなります'],
      ]),
      keyTable([
        ['肩', 'アームボーンを腕の付け根に置き、効きを0.4程度に落とす'],
        ['肘', 'その先にアームボーンを繋ぐだけ（自動で減衰します）'],
        ['股関節', '脚の根元のレッグボーン。効きは標準のまま'],
        ['膝', 'その先のレッグボーン。ずらしを少し入れると脛が振れます'],
        ['腰', 'カスタムボーンで軸「ひねり」、駆動ソース「歩調」'],
      ]),
      para('インスペクタに ',
        h('b', {}, '肩 / 股関節 / しなり / 固定'),
        ' のワンクリック設定があります。'),
    ];
  }

  _equip() {
    const row = (t) => {
      const m = EQUIP_META[t];
      const bits = [];
      if (m.ammo) bits.push(`装弾${m.ammo} / リロード${m.reload}秒`);
      if (m.dps) bits.push(`接触${m.dps}/秒`);
      // Some blurbs already say it; saying it twice reads like a stutter.
      if (m.unique && !m.blurb.includes('1枚')) bits.push('1枚のみ');
      return [
        h('span', { class: 'chip', style: `border-color:${cssHex(m.accent)}` }, m.label),
        h('span', {}, m.blurb, bits.length ? h('em', { class: 'dim' }, ` (${bits.join(' / ')})`) : null),
      ];
    };
    return [
      h('h4', {}, '武器（丸いプレート）'),
      para('複数積んで、テスト中に切り替えて使います。'),
      h('div', { class: 'helpkeys' }, ...WEAPON_TYPES.flatMap((t) => {
        const [a, b] = row(t);
        return [h('div', { class: 'hk' }, a), h('div', { class: 'hv' }, b)];
      })),

      h('h4', {}, 'システム（四角いプレート）'),
      h('div', { class: 'helpkeys' }, ...SYSTEM_TYPES.flatMap((t) => {
        const [a, b] = row(t);
        return [h('div', { class: 'hk' }, a), h('div', { class: 'hv' }, b)];
      })),

      h('h4', {}, '貼る場所が効きます'),
      keyTable([
        ['ブースト', '炎はプレートから出ます。後ろに貼れば前へ、下に貼れば上へ'],
        ['ローリング', '貼った面の向きが回転軸。ブロックごと、載っているものも回ります'],
        ['サークル', '貼った場所が回転の中心。半径の円に入ったパーツがまとめて回ります'],
        ['ブレード', '貼ったブロックが光り、触れた相手を削ります'],
      ]),
      para('グラビティとフロートは正反対なので、同時には付けられません。'),
    ];
  }

  _field() {
    // Straight from the player's OWN bindings, so rebinding a key rewrites
    // the help rather than making it lie.
    const input = this.app.input;
    return [
      h('h4', {}, '操作'),
      ...ACTION_GROUPS.flatMap((g) => [
        h('h5', {}, g.label),
        keyTable(g.actions.map((a) => [
          input.keysFor(a).slice(0, 2).map(keyLabel),
          ACTION_LABEL[a] ?? a,
        ])),
      ]),
      para('割り当ては上部バーの ⌨ から変えられます。ここの表示もそれに追従します。'),
      h('h4', {}, '覚えておくこと'),
      keyTable([
        ['ダッシュ', '移動キーを2回続けて押す'],
        ['ブースト', `${EQUIP_META.boost.label}プレートを付けていないと使えません`],
        ['武器', '装備した武器はサブウエポンのように切り替えて撃ちます'],
        ['Esc', '一時停止（そのまま編集画面へ戻れます）'],
      ]),
    ];
  }
}

const cssHex = (n) => `#${n.toString(16).padStart(6, '0')}`;
