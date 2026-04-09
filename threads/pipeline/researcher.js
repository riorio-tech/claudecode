import { chat, chatWithSearch } from '../lib/ai-client.js';
import { writeJson } from '../lib/job-dir.js';
import { logger } from '../lib/logger.js';

export async function researcher(jobDir, theme) {
  logger.stage(2, 'リサーチ');

  const query = `${theme.theme} AI事業 ${theme.keywords?.join(' ')}`;
  logger.info(`検索クエリ: ${query}`);

  const researchPrompt = `以下のテーマに関して、Threads投稿用のリサーチをしてください。

## テーマ
${theme.theme}

## 調べてほしいこと
1. このテーマに関する具体的な事実・数字・最新動向
2. AI事業責任者・起業家・Claude Code実践者が実際に体験していること
3. 多くの人が見落としているポイント・よくある誤解
4. スクロールが止まるような、刺さる切り口・フレーズ

以下のJSON形式のみで返してください。

{
  "keyFacts": ["具体的な事実・数字を3つ"],
  "useCases": ["実際の体験談・事例を3つ"],
  "beginnerPains": ["よくある誤解・見落としポイントを2つ"],
  "hookIdeas": ["冒頭で使えそうな尖ったフレーズを3つ"]
}`;

  let result = null;

  // Web検索付きリサーチ（Anthropicのみ）
  const { text, searched } = await chatWithSearch(
    [{ role: 'user', content: researchPrompt }],
    { maxTokens: 2048 }
  );
  if (text) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { result = JSON.parse(match[0]); } catch { /* 次へ */ }
    }
  }
  if (!searched) logger.warn('Web検索なし。AI知識ベースのみでリサーチ');

  // フォールバック
  if (!result) {
    const fallback = await chat(
      [{ role: 'user', content: `テーマ「${theme.theme}」について、AI事業・Claude Code・SNS発信をテーマにしたThreads投稿のリサーチを行い、以下のJSON形式のみで返してください。\n\n{"keyFacts":["具体的な事実・数字を3つ"],"useCases":["実際の体験談・事例を3つ"],"beginnerPains":["よくある誤解・見落としポイントを2つ"],"hookIdeas":["冒頭で使えそうな尖ったフレーズを3つ"]}` }],
      { model: 'fast', maxTokens: 1024 }
    );
    result = JSON.parse(fallback.match(/\{[\s\S]*\}/)[0]);
  }

  writeJson(jobDir, '02_research.json', result);
  logger.success('リサーチ完了');
  return result;
}
