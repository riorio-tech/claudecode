/**
 * db.js — SQLite永続化レイヤー
 *
 * テーブル:
 *   posts — 投稿全データ + エンゲージメント
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.resolve('memory/threads.db');

let _db = null;

export function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  migrate(_db);
  return _db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id        TEXT,
      post_id       TEXT UNIQUE,
      date          TEXT,
      timestamp     TEXT,
      category      TEXT,
      theme         TEXT,
      format_id     TEXT,
      format_name   TEXT,
      text          TEXT,
      eval_score    INTEGER,
      eval_passed   INTEGER,
      hook_type     TEXT,
      dry_run       INTEGER DEFAULT 0,
      like_count    INTEGER,
      replies_count INTEGER,
      synced_at     TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      synced_at  TEXT DEFAULT (datetime('now')),
      posts_updated INTEGER
    );
  `);
}

export function upsertPost(post) {
  const db = getDb();
  db.prepare(`
    INSERT INTO posts (
      job_id, post_id, date, timestamp, category, theme,
      format_id, format_name, text, eval_score, eval_passed,
      hook_type, dry_run
    ) VALUES (
      @job_id, @post_id, @date, @timestamp, @category, @theme,
      @format_id, @format_name, @text, @eval_score, @eval_passed,
      @hook_type, @dry_run
    )
    ON CONFLICT(post_id) DO UPDATE SET
      eval_score  = excluded.eval_score,
      eval_passed = excluded.eval_passed
  `).run({
    job_id:       post.job_id ?? null,
    post_id:      post.post_id ?? null,
    date:         post.date ?? null,
    timestamp:    post.timestamp ?? null,
    category:     post.category ?? null,
    theme:        post.theme ?? null,
    format_id:    post.format_id ?? null,
    format_name:  post.format_name ?? null,
    text:         post.text ?? null,
    eval_score:   post.eval_score ?? null,
    eval_passed:  post.eval_passed ? 1 : 0,
    hook_type:    post.hook_type ?? null,
    dry_run:      post.dry_run ? 1 : 0,
  });
}

export function updateEngagement(postId, likeCount, repliesCount) {
  const db = getDb();
  db.prepare(`
    UPDATE posts
    SET like_count = ?, replies_count = ?, synced_at = datetime('now')
    WHERE post_id = ?
  `).run(likeCount, repliesCount, postId);
}

export function getAllPosts({ limit = 100, onlyPublished = false } = {}) {
  const db = getDb();
  const where = onlyPublished ? 'WHERE dry_run = 0 AND post_id IS NOT NULL' : '';
  return db.prepare(`
    SELECT * FROM posts ${where}
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit);
}

export function getStats() {
  const db = getDb();
  return db.prepare(`
    SELECT
      COUNT(*)                                        AS total_posts,
      COUNT(CASE WHEN dry_run = 0 THEN 1 END)        AS published,
      ROUND(AVG(eval_score), 1)                      AS avg_score,
      COALESCE(SUM(like_count), 0)                   AS total_likes,
      COALESCE(SUM(replies_count), 0)                AS total_replies,
      MAX(eval_score)                                 AS best_score
    FROM posts
  `).get();
}
