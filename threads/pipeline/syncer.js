/**
 * syncer.js — システムエージェント（コストゼロ）
 *
 * 役割: 投稿済みのpost_idに対してThreads APIからエンゲージメントを取得し、
 *       DBを更新する。
 *
 * 実行: node cli.js sync
 */
import { getDb, updateEngagement } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://graph.threads.net/v1.0';
const TOKEN = process.env.THREADS_ACCESS_TOKEN?.trim();

async function fetchEngagement(postId) {
  const url = `${BASE_URL}/${postId}/insights?metric=likes,replies,reposts,quotes,views&access_token=${TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);

  const find = (name) => {
    const item = data.data?.find(d => d.name === name);
    return item?.values?.[0]?.value ?? item?.total_value?.value ?? 0;
  };

  return {
    like_count: find('likes'),
    replies_count: find('replies'),
  };
}

export async function syncer() {
  logger.stage('S', 'エンゲージメント同期');

  if (!TOKEN) {
    logger.warn('THREADS_ACCESS_TOKEN が未設定です');
    return;
  }

  const db = getDb();
  // DB上の投稿済みレコード（post_id あり・dry_run でない）
  const posts = db.prepare(`
    SELECT post_id FROM posts
    WHERE post_id IS NOT NULL AND dry_run = 0
    ORDER BY timestamp DESC
  `).all();

  if (posts.length === 0) {
    logger.info('同期対象の投稿がありません');
    return;
  }

  logger.info(`${posts.length}件の投稿を同期します`);
  let updated = 0;

  for (const { post_id } of posts) {
    try {
      const { like_count, replies_count } = await fetchEngagement(post_id);
      updateEngagement(post_id, like_count, replies_count);
      logger.info(`  ${post_id}: ❤️ ${like_count}  💬 ${replies_count}`);
      updated++;
      // レートリミット対策
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      logger.warn(`  ${post_id}: 取得失敗 — ${err.message}`);
    }
  }

  db.prepare(`INSERT INTO sync_log (posts_updated) VALUES (?)`).run(updated);
  logger.success(`同期完了: ${updated}/${posts.length}件更新`);
}
