# skills: 03_image-gen

## 使い方

```js
import { runImageGen } from './agents/03_image-gen/agent.js';

const result = await runImageGen({
  jobId,
  jobDir,
  scenePlanPath,  // {jobDir}/02_scene-plan.json
  verbose,
});
// result: { variantsPath: "{jobDir}/03_image-gen/03_image-variants.json", variants: {...} }
```

## 出力ファイル

- `{jobDir}/03_image-gen/scene-XX-keyframe.jpg` — 各シーンのキーフレーム
- `{jobDir}/03_image-gen/03_image-variants.json` — 画像パスとメタデータ

## よくあるエラーと対処

| エラー | 原因 | 対処 |
|-------|------|------|
| `401 Unauthorized` | NANOBANANA_API_KEY 未設定 | .env を確認 |
| `413 Payload Too Large` | プロンプトが長すぎる | 500 文字以内に切り詰め |
| 画像が 1080×1920 でない | API のデフォルトサイズ | size パラメータを明示 |
| `IMAGE_GEN_PROVIDER=mock` | テスト用モック | 灰色の placeholder 画像を生成 |
