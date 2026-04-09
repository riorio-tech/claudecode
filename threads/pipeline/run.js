import { createJobDir } from '../lib/job-dir.js';
import { logger } from '../lib/logger.js';
import { getAllPosts } from '../lib/db.js';
import { themePicker } from './theme-picker.js';      // システム
import { researcher } from './researcher.js';          // AI
import { formatPicker } from './format-picker.js';    // システム
import { writer } from './writer.js';                 // AI
import { reviewer } from './reviewer.js';             // AI
import { evaluator } from './evaluator.js';           // AI
import { poster } from './poster.js';                 // システム
import { reflector } from './reflector.js';           // システム

// 簡易類似度チェック（共通単語の割合）
function similarity(a, b) {
  const words = s => new Set(s.replace(/[。、\n]/g, ' ').split(/\s+/).filter(w => w.length > 1));
  const wa = words(a);
  const wb = words(b);
  const intersect = [...wa].filter(w => wb.has(w)).length;
  return intersect / Math.max(wa.size, wb.size, 1);
}

function isDuplicate(text, pastPosts, threshold = 0.5) {
  for (const p of pastPosts) {
    if (!p.text) continue;
    const score = similarity(text, p.text);
    if (score >= threshold) {
      return { duplicate: true, score, matched: p.text.slice(0, 30) };
    }
  }
  return { duplicate: false };
}

export async function run({ dryRun = false, untilHour = null } = {}) {
  // 時間制限チェック（例: untilHour=18 なら18時以降はスキップ）
  if (untilHour !== null) {
    const hour = new Date().getHours();
    if (hour >= untilHour) {
      logger.info(`${untilHour}時以降のためスキップ（現在 ${hour}時）`);
      return null;
    }
  }

  const { jobId, dir } = createJobDir();
  logger.info(`Job: ${jobId}`);

  // Stage 1: システム
  const { theme, posted } = themePicker(dir);

  // Stage 2: AI
  const research = await researcher(dir, theme);
  await new Promise(r => setTimeout(r, 2000));

  // Stage 2.5: システム
  const format = formatPicker(dir, theme, posted);

  // Stage 3: AI
  const draft = await writer(dir, theme, research, format);
  await new Promise(r => setTimeout(r, 2000));

  // Stage 4: AI（最良バリアント選択）
  const review = await reviewer(dir, theme, draft);
  await new Promise(r => setTimeout(r, 2000));

  // Stage 4.5: AI（品質評価・75点以上で投稿承認）
  const evaluation = await evaluator(dir, theme, format, review.final_text);

  // Stage 4.7: 重複チェック（DBの過去投稿と比較）
  let finalText = review.final_text;
  const pastPosts = getAllPosts({ limit: 50 });
  const dupCheck = isDuplicate(finalText, pastPosts);
  if (dupCheck.duplicate) {
    logger.warn(`重複検出（類似度${Math.round(dupCheck.score * 100)}%）: 「${dupCheck.matched}…」と類似`);
    logger.warn('再生成をスキップして投稿を中止します（次回は別テーマで投稿されます）');
    return null;
  }
  logger.info('重複チェック: OK');

  // Stage 5: システム（評価パスした場合のみ実際に投稿）
  const result = await poster(dir, theme, review, dryRun || !evaluation.passed);

  // Stage 6: システム
  reflector(dir, theme, format, { ...result, eval_score: evaluation.total, eval_passed: evaluation.passed });

  // 台本改善点の表示（常に出力）
  printImprovements(review.final_text, evaluation);

  return { result, evaluation };
}

function printImprovements(text, evaluation) {
  const scores = evaluation.scores ?? {};
  const lines = [
    '',
    '\x1b[36m━━━ 台本改善レポート ━━━\x1b[0m',
    `総合: ${evaluation.total}点 / 判定: ${evaluation.verdict}`,
    '',
    `  フック力    ${bar(scores.hook, 30)}  ${scores.hook ?? '—'}/30`,
    `  当事者性    ${bar(scores.tone, 20)}  ${scores.tone ?? '—'}/20`,
    `  具体性      ${bar(scores.concreteness, 20)}  ${scores.concreteness ?? '—'}/20`,
    `  フォーマット ${bar(scores.format, 15)}  ${scores.format ?? '—'}/15`,
    `  完結性      ${bar(scores.completeness, 15)}  ${scores.completeness ?? '—'}/15`,
  ];

  if (evaluation.improvements?.length) {
    lines.push('', '  改善点:');
    evaluation.improvements.forEach(i => lines.push(`  → ${i}`));
  } else {
    lines.push('', '  改善点: なし（高品質）');
  }

  // 1行目のフック文字数チェック
  const firstLine = text?.split('\n')[0] ?? '';
  if (firstLine.length > 25) {
    lines.push(`  ⚠ フック文字数: ${firstLine.length}文字（25文字以内推奨）`);
  } else {
    lines.push(`  ✓ フック文字数: ${firstLine.length}文字`);
  }

  lines.push('\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m', '');
  console.log(lines.join('\n'));
}

function bar(score, max) {
  if (score == null) return '░░░░░';
  const filled = Math.round((score / max) * 5);
  return '█'.repeat(filled) + '░'.repeat(5 - filled);
}
