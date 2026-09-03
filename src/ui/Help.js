import { h, resizable } from './dom.js';
import {
  BONE_META, EQUIP_META, WEAPON_TYPES, SYSTEM_TYPES, VOX_LEVELS,
  SIZE_MIN, SIZE_MAX, BONE_GAIN_MAX,
} from '../core/constants.js';
import { SHAPE_GROUPS, SHAPES } from '../core/Shapes.js';
import { ACTION_GROUPS, ACTION_LABEL, keyLabel } from '../zmf/InputManager.js';
import {
  SoloRun, SOLO_RULES, SOLO_STAGES, SOLO_WAVES,
  DIFFICULTIES, DIFFICULTY_ORDER, powerAt,
} from '../game/SoloRun.js';
import { PRESETS, SIZE_CLASSES, presetsOfSize } from '../core/Assembly.js';

/** What each size class is called where a player will read it. */
const SIZE_HELP = {
  tiny: '極小', small: '小型', medium: '中型', large: '大型', huge: '超大型',
};
import { ARENAS, ARENA_ORDER } from '../game/Arenas.js';
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
        h('div', { class: 'brand' }, 'HELP', h('small', {}, 'BLOSTOM')),
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
      { id: 'field', label: '操作', body: () => this._field() },
      { id: 'solo', label: 'ソロプレイ', body: () => this._solo() },
      { id: 'credits', label: 'クレジット', body: () => this._credits() },
    ];
  }

  // ---------------------------------------------------------- pages

  /**
   * Who made the pictures.
   *
   * Most of what this game ships is CC0, which asks for nothing. The Milky
   * Way is not: it is CC BY 4.0, and that licence wants the credit shown to
   * the people looking at it rather than filed in a text file they will
   * never open. So it lives here, on a page anyone can reach.
   *
   * If this page goes, the sky has to go with it.
   */
  _credits() {
    const row = (what, who, link) => [
      h('span', { class: 'hk' }, what),
      h('span', { class: 'hv' }, who, link ? h('em', { class: 'dim' }, ` — ${link}`) : null),
    ];
    return [
      h('h4', {}, '同梱している素材'),
      para('ゲーム内の写真・音・書体は、外部の公開素材を加工して使っています。'),
      h('div', { class: 'helpkeys' },
        ...row('天の川', 'ESO / S. Brunier', 'CC BY 4.0'),
        ...row('地球', 'NASA Earth Observatory (Blue Marble)', 'パブリックドメイン'),
        ...row('月面', 'NASA/GSFC Scientific Visualization Studio', 'パブリックドメイン'),
        ...row('空', 'Greg Zaal, Jarod Guest / Poly Haven', 'CC0'),
        ...row('地面・壁', 'ambientCG', 'CC0'),
        ...row('エフェクト', 'Kenney', 'CC0'),
        ...row('効果音', 'rubberduck / OpenGameArt', 'CC0'),
        ...row('書体', 'Inter, JetBrains Mono', 'SIL OFL 1.1'),
      ),
      para('加工の内容と全リンクは、配布物に同梱の LICENSES.md にあります。'),
    ];
  }

  _start() {
    return [
      h('h4', {}, 'ブロックでロボを組んで、戦わせる'),
      para('画面は4つあります。'),
      keyTable([
        ['タイトル', '遊びかたを選ぶ入口。組んだ機体がここに立ちます'],
        ['ソロプレイ', 'ウェーブで攻めてくる敵を、残機のあるうちに倒し続ける'],
        ['編集', 'ブロックとボーンで機体を組み、装備を貼る'],
        ['テストフィールド', 'ルール無しの練習場。動きと武器を確かめる'],
        ['パーツ', '部品だけを作り、パーツ庫に貯めて呼び出す'],
      ]),
      h('h4', {}, '最初の一歩'),
      h('ol', { class: 'helplist' },
        h('li', {}, '上の「プリセット」から機体を選ぶ。まずはこれで十分です'),
        h('li', {}, '左の「ブロック」でブロックを、「レッグ」などでボーンを生やす'),
        h('li', {}, '「装備プレート」で武器やブーストを貼る（ブーストが無いとダッシュできません）'),
        h('li', {}, '右上の「テスト」で試し撃ち、慣れたら「ソロプレイ」へ'),
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
      h('h4', {}, '見えないパーツを選ぶ'),
      para('クリックは手前のものしか掴めません。中に隠れたパーツ（外装の中のコアなど）は、',
        h('b', {}, '同じ場所をもう一度クリック'), 'すると1枚ずつ奥へ入れ替わります。',
        '右パネルの', h('b', {}, '「パーツ一覧」'), 'からも直接選べて、こちらは階層も見えます。'),
      keyTable([
        ['同じ所を再クリック', '奥のパーツへ潜る（一周すると手前に戻る）'],
        ['パーツ一覧', '全パーツを親子関係つきで一覧。選ぶとカメラも寄る'],
        ['.', '選択したパーツにカメラを寄せる'],
        ['Home', '機体全体が入るところまで引く'],
      ]),
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

      h('h4', {}, 'パーツを置く'),
      keyTable([
        ['面をクリック', '押した所にぴったり付く'],
        ['何もない所をクリック', '床の上に浮かせて置く'],
        [['Shift', 'ホイール'], '浮かせる高さ（0 は床の上）'],
        ['R', '置く前に向きを 90° 回す'],
        ['ドラッグ', '同じ列に連続で置く'],
        ['面からの隙間', '0 で面にぴったり。空けるとフィンや装甲を重ねられる'],
        [['Alt', 'クリック'], 'そのパーツの形・寸法・色を、これから置くものに写す'],
        ['右クリック', 'カーソルの下のパーツを削除'],
      ]),
      para('「パーツ庫」の ＜配置＞ を押すと、保存したパーツを置くモードになります。'),

      h('h4', {}, '連結'),
      para('連結すると、', h('b', {}, '最後に選んだパーツ'), '（水色の枠）と一緒に動くように',
        'なります。ボーンの先のブロックに連結すれば、その関節で一緒に振れます。',
        h('br'), '連動先を変えても', h('b', {}, '見た目の位置は動きません'), '。'),

      h('h4', {}, 'そろえる'),
      para('「そろえる」の各項目は2つ以上えらんでから。',
        h('b', {}, '同じパーツにつながっているもの同士'), 'でだけ働きます。',
        '「基準に合わせる」は、最後に選んだパーツ（水色の枠）が基準です。'),

      h('h4', {}, '寸法と加工'),
      para(`ブロックの寸法は XYZ 個別に ${SIZE_MIN}〜${SIZE_MAX} の範囲で変えられます。`,
        h('br'),
        `中身は 1辺あたり ${VOX_LEVELS.map((n) => `1/${n}`).join('・')} の細かさで削る・盛る・塗るができ、`,
        'ブラシは立方体です。'),
      para('「盛る」でブロックの外側をクリックすると、その方向にブロックが 0.25 伸びます。'),
      para(h('b', {}, '形を変えると、そのブロックの中身は作り直されます'),
        '（彫った跡は消えます。消える時は確認が出ます）。',
        h('br'), '寸法を変えれば、球は楕円に、円柱は角柱のように潰れます。'),
      para('角度の数値は ', h('b', {}, 'X → Y → Z'), ' の順にかかります。',
        '親の傾きごと戻したいときは「世界の軸」。'),
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
      h('h4', {}, '属性が、動きを決める'),
      keyTable(Object.entries(BONE_META).map(([, m]) => [m.label, m.blurb ?? ''])),
      para('脚の本数で歩き方が変わります。',
        h('br'), '腿と脛のようにボーンを繋いだ場合も、脚は1本と数えます。',
        h('br'), '横にダッシュ以上の速さで流れているときは、',
        h('b', {}, '歩かずに脚を寝かせて滑ります'), '。'),

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

      h('h4', {}, '画面に出ているもの'),
      keyTable([
        ['青い弧', '可動範囲。関節はボーンの中央にあります'],
        ['緑の線', '実際に動く側（先端半分）'],
      ]),

      h('h4', {}, 'カスタムボーンの波形'),
      keyTable([
        ['回転', '可動域を無視してぐるぐる回り続けます。プロペラやレーダー向け'],
        ['可動域で止める', '回転させたまま、関節の範囲で往復させます'],
        ['位相ずらし', '同じ設定のボーン同士でも動きがそろわず、波打ちます'],
        ['重ねる動き', '大きくゆっくりの上に、小さく速い揺れを足せます'],
        ['中心角も動かす', '基準の角度自体を駆動ソースで動かします（走るほど前傾、など）'],
      ]),

      h('h4', {}, '何で動かすか'),
      para('歩き方だけでなく、戦っている最中の状態でも動かせます。'),
      keyTable([
        ['歩調 / 速さ', '足の運び、地上での速度'],
        ['ブースト / 噴射', 'ブーストの出力、スラスターの出力'],
        ['着地 / 反動 / 被弾', 'その瞬間だけ跳ねて、すぐ収まります'],
        ['耐久 / EN', '減っているほど大きく動きます'],
        ['武器切替', '持ち替えた瞬間だけ動きます'],
      ]),

      h('h4', {}, '関節の当たり'),
      keyTable([
        ['前へ / 後ろへ', '別々に決められます。膝は前に深く、後ろはほぼ0'],
        ['1軸だけ動く', 'ヒンジになります。横にはぶれません'],
        ['止まる / 跳ね返る / 回り込む', '可動域の端まで来たときの挙動'],
        ['なじみ / ゆれ戻り', '目標の姿勢へどれだけ速く、行き過ぎて戻るか'],
        ['連動', '別のボーンの角度に比例して動きます。開く装甲板などに'],
      ]),
      para('関節を撃たれると、そのボーンの効きと可動域が落ちます。'),

      h('h4', {}, 'ウェポンボーン'),
      para('決めた武器を選んでいる間だけ「構える角度」に動き、',
        'それ以外は「しまう角度」に戻ります。',
        h('br'), '切り替えた瞬間だけ動くので、今どれを持っているかが姿勢で分かります。'),

      h('h4', {}, '編集画面で動かして確かめる'),
      para('カスタムボーンかウェポンボーンを選ぶと、',
        h('b', {}, '動作テスト'),
        ' が出ます。走らせる・撃つ・武器を持たせる、を手で流せます。'),
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
        ['サークル', '貼った場所を中心に円線が出ます。下に詳しく'],
        ['ブレード', '貼ったブロックが光り、触れた相手を削ります'],
      ]),
      para('グラビティとフロートは正反対なので、同時には付けられません。'),

      h('h4', {}, 'サークルは「線に触れているもの」を回す'),
      para('回したいパーツを先に置いてから貼れば、半径は自動で合います。',
        '向き・回転方向・半径はインスペクタで変えられます。円線は編集画面だけの表示です。'),
      keyTable([
        ['回る', '円線に触れているパーツ（別のブロックに付いていても構いません）'],
        ['回らない', '円の内側にあるもの / 線から高さがずれているもの'],
        ['対象外', 'プレートより先の関節にぶら下がっているもの'],
      ]),
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
        ['Esc', '一時停止（そのまま編集画面やタイトルへ戻れます）'],
      ]),
      // Generated from the arenas themselves, so adding a place adds a row
      // here rather than leaving this list quietly out of date.
      h('h4', {}, '戦う場所'),
      para('テストフィールドでは、上部バーか一時停止画面から場所を選べます。'
        + '重力も場所ごとに違います。'),
      keyTable(ARENA_ORDER.map((id) => [ARENAS[id].label, ARENAS[id].blurb])),
      h('h4', {}, '撃たせない'),
      para('テストフィールドでは、敵に撃たせないようにできます。'
        + '敵は動きも回避もしますが、引き金だけ引きません。歩き方や見た目を'
        + '確かめたいときのためのものです。ソロプレイでは使えません。'),
    ];
  }

  /**
   * The rules of a run. Numbers that the game actually runs on are pulled
   * from the run itself rather than typed in here, for the same reason the
   * rest of this file is generated: help that repeats a number by hand is
   * help that is wrong the next time the number changes.
   */
  _solo() {
    const waves = [1, 3, 5, 8].map((n) => {
      const specs = SoloRun.waveSpecs(n);
      const names = [...new Set(specs.map((x) => x.label))].join(' / ');
      return [`WAVE ${n}`, `${specs.length}機（${names}）${specs[0].ace ? ' ＋ 強化個体' : ''}`];
    });
    return [
      h('h4', {}, '難易度'),
      para('タイトルの「ソロプレイ」で ', h('b', {}, '←→'), ' を押すと変わります。',
        h('br'), '5段階の違いは主に', h('b', {}, '上がり方の速さ'), 'です — ',
        '最初の強さはどれも似ていて、終盤がまったく違います。',
        '敵の強さは1つの数字で、ウェーブとともに上がります（HUDに ×n.n で出ます）。'),
      keyTable(DIFFICULTY_ORDER.map((id) => {
        const d = DIFFICULTIES[id];
        return [d.label, `残機${d.lives} ・ W1で ×${powerAt(id, 1).toFixed(1)}`
          + ` → W${SOLO_WAVES}で ×${powerAt(id, SOLO_WAVES).toFixed(1)}`
          + ` ・ スコア${d.score}倍`];
      })),
      para('上がるのは', h('b', {}, '耐久と与ダメージの両方'), 'です。',
        '耐久だけ上げると戦いが長くなるだけで、与ダメージだけ上げると一瞬で終わるので、',
        '与ダメージのほうは耐久より控えめに動きます。'),

      h('h4', {}, 'ステージを順に上がる'),
      para('ランは', h('b', {}, `${SOLO_STAGES.length}ステージ`),
        'を順に進みます。各ステージは数ウェーブで、全部倒すと次の場所へ移ります。',
        h('br'), '残機とスコアは持ち越し、ウェーブ番号もリセットされません — ',
        '足場が変わりながら、圧力は上がり続けます。'),
      keyTable(SOLO_STAGES.map((st, i) => [
        `STAGE ${i + 1}`, `${ARENAS[st.arena].label}（${st.waves}ウェーブ）`,
      ])),
      h('h4', {}, 'ウェーブの中身'),
      para('進むほど数が増え、1機あたりも硬くなり、そして',
        h('b', {}, '出てくる機体が大きくなります'), '。',
        '序盤は極小のドローン、終盤は超大型が先頭に立ちます。'),
      keyTable(waves),
      keyTable(SIZE_CLASSES.map((size) => [
        SIZE_HELP[size],
        presetsOfSize(size).map((id) => PRESETS[id].label).join(' / '),
      ])),
      h('h4', {}, '残機とスコア'),
      keyTable([
        ['残機', `${SOLO_RULES.lives}機。やられるたびに1つ減り、0になった時点で終了`],
        ['ウェーブ突破', '機体が少し修復され、弾も補充されます'],
        ['全ステージ突破', `ALL CLEAR。${SOLO_RULES.clearBonus.toLocaleString('en-US')} 点`],
        ['スコア', '撃破ごとに加算（後半のウェーブほど高い）＋ウェーブ突破ボーナス'],
        ['強化個体', `${SOLO_RULES.aceEvery}ウェーブごとに1機。硬いぶん撃破点は${SOLO_RULES.aceScore}倍`],
        ['記録', 'ベストスコアはタイトル画面に残ります'],
      ]),
      h('h4', {}, '持ち込む機体'),
      para('編集画面で組んだ機体がそのまま出ます。',
        h('b', {}, '武器を積んでいないと素の機関砲だけ'),
        'になるので、出撃前に装備プレートを確認してください。'),
      keyTable([
        ['Esc', '一時停止。最初からやり直す・タイトルへ戻る'],
        ['やり直し', '毎回ちがう試合になります（同じ乱数の引き直し）'],
      ]),
    ];
  }
}

const cssHex = (n) => `#${n.toString(16).padStart(6, '0')}`;
