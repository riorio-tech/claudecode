/**
 * 09_eval — 生成動画の品質評価エージェント
 *
 * - 生成動画からフレームを抽出し Claude Sonnet ビジョンで 100 点満点評価
 * - 参照動画があれば並べて比較
 * - eval_log.md に追記
 * - JSON レポートを {jobDir}/09_eval-report.json に保存
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, basename } from 'path';
import { execFileSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { FFMPEG, FFPROBE } from '../../lib/ffmpeg-path.js';

const EVAL_ITEMS = [
  { key: 'hook',       label: 'フック力',       desc: '冒頭3秒でスクロールが止まるか。怒りか共感を即座に引き出しているか' },
  { key: 'anger',      label: '怒り誘発力',     desc: '悪役の理不尽さ・権力の不当さが視聴者を怒らせるか。「これはひどい」と即判断できるか' },
  { key: 'empathy',    label: '共感力',         desc: '主人公の弱さ・孤独・失敗に視聴者が自分を重ねられるか。「自分も同じだ」と感じるか' },
  { key: 'frenzy',     label: '熱狂・逆転力',   desc: '逆転の瞬間が「やった！」という感情を爆発させるか。視聴者が思わず声を上げるレベルか' },
  { key: 'viral',      label: '拡散衝動',       desc: 'コメントしたい・シェアしたい・友人に見せたいという衝動を生むか' },
  { key: 'cliffhanger',label: 'クリフハンガー力', desc: '「次を見なければ」という渇望を残しているか。逆転の手前か直後で止まっているか' },
  { key: 'character',  label: '人物一貫性',     desc: '全シーンで同じキャラクターが映っているか。外見・性別・服装のブレがないか' },
  { key: 'drama',      label: 'ドラマ演出力',   desc: '権力差・緊張感・沈黙の視覚的表現。感情の強度が映像で伝わるか' },
  { key: 'subtitle',   label: '字幕視認性',     desc: '読みやすさ・タイミング・語数の適切さ' },
  { key: 'audio',      label: '音声品質',       desc: '台詞の明瞭さ・BGM バランス。感情を増幅しているか、邪魔していないか' },
];

/** 動画からフレームを抽出して base64 配列で返す */
function extractFrames(videoPath, tmpDir, count = 4) {
  const frames = [];

  const frameDir = join(tmpDir, 'frames_' + basename(videoPath, '.mp4').replace(/\W/g, '_'));
  mkdirSync(frameDir, { recursive: true });

  // 均等間隔でフレーム抽出（select filter）
  try {
    execFileSync(FFMPEG, [
      '-i', videoPath,
      '-vf', `select='not(mod(n,30))',scale=512:-1`,
      '-frames:v', String(count),
      '-vsync', 'vfr',
      '-y',
      join(frameDir, 'frame-%02d.jpg'),
    ], { stdio: 'pipe' });
  } catch (e) {
    // select が取れない場合は時間指定で取る
    for (let i = 0; i < count; i++) {
      try {
        execFileSync(FFMPEG, [
          '-ss', String(i * 3),
          '-i', videoPath,
          '-frames:v', '1',
          '-s', '512x910',
          '-y',
          join(frameDir, `frame-${String(i).padStart(2, '0')}.jpg`),
        ], { stdio: 'pipe' });
      } catch {}
    }
  }

  // 取得したフレームを base64 変換
  for (let i = 0; i < count; i++) {
    const p = join(frameDir, `frame-${String(i + 1).padStart(2, '0')}.jpg`);
    const p0 = join(frameDir, `frame-${String(i).padStart(2, '0')}.jpg`);
    const target = existsSync(p) ? p : existsSync(p0) ? p0 : null;
    if (target) {
      frames.push(readFileSync(target).toString('base64'));
    }
  }
  return frames;
}

/** Claude vision で評価 */
async function evaluateWithClaude(generatedFrames, referenceFrames, script) {
  const client = new Anthropic();

  const content = [];

  // 生成動画フレーム
  content.push({ type: 'text', text: '## 評価対象動画（生成動画）のフレーム:' });
  for (const b64 of generatedFrames) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
  }

  // 参照動画フレーム（あれば）
  if (referenceFrames.length > 0) {
    content.push({ type: 'text', text: '\n## 参照動画（目標クオリティ）のフレーム:' });
    for (const b64 of referenceFrames) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
    }
  }

  // 脚本情報
  content.push({ type: 'text', text: `\n## 脚本情報:\nhookLine: ${script.hookLine}\ncliffhangerLine: ${script.cliffhangerLine}\n感情アーク: ${script.scenes?.map(s => s.emotionalBeat).join(' → ') ?? ''}` });

  content.push({ type: 'text', text: `
## 評価指示

あなたは「感情工学」の観点でこの動画を評価する。
目的は映像の技術品質ではなく、**視聴者の感情反応を引き出せているか**だ。

以下の問いに答える形で 10 項目を各 10 点満点で採点してください。
${referenceFrames.length > 0 ? '参照動画と比較してどの程度近いか/差があるかも考慮してください。' : ''}

評価の核心:
- この動画を見た人は怒るか？（怒り誘発力）
- この動画を見た人は自分を重ねるか？（共感力）
- この動画を見た人は「やった！」と叫ぶか？（熱狂・逆転力）
- この動画を見た人は誰かに送りたくなるか？（拡散衝動）

評価項目:
${EVAL_ITEMS.map((it, i) => `${i + 1}. ${it.label}（${it.desc}）`).join('\n')}

各項目について、スコア（0〜10）と1〜2行のコメントを付けてください。
改善提案は「感情をどう強化するか」の観点で 3 点挙げてください。
${referenceFrames.length > 0 ? '参照動画との比較コメントも付けてください（1〜2行）。' : ''}

以下の JSON 形式のみで出力してください（説明不要）:
\`\`\`json
{
  "scores": {
    "hook":       { "score": 8, "comment": "コメント" },
    "anger":      { "score": 7, "comment": "コメント" },
    "empathy":    { "score": 6, "comment": "コメント" },
    "frenzy":     { "score": 7, "comment": "コメント" },
    "viral":      { "score": 6, "comment": "コメント" },
    "cliffhanger":{ "score": 8, "comment": "コメント" },
    "character":  { "score": 7, "comment": "コメント" },
    "drama":      { "score": 7, "comment": "コメント" },
    "subtitle":   { "score": 8, "comment": "コメント" },
    "audio":      { "score": 5, "comment": "コメント" }
  },
  "improvements": ["感情強化の提案1", "感情強化の提案2", "感情強化の提案3"],
  "referenceComparison": "参照動画との比較コメント（参照なしなら空文字）"
}
\`\`\`` });

  const response = await client.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 3000,
    messages: [{ role: 'user', content }],
  });

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/g)];
  if (blocks.length === 0) throw new Error('eval JSON が見つかりません');
  return JSON.parse(blocks[blocks.length - 1][1]);
}

/** eval_log.md に追記 */
function appendEvalLog(evalLogPath, report) {
  const { jobId, totalScore, judgment, scores, improvements, referenceComparison, durationSec } = report;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

  const rows = EVAL_ITEMS.map(it => {
    const s = scores[it.key];
    return `| ${it.label} | ${s?.score ?? '-'}/10 | ${s?.comment ?? ''} |`;
  }).join('\n');

  const md = `
## ${now} — ${jobId.slice(0, 8)} (${durationSec}秒)

| 項目 | スコア | コメント |
|------|--------|---------|
${rows}

**総合スコア: ${totalScore}/100 ${judgment}**

**改善提案:**
${improvements.map(i => `- ${i}`).join('\n')}

${referenceComparison ? `**参照動画との比較:** ${referenceComparison}` : ''}

---
`;

  if (!existsSync(evalLogPath)) {
    writeFileSync(evalLogPath, '# eval_log\n');
  }
  appendFileSync(evalLogPath, md);
}

function getJudgment(score) {
  if (score >= 90) return '★ 優秀';
  if (score >= 75) return '◎ 良好';
  if (score >= 60) return '○ 普通';
  if (score >= 45) return '△ 要改善';
  return '✕ 不良';
}

/**
 * @param {{ jobId, jobDir, finalVideoPath, script, referencePath, evalLogPath }} params
 */
export async function runEval({ jobId, jobDir, finalVideoPath, script, referencePath = null, evalLogPath }) {
  const tmpFrameDir = join(jobDir, 'eval_frames');
  mkdirSync(tmpFrameDir, { recursive: true });

  logger.info('eval: フレーム抽出中...');

  // 生成動画からフレーム抽出
  const generatedFrames = extractFrames(finalVideoPath, tmpFrameDir, 4);
  if (generatedFrames.length === 0) {
    logger.warn('eval: フレーム抽出失敗 → eval スキップ');
    return null;
  }

  // 参照動画フレーム（あれば）
  let referenceFrames = [];
  if (referencePath && existsSync(referencePath)) {
    referenceFrames = extractFrames(referencePath, tmpFrameDir, 4);
    logger.info(`eval: 参照動画フレーム ${referenceFrames.length} 枚取得`);
  }

  logger.info(`eval: Claude Sonnet で評価中... (${generatedFrames.length} フレーム)`);

  let evalResult;
  try {
    evalResult = await evaluateWithClaude(generatedFrames, referenceFrames, script);
  } catch (e) {
    logger.warn(`eval 失敗: ${e.message}`);
    return null;
  }

  // 合計スコア計算
  const totalScore = Object.values(evalResult.scores).reduce((s, v) => s + (v?.score ?? 0), 0);
  const judgment = getJudgment(totalScore);

  // 動画尺を取得
  let durationSec = 0;
  try {
    const probeOut = execFileSync(FFPROBE, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', finalVideoPath,
    ], { encoding: 'utf8' });
    durationSec = parseFloat(JSON.parse(probeOut).format?.duration ?? '0');
  } catch {}

  const report = {
    jobId,
    totalScore,
    judgment,
    passed: totalScore >= 60,
    scores: evalResult.scores,
    improvements: evalResult.improvements ?? [],
    referenceComparison: evalResult.referenceComparison ?? '',
    durationSec: durationSec.toFixed(1),
    hasReference: referenceFrames.length > 0,
  };

  // JSON レポート保存
  writeFileSync(join(jobDir, '09_eval-report.json'), JSON.stringify(report, null, 2), 'utf8');

  // eval_log.md に追記
  appendEvalLog(evalLogPath, report);

  // CLI 表示
  const RESET = '\x1b[0m', CYAN = '\x1b[36m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m';
  console.log(`\n${CYAN}━━ eval 評価結果 ━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  for (const it of EVAL_ITEMS) {
    const s = evalResult.scores[it.key];
    const bar = '█'.repeat(s?.score ?? 0) + '░'.repeat(10 - (s?.score ?? 0));
    console.log(`  ${it.label.padEnd(12)} ${bar} ${s?.score ?? '-'}/10  ${s?.comment ?? ''}`);
  }
  const color = totalScore >= 75 ? GREEN : totalScore >= 60 ? YELLOW : '\x1b[31m';
  console.log(`${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`  総合スコア: ${color}${totalScore}/100 ${judgment}${RESET}`);
  if (evalResult.improvements?.length) {
    console.log(`\n  改善提案:`);
    for (const imp of evalResult.improvements) console.log(`    • ${imp}`);
  }
  if (evalResult.referenceComparison) {
    console.log(`\n  参照比較: ${evalResult.referenceComparison}`);
  }
  console.log(`${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);
  console.log(`  eval_log.md → ${evalLogPath}`);

  return report;
}
