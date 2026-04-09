#!/usr/bin/env node
/**
 * 動画品質評価エージェント
 *
 * 使い方（CLI）:
 *   node pipeline/eval.js \
 *     --generated output/inpaint6/final_assembled.mp4 \
 *     [--reference /path/to/reference.mp4] \
 *     [--job-id <jobId>]          # state.json から cost/time を読む
 *     [--output-dir output/inpaint6]  # eval_log.md を保存するフォルダ
 *     [--output eval_result.json]
 *
 * 関数として呼び出す場合（inpaint.js から）:
 *   import { runEval } from './eval.js';
 *   await runEval({ generatedPath, outputDir, jobId, meta });
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { join, resolve, basename, dirname } from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const require    = createRequire(import.meta.url);
const dotenv     = require('dotenv');
dotenv.config({ path: resolve(__dirname, '../.env') });

import { FFMPEG, FFPROBE } from '../lib/ffmpeg-path.js';

// ─── CLI エントリ ─────────────────────────────────────────────────────────────

// ESM では import.meta.url でエントリポイント判定
const isCli = process.argv[1] && resolve(process.argv[1]) === resolve(__filename);

if (isCli) {
  const { program } = await import('commander');
  program
    .name('eval')
    .description('生成動画の品質を評価する')
    .requiredOption('--generated <path>', '評価対象の生成動画')
    .option('--reference <path>', '参照動画（比較元）')
    .option('--job-id <id>', 'inpaint job ID（コスト・時間読み込み用）')
    .option('--output-dir <dir>', 'eval_log.md を保存するフォルダ', '')
    .option('--output <path>', 'JSON 結果の出力先', '')
    .option('--verbose', '詳細ログ', false)
    .parse(process.argv);

  const opts = program.opts();
  const generatedPath = resolve(opts.generated);
  if (!existsSync(generatedPath)) {
    console.error(`❌ 生成動画が見つかりません: ${generatedPath}`);
    process.exit(1);
  }

  // CLI から呼ぶ場合: state.json からメタを読む
  let meta = null;
  if (opts.jobId) {
    const statePath = join(process.env.TMPDIR ?? '/tmp', `inpaint-${opts.jobId}`, 'state.json');
    if (existsSync(statePath)) {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      meta = state.meta ?? null;
    }
  }

  const report = await runEval({
    generatedPath,
    referencePath: opts.reference,
    outputDir: opts.outputDir || dirname(generatedPath),
    jobId: opts.jobId,
    meta,
    verbose: opts.verbose,
  });

  if (opts.output) {
    const outPath = resolve(opts.output);
    writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n💾 JSON保存: ${outPath}`);
  }
}

// ─── メイン評価関数（外部からも呼べる） ──────────────────────────────────────

export async function runEval({ generatedPath, referencePath, outputDir, jobId, meta, verbose } = {}) {
  generatedPath = resolve(generatedPath);

  const hasRef = referencePath && existsSync(resolve(referencePath));
  if (referencePath && !hasRef) {
    console.warn(`⚠️  参照動画が見つかりません: ${referencePath}（参照なし評価に切り替え）`);
  }
  if (hasRef) referencePath = resolve(referencePath);

  const workDir = join(process.env.TMPDIR ?? '/tmp', `eval-${Date.now()}`);
  mkdirSync(workDir, { recursive: true });
  if (outputDir) mkdirSync(resolve(outputDir), { recursive: true });

  console.log('\n📊 動画品質評価エージェント');
  console.log(`   生成動画: ${basename(generatedPath)}`);
  if (hasRef) console.log(`   参照動画: ${basename(referencePath)}`);

  // ─── フレーム抽出 ────────────────────────────────────────────────────────
  console.log('\n⏳ フレーム抽出中...');
  const genFrames = extractFrames(generatedPath, workDir, 'gen', 5);
  const refFrames = hasRef ? extractFrames(referencePath, workDir, 'ref', 5) : [];

  // ─── Claude Vision 評価 ──────────────────────────────────────────────────
  console.log('⏳ Claude Vision で評価中...');
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) { console.error('❌ ANTHROPIC_API_KEY 未設定'); return null; }

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const scores = await evaluateVideo(client, genFrames, refFrames, hasRef, verbose);

  // ─── コスト・時間 ────────────────────────────────────────────────────────
  const costTime = computeCostTime(meta);

  // ─── レポート構築 ────────────────────────────────────────────────────────
  const report = {
    generatedVideo: generatedPath,
    referenceVideo: referencePath ?? null,
    evaluatedAt:    new Date().toISOString(),
    scores,
    costTime,
  };

  printReport(report);

  // ─── Markdown ファイルへ追記 ─────────────────────────────────────────────
  if (outputDir) {
    const mdPath = join(resolve(outputDir), 'eval_log.md');
    appendMarkdown(report, mdPath);
    console.log(`\n📝 評価ログ追記: ${mdPath}`);
  }

  return report;
}

// ─── フレーム抽出（均等に N 枚） ─────────────────────────────────────────────

function extractFrames(videoPath, workDir, prefix, count) {
  const dur = getDuration(videoPath);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const ts = ((i + 0.5) * dur / count).toFixed(3);
    const outPath = join(workDir, `${prefix}_frame${i}.jpg`);
    spawnSync(FFMPEG, [
      '-y', '-ss', ts, '-i', videoPath,
      '-frames:v', '1', '-q:v', '3', outPath,
    ], { stdio: 'pipe' });
    if (existsSync(outPath)) frames.push(outPath);
  }
  return frames;
}

// ─── Claude Vision 評価 ──────────────────────────────────────────────────────

async function evaluateVideo(client, genFrames, refFrames, hasRef, verbose) {
  const imageContent = (paths) => paths.map(p => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: readFileSync(p).toString('base64') },
  }));

  const genImages = imageContent(genFrames);
  const refImages = refFrames.length ? imageContent(refFrames) : [];

  const promptText = `
あなたは TikTok Shop 動画の品質評価の専門家です。
${hasRef
  ? `【参照動画（目標基準）フレーム】を先に示し、次に【生成動画フレーム】を示します。
参照動画は「理想的なTikTok商品動画」として使用します。生成動画が参照動画のレベルに達しているかを基準に採点してください。`
  : '生成動画のフレームを見て評価してください。'}

${hasRef ? `【参照動画フレーム（理想基準）】: 最初の ${refImages.length} 枚` : ''}
【生成動画フレーム】: ${hasRef ? `残りの ${genImages.length} 枚` : `${genImages.length} 枚`}

以下の評価項目を 0〜100 点で採点し、JSONのみ返してください（日本語でコメントも付けて）。

採点基準（各 0〜100 点）:
- 商品一致度: 商品の外観・色・形状・ブランドロゴが元の商品画像と正確に一致しているか（最重要）
- 商品統一感: 全フレームにわたって同じ商品が一貫して映っているか
- 商品差し替え自然さ: 商品の置き換えが自然で、違和感・アーティファクト・歪みがないか
- モーション品質: カメラや商品の動きが滑らかで自然か、ブレやジャンプがないか${hasRef ? '（参照動画と同等の動きのダイナミズムがあるか）' : ''}
- カット間変化: ${hasRef ? '参照動画のように' : ''}各カットで視点・距離・向き・アクションが明確に変化しているか（単調な繰り返しでないか）
- 映像クオリティ: 解像度・シャープさ・色再現・アーティファクトのなさ
- 背景照明整合性: 商品と背景の光源・影・色温度が一致しているか
- TikTok適性: 縦型構図・視認性・テンポ・視聴者の購買意欲を刺激するか
- 字幕テキスト品質: 字幕の読みやすさ・位置・タイミング・フォントの適切さ
- 商業的訴求力: この動画を見た人が商品を購入したいと思うか（CVR観点）
- フック力: 冒頭1〜2秒で視聴者を引き付けられるか（離脱防止）
- 総合スコア: 全体的な品質（単純平均ではなく、商業的価値を重視した総合判断）${hasRef ? '。参照動画を100点とした場合の相対評価' : ''}

{
  "商品一致度":       { "score": 0, "comment": "" },
  "商品統一感":       { "score": 0, "comment": "" },
  "商品差し替え自然さ": { "score": 0, "comment": "" },
  "モーション品質":   { "score": 0, "comment": "" },
  "カット間変化":     { "score": 0, "comment": "" },
  "映像クオリティ":   { "score": 0, "comment": "" },
  "背景照明整合性":   { "score": 0, "comment": "" },
  "TikTok適性":      { "score": 0, "comment": "" },
  "字幕テキスト品質": { "score": 0, "comment": "" },
  "商業的訴求力":    { "score": 0, "comment": "" },
  "フック力":        { "score": 0, "comment": "" },
  "総合スコア":      { "score": 0, "comment": "" },
  "改善提案":        ["優先度高い改善点1", "改善点2", "改善点3"]
}

JSONのみ返してください（説明・前置き不要）。
`.trim();

  // 参照動画フレームを先に、生成動画フレームを後に渡す（プロンプトの順序と一致）
  const content = [
    ...(hasRef ? refImages : []),
    ...genImages,
    { type: 'text', text: promptText },
  ];

  const msg = await client.messages.create({
    model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 3000,
    messages: [{ role: 'user', content }],
  });

  const raw  = msg.content[0]?.text?.trim() ?? '{}';
  const json = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
  try {
    return JSON.parse(json);
  } catch {
    console.warn('⚠️  スコアパース失敗:', raw.slice(0, 300));
    return {};
  }
}

// ─── コスト・時間計算 ─────────────────────────────────────────────────────────

function computeCostTime(meta) {
  if (!meta) return null;

  const elapsedMs  = (meta.endTime ?? Date.now()) - (meta.startTime ?? Date.now());
  const elapsedSec = Math.round(elapsedMs / 1000);
  const mm = Math.floor(elapsedSec / 60);
  const ss = elapsedSec % 60;

  const calls = meta.apiCalls ?? {};
  const usd =
    (calls.nanoBanana   ?? 0) * 0.05  +
    (calls.fluxFill     ?? 0) * 0.05  +
    (calls.seedance     ?? 0) * 0.09  +
    (calls.claudeVision ?? 0) * 0.001 +
    (calls.elevenlabs   ?? 0) * 0.03;
  const jpy = Math.round(usd * 150);

  return {
    elapsedStr: `${mm}分${ss}秒`,
    elapsedSec,
    usd: usd.toFixed(3),
    jpy,
    apiCalls: calls,
  };
}

// ─── ターミナル表示 ──────────────────────────────────────────────────────────

const SCORE_KEYS = [
  '商品一致度', '商品統一感', '商品差し替え自然さ',
  'モーション品質', 'カット間変化', '映像クオリティ', '背景照明整合性',
  'TikTok適性', '字幕テキスト品質', '商業的訴求力', 'フック力',
];

function bar100(score) {
  const filled = Math.round(score / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function scoreLabel(s) {
  if (s >= 90) return '★ 優秀';
  if (s >= 75) return '◎ 良好';
  if (s >= 60) return '○ 普通';
  if (s >= 45) return '△ 要改善';
  return '✕ 不良';
}

function printReport(report) {
  const { scores, costTime } = report;

  console.log('\n' + '━'.repeat(58));
  console.log('📊 動画品質評価レポート（100点満点）');
  console.log('━'.repeat(58));

  if (costTime) {
    console.log(`\n⏱️  生成時間: ${costTime.elapsedStr}`);
    console.log(`💰 推定コスト: ¥${costTime.jpy} ($${costTime.usd})`);
    const c = costTime.apiCalls;
    console.log(`   Seedance: ${c.seedance ?? 0}回  Claude Vision: ${c.claudeVision ?? 0}回  ElevenLabs: ${c.elevenlabs ?? 0}回`);
  }

  console.log('\n━━ 評価スコア ' + '━'.repeat(44));
  for (const key of SCORE_KEYS) {
    const item = scores[key];
    if (!item) continue;
    const s = item.score ?? 0;
    const label = key.padEnd(12, '　');
    console.log(`${label} [${bar100(s)}]  ${String(s).padStart(3)}点  ${scoreLabel(s)}`);
    if (item.comment) console.log(`         └ ${item.comment}`);
  }

  const overall = scores['総合スコア'];
  if (overall) {
    const s = overall.score ?? 0;
    console.log('\n' + '─'.repeat(58));
    console.log(`${'総合スコア'.padEnd(12, '　')} [${bar100(s)}]  ${String(s).padStart(3)}点  ${scoreLabel(s)}`);
    if (overall.comment) console.log(`         └ ${overall.comment}`);
  }

  const suggestions = scores['改善提案'];
  if (Array.isArray(suggestions) && suggestions.length) {
    console.log('\n━━ 改善提案 ' + '━'.repeat(46));
    suggestions.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  }

  console.log('\n' + '━'.repeat(58) + '\n');
}

// ─── Markdown 追記 ───────────────────────────────────────────────────────────

function appendMarkdown(report, mdPath) {
  const { scores, costTime, generatedVideo, evaluatedAt } = report;

  const dt = new Date(evaluatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const videoName = basename(generatedVideo);

  let md = `\n---\n\n## 評価: ${videoName}\n\n**評価日時**: ${dt}\n\n`;

  if (costTime) {
    md += `**生成時間**: ${costTime.elapsedStr}  \n`;
    md += `**推定コスト**: ¥${costTime.jpy} ($${costTime.usd})  \n`;
    const c = costTime.apiCalls;
    md += `**API呼び出し**: Seedance ${c.seedance ?? 0}回 / Claude Vision ${c.claudeVision ?? 0}回 / ElevenLabs ${c.elevenlabs ?? 0}回\n\n`;
  }

  md += `### 評価スコア（100点満点）\n\n`;
  md += `| 評価項目 | スコア | 判定 | コメント |\n`;
  md += `|---------|-------:|------|--------|\n`;

  for (const key of SCORE_KEYS) {
    const item = scores[key];
    if (!item) continue;
    const s = item.score ?? 0;
    md += `| ${key} | **${s}点** | ${scoreLabel(s)} | ${item.comment ?? ''} |\n`;
  }

  const overall = scores['総合スコア'];
  if (overall) {
    const s = overall.score ?? 0;
    md += `| **総合スコア** | **${s}点** | **${scoreLabel(s)}** | ${overall.comment ?? ''} |\n`;
  }

  const suggestions = scores['改善提案'];
  if (Array.isArray(suggestions) && suggestions.length) {
    md += `\n### 改善提案\n\n`;
    suggestions.forEach((s, i) => { md += `${i + 1}. ${s}\n`; });
  }

  md += '\n';

  // ファイルが存在しない場合はヘッダーを付ける
  const isNew = !existsSync(mdPath);
  if (isNew) {
    const header = `# 動画品質評価ログ\n\nこのファイルは動画生成のたびに自動追記されます。\n`;
    writeFileSync(mdPath, header, 'utf8');
  }

  appendFileSync(mdPath, md, 'utf8');
}

// ─── ユーティリティ ──────────────────────────────────────────────────────────

function getDuration(filePath) {
  const r = spawnSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ], { encoding: 'utf8' });
  return parseFloat(r.stdout?.trim()) || 0;
}
