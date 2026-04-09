/**
 * reporter.js — 日次エンゲージメントレポート（AI分析）
 *
 * 役割: エンゲージメントデータを集計し、何が効いて何が効かなかったかをAIが分析してレポートを出す。
 * 実行: 毎日21時（スケジューラーから自動実行） / node cli.js report
 */
import { getDb } from '../lib/db.js';
import { syncer } from './syncer.js';
import { chat } from '../lib/ai-client.js';
import { logger } from '../lib/logger.js';
import fs from 'fs';
import path from 'path';

function getReportData() {
  const db = getDb();

  // 全投稿（実投稿のみ・エンゲージメントあり）
  const posts = db.prepare(`
    SELECT *
    FROM posts
    WHERE dry_run = 0 AND post_id IS NOT NULL
    ORDER BY timestamp DESC
  `).all();

  // 直近7日の投稿
  const recent = db.prepare(`
    SELECT *
    FROM posts
    WHERE dry_run = 0 AND post_id IS NOT NULL
      AND date >= date('now', '-7 days')
    ORDER BY like_count DESC
  `).all();

  // フォーマット別集計
  const byFormat = db.prepare(`
    SELECT
      format_name,
      COUNT(*) AS count,
      ROUND(AVG(like_count), 1) AS avg_likes,
      ROUND(AVG(replies_count), 1) AS avg_replies,
      ROUND(AVG(eval_score), 1) AS avg_score
    FROM posts
    WHERE dry_run = 0 AND post_id IS NOT NULL AND like_count IS NOT NULL
    GROUP BY format_name
    ORDER BY avg_likes DESC
  `).all();

  // フック型別集計
  const byHook = db.prepare(`
    SELECT
      hook_type,
      COUNT(*) AS count,
      ROUND(AVG(like_count), 1) AS avg_likes,
      ROUND(AVG(replies_count), 1) AS avg_replies
    FROM posts
    WHERE dry_run = 0 AND post_id IS NOT NULL AND hook_type IS NOT NULL AND like_count IS NOT NULL
    GROUP BY hook_type
    ORDER BY avg_likes DESC
  `).all();

  // カテゴリ別集計
  const byCategory = db.prepare(`
    SELECT
      category,
      COUNT(*) AS count,
      ROUND(AVG(like_count), 1) AS avg_likes,
      ROUND(AVG(replies_count), 1) AS avg_replies
    FROM posts
    WHERE dry_run = 0 AND post_id IS NOT NULL AND like_count IS NOT NULL
    GROUP BY category
    ORDER BY avg_likes DESC
  `).all();

  // トップ3・ワースト3
  const top3 = db.prepare(`
    SELECT text, like_count, replies_count, format_name, hook_type, eval_score, date
    FROM posts
    WHERE dry_run = 0 AND post_id IS NOT NULL AND like_count IS NOT NULL
    ORDER BY like_count DESC LIMIT 3
  `).all();

  const worst3 = db.prepare(`
    SELECT text, like_count, replies_count, format_name, hook_type, eval_score, date
    FROM posts
    WHERE dry_run = 0 AND post_id IS NOT NULL AND like_count IS NOT NULL
    ORDER BY like_count ASC LIMIT 3
  `).all();

  return { posts, recent, byFormat, byHook, byCategory, top3, worst3 };
}

function formatTable(rows, cols) {
  if (!rows.length) return '  データなし';
  return rows.map(r => '  ' + cols.map(c => `${c}: ${r[c] ?? '—'}`).join(' | ')).join('\n');
}

export async function reporter() {
  logger.stage('R', '日次エンゲージメントレポート');

  // まず最新データを同期
  logger.info('エンゲージメント同期中...');
  await syncer();

  const { posts, recent, byFormat, byHook, byCategory, top3, worst3 } = getReportData();

  if (posts.length === 0) {
    logger.warn('実投稿データがまだありません');
    return;
  }

  const totalLikes = posts.reduce((a, b) => a + (b.like_count ?? 0), 0);
  const totalReplies = posts.reduce((a, b) => a + (b.replies_count ?? 0), 0);
  const withEngagement = posts.filter(p => p.like_count != null);
  const avgLikes = withEngagement.length
    ? (totalLikes / withEngagement.length).toFixed(1)
    : '—';

  // AI分析
  const analysisPrompt = `あなたはSNSマーケティングの分析者です。以下のThreads投稿データを分析してください。

## 全体サマリー
- 総投稿数: ${posts.length}件（エンゲージメント取得済み: ${withEngagement.length}件）
- 累計いいね: ${totalLikes}
- 累計返信: ${totalReplies}
- 平均いいね: ${avgLikes}

## フォーマット型別パフォーマンス
${byFormat.map(r => `- ${r.format_name}: ${r.count}件 / 平均いいね${r.avg_likes} / 平均返信${r.avg_replies} / 評価${r.avg_score}点`).join('\n') || 'データなし'}

## フック型別パフォーマンス
${byHook.map(r => `- ${r.hook_type}: ${r.count}件 / 平均いいね${r.avg_likes} / 平均返信${r.avg_replies}`).join('\n') || 'データなし'}

## カテゴリ別パフォーマンス
${byCategory.map(r => `- ${r.category}: ${r.count}件 / 平均いいね${r.avg_likes} / 平均返信${r.avg_replies}`).join('\n') || 'データなし'}

## いいね上位3件（本文冒頭30文字）
${top3.map((p, i) => `${i + 1}. [${p.format_name}/${p.hook_type}] ❤️${p.like_count} 💬${p.replies_count} 評価${p.eval_score}点\n   「${p.text?.slice(0, 30)}...」`).join('\n') || 'データなし'}

## いいね下位3件（本文冒頭30文字）
${worst3.map((p, i) => `${i + 1}. [${p.format_name}/${p.hook_type}] ❤️${p.like_count} 💬${p.replies_count} 評価${p.eval_score}点\n   「${p.text?.slice(0, 30)}...」`).join('\n') || 'データなし'}

## 直近7日の投稿（いいね順）
${recent.slice(0, 5).map(p => `- ❤️${p.like_count ?? '—'} 💬${p.replies_count ?? '—'} [${p.format_name}] 「${p.text?.slice(0, 25)}...」`).join('\n') || 'データなし'}

上記データに基づき、以下の観点で分析してください。
必ずJSON形式のみで返してください。

{
  "summary": "全体の状況を2〜3文で",
  "what_worked": ["うまくいっているパターン1", "パターン2", "パターン3"],
  "what_didnt": ["うまくいっていないパターン1", "パターン2"],
  "best_format": "最もエンゲージメントが高いフォーマット型とその理由",
  "best_hook": "最もエンゲージメントが高いフック型とその理由",
  "recommendations": ["次の投稿に向けた具体的な改善提案1", "提案2", "提案3"]
}`;

  let analysis = null;
  try {
    const raw = await chat([{ role: 'user', content: analysisPrompt }], { model: 'fast', maxTokens: 1024 });
    analysis = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
  } catch (err) {
    logger.warn(`AI分析失敗: ${err.message}`);
  }

  // レポート出力
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const lines = [
    '',
    '\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m',
    `\x1b[1m📊 日次レポート — ${now}\x1b[0m`,
    '\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m',
    '',
    `\x1b[1m【全体】\x1b[0m 投稿${posts.length}件 / 累計❤️${totalLikes} 💬${totalReplies} / 平均❤️${avgLikes}`,
    '',
    '\x1b[1m【フォーマット別】\x1b[0m',
    ...byFormat.map(r => `  ${r.format_name.padEnd(16)} ${r.count}件 ❤️avg${r.avg_likes} 💬avg${r.avg_replies}`),
    '',
    '\x1b[1m【フック型別】\x1b[0m',
    ...byHook.map(r => `  ${(r.hook_type ?? '不明').padEnd(16)} ${r.count}件 ❤️avg${r.avg_likes}`),
    '',
    '\x1b[1m【カテゴリ別】\x1b[0m',
    ...byCategory.map(r => `  ${r.category.padEnd(12)} ${r.count}件 ❤️avg${r.avg_likes}`),
  ];

  if (top3.length) {
    lines.push('', '\x1b[1m【上位3件】\x1b[0m');
    top3.forEach((p, i) => {
      lines.push(`  ${i + 1}. ❤️${p.like_count} 💬${p.replies_count} [${p.format_name}]`);
      lines.push(`     「${p.text?.split('\n')[0].slice(0, 40)}」`);
    });
  }

  if (worst3.length && withEngagement.length >= 5) {
    lines.push('', '\x1b[1m【下位3件】\x1b[0m');
    worst3.forEach((p, i) => {
      lines.push(`  ${i + 1}. ❤️${p.like_count} 💬${p.replies_count} [${p.format_name}]`);
      lines.push(`     「${p.text?.split('\n')[0].slice(0, 40)}」`);
    });
  }

  if (analysis) {
    lines.push(
      '', '\x1b[1m【AI分析】\x1b[0m',
      `  ${analysis.summary}`,
      '',
      '\x1b[32m  ✓ 効いていること:\x1b[0m',
      ...analysis.what_worked.map(w => `    • ${w}`),
      '',
      '\x1b[31m  ✗ 効いていないこと:\x1b[0m',
      ...analysis.what_didnt.map(w => `    • ${w}`),
      '',
      '\x1b[33m  → 改善提案:\x1b[0m',
      ...analysis.recommendations.map(r => `    • ${r}`),
    );
  }

  lines.push('', '\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m', '');
  console.log(lines.join('\n'));

  // ファイルにも保存
  const reportDir = path.resolve('output/reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(reportDir, `${dateStr}.md`);
  const mdLines = [
    `# 日次レポート ${dateStr}`,
    '',
    `- 投稿数: ${posts.length}件`,
    `- 累計いいね: ${totalLikes}`,
    `- 累計返信: ${totalReplies}`,
    `- 平均いいね: ${avgLikes}`,
    '',
    '## フォーマット別',
    ...byFormat.map(r => `- ${r.format_name}: ${r.count}件 / avg❤️${r.avg_likes} / avg💬${r.avg_replies}`),
    '',
    '## フック型別',
    ...byHook.map(r => `- ${r.hook_type ?? '不明'}: ${r.count}件 / avg❤️${r.avg_likes}`),
  ];
  if (analysis) {
    mdLines.push(
      '', '## AI分析',
      '', `**概要:** ${analysis.summary}`,
      '', '**効いていること:**',
      ...analysis.what_worked.map(w => `- ${w}`),
      '', '**効いていないこと:**',
      ...analysis.what_didnt.map(w => `- ${w}`),
      '', '**改善提案:**',
      ...analysis.recommendations.map(r => `- ${r}`),
    );
  }
  fs.writeFileSync(reportPath, mdLines.join('\n'), 'utf-8');
  logger.success(`レポート保存: ${reportPath}`);

  return { totalLikes, totalReplies, avgLikes, analysis };
}
