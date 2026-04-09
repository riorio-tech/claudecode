# 05_assembly エージェント

## 役割

1本分のクリップを連結し、4Kアップスケール・音声・字幕・カラーグレードを施して `final.mp4` を生成する。

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

## 処理フロー

```
1. クリップ連結（ffmpeg concat）→ concat-noaudio.mp4
2. Real-ESRGAN 4K アップスケール → concat-4k.mp4
3. ElevenLabs TTS → narration.mp3 + alignment（タイムスタンプ）
4. タイムスタンプから字幕セグメント構築
5. ffmpeg: ウォームカラーグレード + 字幕 + 音声ミックス → final.mp4
```

## アップスケール（config.UPSCALE_PROVIDER）

| Provider | 処理 |
|----------|------|
| `esrgan` ★デフォルト | `fal-ai/real-esrgan`（RealESRGAN_x4plus）→ 失敗時 lanczos フォールバック |
| `none` | スキップ（テスト時に使用） |

## TTS プロバイダ（config.TTS_PROVIDER）

| Provider | 処理 |
|----------|------|
| `elevenlabs` ★デフォルト | ElevenLabs `eleven_v3` → `eleven_multilingual_v2` フォールバック |
| `say` | macOS `say -v Kyoko`（タイムスタンプなし） |

### ElevenLabs タイムスタンプ字幕

`/with-timestamps` エンドポイントを使用し、文字レベルの `alignment` を取得。
`。！？` 区切りで字幕セグメントを分割し `between(t,start,end)` で ffmpeg drawtext に変換。

## カラーグレード（ウォームグレード）

```
eq=brightness=0.03:contrast=1.08:saturation=1.15,
colorbalance=rs=0.04:gs=0.02:bs=-0.06:rm=0.02:gm=0.01:bm=-0.04:rh=0.01:gh=0.00:bh=-0.02
```

字幕は `y=h*0.88`、フォントサイズは入力解像度に応じてスケール。

## エスカレーション基準

- 動画の尺が 15 秒未満 または 30 秒超過の場合

## 環境変数

| キー | 用途 |
|------|------|
| `FAL_KEY` | Real-ESRGAN（動画アップロード + アップスケール） |
| `ELEVENLABS_API_KEY` | TTS 生成 |
| `ELEVENLABS_VOICE` | ボイス ID |
