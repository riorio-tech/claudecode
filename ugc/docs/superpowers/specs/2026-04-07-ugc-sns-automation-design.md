# UGC × SNS 自動運用システム 設計仕様

**作成日**: 2026-04-06  
**対象ディレクトリ**: `/Users/reoreo/claudecode/ugc/`  
**ステータス**: 承認済み

---

## 上段設計（ユーザーニーズ・成果定義・設計哲学）

→ **[ugc/VISION.md](../../../VISION.md)** を参照。  
`ugc/` と `sns-manage/` の共通北極星。実装判断に迷ったときはここに立ち返る。

---

## 全体フロー（3フェーズ）

```
商品画像 + タイトル
        ↓
[ Phase 1: 動画生成 ]  → tech/phase1-heygen.md
  分析 → リサーチ → スクリプト → HeyGen動画 → アセンブリ
        ↓
[ Phase 2: SNS配信 ]   → tech/phase2-sns-distribution.md
  TikTok / Instagram Reels / YouTube Shorts へ自動投稿
        ↓
[ Phase 3: 分析・最適化 ] → tech/phase3-analytics.md
  エンゲージメント取得 → 勝ちパターン特定 → 次回スクリプトに反映
```

---

## ディレクトリ構造（最終形）

```
ugc/
├── pipeline/
│   ├── run.js / analyze.js / research.js / script-plan.js
│   ├── avatar-gen.js   # HeyGen/MakeUGC 抽象化
│   ├── assembly.js
│   ├── distribute.js   # Stage 7: SNS投稿（新規）
│   ├── analytics.js    # Stage 8: 効果測定（新規）
│   └── code-review.js
├── lib/
│   ├── heygen.js / makeugc.js
│   ├── tiktok.js / instagram.js / youtube.js  # 新規
│   ├── metrics-db.js   # SQLite 永続化（新規）
│   └── logger.js / job-dir.js
└── output/
    ├── inpaint{N}/
    │   ├── final_assembled_{0,1,2}.mp4
    │   └── post_result.json
    └── analytics_report.md  # 勝ちパターンレポート（全ジョブ横断）
```

---

## 技術仕様（サブファイル）

| ファイル | 内容 |
|---|---|
| [tech/phase1-heygen.md](tech/phase1-heygen.md) | HeyGen API 仕様・プロバイダ抽象化 |
| [tech/phase2-sns-distribution.md](tech/phase2-sns-distribution.md) | TikTok/Instagram/YouTube 投稿フロー |
| [tech/phase3-analytics.md](tech/phase3-analytics.md) | SQLite スキーマ・フィードバックループ |
| [tech/harness-engineering.md](tech/harness-engineering.md) | ハーネスエンジニアリング設計（6つのギャップ） |
| [tech/concerns.md](tech/concerns.md) | 懸念点・対応策・検証方法 |

---

## ファン対応（Phase 4 将来対応）

```
pipeline/comment-reply.js  ← 新規 Stage 9（将来対応）

動作:
1. 各プラットフォームのコメントを取得（TikTok/Instagram/YouTube API）
2. Claude Sonnet でコメントを分類（質問・クレーム・絶賛・スパム）
3. カテゴリ別のトーンでAI返信文を生成（ブランドガイドラインに準拠）
4. 返信候補を output/inpaint{N}/comment_replies.md に出力
5. 自動返信 or 人間レビュー後に返信（設定で切り替え）
```

デフォルトは「返信候補の生成のみ」。人間が確認後に投稿する設計。
