# 同梱している素材とライセンス

BLOSTOM 本体のコードとは別に、`public/kit/` 以下に外部素材を同梱しています。
すべて商用配布可能なライセンスのものだけを選んでいます。

作り直したものについては、**元の素材から何をしたか**も書いてあります
（縮小や白黒化は加工であって、出どころを消すものではないため）。

---

## 環境マップ — `public/kit/env/`

| ファイル | 元素材 | 作者 | ライセンス |
|---|---|---|---|
| `dikhololo_night.hdr` | [Dikhololo Night](https://polyhaven.com/a/dikhololo_night) | Greg Zaal | CC0 1.0 |
| `modern_buildings_night.hdr` | [Modern Buildings Night](https://polyhaven.com/a/modern_buildings_night) | Greg Zaal | CC0 1.0 |
| `moonless_golf.hdr` | [Moonless Golf](https://polyhaven.com/a/moonless_golf) | Greg Zaal | CC0 1.0 |

出典: [Poly Haven](https://polyhaven.com/) — 全アセット CC0。

**加工:** 1k (1024×512) の Radiance HDR を、リニア光のまま 512×256 へ平均縮小。
金属の映り込みにしか使わず、その手前で PMREM のぼかしが入るので、
元の解像度は通らない。ダイナミックレンジはそのまま（平均輝度が
0.0644 → 0.0644 と一致することを確認済み）。

## 表面 — `public/kit/surface/`

| kind | 元素材 | ライセンス |
|---|---|---|
| `concrete` | [Concrete034](https://ambientcg.com/view?id=Concrete034) | CC0 1.0 |
| `asphalt` | [Asphalt031](https://ambientcg.com/view?id=Asphalt031) | CC0 1.0 |
| `stone` | [Rock051](https://ambientcg.com/view?id=Rock051) | CC0 1.0 |
| `deckplate` | [DiamondPlate009](https://ambientcg.com/view?id=DiamondPlate009) | CC0 1.0 |
| `saltpan` | [Ground093B](https://ambientcg.com/view?id=Ground093B) | CC0 1.0 |
| `regolith` | [Ground093C](https://ambientcg.com/view?id=Ground093C) | CC0 1.0 |
| `rust` | [Metal041B](https://ambientcg.com/view?id=Metal041B) | CC0 1.0 |
| `strata` | [Rock064](https://ambientcg.com/view?id=Rock064) | CC0 1.0 |

出典: [ambientCG](https://ambientcg.com/) — 全アセット CC0。
「ゲームに生ファイルを同梱してよい」と明記されている。

**加工:** 1K JPG セットから 3 枚だけを取り出して 512 へ縮小。

- `*_detail.jpg` — カラーマップを**白黒化**し、大きくぼかした自分自身で
  割ってから平均 0.75 に正規化。写真は片側から照らされていて、そのまま
  使うと全アリーナの床に同じグラデーションが焼き付くため。
  色はアリーナ側が持っているので、これは**模様だけ**を担当する
- `*_rough.jpg` — Roughness をそのまま縮小
- `*_normal.jpg` — NormalGL（OpenGL 系。three.js が期待する向き）

`windows`（市街地のビルの窓）だけは差し替えていない。発光する窓の格子は
写真では作れないため、従来どおり手続き生成のまま。

## 効果音 — `public/kit/sfx/`

| ファイル | 元素材 | 作者 | ライセンス |
|---|---|---|---|
| `fire-light.wav` | [The Free Firearm Sound Library](https://opengameart.org/content/the-free-firearm-sound-library) PPSh `P_22P` | bart | CC0 1.0 |
| `fire-heavy.wav` | 同上 Mosin Nagant `M_21P` | bart | CC0 1.0 |
| `fire-shot.wav` | 同上 Mossberg `N_26P` | bart | CC0 1.0 |
| `fire-sniper.wav` | 同上 Tikka `W_24P` | bart | CC0 1.0 |
| `fire-pistol.wav` | 同上 Ruger Mark III `R_30P` | bart | CC0 1.0 |
| `dash.wav` | [Steam release sounds](https://opengameart.org/content/steam-release-sounds) Marker #2 | bart | CC0 1.0 |
| `jump.wav` | 同上 Marker #4 | bart | CC0 1.0 |
| `thrust.wav` | 同上 Marker #1 | bart | CC0 1.0 |
| `servo.wav` | 同上 Marker #3 | bart | CC0 1.0 |
| `blade.wav` | 同上 Marker #5 | bart | CC0 1.0 |
| `air.ogg` | 50 CC0 Sci-Fi SFX `loop_ambient_01` | rubberduck | CC0 1.0 |
| `deep.ogg` | [Dark Ambience Loop](https://opengameart.org/content/dark-ambience-loop) | Iwan Gabovitch (qubodup) | CC0 1.0 |
| `hit-landed.ogg` | [100 CC0 SFX](https://opengameart.org/content/100-cc0-sfx) `metal_02` | rubberduck | CC0 1.0 |
| `hit-taken.ogg` | 同上 `metal_11` | rubberduck | CC0 1.0 |
| `step.ogg` | 同上 `metal_03` | rubberduck | CC0 1.0 |
| `land.ogg` | 同上 `slam_03` | rubberduck | CC0 1.0 |
| `reload.ogg` | 同上 `tools_02` | rubberduck | CC0 1.0 |
| `swap.ogg` | 同上 `switch_01` | rubberduck | CC0 1.0 |
| `round.ogg` | 同上 `gong_01` | rubberduck | CC0 1.0 |
| `boom.ogg` | [25 CC0 bang / firework SFX](https://opengameart.org/content/25-cc0-bang-firework-sfx) `bang_06` | rubberduck | CC0 1.0 |
| `wreck.ogg` | 同上 `bang_09` | rubberduck | CC0 1.0 |
| `lock-on.ogg` | [50 CC0 Sci-Fi SFX](https://opengameart.org/content/50-cc0-sci-fi-sfx) `beep_01` | rubberduck | CC0 1.0 |
| `lock-off.ogg` | 同上 `beep_03` | rubberduck | CC0 1.0 |
| `alarm.ogg` | 同上 `retro_beep_05` | rubberduck | CC0 1.0 |
| `ui-move.ogg` | 同上 `terminal_01` | rubberduck | CC0 1.0 |
| `ui-select.ogg` | 同上 `terminal_04` | rubberduck | CC0 1.0 |
| `ui-back.ogg` | 同上 `terminal_05` | rubberduck | CC0 1.0 |

**加工（.ogg）:** 改名のみ。中身は元のまま。

**加工（.wav）:** フィールド録音は数MBの長尺（丘の上で数秒の風、真ん中で1発、
長い残響）なので、`tools/cut-sfx.py` で **最大トランジェントを探して立ち上がりの
手前まで遡り**、その前後を切り出し → 両端フェード → モノラル化 → 32kHz/16bit
正規化。ループ音（`thrust` `servo` `blade`）は録音の中央から取り、
末尾を先頭にクロスフェードしてつなぎ目が鳴らないようにしています。
Vorbisエンコーダがツールチェーンに無いためWAVのままですが、
1秒前後のモノラルなので実害はありません。

**選び方:** ファイル名では選んでいません（`spark` という名前のスプライトが
実際には稲妻だった、という失敗があったので）。パックの **175音すべてを
実際にデコードして測り**、長さ・立ち上がり・鳴っている長さ・明るさ（ゼロ交差）・
両端の一致度（＝ループにできるか）から選びました。

**合成音と録音:** 当初は rubberduck の3パックだけを使っていましたが、
そのうち *50 CC0 Sci-Fi SFX* は**オシレーターで作った合成音**です。
移動・ダッシュ・スラスター・サーボ・銃声がどれも無機質だったのはこれが原因で、
同じパックの中から選び直しても直りません。**実銃と蒸気の録音に差し替えました。**

## エフェクト — `public/kit/fx/`

| ファイル | 元素材 | 作者 | ライセンス |
|---|---|---|---|
| `muzzle.png` | [Particle Pack](https://opengameart.org/content/particle-pack-80-sprites) `muzzle_01` | Kenney | CC0 1.0 |
| `spark.png` | 同上 `scorch_01` | Kenney | CC0 1.0 |
| `flame.png` | 同上 `muzzle_05` | Kenney | CC0 1.0 |
| `slash.png` | 同上 `slash_03` | Kenney | CC0 1.0 |
| `ring.png` | 同上 `circle_03` | Kenney | CC0 1.0 |
| `plume.png` | 同上 `smoke_09` | Kenney | CC0 1.0 |
| `smoke.png` | 同上 `smoke_08` | Kenney | CC0 1.0 |
| `dirt.png` | 同上 `dirt_02` | Kenney | CC0 1.0 |
| `flare.png` | 同上 `flare_01` | Kenney | CC0 1.0 |
| `trace.png` | 同上 `trace_02` | Kenney | CC0 1.0 |
| `blob.png` | 同上 `circle_05` | Kenney | CC0 1.0 |
| `scorch.png` | 同上 `scorch_03` | Kenney | CC0 1.0 |

**加工:** 128px へ縮小し、**色チャンネルを白黒化**。形はアルファが持つ。
色はゲーム側（撃った機体のアクセント、アリーナの砂の色）が掛けるので、
スプライトが色を持っていると全機体の弾が同じ色になってしまう。

パック内の `spark_*` は実際には雷なので、着弾には `scorch_01`（星形の破裂）を
使っている。名前ではなく中身で選んだ。

## 空 — `public/kit/sky/`

| ファイル | 元素材 | 作者 | ライセンス |
|---|---|---|---|
| `kloppenheim_02_puresky.jpg` | [Kloppenheim 02 (Pure Sky)](https://polyhaven.com/a/kloppenheim_02_puresky) | Greg Zaal | CC0 1.0 |
| `kloppenheim_07_puresky.jpg` | [Kloppenheim 07 (Pure Sky)](https://polyhaven.com/a/kloppenheim_07_puresky) | Greg Zaal | CC0 1.0 |
| `qwantani_dusk_1_puresky.jpg` | [Qwantani Dusk 1 (Pure Sky)](https://polyhaven.com/a/qwantani_dusk_1_puresky) | Greg Zaal, Jarod Guest | CC0 1.0 |
| `qwantani_moon_noon_puresky.jpg` | [Qwantani Moon Noon (Pure Sky)](https://polyhaven.com/a/qwantani_moon_noon_puresky) | Greg Zaal, Jarod Guest | CC0 1.0 |

出典: [Poly Haven](https://polyhaven.com/) — 全アセット CC0。
**「pure sky」**は地面が写っていない版。アリーナ自身の床と稜線が
画面の下半分を持つので、写真と喧嘩しない。

**加工:** tonemapped JPEG（8192×4096）を 2048×1024 へ縮小し、
**平均輝度 0.32 に揃える**。ゲーム側はアリーナのグラデーションの平均色を
この値で割って tint にするので、割られる側が既知でないと
5 つのアリーナそれぞれで露出を目分量で決めることになる。

チャンネルごとではなく全体を一律スケール。夕暮れと晴れた夜を分けているのは
色そのもので、そこを揃えたら同じ灰色が 4 枚できるだけになる。

## 宇宙・月 — `public/kit/space/`

| ファイル | 元素材 | 作者 | ライセンス |
|---|---|---|---|
| `milkyway.jpg` | [The Milky Way panorama](https://www.eso.org/public/images/eso0932a/) | ESO / **S. Brunier** | **CC BY 4.0** |
| `earth.jpg` | [Blue Marble: Land Surface, Shallow Water, and Shaded Topography](https://visibleearth.nasa.gov/images/57752) | NASA Earth Observatory | パブリックドメイン |
| `moon.jpg` | [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) LROC カラー | NASA/GSFC SVS | パブリックドメイン |

**加工:** 正距円筒図法のまま縮小のみ（2048×1024 / 1536×768 / 1024×512）。

> **ESO の画像は CC BY 4.0 なので、表示可能な形でのクレジットが必要。**
> ゲーム内の「使い方」画面末尾にクレジット欄を置いてある。
> ここを消す場合は、この画像も一緒に外すこと。

## 音楽 — `public/kit/music/`

| ファイル | 元素材 | 作者 | ライセンス |
|---|---|---|---|
| `title.mp3` | [Free Music Pack](https://opengameart.org/content/free-music-pack) `Flags` | Alexander Ehlers | CC0 1.0 |
| `garage.mp3` | 同上 `Twists` | Alexander Ehlers | CC0 1.0 |
| `fight.mp3` | 同上 `Doomed` | Alexander Ehlers | CC0 1.0 |
| `space.ogg` | [Another space background track](https://opengameart.org/content/another-space-background-track) `ObservingTheStar` | yd | CC0 1.0 |

**加工:** 改名のみ。中身は元のまま。

**選び方:** 11曲を実際にデコードして、長さ・音量(RMS)・明るさ・両端の一致度を
測って割り当てました。

| | 長さ | RMS | 明るさ | 割り当てた理由 |
|---|---|---|---|---|
| Flags | 1.6分 | 0.315 | 927 | 大きく暗い — タイトルには重さが要る |
| Twists | 3.0分 | 0.209 | 1027 | 一番長く落ち着いている — **一番長く聞く画面**（ガレージ）へ |
| Doomed | 2.5分 | 0.306 | 2824 | 一番明るく忙しい — 戦闘 |
| ObservingTheStar | 2.2分 | 0.056 | 904 | 極端に静か — 宇宙は空っぽであるべきなので |

**ストリーミング再生**です（デコードして常駐させない）。1曲数分あり、
18MBぶんをヒープに置く理由がないので。起動もブロックしません。

## フォント — `public/kit/font/`

| ファイル | 元素材 | ライセンス |
|---|---|---|
| `inter-400.woff2` | [Inter](https://github.com/rsms/inter) | SIL OFL 1.1 — [Inter-OFL.txt](public/kit/font/Inter-OFL.txt) |
| `zen-kaku-gothic-new-400.woff2` `-700` | [Zen Kaku Gothic New](https://github.com/googlefonts/zen-kakugothic) (Yoshimichi Ohira) | SIL OFL 1.1 |
| `jetbrains-mono-400.woff2` `-600` | [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | SIL OFL 1.1 — [JetBrainsMono-OFL.txt](public/kit/font/JetBrainsMono-OFL.txt) |

ラテン2書体は Google Fonts 経由の woff2（ラテン部分集合）。

**日本語は同梱している。** 以前は「部分集合にしても数MBある」としてOS任せに
していましたが、それは**全字種**の話でした。`tools/bake-fonts.py` が
`src/` を走査して**ゲーム自身の文字列が使っている文字だけ**（679字）に
切り出すので:

| | 元 | 部分集合 |
|---|---|---|
| Zen Kaku Gothic New | 2.36MB | **86KB** |
| （比較）Noto Sans JP | 9.59MB | 167KB |
| （比較）M PLUS 2 | 4.20MB | 197KB |

**86KBはラテン2書体の合計より小さい。** UIはほぼ全部日本語なので、
これを積まないことは「誰も読まない部分の書体だけを選ぶ」ことでした。

字の一覧はソースから毎回作り直すので、**新しい漢字を含むラベルを足しても
次のbakeで拾われます**（1文字だけ別書体で出る、が起きない）。

OFL はライセンス文の同梱を求めるので、両方の全文を `public/kit/font/` に置いてある。

---

## 使わなかったもの

**Unity Asset Store の素材は一切使っていない。** `.unitypackage` の中身は
C# スクリプト・ShaderLab シェーダ・prefab で Three.js からは読めず、
それ以前に、あそこの素材は Unity での利用を前提に許諾されている。
中から FBX だけ取り出して別エンジンで使うのは規約違反になり得る。

## 素材を足すときの手引き

1. **CC0 を選ぶ**。表記義務がなく、判断に迷う余地が最も少ない
2. `public/kit/<種類>/` に置く。Vite が `dist/` へそのまま写し、
   `electron-builder` の `files` は `dist/**/*` を含んでいるので追加設定はいらない
3. **この表に足す**。出どころの分からないファイルがリポジトリに増えると、
   後から全部を調べ直すことになる
4. 縮小・加工したなら**何をしたか**も書く
