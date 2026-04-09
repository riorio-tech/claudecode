# 02_shot-planner エージェント（v2）

## 役割

商品情報と過去の勝ちパターン（DBから取得）をもとに、
1商品につき10本分のショットプランを生成する。

**最重要方針:**
各ショットは必ず「画角の変化」と「モーション」を持つこと。
同じ angleHint を連続させない。視覚的変化がユーザー維持率に直結する。

---

## 入力

- `01_analyze-output.json`（商品情報）
- DB の `patterns` テーブル（過去の勝ちパターン、任意）

---

## 出力: `02_shot-plan.json`

```json
{
  "jobId": "...",
  "productSummary": { "target": "...", "pain": "...", "solution": "..." },
  "videos": [
    {
      "videoIndex": 0,
      "hookVariant": "問題提起型",
      "voiceScript": "ナレーション全文（60〜80文字）",
      "shots": [
        { "index": 0, "role": "hook",    "durationSec": 1, "motionHint": "fast_drop_bounce", "angleHint": "shake_impact",    "overlayText": "〇〇で悩んでる？", "scriptHint": "..." },
        { "index": 1, "role": "hook",    "durationSec": 1, "motionHint": "slow_roll",        "angleHint": "dutch_angle",      ... },
        { "index": 2, "role": "hook",    "durationSec": 1, "motionHint": "zoom_out_fast",    "angleHint": "pull_back_reveal", ... },
        { "index": 3, "role": "benefit", "durationSec": 1, "motionHint": "slow_push_in",     "angleHint": "extreme_close",    ... },
        { "index": 4, "role": "benefit", "durationSec": 1, "motionHint": "micro_drift",      "angleHint": "overhead_flatlay", ... },
        { "index": 5, "role": "benefit", "durationSec": 1, "motionHint": "continuous_orbit", "angleHint": "orbit",            ... },
        { "index": 6, "role": "benefit", "durationSec": 1, "motionHint": "gentle_sway",      "angleHint": "hand_hold_pov",    ... },
        { "index": 7, "role": "proof",   "durationSec": 1, "motionHint": "parallax_drift",   "angleHint": "lifestyle_scene",  ... },
        { "index": 8, "role": "proof",   "durationSec": 1, "motionHint": "slide_wipe_left",  "angleHint": "split_comparison", ... },
        { "index": 9, "role": "cta",     "durationSec": 1, "motionHint": "dolly_in_tilt_up", "angleHint": "hero_low_angle",   "overlayText": "今すぐチェック", ... }
      ]
    }
    // ... 10本分（videoIndex: 0〜9）
  ]
}
```

## クリップ設計（v2）

- **10カット × 1秒 = 合計10秒**（旧: 5カット×3〜5秒）
- Shot 00〜02: HOOK（hookVariantごとに angleHint × motionHint を変える）
- Shot 03〜09: BENEFIT→PROOF→CTA（全バリアント共通テンプレート）
- `motion` フィールドは廃止。`motionHint` を使う

## angleHint カタログ（9種）

| angleHint | 説明 |
|-----------|------|
| `shake_impact` | 落下・衝撃演出 |
| `pull_back_reveal` | 超接写→引いて全体像 |
| `dutch_angle` | 15〜30°傾いた構図 |
| `extreme_close` | テクスチャ・素材の超接写 |
| `overhead_flatlay` | 真上からの俯瞰 |
| `hand_hold_pov` | 手で持つ一人称視点 |
| `orbit` | 商品周囲をカメラが回る |
| `hero_low_angle` | やや下から見上げる正面 |
| `lifestyle_scene` | 実際の使用シーンに配置 |
| `split_comparison` | 左右ビフォーアフター |

## motionHint カタログ（10種）

| motionHint | 説明 |
|------------|------|
| `fast_drop_bounce` | 上から落下してバウンス |
| `zoom_out_fast` | 一気に引くリバースズーム |
| `slow_push_in` | ゆっくり寄っていく |
| `continuous_orbit` | 商品を中心に水平に回転 |
| `gentle_sway` | ゆっくり揺れる |
| `parallax_drift` | 背景と前景の微速ドリフト |
| `slide_wipe_left` | 左方向へのスライドワイプ |
| `dolly_in_tilt_up` | 寄りながらチルトアップ |
| `micro_drift` | 極小のゆるドリフト |
| `slow_roll` | ゆっくり傾き回転 |

## HOOKバリエーション10種（A/Bテスト用）

1. 問題提起型 / 2. 驚き数字型 / 3. ビフォーアフター型 / 4. 疑問型 / 5. 共感型
6. ストーリー型 / 7. 警告型 / 8. 直接訴求型 / 9. UGC風型 / 10. 限定性型
