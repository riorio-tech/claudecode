import { writeFileSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { validate, ShotPlanV2Schema } from '../../lib/validate-json.js';
import { logger } from '../../lib/logger.js';
import { getTopPatterns } from '../../db/db.js';
import { config } from '../../config.js';

const getClient = () => new Anthropic();

const SYSTEM_PROMPT = `あなたは TikTok Shop の動画ディレクター兼台本ライターです。
商品情報を受け取り、1商品につき10本分のショットプランを生成してください。

## クリップ設計（固定）

各動画は以下の5カット構成（合計22秒）:
| index | role    | durationSec | angleHint | motion    |
|-------|---------|-------------|-----------|-----------|
| 0     | hook    | 5           | wide      | zoom-in   |
| 1     | benefit | 5           | close     | zoom-out  |
| 2     | benefit | 3           | angle     | static    |
| 3     | proof   | 5           | scene     | slide-left|
| 4     | cta     | 4           | front     | static    |

## HOOKバリエーション10種（10本それぞれ異なるhookVariantを使う）

1. 問題提起型: 視聴者の悩みを直接指摘
2. 驚き数字型: 具体的な数字・実績で引く
3. ビフォーアフター型: 変化の対比で興味を引く
4. 疑問型: "なぜ？"で好奇心を刺激
5. 共感型: "あるある"で引き込む
6. ストーリー型: 偶然の発見ナラティブ
7. 警告型: "これ使わないで"で損失回避
8. 直接訴求型: 価格・コスパを前面に
9. UGC風型: リアルな口コミ感
10. 限定性型: 希少性・タイミングを演出

## overlayText のルール（重要）

- 最大20文字（日本語）
- HOOKカット: 視聴者を止める一言
- BENEFITカット: 商品の最強の特徴
- PROOFカット: 数字・実績・社会的証明
- CTAカット: 購買を後押しする一言（「今すぐチェック」など）

## 出力形式

以下の JSON のみを出力してください（説明・コメント不要）:

\`\`\`json
{
  "jobId": "{{jobId}}",
  "productSummary": {
    "target": "誰が",
    "pain": "どんな悩みを持っているか",
    "solution": "商品がどう解決するか"
  },
  "videos": [
    {
      "videoIndex": 0,
      "hookVariant": "問題提起型",
      "voiceScript": "動画全体のナレーション（60〜80文字）",
      "shots": [
        {
          "index": 0,
          "role": "hook",
          "durationSec": 5,
          "scriptHint": "このカットで言いたいこと（ナレーターへの指示）",
          "overlayText": "画面に表示するテキスト（最大20文字）",
          "motion": "zoom-in",
          "angleHint": "wide"
        },
        { "index": 1, "role": "benefit", "durationSec": 5, "scriptHint": "...", "overlayText": "...", "motion": "zoom-out", "angleHint": "close" },
        { "index": 2, "role": "benefit", "durationSec": 3, "scriptHint": "...", "overlayText": "...", "motion": "static", "angleHint": "angle" },
        { "index": 3, "role": "proof",   "durationSec": 5, "scriptHint": "...", "overlayText": "...", "motion": "slide-left", "angleHint": "scene" },
        { "index": 4, "role": "cta",     "durationSec": 4, "scriptHint": "...", "overlayText": "...", "motion": "static", "angleHint": "front" }
      ]
    }
    // ... 10本分（videoIndex: 0〜9）
  ]
}
\`\`\``;

/**
 * 10本分のショットプランを生成する
 *
 * @param {{ jobId: string, jobDir: string, analyzeOutput: object, verbose: boolean }} params
 * @returns {object} 02_shot-plan.json の内容
 */
export async function runShotPlanner({ jobId, jobDir, analyzeOutput, verbose }) {
  // DBから勝ちパターンを取得（あれば参照）
  const topPatterns = getTopPatterns(3);
  const patternContext = topPatterns.length > 0
    ? `\n\n## 過去の勝ちパターン（参考にしてください）\n${topPatterns.map(p =>
        `- hookVariant: ${p.hook_variant} / CVR向上: +${((p.cvr_lift - 1) * 100).toFixed(0)}% / ${p.impressions}imp`
      ).join('\n')}`
    : '';

  const userMessage = `以下の商品情報から10本分のショットプランを生成してください。
${patternContext}

## 商品情報
${JSON.stringify(analyzeOutput.normalizedProduct, null, 2)}

jobId: ${jobId}`;

  let shotPlan;
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) {
      logger.warn(`shot-planner リトライ... (試行 ${attempt}/2)`);
    }

    const messages = [{ role: 'user', content: userMessage }];
    if (attempt === 2 && lastError) {
      messages.push({ role: 'assistant', content: 'エラーが発生しました。修正して再出力します。' });
      messages.push({ role: 'user', content: `前回のエラー: ${lastError}\n\nJSON のみを出力してください。jobId は "${jobId}" です。` });
    }

    const response = await getClient().messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages,
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    if (verbose) {
      logger.info(`[shot-planner response]\n${text.slice(0, 500)}...`);
    }

    try {
      const parsed = extractJson(text);
      parsed.jobId = jobId;
      shotPlan = validate(ShotPlanV2Schema, parsed);
      break;
    } catch (e) {
      lastError = e.message;
      if (attempt === 2) {
        throw new Error(`shot-planner の出力が無効です: ${e.message}`);
      }
    }
  }

  const outputPath = join(jobDir, '02_shot-plan.json');
  writeFileSync(outputPath, JSON.stringify(shotPlan, null, 2), 'utf8');
  logger.success(`02_shot-plan.json (${shotPlan.videos.length}本分) → ${outputPath}`);
  return shotPlan;
}

function extractJson(text) {
  const codeBlockRe = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  const matches = [...text.matchAll(codeBlockRe)];
  if (matches.length > 0) {
    return JSON.parse(matches[matches.length - 1][1]);
  }
  const lastBrace = text.lastIndexOf('{');
  if (lastBrace !== -1) {
    const sub = text.slice(lastBrace);
    const lastClose = sub.lastIndexOf('}');
    if (lastClose !== -1) return JSON.parse(sub.slice(0, lastClose + 1));
  }
  throw new Error('JSON ブロックが見つかりません');
}
