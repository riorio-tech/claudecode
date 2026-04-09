CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,
  topic        TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'general',
  platforms    TEXT NOT NULL,  -- JSON array: ["twitter","tiktok"]
  status       TEXT NOT NULL DEFAULT 'running',  -- running|completed|failed|approved
  params       TEXT,           -- JSON
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS contents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL REFERENCES jobs(id),
  platform    TEXT NOT NULL,
  variant_id  TEXT NOT NULL DEFAULT 'A',
  type        TEXT NOT NULL,   -- caption|script|storyboard
  body        TEXT NOT NULL,
  metadata    TEXT,            -- JSON: hashtags, cta等
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id       TEXT NOT NULL REFERENCES jobs(id),
  content_id   INTEGER REFERENCES contents(id),
  platform     TEXT NOT NULL,
  variant_id   TEXT NOT NULL DEFAULT 'A',
  post_id      TEXT,
  post_url     TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|published|failed
  scheduled_at TEXT,
  published_at TEXT,
  error_msg    TEXT
);

CREATE TABLE IF NOT EXISTS metrics (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id          INTEGER NOT NULL REFERENCES posts(id),
  impressions      INTEGER DEFAULT 0,
  likes            INTEGER DEFAULT 0,
  comments         INTEGER DEFAULT 0,
  shares           INTEGER DEFAULT 0,
  engagement_rate  REAL DEFAULT 0,
  reach            INTEGER DEFAULT 0,
  saves            INTEGER DEFAULT 0,
  profile_visits   INTEGER DEFAULT 0,
  retention_3s     REAL DEFAULT 0,
  completion_rate  REAL DEFAULT 0,
  measured_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS patterns (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  platform         TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'general',
  hook_variant     TEXT NOT NULL,
  engagement_lift  REAL NOT NULL,
  base_engagement  REAL NOT NULL,
  win_engagement   REAL NOT NULL,
  impressions      INTEGER NOT NULL,
  content_snippet  TEXT,
  adopted_at       TEXT NOT NULL DEFAULT (datetime('now')),
  notes            TEXT
);

CREATE TABLE IF NOT EXISTS research_cache (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key  TEXT UNIQUE NOT NULL,
  result     TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_tokens (
  platform      TEXT PRIMARY KEY,
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  expires_at    TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_contents_job ON contents(job_id);
CREATE INDEX IF NOT EXISTS idx_posts_job ON posts(job_id);
CREATE INDEX IF NOT EXISTS idx_metrics_post ON metrics(post_id);
CREATE INDEX IF NOT EXISTS idx_patterns_platform ON patterns(platform, engagement_lift DESC);

-- 分析スケジュール管理（投稿後N時間後に実行）
CREATE TABLE IF NOT EXISTS analytics_schedule (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id      INTEGER NOT NULL REFERENCES posts(id),
  job_id       TEXT NOT NULL,
  platform     TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  delay_hours  INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  executed_at  TEXT
);

-- 日次/週次PDCAレポート
CREATE TABLE IF NOT EXISTS pdca_reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  report_type    TEXT NOT NULL,
  period_start   TEXT NOT NULL,
  period_end     TEXT NOT NULL,
  summary        TEXT NOT NULL,
  top_pattern    TEXT,
  avg_engagement REAL,
  total_reach    INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_analytics_schedule_pending
  ON analytics_schedule(scheduled_at) WHERE status = 'pending';

-- 日次スナップショット（毎日0時に全プラットフォームの数字を保存）
CREATE TABLE IF NOT EXISTS daily_snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date   TEXT NOT NULL,           -- "YYYY-MM-DD"
  platform        TEXT NOT NULL,
  impressions     INTEGER DEFAULT 0,
  likes           INTEGER DEFAULT 0,
  comments        INTEGER DEFAULT 0,
  shares          INTEGER DEFAULT 0,
  engagement_rate REAL DEFAULT 0,
  follower_delta  INTEGER DEFAULT 0,
  link_clicks     INTEGER DEFAULT 0,
  post_count      INTEGER DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(snapshot_date, platform)
);

-- 週次AIレポート
CREATE TABLE IF NOT EXISTS weekly_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start    TEXT NOT NULL,   -- "YYYY-MM-DD"
  week_end      TEXT NOT NULL,   -- "YYYY-MM-DD"
  ai_insights   TEXT NOT NULL,  -- Claude生成のインサイトJSON文字列
  top_post_id   INTEGER REFERENCES posts(id),
  summary_json  TEXT NOT NULL,  -- 集計数値JSON
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_daily_snapshots_date ON daily_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_start ON weekly_reports(week_start DESC);

-- ============================================================
-- 永続資産レイヤー: 使い続けるほど蓄積される知識ベース
-- ============================================================

-- 負けパターン（アンチフラジリティ: 失敗も同等の資産）
-- patternsテーブルと対称設計。どちらが欠けても学習は片翼飛行。
CREATE TABLE IF NOT EXISTS failure_patterns (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  platform       TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'general',
  hook_variant   TEXT NOT NULL,
  hook_type      TEXT NOT NULL DEFAULT 'unknown',  -- 'object_centric'|'desire_centric'|'other'
  failure_mode   TEXT NOT NULL,  -- 'wrong_mediator'|'wrong_emotion'|'object_centric_drift'|'timing'|'low_quality'|'other'
  failure_reason TEXT NOT NULL,  -- 模倣欲望フレームでの要因分析
  avoidance_rule TEXT NOT NULL,  -- 02_planningに注入されるルール文
  experiment_insight TEXT,       -- 予想と結果のギャップから得た発見（アンチフラジリティ的評価）
  engagement_floor REAL NOT NULL DEFAULT 0,
  impressions    INTEGER NOT NULL DEFAULT 0,
  content_snippet TEXT,
  recorded_at    TEXT NOT NULL DEFAULT (datetime('now')),
  notes          TEXT
);

-- 知識ベース: 実験を重ねるたびにconfidenceが上昇する蒸留インサイト
-- このテーブルが「このシステムが学んだこと」の核心。永遠に削除しない。
CREATE TABLE IF NOT EXISTS knowledge_base (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  insight_key         TEXT UNIQUE NOT NULL,   -- 'twitter_desire_centric_dominates' 等の識別キー
  category            TEXT NOT NULL,          -- 'hook'|'emotion'|'platform'|'audience'|'timing'|'desire'
  platform            TEXT,                   -- NULL=クロスプラットフォーム
  statement           TEXT NOT NULL,          -- 「Twitterでは欲望主語が商品主語の2.3倍のエンゲージを得る」
  evidence_count      INTEGER NOT NULL DEFAULT 1,  -- 裏付け実験数（増え続ける）
  confidence          REAL NOT NULL DEFAULT 0.5,   -- 0.0〜1.0。証拠が積み上がるほど上昇
  first_observed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_reinforced_at  TEXT NOT NULL DEFAULT (datetime('now')),
  status              TEXT NOT NULL DEFAULT 'active',  -- 'active'|'deprecated'|'contradicted'
  contradiction_note  TEXT  -- 矛盾が発見された場合のメモ（削除はせず記録する）
);

-- 欲望地図（模倣欲望理論の実装）: リサーチごとに蓄積される欲望連鎖データ
CREATE TABLE IF NOT EXISTS desire_map (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  topic            TEXT NOT NULL,
  platform         TEXT NOT NULL,
  mediator_type    TEXT,   -- 'influencer'|'community'|'trend'|'event'
  trigger_emotion  TEXT,   -- 'aspiration'|'envy'|'fear'|'excitement'|'belonging'
  spread_pattern   TEXT,   -- 'vertical'(インフルエンサー起点)|'horizontal'(コミュニティ起点)
  desire_object    TEXT,   -- 何を欲しがっているか（商品・状態・体験）
  desire_subject   TEXT,   -- 誰が欲しがっているか（対象者の描写）
  examples         TEXT,   -- JSON array: 参考アカウント・投稿例
  cache_key        TEXT UNIQUE,  -- topic-platform でキャッシュ
  observed_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 実験ログ: 全A/Bテストの仮説・予測・結果を永続記録
-- 削除せず、矛盾も含め全て蓄積する。これが知識ベースの原材料。
CREATE TABLE IF NOT EXISTS experiment_log (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id                    TEXT,
  platform                  TEXT NOT NULL,
  hypothesis                TEXT NOT NULL,  -- 「欲望主語にすればエンゲージが上がるはず」
  variant_a_description     TEXT NOT NULL,
  variant_b_description     TEXT,
  variant_a_engagement      REAL,
  variant_b_engagement      REAL,
  variant_a_impressions     INTEGER,
  variant_b_impressions     INTEGER,
  winner                    TEXT,           -- 'A'|'B'|'tie'|'inconclusive'
  lift                      REAL,
  insight                   TEXT,           -- この実験から得られた1文のインサイト
  supports_desire_theory    INTEGER DEFAULT 0,  -- 1=欲望主語が勝った
  supports_antifragility    INTEGER DEFAULT 0,  -- 1=失敗から有意な発見があった
  recorded_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

-- オーディエンス指紋: ターゲット像の継続的学習
CREATE TABLE IF NOT EXISTS audience_fingerprint (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  platform        TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'general',
  characteristic  TEXT NOT NULL,  -- 観察された特性
  evidence_count  INTEGER NOT NULL DEFAULT 1,
  confidence      REAL NOT NULL DEFAULT 0.5,
  example_content TEXT,           -- 反応が良かったコンテンツの例
  first_observed  TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(platform, category, characteristic)
);

CREATE INDEX IF NOT EXISTS idx_failure_patterns_platform ON failure_patterns(platform, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_category ON knowledge_base(category, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_platform ON knowledge_base(platform, status);
CREATE INDEX IF NOT EXISTS idx_desire_map_topic ON desire_map(topic, platform);
CREATE INDEX IF NOT EXISTS idx_experiment_log_job ON experiment_log(job_id);
CREATE INDEX IF NOT EXISTS idx_experiment_log_platform ON experiment_log(platform, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_audience_fingerprint ON audience_fingerprint(platform, category, confidence DESC);
