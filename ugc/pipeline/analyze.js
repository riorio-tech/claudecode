import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/**
 * Stage 1: Analyze product image with Claude vision.
 * @param {{ imagePath: string, title: string }} opts
 * @returns {Promise<{ productName: string, category: string, features: string[], appealPoints: string[], estimatedPrice: string }>}
 */
export async function analyze({ imagePath, title }) {
  const ext = extname(imagePath).toLowerCase();
  const mediaType = MIME[ext] ?? 'image/jpeg';

  let imageData;
  try {
    imageData = readFileSync(imagePath).toString('base64');
  } catch (err) {
    throw new Error(`analyze: cannot read image file "${imagePath}": ${err.message}`);
  }

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const msg = await client.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageData },
          },
          {
            type: 'text',
            text: `You are a product analyst for TikTok Shop Japan. Analyze this product image.
Product title hint: "${title}"

Return ONLY valid JSON (no markdown, no explanation):
{
  "productName": "string — Japanese product name",
  "category": "string — one of: daily/beauty/food/tech/fashion/other",
  "features": ["feature 1", "feature 2", "feature 3"],
  "appealPoints": ["appeal 1", "appeal 2"],
  "estimatedPrice": "string — e.g. '980円' or 'unknown'"
}`,
          },
        ],
      },
    ],
  });

  const raw = msg.content[0].text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`analyze: no JSON in Claude response:\n${raw.slice(0, 300)}`);
  return JSON.parse(match[0]);
}
