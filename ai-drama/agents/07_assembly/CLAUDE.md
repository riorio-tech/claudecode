# 07_assembly — FFmpeg 最終合成エージェント

## 役割

全クリップ・音声・字幕・カラーグレードを FFmpeg で合成し、
`final.mp4`（1080×1920、H.264/AAC）を出力する。

## 入力

- `04_clips.json` — クリップパス
- `05_voice-plan.json` — 音声パス + タイミング
- `06_audio-plan.json` — BGM 配置計画
- `02_scene-plan.json` — 字幕テキスト（タイミングのフォールバック）

## 出力

```
{jobDir}/07_assembly/
├── list.txt
├── concat-noaudio.mp4
├── audio-mixed.mp3
├── final.mp4              ← 最終成果物
└── assembly-output.json
```

## FFmpeg 処理ステップ

### Step 1: クリップ結合
```bash
ffmpeg -f concat -safe 0 -i list.txt -c copy concat-noaudio.mp4
```

### Step 2: 音声ミックス
```bash
ffmpeg \
  -i concat-noaudio.mp4 \
  -i narration.mp3 \
  -i bgm-selected.mp3 \
  -filter_complex \
    "[1:a]volume=1.0[narr];\
     [2:a]volume=0.25,aloop=loop=-1:size=2e+09[bgm];\
     [narr][bgm]amix=inputs=2:duration=first[aout]" \
  -map "[aout]" audio-mixed.mp3
```

### Step 3: 字幕 + カラーグレード + 音声 → final.mp4
```bash
ffmpeg \
  -i concat-noaudio.mp4 \
  -i audio-mixed.mp3 \
  -filter_complex \
    "[0:v]{colorGrade},{subtitleFilters}[v]" \
  -map "[v]" -map "1:a" \
  -c:v libx264 -crf 18 -preset fast \
  -c:a aac -b:a 192k \
  final.mp4
```

## 字幕スタイル

```
fontfile=/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc
fontsize=h*0.045
fontcolor=white
borderw=3
bordercolor=black
x=(w-text_w)/2
y=h*0.85
```

## カラーグレード

`config.FFMPEG_COLOR_GRADE` を使用。
デフォルト: ドラマ用コールドグレード（`DESIGN.md` §3.6 参照）

## エスカレーション

- `final.mp4` の尺が `MIN_DURATION_SEC` 未満 or `MAX_DURATION_SEC` 超過 → エラー（出力しない）
- 音声が完全無音 → エラー
