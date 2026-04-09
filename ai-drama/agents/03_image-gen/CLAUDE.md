# 03_image-gen — キーフレーム画像生成エージェント

## 役割

NanoBanana Pro API を呼び出し、各シーンのキーフレーム画像（1080×1920）を生成。

## 入力

`02_scene-plan.json` — シーンプラン

## 出力

```
{jobDir}/03_image-gen/
├── scene-00-keyframe.jpg  (1080×1920)
├── scene-01-keyframe.jpg
├── ...
└── 03_image-variants.json
```

## NanoBanana Pro API

```
POST {NANOBANANA_API_URL}/generate
Content-Type: application/json
Authorization: Bearer {NANOBANANA_API_KEY}

{
  "prompt": "{scene.imagePrompt}",
  "negative_prompt": "{scene.negativePrompt}",
  "width": 1080,
  "height": 1920,
  "style": "{config.NANOBANANA_STYLE}",
  "steps": 30,
  "guidance_scale": 7.5
}
→ { "image_url": "..." } or { "image_base64": "..." }
```

**注意:** NanoBanana Pro の実際の API 仕様は実装時に確認すること。
上記はプレースホルダーであり、実際のエンドポイント・パラメータ名は異なる場合がある。

## フォールバック

`IMAGE_GEN_PROVIDER=fal_flux` の場合:
```
POST https://queue.fal.run/fal-ai/flux-pro/v1
{ prompt, image_size: { width: 1080, height: 1920 } }
```

## エラー処理

- **429 レートリミット**: 指数バックオフ（1s → 2s → 4s）、最大 3 回
- **解像度不正**: 拒否して size パラメータを明示して再送
- **全シーン逐次実行**（レートリミット対策）
- 失敗シーンは `03_image-variants.json` に `"status": "failed"` で記録
