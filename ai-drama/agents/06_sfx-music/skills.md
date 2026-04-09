# skills: 06_sfx-music

## 使い方

```js
import { runSfxMusic } from './agents/06_sfx-music/agent.js';

const result = await runSfxMusic({
  jobId,
  jobDir,
  scriptPath,   // {jobDir}/01_script.json
  clipsPath,    // {jobDir}/04_video-gen/04_clips.json
  verbose,
});
// result: { audioPlanPath: "{jobDir}/06_sfx-music/06_audio-plan.json", audioPlan: {...} }
```

## 出力ファイル

- `{jobDir}/06_sfx-music/bgm-selected.mp3` — 選択された BGM
- `{jobDir}/06_sfx-music/06_audio-plan.json` — FFmpeg 向け音声配置計画

## よくあるエラーと対処

| エラー | 原因 | 対処 |
|-------|------|------|
| `templates/bgm/ が空` | BGM ファイル未追加 | ロイヤリティフリー BGM を追加するか bgmPath を null にして音声なしで続行 |
| `sfx ファイル not found` | templates/sfx/ に未追加 | sfxEvents を空配列にして続行 |
