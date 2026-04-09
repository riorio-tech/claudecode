-- inoue-movie4 データベーススキーマ
-- 勝ちパターンを永続化し、時間が経つほど精度が上がる基盤

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─── ジョブ記録 ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,           -- UUID (jobId)
  product_id  TEXT NOT NULL,
  title       TEXT NOT NULL,
  price       INTEGER,
  category    TEXT NOT NULL DEFAULT 'daily',
  image_path  TEXT NOT NULL,
  params      TEXT,                       -- JSON: 生成パラメータ一式
  status      TEXT NOT NULL DEFAULT 'running', -- running | completed | failed
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- ─── ショット構成記録 ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id       TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  video_index  INTEGER NOT NULL,          -- 0-9（10本のうち何本目か）
  hook_variant TEXT NOT NULL,            -- HOOKバリエーションの名前
  structure    TEXT NOT NULL,            -- JSON: shots配列全体
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── CVR・指標記録 ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metrics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id          TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  video_index     INTEGER NOT NULL,
  impressions     INTEGER NOT NULL DEFAULT 0,
  purchases       INTEGER NOT NULL DEFAULT 0,
  add_to_cart     INTEGER NOT NULL DEFAULT 0,
  retention_3s    REAL NOT NULL DEFAULT 0,  -- 0.0-1.0
  completion_rate REAL NOT NULL DEFAULT 0,  -- 0.0-1.0
  purchase_cvr    REAL NOT NULL DEFAULT 0,  -- 0.0-1.0
  ad_spend        INTEGER DEFAULT 0,        -- 円
  revenue         INTEGER DEFAULT 0,        -- 円
  measured_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── 商品候補管理 ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT NOT NULL,
  image_path       TEXT,
  category         TEXT NOT NULL DEFAULT 'daily',
  price            INTEGER,
  scout_reason     TEXT,                   -- AIが選んだ理由
  approved         INTEGER NOT NULL DEFAULT 0,  -- 0: 未確認, 1: 承認, -1: 却下
  approver_comment TEXT,
  scouted_at       TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at      TEXT
);

-- ─── 勝ちパターン ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patterns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  shot_id         INTEGER NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  hook_variant    TEXT NOT NULL,
  cvr_lift        REAL NOT NULL,           -- ベースライン比上昇率（例: 1.20 = +20%）
  base_cvr        REAL NOT NULL,           -- 採択時点のベースラインCVR
  win_cvr         REAL NOT NULL,           -- 勝利時のCVR
  impressions     INTEGER NOT NULL,
  adopted_at      TEXT NOT NULL DEFAULT (datetime('now')),
  notes           TEXT                     -- 人間のコメント
);

-- ─── インデックス ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_shots_job_id ON shots(job_id);
CREATE INDEX IF NOT EXISTS idx_metrics_job_id ON metrics(job_id);
CREATE INDEX IF NOT EXISTS idx_metrics_cvr ON metrics(purchase_cvr DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_cvr_lift ON patterns(cvr_lift DESC);
CREATE INDEX IF NOT EXISTS idx_products_approved ON products(approved);
