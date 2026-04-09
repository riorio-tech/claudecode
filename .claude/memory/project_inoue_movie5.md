---
name: inoue-movie5 プロジェクト概要
description: TikTok商品動画自動生成パイプラインの構成・ファイル・設計方針
type: project
---

## 場所
`/Users/reoreo/claudecode/inoue-movie5/`

## 目的
商品画像を受け取り、テンプレート動画の商品部分だけを差し替えた TikTok 縦型動画（9:16）を自動生成する。

## 主要ファイル

| ファイル | 役割 |
|---------|------|
| `pipeline/inpaint.js` | メインパイプライン（Sharp合成→Seedance→ElevenLabs→ffmpeg） |
| `pipeline/eval.js` | 生成後の品質評価エージェント（100点満点・自動実行） |
| `templates/00_Tumbler/` | テンプレート動画クリップ（3本：cut1/cut2/cut3） |
| `output/inpaintN/` | 生成結果（NNN は連番） |
| `lib/ffmpeg-path.js` | ffmpeg/ffprobe バイナリパス解決 |
| `.env` | API キー・プロバイダ設定 |

## 処理フロー（inpaint.js）

1. クリップ一覧取得・ショットパターン割り当て（20種類からランダム）
2. Claude Haiku でゾーン検出（順次・並列しない）
3. Sharp で商品画像を 1080×1920 に `cover` フィットして合成
4. Claude Haiku で合成画像の品質チェック（スコア/10）
5. Seedance（fal-ai/bytedance/seedance/v1.5/pro/image-to-video）で動画生成
6. Claude Haiku でビデオフレームチェック → 失敗時 SAFE_PATTERNS でリトライ（最大2回）
7. ffmpeg で concat → final.mp4
8. ElevenLabs v3 でナレーション生成 → 字幕・CTA・ウォームグレード合成
9. eval.js で品質評価（自動・100点満点）→ eval_log.md に追記

## プロバイダ設定（.env）

```
VIDEO_GEN_PROVIDER=seedance
IMAGE_GEN_PROVIDER=nano-banana   # 現在は Sharp に内部で上書き
TTS_PROVIDER=elevenlabs
UPSCALE_PROVIDER=esrgan          # 現在は未使用
SEEDANCE_ENDPOINT=fal-ai/bytedance/seedance/v1.5/pro/image-to-video
ELEVENLABS_VOICE=4sirbXwrtRlmPV80MJkQ
CLAUDE_MODEL=claude-sonnet-4-6
CLAUDE_HAIKU_MODEL=claude-haiku-4-5-20251001
```

## 出力命名規則
`output/inpaintN/` に連番で格納。`final_assembled.mp4` が最終成果物。

**Why:** ユーザーが「出力フォルダに順次格納」と指定。  
**How to apply:** 新しい生成を行うたびに連番を確認して output-dir を指定する。
