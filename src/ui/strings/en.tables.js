// ============================================================
//  The nouns: everything that lives in a data table.
//
//  These are the strings the game names its own parts with — bones,
//  weapons, shapes, colours, arenas — and they reach the screen through a
//  variable rather than a literal, because the tables are evaluated once at
//  import and t() there would freeze them in the boot language. The read
//  sites are wrapped instead; this is what they find.
//
//  EQUIP_META already carried an `en` field long before any of this, used
//  for the HUD ticker. Those spellings are kept here so a weapon is not
//  called two different things in two places.
//
//  Weapon blurbs keep their NUMBERS: "30 rounds, 3s reload" is the whole
//  point of the sentence, and a translation that rounds it off is worse
//  than none.
// ============================================================

export const TABLES = {

  // ---- faces
  '+X (右)': '+X (right)',
  '-X (左)': '-X (left)',
  '+Y (上)': '+Y (up)',
  '-Y (下)': '-Y (down)',
  '+Z (前)': '+Z (front)',
  '-Z (後)': '-Z (back)',

  // ---- bones
  'レッグボーン': 'Leg bone',
  '脚。地面を蹴って進みます。本数が増えるほど接地が安定します':
    'A leg. Pushes off the ground; more of them stand steadier',
  'アームボーン': 'Arm bone',
  '腕。移動中は歩調と逆に振り、ロックオン中は狙った方を向きます':
    'An arm. Swings against the stride, and points where you are locked on',
  'フェイスボーン': 'Face bone',
  '顔。進行方向に傾き、ロックオン中はターゲットを見ます':
    'A face. Leans the way it is going, and watches the target when locked on',
  'カスタムボーン': 'Custom bone',
  '自作の動き。軸・波形・速さ・何で駆動するかを自分で決めます':
    'Your own motion — axis, waveform, rate, and what drives it',
  '決めた武器を選んでいる間だけ構えます。切り替えた瞬間だけ動きます':
    'Comes to the ready only while its weapon is out, and moves only at the switch',

  // ---- waveforms
  '波（なめらか）': 'Wave (smooth)',
  '往復（一定速）': 'Sweep (steady)',
  'パタパタ': 'Flap',
  '打つ（鋭く出て、ゆるく戻る）': 'Strike (out sharp, back slow)',
  'ゆらぎ（不規則）': 'Drift (irregular)',
  '回転（ぐるぐる）': 'Spin (continuous)',

  // ---- what drives a bone
  常時: 'Always',
  歩調: 'Stride',
  速度: 'Speed',
  衝撃: 'Impact',
  着地: 'Landing',
  発砲: 'Firing',
  被弾: 'Being hit',
  損傷: 'Damage',
  'EN残量': 'Energy left',

  // ---- what a joint does at the end of its travel
  止まる: 'Stop',
  '跳ね返る': 'Bounce',
  '回り込む': 'Wrap',

  細: 'Thin',
  太: 'Thick',
  細かさ: 'Detail',

  // ---- weapons. The `en` field on EQUIP_META already spells these.
  'ビーム': 'Beam',
  '長く細い一線を撃つビームライフル。連射は効かない':
    'A beam rifle: one long thin line at a time. Not for rapid fire',
  'ガトリング': 'Gatling',
  '押しっぱなしで連射。30発でリロード3秒': 'Hold it down. 30 rounds, then 3s to reload',
  'ショット': 'Burst',
  '3発をまとめて撃つ。中距離向き。6発でリロード3秒':
    'Three at once, for the middle distance. 6 rounds, 3s reload',
  '押している間ブロックが光り、触れた敵にダメージ。ENを消費する':
    'The block lights while held and cuts whatever it touches. Drains energy',
  'ミサイル': 'Missile',
  '小型ミサイルを5発ばらまく。白い航跡を引いて追尾する':
    'Five small missiles, spread wide. They trail white and follow',
  'スナイパー': 'Sniper',
  '超長射程の一撃。当てれば大きい': 'One shot, very long range. It hurts when it lands',
  'レーザー': 'Laser',
  '押している間、太いレーザーを撃ち続ける。撃ち続けると過熱する':
    'A thick beam for as long as you hold it. Holding it overheats',
  'スプレッド': 'Spread',
  '9発を大きく拡散。至近距離なら全弾当たるが、遠くには届かない':
    'Nine pellets, wide. Everything lands up close and nothing reaches far',
  'マグナム': 'Magnum',
  '至近距離用の一撃。射程は短いが非常に重い':
    'One shot for point-blank. Short range and very heavy',
  'グレネード': 'Grenade',
  '山なりに飛ぶ爆弾。着弾点で小爆発を起こす':
    'A bomb on an arc. It bursts where it lands',
  'シールド': 'Shield',
  '機体を覆うバリアを張る。体当たりでダメージ、時間で消える':
    'A barrier over the machine. It hurts on contact and fades with time',

  // ---- systems
  'ブーストが使えるようになる。ダッシュの効果も小アップ':
    'Lets you boost, and gives the dash a little more',
  'エナジータンク': 'Energy tank',
  'ブーストゲージが増える。長く飛べるが、満タンに戻るのも遅くなる。重い':
    'A bigger boost gauge: longer in the air, slower to refill. Heavy',
  '貼りついたブロックを回し続ける。向きと速さを選べる':
    'Turns the block it is on, at a facing and rate you choose',
  '空中浮遊不可、その代わり耐久アップ（1枚のみ）':
    'No hovering, and more armour in exchange (one only)',
  'フロート': 'Float',
  '常に地面から少し浮く。脚は接地しない（1枚のみ）':
    'Always a little off the ground. The legs never touch (one only)',
  '貼った場所を中心に円線を引き、その線の上のパーツを線に沿って回す':
    'Draws a ring around itself and carries whatever stands on the line around it',

  // ---- ring facing
  '面に沿う': 'Along the face',
  '貼った面と同じ向き（既定）': 'Same facing as the plate (default)',
  '縦（前後）': 'Upright (fore-aft)',
  '面から90°起こす': 'Stood 90° up from the face',
  '縦（左右）': 'Upright (side to side)',
  '面から90°倒す': 'Laid 90° over from the face',

  // ---- shapes
  基本: 'Basic',
  '立方体': 'Box',
  球: 'Sphere',
  '円柱': 'Cylinder',
  'カプセル': 'Capsule',
  '六角柱': 'Hexagon',
  '先細り': 'Tapered',
  'ドーム': 'Dome',
  '円錐': 'Cone',
  '円錐台': 'Frustum',
  '四角錐': 'Pyramid',
  '八面体': 'Octahedron',
  角: 'Angular',
  '四面体': 'Tetrahedron',
  面取り: 'Chamfered',
  斜面: 'Wedge',
  '三角柱': 'Prism',
  階段: 'Steps',
  抜き: 'Hollow',
  筒: 'Tube',
  輪: 'Ring',
  'アーチ': 'Arch',
  十字: 'Cross',
  皿: 'Dish',

  // ---- arenas
  演習場: 'Proving ground',
  '広くて見通しがよく、遮蔽もひと通りある。基準になる場所。':
    'Wide and open, with cover of every sort. The one to measure the rest against.',
  市街地: 'City',
  '高い建物が密に立つ。撃ち合いは短く、角の取り合いになる。':
    'Tall buildings, packed close. Exchanges are short and fought over corners.',
  '廃工場': 'Scrapworks',
  '低い遮蔽が一面に散る。しゃがんで撃ち、すぐ移る場所。':
    'Low cover scattered everywhere. Duck, shoot, move on.',
  '峡谷': 'Canyon',
  '遮蔽は少なく、距離が出る。長射程が効き、逃げ場は限られる。':
    'Little cover and long sightlines. Range tells, and there is nowhere to go.',
  塩湖: 'Salt flats',
  '遮蔽がほぼない。撃たれたら避けるしかない、機動力の試験場。':
    'Almost no cover. If it is coming, you dodge it — a test of movement.',
  宇宙: 'Orbit',
  '足場のない広い空間。落ちない代わりに、止まるのも自分の噴射しだい。':
    'Open space with no floor. Nothing falls, and nothing stops without thrust.',
  月: 'Moon',
  '重力がほとんどない。一跳びで建物を越え、落ちてくるまでが長い。':
    'Barely any gravity. One jump clears a building, and coming down takes a while.',

  // ---- colours
  'コア銀': 'Core silver',
  'ガンメタル': 'Gunmetal',
  鋼: 'Steel',
  白: 'White',
  赤: 'Red',
  橙: 'Orange',
  黄: 'Yellow',
  若草: 'Spring green',
  緑: 'Green',
  青緑: 'Teal',
  青: 'Blue',
  紫: 'Purple',
  桃: 'Pink',
  茶: 'Brown',
  黒: 'Black',

  // ---- difficulty blurbs
  '機体を試すため。強くなるのもゆっくり。': 'For trying a machine out. It climbs slowly.',
  '基準。20ウェーブでちょうど手に負えなくなる。':
    'The baseline. Around wave 20 it gets away from you.',
  '最初から強く、上がり方も速い。': 'Strong from the start, and it climbs fast.',
  '中盤で並の機体は保たない。装備を選ぶこと。':
    'An ordinary machine does not survive the middle. Choose your plates.',
  '残機1。終盤の1機は序盤の1ウェーブより硬い。':
    'One life. A single machine at the end is tougher than a whole early wave.',

  // ---- input
  'マウス{0}': 'Mouse {0}',
  'テンキー{0}': 'Numpad {0}',
  戦闘: 'Combat',
  'カメラ': 'Camera',
  'システム': 'System',
  前進: 'Forward',
  後退: 'Back',
  左移動: 'Strafe left',
  右移動: 'Strafe right',
  '上昇 / ジャンプ': 'Rise / jump',
  '武器を次に切替': 'Next weapon',
  '武器を前に切替': 'Previous weapon',
  'ロックを左の敵へ': 'Lock left',
  'ロックを右の敵へ': 'Lock right',
  'カメラを回す (押しながら)': 'Turn the camera (hold)',
  'レイヤー A': 'Layer A',
  'レイヤー B': 'Layer B',
  'レイヤー C': 'Layer C',
  '左Shift': 'Left Shift',
  '右Shift': 'Right Shift',
  '左Ctrl': 'Left Ctrl',
  '右Ctrl': 'Right Ctrl',
  '左Alt': 'Left Alt',
  '右Alt': 'Right Alt',
  '編集画面のツール': 'Workbench tools',
  '削る': 'Carve',
  '盛る': 'Add',
  '左クリック': 'Left click',
  'ホイール押し': 'Middle click',

};
