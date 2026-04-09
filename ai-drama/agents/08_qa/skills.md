# skills: 08_qa

## 使い方

```js
import { runQA } from './agents/08_qa/agent.js';

const result = await runQA({
  jobId,
  jobDir,
  finalVideoPath,    // {jobDir}/07_assembly/final.mp4
  scriptPath,        // {jobDir}/01_script.json
  assemblyOutputPath,// {jobDir}/07_assembly/assembly-output.json
  verbose,
});
// result: { reportPath: "{jobDir}/08_qa-report.json", passed: true, score: 87 }
```

## 出力ファイル

- `{jobDir}/08_qa-report.json` — 全チェック結果
- スコアはターミナルに表示される

## よくあるエラーと対処

| エラー | 原因 | 対処 |
|-------|------|------|
| `duration out of range` | 尺が 30〜90 秒外 | 07_assembly の concat リストを調整 |
| `resolution wrong` | 1080×1920 でない | 07_assembly の出力サイズを強制指定 |
| `no audio` | 音声ミックス失敗 | 05/06 の出力ファイルを確認 |
| `subtitle coverage < 60%` | 字幕が少ない | 01_script.json の subtitleLines を追加 |
