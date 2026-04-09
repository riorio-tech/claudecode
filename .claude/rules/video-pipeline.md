# inoue-movie5 動画生成パイプライン ルール

> 適用範囲: `/Users/reoreo/claudecode/inoue-movie5/` 配下の全作業

## 基本方針

- 商品画像を受け取り、テンプレートクリップの商品部分を差し替えた 9:16 縦型動画を生成する
- 動画は常に **1080×1920** で出力。商品画像サイズに引きずられない
- プロバイダ設定は `.env` のみで行う（コードへのハードコード禁止）

---

## 処理フロー（7ステップ）

| ステップ | 内容 | 実装 |
|---------|------|------|
| 1 | クリップ検出・ショットパターン割り当て | SHOT_PATTERNS からランダム選択（20種） |
| 2 | Claude Haiku でゾーン検出（**順次**） | 並列禁止（レートリミット対策） |
| 3 | Sharp で商品画像を 1080×1920 に `cover` 合成 | AI生成しない。元画像そのまま使う |
| 4 | Claude Haiku で合成画像の品質チェック → 失敗なら再合成 | スコア /10 |
| 5 | Seedance（fal.ai queue）で image-to-video 生成 | raw HTTP を使う（SDK 禁止） |
| 6 | Claude Haiku でビデオフレームチェック → 失敗時 SAFE_PATTERNS でリトライ（最大2回） | 外観品質を見る（商品カテゴリー判定しない） |
| 7 | ElevenLabs v3 でナレーション → 字幕・CTA・ウォームグレード → eval自動実行 | — |

---

## ショットパターン

- **SHOT_PATTERNS**: 20種類、ジョブごとにランダムシャッフルして割り当て
- **SAFE_PATTERNS**: 8種類（zoom/tilt/pan/closeup）。リトライ専用
- 全プロンプトに必須: `product already held in hand in frame` `single hand only, no duplicate products`
- **NG**: 「画面外から商品が入る」系のプロンプト → 商品2個生成バグが起きる

---

## API ルール

### fal.ai アップロード
SDK（`@fal-ai/client`）禁止 → raw HTTP で initiate + PUT を使う

### Seedance モデル
```
fal-ai/bytedance/seedance/v1.5/pro/image-to-video
```
status_url / response_url は fal.ai が返す値をそのまま使う（URL 手動構築禁止）

### ElevenLabs TTS
モデル: `eleven_v3`（失敗時フォールバック: `eleven_multilingual_v2`）  
ボイスID: `.env` の `ELEVENLABS_VOICE`

### Claude Haiku
- レートリミット: 5req/min → **逐次実行のみ**
- ゾーン検出・品質チェックで使用
- 外観品質チェックは商品名照合でなく「視覚的リアリズム」で判断する

---

## テキストオーバーレイ仕様

```
字幕:  y=h*0.62  fontsize=32  白文字・影（shadowx=2, shadowy=2）
CTA:   y=h*0.88  赤背景ボックス  fontsize=48  「⬇ ここから買える」
```

## カラーグレード（常に適用）

```
eq=brightness=0.03:contrast=1.08:saturation=1.15,
colorbalance=rs=0.04:gs=0.02:bs=-0.06:rm=0.02:gm=0.01:bm=-0.04:rh=0.01:gh=0.00:bh=-0.02
```

---

## エスカレーション基準

- 動画の尺が 9:16 でない場合
- API 課金が 1ジョブあたり ¥1,000 を超えそうな場合
- fal.ai の残高不足エラーが出た場合（ユーザーにチャージを依頼）
