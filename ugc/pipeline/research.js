import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

/**
 * Stage 2: Use Claude's knowledge of viral TikTok UGC patterns.
 * @param {{ analysis: { productName: string, category: string, features: string[], appealPoints: string[] } }} opts
 * @returns {Promise<{ hookPatterns: string[], benefitPhrases: string[], ctaExamples: string[] }>}
 */
export async function research({ analysis }) {
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const msg = await client.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `You are a TikTok UGC script strategist specializing in Japanese viral product videos.

Product: ${JSON.stringify(analysis, null, 2)}

Based on your knowledge of high-performing Japanese TikTok UGC product review videos, generate research for this product category ("${analysis.category}").

Return ONLY valid JSON (no markdown):
{
  "hookPatterns": [
    "具体的なフックパターン1（実際のセリフ例）",
    "具体的なフックパターン2（実際のセリフ例）",
    "具体的なフックパターン3（実際のセリフ例）"
  ],
  "benefitPhrases": [
    "ベネフィット訴求フレーズ1",
    "ベネフィット訴求フレーズ2",
    "ベネフィット訴求フレーズ3",
    "ベネフィット訴求フレーズ4"
  ],
  "ctaExamples": [
    "CTA例1",
    "CTA例2",
    "CTA例3"
  ]
}`,
      },
    ],
  });

  const raw = msg.content[0].text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`research: no JSON in Claude response:\n${raw.slice(0, 300)}`);
  return JSON.parse(match[0]);
}
