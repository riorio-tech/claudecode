/**
 * 11_emotion-diagnose — 3信号統合診断エージェント
 *
 * テキスト・フレーム・音声の3信号を統合し、
 * 「どの層をどう修正すれば感情が強くなるか」を診断する。
 *
 * 出力:
 *   layer: 'script' | 'visual' | 'both'
 *   scriptFeedback: 脚本の何が弱いか・どう直すか
 *   visualFeedback: 映像演出の何が弱いか
 *   diagnosis: 診断サマリー文
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../lib/logger.js';
import { config } from '../../config.js';

/**
 * @param {{ jobId, jobDir, textAnalysis, frameAnalysis, audioAnalysis, evalReport, script }} params
 * @returns {{ layer, scriptFeedback, visualFeedback, diagnosis }}
 */
export async function runEmotionDiagnose({ jobId, jobDir, textAnalysis, frameAnalysis, audioAnalysis, evalReport, script }) {
  const diagnoseDir = join(jobDir, '11_emotion-diagnose');
  mkdirSync(diagnoseDir, { recursive: true });

  const client = new Anthropic();

  // 3信号のサマリーを整形
  const textSummary = (textAnalysis?.scenes ?? []).map(s =>
    `Scene${s.sceneIndex}[${s.dominant}]: 怒${s.anger} 共${s.empathy} 熱${s.frenzy} — ${s.reasoning ?? ''}`
  ).join('\n');

  const frameSummary = frameAnalysis?.summary
    ? `怒り平均:${frameAnalysis.summary.anger} 共感平均:${frameAnalysis.summary.empathy} 熱狂平均:${frameAnalysis.summary.frenzy}`
    : '（フレーム分析なし）';

  const audioSummary = audioAnalysis
    ? `エネルギー推移: ${audioAnalysis.energy.map((e, i) => `${audioAnalysis.timePoints[i]}s:${e}`).join(' → ')}`
    : '（音声分析なし）';

  const evalSummary = evalReport
    ? Object.entries(evalReport.scores ?? {}).map(([k, v]) => `${k}:${v?.score ?? '-'}`).join(' ')
    : '（eval なし）';

  const prompt = `あなたは TikTok ドラマの感情工学診断専門家です。
「感情の波をハックし、熱狂を作り出す」が目的。

## 3信号の分析結果

### テキスト分析（セリフ・ナレーション）
${textSummary}

### 映像フレーム分析（表情・構図）
${frameSummary}

### 音声エネルギー分析（抑揚・強度）
${audioSummary}

### eval スコア（総合品質評価）
${evalSummary}
総合: ${evalReport?.totalScore ?? '-'}/100

## 脚本情報
フック: ${script.hookLine}
クリフハンガー: ${script.cliffhangerLine}
感情アーク: ${script.scenes?.map(s => `Scene${s.sceneIndex}(${s.emotionalBeat})`).join(' → ')}

## 診断指示

3信号を統合して以下を判断してください:

1. **root_cause**: 何が一番の問題か（1〜2文）
2. **layer**: 修正すべき層 → "script" | "visual" | "both"
   - script: セリフ自体が感情を引き出せていない（テキスト分析が低い）
   - visual: セリフは良いが映像・表情が弱い（フレーム分析が低い、テキストは高い）
   - both: 両方弱い
3. **scriptFeedback**: layer が script/both の場合、脚本の具体的な改善指示
   - どのシーンの何を変えるか
   - hookLine/cliffhangerLine は具体的に何を変えるか
4. **visualFeedback**: layer が visual/both の場合、映像演出の改善指示

JSON のみ出力:
\`\`\`json
{
  "root_cause": "テキストの怒り誘発力は高いが、フレーム分析で表情が無表情のため感情が伝わっていない",
  "layer": "visual",
  "scriptFeedback": null,
  "visualFeedback": "全シーンの imagePrompt に感情表現を追加。特に Scene0 と Scene2 で顔のクローズアップを優先",
  "diagnosis": "セリフの感情設計は適切。問題は映像層。キャラクターの表情が生成画像で再現されていない。"
}
\`\`\``;

  const response = await client.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');

  let result;
  try {
    // コードブロック内の JSON を探す
    const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/g)];
    if (blocks.length > 0) {
      result = JSON.parse(blocks[blocks.length - 1][1]);
    } else {
      // コードブロックなし → { から } の最後の対応を探す
      const i = text.indexOf('{');
      const j = text.lastIndexOf('}');
      if (i !== -1 && j !== -1 && j > i) {
        result = JSON.parse(text.slice(i, j + 1));
      } else {
        throw new Error('JSON ブロックなし');
      }
    }
  } catch (e) {
    logger.warn(`emotion-diagnose: JSON パース失敗 (${e.message}) → visual にフォールバック`);
    return { layer: 'visual', scriptFeedback: null, visualFeedback: '映像演出を改善してください', diagnosis: 'パース失敗' };
  }
  writeFileSync(join(diagnoseDir, 'diagnosis.json'), JSON.stringify(result, null, 2), 'utf8');

  // CLI 表示
  const CYAN = '\x1b[36m', YELLOW = '\x1b[33m', RESET = '\x1b[0m';
  console.log(`\n${CYAN}━━ 感情診断結果 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`  根本原因: ${result.root_cause}`);
  console.log(`  修正層:   ${YELLOW}${result.layer}${RESET}`);
  console.log(`  診断:     ${result.diagnosis}`);
  if (result.scriptFeedback) console.log(`  脚本修正: ${result.scriptFeedback}`);
  if (result.visualFeedback) console.log(`  映像修正: ${result.visualFeedback}`);
  console.log(`${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

  return result;
}
