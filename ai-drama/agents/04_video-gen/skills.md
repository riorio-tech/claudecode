# skills: 04_video-gen

## 使い方

```js
import { runVideoGen } from './agents/04_video-gen/agent.js';

const result = await runVideoGen({
  jobId,
  jobDir,
  variantsPath,  // {jobDir}/03_image-gen/03_image-variants.json
  verbose,
});
// result: { clipsPath: "{jobDir}/04_video-gen/04_clips.json", clips: {...} }
```

## 出力ファイル

- `{jobDir}/04_video-gen/scene-XX-clip.mp4` — 各シーンのクリップ
- `{jobDir}/04_video-gen/04_clips.json` — クリップパスと実際の尺

## よくあるエラーと対処

| エラー | 原因 | 対処 |
|-------|------|------|
| `401 Unauthorized` | FAL_KEY 未設定 | .env を確認 |
| `status: FAILED` | Kling AI の生成失敗 | リトライ（SAFE モーション）→ それでも失敗なら静止画で代替 |
| `freeze detected` | クリップが静止 | `DYNAMIC DRAMATIC CAMERA MOVEMENT.` を先頭追加してリトライ |
| fal.ai 残高不足 | クレジット切れ | ユーザーにチャージを依頼（エスカレーション） |
