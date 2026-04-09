# skills: 02_scene-breakdown

## 使い方

```js
import { runSceneBreakdown } from './agents/02_scene-breakdown/agent.js';

const result = await runSceneBreakdown({
  jobId,
  jobDir,
  scriptPath,  // {jobDir}/01_script.json
  verbose,
});
// result: { scenePlanPath: "{jobDir}/02_scene-plan.json", scenePlan: {...} }
```

## 出力ファイル

- `{jobDir}/02_scene-plan.json` — シーンプラン（ScenePlanSchema で検証済み）

## よくあるエラーと対処

| エラー | 原因 | 対処 |
|-------|------|------|
| `shotType not in enum` | Claude が未定義ショットを使用 | system prompt のショットカタログを確認 |
| `imagePrompt too short` | プロンプトが 20 文字未満 | min(20) バリデーションを Claude へ伝える |
| `colorPalette not in enum` | 誤ったパレット | cold_blue/warm_amber/desaturated/high_contrast のみ |
