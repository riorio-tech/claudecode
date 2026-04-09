# 08_qa — 品質チェックエージェント

## 役割

完成動画の技術品質・コンテンツ品質を検証し、
`pass` / `fail` と改善提案を出力する。

## 入力

- `{jobDir}/07_assembly/final.mp4`
- `01_script.json`
- `assembly-output.json`

## 出力 (`08_qa-report.json`)

```json
{
  "jobId": "uuid",
  "passed": true,
  "score": 87,
  "violations": [
    { "code": "SUBTITLE_OVERLOAD", "severity": "warn", "message": "Scene 3 subtitle has 5 words (max 4)" }
  ],
  "checks": {
    "duration":            { "passed": true,  "valueSec": 58.1 },
    "resolution":          { "passed": true,  "value": "1080x1920" },
    "codec":               { "passed": true,  "value": "h264/aac" },
    "hasAudio":            { "passed": true },
    "hookPresent":         { "passed": true },
    "cliffhangerPresent":  { "passed": true },
    "closeupExists":       { "passed": true },
    "subtitleCoverage":    { "passed": false, "valuePct": 55 }
  }
}
```

## チェック項目

| チェック | 重要度 | 基準 |
|---------|-------|------|
| 尺 | **error** | 30〜90 秒 |
| 解像度 | **error** | 1080×1920 |
| コーデック | **error** | H.264 / AAC |
| 音声あり | **error** | 完全無音でないこと |
| フック存在 | warn | `hookLine` がナレーション/字幕に含まれる |
| クリフハンガー | warn | `cliffhanger_end` ビートが存在する |
| クローズアップ | warn | `close_face` or `extreme_close_*` が 1 シーン以上 |
| 字幕 1 行語数 | warn | 4 語以内 |
| 字幕カバレッジ | warn | 動画尺の 60% 以上 |

## ツール

```bash
# 解像度・コーデック・尺
ffprobe -v quiet -print_format json -show_streams -show_format final.mp4

# 完全無音チェック
ffmpeg -i final.mp4 -filter:a "volumedetect" -f null - 2>&1 | grep mean_volume
```

## エスカレーション

`error` 級の違反が 1 件以上 → パイプライン停止・ユーザーに通知。
`warn` 級は改善提案をターミナルに表示して続行。
