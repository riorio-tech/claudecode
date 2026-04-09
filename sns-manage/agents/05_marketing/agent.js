import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { extractJson, validate } from '../../lib/validate-json.js';
import { readJobFile, writeJobFile } from '../../lib/job-dir.js';
import { insertContent, upsertKnowledgeBase } from '../../db/db.js';

const FinalizedContentSchema = z.object({
  platform: z.string(),
  variantId: z.enum(['A', 'B', 'C']),
  hookType: z.enum(['object_centric', 'desire_centric', 'other']).optional().default('other'),
  desireSubjectUsed: z.string().nullish(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  script: z.string().nullish(),
  cta: z.string().nullish(),
  estimatedEngagementRate: z.number().nullish(),
});

const MarketingOutputSchema = z.object({
  finalizedContents: z.array(FinalizedContentSchema),
  publishOrder: z.array(z.string()),
  estimatedReach: z.number().optional(),
});

const SYSTEM_PROMPT_MARKETING = `あなたはSNSマーケティング戦略の専門家です。
コンテンツのA/Bテスト用バリアントを作成し、最適な配信戦略を設計してください。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【A/Bテストの必須設計原則: 模倣欲望理論の検証】

このシステムは「欲望主語（desire_centric）vs 商品主語（object_centric）」のどちらが
各プラットフォーム・カテゴリで勝つかを継続的に学習し続けます。

必ずVariant Aに元コンテンツ（企画のhookTypeに従う）、
Variant Bに逆のhookTypeを採用してください:
- 企画が desire_centric → A=desire_centric, B=object_centric
- 企画が object_centric → A=object_centric, B=desire_centric

欲望主語（desire_centric）の書き方:
「[欲しがっている人物の状態・場面]が[変化する]と[どうなるか]」
例: 「毎朝準備に30分かけていた私が、この習慣を変えてから...」

商品主語（object_centric）の書き方:
「[商品/サービス名]は[機能/特徴]によって[ベネフィット]を実現します」
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

その他のA/Bテスト原則:
- 1要素だけを変える（hookType以外は同じキーメッセージ）
- CTAの位置・強さはバリアント間で同じにする

必ず以下のJSON形式で返してください（コードブロックに入れること。文字列内の改行は \\n でエスケープすること）:
{
  "finalizedContents": [
    {
      "platform": "tiktok",
      "variantId": "A",
      "hookType": "desire_centric",
      "desireSubjectUsed": "毎朝鏡を見るたびにため息をついていた27歳の会社員",
      "caption": "バリアントAのキャプション（desire_centric: 欲望主語）",
      "hashtags": ["#tag1"],
      "script": "スクリプト（あれば）",
      "cta": "CTAテキスト",
      "estimatedEngagementRate": 0.05
    },
    {
      "platform": "tiktok",
      "variantId": "B",
      "hookType": "object_centric",
      "desireSubjectUsed": null,
      "caption": "バリアントBのキャプション（object_centric: 商品主語）",
      "hashtags": ["#tag1"],
      "script": "スクリプト（あれば）",
      "cta": "CTAテキスト",
      "estimatedEngagementRate": 0.04
    }
  ],
  "publishOrder": ["tiktok", "instagram", "twitter"],
  "estimatedReach": 5000
}`;

/**
 * ライター出力にマーケティング戦略レイヤーを追加し、A/Bバリアントを生成する。
 * @param {string} jobId
 * @returns {Promise<void>}
 */
export async function runMarketing(jobId) {
  logger.step(5, 'マーケティング最終化');

  // Step 1: ライター出力と企画を読み込む
  logger.info('03_writer-output.json を読み込み中...');
  const writerOutput = readJobFile(jobId, '03_writer-output.json');

  logger.info('02_planning-output.json を読み込み中...');
  const planningOutput = readJobFile(jobId, '02_planning-output.json');

  const userMessage = `以下のコンテンツをA/Bバリアント化してマーケティング最終化してください:

【生成コンテンツ】
${JSON.stringify(writerOutput.contents, null, 2)}

【コンテンツ企画の背景】
クロスプラットフォーム戦略: ${planningOutput.crossPlatformStrategy || ''}
contentPlan: ${JSON.stringify(planningOutput.contentPlan?.map(p => ({ platform: p.platform, hookType: p.hookType, keyMessage: p.keyMessage })), null, 2)}

配信順序の優先度（プラットフォーム特性を考慮して決定してください）:
- TikTok: 拡散力が高い、アルゴリズムによる新規リーチが期待できる
- Instagram: フォロワー基盤が強い、リールは発見タブに載りやすい
- Twitter/X: 即時性が高い、拡散速度が速い
- YouTube: 長期的な検索流入が期待できる`;

  // Step 2: Claude Sonnet でA/Bバリアント生成
  logger.info('A/Bバリアントを生成中...');
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: config.CLAUDE_HAIKU_MODEL,
    max_tokens: 6000,
    system: SYSTEM_PROMPT_MARKETING,
    messages: [
      { role: 'user', content: userMessage },
    ],
  });

  // Step 3: JSONを抽出・バリデーション
  const rawText = response.content[0].text;
  const parsed = extractJson(rawText);
  const result = validate(MarketingOutputSchema, parsed);

  logger.info(`バリアント生成完了: ${result.finalizedContents.length} 件`);

  // Step 4: 各コンテンツをDBに保存
  for (const content of result.finalizedContents) {
    const insertedId = await insertContent({
      jobId,
      platform: content.platform,
      variantId: content.variantId,
      type: 'caption',
      body: content.caption,
      metadata: {
        hashtags: content.hashtags,
        cta: content.cta,
        script: content.script,
        estimatedEngagementRate: content.estimatedEngagementRate,
        hookType: content.hookType,
        desireSubjectUsed: content.desireSubjectUsed,
      },
    });
    if (insertedId) {
      logger.info(`  DB保存: ${content.platform} バリアント${content.variantId} (id=${insertedId})`);
    }
  }

  // Step 5: 結果をファイルに書き出す
  writeJobFile(jobId, '05_marketing-output.json', {
    jobId,
    ...result,
    marketedAt: new Date().toISOString(),
  });

  // 知識ベース: hookTypeの分布を記録（どのプラットフォームで何のhookTypeを試したか）
  const hookTypeCounts = {};
  for (const content of result.finalizedContents) {
    const key = `${content.platform}_${content.hookType || 'unknown'}`;
    hookTypeCounts[key] = (hookTypeCounts[key] || 0) + 1;
  }
  for (const [key, count] of Object.entries(hookTypeCounts)) {
    const [platform, hookType] = key.split('_', 2);
    if (hookType && hookType !== 'unknown') {
      await upsertKnowledgeBase({
        insightKey: `experiment_${platform}_${hookType}_planned`,
        category: 'hook',
        platform,
        statement: `${platform}で${hookType === 'desire_centric' ? '欲望主語' : '商品主語'}フックをA/Bテスト用に生成（累積実験回数が上昇中）`,
      });
    }
  }

  const marketingCost = (response.usage.input_tokens * 0.80 + response.usage.output_tokens * 4.0) / 1_000_000;
  logger.success(`マーケティング最終化完了: ${result.finalizedContents.length} バリアント、配信順: ${result.publishOrder.join(' → ')} (推定コスト: $${marketingCost.toFixed(5)})`);
  return { estimatedCost: marketingCost };
}
