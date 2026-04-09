# 04_video-gen — Kling AI 動画生成エージェント

## 役割

Kling AI (fal.ai queue) で各キーフレームをモーション付きクリップに変換。
**SDK 使用禁止 → raw HTTP queue パターン必須**（fal.ai ネストモデルパスの制約）

## 入力

`03_image-variants.json` — 画像パス + モーションコード

## 出力

```
{jobDir}/04_video-gen/
├── scene-00-clip.mp4  (1080×1920, {CLIP_DURATION_SEC}秒)
├── scene-01-clip.mp4
├── ...
└── 04_clips.json
```

## fal.ai Raw HTTP Queue パターン

```
# Step 1: ジョブ投入
POST  https://queue.fal.run/{KLING_FAL_MODEL}
Authorization: Key {FAL_KEY}
Content-Type: application/json
{
  "image_url": "{uploadedImageUrl}",
  "prompt": "{motionPrompt}",
  "duration": {CLIP_DURATION_SEC},
  "aspect_ratio": "9:16"
}
→ { "request_id": "..." }

# Step 2: ステータスポーリング（3 秒間隔）
GET   https://queue.fal.run/{KLING_FAL_MODEL}/requests/{request_id}/status
→ { "status": "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" }

# Step 3: 結果取得
GET   https://queue.fal.run/{KLING_FAL_MODEL}/requests/{request_id}
→ { "video": { "url": "..." } }
```

**status_url / response_url は fal.ai が返す値をそのまま使う（URL 手動構築禁止）**

## モーションプロンプト構築

`templates/motion-prompts.json` からモーションコードに対応するプロンプトを取得し、
学生ドラマ向けのコンテキストを先頭に追加:

```
"{scene.environment} scene. {motionPrompts[scene.motionCode]}. photorealistic, 9:16 vertical, cinematic drama"
```

## 静止フレーム検出・リトライ

```bash
ffmpeg -i clip.mp4 -vf "freezedetect=n=0.003:d=2.0" -f null - 2>&1 | grep "freeze_start"
```

フリーズ検出 → プロンプト先頭に `DYNAMIC DRAMATIC CAMERA MOVEMENT. ` を追加してリトライ（最大 2 回）

## 並列実行

`Promise.allSettled()` で全シーン並列投入。
失敗シーンは 1 回リトライ、それでも失敗なら `"status": "failed"` で記録。
