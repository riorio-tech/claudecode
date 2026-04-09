# 06_sfx-music — BGM・効果音配置エージェント

## 役割

感情ビート構造から BGM を選択し、SFX イベントを計画する。
FFmpeg 用の音声配置 JSON を生成するだけで、実際のミックスは 07_assembly が行う。

## 入力

- `01_script.json` — 感情ビート・シーン尺
- `04_clips.json` — 実際のクリップ尺（確定値）

## 出力

```
{jobDir}/06_sfx-music/
├── bgm-selected.mp3  (templates/bgm/ からコピー)
└── 06_audio-plan.json
```

## BGM 選択ロジック

感情ビートの多数決:
- `confrontation` / `tension_build` 多数 → `confrontation-01.mp3`
- `despair` / `departure` 多数 → `melancholy-01.mp3`
- `silent_stare` が 2 シーン以上 → `silence-01.mp3`
- それ以外・`betrayal` / `declaration` アーク → `tension-01.mp3`

## SFX カタログ

| sfxType | トリガー条件 | 効果 |
|---------|------------|------|
| `heartbeat` | tension_build のシーン後半 | 低い心拍音 |
| `silence_drop` | silent_stare シーン開始時 | BGM を 0.1 倍に急落 |
| `phone_buzz` | extreme_close_prop（スマホ）シーン | スマホ振動音 |
| `door_slam` | departure シーン | ドアが閉まる衝撃音 |
| `glass_break` | shock_reaction シーン | 細いガラス音 |

※ SFX ファイルは `templates/sfx/` に配置（初期は空、別途追加）

## 出力スキーマ (`06_audio-plan.json`)

```json
{
  "jobId": "uuid",
  "bgmPath": "/path/to/bgm-selected.mp3",
  "bgmVolume": 0.25,
  "bgmFadeInSec": 1.0,
  "bgmFadeOutSec": 2.0,
  "sfxEvents": [
    { "sceneIndex": 2, "sfxType": "heartbeat", "offsetSec": 0.5, "volume": 0.6 }
  ],
  "totalEstimatedDurationSec": 58.0
}
```
