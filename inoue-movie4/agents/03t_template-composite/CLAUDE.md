# 03t_template-composite エージェント

## 役割

テンプレート動画（実撮影 MP4）に新商品画像をコンポジットして、
実撮影クオリティの商品動画を生成する。

`03_image-gen` + `04_video-gen` を置き換えるテンプレートモード専用エージェント。

## 処理フロー

1. ffmpeg でテンプレートを 30fps フレーム列に分解
2. fal.ai rembg で商品画像の背景を除去（FAL_KEY 未設定時はスキップ）
3. Sharp で商品をゾーンサイズにリサイズ
4. 全フレームに商品をコンポジット（20枚並列）
5. ffmpeg でフレームを動画に再合成（元音声を維持）

## 入力

```json
{
  "jobId": "uuid",
  "videoIndex": 0,
  "templateVideoPath": "/path/to/template.mp4",
  "sourceImagePath": "/path/to/product.jpg",
  "zone": { "x": 280, "y": 420, "w": 520, "h": 680 },
  "outputDir": "/tmp/inoue-job-{jobId}/03t_template/video-00/",
  "verbose": false
}
```

`zone` は `templates/{name}.zone.json` に保存して再利用する。

## 出力: `TemplateCompositeOutputSchema`

```json
{
  "jobId": "uuid",
  "videoIndex": 0,
  "compositedVideoPath": "/tmp/.../composited.mp4",
  "templateName": "hand-product-v1",
  "durationSec": 15.0,
  "hasTemplateAudio": true
}
```

## テンプレートライブラリ

```
templates/
├── hand-product-v1.mp4
├── hand-product-v1.zone.json     ← { x, y, w, h, fps, notes, recommendedCategory }
├── lifestyle-desk-v1.mp4
└── lifestyle-desk-v1.zone.json
```

## 後続エージェント

出力の `compositedVideoPath` を `05_assembly` に渡す。
`05_assembly` は concat をスキップし、コンポジット動画に TTS 音声と字幕を追加する。
