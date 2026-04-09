# 11_advisor — データ分析 + ネクストアクション提案エージェント

## 役割
DBに蓄積されたデータを読み込み、ファクトベースの週次アクションプランを生成する。

## 入力
DBデータのみ（jobIdは任意）:
- patterns, failure_patterns, knowledge_base（勝ち/負けパターン・蒸留インサイト）
- experiment_log（A/Bテスト全記録）
- daily_snapshots（過去28日の日次指標）
- weekly_reports（週次比較）
- metrics（トップパフォーマンス投稿）

## 出力
- `reports/memory/action_plan_YYYY-MM-DD.json`
- `reports/memory/latest_action_plan.json`

## 出力スキーマ
```json
{
  "dataQuality": "bootstrap|developing|mature",
  "winningAxis": { "winner": "desire_centric|object_centric|inconclusive", ... },
  "weeklyPlan": [{ "priority", "topic", "platform", "hookType", "reason", "suggestedAngle" }],
  "nextHypotheses": [{ "hypothesis", "why", "expectedOutcome", "platform" }],
  "optimalTimes": { "twitter": "HH:MM", ... },
  "riskWarnings": ["..."]
}
```

## 実行タイミング
- 毎週月曜 01:00（scheduler.jsから自動実行）
- 手動: `POST /api/advisor/generate`

## モデル
Claude Sonnet（config.CLAUDE_MODEL）
