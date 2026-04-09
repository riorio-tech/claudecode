# pipeline — 動画生成パイプライン ドキュメント

> **メインスクリプト**: `pipeline/inpaint.js`  
> `swap.py` は旧バージョン（参考用）。実運用は `inpaint.js` のみ使う。

---

## 実行コマンド

```bash
# テストモード（最初の3カットのみ）
node pipeline/inpaint.js \
  --clips-dir templates/02_Tumblerver2 \
  --product /path/to/product.jpg \
  --title "商品名" \
  --output-dir output/inpaintN \
  --test

# 本番モード（全カット）
node pipeline/inpaint.js \
  --clips-dir templates/02_Tumblerver2 \
  --product /path/to/product.jpg \
  --title "商品名" \
  --output-dir output/inpaintN \
  --production

# 中断再開
node pipeline/inpaint.js ... --resume <job_id>

# アセンブリスキップ（動画チェックのみ）
node pipeline/inpaint.js ... --no-assembly
```

> `ls output/` で現在の最大番号を確認してから `inpaintN+1` を指定すること。

---

## 処理フロー（5ステップ）

| ステップ | 内容 | API/ツール | ボトルネック |
|---------|------|-----------|------------|
| **1** | クリップ検出・SHOT_PATTERNS 割り当て | ffprobe | なし |
| **2a** | ゾーン検出（**順次**） | Claude Haiku | ★ レートリミット 5req/min |
| **2b** | Sharp 合成 → Seedance 生成（並列） | Sharp + fal.ai | ★★ Seedance 待ち（クリップ毎に数分） |
| **3** | concat → final.mp4 | ffmpeg | なし |
| **4** | ナレーション・字幕・カラーグレード → final_assembled.mp4 | ElevenLabs + ffmpeg | ElevenLabs 生成時間 |
| **5** | 品質評価（自動） | eval.js（Claude Sonnet） | なし |

### ボトルネック詳細

**Claude Haiku（Step 2a）**  
- レートリミット: 5req/min  
- ゾーン検出・画像品質チェック・ビデオフレームチェックで使用  
- **必ず逐次実行**（`for...of` ループ）。`Promise.all` で並列にすると即 429  

**Seedance（Step 2b）**  
- クリップ1本あたり 2〜5分  
- 失敗時は SAFE_PATTERNS で最大2回リトライ（最大3回生成）  
- 並列実行は可能（各クリップが独立して fal.ai queue に投入）  

---

## SHOT_PATTERNS 設計

`templates/02_Tumblerver2/` の 10本クリップ（cut1〜cut10）を実際に分析して定義。

### カテゴリ構成

```
HOOK（6種）  → 冒頭0〜2秒で目を止める
SHOW（6種）  → 商品の特徴・詳細を見せる
CLOSE（6種） → 購買意欲を高める締めショット
```

### 割り当て順序

カット数に関わらず `HOOK → SHOW → CLOSE → HOOK → ...` とサイクル。  
3カット: cut1=HOOK, cut2=SHOW, cut3=CLOSE  
10カット: cut1=HOOK, cut2=SHOW, cut3=CLOSE, cut4=HOOK, ...（同じカテゴリでも別パターンを使用）

### 全パターンに必須のプロンプト制約

```
product already held in hand in frame
single hand only, no duplicate products, no extra hands or arms
```

**NG**: 「画面外から商品が入る」系 → Seedance が既存商品＋新商品の2個を生成するバグが起きる

### SAFE_PATTERNS（リトライ専用、8種）

品質チェック失敗時のみ使用。ズーム・チルト・パン・クローズアップ。  
動きがシンプルで Seedance が安定して処理できる。

---

## Sharp 合成（商品画像の使い方）

**AI で商品を生成しない。** Sharp で元の商品画像を直接 1080×1920 に `cover` フィット合成する。

```
商品画像（任意サイズ）
  ↓ Sharp.resize(TARGET_W, TARGET_H, { fit: 'cover' })
  ↓ キーフレームに重ねて合成
  → 商品の色・形・ロゴが正確に再現された入力フレーム
  → Seedance に渡して動画化
```

**なぜ `cover` か**: `contain` だと正方形・横長商品に灰色レターボックスが入り不自然。

---

## テストモード / 本番モード

| フラグ | カット数 | 用途 |
|--------|---------|------|
| `--test` | 最初の3カット | 動作確認・コスト節約 |
| `--production` | 全カット（templates内の全mp4） | 本番出力 |
| なし（デフォルト） | 全カット | `--production` と同じ |

---

## API ルール

### fal.ai アップロード

SDK（`@fal-ai/client`）禁止。Claude Code sandbox で DNS エラーになるだけでなく、SDK 内部の fetch が不安定。  
**raw HTTP で initiate + PUT**:

```javascript
// 1. initiate
const { upload_url, file_url } = await fetch('https://rest.fal.ai/storage/upload/initiate', {
  method: 'POST',
  headers: { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ file_name: filename, content_type: mimeType }),
}).then(r => r.json());

// 2. PUT to pre-signed URL
await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: buf });

return file_url;
```

### Seedance モデル

```
fal-ai/bytedance/seedance/v1.5/pro/image-to-video
```

- `status_url` / `response_url` は fal.ai が返す値をそのまま使う（URL 手動構築禁止）
- ポーリング間隔: 5秒

### ElevenLabs TTS

- モデル: `eleven_v3`（失敗時フォールバック: `eleven_multilingual_v2`）
- ボイスID: `.env` の `ELEVENLABS_VOICE`

### Claude Haiku

- レートリミット: 5req/min → 逐次実行のみ
- 用途: ゾーン検出・画像品質チェック・ビデオフレームチェック
- ビデオフレームチェックは「視覚的品質・リアリズム」で判断（商品名照合しない）

---

## テキストオーバーレイ仕様

```
字幕:  y=h*0.62  fontsize=32  白文字・影（shadowx=2, shadowy=2）
CTA:   廃止済み（ユーザー判断で削除）
```

## カラーグレード（常に適用）

```
eq=brightness=0.03:contrast=1.08:saturation=1.15,
colorbalance=rs=0.04:gs=0.02:bs=-0.06:rm=0.02:gm=0.01:bm=-0.04:rh=0.01:gh=0.00:bh=-0.02
```

TikTok でよく見られるウォームトーン・高コントラスト仕上げ。

---

## eval.js — 品質評価エージェント

inpaint.js の Step 5 で自動実行される。

```bash
# 単体実行
node pipeline/eval.js \
  --generated output/inpaintN/final_assembled.mp4 \
  [--reference templates/Tumbler-full.mp4]
```

### 評価項目（12項目）

| 項目 | 説明 |
|------|------|
| 商品一致度 | 商品の外観・色・形状・ロゴが元画像と一致（最重要） |
| 商品統一感 | 全フレームで同じ商品が映っているか |
| 商品差し替え自然さ | 合成の違和感・アーティファクト・歪み |
| モーション品質 | 動きの滑らかさ・ブレのなさ |
| **カット間変化** | 各カットで視点・距離・向き・アクションが変化しているか（単調でないか） |
| 映像クオリティ | 解像度・シャープさ・色再現 |
| 背景照明整合性 | 商品と背景の光源・影・色温度の整合性 |
| TikTok適性 | 縦型構図・視認性・テンポ・購買意欲 |
| 字幕テキスト品質 | 読みやすさ・位置・タイミング |
| 商業的訴求力 | CVR 観点での購買促進力 |
| フック力 | 冒頭1〜2秒での離脱防止 |
| 総合スコア | 商業的価値を重視した総合判断 |

### 参照動画

デフォルト参照: `templates/Tumbler-full.mp4`  
参照動画は「理想的な TikTok 商品動画」として使用。  
生成動画が参照動画のレベルに達しているかを基準に相対採点。

### 判定基準

| スコア | 判定 | 対応 |
|--------|------|------|
| 90〜100 | ★ 優秀 | そのまま使用可 |
| 75〜89 | ◎ 良好 | 使用可 |
| 60〜74 | ○ 普通 | 改善推奨 |
| 45〜59 | △ 要改善 | 修正して再生成 |
| 0〜44 | ✕ 不良 | 必ず再生成 |

- モデル: `claude-sonnet-4-6`（Sonnet 使用理由: 12項目×コメント付き JSON を正確に生成するため）
- `max_tokens: 3000`（低いと JSON が途中で切れる）

---

## ffmpeg バイナリ

**homebrew なし**。npm パッケージで管理:

```javascript
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
// → node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg
```

bash から直接使う場合:
```bash
/Users/reoreo/claudecode/inoue-movie5/node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg
```

**ffmpeg 出力パスに日本語を使わない**（`Could not open file` エラーになる）。  
一時ファイル名は必ず ASCII のみ。

---

## 環境変数（.env）

| キー | 説明 |
|------|------|
| `FAL_KEY` | fal.ai（Seedance + upload） |
| `ANTHROPIC_API_KEY` | Claude（ゾーン検出・品質チェック・評価） |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS |
| `ELEVENLABS_VOICE` | ボイス ID |
| `VIDEO_GEN_PROVIDER` | `seedance`（default: `flux`） |
| `FFMPEG_PATH` / `FFPROBE_PATH` | ffmpeg バイナリパス（lib/ffmpeg-path.js が自動解決） |

---

## 既知の問題・注意点

| 問題 | 対処 |
|------|------|
| Claude Code sandbox で fal.ai DNS エラー | `dangerouslyDisableSandbox: true` でパイプライン実行 |
| sandbox で `/tmp/` への書き込み禁止 | 一時ファイルは `$TMPDIR`（= `/tmp/claude`）を使う |
| Commander `--no-assembly` が常に false になる | `false` をデフォルト値に渡さない（第3引数なし） |
| Seedance で商品が2個映る | 「画面外から商品が入る」系プロンプトを禁止。`product already held in hand in frame` を必須にする |
| Claude Haiku が商品カテゴリを誤認識 | 商品名照合でなく「視覚的品質・リアリズム」でチェック |
