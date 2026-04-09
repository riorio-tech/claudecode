/**
 * dashboard/server.js
 * 実行: node dashboard/server.js
 * アクセス: http://localhost:3000
 */
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllPosts, getStats, getDb } from '../lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;

app.use(express.static(__dirname));

// API: 統計サマリー
app.get('/api/stats', (req, res) => {
  const stats = getStats();
  res.json(stats);
});

// API: 投稿一覧
app.get('/api/posts', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const onlyPublished = req.query.published === 'true';
  const posts = getAllPosts({ limit, onlyPublished });
  res.json(posts);
});

// API: スコア推移（時系列）
app.get('/api/scores', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT date, ROUND(AVG(eval_score), 1) AS avg_score, COUNT(*) AS count
    FROM posts
    WHERE eval_score IS NOT NULL
    GROUP BY date
    ORDER BY date ASC
  `).all();
  res.json(rows);
});

// API: フォーマット別エンゲージメント
app.get('/api/by-format', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      format_name,
      COUNT(*)                          AS count,
      ROUND(AVG(eval_score), 1)         AS avg_score,
      COALESCE(SUM(like_count), 0)      AS total_likes,
      COALESCE(SUM(replies_count), 0)   AS total_replies
    FROM posts
    WHERE format_name IS NOT NULL
    GROUP BY format_name
    ORDER BY total_likes DESC
  `).all();
  res.json(rows);
});

app.listen(PORT, () => {
  console.log(`\nThreads ダッシュボード起動`);
  console.log(`http://localhost:${PORT}\n`);
});
