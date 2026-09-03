# 開発ツール

## ステージエディタ

```bash
npm run stage
```

アリーナのレイアウトを真上から編集します。**本編とは別のプログラム**です。

- 本編から辿り着けない（メニューに入口を作っていない）
- 本編がこれを import していない（テストが見張っている）
- **ビルドが別**（`dist-stage/`）。`npm run game` が誤って同梱することができない
- 配布物にも入らない（`electron/stage.js` は `build.files` から除外）

平面図なのは意図的です。遮蔽の配置は「どれだけ離れているか」「何が射線を
遮るか」「レーンはどこか」の問いで、どれも真上から見るほうが速い。
立体で見たいときは本編を起動すればいい。

[5つの規則](../src/game/Arenas.js)（格子・幅・対称・出現地点・レーン）は
**ドラッグ中に常時チェック**され、違反したピースが赤くなります。
テストを回して初めて 4m の隙間に気づくのは、気づく場所が違います。

**保存ボタンはありません。** アリーナはコードで、コードを書き換えるツールは
コードを失えるツールです。貼り付ける用のソースを出すだけにしてあります。

---

# 素材の焼き直し

`public/kit/` に入っているファイルは、外部からダウンロードした CC0 素材を
**このスクリプトで加工したもの**です。加工前のファイルはリポジトリに入っていません
（合計 60MB ほどあり、加工後は 3MB を切るため）。

出どころとライセンス、何を加工したかは [LICENSES.md](../LICENSES.md) に全部書いてあります。

素材を差し替えたい・増やしたいときだけ、ここを読んでください。
**普段の開発では一切必要ありません。**

## 全部まとめて

```bash
pip install pillow numpy
python tools/fetch-assets.py
```

これでダウンロードから焼きまで全部走ります。以下は個別にやり直したいとき用。

**`public/kit/` は git 管理外**です。うちのものではないし、URL と
このスクリプトから完全に再現できるので、リポジトリに置くのは**レシピのほう**。
アセットが無くてもゲームは動きます（後述）。

## 必要なもの

```bash
pip install pillow numpy
```

## 1. 表面 — `bake-surfaces.py`

[ambientCG](https://ambientcg.com/) の `<AssetId>_1K-JPG.zip` を `tools/dl/` に置いて:

```bash
python tools/bake-surfaces.py public/kit/surface
```

どの `kind` にどの素材を使うかはスクリプト先頭の `SETS` に書いてあります。

カラーマップは**白黒の detail マップ**になります。色はアリーナが持っていて、
写真は模様だけを担当するためです。roughness は**変化量**に変換されます
（写真の roughness をそのまま使うと、乾いた岩の床が濡れた粘板岩になります）。

## 2. 環境マップ — `bake-env.py`

[Poly Haven](https://polyhaven.com/) の 1k HDR を `tools/dl/<name>_1k.hdr` として置いて:

```bash
python tools/bake-env.py public/kit/env dikhololo_night modern_buildings_night moonless_golf
```

512×256 へリニア光のまま縮小し、平均輝度をそろえます。
金属の映り込みにしか使わず、その手前で PMREM のぼかしが入るので、
元の解像度は通りません。

実際にアリーナへ渡るときは、さらに [Sky.js](../src/game/Sky.js) の `levelled()` が
**そのアリーナの描き空と同じ平均色**になるよう channel ごとに調整します。
写真から借りるのは形だけで、色と明るさはアリーナのものです。

## 3. フォント — `bake-fonts.py`

```bash
python tools/bake-fonts.py public/kit/font
```

Google Fonts から woff2 の**ラテン部分集合だけ**を取って `fonts.css` を書き出します。
日本語は OS のフォントに任せています。

## 4. エフェクトのスプライト — `bake-fx.py`

[Kenney の Particle Pack](https://opengameart.org/content/particle-pack-80-sprites)
（`kenney_particlePack.zip`）を `tools/dl/` に置いて:

```bash
python tools/bake-fx.py public/kit/fx
```

128px へ縮小し、色チャンネルを白黒化します。形はアルファが持ちます。
どのスプライトを何に使うかはスクリプト先頭の `PARTICLES` に書いてあります。

## 5. 宇宙・月 — `bake-space.py`

`tools/dl/` に以下を置いて:

- `eso0932a.jpg`（[ESO の天の川パノラマ](https://www.eso.org/public/images/eso0932a/)）
- `world.topo.bathy.200412.3x5400x2700.jpg`（[NASA Blue Marble](https://visibleearth.nasa.gov/images/57752)）
- `lroc_color_poles_2k.tif`（[NASA CGI Moon Kit](https://svs.gsfc.nasa.gov/4720)）

```bash
python tools/bake-space.py public/kit/space
```

正距円筒図法のまま縮小するだけです。

**ESO の画像だけは CC BY 4.0** で、表示可能なクレジットが要ります。
ゲーム内「使い方」画面のクレジット欄がそれです。

## 6. 空 — `bake-sky.py`

[Poly Haven](https://polyhaven.com/) の **puresky**（地面が写っていない版）の
tonemapped JPEG を `tools/dl/<name>.jpg` として置いて:

```bash
python tools/bake-sky.py public/kit/sky
```

2048×1024 へ縮小し、**平均輝度を 0.32 に揃えます**。
この値は [Kit.js](../src/game/Kit.js) の `SKY_MEAN` と一致していなければならず、
テストが両方を突き合わせています（ずれると 5 アリーナ全部の露出が同時に狂い、
画面のどこにも原因が出ません）。

## 7. 効果音

スクリプトはありません。[OpenGameArt](https://opengameart.org/) の CC0 パックから
7 個を選んで改名しただけです。対応は LICENSES.md の表のとおり。

## 素材が無くても動きます

`public/kit/` を丸ごと消してもゲームは動きます。
[Kit.js](../src/game/Kit.js) は読み込み失敗を数えるだけで投げず、
表面は手続き生成の絵に、空はグラデーションに、音は発振器に戻ります。
ファイルは**上乗せ**であって、前提ではありません。
