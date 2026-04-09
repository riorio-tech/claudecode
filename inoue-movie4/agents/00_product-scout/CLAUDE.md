# 00_product-scout エージェント

## 役割

TikTok Creative Center のトレンドデータや与えられたカテゴリ情報をもとに、
売れる可能性が高い商品候補を Claude API で分析・提案する。

## 入力

```json
{
  "category": "daily | beauty | electronics | food | fashion",
  "limit": 5,
  "context": "任意の補足情報（季節、競合状況など）"
}
```

## 出力

```json
{
  "candidates": [
    {
      "title": "商品名",
      "category": "カテゴリ",
      "price": 1980,
      "scoutReason": "選んだ理由（トレンド・競合少・CVR仮説）",
      "estimatedCvr": "0.8%"
    }
  ]
}
```

## プロンプト設計

以下の観点で商品を評価する:
1. トレンド性（TikTok で話題になりやすいか）
2. 視覚的訴求力（動画映えするか）
3. 競合密度（まだ飽和していないか）
4. 購買衝動（衝動買いしやすい価格帯・特性か）
5. CVR仮説（なぜ売れるかを言語化できるか）
