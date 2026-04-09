import Anthropic from '@anthropic-ai/sdk';
import { validate, ProductScoutOutputSchema } from '../../lib/validate-json.js';
import { logger } from '../../lib/logger.js';
import { insertProduct } from '../../db/db.js';
import { config } from '../../config.js';

const getClient = () => new Anthropic();

const SYSTEM_PROMPT = `あなたは TikTok Shop の商品スカウト専門AIです。
与えられたカテゴリと条件から、売れる可能性が高い商品候補を提案してください。

## 評価基準

1. **トレンド性** — TikTok で話題になりやすいか（視覚的インパクト・シェアしたくなるか）
2. **視覚的訴求力** — 動画映えするか（使用シーンが映えるか）
3. **競合密度** — まだ飽和していないカテゴリか
4. **購買衝動** — 衝動買いしやすい価格帯（500〜5,000円）・特性か
5. **CVR仮説** — なぜ売れるかを具体的に言語化できるか

## 出力形式

必ず以下の JSON のみを出力してください（説明不要）:

\`\`\`json
{
  "candidates": [
    {
      "title": "商品名（日本語）",
      "category": "daily | beauty | electronics | food | fashion",
      "price": 1980,
      "scoutReason": "選んだ理由（具体的に、なぜTikTokで売れるか）",
      "estimatedCvr": "0.7%"
    }
  ]
}
\`\`\``;

/**
 * 商品候補をスカウトする
 *
 * @param {{ category: string, limit: number, context: string, verbose: boolean }} params
 * @returns {object} candidates の配列
 */
export async function runProductScout({ category = 'daily', limit = 5, context = '', verbose = false }) {
  logger.info(`商品スカウト開始: カテゴリ=${category}, 件数=${limit}`);

  const userMessage = `以下の条件で商品候補を ${limit} 件提案してください。

カテゴリ: ${category}
${context ? `補足情報: ${context}` : ''}

TikTok で売れる可能性が高い商品を、具体的な商品名で提案してください。
実在するか架空かは問いません（架空の場合は典型的な商品名で）。`;

  const response = await getClient().messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  if (verbose) {
    logger.info(`[product-scout response]\n${text}`);
  }

  const parsed = extractJson(text);
  const output = validate(ProductScoutOutputSchema, parsed);

  // DBに保存
  for (const candidate of output.candidates) {
    insertProduct({
      title: candidate.title,
      category: candidate.category,
      price: candidate.price ?? null,
      scoutReason: candidate.scoutReason,
    });
  }

  logger.success(`商品候補 ${output.candidates.length} 件をDBに保存しました`);
  return output;
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
