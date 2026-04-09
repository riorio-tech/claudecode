# ロードマップ

---

## Phase 1 — MVP ✅ 完了

**目標:** Twitter + TikTokでAI生成→人間承認→投稿が動く

### 実装済み

| 機能 | 状態 |
|------|------|
| 基盤（config.js / lib/ / db/） | ✅ |
| 01_research（トレンド・欲望連鎖調査） | ✅ |
| 02_planning（勝ち/負けパターン注入） | ✅ |
| 03_writer（模倣欲望原則ライティング） | ✅ |
| 05_marketing（desire_centric vs object_centric A/B） | ✅ |
| 06_publish（Twitter投稿 + 承認ゲート） | ✅ |
| 07_analytics（指標収集 + 分析スケジュール） | ✅ |
| 08_evaluate（A/Bテスト判定 + 失敗分析） | ✅ |
| 09_report（日次スナップショット + 週次AIレポート） | ✅ |
| 10_browser（Playwright ブラウザ自動化） | ✅ |
| Web API（Fastify） | ✅ |
| ダッシュボード（Chart.js v4 + 週次比較UI） | ✅ |
| スケジューラー（node-cron, Asia/Tokyo） | ✅ |
| 永続資産DB（patterns / failure_patterns / knowledge_base / desire_map / experiment_log） | ✅ |
| Google Sheets連携（日次/週次自動書き込み） | ✅ |

### 確認方法

```bash
node orchestrator.js --topic "夏のスキンケア" --platforms twitter --dry-run
# → jobs/{jobId}/01〜05_*.json が生成されること

node cli.js approve --job-id {jobId}
node cli.js publish --job-id {jobId}
# → Twitterに投稿されること
```

---

## Phase 2 — 全プラットフォーム + 分析ループ強化

**目標:** 4プラットフォーム自動投稿 + 学習ループ本稼働

### 残タスク

| 機能 | 優先度 |
|------|--------|
| TikTok publisher実装（Content API） | 高 |
| Instagram publisher実装（Graph API） | 高 |
| YouTube publisher実装（Data API v3） | 中 |
| platform-auth.js（OAuth2 + トークン自動更新） | 高 |
| Threads publisher（ACCESS_TOKEN設定済み） | 中 |
| WebSocket進捗表示（パイプライン実行リアルタイム） | 中 |
| コンテンツプレビュー画面の強化 | 低 |
| 07_analytics: TikTok/Instagram/YouTube Insights API | 高 |
| audience_fingerprint の学習ループ強化 | 中 |

### Threads対応（優先）

`/Users/reoreo/claudecode/.env` に `THREADS_ACCESS_TOKEN` と `THREADS_USER_ID` が設定済み。
Meta Threads API を使った publisher を `agents/06_publish/publishers/threads.js` として追加する。

---

## Phase 3 — デザイン自動化 + スケールアップ

**目標:** ビジュアル生成自動化 + インフラ強化

### 計画

| 機能 | 内容 |
|------|------|
| 04_design agent | fal.ai FLUX連携（サムネイル・ビジュアル生成） |
| Redis + BullMQ | ジョブキューイング（高負荷対応） |
| React + Vite | ダッシュボード刷新（現: Vanilla JS） |
| マルチアカウント対応 | 複数アカウントの並列運用 |
| 知識ベースエクスポート | CSVや別システムへの知識移植 |
| A/Bテスト統計的有意性 | Bayesian A/B検定の精度向上 |

---

## 設計哲学の蓄積目標

運用開始後、以下の指標で「永続資産としての価値」を測る:

| 指標 | 目標値 |
|------|--------|
| knowledge_base の confidence 平均 | 0.7以上（3ヶ月後） |
| failure_patterns の蓄積数 | 20件以上（1ヶ月後） |
| desire_centric vs object_centric の勝率データ | 各プラットフォーム50実験以上 |
| experiment_log のsupportsDesireTheory率 | 60%以上（欲望主語優位の確認） |

これらの数値が上昇するほど、02_planningへの知識注入が精度を増し、
コンテンツ品質の自律的向上が加速する。
