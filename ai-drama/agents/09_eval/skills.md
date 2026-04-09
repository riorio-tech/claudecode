# skills: 09_eval

## 使い方

```js
import { runEval } from './agents/09_eval/agent.js';

const result = await runEval({
  jobId,
  jobDir,
  finalVideoPath,  // {jobDir}/07_assembly/final.mp4
  scriptPath,      // {jobDir}/01_script.json
  referencePath,   // 参照動画パス（任意）
  outputDir,       // eval_log.md 保存先
  verbose,
});
// result: { score: 82, passed: true, reportPath: "...", evalLogPath: "..." }
```

## 出力ファイル

- `{outputDir}/eval_log.md` — 評価ログ（追記）
- `{jobDir}/09_eval-report.json` — 詳細評価データ

## 参照動画の登録

```bash
# 高品質な動画を参照として登録
mkdir -p output/reference/
cp path/to/great_video.mp4 output/reference/reference_v1.mp4
```

## よくあるエラーと対処

| エラー | 原因 | 対処 |
|-------|------|------|
| `JSON truncated` | max_tokens が低い | 3000 以上に設定 |
| 参照動画なし | reference/ が空 | 絶対評価のみで続行（比較コメントなし） |
| `vision API error` | 動画フレームを読めない | 最初のフレームを静止画にして評価 |

## 動作確認

```bash
# 単体実行（生成後の評価のみ）
node cli.js eval --job-id <uuid> --reference output/reference/reference_v1.mp4
```
