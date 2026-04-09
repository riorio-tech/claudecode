/**
 * format-research.js — AIエージェント（Claude使用・コストあり）
 *
 * 役割: ThreadsAPIで実アカウントの投稿エンゲージメントデータを取得し、
 *       高いいね・返信数の投稿構造を分析してformats.jsonを生成する。
 *
 * Threads API制約:
 *   - キーワード検索API: 非対応
 *   - 他ユーザーの投稿: 原則取得不可（自分のアカウントのみ）
 *   - ※ REFERENCE_USER_IDS に対象アカウントIDを設定すれば取得を試みる
 *
 * 実行: make RESEARCH_FORMATS
 */
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const FORMATS_PATH = path.resolve('memory/formats.json');
const BASE_URL = 'https://graph.threads.net/v1.0';
const TOKEN = process.env.THREADS_ACCESS_TOKEN?.trim();
const FIELDS = 'id,text,like_count,replies_count,timestamp';

// 分析対象のアカウントIDリスト
// 追加方法: REFERENCE_USER_IDS=id1,id2,id3 を .env に設定
// または make RESEARCH_FORMATS ACCOUNTS="id1 id2" で渡す
function getReferenceUserIds() {
  const fromEnv = process.env.REFERENCE_USER_IDS?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  const ownId = process.env.THREADS_USER_ID?.trim();
  return [...new Set([ownId, ...fromEnv].filter(Boolean))];
}

async function fetchUserThreads(userId) {
  const url = `${BASE_URL}/${userId}/threads?fields=${FIELDS}&limit=100&access_token=${TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    logger.warn(`ユーザー ${userId} の取得失敗: ${data.error.message}`);
    return [];
  }
  return data.data ?? [];
}

function safeParseJson(text) {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [codeBlock?.[1], text].filter(Boolean);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.trim());
      if (parsed.formats?.length >= 5) return parsed;
    } catch { /* 次へ */ }
  }
  throw new Error('有効なJSONを抽出できませんでした');
}

export async function formatResearch() {
  logger.stage('R', 'フォーマット型リサーチ（Threads実データ分析）');

  const userIds = getReferenceUserIds();
  logger.info(`分析対象アカウント: ${userIds.join(', ')}`);

  // Step 1: 投稿データ収集
  const allPosts = [];
  for (const uid of userIds) {
    const posts = await fetchUserThreads(uid);
    allPosts.push(...posts);
    logger.info(`  ${uid}: ${posts.length}件取得`);
  }

  // Step 2: エンゲージメントでソート（いいね + 返信 × 2）
  const scored = allPosts
    .filter(p => p.text?.length > 30)
    .map(p => ({
      ...p,
      score: (p.like_count ?? 0) + (p.replies_count ?? 0) * 2,
    }))
    .sort((a, b) => b.score - a.score);

  const topPosts = scored.slice(0, 30);
  logger.info(`エンゲージメント上位${topPosts.length}件を抽出（合計${allPosts.length}件中）`);

  if (topPosts.length === 0) {
    logger.warn('投稿データが取得できませんでした。Claude知識ベースで生成します');
  }

  // Step 3: Claudeで構造分析
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const postsContext = topPosts.length > 0
    ? topPosts.map((p, i) =>
        `[${i + 1}] いいね:${p.like_count ?? 0} 返信:${p.replies_count ?? 0}\n${p.text}`
      ).join('\n\n---\n\n')
    : '（実データなし）';

  const msg = await client.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `以下はThreadsでのAI関連投稿のエンゲージメントデータです。
${topPosts.length > 0 ? 'いいね数・返信数が多い順に並んでいます。' : 'データが取れなかったため、高エンゲージメント投稿の一般的なパターンを使用してください。'}

投稿者ペルソナ: AIの新規事業を立ち上げたプロフェッショナル
読者: 起業家・ビジネスパーソン・エンジニア

--- 投稿データ ---
${postsContext}

---

上記を分析し、エンゲージメントが高い投稿に共通する「構造パターン」を10個抽出してください。

JSONのみで返してください。コードブロック不要。

{"formats":[{"id":"snake_case","name":"日本語名","categories":["tip"],"structure":"1行のテンプレート（改行なし・[変数]で可変部分）","hook_template":"冒頭フック1行","when_to_use":"1行の説明","example":"200〜350文字の実例（改行は\\nで表現）"}],"research_date":"${new Date().toISOString().slice(0, 10)}","sources":["Threads実データ分析"]}

重要: structure・hook_template・when_to_useは改行なしの1行で書くこと。exampleの改行は\\nで表現。categoriesはtip/story/concept/questionのみ。exampleは「知らなかった」「試してみて」禁止。10個必ず含めること。`,
    }],
  });

  const rawText = msg.content[0].text;
  // JSON修復: 文字列値内の生の改行をエスケープ
  const repairedText = rawText.replace(/("(?:[^"\\]|\\.)*")/g, m =>
    m.replace(/\n/g, '\\n').replace(/\r/g, '\\r')
  );
  logger.info(`レスポンス先頭200文字: ${rawText.slice(0, 200)}`);
  const result = safeParseJson(repairedText);
  result.data_source = topPosts.length > 0
    ? `Threads実データ ${topPosts.length}件分析（${userIds.join(', ')}）`
    : 'Claude知識ベース（実データ取得失敗）';

  fs.writeFileSync(FORMATS_PATH, JSON.stringify(result, null, 2), 'utf-8');
  logger.success(`${result.formats.length}個のフォーマット型を保存: memory/formats.json`);
  logger.info(`データソース: ${result.data_source}`);

  console.log('\n生成されたフォーマット型:');
  result.formats.forEach((f, i) => {
    console.log(`  ${i + 1}. [${f.id}] ${f.name} — ${f.when_to_use}`);
  });

  return result;
}
