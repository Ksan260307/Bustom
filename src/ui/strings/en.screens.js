// ============================================================
//  The screens either side of a fight: title, sortie, controls, share
//  codes, and everything about playing somebody else.
//
//  The versus screen is the one place where a wrong word costs a match, so
//  it is written flatly. 「抜ける」 is "Leave", not "Disconnect" — one of
//  those is a thing a person does on purpose and the other is a thing that
//  happens to them, and the game already has a separate message for the
//  second.
// ============================================================

export const SCREENS = {

  // ---- key bindings
  '初期設定に戻す': 'Reset to defaults',
  '「{0}」に割り当てるキーを押してください（Esc で中止）':
    'Press the key for “{0}” — Esc cancels',
  '中止しました': 'Cancelled',
  '{0} は割り当てられません': '{0} cannot be bound',
  '{0} を「{1}」から移しました — {2}が未設定です': 'Moved {0} off “{1}” — {2} now has no key',
  '{0} を「{1}」から移しました': 'Moved {0} off “{1}”',
  '{0} を割り当てました': 'Bound {0}',
  '最後のひとつは外せません': 'The last one cannot be removed',
  '{0} を外しました': 'Removed {0}',
  '初期設定に戻しました': 'Reset to defaults',
  'クリックして割り当て直す': 'Click to rebind',
  外す: 'Remove',
  未設定: 'Unbound',
  'キーを追加': 'Add a key',

  // ---- share codes
  'データが大きすぎて QR にできません（{0} / {1} バイト）':
    'Too large for a QR code ({0} / {1} bytes)',
  'クリックで拡大（スマホで読むときはこちら）': 'Click to enlarge — use this to scan with a phone',
  'BRO1: で始まる共有コードを貼り付け': 'Paste a share code beginning BRO1:',
  拡大: 'Enlarge',
  'コードをコピー': 'Copy the code',
  'PNG保存': 'Save PNG',
  'この密度の QR は小さく写すと読めません。スマホで読むなら［拡大］、':
    'A QR this dense will not read when it is small. To scan it, use ［Enlarge］; ',
  'ファイルで渡すなら［PNG保存］（縮小せずにそのまま送ってください）。':
    'to send it as a file, use ［Save PNG］ — send it full size.',
  '読み込む': 'Load',
  'QR画像をここにドロップするか、コードを貼り付けてください。':
    'Drop a QR image here, or paste a code.',
  '機体は編集画面に、パーツはパーツ庫に入ります。':
    'A machine goes to the workbench; a part goes to the parts store.',
  'QR画像をドロップ / クリックして選択': 'Drop a QR image, or click to pick one',
  'スマホのカメラで読み取ってください。もう一度クリックで戻ります':
    'Scan it with a phone camera. Click again to go back',
  '{0}: {1}': '{0}: {1}',
  '{0} バイト / QR {1}×{2}': '{0} bytes / QR {1}×{2}',
  '{0} バイト — {1}。テキストコードは使えます。': '{0} bytes — {1}. The text code still works.',
  '共有コードをコピーしました': 'Share code copied',
  'コピーできませんでした。選択されているので Ctrl+C を押してください':
    'Could not copy. It is selected — press Ctrl+C',
  'QR にできないサイズです。テキストコードを使ってください':
    'Too large for a QR code. Use the text code',
  'PNG を保存しました': 'PNG saved',
  '画像を読み取っています…': 'Reading the image…',
  '画像から QR を読み取れませんでした': 'No QR code found in that image',
  '画像を読めませんでした: {0}': 'Could not read the image: {0}',
  'コードが空です': 'The code is empty',
  '「{0}」を{1}に読み込みました': 'Loaded “{0}” into {1}',

  // ---- sortie
  'ENTER 出撃 ・ ESC 戻る': 'Enter to launch ・ Esc to go back',
  '← 戻る': '← Back',
  '機体を組み直す': 'Back to the workbench',
  '出撃 ▶': 'Launch ▶',
  編集中: 'Working copy',
  'プリセット': 'Preset',
  '武器プレートがありません。素の機関砲だけで戦うことになります。':
    'No weapon plates. You will be fighting with the bare autocannon.',
  'ブーストプレートがありません。ダッシュもブーストも使えません。':
    'No booster plate. No dash and no boost.',
  '脚もフロートもありません。まともに動けません。':
    'No legs and no float. It will barely move.',
  '残機 {0} ・ スコア {1}倍': '{0} lives ・ score ×{1}',

  // ---- title
  対戦: 'Versus',
  'ガレージ': 'Garage',
  ' 選択': ' select',
  ' 難易度': ' difficulty',
  ' 決定': ' confirm',
  ' 全画面': ' fullscreen',
  ' 使い方': ' help',
  'フルスクリーン': 'Fullscreen',
  'ゲームを終了': 'Quit',
  'まだ記録がありません': 'No record yet',
  '▶ もう一度': '▶ Again',
  '🔧 機体を組む': '🔧 Build a machine',
  '← タイトルへ': '← Title',
  '到達ステージ': 'Stage reached',
  '到達ウェーブ': 'Wave reached',
  撃破: 'Kills',
  生存時間: 'Time alive',

  // ---- versus
  '相手のコードを貼り付け': 'Paste their code',
  準備完了: 'Ready',
  '抜ける': 'Leave',
  '自分のコード（相手に送る）': 'Your code — send this to them',
  '相手のコード': 'Their code',
  '部屋を作る': 'Open a room',
  'コードで入る': 'Join with a code',
  '返答を取り込む': 'Take their reply',
  'マッチングサーバー': 'Matchmaking server',
  '対戦相手を探す': 'Find an opponent',
  '待つ間フィールドで遊ぶ': 'Play in the field while you wait',
  やめる: 'Stop',
  '部屋をさがす': 'Find a room',
  接続: 'Connect',
  'マッチング': 'Matchmaking',
  'コード交換': 'Swap codes',
  '最大 {0} 人': 'Up to {0}',
  戻る: 'Back',
  '1本の時間': 'Round length',
  '{0}分': '{0} min',
  先取: 'First to',
  '{0}本': '{0}',
  人数: 'Players',
  '{0}人': '{0}',
  '負けても観戦できます': 'You can watch after you are out',
  'この環境では対戦できません': 'Versus is not available here',
  'インターネット対戦はこの環境では使えません（LANは使えます）':
    'Internet play is not available here — LAN still works',
  'Steamに部屋を作りました。相手を待っています': 'Room opened on Steam. Waiting for someone',
  '部屋を作れませんでした（{0}）': 'Could not open a room ({0})',
  '空いている部屋がありません': 'No rooms with space in them',
  ' ・ {0}分 {1}本': ' ・ {0} min, first to {1}',
  '入る': 'Join',
  'さがせませんでした（{0}）': 'Could not search ({0})',
  '部屋に入りました': 'Joined the room',
  '入れませんでした（{0}）': 'Could not join ({0})',
  'マッチングサーバーのアドレスを入れてください': 'Enter the matchmaking server address',
  'このビルドには公開サーバーがありません。コード交換かLANで対戦できます':
    'This build has no public server. Swapping codes and LAN both still work',
  'まだ相手が見つかりません。ソロプレイかコード交換も使えます':
    'Still nobody. Solo play and swapping codes are both available',
  '対戦相手を探しています（{0}/{1}人）': 'Looking for an opponent ({0}/{1})',
  '先に対戦相手を探してください': 'Start looking for an opponent first',
  'マッチングは続いています。相手が見つかったら戻ります':
    'Still looking. You will be pulled back when someone is found',
  'この環境では使えません': 'Not available here',
  'コードを作っています…': 'Making a code…',
  'このコードを相手に送り、返ってきたコードを貼って「返答を取り込む」':
    'Send them this code, paste what comes back, then “Take their reply”',
  '相手のコードを貼ってください': 'Paste their code',
  'このコードを相手に返してください': 'Send this code back to them',
  'つながりませんでした（{0}）': 'Could not connect ({0})',
  '先に部屋を作り、相手の返答を貼ってください': 'Open a room first, then paste their reply',
  'コピーしました': 'Copied',
  '選択してコピーしてください': 'Select it and copy',
  'このアドレスを相手に伝えてください': 'Give them this address',
  'ネットワークが見つかりません': 'No network found',
  '相手の接続を待っています': 'Waiting for them to connect',
  'アドレスを入力してください': 'Enter an address',
  '空き': 'Open',
  '準備を取り消す': 'Not ready',

};
