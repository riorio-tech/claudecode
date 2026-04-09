import { logger } from '../../lib/logger.js';
import { readJobFile, writeJobFile } from '../../lib/job-dir.js';
import { getPostsByJob, updatePost } from '../../db/db.js';
import { publishToTwitter } from './publishers/twitter.js';
import { publishToThreads } from './publishers/threads.js';
import { publishToTikTok } from './publishers/tiktok.js';

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
 * 06_publish エージェント: 承認済み投稿を各プラットフォームに公開する。
 * @param {string} jobId
 * @param {{ dryRun?: boolean }} options
 */
export async function runPublish(jobId, { dryRun = false } = {}) {
  logger.step(6, 'publish');
  logger.info(`jobId: ${jobId}  dryRun: ${dryRun}`);

  // Step 1: マーケティング出力を読み込む
  const marketingOutput = readJobFile(jobId, '05_marketing-output.json');
  const { publishOrder = ['twitter'] } = marketingOutput;

  // Step 2: DBのpostレコードを取得
  const posts = await getPostsByJob(jobId);

  // Step 3: 承認ゲートチェック（dryRunの場合はスキップ）
  if (!dryRun) {
    const hasUnapproved = posts.some(p => p.status !== 'approved');
    if (hasUnapproved) {
      throw new Error('投稿が承認されていません。先に POST /api/jobs/:id/approve を実行してください。');
    }
  }

  const publishResults = [];

  // Step 4: publishOrder に従って各プラットフォームを処理
  for (const platform of publishOrder) {
    if (platform === 'twitter') {
      // Twitter: バリアントAのみ投稿
      const twitterPosts = posts.filter(p => p.platform === 'twitter');
      const variantA = twitterPosts.find(p => p.variant_id === 'A');

      if (!variantA) {
        logger.warn('[Twitter] バリアントAの投稿レコードが見つかりません');
        publishResults.push({ platform: 'twitter', variantId: 'A', status: 'skipped' });
        continue;
      }

      // マーケティング出力からバリアントAのコンテンツを取得
      const content = marketingOutput.finalizedContents?.find(
        c => c.platform === 'twitter' && c.variantId === 'A'
      );

      if (!content) {
        logger.warn('[Twitter] finalizedContents にバリアントAが見つかりません');
        publishResults.push({ platform: 'twitter', variantId: 'A', status: 'skipped' });
        continue;
      }

      const text = [content.caption, ...(content.hashtags || [])].join('\n');

      // Step 5: 投稿（最大3回リトライ・指数バックオフ）
      try {
        const { post_id: postId, post_url: postUrl } = await withRetry(() =>
          publishToTwitter({ text, dryRun })
        );

        const publishedAt = new Date().toISOString();
        await updatePost(variantA.id, { postId, postUrl, status: 'published', publishedAt });

        logger.success(`[Twitter] 投稿成功: ${postUrl}`);
        publishResults.push({
          platform: 'twitter',
          variantId: 'A',
          status: 'published',
          postId,
          postUrl,
          publishedAt,
        });
      } catch (err) {
        const errorMsg = err.message;
        await updatePost(variantA.id, { status: 'failed', errorMsg });
        logger.error(`[Twitter] 投稿失敗: ${errorMsg}`);
        publishResults.push({
          platform: 'twitter',
          variantId: 'A',
          status: 'failed',
          errorMsg,
        });
      }

      // バリアントBはスキップ（後の分析比較用）
      const variantB = twitterPosts.find(p => p.variant_id === 'B');
      if (variantB) {
        logger.info('[Twitter] バリアントBは分析比較用のためスキップ');
        await updatePost(variantB.id, { status: 'skipped' });
        publishResults.push({ platform: 'twitter', variantId: 'B', status: 'skipped' });
      }
    } else if (platform === 'threads') {
      // Threads: バリアントAのみ投稿
      const threadsPosts = posts.filter(p => p.platform === 'threads');
      const variantA = threadsPosts.find(p => p.variant_id === 'A');

      if (!variantA) {
        logger.warn('[Threads] バリアントAの投稿レコードが見つかりません');
        publishResults.push({ platform: 'threads', variantId: 'A', status: 'skipped' });
        continue;
      }

      // マーケティング出力からバリアントAのコンテンツを取得
      const content = marketingOutput.finalizedContents?.find(
        c => c.platform === 'threads' && c.variantId === 'A'
      );

      if (!content) {
        logger.warn('[Threads] finalizedContents にバリアントAが見つかりません');
        publishResults.push({ platform: 'threads', variantId: 'A', status: 'skipped' });
        continue;
      }

      const text = [content.caption, ...(content.hashtags || [])].join('\n');

      try {
        const { post_id: postId, post_url: postUrl } = await publishToThreads({ text, dryRun });

        const publishedAt = new Date().toISOString();
        await updatePost(variantA.id, { postId, postUrl, status: 'published', publishedAt });

        logger.success(`[Threads] 投稿成功: ${postUrl}`);
        publishResults.push({
          platform: 'threads',
          variantId: 'A',
          status: 'published',
          postId,
          postUrl,
          publishedAt,
        });
      } catch (err) {
        const errorMsg = err.message;
        await updatePost(variantA.id, { status: 'failed', errorMsg });
        logger.error(`[Threads] 投稿失敗: ${errorMsg}`);
        publishResults.push({
          platform: 'threads',
          variantId: 'A',
          status: 'failed',
          errorMsg,
        });
      }

      // バリアントBはスキップ（後の分析比較用）
      const variantB = threadsPosts.find(p => p.variant_id === 'B');
      if (variantB) {
        logger.info('[Threads] バリアントBは分析比較用のためスキップ');
        await updatePost(variantB.id, { status: 'skipped' });
        publishResults.push({ platform: 'threads', variantId: 'B', status: 'skipped' });
      }
    } else if (platform === 'tiktok') {
      // TikTok: Playwright ブラウザフォールバック経由で投稿
      const tiktokPosts = posts.filter(p => p.platform === 'tiktok');
      const variantA = tiktokPosts.find(p => p.variant_id === 'A');

      if (!variantA) {
        logger.warn('[TikTok] バリアントAの投稿レコードが見つかりません');
        publishResults.push({ platform: 'tiktok', variantId: 'A', status: 'skipped' });
        continue;
      }

      const content = marketingOutput.finalizedContents?.find(
        c => c.platform === 'tiktok' && c.variantId === 'A'
      );

      if (!content) {
        logger.warn('[TikTok] finalizedContents にバリアントAが見つかりません');
        publishResults.push({ platform: 'tiktok', variantId: 'A', status: 'skipped' });
        continue;
      }

      const text = [content.caption, ...(content.hashtags || [])].join('\n');

      try {
        const { post_id: postId, post_url: postUrl } = await publishToTikTok({ text, dryRun });

        const publishedAt = new Date().toISOString();
        await updatePost(variantA.id, { postId, postUrl, status: 'published', publishedAt });

        logger.success(`[TikTok] 投稿成功: ${postUrl}`);
        publishResults.push({
          platform: 'tiktok',
          variantId: 'A',
          status: 'published',
          postId,
          postUrl,
          publishedAt,
        });
      } catch (err) {
        const errorMsg = err.message;
        await updatePost(variantA.id, { status: 'failed', errorMsg });
        logger.error(`[TikTok] 投稿失敗: ${errorMsg}`);
        publishResults.push({
          platform: 'tiktok',
          variantId: 'A',
          status: 'failed',
          errorMsg,
        });
      }

      // バリアントBはスキップ（後の分析比較用）
      const variantB = tiktokPosts.find(p => p.variant_id === 'B');
      if (variantB) {
        logger.info('[TikTok] バリアントBは分析比較用のためスキップ');
        await updatePost(variantB.id, { status: 'skipped' });
        publishResults.push({ platform: 'tiktok', variantId: 'B', status: 'skipped' });
      }
    } else {
      logger.info(`[${platform}] 未実装のプラットフォームのためスキップ`);
      publishResults.push({ platform, variantId: null, status: 'skipped' });
    }
  }

  // Step 6: 出力ファイルを書き込む
  const completedAt = new Date().toISOString();
  const output = { jobId, publishResults, publishedAt: completedAt };
  writeJobFile(jobId, '06_publish-output.json', output);

  logger.success(`06_publish 完了 (${publishResults.length}件処理)`);
  return output;
}
