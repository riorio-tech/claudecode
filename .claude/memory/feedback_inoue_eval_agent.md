---
name: inoue-movie5 eval.js 評価エージェント仕様
description: pipeline/eval.js の仕様・設計・変更履歴
type: feedback
---

## 仕様（現在）

**ファイル:** `pipeline/eval.js`

**スコア:** 0〜100点（旧: 1〜10点）

**評価項目（10項目）:**
1. 商品一致度 — 商品外観・色・形状・ロゴが元画像と一致するか
2. 商品統一感 — 全フレームで同じ商品が一貫して映っているか
3. 商品差し替え自然さ — 合成の違和感・アーティファクトのなさ
4. モーション品質 — 動きの滑らかさ・ブレのなさ
5. 映像クオリティ — 解像度・シャープさ・色再現
6. 背景照明整合性 — 光源・影・色温度の整合
7. TikTok適性 — 縦型・視認性・テンポ・購買意欲
8. 字幕テキスト品質 — 読みやすさ・位置・タイミング
9. 商業的訴求力 — 購買を促進できるか（CVR観点）
10. フック力 — 冒頭1〜2秒での離脱防止力

総合スコア + 改善提案（3件）も生成。

**出力:**
- ターミナルにスコアバー付きレポート表示
- `{outputDir}/eval_log.md` に Markdown テーブルを追記（生成のたびに蓄積）

**呼び出し方（2通り）:**

```bash
# CLI として単独実行
node pipeline/eval.js --generated output/inpaint6/final_assembled.mp4 [--reference ref.mp4]

# inpaint.js から自動呼び出し（生成完了後の Step 5）
import { runEval } from './eval.js';
await runEval({ generatedPath, outputDir, jobId, meta });
```

## 変更履歴

| 変更 | 内容 |
|------|------|
| スコア 1-10 → 0-100 | より細かい評価が可能に |
| 評価項目 7 → 10 | 字幕テキスト品質・商業的訴求力・フック力を追加 |
| max_tokens 1000 → 3000 | JSON が途中で切れる問題を修正 |
| runEval() を export | inpaint.js から呼べるように |
| eval_log.md 自動追記 | 出力フォルダに評価ログを蓄積 |
| inpaint.js Step 5 として自動実行 | 生成後に必ず評価が走る |

## 注意

- `isCli` 判定: `process.argv[1]` と `__filename` を比較して CLI/モジュール両対応
- `eval_log.md` は append（上書きしない）。ファイルが存在しない場合のみヘッダーを書く
- Claude モデルは `CLAUDE_MODEL` env（デフォルト: `claude-sonnet-4-6`）を使用
