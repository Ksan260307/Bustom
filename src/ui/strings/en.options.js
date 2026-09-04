// ============================================================
//  The options screen, in English.
//
//  Written from the player's side: a row says what it changes about their
//  experience, not what it changes about the renderer. 「描画の重さ」 is
//  "How hard it works", not "Render quality preset" — somebody turning it
//  down is thinking about their laptop's fan, not about MSAA sample counts.
//
//  The quality names are the same shape in both languages: one word,
//  ordered cheap to dear, with the explanation underneath.
// ============================================================

export const OPTIONS = {

  // ---- entry points
  '設定': 'Options',
  '⚙ 設定': '⚙ Options',

  // ---- language
  '言語': 'Language',
  '表示言語': 'Interface language',
  '切り替えると画面を作り直します': 'Switching rebuilds the screen',

  // ---- sound
  音: 'Sound',
  '全体の音量': 'Overall volume',
  音楽: 'Music',
  効果音: 'Effects',
  消音: 'Mute',
  'すべての音を止める': 'Silence everything',

  // ---- picture
  画質: 'Picture',
  '描画の重さ': 'How hard it works',
  '軽い': 'Light',
  'ふつう': 'Normal',
  'きれい': 'Full',
  '影とにじみを切り、描画も等倍。古いノートPC向け':
    'No shadows, no glow, no supersampling. For an older laptop',
  '影は出す。にじみは軽く、描画は少し粗く': 'Shadows on, glow light, drawn a little coarser',
  'すべて有効。これまでの見た目': 'Everything on — how the game has always looked',
  'フレームレート表示': 'Frame rate',
  '画面の隅に出す': 'Show it in the corner',

  // ---- reading it
  '読みやすさ': 'Readability',
  '文字の大きさ': 'Interface size',
  '高解像度の画面で小さすぎるときに': 'For when it is too small on a high-resolution screen',
  '動きを抑える': 'Reduce motion',
  'OSに従う': 'Follow the OS',
  '抑える': 'Reduce',
  '抑えない': 'Full',
  '画面の揺れ・にじみ・カメラの慣性を弱めます':
    'Softens the screen shake, the glow and the camera’s momentum',

  // ---- pointing
  'マウス感度': 'Mouse sensitivity',
  '上下を反転': 'Invert vertical',
  'マウスを上げると下を向く': 'Push the mouse up to look down',
  '横移動を反転': 'Invert strafe',
  '左右の移動キーを入れ替える': 'Swap the left and right movement keys',
  'キーの割り当ては「キー設定」から変えられます': 'Key bindings are under “Controls”',

  // ---- replays
  'リプレイ': 'Replays',
  '読み込んでいます…': 'Loading…',
  'この記録は読めません': 'This recording cannot be read',
  'まだ記録がありません。対戦すると自動で残ります。':
    'No recordings yet. One is kept automatically after every match.',
  '見る': 'Watch',
  'この記録を削除': 'Delete this recording',

  // ---- when something goes wrong
  '問題が起きました': 'Something went wrong',
  'ゲームは動き続けているかもしれませんが、何かが失敗しました。':
    'The game may still be running, but something failed.',
  '作業中の内容は自動保存されています。次に編集画面を開いたときに復元できます。':
    'Your work is saved automatically. It can be restored next time you open the workbench.',
  '保存していない変更はありません。': 'There are no unsaved changes.',
  '内容をコピー': 'Copy the details',
  '再起動': 'Restart',
  '描画が停止しました': 'Drawing has stopped',
  'グラフィックドライバがリセットされたようです。': 'The graphics driver appears to have reset.',

};
