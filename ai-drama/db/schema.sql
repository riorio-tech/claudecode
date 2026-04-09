-- ai-drama データベーススキーマ
-- 目的: 感情工学の知見を蓄積し、次の生成に活かす永続的な資産

-- ── ジョブ管理 ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drama_jobs (
  job_id         TEXT PRIMARY KEY,
  concept        TEXT NOT NULL,
  genre          TEXT,
  arc_template   TEXT,
  episode        INTEGER DEFAULT 1,
  total_episodes INTEGER DEFAULT 3,
  series_id      TEXT,
  status         TEXT DEFAULT 'pending',  -- pending | running | completed | failed
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at   DATETIME,
  params         TEXT   -- JSON blob（CLIオプション全体）
);

-- ── シーン記録 ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drama_scenes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         TEXT REFERENCES drama_jobs(job_id),
  scene_index    INTEGER,
  emotional_beat TEXT,
  emotion_trigger TEXT,  -- anger | empathy | frenzy | tension | hook | cliffhanger
  shot_type      TEXT,
  motion_code    TEXT,
  image_path     TEXT,
  clip_path      TEXT
);

-- ── 感情スコア評価結果 ──────────────────────────────────────────────────────
-- eval_items: hook, anger, empathy, frenzy, viral, cliffhanger,
--             character, drama, subtitle, audio
CREATE TABLE IF NOT EXISTS drama_eval (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id          TEXT REFERENCES drama_jobs(job_id),
  iteration       INTEGER DEFAULT 0,  -- 0=初回、1以上=改善ループ
  total_score     INTEGER,
  hook_score      INTEGER,
  anger_score     INTEGER,  -- 怒り誘発力
  empathy_score   INTEGER,  -- 共感力
  frenzy_score    INTEGER,  -- 熱狂・逆転力
  viral_score     INTEGER,  -- 拡散衝動
  cliffhanger_score INTEGER,
  character_score INTEGER,
  drama_score     INTEGER,
  subtitle_score  INTEGER,
  audio_score     INTEGER,
  improvements    TEXT,     -- JSON array
  reference_path  TEXT,
  is_best         INTEGER DEFAULT 0,  -- 1=このジョブの採用スコア
  eval_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── TikTok 実績メトリクス（配信後に手動 or API で記録）──────────────────────
CREATE TABLE IF NOT EXISTS drama_metrics (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id               TEXT REFERENCES drama_jobs(job_id),
  platform             TEXT DEFAULT 'tiktok',
  views                INTEGER,
  watch_time_avg_sec   REAL,
  completion_rate      REAL,  -- 完視聴率 0.0〜1.0
  comments             INTEGER,
  shares               INTEGER,
  comment_rate         REAL,
  share_rate           REAL,
  hook_retention_3s    REAL,  -- 3秒維持率 0.0〜1.0
  recorded_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── 感情パターンライブラリ（何が熱狂を生むかの知見を蓄積）────────────────────
-- eval スコアと実績メトリクスの相関から「勝ちパターン」を抽出する
CREATE TABLE IF NOT EXISTS drama_emotion_patterns (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  arc_template             TEXT,
  emotional_beat_sequence  TEXT,   -- JSON array: ["hook_opener","tension_build",...]
  emotion_trigger_sequence TEXT,   -- JSON array: ["hook","anger","empathy","frenzy","cliffhanger"]
  avg_total_score          REAL,
  avg_anger_score          REAL,
  avg_empathy_score        REAL,
  avg_frenzy_score         REAL,
  avg_completion_rate      REAL,   -- 実績データがある場合
  avg_comment_rate         REAL,
  sample_count             INTEGER DEFAULT 1,
  last_used_at             DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── コンセプト × スコア履歴（似たコンセプトの過去実績参照用）──────────────────
CREATE TABLE IF NOT EXISTS drama_concept_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT REFERENCES drama_jobs(job_id),
  concept     TEXT,
  genre       TEXT,
  total_score INTEGER,
  hook_score  INTEGER,
  anger_score INTEGER,
  frenzy_score INTEGER,
  final_video_path TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
