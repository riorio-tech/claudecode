import { config } from '../../../config.js';
import { logger } from '../../../lib/logger.js';

/**
 * TikTok に投稿する。
 * TikTok API v2 はテキスト単体投稿を一般提供していないため、
 * Playwright ブラウザフォールバックを正式ルートとして採用する。
 * @param {{ text: string, dryRun?: boolean }} params
 * @returns {Promise<{ post_id: string, post_url: string }>}
 */
export async function publishToTikTok({ text, dryRun = false }) {
  if (dryRun) {
    logger.info(`[TikTok dryRun] テキスト:\n${text}`);
    return { post_id: 'dry-run', post_url: 'dry-run' };
  }

  logger.info('[TikTok] Playwright 経由で投稿を試みます...');
  try {
    const { postViaBrowser } = await import('../../10_browser/agent.js');
    const result = await postViaBrowser({ platform: 'tiktok', caption: text, headless: true });
    if (!result?.ok) throw new Error(result?.error || 'ブラウザ投稿失敗');
    return { post_id: `browser-${Date.now()}`, post_url: 'https://www.tiktok.com' };
  } catch (err) {
    throw new Error(`TikTok 投稿失敗: ${err.message}\n先に node cli.js browser-login --platform tiktok でログインしてください。`);
  }
}
