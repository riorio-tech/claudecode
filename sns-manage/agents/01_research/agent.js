import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { extractJson } from '../../lib/validate-json.js';
import { validate } from '../../lib/validate-json.js';
import { writeJobFile } from '../../lib/job-dir.js';
import { getCachedResearch, setCachedResearch, upsertDesireMap, upsertAudienceFingerprint } from '../../db/db.js';

const ResearchOutputSchema = z.object({
  trendKeywords: z.array(z.string()),
  competitorInsights: z.array(z.object({
    platform: z.string(),
    hookPattern: z.string(),
    avgEngagement: z.number(),
  })),
  audienceInsights: z.object({
    painPoints: z.array(z.string()),
    desiredOutcome: z.string(),
    peakHours: z.record(z.string()),
  }),
  recommendedAngles: z.array(z.string()),
  desireChain: z.object({
    desireObject: z.string(),
    desireSubject: z.string(),
    mediatorType: z.enum(['influencer', 'community', 'trend', 'event']),
    triggerEmotion: z.enum(['aspiration', 'envy', 'fear', 'excitement', 'belonging']),
    spreadPattern: z.enum(['vertical', 'horizontal']),
    examples: z.array(z.string()).optional().default([]),
  }).optional(),
});

const SYSTEM_PROMPT = `あなたはSNSマーケティングのリサーチ専門家です。
与えられたトピック・ターゲット・プラットフォームに基づいて、
SNS投稿コンテンツ制作のためのリサーチ結果をJSONで返してください。

必ず以下のJSON形式で返してください（コードブロックに入れること）:
{
  "trendKeywords": ["キーワード1", "キーワード2", ...],
  "competitorInsights": [
    { "platform": "tiktok", "hookPattern": "before/after型", "avgEngagement": 0.05 }
  ],
  "audienceInsights": {
    "painPoints": ["悩み1", "悩み2"],
    "desiredOutcome": "達成したいこと",
    "peakHours": { "tiktok": "19:00-22:00", "instagram": "12:00-13:00" }
  },
  "recommendedAngles": ["訴求角度1", "訴求角度2", "訴求角度3"],
  "desireChain": {
    "desireObject": "欲しがっている対象（商品・状態・体験を具体的に）",
    "desireSubject": "欲しがっている人の描写（例：'月収100万を達成した同世代を見て焦っている25-35歳男性'）",
    "mediatorType": "influencer|community|trend|event",
    "triggerEmotion": "aspiration|envy|fear|excitement|belonging",
    "spreadPattern": "vertical|horizontal",
    "examples": ["参考アカウントや投稿の特徴1", "特徴2"]
  }
}

desireChainについて（重要）:
- ルネ・ジラールの模倣欲望理論に基づく分析
- 人は「商品」を欲しがるのではなく「欲しがっている人間」を模倣して欲しがる
- desireSubjectは具体的な人物像として描写すること（例：「最近昇進した同僚が使っている...を見て..」）
- triggerEmotionは伝播の起点となっている感情を選ぶ`;

/**
 * トレンド・競合・オーディエンスリサーチを行い、後続エージェントの情報基盤を作る。
 * @param {string} jobId
 * @param {{ topic: string, platforms: string[], targetAudience: string, category: string }} params
 * @returns {Promise<void>}
 */
export async function runResearch(jobId, { topic, platforms, targetAudience, category }) {
  logger.step(1, 'リサーチ');

  const cacheKey = `${topic}-${platforms.join(',')}`;

  // キャッシュ確認
  const cached = await getCachedResearch(cacheKey);
  let result;
  let apiUsage = null;

  if (cached) {
    logger.info(`キャッシュヒット: ${cacheKey}`);
    result = cached;
  } else {
    logger.info('Claude Sonnet でリサーチ中...');

    const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

    const userMessage = `トピック: ${topic}
ターゲット: ${targetAudience}
プラットフォーム: ${platforms.join(', ')}
カテゴリ: ${category}

上記の条件でSNSコンテンツのリサーチを行い、JSONで返してください。`;

    const response = await client.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: userMessage },
      ],
    });

    apiUsage = response.usage;
    const rawText = response.content[0].text;
    const parsed = extractJson(rawText);
    result = validate(ResearchOutputSchema, parsed);

    await setCachedResearch(cacheKey, result, 24);
  }

  // 欲望地図とオーディエンス指紋をDBに蓄積（永続資産として）
  if (result.desireChain) {
    for (const platform of platforms) {
      await upsertDesireMap({
        topic,
        platform,
        mediatorType: result.desireChain.mediatorType,
        triggerEmotion: result.desireChain.triggerEmotion,
        spreadPattern: result.desireChain.spreadPattern,
        desireObject: result.desireChain.desireObject,
        desireSubject: result.desireChain.desireSubject,
        examples: result.desireChain.examples,
        cacheKey: `${topic}-${platform}`,
      });
    }
    logger.info(`[01_research] 欲望地図を蓄積: emotion=${result.desireChain.triggerEmotion}, pattern=${result.desireChain.spreadPattern}`);
  }

  // オーディエンス指紋を蓄積
  if (result.audienceInsights?.painPoints?.length) {
    for (const platform of platforms) {
      for (const pain of result.audienceInsights.painPoints.slice(0, 3)) {
        await upsertAudienceFingerprint({
          platform,
          category,
          characteristic: pain,
          exampleContent: result.recommendedAngles?.[0] || null,
        });
      }
    }
    logger.info('[01_research] オーディエンス指紋を蓄積');
  }

  await writeJobFile(jobId, '01_research-output.json', {
    jobId,
    ...result,
    researchedAt: new Date().toISOString(),
  });

  const estimatedCost = apiUsage
    ? (apiUsage.input_tokens * 3.0 + apiUsage.output_tokens * 15.0) / 1_000_000
    : 0;
  logger.success(`リサーチ完了 (推定コスト: $${estimatedCost.toFixed(5)})`);
  return { estimatedCost };
}
