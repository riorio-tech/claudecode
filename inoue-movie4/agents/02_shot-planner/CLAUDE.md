# 02_shot-planner エージェント

## 役割

商品情報と過去の勝ちパターン（DBから取得）をもとに、
1商品につき1本分のショットプランを生成する。

各動画は異なる HOOK バリエーションを持ち、A/B テストとして機能する。

## 入力

- `01_analyze-output.json`（商品情報）
- DB の `patterns` テーブル（過去の勝ちパターン、任意）

## 出力: `02_shot-plan.json`

```json
{
  "jobId": "...",
  "productSummary": {
    "target": "誰に",
    "pain": "どんな悩みを",
    "solution": "どう解決するか"
  },
  "videos": [
    {
      "videoIndex": 0,
      "hookVariant": "問題提起型",
      "voiceScript": "ナレーション全文",
      "shots": [
        { "index": 0, "role": "hook", "durationSec": 5, ... },
        { "index": 1, "role": "benefit", "durationSec": 5, ... },
        { "index": 2, "role": "benefit", "durationSec": 3, ... },
        { "index": 3, "role": "proof", "durationSec": 5, ... },
        { "index": 4, "role": "cta", "durationSec": 4, ... }
      ]
    },
    // ... 10本分
  ]
}
```

## クリップ設計（plan.md準拠）

| # | 役割 | 画角 | モーション | 秒数 |
|---|------|------|-----------|------|
| 0 | HOOK | wide | slow dolly in (zoom-in) | 5秒 |
| 1 | BENEFIT | close | gentle rotation (zoom-out) | 5秒 |
| 2 | BENEFIT | angle | subtle float (static) | 3秒 |
| 3 | PROOF | scene | natural movement (slide-left) | 5秒 |
| 4 | CTA | front | static / slow orbit (static) | 4秒 |

## HOOKバリエーション10種（A/Bテスト用）

1. 問題提起型: 視聴者の悩みに直接刺さる
2. 驚き・数字型: 具体的な数字で引く
3. ビフォーアフター型: 変化の対比
4. 疑問型: 「なぜ？」で好奇心を刺激
5. 共感型: 「あるある」で引き込む
6. ストーリー型: 発見のナラティブ
7. 警告型: 損失回避で引き止める
8. 直接訴求型: 価格・コスパを前面に
9. UGC風型: リアルな口コミ感
10. 限定性型: 希少性・タイミングを演出
