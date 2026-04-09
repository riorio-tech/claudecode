import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { extractJson, validate } from '../../lib/validate-json.js';
import { readJobFile, writeJobFile } from '../../lib/job-dir.js';

const ContentItemSchema = z.object({
  platform: z.string(),
  script: z.string().nullish(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  overlayTexts: z.array(z.string()).optional().default([]),
  desireSubjectUsed: z.string().nullish(),
});

// プラットフォームごとの文字数制限
const CHAR_LIMITS = {
  twitter: 280,
  x: 280,
  instagram: 2200,
  tiktok: 2200,
  youtube: 5000,
};

const SYSTEM_PROMPT_WRITER = `あなたはSNSコンテンツライターです。各プラットフォームの特性に合わせた
高品質なコンテンツを生成してください。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【執筆の哲学: 模倣欲望原則（必ず従うこと）】

人は「商品」を欲しがるのではなく、「欲しがっている人間」を模倣して欲しがる。
（ルネ・ジラール『欲望の現象学』）

コンテンツ執筆の鉄則:
1. 商品・サービス・機能を主語にしない
2. 「欲しがっている人間の状態・感情・場面」を冒頭に描写する
3. 読者が「これは自分の話だ」と感じた瞬間にのみ伝播が始まる
4. CTAは欲望が高まった後に初めて置く

悪い例（商品主語）: 「この商品は〇〇の効果があります」
良い例（欲望主語）: 「毎朝鏡を見るたびにため息をついていた私が...」

hookTypeが 'desire_centric' の場合は特にこの原則を強く適用すること。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

プラットフォームごとの制約:
- Twitter/X: 本文280文字以内、ハッシュタグは本文に含める
- TikTok: キャプション2200文字以内、スクリプトは15〜60秒分
- Instagram: キャプション2200文字以内
- YouTube: タイトル100文字以内、説明文5000文字以内

禁止事項（薬機法・景品表示法対応）:
- 「効果がある」「治る」「必ず痩せる」等の断定表現は禁止
- 「No.1」「最高」等の根拠のない最上級表現は禁止
- 価格の不明確な表示は禁止

必ず以下のJSON形式で返してください（コードブロックに入れること。文字列内の改行は \\n でエスケープすること）:
{
  "platform": "プラットフォーム名",
  "script": null,
  "caption": "投稿キャプション・本文（改行は\\nで表現）",
  "hashtags": ["ハッシュタグ1", "ハッシュタグ2"],
  "overlayTexts": [],
  "desireSubjectUsed": "冒頭で使った欲望主語の人物描写（1文）"
}`;

/**
 * Step A: Claude Sonnet でコンテンツを生成する。
 * @param {Anthropic} client
 * @param {object} plan - contentPlan の1エントリ
 * @param {object} research - 01_research-output.json
 * @returns {Promise<object>}
 */
async function generateContent(client, plan, research) {
  const trendKeywords = research.trendKeywords?.join(', ') || '';
  const painPoints = research.audienceInsights?.painPoints?.join(', ') || '';

  // desireChain情報を取得して渡す
  const desireChain = research.desireChain;
  const desireContext = desireChain
    ? `\n欲望連鎖分析（模倣欲望理論）:\n- 欲しがっている対象: ${desireChain.desireObject}\n- 欲しがっている人物像: ${desireChain.desireSubject}\n- 感情の種類: ${desireChain.triggerEmotion}\n- 伝播パターン: ${desireChain.spreadPattern}`
    : '';

  const userMessage = `以下の企画に基づいてコンテンツを作成してください:
プラットフォーム: ${plan.platform}
フォーマット: ${plan.format}
フック種類: ${plan.hookType}
構成: ${plan.structure.join(' → ')}
ターゲット感情: ${plan.targetEmotion}
キーメッセージ: ${plan.keyMessage}

リサーチで判明したトレンドワード: ${trendKeywords}
ターゲットの悩み: ${painPoints}${desireContext}`;

  const response = await client.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT_WRITER,
    messages: [
      { role: 'user', content: userMessage },
    ],
  });

  const rawText = response.content[0].text;
  const parsed = extractJson(rawText);
  return { content: validate(ContentItemSchema, parsed), usage: response.usage };
}

/**
 * Step B: Claude Haiku でハッシュタグを最適化する。
 * @param {Anthropic} client
 * @param {string} platform
 * @param {string} caption
 * @param {string[]} hashtags
 * @returns {Promise<string[]>}
 */
async function optimizeHashtags(client, platform, caption, hashtags) {
  const userMessage = `以下のコンテンツに最適なハッシュタグを10個生成してください。
プラットフォーム: ${platform}
コンテンツ: ${caption}
既存ハッシュタグ: ${hashtags.join(', ')}
JSON配列で返してください: ["#tag1", "#tag2", ...]`;

  const response = await client.messages.create({
    model: config.CLAUDE_HAIKU_MODEL,
    max_tokens: 500,
    messages: [
      { role: 'user', content: userMessage },
    ],
  });

  const rawText = response.content[0].text;
  const parsed = extractJson(rawText);
  const result = z.array(z.string()).parse(parsed);
  return { hashtags: result.slice(0, 10), usage: response.usage };
}

/**
 * 企画を受けて各プラットフォーム向けテキストコンテンツを生成する。
 * @param {string} jobId
 * @returns {Promise<void>}
 */
export async function runWriter(jobId) {
  logger.step(3, 'コンテンツ執筆');

  // Step 1: 企画を読み込む
  logger.info('02_planning-output.json を読み込み中...');
  const planningOutput = readJobFile(jobId, '02_planning-output.json');
  const { contentPlan } = planningOutput;

  // リサーチ結果も読み込む（トレンドワード・オーディエンス情報のため）
  let research = {};
  try {
    research = readJobFile(jobId, '01_research-output.json');
  } catch {
    logger.warn('01_research-output.json が見つかりません。リサーチ情報なしで続行します');
  }

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const contents = [];
  let totalCost = 0;

  // Step 2: 各 contentPlan エントリを逐次処理
  for (let i = 0; i < contentPlan.length; i++) {
    const plan = contentPlan[i];
    logger.info(`[${i + 1}/${contentPlan.length}] ${plan.platform} のコンテンツを生成中...`);

    // Step A: メインコンテンツ生成（Claude Sonnet）
    const { content, usage: usageA } = await generateContent(client, plan, research);
    totalCost += (usageA.input_tokens * 3.0 + usageA.output_tokens * 15.0) / 1_000_000;
    logger.info(`  Step A 完了: キャプション ${content.caption.length} 文字`);

    // 文字数チェック（超過しても throw しない）
    const limit = CHAR_LIMITS[content.platform.toLowerCase()];
    if (limit && content.caption.length > limit) {
      logger.warn(`${content.platform} キャプションが文字数制限超過: ${content.caption.length}/${limit}`);
    }

    // Step B: ハッシュタグ最適化（Claude Haiku）
    logger.info(`  Step B: ハッシュタグを最適化中...`);
    const { hashtags: optimizedHashtags, usage: usageB } = await optimizeHashtags(
      client,
      content.platform,
      content.caption,
      content.hashtags,
    );
    totalCost += (usageB.input_tokens * 0.80 + usageB.output_tokens * 4.0) / 1_000_000;
    content.hashtags = optimizedHashtags;
    logger.info(`  Step B 完了: ハッシュタグ ${optimizedHashtags.length} 個`);

    contents.push(content);
  }

  // Step 3: 出力を保存
  writeJobFile(jobId, '03_writer-output.json', {
    jobId,
    contents,
    writtenAt: new Date().toISOString(),
  });

  logger.success(`コンテンツ執筆完了: ${contents.length} プラットフォーム分 (推定コスト: $${totalCost.toFixed(5)})`);
  return { estimatedCost: totalCost };
}
