# 07_publish-prep エージェント

## 役割

QA を通過した動画のキャプション・ハッシュタグを生成する。
10本分をまとめて1回の呼び出しで生成する。

## 入力

- `analyzeOutput`: 商品情報
- `shotPlan`: 10本分のショットプラン（productSummary 参照）

## 出力: `publish-prep-output.json`（1本分）

```json
{
  "jobId": "...",
  "caption": "TikTok キャプション（最大150文字）",
  "hashtags": ["#TikTokShop", "#日用品", ...],
  "thumbnailHint": "サムネイル推奨カット（例: hookカット）",
  "charCount": 65
}
```

## プロンプト設計

- キャプション: 購買意欲を高める一文 + 商品名 + CTA
- ハッシュタグ: カテゴリ系2〜3 + 商品特性系2〜3 + TikTokShop系1〜2
- thumbnailHint: QAスコアが最高の動画の HOOK カット
