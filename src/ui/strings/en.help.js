// ============================================================
//  The help screen, in English.
//
//  This is the only prose in the game, and it is written the way the
//  Japanese is written: it explains what a thing IS and why you would want
//  it, not which button does it. The button is on the button.
//
//  Two things to watch when editing:
//
//  - MANY OF THESE ARE SENTENCE FRAGMENTS. The help emphasises words in
//    the middle of a sentence by splitting it, so 「② 円の」/「中」/「に置いて
//    ある…」 are three strings that must join back up. English word order
//    moves the emphasis, so each fragment is translated to sit in the same
//    slot rather than to read well alone. Read the neighbours before
//    changing one.
//
//  - NUMBERS COME FROM THE TABLES. `{0}` here is filled with the real
//    BONE_GAIN_MAX, the real stage count, the real bonus — the help has
//    never restated a number by hand and must not start.
// ============================================================

export const HELP = {

  // ---- chrome
  '閉じる': 'Close',
  'F1 または ？ で開閉 / Esc で閉じる': 'F1 or ？ opens and closes ・ Esc closes',
  はじめに: 'Start here',
  編集画面: 'Workbench',
  装備: 'Equipment',
  操作: 'Controls',
  'ソロプレイ': 'Solo',
  'クレジット': 'Credits',

  // ---- credits
  '同梱している素材': 'What is bundled',
  'ゲーム内の写真・音・書体は、外部の公開素材を加工して使っています。':
    'The photographs, sounds and typefaces in the game are made from freely published material.',
  '天の川': 'Milky Way',
  地球: 'Earth',
  'パブリックドメイン': 'Public domain',
  月面: 'Moon',
  空: 'Sky',
  '地面・壁': 'Ground and walls',
  'エフェクト': 'Effects',
  効果音: 'Sound',
  書体: 'Typefaces',
  '加工の内容と全リンクは、配布物に同梱の LICENSES.md にあります。':
    'What was changed, and every link, is in LICENSES.md beside the game.',

  // ---- the four screens
  'ブロックでロボを組んで、戦わせる': 'Build a robot out of blocks, then fight with it',
  '画面は4つあります。': 'There are four screens.',
  'タイトル': 'Title',
  '遊びかたを選ぶ入口。組んだ機体がここに立ちます': 'The way in. Your machine stands here',
  'ウェーブで攻めてくる敵を、残機のあるうちに倒し続ける':
    'Waves of opponents, for as long as your lives hold out',
  'ブロックとボーンで機体を組み、装備を貼る': 'Build with blocks and bones, then stick equipment on',
  'テストフィールド': 'Test field',
  'ルール無しの練習場。動きと武器を確かめる': 'No rules. Check how it moves and what it fires',
  '部品だけを作り、パーツ庫に貯めて呼び出す': 'Make a part on its own, keep it, use it again',

  // ---- first steps
  '最初の一歩': 'The first few minutes',
  '上の「プリセット」から機体を選ぶ。まずはこれで十分です':
    'Pick a machine from “Presets” at the top. That is enough to start with',
  '左の「ブロック」でブロックを、「レッグ」などでボーンを生やす':
    'Add blocks with “Block” on the left, and bones with “Leg” and the rest',
  '「装備プレート」で武器やブーストを貼る（ブーストが無いとダッシュできません）':
    'Stick weapons and boosters on with “Plates” — without a booster you cannot dash',
  '右上の「テスト」で試し撃ち、慣れたら「ソロプレイ」へ':
    'Try it with “Test” at the top right, then go to Solo when it feels right',

  '覚えておくと楽なこと': 'Worth knowing early',
  '元に戻す（ほぼ全ての操作が1手で戻せます）': 'Undo — nearly everything comes back in one press',
  保存: 'Save',
  'ツールを解除 → 選択を解除。ウインドウが開いていればそれを閉じる':
    'Drop the tool, then the selection. Closes a window first if one is open',
  'QRコードで機体やパーツを持ち出す・読み込む': 'Carry a machine or a part out, and back in, by QR code',
  'パネルやこのウインドウは、': 'The panels and this window ',
  '縁をドラッグするとサイズを変えられます': 'resize by dragging an edge',
  '（ダブルクリックで元に戻ります）。': ' — double-click puts one back.',

  // ---- reaching what you cannot see
  '見えないパーツを選ぶ': 'Selecting what you cannot see',
  'クリックは手前のものしか掴めません。中に隠れたパーツ（外装の中のコアなど）は、':
    'A click only takes the nearest thing. For a part buried inside — a core under its armour — ',
  '同じ場所をもう一度クリック': 'click the same spot again',
  'すると1枚ずつ奥へ入れ替わります。': ' and the selection steps one layer deeper each time.',
  '右パネルの': 'The ',
  '「パーツ一覧」': '“All parts”',
  'からも直接選べて、こちらは階層も見えます。':
    ' list on the right reaches them directly, and shows the hierarchy as well.',
  '奥のパーツへ潜る（一周すると手前に戻る）': 'Step deeper — it comes back to the front after the last one',
  '全パーツを親子関係つきで一覧。選ぶとカメラも寄る':
    'Every part, with what it hangs from. Selecting one brings the camera to it',
  '選択したパーツにカメラを寄せる': 'Bring the camera to the selection',
  '機体全体が入るところまで引く': 'Pull back until the whole machine fits',

  // ---- mouse and keys
  'マウス': 'Mouse',
  '視点を回す（ツールを持っている間はそのツールの操作）':
    'Turn the view — or use the tool, while you are holding one',
  'ホイール': 'Wheel',
  'ズーム': 'Zoom',
  'パーツを置く / 選ぶ': 'Place / select',
  'ツール': 'Tools',
  'キーボード': 'Keyboard',
  矢印: 'Arrows',
  '選んだパーツを画面基準で微調整': 'Nudge the selection, in screen terms',
  '上下に微調整': 'Nudge up and down',
  'さらに細かく（0.05刻み）': 'Finer still — 0.05 a step',
  '移動ギズモ / 回転ギズモ': 'Move gizmo / rotate gizmo',
  '選んだパーツを連結（最後に選んだものと一緒に動く）':
    'Attach the selection — it now moves with whatever was selected last',
  '連結を解除': 'Detach',
  '選んだパーツを削除（付いているものごと）': 'Delete the selection, and everything on it',
  'コピー / 切り取り / 貼り付け': 'Copy / cut / paste',
  '加工ブラシの大きさ': 'Sculpt brush size',

  // ---- placing
  'パーツを置く': 'Placing parts',
  '面をクリック': 'Click a face',
  '押した所にぴったり付く': 'Sits flush where you pressed',
  '何もない所をクリック': 'Click empty space',
  '床の上に浮かせて置く': 'Floats it above the floor',
  '浮かせる高さ（0 は床の上）': 'How high it floats — 0 is on the floor',
  '置く前に向きを 90° 回す': 'Turn it 90° before it lands',
  '同じ列に連続で置く': 'Lay a row of them',
  '0 で面にぴったり。空けるとフィンや装甲を重ねられる':
    '0 sits flush. Leave a gap and fins or armour can overlap',
  'そのパーツの形・寸法・色を、これから置くものに写す':
    'Takes that part’s shape, size and colour for the next one',
  'カーソルの下のパーツを削除': 'Delete the part under the cursor',
  '「パーツ庫」の ＜配置＞ を押すと、保存したパーツを置くモードになります。':
    '＜Place＞ in the parts store puts you in the mode for placing a saved part.',

  // ---- attaching
  '連結すると、': 'Attaching makes a part move with ',
  '最後に選んだパーツ': 'whatever was selected last',
  '（水色の枠）と一緒に動くように': ' — the blue outline.',
  'なります。ボーンの先のブロックに連結すれば、その関節で一緒に振れます。':
    ' Attach to a block past a bone and it swings on that joint too.',
  '連動先を変えても': 'Changing what it hangs from ',
  '見た目の位置は動きません': 'does not move it on screen',
  '「そろえる」の各項目は2つ以上えらんでから。': 'Everything under “Align” needs two or more selected.',
  '同じパーツにつながっているもの同士': 'Only parts sharing a parent',
  'でだけ働きます。': ' can be aligned together.',
  '「基準に合わせる」は、最後に選んだパーツ（水色の枠）が基準です。':
    'For “Match a reference”, the reference is the part selected last — the blue outline.',

  // ---- size and sculpting
  '寸法と加工': 'Size and sculpting',
  'ブロックの寸法は XYZ 個別に {0}〜{1} の範囲で変えられます。':
    'A block’s X, Y and Z each run from {0} to {1}, independently.',
  '中身は 1辺あたり {0} の細かさで削る・盛る・塗るができ、':
    'Its inside can be carved, grown and painted at {0} cells to a side, ',
  'ブラシは立方体です。': 'with a cube-shaped brush.',
  '「盛る」でブロックの外側をクリックすると、その方向にブロックが 0.25 伸びます。':
    'Clicking outside the block with “Add” grows it 0.25 that way.',
  '形を変えると、そのブロックの中身は作り直されます':
    'Changing the shape re-cuts the inside of that block',
  '（彫った跡は消えます。消える時は確認が出ます）。':
    ' — carving is lost, and you are asked first.',
  '寸法を変えれば、球は楕円に、円柱は角柱のように潰れます。':
    'Resize and a sphere becomes an ellipsoid, a cylinder flattens into a slab.',
  '角度の数値は ': 'The angles apply in ',
  ' の順にかかります。': ' order.',
  '親の傾きごと戻したいときは「傾きを戻す」。':
    'To clear the parent’s tilt along with it, use “Clear rotation”.',

  'ブロックの形は {0} 種類': 'There are {0} block shapes',
  '「ブロック」ツールの「形」で選んでから置くか、': 'Pick one under “Shape” in the Block tool before placing, or ',
  '置いたブロックを選んでインスペクタの「形」で後から変えられます。':
    'select a placed block and change it under “Shape” in the inspector.',
  '知っておくと便利': 'Worth knowing',
  '寸法で伸びる': 'They stretch',
  '球を平たいブロックに入れれば楕円、円柱を潰せば板になります':
    'A sphere in a flat block is an ellipsoid; a squashed cylinder is a plate',
  '彫れる': 'They carve',
  'どの形でも削る・盛る・塗るがそのまま効きます': 'Carve, add and paint work on every shape',
  '軽くなる': 'They weigh less',
  '中身の詰まり具合がそのまま重さです。球は同じ箱の約半分':
    'How full the inside is IS the weight. A sphere is about half its box',
  '作り直し': 'Re-cut',
  '形を変えると中身は作り直されます（彫った跡は消えます）':
    'Changing the shape re-cuts the inside, and carving is lost',

  // ---- bones
  '属性が、動きを決める': 'What a bone is decides how it moves',
  '脚の本数で歩き方が変わります。': 'How many legs there are changes the walk.',
  '腿と脛のようにボーンを繋いだ場合も、脚は1本と数えます。':
    'A thigh and a shin chained together still count as one leg.',
  '横にダッシュ以上の速さで流れているときは、': 'Moving sideways faster than a dash, ',
  '歩かずに脚を寝かせて滑ります': 'it stops walking, lays the legs down and slides',
  '肩・股関節・腰は「効き」と「ずらし」で作る':
    'Shoulders, hips and waists are made from “Gain” and “Lag”',
  'ボーンの種類は増やさず、どのボーンにも2つの数値を持たせてあります。':
    'Rather than more kinds of bone, every bone carries these two numbers.',
  'その属性の動きをどれだけ取るか。0で固定、1で標準、{0}で大振り':
    'How much of that motion it takes. 0 is locked, 1 is normal, {0} is a full swing',
  '歩調1周のうちいつ動くか。先端側ほど遅らせるとしなります':
    'When in the stride it moves. Delay it further out and the limb whips',
  'アームボーンを腕の付け根に置き、効きを0.4程度に落とす':
    'An arm bone at the root of the arm, gain down around 0.4',
  肘: 'Elbow',
  'その先にアームボーンを繋ぐだけ（自動で減衰します）':
    'Just chain another arm bone past it — it falls off on its own',
  '脚の根元のレッグボーン。効きは標準のまま': 'A leg bone at the root of the leg, gain left at normal',
  膝: 'Knee',
  'その先のレッグボーン。ずらしを少し入れると脛が振れます':
    'The leg bone past it. A little lag and the shin swings',
  'カスタムボーンで軸「ひねり」、駆動ソース「歩調」':
    'A custom bone, axis “Twist”, driven by “Stride”',
  'インスペクタに ': 'The inspector has one-click ',
  '肩 / 股関節 / しなり / 固定': 'Shoulder / Hip / Whip / Fixed',
  ' のワンクリック設定があります。': ' settings.',

  '画面に出ているもの': 'What is drawn',
  '青い弧': 'Blue arc',
  '可動範囲。関節はボーンの中央にあります': 'The range. The joint is at the bone’s middle',
  '緑の線': 'Green line',
  '実際に動く側（先端半分）': 'The half that actually moves — the tip half',
  'カスタムボーンの波形': 'What a custom bone can do',
  '可動域を無視してぐるぐる回り続けます。プロペラやレーダー向け':
    'Ignores the range and turns for ever. For propellers and radars',
  '回転させたまま、関節の範囲で往復させます': 'Keeps turning, but sweeps back and forth inside the range',
  '同じ設定のボーン同士でも動きがそろわず、波打ちます':
    'Bones on the same settings stop moving together, and ripple',
  '大きくゆっくりの上に、小さく速い揺れを足せます': 'Adds a small fast shake on top of a big slow one',
  '基準の角度自体を駆動ソースで動かします（走るほど前傾、など）':
    'Moves the centre angle itself from a source — leaning further the faster it runs, say',

  '何で動かすか': 'What drives it',
  '歩き方だけでなく、戦っている最中の状態でも動かせます。':
    'Not only the walk — anything about the state of a fight can drive a bone.',
  '歩調 / 速さ': 'Stride / speed',
  '足の運び、地上での速度': 'The step itself, and how fast it is going on the ground',
  'ブースト / 噴射': 'Boost / thrust',
  'ブーストの出力、スラスターの出力': 'How hard the booster and the thrusters are working',
  '着地 / 反動 / 被弾': 'Landing / recoil / being hit',
  'その瞬間だけ跳ねて、すぐ収まります': 'Kicks at that instant and settles straight away',
  '耐久 / EN': 'Armour / energy',
  '減っているほど大きく動きます': 'Moves further the lower it is',
  '持ち替えた瞬間だけ動きます': 'Moves only at the moment you switch',

  '関節の当たり': 'Where a joint stops',
  '前へ / 後ろへ': 'Forward / back',
  '別々に決められます。膝は前に深く、後ろはほぼ0': 'Set separately. A knee goes deep forward and almost nothing back',
  'ヒンジになります。横にはぶれません': 'Makes it a hinge — no sideways play',
  '止まる / 跳ね返る / 回り込む': 'Stop / bounce / wrap',
  '可動域の端まで来たときの挙動': 'What happens at the end of the travel',
  'なじみ / ゆれ戻り': 'Settle / overshoot',
  '目標の姿勢へどれだけ速く、行き過ぎて戻るか': 'How fast it reaches the pose, and how far past it goes',
  '別のボーンの角度に比例して動きます。開く装甲板などに':
    'Moves in proportion to another bone. For armour that opens',
  '関節を撃たれると、そのボーンの効きと可動域が落ちます。':
    'Shoot a joint and that bone loses gain and range.',

  'ウェポンボーン': 'Weapon bones',
  '決めた武器を選んでいる間だけ「構える角度」に動き、':
    'While the weapon you chose is selected it moves to the ready angle, ',
  'それ以外は「しまう角度」に戻ります。': 'and otherwise returns to the stowed one.',
  '切り替えた瞬間だけ動くので、今どれを持っているかが姿勢で分かります。':
    'It moves only at the switch, so the pose tells you what is in hand.',
  '編集画面で動かして確かめる': 'Trying it on the bench',
  'カスタムボーンかウェポンボーンを選ぶと、': 'Select a custom or weapon bone and ',
  ' が出ます。走らせる・撃つ・武器を持たせる、を手で流せます。':
    ' appears. Run it, fire it, hand it a weapon — by hand.',

  // ---- equipment
  '装弾{0} / リロード{1}秒': '{0} rounds / {1}s reload',
  '接触{0}/秒': '{0}/s on contact',
  '1枚': 'one only',
  '1枚のみ': 'One only',
  '武器（丸いプレート）': 'Weapons — the round plates',
  '複数積んで、テスト中に切り替えて使います。': 'Carry several and switch between them as you fight.',
  'システム（四角いプレート）': 'Systems — the square plates',
  '貼る場所が効きます': 'Where you stick it matters',
  '炎はプレートから出ます。後ろに貼れば前へ、下に貼れば上へ':
    'The flame comes out of the plate. On the back it pushes forward; underneath, up',
  'ローリング': 'Roll',
  '貼った面の向きが回転軸。ブロックごと、載っているものも回ります':
    'The face it is on is the axis. The block turns, and so does whatever rides on it',
  'サークル': 'Ring',
  '貼った場所を中心に円線が出ます。下に詳しく': 'Draws a ring around where it sits — more below',
  'ブレード': 'Blade',
  '貼ったブロックが光り、触れた相手を削ります。持続中はENを消費':
    'The block lights up and cuts what it touches. Drains energy while it is lit',
  'グラビティとフロートは正反対なので、同時には付けられません。':
    'Gravity and Float are opposites, so they cannot both be fitted.',

  'サークルは「線に触れているもの」を回す': 'A ring turns whatever touches its line',
  '回したいパーツを先に置いてから貼れば、半径は自動で合います。':
    'Place what you want turned first and the radius matches it on its own.',
  '向き・回転方向・半径はインスペクタで変えられます。円線は編集画面だけの表示です。':
    'Facing, direction and radius are in the inspector. The line is drawn on the bench only.',
  '回る': 'Turns',
  '円線に触れているパーツ（別のブロックに付いていても構いません）':
    'Anything touching the ring line — it can hang from a different block',
  '回らない': 'Does not turn',
  '円の内側にあるもの / 線から高さがずれているもの':
    'Anything inside the circle, or off the line’s height',
  '対象外': 'Never turns',
  'プレートより先の関節にぶら下がっているもの': 'Anything hanging from a joint past the plate',

  // ---- controls
  '割り当ては上部バーの ⌨ から変えられます。ここの表示もそれに追従します。':
    'Bindings are changed from ⌨ in the top bar, and this page follows them.',
  '覚えておくこと': 'Worth remembering',
  '移動キーを2回続けて押す': 'Tap a movement key twice',
  '{0}プレートを付けていないと使えません': 'Needs a {0} plate fitted',
  '武器': 'Weapons',
  '装備した武器はサブウエポンのように切り替えて撃ちます':
    'Fitted weapons are switched between and fired one at a time',
  '一時停止（そのまま編集画面やタイトルへ戻れます）':
    'Pause — the workbench and the title are reachable from there',
  '戦う場所': 'Where you fight',
  'テストフィールドでは、上部バーか一時停止画面から場所を選べます。':
    'In the test field the arena is chosen from the top bar or the pause screen.',
  '重力も場所ごとに違います。': 'Gravity differs from place to place too.',
  '撃たせない': 'Holding fire',
  'テストフィールドでは、敵に撃たせないようにできます。':
    'In the test field the opponents can be told not to shoot.',
  '敵は動きも回避もしますが、引き金だけ引きません。歩き方や見た目を':
    'They still move and dodge — they simply never pull the trigger. For when you are ',
  '確かめたいときのためのものです。ソロプレイでは使えません。':
    'checking how something walks or looks. Not available in Solo.',

  // ---- solo
  '{0}機（{1}）{2}': '{0} lives ({1}){2}',
  難易度: 'Difficulty',
  'タイトルの「ソロプレイ」で ': 'Change it with ',
  ' を押すと変わります。': ' on the Solo row of the title screen.',
  '5段階の違いは主に': 'The five settings mostly differ in ',
  '上がり方の速さ': 'how fast it climbs',
  'です — ': ' — ',
  '最初の強さはどれも似ていて、終盤がまったく違います。':
    'they all start about the same and end nothing alike.',
  '敵の強さは1つの数字で、ウェーブとともに上がります（HUDに ×n.n で出ます）。':
    'Opponent strength is one number that rises with the waves — the HUD shows it as ×n.n.',
  '残機{0} ・ W1で ×{1}': '{0} lives ・ ×{1} at W1',
  ' → W{0}で ×{1}': ' → ×{1} at W{0}',
  ' ・ スコア{0}倍': ' ・ score ×{0}',
  '上がるのは': 'What rises is ',
  '耐久と与ダメージの両方': 'both armour and damage dealt',
  'です。': '.',
  '耐久だけ上げると戦いが長くなるだけで、与ダメージだけ上げると一瞬で終わるので、':
    'Armour alone only makes fights longer, damage alone makes them instant, so ',
  '与ダメージのほうは耐久より控えめに動きます。': 'damage moves more gently than armour does.',

  'ステージを順に上がる': 'Up the ladder',
  'ランは': 'A run works through ',
  '{0}ステージ': '{0} stages',
  'を順に進みます。各ステージは数ウェーブで、全部倒すと次の場所へ移ります。':
    ' in order. Each is a few waves, and clearing them moves you somewhere new.',
  '残機とスコアは持ち越し、ウェーブ番号もリセットされません — ':
    'Lives and score carry over, and the wave number never resets — ',
  '足場が変わりながら、圧力は上がり続けます。':
    'the ground changes under you while the pressure keeps climbing.',
  '{0}（{1}ウェーブ）': '{0} ({1} waves)',

  'ウェーブの中身': 'What comes at you',
  '進むほど数が増え、1機あたりも硬くなり、そして': 'More of them, each one tougher, and ',
  '出てくる機体が大きくなります': 'the machines themselves get bigger',
  '序盤は極小のドローン、終盤は超大型が先頭に立ちます。':
    'Tiny drones early; something enormous leading them by the end.',

  '残機とスコア': 'Lives and score',
  残機: 'Lives',
  '{0}機。やられるたびに1つ減り、0になった時点で終了':
    '{0}. One goes each time you fall, and at 0 the run is over',
  'ウェーブ突破': 'Clearing a wave',
  '機体が少し修復され、弾も補充されます': 'Repairs the machine a little and refills the magazines',
  '全ステージ突破': 'Clearing every stage',
  'ALL CLEAR。{0} 点': 'ALL CLEAR. {0} points',
  'スコア': 'Score',
  '撃破ごとに加算（後半のウェーブほど高い）＋ウェーブ突破ボーナス':
    'Per kill, worth more in later waves, plus a bonus for each wave cleared',
  '強化個体': 'Elites',
  '{0}ウェーブごとに1機。硬いぶん撃破点は{1}倍': 'One every {0} waves. Tougher, and worth ×{1}',
  記録: 'Records',
  'ベストスコアはタイトル画面に残ります': 'Your best score stays on the title screen',

  '持ち込む機体': 'What you take in',
  '編集画面で組んだ機体がそのまま出ます。': 'Whatever you built on the bench, exactly as it is.',
  '武器を積んでいないと素の機関砲だけ': 'With no weapons fitted you get the bare autocannon',
  'になるので、出撃前に装備プレートを確認してください。':
    ', so check your plates before you go.',
  '一時停止。最初からやり直す・タイトルへ戻る': 'Pause. Start over, or go back to the title',
  'やり直し': 'Retry',
  '毎回ちがう試合になります（同じ乱数の引き直し）':
    'A different run each time — the same generator, drawn again',

};
