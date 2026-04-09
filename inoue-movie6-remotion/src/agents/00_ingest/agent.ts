import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { getClient } from '../../lib/claude.ts';
import { logger } from '../../lib/logger.ts';
import { getJobPath } from '../../lib/job.ts';
import { config } from '../../../config.ts';
import { ProductInfoSchema, type ProductInfo } from './schema.ts';

const require = createRequire(import.meta.url);

// Claude API の画像上限: 5MB (base64換算で約3.75MB のバイナリ)
const MAX_IMAGE_BYTES = 3_750_000;

async function prepareImageData(imagePath: string): Promise<{ base64: string; mediaType: 'image/jpeg' | 'image/png' }> {
  const sharp = require('sharp') as typeof import('sharp');
  const raw = readFileSync(imagePath);

  if (raw.byteLength <= MAX_IMAGE_BYTES) {
    const mediaType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return { base64: raw.toString('base64'), mediaType };
  }

  // 5MB超の場合は JPEG にリサイズして縮小
  const resized = await sharp(raw)
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  logger.info('ingest: 画像をリサイズしました', { original: raw.byteLength, resized: resized.byteLength });
  return { base64: resized.toString('base64'), mediaType: 'image/jpeg' };
}

export async function runIngest(
  jobId: string,
  imagePath: string
): Promise<ProductInfo> {
  logger.info('ingest: 開始', { jobId, imagePath });

  const { base64, mediaType } = await prepareImageData(imagePath);

  const client = getClient();
  const response = await client.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: `この商品画像を分析して、以下のJSON形式で返してください。日本語で答えること。
{
  "title": "商品名（画像から推定）",
  "price": 0,
  "features": ["特徴1", "特徴2", "特徴3"],
  "category": "カテゴリ名"
}
JSONのみを返してください。説明は不要です。`,
          },
        ],
      },
    ],
  });

  const firstContent = response.content[0];
  if (!firstContent || firstContent.type !== 'text') {
    throw new Error(`ingest: Claude が予期しないレスポンスを返しました (stop_reason: ${response.stop_reason})`);
  }
  const rawText = firstContent.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  if (!rawText) {
    throw new Error('ingest: Claude のレスポンスが空です');
  }
  let parsed: { title: string; price: number; features: string[]; category: string };
  try {
    parsed = JSON.parse(rawText) as typeof parsed;
  } catch (e) {
    throw new Error(`ingest: JSONパースに失敗しました: ${String(e)}\nレスポンス: ${rawText.slice(0, 200)}`);
  }

  const productInfo: ProductInfo = ProductInfoSchema.parse({
    jobId,
    title: parsed.title,
    price: parsed.price,
    features: parsed.features,
    category: parsed.category,
    imagePath,
  });

  const outPath = getJobPath(jobId, 'product-info.json');
  writeFileSync(outPath, JSON.stringify(productInfo, null, 2));

  logger.info('ingest: 完了', { jobId, title: productInfo.title });
  return productInfo;
}
