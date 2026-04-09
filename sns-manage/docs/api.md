# REST API リファレンス

ベースURL: `http://localhost:3000`

認証: すべてのエンドポイントで `x-api-key: {API_KEY}` ヘッダーが必要。

---

## ジョブ管理

### POST /api/jobs
パイプライン起動。

**リクエスト:**
```json
{
  "topic": "夏のスキンケア",
  "platforms": ["twitter", "tiktok"],
  "targetAudience": "20代女性",
  "category": "beauty",
  "autoApprove": false
}
```

**レスポンス:**
```json
{
  "jobId": "uuid",
  "status": "running",
  "message": "パイプライン起動完了"
}
```

---

### GET /api/jobs
ジョブ一覧取得。

**クエリパラメータ:**
- `limit` (default: 20)
- `status` — running | completed | failed | approved

**レスポンス:**
```json
[
  {
    "id": "uuid",
    "topic": "夏のスキンケア",
    "category": "beauty",
    "platforms": "[\"twitter\",\"tiktok\"]",
    "status": "completed",
    "created_at": "2024-01-01 09:00:00",
    "completed_at": "2024-01-01 09:05:00"
  }
]
```

---

### GET /api/jobs/:id
ジョブ詳細取得（posts・contents含む）。

---

### GET /api/jobs/:id/preview
承認前のコンテンツプレビュー。

**レスポンス:**
```json
{
  "job": { ... },
  "contents": [
    {
      "platform": "twitter",
      "variant_id": "A",
      "body": "...",
      "hook_type": "desire_centric"
    }
  ]
}
```

---

### POST /api/jobs/:id/approve
投稿を承認（`posts.status` を `approved` に変更）。

**リクエスト:**
```json
{
  "variantIds": ["A"]
}
```

省略時は全バリアントを承認。

---

### POST /api/jobs/:id/publish
承認済みコンテンツを即時投稿。

---

## 分析

### GET /api/analytics/:platform
プラットフォーム別のメトリクス一覧。

**クエリパラメータ:**
- `limit` (default: 50)
- `days` — 直近N日分

---

### GET /api/analytics/schedule
分析スケジュール一覧（pending/completed）。

---

## 勝ち/負けパターン

### GET /api/patterns
勝ちパターン一覧（engagement_lift DESC）。

**クエリパラメータ:**
- `platform`
- `limit` (default: 20)

---

### GET /api/patterns/failures
負けパターン一覧（recorded_at DESC）。

**クエリパラメータ:**
- `platform`
- `failure_mode` — wrong_mediator | wrong_emotion | object_centric_drift | timing | low_quality | other

---

### GET /api/patterns/knowledge
知識ベース（confidence DESC）。

**クエリパラメータ:**
- `platform`
- `category` — hook | emotion | platform | audience | timing | desire

---

## レポート

### GET /api/report/weekly
今週 vs 先週の比較レポート。

**レスポンス:**
```json
{
  "comparison": {
    "thisWeek": { "impressions": 10000, "likes": 500, "engagement_rate": 0.05 },
    "lastWeek":  { "impressions": 8000,  "likes": 400, "engagement_rate": 0.05 },
    "change": { "impressions": 0.25, "likes": 0.25 }
  },
  "topPosts": [ ... ],
  "latestReport": {
    "summary": "今週は...",
    "highlights": { "good": [...], "bad": [...] },
    "suggestions": [
      { "priority": "high", "category": "hook", "action": "...", "expectedEffect": "..." }
    ],
    "nextWeekFocus": "...",
    "riskAlert": "..."
  },
  "snapshots": [ ... ]
}
```

---

### GET /api/report/history
週次レポート履歴。

**クエリパラメータ:** `weeks` (default: 4)

---

### GET /api/report/snapshots
日次スナップショット履歴。

**クエリパラメータ:** `days` (default: 14)

---

### POST /api/report/snapshot
手動スナップショット取得。

---

### POST /api/report/generate
手動週次レポート生成。

---

## スケジューラー

### GET /api/scheduler/status
スケジューラー状態取得。

**レスポンス:**
```json
{
  "running": true,
  "postTime": "09:00",
  "autoApprove": false,
  "snapshotTime": "00:00",
  "weeklyReportDay": "月曜日",
  "dailyTopicFile": "./topics.json",
  "nextJobs": [ ... ]
}
```

---

### POST /api/scheduler/start / POST /api/scheduler/stop
スケジューラーの起動・停止。

---

## ブラウザ自動化

### POST /api/browser/login
インタラクティブログイン（headless: false）。

**注意:** GUIが必要。ヘッドレスサーバー環境では400エラー。

**リクエスト:**
```json
{ "platform": "twitter" }
```

---

### POST /api/browser/post
ブラウザ経由で投稿。

**リクエスト:**
```json
{
  "platform": "twitter",
  "text": "投稿テキスト"
}
```

---

### POST /api/browser/screenshot
スクリーンショット取得。

**リクエスト:**
```json
{ "url": "https://example.com" }
```

**レスポンス:**
```json
{
  "path": "screenshots/example.png",
  "timestamp": "2024-01-01T09:00:00.000Z"
}
```

---

## OAuth認証

### POST /api/auth/:platform
OAuth認証フロー開始（Twitter以外は Phase 2）。

### GET /api/auth/:platform/callback
OAuthコールバック処理。

---

## WebSocket

`ws://localhost:3000/ws/jobs/:id`

パイプライン進捗をリアルタイム通知。

**メッセージ形式:**
```json
{
  "type": "progress",
  "step": "03_writer",
  "status": "running",
  "message": "コンテンツ生成中..."
}
```
