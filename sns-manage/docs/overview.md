# SNS管理AIエージェントシステム — 概要

## このシステムは何か

Twitter/X・TikTok・YouTube・Instagramを横断して**AIが自律的に運用する**SNS管理システム。

単なる作業効率化ツールではない。**使い続けるほど賢くなる永続的な資産**として設計されている。
投稿するたびに知識が蓄積され、失敗するたびにシステムが強化される。

---

## 設計哲学・ユーザーニーズ・成果定義

→ **[ugc/VISION.md](../../ugc/VISION.md)** を参照。  
`sns-manage/` と `ugc/` の共通北極星（アンチフラジリティ・模倣欲望・3レイヤー成果定義）はここに統合されている。

---

## 24時間自動サイクル

```
[毎日 設定時刻 JST]
   scheduler.js
      ↓
   01_research → 02_planning → 03_writer → 05_marketing
      ↓ 生成完了
   06_publish（AUTO_APPROVE=true なら自動投稿）
      ↓
   analytics_schedule に +24h/+72h/+168h を登録

[毎時 :00]
   getPendingAnalytics()
      ↓
   07_analytics: Platform API → metrics テーブル
      ↓
   08_evaluate: A/Bテスト判定
      ├─ 勝ち → patterns テーブルに登録
      └─ 負け → failure_patterns に登録 + knowledge_base を更新
      ↓
[毎日 0:00]
   09_report: daily_snapshots → Google Sheets

[毎週月曜 0:00]
   09_report: Claude Sonnet で週次AIレポート生成
```

---

## 技術スタック

| 項目 | 採用 |
|---|---|
| Runtime | Node.js 20+ (ESM) |
| AI | Anthropic SDK（Sonnet = 高精度 / Haiku = 軽量・高速） |
| DB | better-sqlite3（SQLite） |
| Validation | zod + extractJson |
| Web API | Fastify |
| Dashboard | Vanilla JS + Chart.js v4 |
| Scheduler | node-cron（Asia/Tokyo） |
| Browser 自動化 | Playwright（Chromium） |
| Sheets 連携 | Google Sheets API v4（googleapis） |
| Platform | Twitter API v2 / TikTok / YouTube / Instagram Graph API |
