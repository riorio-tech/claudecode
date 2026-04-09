import { createRequire } from 'module';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let _db = null;

/**
 * better-sqlite3 のインスタンスを返す（シングルトン）
 * better-sqlite3 が未インストールの場合は null を返し、DB機能はスキップされる
 *
 * @returns {import('better-sqlite3').Database | null}
 */
export function getDb() {
  if (_db) return _db;

  try {
    const Database = require('better-sqlite3');
    const { config } = await_config();
    _db = new Database(config.DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    _db.exec(schema);
    return _db;
  } catch {
    return null; // better-sqlite3 未ビルド時はDBなしで動作
  }
}

// config の循環依存を避けるための同期ヘルパー
function await_config() {
  // 動的 import が使えないので直接読む
  try {
    const configPath = join(__dirname, '..', 'config.js');
    // ESM config.js はここでは直接 require できないため、DB_PATH のデフォルト値を使用
    return { config: { DB_PATH: './inoue-movie.db' } };
  } catch {
    return { config: { DB_PATH: './inoue-movie.db' } };
  }
}

/**
 * ジョブを記録する
 * @param {{ jobId: string, title: string, price: number|null, category: string, imagePath: string, params: object }} job
 */
export function insertJob({ jobId, title, price, category, imagePath, params }) {
  const db = getDb();
  if (!db) return;

  db.prepare(`
    INSERT OR IGNORE INTO jobs (id, product_id, title, price, category, image_path, params)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(jobId, `SKU-${Date.now()}`, title, price ?? null, category, imagePath, JSON.stringify(params));
}

/**
 * ジョブのステータスを更新する
 * @param {string} jobId
 * @param {'completed' | 'failed'} status
 */
export function updateJobStatus(jobId, status) {
  const db = getDb();
  if (!db) return;

  db.prepare(`
    UPDATE jobs SET status = ?, completed_at = datetime('now') WHERE id = ?
  `).run(status, jobId);
}

/**
 * ショット構成を記録する
 * @param {{ jobId: string, videoIndex: number, hookVariant: string, structure: object }} shot
 */
export function insertShot({ jobId, videoIndex, hookVariant, structure }) {
  const db = getDb();
  if (!db) return null;

  const result = db.prepare(`
    INSERT INTO shots (job_id, video_index, hook_variant, structure)
    VALUES (?, ?, ?, ?)
  `).run(jobId, videoIndex, hookVariant, JSON.stringify(structure));

  return result.lastInsertRowid;
}

/**
 * CVR指標を記録する
 * @param {{ jobId: string, videoIndex: number, metrics: object }} params
 */
export function insertMetrics({ jobId, videoIndex, metrics }) {
  const db = getDb();
  if (!db) return;

  const {
    impressions = 0,
    purchases = 0,
    addToCart = 0,
    retention3s = 0,
    completionRate = 0,
    purchaseCvr = 0,
    adSpend = 0,
    revenue = 0,
  } = metrics;

  db.prepare(`
    INSERT INTO metrics
      (job_id, video_index, impressions, purchases, add_to_cart, retention_3s,
       completion_rate, purchase_cvr, ad_spend, revenue)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(jobId, videoIndex, impressions, purchases, addToCart, retention3s,
         completionRate, purchaseCvr, adSpend, revenue);
}

/**
 * 勝ちパターンとして採択する
 * @param {{ shotId: number, hookVariant: string, cvrLift: number, baseCvr: number, winCvr: number, impressions: number, notes: string }} pattern
 */
export function adoptPattern({ shotId, hookVariant, cvrLift, baseCvr, winCvr, impressions, notes }) {
  const db = getDb();
  if (!db) return;

  db.prepare(`
    INSERT INTO patterns (shot_id, hook_variant, cvr_lift, base_cvr, win_cvr, impressions, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(shotId, hookVariant, cvrLift, baseCvr, winCvr, impressions, notes ?? null);
}

/**
 * 過去の勝ちパターンを取得する（shot-planner 参照用）
 * @param {number} limit
 * @returns {Array<object>}
 */
export function getTopPatterns(limit = 5) {
  const db = getDb();
  if (!db) return [];

  return db.prepare(`
    SELECT p.hook_variant, p.cvr_lift, p.win_cvr, p.impressions, s.structure
    FROM patterns p
    JOIN shots s ON p.shot_id = s.id
    ORDER BY p.cvr_lift DESC
    LIMIT ?
  `).all(limit);
}

/**
 * ベースラインCVRを計算する（直近30日・3000imp以上の平均）
 * @returns {number | null}
 */
export function getBaselineCvr() {
  const db = getDb();
  if (!db) return null;

  const row = db.prepare(`
    SELECT AVG(purchase_cvr) as avg_cvr
    FROM metrics
    WHERE impressions >= 3000
      AND measured_at >= datetime('now', '-30 days')
  `).get();

  return row?.avg_cvr ?? null;
}

/**
 * 商品候補をDBに追加する
 * @param {{ title: string, category: string, price: number|null, scoutReason: string }} product
 */
export function insertProduct({ title, category, price, scoutReason }) {
  const db = getDb();
  if (!db) return;

  db.prepare(`
    INSERT INTO products (title, category, price, scout_reason)
    VALUES (?, ?, ?, ?)
  `).run(title, category, price ?? null, scoutReason);
}

/**
 * 承認待ち商品を取得する
 * @returns {Array<object>}
 */
export function getPendingProducts() {
  const db = getDb();
  if (!db) return [];

  return db.prepare(`
    SELECT * FROM products WHERE approved = 0 ORDER BY scouted_at DESC
  `).all();
}
