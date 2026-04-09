import { writeFileSync } from 'node:fs';
import { getClient } from '../../lib/claude.ts';
import { logger } from '../../lib/logger.ts';
import { getJobPath } from '../../lib/job.ts';
import { config } from '../../../config.ts';
import type { ProductInfo } from '../00_ingest/schema.ts';
import type { RenderOutput } from '../03_render/schema.ts';
import { type QAResult, type Violation } from './schema.ts';

// 禁止表現リスト（compliance check）
// /絶対/ は保守的な広いマッチ（絶対的・絶対零度等も対象）。将来的に精緻化を検討。
const BANNED_PATTERNS = [
  /絶対/,
  /必ず治る/,
  /100%効果/,
  /No\.1(?!.*出典)/,
];

export async function runQA(
  productInfo: ProductInfo,
  renderOutput: RenderOutput,
  shotPlanTexts: string[]
): Promise<QAResult> {
  const { jobId } = productInfo;
  logger.info('qa: 開始', { jobId });

  const errors: Violation[] = [];
  const warnings: Violation[] = [];

  // 1. 動画尺チェック
  if (renderOutput.duration < config.MIN_DURATION) {
    errors.push({ code: 'DURATION_TOO_SHORT', message: `尺が短すぎます: ${renderOutput.duration.toFixed(1)}秒` });
  }
  if (renderOutput.duration > config.MAX_DURATION) {
    errors.push({ code: 'DURATION_TOO_LONG', message: `尺が長すぎます: ${renderOutput.duration.toFixed(1)}秒` });
  }

  // 2. コンプライアンスチェック（テキスト）
  for (const text of shotPlanTexts) {
    for (const pattern of BANNED_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        errors.push({ code: 'BANNED_EXPRESSION', message: `禁止表現が含まれています: "${match[0]}"（テキスト: "${text.slice(0, 50)}"）` });
      }
    }
  }

  // 3. Claude でキャプション生成
  let caption = '';
  let hashtags: string[] = [];

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: config.ANTHROPIC_MODEL,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `以下の商品のTikTok投稿用キャプションとハッシュタグを生成してください。

商品名: ${productInfo.title}
価格: ${productInfo.price}円
カテゴリ: ${productInfo.category}
特徴: ${productInfo.features.join('、')}

以下のJSON形式で返してください:
{
  "caption": "キャプション文（100文字以内）",
  "hashtags": ["#ハッシュタグ1", "#ハッシュタグ2", "#ハッシュタグ3", "#ハッシュタグ4", "#ハッシュタグ5"]
}
JSONのみ返すこと。`,
        },
      ],
    });

    // Safe response parsing (same pattern as ingest/plan agents)
    const firstContent = response.content[0];
    if (!firstContent || firstContent.type !== 'text') {
      throw new Error(`qa: Claude が予期しないレスポンスを返しました (stop_reason: ${response.stop_reason})`);
    }
    const rawText = firstContent.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    if (rawText) {
      const parsed = JSON.parse(rawText) as { caption: string; hashtags: string[] };
      caption = parsed.caption ?? '';
      hashtags = parsed.hashtags ?? [];
    }
  } catch (e) {
    warnings.push({ code: 'CAPTION_GENERATION_FAILED', message: `キャプション生成に失敗しました: ${String(e)}` });
  }

  const result: QAResult = {
    jobId,
    passed: errors.length === 0,
    errors,
    warnings,
    caption,
    hashtags,
  };

  writeFileSync(getJobPath(jobId, 'qa-result.json'), JSON.stringify(result, null, 2));
  writeFileSync(getJobPath(jobId, 'caption.txt'), `${caption}\n\n${hashtags.join(' ')}`);

  // エスカレーション
  if (!result.passed) {
    logger.error('qa: エラーが検出されました。処理を停止します。', { errors: result.errors });
    throw new Error(`QAエラー: ${result.errors.map(e => e.message).join(', ')}`);
  }

  logger.info('qa: 完了', { jobId, warnings: result.warnings.length });
  return result;
}
