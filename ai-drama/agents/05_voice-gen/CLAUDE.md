# 05_voice-gen — 音声生成エージェント

## 役割

ElevenLabs でキャラクター台詞・ナレーター音声を生成。
タイミングデータ付きで返し、字幕同期に使用する。

## 入力

`01_script.json` — 脚本（台詞・ナレーション・感情ビート）

## 出力

```
{jobDir}/05_voice/
├── scene-00-narrator.mp3
├── scene-01-char_a.mp3
├── scene-02-char_b.mp3
├── ...
└── 05_voice-plan.json
```

## ElevenLabs API

**タイミングデータ付き（優先）:**
```
POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps
xi-api-key: {ELEVENLABS_API_KEY}
{
  "text": "台詞テキスト",
  "model_id": "{ELEVENLABS_MODEL}",
  "voice_settings": { "stability": 0.4, "similarity_boost": 0.8, "style": 0.6 }
}
→ { "audio_base64": "...", "alignment": { "characters": [...], "character_start_times_seconds": [...] } }
```

**フォールバック（タイミング取得失敗時）:**
```
POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
→ audio/mpeg バイナリ
```

## 感情ビート別 voice_settings

| emotionalBeat | stability | similarity_boost | style | 意図 |
|--------------|-----------|-----------------|-------|------|
| `hook_opener` | 0.3 | 0.8 | 0.6 | 囁き・緊張・親密 |
| `tension_build` | 0.4 | 0.7 | 0.5 | やや抑えた緊張 |
| `confrontation` | 0.5 | 0.7 | 0.8 | 鋭い・速い |
| `declaration` | 0.4 | 0.9 | 0.9 | 力強い・明確 |
| `despair` | 0.7 | 0.6 | 0.3 | 遅い・弱い・消え入る |
| `shock_reaction` | 0.2 | 0.8 | 0.7 | 驚き・高め |
| `cliffhanger_end` | 0.5 | 0.8 | 0.4 | 余韻・静か |

## 出力スキーマ (`05_voice-plan.json`)

```json
{
  "jobId": "uuid",
  "voiceFiles": [
    {
      "sceneIndex": 0,
      "speakerId": "narrator",
      "voiceIdKey": "ELEVENLABS_VOICE_NARRATOR",
      "text": "テキスト",
      "audioPath": "/tmp/.../05_voice/scene-00-narrator.mp3",
      "durationSec": 3.2,
      "alignment": { "characters": [...], "character_start_times_seconds": [...] }
    }
  ]
}
```
