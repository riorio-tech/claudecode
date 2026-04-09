import { writeFileSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { validate, PublishPrepOutputSchema } from '../../lib/validate-json.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config.js';

const getClient = () => new Anthropic();

const SYSTEM_PROMPT = `あなたは TikTok Shop のコピーライターです。
商品情報と動画の台本サマリーから、最適なキャプションとハッシュタグを生成してください。

## ルール

- キャプション: 最大150文字（日本語）。購買意欲を高める一文＋CTA
- ハッシュタグ: 5〜8個。カテゴリ系・商品特性系・TikTokShop系を混ぜる
- thumbnailHint: サムネイルとして最も映えるカット（HOOKカットまたはPROOFカット）

## 出力形式

JSON のみを出力してください（説明不要）:

\`\`\`json
{
  "caption": "キャプション（最大150文字）",
  "hashtags": ["#TikTokShop", "#商品名", ...],
  "thumbnailHint": "HOOKカット（videoIndex 0）推奨"
}
\`\`\``;

/**
 * キャプション・ハッシュタグを生成する
 *
 * @param {{ jobId: string, jobDir: string, analyzeOutput: object, shotPlan: object, verbose: boolean }} params
 * @returns {object} PublishPrepOutputSchema 準拠の出力
 */
export async function runPublishPrep({ jobId, jobDir, analyzeOutput, shotPlan, verbose }) {
  const product = analyzeOutput.normalizedProduct;
  const summary = shotPlan.productSummary;

  // 代表的な hook テキストを参考情報として渡す
  const hookExamples = shotPlan.videos.slice(0, 3).map(v =>
    `[${v.hookVariant}] ${v.shots[0]?.overlayText ?? ''}`
  ).join('\n');

  const userMessage = `以下の商品情報からキャプションとハッシュタグを生成してください。

## 商品情報
タイトル: ${product.title}
カテゴリ: ${product.category}
${product.price ? `価格: ¥${product.price.toLocaleString()}` : ''}

## 訴求サマリー
ターゲット: ${summary.target}
悩み: ${summary.pain}
解決: ${summary.solution}

## HOOKバリエーション例（参考）
${hookExamples}

jobId: ${jobId}`;

  const response = await getClient().messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  if (verbose) {
    logger.info(`[publish-prep response]\n${text}`);
  }

  const parsed = extractJson(text);
  parsed.jobId = jobId;
  parsed.charCount = parsed.caption?.length ?? 0;

  if (parsed.caption && parsed.caption.length > 150) {
    logger.warn(`キャプションが 150 字超 (${parsed.caption.length} 字)。切り詰めます。`);
    parsed.caption = parsed.caption.slice(0, 147) + '...';
    parsed.charCount = parsed.caption.length;
  }

  const output = validate(PublishPrepOutputSchema, parsed);
  const outputPath = join(jobDir, '07_publish-prep-output.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  logger.success(`07_publish-prep-output.json → ${outputPath}`);
  return output;
}

function extractJson(text) {
  const codeBlockRe = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  const matches = [...text.matchAll(codeBlockRe)];
  if (matches.length > 0) return JSON.parse(matches[matches.length - 1][1]);
  const lastBrace = text.lastIndexOf('{');
  if (lastBrace !== -1) {
    const sub = text.slice(lastBrace);
    const lastClose = sub.lastIndexOf('}');
    if (lastClose !== -1) return JSON.parse(sub.slice(0, lastClose + 1));
  }
  throw new Error('JSON ブロックが見つかりません');
}
