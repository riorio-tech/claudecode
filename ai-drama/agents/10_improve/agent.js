/**
 * 10_improve — eval 結果を基に scene plan を改善（フィードバックループ用）
 *
 * - 低スコア項目を分析し imagePrompt / shotType / motionCode を書き直す
 * - ScenePlanSchema を維持したまま返す
 * - スコアが改善しなかった場合は呼び出し元が元の plan を使い回す
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { validate, ScenePlanSchema, extractJson, SHOT_TYPES, MOTION_CODES, EMOTIONAL_BEATS } from '../../lib/validate-json.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config.js';

/** スコアが閾値未満の項目を抽出し感情工学の観点から改善指示テキストを組み立てる */
function buildWeakPointsGuide(scores) {
  const THRESHOLD = 7;
  const guidelines = [];

  const s = scores;

  // ── 感情工学の三本柱 ────────────────────────────────────────────────────

  if ((s.hook?.score ?? 10) < THRESHOLD) {
    guidelines.push(`【フック力が弱い (${s.hook?.score}/10)】— 冒頭3秒で怒りか共感を引き出せていない
- Scene 0 の shotType を close_face または extreme_close_eyes に変更
- imagePrompt 冒頭に "EXTREME CLOSE-UP of protagonist face, shock and injustice written on face, " を追加
- motionCode を snap_zoom_in に変更（冒頭の衝撃を視覚で表現）
- フックは「理不尽な現実」か「深い孤独」を一瞬で見せる構図にする`);
  }

  if ((s.anger?.score ?? 10) < THRESHOLD) {
    guidelines.push(`【怒り誘発力が弱い (${s.anger?.score}/10)】— 悪役の理不尽さが映像で伝わっていない
- 悪役登場シーンの shotType を low_angle_power（悪役が大きく見える）に変更
- 主人公が屈辱を受けるシーンの shotType を high_angle_weak（主人公が小さく見える）に変更
- imagePrompt に "arrogant expression, contemptuous look, looking down on protagonist" を追加
- 対比を明確にする: 悪役 = 高い位置・強い照明、主人公 = 低い位置・暗い照明`);
  }

  if ((s.empathy?.score ?? 10) < THRESHOLD) {
    guidelines.push(`【共感力が弱い (${s.empathy?.score}/10)】— 主人公の弱さ・孤独が視聴者に届いていない
- 主人公の内面シーンの shotType を close_face または extreme_close_eyes に変更
- imagePrompt に "lonely expression, vulnerability visible in eyes, isolation, quiet suffering" を追加
- motionCode を static_with_drift にして「静止した孤独感」を演出
- 全シーンの imagePrompt 先頭に "same Japanese high school male student, dark straight hair, navy school uniform, slim build, pale complexion," を必ず追加（人物一貫性も同時に確保）`);
  }

  if ((s.frenzy?.score ?? 10) < THRESHOLD) {
    guidelines.push(`【熱狂・逆転力が弱い (${s.frenzy?.score}/10)】— 「やった！」という感情が爆発していない
- 逆転シーンの shotType を low_angle_power（主人公が強者になる構図）に変更
- motionCode を snap_zoom_in（急激な視点変化で逆転の衝撃を演出）に変更
- imagePrompt に "triumphant expression, confident posture, power shift visible, shocked antagonist in background" を追加
- 逆転の直前シーンに extreme_close_prop（決定的な小道具・証拠）を配置`);
  }

  if ((s.viral?.score ?? 10) < THRESHOLD) {
    guidelines.push(`【拡散衝動が弱い (${s.viral?.score}/10)】— コメントしたい・シェアしたいという衝動が生まれていない
- 最も感情が強い瞬間（怒り or 逆転）のシーンを視覚的に最も印象的にする
- そのシーンの imagePrompt に "most dramatic moment, cinematically powerful composition, unforgettable frame" を追加
- motionCode を freeze（静止）または snap_zoom_in（衝撃）にして記憶に残るフレームを作る`);
  }

  if ((s.cliffhanger?.score ?? 10) < THRESHOLD) {
    guidelines.push(`【クリフハンガー力が弱い (${s.cliffhanger?.score}/10)】— 「次を見なければ」という渇望が残っていない
- 最終シーンの shotType を extreme_close_prop（証拠・小道具）または extreme_close_eyes に変更
- motionCode を freeze にして静止感で余韻を演出
- imagePrompt に "pivotal object that changes everything, document/phone screen/letter visible, revelation moment" を追加
- 逆転の直前か直後で止める構造になっているか確認（途中で止める = 渇望が最大化）`);
  }

  if ((s.character?.score ?? 10) < THRESHOLD) {
    guidelines.push(`【人物一貫性が低い (${s.character?.score}/10)】— シーンをまたいでキャラクターの外見がブレている
- 全シーンの imagePrompt の先頭に必ず追加:
  "same Japanese high school male student, dark straight hair, navy school uniform, slim build, pale complexion,"
- negativePrompt に "different character, female character, wrong hair color, wrong clothing" を追加`);
  }

  if ((s.drama?.score ?? 10) < THRESHOLD) {
    guidelines.push(`【ドラマ演出力が低い (${s.drama?.score}/10)】— 権力差・緊張感が映像で表現されていない
- 対立シーンの shotType を dutch_angle（緊張感）または low_angle_power / high_angle_weak の対比に変更
- imagePrompt に "dramatic cinematic lighting, high contrast shadows, power imbalance visible in composition" を追加`);
  }

  return guidelines.length > 0 ? guidelines.join('\n\n') : '全感情指標 7 点以上。さらに細部の感情強度を上げることを検討してください。';
}

/**
 * @param {{ jobId, jobDir, scenePlan, evalReport, script, iteration, verbose }} params
 * @returns {object} 改善済み ScenePlanSchema オブジェクト
 */
export async function runImprove({ jobId, jobDir, scenePlan, evalReport, script, iteration = 1, verbose = false }) {
  const improveDir = join(jobDir, '10_improve');
  mkdirSync(improveDir, { recursive: true });

  const weakGuide = buildWeakPointsGuide(evalReport.scores);
  const totalScore = evalReport.totalScore;

  logger.info(`improve: iter-${iteration} 改善生成中... (現スコア: ${totalScore}/100)`);
  if (verbose) logger.info(`[improve] 弱点分析:\n${weakGuide}`);

  const client = new Anthropic();

  const systemPrompt = `あなたは TikTok ショートドラマの感情工学専門家です。
「感情の波をハックし、熱狂を作り出す」——これが目的だ。

eval スコアの低い感情指標を分析し、scene plan の imagePrompt / shotType / motionCode を改善して
視聴者の感情反応（怒り・共感・熱狂）を最大化してください。

## 感情工学の原則

- 怒りが弱い → 権力構造の視覚的対比を強化（低角度/高角度の使い分け）
- 共感が弱い → 主人公の孤独・脆弱性を寄りのショットで表現
- 熱狂が弱い → 逆転シーンに snap_zoom_in + low_angle_power を使う
- フックが弱い → 冒頭の顔アップ + 衝撃の表情で即座に感情を引き出す

## 制約

- 変更可能: imagePrompt, shotType, motionCode, negativePrompt
- 変更禁止: sceneIndex, jobId, targetDurationSec, lightingCode, colorPalette, emotionalBeat
- shotType は必ずこのリストから: ${SHOT_TYPES.join(' | ')}
- motionCode は必ずこのリストから: ${MOTION_CODES.join(' | ')}
- 全シーン出力必須（変更なしのシーンも含める）
- imagePrompt は英語・最低50文字・"photorealistic, 9:16 vertical" を必ず含める

## 出力形式（JSON のみ・説明不要）

\`\`\`json
{
  "jobId": "${jobId}",
  "scenes": [ ...全シーン... ]
}
\`\`\``;

  const userPrompt = `## 現在の eval スコア (${totalScore}/100)

${Object.entries(evalReport.scores).map(([k, v]) => `- ${k}: ${v?.score ?? '-'}/10 — ${v?.comment ?? ''}`).join('\n')}

## eval の改善提案（原文）
${evalReport.improvements?.map(i => `- ${i}`).join('\n') ?? 'なし'}

## 改善指示
${weakGuide}

## 現在の scene plan

\`\`\`json
${JSON.stringify(scenePlan, null, 2)}
\`\`\`

## 脚本情報（参考）
フック: ${script.hookLine}
クリフハンガー: ${script.cliffhangerLine}
感情アーク: ${script.scenes?.map(s => `Scene${s.sceneIndex}(${s.emotionalBeat})`).join(' → ')}

上記の改善指示に従って scene plan を書き直してください。`;

  const response = await client.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  if (verbose) logger.info(`[improve] Claude 出力:\n${text.slice(0, 500)}...`);

  let improved;
  try {
    const parsed = extractJson(text);
    parsed.jobId = jobId;
    improved = validate(ScenePlanSchema, parsed);
  } catch (e) {
    logger.warn(`improve: 出力パース失敗 (${e.message}) → 元の scene plan を使用`);
    return scenePlan;
  }

  writeFileSync(
    join(improveDir, `iter-${iteration}-scene-plan.json`),
    JSON.stringify(improved, null, 2),
    'utf8',
  );

  // 変更点をサマリー表示
  const RESET = '\x1b[0m', CYAN = '\x1b[36m', YELLOW = '\x1b[33m';
  console.log(`\n${CYAN}── iter-${iteration} 改善内容 ──────────────────────────────────${RESET}`);
  for (const [orig, impv] of (scenePlan.scenes ?? []).map((s, i) => [s, improved.scenes[i]])) {
    if (!impv) continue;
    if (orig.shotType !== impv.shotType)   console.log(`  Scene ${orig.sceneIndex}: shotType  ${YELLOW}${orig.shotType}${RESET} → ${impv.shotType}`);
    if (orig.motionCode !== impv.motionCode) console.log(`  Scene ${orig.sceneIndex}: motionCode ${YELLOW}${orig.motionCode}${RESET} → ${impv.motionCode}`);
  }
  console.log(`${CYAN}────────────────────────────────────────────────────────${RESET}\n`);

  logger.success(`iter-${iteration}-scene-plan.json 保存完了`);
  return improved;
}
