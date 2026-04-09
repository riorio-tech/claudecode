import { publish, publishThread } from '../lib/threads-api.js';
import { writeJson } from '../lib/job-dir.js';
import { logger } from '../lib/logger.js';

export async function poster(jobDir, theme, review, isDryRun) {
  const isThread = !!review.final_parts;
  logger.stage(5, isDryRun ? '投稿（ドライラン）' : '投稿実行');

  const text = review.final_text;

  if (isThread) {
    const { hook, bridge, detail, summary } = review.final_parts;
    const parts4 = bridge
      ? [hook, bridge, detail, summary]
      : [hook, detail, summary];
    const label = bridge ? '4連' : '3連';
    logger.info(`ツリー投稿（${label}）`);
    console.log('\x1b[35m' + '─'.repeat(50) + '\x1b[0m');
    parts4.filter(Boolean).forEach((p, i) => {
      console.log(`\x1b[33m[${i + 1}]\x1b[0m ` + p);
    });
    console.log('\x1b[35m' + '─'.repeat(50) + '\x1b[0m');
  } else {
    logger.post(text);
  }

  if (isDryRun) {
    logger.warn('--dry-run: 実際には投稿しません');
    const result = {
      dry_run: true,
      timestamp: new Date().toISOString(),
      category: theme.category,
      theme: theme.theme,
      text,
    };
    writeJson(jobDir, '05_result.json', result);
    return result;
  }

  if (isThread) {
    const { hook, bridge, detail, summary } = review.final_parts;
    const parts4 = bridge
      ? [hook, bridge, detail, summary]
      : [hook, detail, summary];
    const posts = await publishThread(parts4.filter(Boolean));
    logger.success(`ツリー投稿完了: ${posts.map(p => p.postId).join(' → ')}`);
    const result = {
      dry_run: false,
      post_id: posts[0].postId,
      thread_post_ids: posts.map(p => p.postId),
      timestamp: new Date().toISOString(),
      category: theme.category,
      theme: theme.theme,
      text,
    };
    writeJson(jobDir, '05_result.json', result);
    return result;
  }

  const { postId, containerId } = await publish(text);
  logger.success(`投稿完了: post_id=${postId}`);

  const result = {
    dry_run: false,
    post_id: postId,
    container_id: containerId,
    timestamp: new Date().toISOString(),
    category: theme.category,
    theme: theme.theme,
    text,
  };
  writeJson(jobDir, '05_result.json', result);
  return result;
}
