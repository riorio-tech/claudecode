---
name: ai-drama プロジェクト設計・初期方針
description: アカウント目標・コンテンツ設計・9エージェント構成・技術スタック
type: project
---

## アカウント目標

- フォロワー 100 万人、平均再生数 500 万回
- 大手企業案件 月 30 件（1 日 1 件）

## コンテンツ設計

- テーマ: 学生生活 × 逆襲・復讐・成り上がり
- スタイル: 中国・韓国の漫画原作風
- フォーマット: 1話1分 × 3話シリーズ

**Why:** フォロワー獲得とマネタイズには「継続視聴」が鍵。3話シリーズは視聴者を次の話へ誘導し、アカウントに定着させる。
**How to apply:** 各話の最後は必ずクリフハンガーで終わる。3話目は完結しつつ新シリーズの予告を入れる。

## 技術スタック

- NanoBanana Pro → 画像生成（API 仕様は実装時要確認）
- Kling AI (fal-ai/kling-video/v1.6/standard/image-to-video) → 動画生成
- ElevenLabs v3 → キャラクター音声
- FFmpeg → 最終合成・字幕・コールドカラーグレード

## 9エージェント構成

01_script-writer → 02_scene-breakdown → (03_image-gen → 04_video-gen) // (05_voice-gen → 06_sfx-music) → 07_assembly → 08_qa → 09_eval

**09_eval の特徴:** 参照動画と比較して100点満点評価。Claude Sonnet ビジョン使用。eval_log.md に追記。
