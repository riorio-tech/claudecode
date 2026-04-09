# 03_image-gen エージェント（v2）

## 役割

1本の動画（videoIndex）のショットプランに従い、各カットの画角画像を生成する。

## 入力

- `sourceImagePath`: 元商品画像（JPG/PNG）
- `videoShotPlan.shots[].angleHint`: v2 angleHints（10種）または旧互換（5種）
- `videoIndex`: 0-9
- `imageGenDir`: 出力先（`jobDir/03_image-gen/`）

## 出力ファイル

```
03_image-gen/
├── {v}-3view-front.jpg
├── {v}-3view-side.jpg
├── {v}-3view-perspective.jpg
├── {v}-3view-composite.jpg
├── {v}-mask-{shot}.png         # fal モードのみ
├── {v}-angle-00.jpg
...
├── {v}-angle-09.jpg            # v2: 10カット分
└── {v}-image-variants.json
```

## プロバイダ切替（config.IMAGE_GEN_PROVIDER）

| Provider | 処理 |
|----------|------|
| `sharp` | 3面図生成 + angleHintごとの構図変換（クロップ・回転・ライティング） |
| `fal` ★デフォルト | FLUX Pro Fill インペインティング（`fal-ai/flux-pro/v1/fill`） |

### fal モードの動作（FLUX Pro Fill）

```
商品画像 → sharp で 3面図生成（ベース）
  ↓
各 shot:
  angleHint → ANGLE_ZONES で商品ゾーン決定
  angleHint → ANGLE_INPAINT_PROMPTS でプロンプト決定
  ベース画像 + ゾーンマスク → FLUX Fill → {v}-angle-{shot}.jpg
```

商品ビジュアル説明は **Claude Haiku** で英語生成し `{product_desc}` に注入。

### angleHint → ゾーン・プロンプトマッピング（v2）

全ショット共通前提: **開封済みの箱から商品を手に取っている状態（unboxing premise）**

| angleHint | zone (1080×1920) | 説明 |
|-----------|-----------------|------|
| `shake_impact` | x:90 y:280 w:900 h:1300 | 両手で持ち上げ、25°傾いた衝撃演出 |
| `pull_back_reveal` | x:200 y:500 w:680 h:680 | 超接写→引いて全体像 |
| `dutch_angle` | x:100 y:300 w:880 h:1200 | 20°傾いたダイナミック構図 |
| `extreme_close` | x:240 y:680 w:600 h:750 | テクスチャのマクロ接写 |
| `overhead_flatlay` | x:80 y:250 w:920 h:1100 | 真上から見た開封状態 |
| `hand_hold_pov` | x:60 y:380 w:960 h:1200 | 一人称視点で箱から取り出し |
| `orbit` | x:140 y:290 w:800 h:1200 | 45°横から、隣に箱 |
| `hero_low_angle` | x:120 y:430 w:840 h:1050 | ローアングルで見上げる |
| `lifestyle_scene` | x:100 y:350 w:880 h:1150 | 使用シーン・実環境 |
| `split_comparison` | x:40 y:290 w:500 h:1050 | 左半分に商品配置 |

旧互換 (`wide`/`close`/`front`/`angle`/`scene`) も動作。フォールバックは `hand_hold_pov`。

### sharp モードの構図変換（v2）

| angleHint | 変換 |
|-----------|------|
| `shake_impact` | 上部82%クロップ + 明るさ+6% |
| `pull_back_reveal` | 中央40%の超タイトクロップ |
| `dutch_angle` | -18°回転 |
| `extreme_close` | 中央35%の超タイトクロップ |
| `overhead_flatlay` | 上部25%カット + 明るさ+8% |
| `hand_hold_pov` | 88%幅クロップ + 明るさ+3% |
| `orbit` | 側面ビュー + 5%右シフト |
| `hero_low_angle` | 下部50%クロップ（ローアングル演出）|
| `lifestyle_scene` | 暗い木目背景（darkWood） |
| `split_comparison` | 左半分配置 + 右半分グレー背景 |

## 環境変数

| キー | 用途 |
|------|------|
| `FAL_KEY` | fal.ai（画像アップロード + FLUX Fill） |
| `ANTHROPIC_API_KEY` | 商品ビジュアル説明生成（Claude Haiku） |
