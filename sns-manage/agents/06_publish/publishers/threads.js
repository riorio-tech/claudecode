import { config } from '../../../config.js';
import { logger } from '../../../lib/logger.js';

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

/**
 * 指数バックオフ付きリトライ（1s→4s→16s）。
 * @param {() => Promise<unknown>} fn
 * @param {number} maxRetries
 * @returns {Promise<unknown>}
 */
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      const delay = Math.pow(4, attempt) * 1000;
      logger.warn(`リトライ ${attempt + 1}/${maxRetries} (${delay}ms後): ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/**
 * Meta Threads API を使って投稿する（2ステップフロー）。
 * @param {{ text: string, dryRun?: boolean }} options
 * @returns {Promise<{ post_id: string, post_url: string }>}
 */
export async function postThreads({ text, dryRun = false }) {
  if (!config.THREADS_ACCESS_TOKEN) {
    throw new Error('Threads APIキーが未設定です。.env に THREADS_ACCESS_TOKEN を設定してください。');
  }
  if (!config.THREADS_USER_ID) {
    throw new Error('Threads ユーザーIDが未設定です。.env に THREADS_USER_ID を設定してください。');
  }

  if (dryRun) {
    logger.info(`[Threads dryRun] 投稿テキスト:\n${text}`);
    return { post_id: 'dry-run', post_url: 'dry-run' };
  }

  const userId = config.THREADS_USER_ID;
  const token = config.THREADS_ACCESS_TOKEN;

  // Step 1: メディアコンテナを作成する
  const containerUrl = new URL(`${THREADS_API_BASE}/${userId}/threads`);
  containerUrl.searchParams.set('media_type', 'TEXT');
  containerUrl.searchParams.set('text', text);

  const containerRes = await fetch(containerUrl.toString(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!containerRes.ok) {
    const errText = await containerRes.text();
    throw new Error(`Threads コンテナ作成エラー (${containerRes.status}): ${errText}`);
  }

  const containerJson = await containerRes.json();
  const containerId = containerJson.id;
  logger.info(`[Threads] コンテナ作成成功: ${containerId}`);

  // Step 2: コンテナを公開する
  const publishUrl = new URL(`${THREADS_API_BASE}/${userId}/threads_publish`);
  publishUrl.searchParams.set('creation_id', containerId);

  const publishRes = await fetch(publishUrl.toString(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!publishRes.ok) {
    const errText = await publishRes.text();
    throw new Error(`Threads 公開エラー (${publishRes.status}): ${errText}`);
  }

  const publishJson = await publishRes.json();
  const postId = publishJson.id;
  const postUrl = `https://www.threads.net/t/${postId}`;

  logger.success(`[Threads] 投稿成功: ${postUrl}`);
  return { post_id: postId, post_url: postUrl };
}

/**
 * withRetry を使って postThreads を実行するラッパー。
 * agent.js から呼び出す際はこちらを使う。
 * @param {{ text: string, dryRun?: boolean }} options
 * @returns {Promise<{ post_id: string, post_url: string }>}
 */
export async function publishToThreads(options) {
  return withRetry(() => postThreads(options));
}
