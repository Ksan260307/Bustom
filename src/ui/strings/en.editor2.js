// ============================================================
//  The workbench, part two: the inspector.
//
//  This is where a machine is actually tuned, so it is the densest text in
//  the game and the least forgiving to translate. Two habits throughout:
//
//  - A JOINT IS NAMED FOR THE BODY PART, not for the mechanism. The
//    Japanese says 「ひざ」 and 「股関節」, so the English says "Knee" and
//    "Hip" — not "one-axis limited hinge". Somebody building a leg is
//    thinking about a leg.
//
//  - THE RING DIAGNOSTIC KEEPS ITS SHAPE. Those four numbered causes are
//    split across separate strings so the emphasised words can be marked
//    up in the middle of a sentence; English word order moves them, so
//    each fragment is translated to sit in the same slot rather than to
//    read well alone.
// ============================================================

export const EDITOR2 = {

  // ---- the pause screen and the field legend
  '？ 使い方': '？ Help',
  '← 編集画面に戻る': '← Back to the workbench',
  '⌂ タイトルへ': '⌂ Title',
  '武器を撃つ': 'Fire',
  武器切替: 'Next weapon',
  'ロックオン': 'Lock on',
  'ターゲット切替': 'Next target',
  '移動（2回押しでダッシュ）': 'Move (tap twice to dash)',
  '上昇・跳躍': 'Rise / jump',
  下降: 'Descend',
  'ブースト': 'Boost',
  'リスポーン': 'Respawn',
  'カメラ回転（ホイールでズーム）': 'Turn the camera (wheel zooms)',
  'ポーズ': 'Pause',
  '元に戻す: {0} (Ctrl+Z)': 'Undo: {0} (Ctrl+Z)',
  'やり直し: {0} (Ctrl+Y)': 'Redo: {0} (Ctrl+Y)',

  // ---- the parts store
  'まだパーツがありません。': 'No parts yet.',
  '「パーツ編集」で作るか、選択中のパーツを下のボタンで登録できます。':
    'Make one in “Edit part”, or add the current selection with the button below.',
  '選択パーツを登録': 'Add the selection',
  '最初から入っているパーツ': 'Built in',
  'メイン編集に置く': 'Place in the main build',
  配置: 'Place',
  'パーツ編集で開く': 'Open in the part editor',
  'パーツ庫から削除': 'Remove from the store',
  '残す選択がありません': 'Nothing selected to keep',
  'このまとまりの名前': 'Name for this group',
  '「{0}」として残しました': 'Kept as “{0}”',
  '{0} を選び直す（右クリックで削除）': 'Select {0} again — right click to remove',
  'まだありません': 'Nothing yet',
  '名前を付けるパーツを選んでください': 'Select the parts to name',
  'パーツの名前': 'Part name',
  '{0} 個に名前を付けました': 'Named {0}',

  // ---- colours
  'コアシルバー': 'Core silver',
  '標準色 {0}': 'Standard {0}',
  '最近使った色 {0}': 'Recent {0}',
  '自由な色': 'Any colour',
  '{0}は弾の色を変えられません。': '{0} cannot have its shot colour changed.',
  数値: 'Numeric',
  '⟲ 最初からやり直す': '⟲ Start over',

  // ---- the inspector header
  コア: 'Core',
  'ブロック': 'Block',
  'ボーン': 'Bone',
  'プレート': 'Plate',
  '{0} / 第{1}階層 / {2}': '{0} / level {1} / {2}',
  'パーツをクリックで選択、Ctrl+クリックで複数選択。':
    'Click a part to select it, Ctrl+click for more than one.',
  'ギズモを掴めば任意の位置に動かせます（空中に浮かせてもOK）。':
    'Grab the gizmo to put it anywhere — floating in mid-air is fine.',
  '設置は、面をクリックでぴったり／何もない所をクリックで浮遊配置。':
    'Click a face to sit flush against it; click empty space to float it.',
  '{0} パーツ選択中': '{0} selected',
  連結先: 'Parent',
  選択解除: 'Deselect',
  '{0} パーツを削除 (Del)': 'Delete {0} parts (Del)',

  // ---- size
  '寸法 — {0} ブロック': 'Size — {0} blocks',
  'えらんだブロックの寸法はばらばらです。下のスライダーは全部を同じ寸法にします。':
    'The selected blocks are different sizes. The sliders below make them all the same.',
  'えらんだものを、それぞれの寸法のまま大きくします': 'Scales each one, keeping its own proportions',
  '最後にえらんだものの寸法に揃えます': 'Matches the size of the one selected last',
  '寸法を揃える': 'Match sizes',
  '縦横比を保つ': 'Keep proportions',
  'ボーン — {0} 本': 'Bones — {0}',
  'プレート — {0} 枚': 'Plates — {0}',

  // ---- mounting
  位置: 'Position',
  'X → Y → Z の順。': 'In X → Y → Z order.',
  機体基準: 'Machine',
  'ついている面': 'Face',
  右: 'Right',
  左: 'Left',
  下: 'Bottom',
  前: 'Front',
  後: 'Back',
  'クリックでつなぎ替え': 'Click to re-attach',
  可動側: 'Moving half',
  固定側: 'Fixed half',
  'この関節から先なので、ボーンと一緒に振れます。': 'Past the joint, so it swings with the bone.',
  'ボーンの手前半分なので動きません。中点より先へ動かすと可動側になります。':
    'On the near half, so it does not move. Past the midpoint it joins the moving half.',
  'ボーンの根元へ': 'To the bone’s root',
  根元へ: 'To root',
  '関節の少し先へ': 'Just past the joint',
  可動側へ: 'To moving half',
  'ボーンの先端へ': 'To the bone’s tip',
  先端へ: 'To tip',
  '連結を解除 (⇧J)': 'Detach (⇧J)',
  '動きを反転': 'Reverse the motion',
  '選んだ他のボーンを、このボーンの長さと太さに揃えます':
    'Matches the other selected bones to this one’s length and thickness',
  '他のボーンをこれに揃える': 'Match others to this',
  つなげる: 'Extend',
  'このボーンの先端に、もう1本つなげます': 'Adds another bone at this one’s tip',
  '＋ 先端に{0}': '＋ {0} at the tip',

  // ---- equipment
  種類: 'Kind',
  大きさ: 'Size',
  径: 'Diameter',
  '装弾 / リロード': 'Rounds / reload',
  '{0} 発 / {1}s': '{0} rounds / {1}s',
  接触ダメージ: 'Contact damage',
  止める: 'Stop',
  '編集中だけ': 'Workbench only',
  '正転 ↻': 'Forward ↻',
  '逆転 ↺': 'Reverse ↺',
  速さ: 'Speed',
  半径: 'Radius',
  '円線の向き': 'Ring facing',
  '回るパーツ': 'What turns',

  // ---- the ring diagnostic. Fragments; see the note at the top.
  '線の上にパーツがありません。よくある原因は4つ:':
    'Nothing is standing on the line. Four usual causes:',
  '① 円線の向きが違う（上のボタンで変える）': '① The ring faces the wrong way — change it above',
  '② 円の': '② It sits ',
  中: 'inside',
  'に置いてある（線の上に動かすか半径を合わせる）': ' the circle — move it onto the line, or match the radius',
  '③ 線から': '③ It is ',
  '軸の方向に離れている': 'off the line along the axis',
  '（半径は合っていても、線の高さから外れていると乗りません）':
    ' — the radius can be right and it still misses the line’s height',
  '④ 回したいパーツが、プレートより先の': '④ What you want to turn hangs from a ',
  '関節にぶら下がっている': 'joint beyond the plate',
  '（関節から先は、その関節が動かすので巻き取りません）':
    ' — past a joint, that joint moves it, so the ring does not',
  'パーツを先に置いてからプレートを貼ると、': 'Place the parts first and then the plate, and',
  '半径はそれに合わせて決まります': 'the radius is chosen to match them',
  '円線に触れているパーツが回ります。': 'Whatever touches the ring line turns.',
  '円の中に置いただけ・線から高さがずれているものは回りません。':
    'Sitting inside the circle, or off its height, is not touching it.',
  '線の上に立っていれば、足元が触れているので、': 'Standing on the line means the foot of it touches,',
  '高く伸びたパーツもまるごと一緒に回ります。': 'so a tall part comes round whole.',
  '円線は編集画面だけの表示です（左パネルで消せます）。':
    'The ring line is drawn in the workbench only — the left panel hides it.',
  '貼った面の向きが回転軸。': 'The face it is stuck to is the axis.',
  'ボーンに貼っても回りません。ブロックに貼ってください。':
    'It does nothing on a bone. Put it on a block.',
  'コアは回せません（機体ごと回ってしまうため）。':
    'Not on the core — that would turn the whole machine.',

  // ---- sculpt read-out
  '形: {0} {1}': 'Shape: {0} {1}',
  中身: 'Solid',
  '{0}% 充填': '{0}% filled',
  全塗り: 'Paint all',
  '削除 {0}個 (Del)': 'Delete {0} (Del)',
  '削除 (Del)': 'Delete (Del)',
  'コアブロックは削除できません。前面 (+Z) が進行方向です。':
    'The core block cannot be deleted. Its front (+Z) is the way the machine faces.',

  // ---- bone motion
  前へ: 'Forward',
  '前後おなじ': 'Same both ways',
  '後ろへ': 'Back',
  '1軸だけ動く': 'One axis only',
  実測: 'Measured',
  追従: 'Follow',
  なじみ: 'Settle',
  ' 秒': ' s',
  'ゆれ戻り': 'Overshoot',
  '先へ伝わる量': 'Passed down the chain',
  連動: 'Linked',
  なし: 'None',
  比率: 'Ratio',
  '構える武器': 'Weapon held',
  'どれでも': 'Any',
  'ひねり': 'Twist',
  'しまう角度': 'Stowed angle',
  '構える角度': 'Ready angle',
  '行き過ぎ': 'Overshoot',
  '動作テスト': 'Try it',
  '走らせる': 'Run',
  撃つ: 'Fire',
  '選択中だけ': 'Selected only',
  '武器なし': 'No weapon',
  '反対側の同じボーンに、この設定をそのまま写します':
    'Copies these settings onto the matching bone on the other side',
  '反対側にも同じ設定': 'Same on the other side',
  '先まで弱く': 'Weaker outward',
  '先まで強く': 'Stronger outward',
  効き: 'Gain',
  'ずらし': 'Lag',

  // ---- ready-made joints
  肩: 'Shoulder',
  'アームの根元。振りを抑えて、腕全体の付け根らしく':
    'The arm’s root. Swing held back, the way a shoulder is',
  股関節: 'Hip',
  'レッグの根元。しっかり踏み出す': 'The leg’s root. Takes a full stride',
  しなり: 'Whip',
  'ひと呼吸遅れて追従。先端側に付けるとムチのように動く':
    'Follows a beat late — near the tip it whips',
  固定: 'Fixed',
  'まったく動かさない': 'Does not move at all',
  'ひざ': 'Knee',
  '片方にだけ深く曲がる': 'Bends deep one way only',
  'ひじ': 'Elbow',
  'ひざより浅く、同じく片方だけ': 'Shallower than a knee, and one way as well',
  球: 'Ball',
  '前後にも横にも自由': 'Free fore-and-aft and sideways',
  'バネ': 'Spring',
  '端まで行くと跳ね返る': 'Bounces back at the end of its travel',
  'カスタム動作': 'Custom motion',
  軸: 'Axis',
  '動き方': 'Motion',
  '可動域で止める': 'Stop at the range',
  振幅: 'Swing',
  回転速度: 'Turn rate',
  ' 回転/秒': ' turns/s',
  中心角: 'Centre angle',
  '中心角も動かす': 'Move the centre too',
  '位相ずらし': 'Phase offset',
  '重ねる動き': 'Second motion',
  '駆動ソース': 'Driven by',
  腰: 'Waist',
  '歩調に合わせてひねる': 'Twists with the stride',
  首: 'Neck',
  'ロックオン中だけゆっくり動く': 'Moves slowly, and only while locked on',
  尾: 'Tail',
  '走るほど大きく揺れる': 'Sways more the faster it runs',
  'プロペラ': 'Propeller',
  '回りっぱなし': 'Never stops',
  '排熱フィン': 'Heat fins',
  'ENが減るほど開く': 'Opens as energy drains',
  反動: 'Recoil',
  '撃った瞬間だけ跳ねる': 'Kicks at the instant it fires',

  // ---- stats
  質量: 'Mass',
  機動: 'Agility',
  耐久: 'Armour',
  全高: 'Height',
  'パーツ': 'Parts',
  機動性: 'Agility',
  体積: 'Volume',
  密度: 'Density',
  推力: 'Thrust',
  慣性: 'Inertia',
  '脚 / 腕': 'Legs / arms',
  '顔 / カスタム': 'Face / custom',
  '装備 / 武装': 'Plates / weapons',
  'ダッシュ': 'Dash',
  'グラビティ': 'Gravity',
  '浮遊不可 / 耐久 +{0}%': 'Cannot hover / armour +{0}%',
  '加工グリッド {0}M / {1}M セル': 'Sculpt grid {0}M / {1}M cells',
  '太さ {0}cm': '{0}cm thick',
  ' ・ 1マス {0}cm': ' ・ {0}cm per cell',
  'ブラシがブロックより大きくなっています': 'The brush is larger than the block',
  '残り {0}%': '{0}% left',

};
