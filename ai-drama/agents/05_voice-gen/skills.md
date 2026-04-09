# skills: 05_voice-gen

## 使い方

```js
import { runVoiceGen } from './agents/05_voice-gen/agent.js';

const result = await runVoiceGen({
  jobId,
  jobDir,
  scriptPath,  // {jobDir}/01_script.json
  verbose,
});
// result: { voicePlanPath: "{jobDir}/05_voice/05_voice-plan.json", voicePlan: {...} }
```

## 出力ファイル

- `{jobDir}/05_voice/scene-XX-{speakerId}.mp3` — 各発話の音声
- `{jobDir}/05_voice/05_voice-plan.json` — パスとタイミングデータ

## よくあるエラーと対処

| エラー | 原因 | 対処 |
|-------|------|------|
| `401` | ELEVENLABS_API_KEY 未設定 | .env を確認 |
| `with-timestamps` 失敗 | v3 モデル非対応 | フォールバック TTS を使用（タイミングは文字数から推算） |
| 音声が生成されない | voice_id 不正 | ELEVENLABS_VOICE_A/B/NARRATOR を確認 |
| モデル `eleven_v3` 非対応 | アカウントプラン | `eleven_multilingual_v2` にフォールバック |
