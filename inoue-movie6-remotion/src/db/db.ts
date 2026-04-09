import { createRequire } from 'node:module';
import { logger } from '../lib/logger.ts';

const require = createRequire(import.meta.url);

type Database = InstanceType<typeof import('better-sqlite3')>;

// undefined = 未初期化, null = ロード失敗（graceful degradation）, Database = 正常
let _db: Database | null | undefined;

export function getDb(): Database | null {
  if (_db !== undefined) return _db;
  try {
    // better-sqlite3 は default export ではなく、直接 Database コンストラクタをエクスポート
    const DatabaseClass = require('better-sqlite3') as typeof import('better-sqlite3');
    _db = new DatabaseClass('/tmp/inoue-movie6.db');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        image_path TEXT NOT NULL,
        title TEXT NOT NULL,
        price REAL,
        template TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS shots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        shot_index INTEGER NOT NULL,
        template TEXT,
        video_path TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        impressions INTEGER,
        purchases INTEGER,
        three_sec_rate REAL,
        completion_rate REAL,
        recorded_at TEXT DEFAULT (datetime('now'))
      );
    `);
    return _db;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn('better-sqlite3 が利用できません。DB永続化をスキップします。', { error: msg });
    _db = null;
    return null;
  }
}

export function insertJob(jobId: string, imagePath: string): void {
  const db = getDb();
  if (!db) return;
  db.prepare(
    'INSERT OR IGNORE INTO jobs (job_id, image_path, title, price) VALUES (?, ?, ?, ?)'
  ).run(jobId, imagePath, '', 0);
}

export function updateJobInfo(jobId: string, title: string, price: number): void {
  const db = getDb();
  if (!db) return;
  db.prepare('UPDATE jobs SET title = ?, price = ? WHERE job_id = ?').run(title, price, jobId);
}

export function insertShot(jobId: string, shotIndex: number, template: string): void {
  const db = getDb();
  if (!db) return;
  db.prepare(
    'INSERT INTO shots (job_id, shot_index, template) VALUES (?, ?, ?)'
  ).run(jobId, shotIndex, template);
}

export function updateJobStatus(jobId: string, status: string): void {
  const db = getDb();
  if (!db) return;
  db.prepare('UPDATE jobs SET status = ? WHERE job_id = ?').run(status, jobId);
}

export function insertMetrics(
  jobId: string,
  impressions: number,
  purchases: number,
  threeSecRate: number,
  completionRate: number
): void {
  const db = getDb();
  if (!db) return;
  db.prepare(
    'INSERT INTO metrics (job_id, impressions, purchases, three_sec_rate, completion_rate) VALUES (?, ?, ?, ?, ?)'
  ).run(jobId, impressions, purchases, threeSecRate, completionRate);
}
