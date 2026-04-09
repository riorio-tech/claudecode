# 05_assembly エージェント

## 役割

1本分のクリップを連結し、音声（TTS）・字幕を追加して `final.mp4` を生成する。
出力先: `jobDir/05_assembly/video-{videoIndex}/final.mp4`

## 入力

- `videoClips`: 1本分のクリップ情報
- `videoShotPlan`: 1本分のショットプラン（字幕・ナレーション用）
- `assemblyDir`: `jobDir/05_assembly/video-{videoIndex}/`

## 出力: `AssemblyOutputSchema`

```json
{
  "jobId": "...",
  "videoIndex": 0,
  "finalVideoPath": ".../final.mp4",
  "durationSec": 22.0,
  "hasAudio": true
}
```

## TTS プロバイダ切替（config.TTS_PROVIDER）

| Provider | 処理 |
|----------|------|
| say (default) | macOS `say -v Kyoko` |
| elevenlabs | ElevenLabs API（未実装・差し替え容易） |
| voicevox | VOICEVOX API（未実装） |

## エスカレーション基準

- 動画の尺が 15 秒未満 または 30 秒超過の場合
