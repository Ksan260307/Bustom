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
import { t } from './i18n.js';

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
        h('button', { class: 'icon', title: t('閉じる'), onClick: () => this.close() }, '✕'),
      ),
      this.tabsEl,
      this.bodyEl,
      h('div', { class: 'keyfoot' },
        h('span', { class: 'keynote' }, t('F1 または ？ で開閉 / Esc で閉じる')),
        h('div', { class: 'spacer' }),
        h('button', { class: 'primary', onClick: () => this.close() }, t('閉じる')),
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
    }, t(p.label))));

    const page = pages.find((p) => p.id === this.section) ?? pages[0];
    this.bodyEl.replaceChildren(...page.body());
    this.bodyEl.scrollTop = 0;
    return this;
  }

  pages() {
    return [
      { id: 'start', label: t('はじめに'), body: () => this._start() },
      { id: 'editor', label: t('編集画面'), body: () => this._editor() },
      { id: 'shapes', label: t('形'), body: () => this._shapes() },
      { id: 'bones', label: t('ボーン'), body: () => this._bones() },
      { id: 'equip', label: t('装備'), body: () => this._equip() },
      { id: 'field', label: t('操作'), body: () => this._field() },
      { id: 'solo', label: t('ソロプレイ'), body: () => this._solo() },
      { id: 'credits', label: t('クレジット'), body: () => this._credits() },
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
      h('h4', {}, t('同梱している素材')),
      para(t('ゲーム内の写真・音・書体は、外部の公開素材を加工して使っています。')),
      h('div', { class: 'helpkeys' },
        ...row(t('天の川'), 'ESO / S. Brunier', 'CC BY 4.0'),
        ...row(t('地球'), 'NASA Earth Observatory (Blue Marble)', t('パブリックドメイン')),
        ...row(t('月面'), 'NASA/GSFC Scientific Visualization Studio', t('パブリックドメイン')),
        ...row(t('空'), 'Greg Zaal, Jarod Guest / Poly Haven', 'CC0'),
        ...row(t('地面・壁'), 'ambientCG', 'CC0'),
        ...row(t('エフェクト'), 'Kenney', 'CC0'),
        ...row(t('効果音'), 'rubberduck / OpenGameArt', 'CC0'),
        ...row(t('書体'), 'Inter, JetBrains Mono', 'SIL OFL 1.1'),
      ),
      para(t('加工の内容と全リンクは、配布物に同梱の LICENSES.md にあります。')),
    ];
  }

  _start() {
    return [
      h('h4', {}, t('ブロックでロボを組んで、戦わせる')),
      para(t('画面は4つあります。')),
      keyTable([
        [t('タイトル'), t('遊びかたを選ぶ入口。組んだ機体がここに立ちます')],
        [t('ソロプレイ'), t('ウェーブで攻めてくる敵を、残機のあるうちに倒し続ける')],
        [t('編集'), t('ブロックとボーンで機体を組み、装備を貼る')],
        [t('テストフィールド'), t('ルール無しの練習場。動きと武器を確かめる')],
        [t('パーツ'), t('部品だけを作り、パーツ庫に貯めて呼び出す')],
      ]),
      h('h4', {}, t('最初の一歩')),
      h('ol', { class: 'helplist' },
        h('li', {}, t('上の「プリセット」から機体を選ぶ。まずはこれで十分です')),
        h('li', {}, t('左の「ブロック」でブロックを、「レッグ」などでボーンを生やす')),
        h('li', {}, t('「装備プレート」で武器やブーストを貼る（ブーストが無いとダッシュできません）')),
        h('li', {}, t('右上の「テスト」で試し撃ち、慣れたら「ソロプレイ」へ')),
      ),
      h('h4', {}, t('覚えておくと楽なこと')),
      keyTable([
        [['Ctrl', 'Z'], t('元に戻す（ほぼ全ての操作が1手で戻せます）')],
        [['Ctrl', 'S'], t('保存')],
        ['Esc', t('ツールを解除 → 選択を解除。ウインドウが開いていればそれを閉じる')],
        ['⧉', t('QRコードで機体やパーツを持ち出す・読み込む')],
      ]),
      para(t('パネルやこのウインドウは、'),
        h('b', {}, t('縁をドラッグするとサイズを変えられます')),
        t('（ダブルクリックで元に戻ります）。')),
    ];
  }

  _editor() {
    return [
      h('h4', {}, t('見えないパーツを選ぶ')),
      para(t('クリックは手前のものしか掴めません。中に隠れたパーツ（外装の中のコアなど）は、'),
        h('b', {}, t('同じ場所をもう一度クリック')), t('すると1枚ずつ奥へ入れ替わります。'),
        t('右パネルの'), h('b', {}, t('「パーツ一覧」')), t('からも直接選べて、こちらは階層も見えます。')),
      keyTable([
        [t('同じ所を再クリック'), t('奥のパーツへ潜る（一周すると手前に戻る）')],
        [t('パーツ一覧'), t('全パーツを親子関係つきで一覧。選ぶとカメラも寄る')],
        ['.', t('選択したパーツにカメラを寄せる')],
        ['Home', t('機体全体が入るところまで引く')],
      ]),
      h('h4', {}, t('マウス')),
      keyTable([
        [t('左ドラッグ'), t('視点を回す（ツールを持っている間はそのツールの操作）')],
        [t('右ドラッグ'), t('平行移動')],
        [t('ホイール'), t('ズーム')],
        [t('クリック'), t('パーツを置く / 選ぶ')],
        [['Ctrl', t('クリック')], t('複数選択')],
      ]),

      h('h4', {}, t('ツール')),
      keyTable([...ASSEMBLE_TOOLS, ...SCULPT_LIST]
        .filter((spec) => spec.tool)
        .map((spec) => [spec.key === '—' ? [] : spec.key, t(spec.label)])),

      h('h4', {}, t('キーボード')),
      keyTable([
        [t('矢印'), t('選んだパーツを画面基準で微調整')],
        [['Shift', '↑↓'], t('上下に微調整')],
        [['Alt', t('矢印')], t('さらに細かく（0.05刻み）')],
        ['T / R', t('移動ギズモ / 回転ギズモ')],
        ['J', t('選んだパーツを連結（最後に選んだものと一緒に動く）')],
        [['Shift', 'J'], t('連結を解除')],
        ['Del', t('選んだパーツを削除（付いているものごと）')],
        [['Ctrl', 'C/X/V'], t('コピー / 切り取り / 貼り付け')],
        [['Ctrl', 'D'], t('複製')],
        [['Ctrl', 'A'], t('全選択')],
        ['[ ]', t('加工ブラシの大きさ')],
      ]),

      h('h4', {}, t('パーツを置く')),
      keyTable([
        [t('面をクリック'), t('押した所にぴったり付く')],
        [t('何もない所をクリック'), t('床の上に浮かせて置く')],
        [['Shift', t('ホイール')], t('浮かせる高さ（0 は床の上）')],
        ['R', t('置く前に向きを 90° 回す')],
        [t('ドラッグ'), t('同じ列に連続で置く')],
        [t('面からの隙間'), t('0 で面にぴったり。空けるとフィンや装甲を重ねられる')],
        [['Alt', t('クリック')], t('そのパーツの形・寸法・色を、これから置くものに写す')],
        [t('右クリック'), t('カーソルの下のパーツを削除')],
      ]),
      para(t('「パーツ庫」の ＜配置＞ を押すと、保存したパーツを置くモードになります。')),

      h('h4', {}, t('連結')),
      para(t('連結すると、'), h('b', {}, t('最後に選んだパーツ')), t('（水色の枠）と一緒に動くように'),
        t('なります。ボーンの先のブロックに連結すれば、その関節で一緒に振れます。'),
        h('br'), t('連動先を変えても'), h('b', {}, t('見た目の位置は動きません')), '。'),

      h('h4', {}, t('そろえる')),
      para(t('「そろえる」の各項目は2つ以上えらんでから。'),
        h('b', {}, t('同じパーツにつながっているもの同士')), t('でだけ働きます。'),
        t('「基準に合わせる」は、最後に選んだパーツ（水色の枠）が基準です。')),

      h('h4', {}, t('寸法と加工')),
      para(t('ブロックの寸法は XYZ 個別に {0}〜{1} の範囲で変えられます。', [SIZE_MIN, SIZE_MAX]),
        h('br'),
        t('中身は 1辺あたり {0} の細かさで削る・盛る・塗るができ、', [VOX_LEVELS.map((n) => `1/${n}`).join('・')]),
        t('ブラシは立方体です。')),
      para(t('「盛る」でブロックの外側をクリックすると、その方向にブロックが 0.25 伸びます。')),
      para(h('b', {}, t('形を変えると、そのブロックの中身は作り直されます')),
        t('（彫った跡は消えます。消える時は確認が出ます）。'),
        h('br'), t('寸法を変えれば、球は楕円に、円柱は角柱のように潰れます。')),
      para(t('角度の数値は '), h('b', {}, 'X → Y → Z'), t(' の順にかかります。'),
        t('親の傾きごと戻したいときは「傾きを戻す」。')),
    ];
  }

  _shapes() {
    return [
      h('h4', {}, t('ブロックの形は {0} 種類', [SHAPE_GROUPS.reduce((n, g) => n + g.ids.length, 0)])),
      para(t('「ブロック」ツールの「形」で選んでから置くか、'),
        t('置いたブロックを選んでインスペクタの「形」で後から変えられます。')),
      ...SHAPE_GROUPS.flatMap((g) => [
        h('h5', {}, t(g.group)),
        h('div', { class: 'helpchips' },
          ...g.ids.map((id) => h('span', { class: 'chip' }, t(SHAPES[id].label)))),
      ]),
      h('h4', {}, t('知っておくと便利')),
      keyTable([
        [t('寸法で伸びる'), t('球を平たいブロックに入れれば楕円、円柱を潰せば板になります')],
        [t('彫れる'), t('どの形でも削る・盛る・塗るがそのまま効きます')],
        [t('軽くなる'), t('中身の詰まり具合がそのまま重さです。球は同じ箱の約半分')],
        [t('作り直し'), t('形を変えると中身は作り直されます（彫った跡は消えます）')],
      ]),
    ];
  }

  _bones() {
    return [
      h('h4', {}, t('属性が、動きを決める')),
      keyTable(Object.entries(BONE_META).map(([, m]) => [t(m.label), t(m.blurb) ?? ''])),
      para(t('脚の本数で歩き方が変わります。'),
        h('br'), t('腿と脛のようにボーンを繋いだ場合も、脚は1本と数えます。'),
        h('br'), t('横にダッシュ以上の速さで流れているときは、'),
        h('b', {}, t('歩かずに脚を寝かせて滑ります')), '。'),

      h('h4', {}, t('肩・股関節・腰は「効き」と「ずらし」で作る')),
      para(t('ボーンの種類は増やさず、どのボーンにも2つの数値を持たせてあります。')),
      keyTable([
        [t('効き'), t('その属性の動きをどれだけ取るか。0で固定、1で標準、{0}で大振り', [BONE_GAIN_MAX])],
        [t('ずらし'), t('歩調1周のうちいつ動くか。先端側ほど遅らせるとしなります')],
      ]),
      keyTable([
        [t('肩'), t('アームボーンを腕の付け根に置き、効きを0.4程度に落とす')],
        [t('肘'), t('その先にアームボーンを繋ぐだけ（自動で減衰します）')],
        [t('股関節'), t('脚の根元のレッグボーン。効きは標準のまま')],
        [t('膝'), t('その先のレッグボーン。ずらしを少し入れると脛が振れます')],
        [t('腰'), t('カスタムボーンで軸「ひねり」、駆動ソース「歩調」')],
      ]),
      para(t('インスペクタに '),
        h('b', {}, t('肩 / 股関節 / しなり / 固定')),
        t(' のワンクリック設定があります。')),

      h('h4', {}, t('画面に出ているもの')),
      keyTable([
        [t('青い弧'), t('可動範囲。関節はボーンの中央にあります')],
        [t('緑の線'), t('実際に動く側（先端半分）')],
      ]),

      h('h4', {}, t('カスタムボーンの波形')),
      keyTable([
        [t('回転'), t('可動域を無視してぐるぐる回り続けます。プロペラやレーダー向け')],
        [t('可動域で止める'), t('回転させたまま、関節の範囲で往復させます')],
        [t('位相ずらし'), t('同じ設定のボーン同士でも動きがそろわず、波打ちます')],
        [t('重ねる動き'), t('大きくゆっくりの上に、小さく速い揺れを足せます')],
        [t('中心角も動かす'), t('基準の角度自体を駆動ソースで動かします（走るほど前傾、など）')],
      ]),

      h('h4', {}, t('何で動かすか')),
      para(t('歩き方だけでなく、戦っている最中の状態でも動かせます。')),
      keyTable([
        [t('歩調 / 速さ'), t('足の運び、地上での速度')],
        [t('ブースト / 噴射'), t('ブーストの出力、スラスターの出力')],
        [t('着地 / 反動 / 被弾'), t('その瞬間だけ跳ねて、すぐ収まります')],
        [t('耐久 / EN'), t('減っているほど大きく動きます')],
        [t('武器切替'), t('持ち替えた瞬間だけ動きます')],
      ]),

      h('h4', {}, t('関節の当たり')),
      keyTable([
        [t('前へ / 後ろへ'), t('別々に決められます。膝は前に深く、後ろはほぼ0')],
        [t('1軸だけ動く'), t('ヒンジになります。横にはぶれません')],
        [t('止まる / 跳ね返る / 回り込む'), t('可動域の端まで来たときの挙動')],
        [t('なじみ / ゆれ戻り'), t('目標の姿勢へどれだけ速く、行き過ぎて戻るか')],
        [t('連動'), t('別のボーンの角度に比例して動きます。開く装甲板などに')],
      ]),
      para(t('関節を撃たれると、そのボーンの効きと可動域が落ちます。')),

      h('h4', {}, t('ウェポンボーン')),
      para(t('決めた武器を選んでいる間だけ「構える角度」に動き、'),
        t('それ以外は「しまう角度」に戻ります。'),
        h('br'), t('切り替えた瞬間だけ動くので、今どれを持っているかが姿勢で分かります。')),

      h('h4', {}, t('編集画面で動かして確かめる')),
      para(t('カスタムボーンかウェポンボーンを選ぶと、'),
        h('b', {}, t('動作テスト')),
        t(' が出ます。走らせる・撃つ・武器を持たせる、を手で流せます。')),
    ];
  }

  _equip() {
    const row = (kind) => {
      const m = EQUIP_META[kind];
      const bits = [];
      if (m.ammo) bits.push(t('装弾{0} / リロード{1}秒', [m.ammo, m.reload]));
      if (m.dps) bits.push(t('接触{0}/秒', [m.dps]));
      // Some blurbs already say it; saying it twice reads like a stutter.
      if (m.unique && !t(m.blurb).includes(t('1枚'))) bits.push(t('1枚のみ'));
      return [
        h('span', { class: 'chip', style: `border-color:${cssHex(m.accent)}` }, t(m.label)),
        h('span', {}, t(m.blurb), bits.length ? h('em', { class: 'dim' }, ` (${bits.join(' / ')})`) : null),
      ];
    };
    return [
      h('h4', {}, t('武器（丸いプレート）')),
      para(t('複数積んで、テスト中に切り替えて使います。')),
      h('div', { class: 'helpkeys' }, ...WEAPON_TYPES.flatMap((kind) => {
        const [a, b] = row(kind);
        return [h('div', { class: 'hk' }, a), h('div', { class: 'hv' }, b)];
      })),

      h('h4', {}, t('システム（四角いプレート）')),
      h('div', { class: 'helpkeys' }, ...SYSTEM_TYPES.flatMap((kind) => {
        const [a, b] = row(kind);
        return [h('div', { class: 'hk' }, a), h('div', { class: 'hv' }, b)];
      })),

      h('h4', {}, t('貼る場所が効きます')),
      keyTable([
        [t('ブースト'), t('炎はプレートから出ます。後ろに貼れば前へ、下に貼れば上へ')],
        [t('ローリング'), t('貼った面の向きが回転軸。ブロックごと、載っているものも回ります')],
        [t('サークル'), t('貼った場所を中心に円線が出ます。下に詳しく')],
        [t('ブレード'), t('貼ったブロックが光り、触れた相手を削ります。持続中はENを消費')],
      ]),
      para(t('グラビティとフロートは正反対なので、同時には付けられません。')),

      h('h4', {}, t('サークルは「線に触れているもの」を回す')),
      para(t('回したいパーツを先に置いてから貼れば、半径は自動で合います。'),
        t('向き・回転方向・半径はインスペクタで変えられます。円線は編集画面だけの表示です。')),
      keyTable([
        [t('回る'), t('円線に触れているパーツ（別のブロックに付いていても構いません）')],
        [t('回らない'), t('円の内側にあるもの / 線から高さがずれているもの')],
        [t('対象外'), t('プレートより先の関節にぶら下がっているもの')],
      ]),
    ];
  }

  _field() {
    // Straight from the player's OWN bindings, so rebinding a key rewrites
    // the help rather than making it lie.
    const input = this.app.input;
    return [
      h('h4', {}, t('操作')),
      ...ACTION_GROUPS.flatMap((g) => [
        h('h5', {}, t(g.label)),
        keyTable(g.actions.map((a) => [
          input.keysFor(a).slice(0, 2).map(keyLabel),
          t(ACTION_LABEL[a] ?? a),
        ])),
      ]),
      para(t('割り当ては上部バーの ⌨ から変えられます。ここの表示もそれに追従します。')),
      h('h4', {}, t('覚えておくこと')),
      keyTable([
        [t('ダッシュ'), t('移動キーを2回続けて押す')],
        [t('ブースト'), t('{0}プレートを付けていないと使えません', [t(EQUIP_META.boost.label)])],
        [t('武器'), t('装備した武器はサブウエポンのように切り替えて撃ちます')],
        ['Esc', t('一時停止（そのまま編集画面やタイトルへ戻れます）')],
      ]),
      // Generated from the arenas themselves, so adding a place adds a row
      // here rather than leaving this list quietly out of date.
      h('h4', {}, t('戦う場所')),
      para(t('テストフィールドでは、上部バーか一時停止画面から場所を選べます。')
        + t('重力も場所ごとに違います。')),
      keyTable(ARENA_ORDER.map((id) => [t(ARENAS[id].label), t(ARENAS[id].blurb)])),
      h('h4', {}, t('撃たせない')),
      para(t('テストフィールドでは、敵に撃たせないようにできます。')
        + t('敵は動きも回避もしますが、引き金だけ引きません。歩き方や見た目を')
        + t('確かめたいときのためのものです。ソロプレイでは使えません。')),
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
      const names = [...new Set(specs.map((x) => t(x.label)))].join(' / ');
      return [`WAVE ${n}`, t('{0}機（{1}）{2}', [specs.length, names, specs[0].ace ? ' ＋ 強化個体' : ''])];
    });
    return [
      h('h4', {}, t('難易度')),
      para(t('タイトルの「ソロプレイ」で '), h('b', {}, '←→'), t(' を押すと変わります。'),
        h('br'), t('5段階の違いは主に'), h('b', {}, t('上がり方の速さ')), t('です — '),
        t('最初の強さはどれも似ていて、終盤がまったく違います。'),
        t('敵の強さは1つの数字で、ウェーブとともに上がります（HUDに ×n.n で出ます）。')),
      keyTable(DIFFICULTY_ORDER.map((id) => {
        const d = DIFFICULTIES[id];
        return [t(d.label), t('残機{0} ・ W1で ×{1}', [d.lives, powerAt(id, 1).toFixed(1)])
          + t(' → W{0}で ×{1}', [SOLO_WAVES, powerAt(id, SOLO_WAVES).toFixed(1)])
          + t(' ・ スコア{0}倍', [d.score])];
      })),
      para(t('上がるのは'), h('b', {}, t('耐久と与ダメージの両方')), t('です。'),
        t('耐久だけ上げると戦いが長くなるだけで、与ダメージだけ上げると一瞬で終わるので、'),
        t('与ダメージのほうは耐久より控えめに動きます。')),

      h('h4', {}, t('ステージを順に上がる')),
      para(t('ランは'), h('b', {}, t('{0}ステージ', [SOLO_STAGES.length])),
        t('を順に進みます。各ステージは数ウェーブで、全部倒すと次の場所へ移ります。'),
        h('br'), t('残機とスコアは持ち越し、ウェーブ番号もリセットされません — '),
        t('足場が変わりながら、圧力は上がり続けます。')),
      keyTable(SOLO_STAGES.map((st, i) => [
        `STAGE ${i + 1}`, t('{0}（{1}ウェーブ）', [t(ARENAS[st.arena].label), st.waves]),
      ])),
      h('h4', {}, t('ウェーブの中身')),
      para(t('進むほど数が増え、1機あたりも硬くなり、そして'),
        h('b', {}, t('出てくる機体が大きくなります')), '。',
        t('序盤は極小のドローン、終盤は超大型が先頭に立ちます。')),
      keyTable(waves),
      keyTable(SIZE_CLASSES.map((size) => [
        t(SIZE_HELP[size]),
        presetsOfSize(size).map((id) => t(PRESETS[id].label)).join(' / '),
      ])),
      h('h4', {}, t('残機とスコア')),
      keyTable([
        [t('残機'), t('{0}機。やられるたびに1つ減り、0になった時点で終了', [SOLO_RULES.lives])],
        [t('ウェーブ突破'), t('機体が少し修復され、弾も補充されます')],
        [t('全ステージ突破'), t('ALL CLEAR。{0} 点', [SOLO_RULES.clearBonus.toLocaleString('en-US')])],
        [t('スコア'), t('撃破ごとに加算（後半のウェーブほど高い）＋ウェーブ突破ボーナス')],
        [t('強化個体'), t('{0}ウェーブごとに1機。硬いぶん撃破点は{1}倍', [SOLO_RULES.aceEvery, SOLO_RULES.aceScore])],
        [t('記録'), t('ベストスコアはタイトル画面に残ります')],
      ]),
      h('h4', {}, t('持ち込む機体')),
      para(t('編集画面で組んだ機体がそのまま出ます。'),
        h('b', {}, t('武器を積んでいないと素の機関砲だけ')),
        t('になるので、出撃前に装備プレートを確認してください。')),
      keyTable([
        ['Esc', t('一時停止。最初からやり直す・タイトルへ戻る')],
        [t('やり直し'), t('毎回ちがう試合になります（同じ乱数の引き直し）')],
      ]),
    ];
  }
}

const cssHex = (n) => `#${n.toString(16).padStart(6, '0')}`;
