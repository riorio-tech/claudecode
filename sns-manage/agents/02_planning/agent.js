import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { extractJson, validate } from '../../lib/validate-json.js';
import { readJobFile, writeJobFile } from '../../lib/job-dir.js';
import { getTopPatterns, getTopFailures, getKnowledgeBase } from '../../db/db.js';

const PlanningOutputSchema = z.object({
  contentPlan: z.array(z.object({
    platform: z.string(),
    format: z.string(),
    hookType: z.string(),
    hookTypeReason: z.string().optional(),
    targetEmotion: z.string().optional(),
    structure: z.array(z.string()),
    keyMessage: z.string(),
    priority: z.number(),
  })),
  crossPlatformStrategy: z.string(),
  postingSchedule: z.record(z.string()),
});

/**
 * リサーチ結果を受け取り、各プラットフォーム向けコンテンツの設計図を作成する。
 * @param {string} jobId
 * @returns {Promise<void>}
 */
export async function runPlanning(jobId) {
  logger.step(2, '企画立案');

  // Step 1: リサーチ結果を読み込む
  logger.info('01_research-output.json を読み込み中...');
  const researchOutput = readJobFile(jobId, '01_research-output.json');

  // Step 2: 勝ちパターン・負けパターン・知識ベースを取得（永続資産からの学習注入）
  logger.info('勝ちパターン・負けパターン・知識ベースを取得中...');
  const [rawPatterns, rawFailures, knowledgeItems] = await Promise.all([
    getTopPatterns(5),
    getTopFailures(5),
    getKnowledgeBase({ limit: 8 }),
  ]);
  const winPatterns = rawPatterns ?? [];
  const failurePatterns = rawFailures ?? [];
  const knowledge = knowledgeItems ?? [];

  if (winPatterns.length === 0) {
    logger.warn('勝ちパターンがありません（DBなし、またはデータ未蓄積）');
  } else {
    logger.info(`勝ちパターン ${winPatterns.length} 件、負けパターン ${failurePatterns.length} 件、知識ベース ${knowledge.length} 件を注入します`);
  }

  // Step 3: Claude Sonnet で企画を依頼
  logger.info('Claude Sonnet でコンテンツ企画を生成中...');

  const patternsText = winPatterns.length > 0
    ? JSON.stringify(winPatterns.map(p => ({
        platform: p.platform,
        hookVariant: p.hook_variant,
        lift: p.engagement_lift,
        notes: p.notes,
      })))
    : 'まだデータがありません（初期フェーズ）';

  const failureText = failurePatterns.length > 0
    ? JSON.stringify(failurePatterns.map(f => ({
        platform: f.platform,
        hookVariant: f.hook_variant,
        failureMode: f.failure_mode,
        avoidanceRule: f.avoidance_rule,
      })))
    : 'まだデータがありません';

  const knowledgeText = knowledge.length > 0
    ? knowledge.map(k => `[${k.category}|信頼度${(k.confidence * 100).toFixed(0)}%] ${k.statement}`).join('\n')
    : 'まだデータがありません';

  const systemPrompt = `あなたはSNSコンテンツ戦略の専門家です。
リサーチ結果を基に、各プラットフォーム向けのコンテンツ企画を作成してください。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【やるべきこと: 過去の勝ちパターン】
${patternsText}

【やってはいけないこと: 過去の負けパターンと回避ルール】
${failureText}

【蓄積された知識ベース（実験から得た確度付きインサイト）】
${knowledgeText}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

コンテンツ設計の哲学（必ず従うこと）:
1. 模倣欲望原則: コンテンツは商品・サービスを主語にしない。
   「欲しがっている人間の状態・感情・場面」を主語に設計する。
   読者が「この欲望は自分のものだ」と感じた瞬間に伝播が始まる。

2. A/Bテスト設計: 各プラットフォームで必ず以下の2軸をテストできるhookTypeを設計する:
   - "object_centric": 商品・サービス・機能を主語にしたフック
   - "desire_centric": 欲しがっている人間・状態・場面を主語にしたフック

各プラットフォームの特性:
- TikTok: 縦型15〜60秒動画、強いHOOKが重要、ハッシュタグ3〜5個
- Instagram: フィード1:1、リール9:16、キャプション2200字以内
- Twitter/X: 280字以内、画像は1〜4枚、スレッド形式も有効
- YouTube: 横型16:9、Shorts縦型9:16、サムネイルが重要

必ず以下のJSON形式のみで返してください（コードブロックに入れること）。
このJSON以外のフィールドは追加しないこと（abTestDesign, contentPillars, scriptDraft等は不要）:
{
  "contentPlan": [
    {
      "platform": "threads",
      "format": "テキスト投稿",
      "hookType": "desire_centric",
      "hookTypeReason": "なぜこのhookTypeを選んだか（1〜2文）",
      "structure": ["HOOK", "BODY", "TAIL"],
      "targetEmotion": "belonging",
      "keyMessage": "メインメッセージ（1文）",
      "priority": 1
    }
  ],
  "crossPlatformStrategy": "プラットフォーム間の連携戦略（1〜2文）",
  "postingSchedule": {
    "threads": "YYYY-MM-DDTHH:mm:ss+09:00"
  }
}`;

  const platforms = researchOutput.platforms
    ?? (researchOutput.competitorInsights
      ? [...new Set(researchOutput.competitorInsights.map(c => c.platform))]
      : []);

  const userMessage = `リサーチ結果:
${JSON.stringify(researchOutput, null, 2)}

このデータを基に、コンテンツ企画を作成してください。
対象プラットフォーム: ${platforms.length > 0 ? platforms.join(', ') : 'リサーチ結果から推測してください'}`;

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 5000,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userMessage },
    ],
  });

  const planningCost = (response.usage.input_tokens * 3.0 + response.usage.output_tokens * 15.0) / 1_000_000;

  // Step 4: extractJson + Zodバリデーション
  const rawText = response.content[0].text;
  try { writeJobFile(jobId, '02_planning-raw.txt', rawText); } catch (_) {}

  const parsed = extractJson(rawText);
  const result = validate(PlanningOutputSchema, parsed);

  // Step 5: ジョブファイルに書き込む
  await writeJobFile(jobId, '02_planning-output.json', {
    jobId,
    ...result,
    plannedAt: new Date().toISOString(),
  });

  logger.success(`企画立案完了 (推定コスト: $${planningCost.toFixed(5)})`);
  return { estimatedCost: planningCost };
}
