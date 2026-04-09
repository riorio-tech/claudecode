/**
 * ai-client.js — AIプロバイダー統一ラッパー
 *
 * .envの AI_PROVIDER=anthropic or openai で切り替え。
 * 呼び出し側は chat(messages, opts) だけ使えばOK。
 */
import { config } from '../config.js';

/**
 * @param {Array<{role: string, content: string}>} messages
 * @param {{ model?: 'fast'|'smart', maxTokens?: number }} opts
 * @returns {Promise<string>} テキスト応答
 */
export async function chat(messages, { model = 'fast', maxTokens = 2048 } = {}) {
  const provider = config.AI_PROVIDER;

  if (provider === 'openai') {
    return chatOpenAI(messages, { model, maxTokens });
  }
  return chatAnthropic(messages, { model, maxTokens });
}

async function chatAnthropic(messages, { model, maxTokens }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const modelId = model === 'smart' ? config.CLAUDE_MODEL : config.CLAUDE_HAIKU_MODEL;

  const msg = await client.messages.create({
    model: modelId,
    max_tokens: maxTokens,
    messages,
  });
  return msg.content[0].text;
}

async function chatOpenAI(messages, { model, maxTokens }) {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  const modelId = model === 'smart' ? config.OPENAI_MODEL : config.OPENAI_MINI_MODEL;

  const res = await client.chat.completions.create({
    model: modelId,
    max_tokens: maxTokens,
    messages,
  });
  return res.choices[0].message.content;
}

/** Web検索付きリサーチ（Anthropicのみ対応、OpenAIはフォールバック） */
export async function chatWithSearch(messages, { maxTokens = 2048 } = {}) {
  if (config.AI_PROVIDER === 'openai') {
    // OpenAIはweb_searchツール非対応のためフォールバック
    return { text: await chatOpenAI(messages, { model: 'fast', maxTokens }), searched: false };
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  try {
    const msg = await client.messages.create({
      model: config.CLAUDE_HAIKU_MODEL,
      max_tokens: maxTokens,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
      messages,
    });
    for (const block of msg.content) {
      if (block.type === 'text') return { text: block.text, searched: true };
    }
  } catch (e) {
    // フォールバック
  }
  return { text: null, searched: false };
}
