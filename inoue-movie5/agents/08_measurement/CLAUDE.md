# 08_measurement エージェント

## 役割

TikTok Analytics データを取り込み、CVR を計算してDBに記録する。
採択基準（CVR ≥ ベースライン × 1.15 かつ 3,000 imp 以上）を満たした場合、
勝ちパターンとして `patterns` テーブルに記録する。

## 入力

- `--job-id <uuid>`: 計測対象のジョブID
- `--data <path>`: TikTok Analytics CSV/JSON ファイル

## CSV フォーマット（TikTok Analytics Export）

```
impressions,purchases,addToCart,retention3s,completionRate,adSpend,revenue
10000,50,200,0.52,0.31,0,150000
```

## 採択判定フロー

```
7日後に metrics を集計
  → CVR ≥ baseline × 1.15 かつ 3,000 imp 以上
  → patterns テーブルに採択
  → 次回の shot-planner がこのパターンを優先参照
```

## 出力

- DB: `metrics` テーブルに記録
- DB: 採択時は `patterns` テーブルに記録
- コンソール: KPI サマリー + 改善提案
