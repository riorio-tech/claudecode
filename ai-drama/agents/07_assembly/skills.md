# skills: 07_assembly

## 使い方

```js
import { runAssembly } from './agents/07_assembly/agent.js';

const result = await runAssembly({
  jobId,
  jobDir,
  clipsPath,     // {jobDir}/04_video-gen/04_clips.json
  voicePlanPath, // {jobDir}/05_voice/05_voice-plan.json
  audioPlanPath, // {jobDir}/06_sfx-music/06_audio-plan.json
  scenePlanPath, // {jobDir}/02_scene-plan.json
  verbose,
});
// result: { finalPath: "{jobDir}/07_assembly/final.mp4", durationSec: 58.2 }
```

## 出力ファイル

- `{jobDir}/07_assembly/final.mp4` — 完成動画
- `{jobDir}/07_assembly/assembly-output.json` — メタデータ（尺・解像度・コーデック）

## よくあるエラーと対処

| エラー | 原因 | 対処 |
|-------|------|------|
| `ffmpeg: command not found` | ffmpeg 未インストール | `@ffmpeg-installer/ffmpeg` の path を確認 |
| `duration out of range` | 尺が 30〜90 秒を外れる | クリップ数・各シーン尺を調整 |
| `no audio stream` | 音声ミックス失敗 | 05_voice-gen / 06_sfx-music の出力を確認 |
| 字幕文字化け | 日本語フォントなし | フォントパスを環境に合わせて設定 |
