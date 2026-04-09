/**
 * evaluator.js — AIエージェント（Claude使用・コストあり）
 *
 * 役割: 選ばれた投稿文を100点満点で採点し、75点以上なら投稿を承認する。
 *       75点未満は投稿しない（reflectorに記録のみ）。
 */
import { chat } from '../lib/ai-client.js';
import { writeJson } from '../lib/job-dir.js';
import { logger } from '../lib/logger.js';

const PASS_SCORE = 75;

export async function evaluator(jobDir, theme, format, text) {
  logger.stage('4.5', '品質評価（AI）');

  const rawText = await chat([{
    role: 'user',
      content: `あなたはThreads投稿の品質評価者です。以下の投稿文を100点満点で採点してください。

## 評価対象の投稿文
${text}

## メタ情報
- テーマ: ${theme.theme}
- カテゴリ: ${theme.category}
- 使用フォーマット型: ${format.name}

## 採点基準

1. **フック力（30点）** — 冒頭1行でスクロールが止まるか
   - 30点: 25文字以内・単独で意味が完結・読者が次を読まずにいられない
   - 20点: 短いが引きが弱い、または25文字を少し超えている
   - 10点以下: 状況説明・前置き・長すぎる・「以前は〜」から始まる
2. **当事者性（20点）** — 現場経験・判断・失敗が見える。教科書的でなく「自分がやってきた人間」の語り口か
3. **具体性（20点）** — 抽象論でなく実例・数字・固有の経験が含まれているか
4. **フォーマット遵守（15点）** — 「${format.name}」の構造テンプレートに沿っているか
5. **完結性（15点）** — 読み切れる・締まっている。「知らなかった」「試してみて」などのNG表現がないか

必ずJSON形式のみで返してください。

{
  "scores": {
    "hook": 0,
    "tone": 0,
    "concreteness": 0,
    "format": 0,
    "completeness": 0
  },
  "total": 0,
  "passed": false,
  "verdict": "一言での判定理由",
  "improvements": ["改善点1（75点未満の場合のみ）"]
}`,
  }], { model: 'fast', maxTokens: 1024 });

  const result = JSON.parse(rawText.match(/\{[\s\S]*\}/)[0]);
  result.total = Object.values(result.scores).reduce((a, b) => a + b, 0);
  result.passed = result.total >= PASS_SCORE;

  writeJson(jobDir, '04b_eval.json', result);

  const mark = result.passed ? '✓' : '✗';
  const color = result.passed ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}${mark}\x1b[0m 評価スコア: ${result.total}/100 — ${result.verdict}`);

  if (!result.passed) {
    logger.warn(`${result.total}点（基準75点未満）→ 投稿スキップ`);
    if (result.improvements?.length) {
      result.improvements.forEach(i => logger.info(`  改善点: ${i}`));
    }
  } else {
    logger.success(`${result.total}点（基準クリア）→ 投稿へ`);
  }

  return result;
}
