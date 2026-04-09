/**
 * ai-drama DB レイヤー
 *
 * better-sqlite3 がインストールされていない場合はノーオペレーション（graceful degradation）。
 * 感情工学の知見を永続的に蓄積し、次の生成に活かすための資産データベース。
 */

import { createRequire } from 'module';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ── DB 初期化 ────────────────────────────────────────────────────────────────

let db = null;

function getDb() {
  if (db) return db;

  try {
    const Database = require('better-sqlite3');
    const dbPath = process.env.DB_PATH ?? './ai-drama.db';
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // スキーマを適用
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schema);

    return db;
  } catch {
    // better-sqlite3 未インストール時はサイレントにスキップ
    return null;
  }
}

// ── ジョブ管理 ───────────────────────────────────────────────────────────────

export async function insertJob({ jobId, concept, genre, arcTemplate, episode = 1, totalEpisodes = 3, seriesId = null, params = null }) {
  const db = getDb();
  if (!db) return;

  db.prepare(`
    INSERT OR IGNORE INTO drama_jobs (job_id, concept, genre, arc_template, episode, total_episodes, series_id, params)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(jobId, concept, genre ?? null, arcTemplate ?? null, episode, totalEpisodes, seriesId, params ? JSON.stringify(params) : null);
}

export async function updateJobStatus(jobId, status) {
  const db = getDb();
  if (!db) return;

  db.prepare(`
    UPDATE drama_jobs
    SET status = ?, completed_at = CASE WHEN ? IN ('completed','failed') THEN CURRENT_TIMESTAMP ELSE completed_at END
    WHERE job_id = ?
  `).run(status, status, jobId);
}

// ── シーン記録 ────────────────────────────────────────────────────────────────

export async function insertScenes({ jobId, scenes }) {
  const db = getDb();
  if (!db) return;

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO drama_scenes
      (job_id, scene_index, emotional_beat, emotion_trigger, shot_type, motion_code, image_path, clip_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows) => {
    for (const s of rows) stmt.run(s.jobId, s.sceneIndex, s.emotionalBeat, s.emotionTrigger ?? null, s.shotType ?? null, s.motionCode ?? null, s.imagePath ?? null, s.clipPath ?? null);
  });

  insertMany(scenes.map(s => ({ jobId, ...s })));
}

// ── 評価スコア記録 ────────────────────────────────────────────────────────────

export async function insertEvalResult({ jobId, iteration = 0, evalReport, isBest = false }) {
  const db = getDb();
  if (!db) return;

  const s = evalReport.scores ?? {};

  db.prepare(`
    INSERT INTO drama_eval
      (job_id, iteration, total_score,
       hook_score, anger_score, empathy_score, frenzy_score, viral_score,
       cliffhanger_score, character_score, drama_score, subtitle_score, audio_score,
       improvements, is_best)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobId, iteration, evalReport.totalScore,
    s.hook?.score ?? null,
    s.anger?.score ?? null,
    s.empathy?.score ?? null,
    s.frenzy?.score ?? null,
    s.viral?.score ?? null,
    s.cliffhanger?.score ?? null,
    s.character?.score ?? null,
    s.drama?.score ?? null,
    s.subtitle?.score ?? null,
    s.audio?.score ?? null,
    JSON.stringify(evalReport.improvements ?? []),
    isBest ? 1 : 0,
  );
}

export async function markEvalAsBest(jobId, iteration) {
  const db = getDb();
  if (!db) return;

  db.prepare(`UPDATE drama_eval SET is_best = 0 WHERE job_id = ?`).run(jobId);
  db.prepare(`UPDATE drama_eval SET is_best = 1 WHERE job_id = ? AND iteration = ?`).run(jobId, iteration);
}

// ── コンセプト履歴記録 ────────────────────────────────────────────────────────

export async function insertConceptHistory({ jobId, concept, genre, evalReport, finalVideoPath }) {
  const db = getDb();
  if (!db) return;

  const s = evalReport?.scores ?? {};
  db.prepare(`
    INSERT INTO drama_concept_history
      (job_id, concept, genre, total_score, hook_score, anger_score, frenzy_score, final_video_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobId, concept, genre ?? null,
    evalReport?.totalScore ?? null,
    s.hook?.score ?? null,
    s.anger?.score ?? null,
    s.frenzy?.score ?? null,
    finalVideoPath ?? null,
  );
}

// ── 感情パターン更新 ──────────────────────────────────────────────────────────

export async function upsertEmotionPattern({ arcTemplate, emotionalBeatSequence, emotionTriggerSequence, evalReport }) {
  const db = getDb();
  if (!db) return;

  const beatSeq = JSON.stringify(emotionalBeatSequence);
  const triggerSeq = JSON.stringify(emotionTriggerSequence);
  const s = evalReport?.scores ?? {};

  const existing = db.prepare(`
    SELECT id, sample_count, avg_total_score, avg_anger_score, avg_empathy_score, avg_frenzy_score
    FROM drama_emotion_patterns
    WHERE arc_template = ? AND emotional_beat_sequence = ?
  `).get(arcTemplate, beatSeq);

  if (existing) {
    const n = existing.sample_count;
    const avg = (prev, cur) => cur == null ? prev : ((prev ?? 0) * n + cur) / (n + 1);
    db.prepare(`
      UPDATE drama_emotion_patterns
      SET sample_count = ?, avg_total_score = ?, avg_anger_score = ?, avg_empathy_score = ?, avg_frenzy_score = ?, last_used_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      n + 1,
      avg(existing.avg_total_score, evalReport?.totalScore),
      avg(existing.avg_anger_score, s.anger?.score),
      avg(existing.avg_empathy_score, s.empathy?.score),
      avg(existing.avg_frenzy_score, s.frenzy?.score),
      existing.id,
    );
  } else {
    db.prepare(`
      INSERT INTO drama_emotion_patterns
        (arc_template, emotional_beat_sequence, emotion_trigger_sequence, avg_total_score, avg_anger_score, avg_empathy_score, avg_frenzy_score)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      arcTemplate, beatSeq, triggerSeq,
      evalReport?.totalScore ?? null,
      s.anger?.score ?? null,
      s.empathy?.score ?? null,
      s.frenzy?.score ?? null,
    );
  }
}

// ── TikTok 実績メトリクス記録 ─────────────────────────────────────────────────

export async function insertMetrics({ jobId, views, watchTimeAvgSec, completionRate, comments, shares, hookRetention3s, platform = 'tiktok' }) {
  const db = getDb();
  if (!db) return;

  const commentRate = (comments && views) ? comments / views : null;
  const shareRate   = (shares && views)   ? shares / views   : null;

  db.prepare(`
    INSERT INTO drama_metrics
      (job_id, platform, views, watch_time_avg_sec, completion_rate, comments, shares, comment_rate, share_rate, hook_retention_3s)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(jobId, platform, views ?? null, watchTimeAvgSec ?? null, completionRate ?? null, comments ?? null, shares ?? null, commentRate, shareRate, hookRetention3s ?? null);
}

// ── 参照用クエリ ──────────────────────────────────────────────────────────────

/** 過去の高スコアパターンを取得（スクリプト生成の参考に使う） */
export function getTopEmotionPatterns(limit = 5) {
  const db = getDb();
  if (!db) return [];

  return db.prepare(`
    SELECT arc_template, emotional_beat_sequence, emotion_trigger_sequence,
           avg_total_score, avg_anger_score, avg_empathy_score, avg_frenzy_score, sample_count
    FROM drama_emotion_patterns
    WHERE sample_count >= 2
    ORDER BY avg_total_score DESC
    LIMIT ?
  `).all(limit);
}

/** 似たコンセプトの過去実績を取得 */
export function getSimilarConceptHistory(genre, limit = 3) {
  const db = getDb();
  if (!db) return [];

  return db.prepare(`
    SELECT concept, total_score, hook_score, anger_score, frenzy_score, created_at
    FROM drama_concept_history
    WHERE genre = ? AND total_score IS NOT NULL
    ORDER BY total_score DESC
    LIMIT ?
  `).all(genre, limit);
}

/** ジョブの最終evalスコアサマリーを取得 */
export function getJobEvalSummary(jobId) {
  const db = getDb();
  if (!db) return null;

  return db.prepare(`
    SELECT total_score, hook_score, anger_score, empathy_score, frenzy_score, viral_score, cliffhanger_score
    FROM drama_eval
    WHERE job_id = ? AND is_best = 1
    LIMIT 1
  `).get(jobId);
}
