# 04_video-gen エージェント

## 役割

画角画像から 1カット分の動画クリップを生成する。
`config.VIDEO_GEN_PROVIDER` に応じてプロバイダを切り替える。

## 入力

- `imageVariants`: 1本分の画像バリアント
- `videoShotPlan`: 1本分のショットプラン
- `videoGenDir`: 出力先（`jobDir/04_video-gen/`）

## 出力: `VideoClipsSchema`

```json
{
  "jobId": "...",
  "videoIndex": 0,
  "clips": [
    { "videoIndex": 0, "shotIndex": 0, "videoPath": "...", "durationSec": 5, "motion": "zoom-in" },
    ...
  ]
}
```

## プロバイダ切替

| VIDEO_GEN_PROVIDER | 処理 |
|-------------------|------|
| `local` | ffmpeg で静止画 → クリップ（zoompan等） |
| `runway` ★デフォルト | Runway Gen-3 Alpha via `@fal-ai/client`（`fal-ai/runway-gen3/alpha/image-to-video`） |

### runway モードの動作

```
1. 各画像を @fal-ai/client の fal.storage.upload() でアップロード → URL 取得
2. 全クリップを Promise.all で並列 submit
3. raw HTTP queue API でポーリング（最大15分）
4. 動画 URL をダウンロードして .mp4 に保存
5. freezedetect で静止画検出 → 最大3回リトライ
```

**注意: `@fal-ai/client` の `fal.subscribe()` は `fal-ai/runway-gen3/alpha/image-to-video` のような
ネストしたモデルパスで result URL を誤構築するバグがある。**
そのため submit / poll / result 取得はすべて生 HTTP で行う:

```js
// Submit
POST https://queue.fal.run/{model}
  body: { image_url, prompt, duration: 5, ratio: '9:16' }
→ { request_id }

// Poll
GET https://queue.fal.run/{model}/requests/{request_id}/status
  → { status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' }

// Result
GET https://queue.fal.run/{model}/requests/{request_id}
  → { video: { url } }
```

**motion → Runway プロンプト変換:**

| motion | prompt |
|--------|--------|
| zoom-in | slow dolly in, camera slowly moves forward |
| zoom-out | slow dolly out, camera slowly pulls back |
| slide-left | smooth pan left |
| slide-right | smooth pan right |
| flash | dynamic energetic camera movement |
| static | subtle handheld camera drift |

### 静止画リトライ

`ffmpeg freezedetect=n=0.003:d=2.0` で凍結を検出。
検出された場合は `DYNAMIC VIDEO. {prompt} Strong visible motion throughout.` で最大3回再生成。

## 環境変数

| キー | 用途 |
|------|------|
| `FAL_KEY` | fal.ai（画像アップロード + Runway Gen-3 submit） |
