# skills: 01_script-writer

## 使い方

```js
import { runScriptWriter } from './agents/01_script-writer/agent.js';

const result = await runScriptWriter({
  jobId,
  jobDir,       // /tmp/drama-job-{uuid}/
  concept,      // "いじめられていた学生が天才で全員を見返す"
  genre,        // "revenge"
  characters,   // [{ name, role, trait }]
  arcTemplate,  // "auto"
  episode,      // 1
  totalEpisodes,// 3
  language,     // "ja"
  targetDurationSec, // 60
  verbose,
});
// result: { scriptPath: "/tmp/.../01_script.json", script: {...} }
```

## 出力ファイル

- `{jobDir}/01_script.json` — 脚本 JSON（ScriptSchema で検証済み）

## よくあるエラーと対処

| エラー | 原因 | 対処 |
|-------|------|------|
| `ZodError: scenes min(4)` | シーン数が 4 未満 | コンセプトを具体化してリトライ |
| `Claude API timeout` | Sonnet が遅い | max_tokens を 4096 以上に確認 |
| `emotionalBeat not in enum` | Claude が未定義ビートを使用 | system prompt のビートカタログを更新 |

## 動作確認

```bash
# dry-run（脚本のみ生成）
node cli.js script "いじめられた学生が逆襲する" --genre revenge --duration 60
# → 01_script.json が生成される
```
