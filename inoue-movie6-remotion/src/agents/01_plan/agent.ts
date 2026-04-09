import { writeFileSync } from 'node:fs';
import { getClient } from '../../lib/claude.ts';
import { logger } from '../../lib/logger.ts';
import { getJobPath } from '../../lib/job.ts';
import { config } from '../../../config.ts';
import type { ProductInfo } from '../00_ingest/schema.ts';
import { ShotPlanSchema, type ShotPlan } from './schema.ts';

export async function runPlan(productInfo: ProductInfo): Promise<ShotPlan> {
  const { jobId } = productInfo;
  logger.info('plan: 開始', { jobId });

  const client = getClient();
  const response = await client.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `TikTok Shop向けの商品紹介動画のショット構成を20カットで考えてください。

商品情報:
- 商品名: ${productInfo.title}
- 価格: ${productInfo.price}円
- 特徴: ${productInfo.features.join('、')}
- カテゴリ: ${productInfo.category}

以下のJSON形式で返してください。totalDurationは20〜25秒にすること。
{
  "totalDuration": 22,
  "cuts": [
    {
      "index": 0,
      "duration": 1.1,
      "visual": "画面に表示するビジュアルの説明",
      "text": "テキストオーバーレイ（短く・インパクトがあること）",
      "animation": "none"
    }
    // ... 20カット分
  ]
}
animationは "none" | "zoom-in" | "fade" のいずれか。JSONのみ返すこと。`,
      },
    ],
  });

  const firstContent = response.content[0];
  if (!firstContent || firstContent.type !== 'text') {
    throw new Error(`plan: Claude が予期しないレスポンスを返しました (stop_reason: ${response.stop_reason})`);
  }
  const rawText = firstContent.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  if (!rawText) {
    throw new Error('plan: Claude のレスポンスが空です');
  }
  let raw: { totalDuration: number; cuts: unknown[] };
  try {
    raw = JSON.parse(rawText) as typeof raw;
  } catch (e) {
    throw new Error(`plan: JSONパースに失敗しました: ${String(e)}\nレスポンス: ${rawText.slice(0, 200)}`);
  }

  const shotPlan: ShotPlan = ShotPlanSchema.parse({
    jobId,
    totalDuration: raw.totalDuration,
    cuts: raw.cuts,
  });

  const outPath = getJobPath(jobId, 'shot-plan.json');
  writeFileSync(outPath, JSON.stringify(shotPlan, null, 2));

  logger.info('plan: 完了', { jobId, totalDuration: shotPlan.totalDuration });
  return shotPlan;
}
