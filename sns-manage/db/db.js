import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// シングルトンインスタンス
let _db = null;
let _initialized = false;

// 非同期初期化（モジュールロード時に一度だけ実行）
const dbPromise = (async () => {
  if (_initialized) return _db;
  _initialized = true;

  try {
    const mod = await import('better-sqlite3').catch(() => null);
    if (!mod) {
      console.warn('[db] better-sqlite3 が見つかりません。DB機能は無効化されます。');
      return null;
    }

    const Database = mod.default;
    _db = new Database(config.DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');

    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    _db.exec(schema);

    // metricsテーブルへのカラム追加（冪等 — 既に存在する場合はスキップ）
    for (const sql of [
      `ALTER TABLE metrics ADD COLUMN follower_delta INTEGER DEFAULT 0`,
      `ALTER TABLE metrics ADD COLUMN link_clicks    INTEGER DEFAULT 0`,
    ]) {
      try { _db.exec(sql); } catch { /* カラム既存時はスキップ */ }
    }

    return _db;
  } catch (err) {
    console.warn(`[db] DB初期化失敗: ${err.message}`);
    return null;
  }
})();

/**
 * 初期化済みDBインスタンスを返す。
 * @returns {Promise<import('better-sqlite3').Database | null>}
 */
export async function getDb() {
  return dbPromise;
}

// ---- CRUD ヘルパー ----

/**
 * ジョブを挿入する。
 * @param {{ id: string, topic: string, category?: string, platforms: string[], params?: object }} job
 */
export async function insertJob({ id, topic, category = 'general', platforms, params }) {
  const db = await getDb();
  if (!db) return;
  db.prepare(`
    INSERT INTO jobs (id, topic, category, platforms, params)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, topic, category, JSON.stringify(platforms), params ? JSON.stringify(params) : null);
}

/**
 * ジョブのステータスを更新する。
 * @param {string} jobId
 * @param {'running'|'completed'|'failed'|'approved'} status
 */
export async function updateJobStatus(jobId, status) {
  const db = await getDb();
  if (!db) return;
  const completedAt = status === 'completed' || status === 'failed' ? new Date().toISOString() : null;
  db.prepare(`
    UPDATE jobs SET status = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?
  `).run(status, completedAt, jobId);
}

/**
 * ジョブの params を追記マージ更新する。
 * @param {string} jobId
 * @param {object} extraParams
 */
export async function updateJobParams(jobId, extraParams) {
  const db = await getDb();
  if (!db) return;
  const row = db.prepare('SELECT params FROM jobs WHERE id = ?').get(jobId);
  const existing = row?.params ? JSON.parse(row.params) : {};
  const merged = { ...existing, ...extraParams };
  db.prepare('UPDATE jobs SET params = ? WHERE id = ?').run(JSON.stringify(merged), jobId);
}

/**
 * ジョブを1件取得する。
 * @param {string} jobId
 * @returns {object|null}
 */
export async function getJob(jobId) {
  const db = await getDb();
  if (!db) return null;
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!row) return null;
  return {
    ...row,
    platforms: JSON.parse(row.platforms),
    params: row.params ? JSON.parse(row.params) : null,
  };
}

/**
 * ジョブ一覧を取得する（新しい順）。
 * @param {number} limit
 * @returns {object[]}
 */
export async function getJobs(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  const rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit);
  return rows.map(row => ({
    ...row,
    platforms: JSON.parse(row.platforms),
    params: row.params ? JSON.parse(row.params) : null,
  }));
}

/**
 * コンテンツを挿入する。
 * @param {{ jobId: string, platform: string, variantId?: string, type: string, body: string, metadata?: object }} content
 * @returns {number} 挿入したID
 */
export async function insertContent({ jobId, platform, variantId = 'A', type, body, metadata }) {
  const db = await getDb();
  if (!db) return 0;
  const result = db.prepare(`
    INSERT INTO contents (job_id, platform, variant_id, type, body, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(jobId, platform, variantId, type, body, metadata ? JSON.stringify(metadata) : null);
  return result.lastInsertRowid;
}

/**
 * ジョブのコンテンツ一覧を取得する。
 * @param {string} jobId
 * @returns {object[]}
 */
export async function getContents(jobId) {
  const db = await getDb();
  if (!db) return [];
  const rows = db.prepare('SELECT * FROM contents WHERE job_id = ? ORDER BY id').all(jobId);
  return rows.map(row => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  }));
}

/**
 * 投稿レコードを挿入する。
 * @param {{ jobId: string, contentId?: number, platform: string, variantId?: string }} post
 * @returns {number} 挿入したID
 */
export async function insertPost({ jobId, contentId, platform, variantId = 'A' }) {
  const db = await getDb();
  if (!db) return 0;
  const result = db.prepare(`
    INSERT INTO posts (job_id, content_id, platform, variant_id)
    VALUES (?, ?, ?, ?)
  `).run(jobId, contentId || null, platform, variantId);
  return result.lastInsertRowid;
}

/**
 * 投稿レコードを更新する。
 * @param {number} postId
 * @param {{ postId?: string, postUrl?: string, status?: string, publishedAt?: string, errorMsg?: string }} fields
 */
export async function updatePost(postId, { postId: externalPostId, postUrl, status, publishedAt, errorMsg } = {}) {
  const db = await getDb();
  if (!db) return;
  db.prepare(`
    UPDATE posts
    SET
      post_id      = COALESCE(?, post_id),
      post_url     = COALESCE(?, post_url),
      status       = COALESCE(?, status),
      published_at = COALESCE(?, published_at),
      error_msg    = COALESCE(?, error_msg)
    WHERE id = ?
  `).run(externalPostId || null, postUrl || null, status || null, publishedAt || null, errorMsg || null, postId);
}

/**
 * ジョブの投稿一覧を取得する。
 * @param {string} jobId
 * @returns {object[]}
 */
export async function getPostsByJob(jobId) {
  const db = await getDb();
  if (!db) return [];
  return db.prepare('SELECT * FROM posts WHERE job_id = ? ORDER BY id').all(jobId);
}

/**
 * ジョブ内の全pendingポストをapprovedに変更する。
 * @param {string} jobId
 */
export async function approvePost(jobId) {
  const db = await getDb();
  if (!db) return;
  db.prepare(`
    UPDATE posts SET status = 'approved' WHERE job_id = ? AND status = 'pending'
  `).run(jobId);
}

/**
 * メトリクスを挿入する。
 * @param {{ postId: number, impressions?: number, likes?: number, comments?: number, shares?: number, engagementRate?: number, reach?: number, saves?: number, profileVisits?: number, retention3s?: number, completionRate?: number }} metrics
 */
export async function insertMetrics({
  postId,
  impressions = 0,
  likes = 0,
  comments = 0,
  shares = 0,
  engagementRate = 0,
  reach = 0,
  saves = 0,
  profileVisits = 0,
  retention3s = 0,
  completionRate = 0,
}) {
  const db = await getDb();
  if (!db) return;
  db.prepare(`
    INSERT INTO metrics
      (post_id, impressions, likes, comments, shares, engagement_rate,
       reach, saves, profile_visits, retention_3s, completion_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(postId, impressions, likes, comments, shares, engagementRate, reach, saves, profileVisits, retention3s, completionRate);
}

/**
 * 採択パターンを挿入する。
 * @param {{ platform: string, category?: string, hookVariant: string, engagementLift: number, baseEngagement: number, winEngagement: number, impressions: number, contentSnippet?: string, notes?: string }} pattern
 */
export async function insertPattern({
  platform,
  category = 'general',
  hookVariant,
  engagementLift,
  baseEngagement,
  winEngagement,
  impressions,
  contentSnippet,
  notes,
}) {
  const db = await getDb();
  if (!db) return;
  db.prepare(`
    INSERT INTO patterns
      (platform, category, hook_variant, engagement_lift, base_engagement,
       win_engagement, impressions, content_snippet, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(platform, category, hookVariant, engagementLift, baseEngagement, winEngagement, impressions, contentSnippet || null, notes || null);
}

/**
 * エンゲージメントリフトの高い採択パターンを取得する。
 * @param {number} limit
 * @returns {object[]}
 */
export async function getTopPatterns(limit = 5) {
  const db = await getDb();
  if (!db) return [];
  return db.prepare(`
    SELECT * FROM patterns ORDER BY engagement_lift DESC LIMIT ?
  `).all(limit);
}

/**
 * リサーチキャッシュを取得する（期限切れは無効）。
 * @param {string} cacheKey
 * @returns {unknown|null}
 */
export async function getCachedResearch(cacheKey) {
  const db = await getDb();
  if (!db) return null;
  const row = db.prepare(`
    SELECT result FROM research_cache
    WHERE cache_key = ? AND expires_at > datetime('now')
  `).get(cacheKey);
  return row ? JSON.parse(row.result) : null;
}

/**
 * リサーチ結果をキャッシュに保存する。
 * @param {string} cacheKey
 * @param {unknown} result
 * @param {number} ttlHours TTL（時間）
 */
export async function setCachedResearch(cacheKey, result, ttlHours = 24) {
  const db = await getDb();
  if (!db) return;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO research_cache (cache_key, result, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET result = excluded.result, expires_at = excluded.expires_at
  `).run(cacheKey, JSON.stringify(result), expiresAt);
}

/**
 * 分析スケジュールを登録する。
 * @param {{ postId: number, jobId: string, platform: string, delayHours: number }} params
 */
export async function insertAnalyticsSchedule({ postId, jobId, platform, delayHours }) {
  const db = await getDb();
  if (!db) return;
  const scheduledAt = new Date(Date.now() + delayHours * 3600_000).toISOString();
  db.prepare(`
    INSERT INTO analytics_schedule (post_id, job_id, platform, scheduled_at, delay_hours)
    VALUES (?, ?, ?, ?, ?)
  `).run(postId, jobId, platform, scheduledAt, delayHours);
}

/**
 * 実行待ちの分析スケジュールを返す（scheduled_at <= now）。
 * @returns {object[]}
 */
export async function getPendingAnalytics() {
  const db = await getDb();
  if (!db) return [];
  return db.prepare(`
    SELECT * FROM analytics_schedule
    WHERE status = 'pending' AND scheduled_at <= datetime('now')
    ORDER BY scheduled_at ASC
  `).all();
}

/**
 * 分析スケジュールを完了にする。
 * @param {number} scheduleId
 */
export async function markAnalyticsCompleted(scheduleId) {
  const db = await getDb();
  if (!db) return;
  db.prepare(`
    UPDATE analytics_schedule
    SET status = 'completed', executed_at = datetime('now')
    WHERE id = ?
  `).run(scheduleId);
}

/**
 * PDCAレポートを挿入する。
 */
export async function insertPdcaReport({ reportType, periodStart, periodEnd, summary, topPattern, avgEngagement, totalReach }) {
  const db = await getDb();
  if (!db) return;
  db.prepare(`
    INSERT INTO pdca_reports
      (report_type, period_start, period_end, summary, top_pattern, avg_engagement, total_reach)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(reportType, periodStart, periodEnd, summary, topPattern || null, avgEngagement || null, totalReach || null);
}

/**
 * 直近N日のメトリクスを日付別に集計する（グラフ用）。
 * @param {number} days
 * @returns {object[]}
 */
export async function getRecentMetrics(days = 7) {
  const db = await getDb();
  if (!db) return [];
  return db.prepare(`
    SELECT
      date(m.measured_at) AS date,
      p.platform,
      ROUND(AVG(m.engagement_rate), 4) AS avg_engagement_rate,
      SUM(m.impressions) AS total_impressions,
      SUM(m.likes) AS total_likes,
      SUM(m.link_clicks) AS total_link_clicks,
      SUM(m.follower_delta) AS total_follower_delta
    FROM metrics m
    JOIN posts p ON p.id = m.post_id
    WHERE m.measured_at >= datetime('now', ?)
    GROUP BY date(m.measured_at), p.platform
    ORDER BY date ASC
  `).all(`-${days} days`);
}

/**
 * エンゲージメント率上位の投稿を返す。
 * @param {number} limit
 * @returns {object[]}
 */
export async function getTopPerformingPosts(limit = 5) {
  const db = await getDb();
  if (!db) return [];
  return db.prepare(`
    SELECT
      p.id, p.job_id, p.platform, p.post_url, p.published_at,
      m.impressions, m.likes, m.engagement_rate,
      m.link_clicks, m.follower_delta,
      c.body AS caption
    FROM posts p
    JOIN metrics m ON m.post_id = p.id
    LEFT JOIN contents c ON c.id = p.content_id
    WHERE p.status = 'published'
    ORDER BY m.engagement_rate DESC
    LIMIT ?
  `).all(limit);
}

/**
 * 最新のPDCAレポートを1件取得する。
 * @returns {object|null}
 */
export async function getLatestPdcaReport() {
  const db = await getDb();
  if (!db) return null;
  return db.prepare(
    `SELECT * FROM pdca_reports ORDER BY created_at DESC LIMIT 1`
  ).get() || null;
}

/**
 * 日次スナップショットをDBに保存する（INSERT OR REPLACE）。
 * @param {{ snapshotDate: string, platform: string, impressions?: number, likes?: number, comments?: number, shares?: number, engagementRate?: number, followerDelta?: number, linkClicks?: number, postCount?: number }} snap
 */
export async function upsertDailySnapshot({
  snapshotDate,
  platform,
  impressions = 0,
  likes = 0,
  comments = 0,
  shares = 0,
  engagementRate = 0,
  followerDelta = 0,
  linkClicks = 0,
  postCount = 0,
}) {
  const db = await getDb();
  if (!db) return;
  db.prepare(`
    INSERT INTO daily_snapshots
      (snapshot_date, platform, impressions, likes, comments, shares, engagement_rate, follower_delta, link_clicks, post_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_date, platform) DO UPDATE SET
      impressions     = excluded.impressions,
      likes           = excluded.likes,
      comments        = excluded.comments,
      shares          = excluded.shares,
      engagement_rate = excluded.engagement_rate,
      follower_delta  = excluded.follower_delta,
      link_clicks     = excluded.link_clicks,
      post_count      = excluded.post_count
  `).run(snapshotDate, platform, impressions, likes, comments, shares, engagementRate, followerDelta, linkClicks, postCount);
}

/**
 * 直近N日の日次スナップショットを返す（グラフ用）。
 * @param {number} days
 * @returns {object[]}
 */
export async function getDailySnapshots(days = 14) {
  const db = await getDb();
  if (!db) return [];
  return db.prepare(`
    SELECT * FROM daily_snapshots
    WHERE snapshot_date >= date('now', ?)
    ORDER BY snapshot_date ASC, platform ASC
  `).all(`-${days} days`);
}

/**
 * 今週 vs 先週のKPI比較データを返す。
 * @returns {{ thisWeek: object, lastWeek: object, changes: object }}
 */
export async function getWeeklyComparison() {
  const db = await getDb();
  if (!db) return { thisWeek: {}, lastWeek: {}, changes: {} };

  const aggregate = (rows) => ({
    impressions:    rows.reduce((s, r) => s + (r.impressions || 0), 0),
    likes:          rows.reduce((s, r) => s + (r.likes || 0), 0),
    comments:       rows.reduce((s, r) => s + (r.comments || 0), 0),
    shares:         rows.reduce((s, r) => s + (r.shares || 0), 0),
    followerDelta:  rows.reduce((s, r) => s + (r.follower_delta || 0), 0),
    linkClicks:     rows.reduce((s, r) => s + (r.link_clicks || 0), 0),
    postCount:      rows.reduce((s, r) => s + (r.post_count || 0), 0),
    avgEngagement:  rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + (r.engagement_rate || 0), 0) / rows.length * 10000) / 10000
      : 0,
  });

  const thisWeekRows = db.prepare(`
    SELECT * FROM daily_snapshots
    WHERE snapshot_date >= date('now', '-7 days') AND snapshot_date <= date('now')
  `).all();

  const lastWeekRows = db.prepare(`
    SELECT * FROM daily_snapshots
    WHERE snapshot_date >= date('now', '-14 days') AND snapshot_date < date('now', '-7 days')
  `).all();

  const thisWeek = aggregate(thisWeekRows);
  const lastWeek = aggregate(lastWeekRows);

  const pct = (a, b) => b === 0 ? null : Math.round((a - b) / b * 100);

  const changes = {
    impressions:   pct(thisWeek.impressions, lastWeek.impressions),
    likes:         pct(thisWeek.likes, lastWeek.likes),
    comments:      pct(thisWeek.comments, lastWeek.comments),
    followerDelta: pct(thisWeek.followerDelta, lastWeek.followerDelta),
    linkClicks:    pct(thisWeek.linkClicks, lastWeek.linkClicks),
    avgEngagement: pct(thisWeek.avgEngagement, lastWeek.avgEngagement),
  };

  return { thisWeek, lastWeek, changes };
}

/**
 * 週次AIレポートをDBに保存する。
 */
export async function insertWeeklyReport({ weekStart, weekEnd, aiInsights, topPostId, summaryJson }) {
  const db = await getDb();
  if (!db) return;
  db.prepare(`
    INSERT INTO weekly_reports (week_start, week_end, ai_insights, top_post_id, summary_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(weekStart, weekEnd, typeof aiInsights === 'string' ? aiInsights : JSON.stringify(aiInsights), topPostId || null, typeof summaryJson === 'string' ? summaryJson : JSON.stringify(summaryJson));
}

/**
 * 最新の週次レポートを返す。
 */
export async function getLatestWeeklyReport() {
  const db = await getDb();
  if (!db) return null;
  const row = db.prepare(`SELECT * FROM weekly_reports ORDER BY created_at DESC LIMIT 1`).get();
  if (!row) return null;
  return {
    ...row,
    aiInsights: row.ai_insights ? JSON.parse(row.ai_insights) : null,
    summaryJson: row.summary_json ? JSON.parse(row.summary_json) : null,
  };
}

/**
 * 週次レポート履歴を返す。
 */
export async function getWeeklyReports(limit = 4) {
  const db = await getDb();
  if (!db) return [];
  const rows = db.prepare(`SELECT * FROM weekly_reports ORDER BY created_at DESC LIMIT ?`).all(limit);
  return rows.map(row => ({
    ...row,
    aiInsights: row.ai_insights ? JSON.parse(row.ai_insights) : null,
    summaryJson: row.summary_json ? JSON.parse(row.summary_json) : null,
  }));
}

// ============================================================
// 永続資産レイヤー: 知識蓄積関数
// ============================================================

/**
 * 負けパターンを記録する。
 */
export async function insertFailurePattern({
  platform, category = 'general', hookVariant, hookType = 'unknown',
  failureMode, failureReason, avoidanceRule, experimentInsight,
  engagementFloor = 0, impressions = 0, contentSnippet, notes,
}) {
  const db = await getDb();
  if (!db) return;
  db.prepare(`
    INSERT INTO failure_patterns
      (platform, category, hook_variant, hook_type, failure_mode, failure_reason,
       avoidance_rule, experiment_insight, engagement_floor, impressions, content_snippet, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(platform, category, hookVariant, hookType, failureMode, failureReason,
    avoidanceRule, experimentInsight || null, engagementFloor, impressions,
    contentSnippet || null, notes || null);
}

/**
 * 負けパターン上位をエンゲージメント下限順で返す。
 * @param {number} limit
 */
export async function getTopFailures(limit = 5) {
  const db = await getDb();
  if (!db) return [];
  return db.prepare(`
    SELECT * FROM failure_patterns ORDER BY recorded_at DESC LIMIT ?
  `).all(limit);
}

/**
 * 知識ベースを更新/挿入する（confidence の積み上げロジック含む）。
 * - 同一 insight_key が存在する場合: evidence_count++、confidence を上昇
 * - 存在しない場合: 新規挿入
 */
export async function upsertKnowledgeBase({
  insightKey, category, platform = null, statement, status = 'active', contradictionNote = null,
}) {
  const db = await getDb();
  if (!db) return;

  const existing = db.prepare(`SELECT * FROM knowledge_base WHERE insight_key = ?`).get(insightKey);

  if (existing) {
    const newCount = existing.evidence_count + 1;
    // 証拠が増えるほど信頼度が上昇（最大0.95）
    const newConfidence = Math.min(0.95, existing.confidence + 0.08);
    db.prepare(`
      UPDATE knowledge_base
      SET evidence_count = ?, confidence = ?, last_reinforced_at = datetime('now'),
          status = COALESCE(?, status),
          contradiction_note = COALESCE(?, contradiction_note)
      WHERE insight_key = ?
    `).run(newCount, newConfidence, status !== 'active' ? status : null,
      contradictionNote, insightKey);
  } else {
    db.prepare(`
      INSERT INTO knowledge_base (insight_key, category, platform, statement, evidence_count, confidence, status)
      VALUES (?, ?, ?, ?, 1, 0.5, ?)
    `).run(insightKey, category, platform, statement, status);
  }
}

/**
 * 知識ベースの注入用データを返す（activeなもののみ、confidence高い順）。
 * @param {{ category?: string, platform?: string, limit?: number }}
 */
export async function getKnowledgeBase({ category = null, platform = null, limit = 10 } = {}) {
  const db = await getDb();
  if (!db) return [];

  let sql = `SELECT * FROM knowledge_base WHERE status = 'active'`;
  const params = [];
  if (category) { sql += ` AND category = ?`; params.push(category); }
  if (platform) { sql += ` AND (platform = ? OR platform IS NULL)`; params.push(platform); }
  sql += ` ORDER BY confidence DESC, evidence_count DESC LIMIT ?`;
  params.push(limit);

  return db.prepare(sql).all(...params);
}

/**
 * 欲望地図を挿入（UPSERT: cache_key で重複排除）。
 */
export async function upsertDesireMap({
  topic, platform, mediatorType, triggerEmotion, spreadPattern,
  desireObject, desireSubject, examples, cacheKey,
}) {
  const db = await getDb();
  if (!db) return;
  const key = cacheKey || `${topic}-${platform}`;
  db.prepare(`
    INSERT INTO desire_map
      (topic, platform, mediator_type, trigger_emotion, spread_pattern,
       desire_object, desire_subject, examples, cache_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      mediator_type   = excluded.mediator_type,
      trigger_emotion = excluded.trigger_emotion,
      spread_pattern  = excluded.spread_pattern,
      desire_object   = excluded.desire_object,
      desire_subject  = excluded.desire_subject,
      examples        = excluded.examples,
      observed_at     = datetime('now')
  `).run(topic, platform, mediatorType || null, triggerEmotion || null,
    spreadPattern || null, desireObject || null, desireSubject || null,
    examples ? JSON.stringify(examples) : null, key);
}

/**
 * 欲望地図をトピック・プラットフォームで検索する。
 */
export async function getDesireMap(topic, platform) {
  const db = await getDb();
  if (!db) return null;
  const row = db.prepare(`
    SELECT * FROM desire_map WHERE topic = ? AND platform = ? ORDER BY observed_at DESC LIMIT 1
  `).get(topic, platform);
  if (!row) return null;
  return { ...row, examples: row.examples ? JSON.parse(row.examples) : [] };
}

/**
 * 実験ログを記録する。
 */
export async function insertExperimentLog({
  jobId, platform, hypothesis,
  variantADescription, variantBDescription,
  variantAEngagement, variantBEngagement,
  variantAImpressions, variantBImpressions,
  winner, lift, insight,
  supportsDesireTheory = 0,
  supportsAntifragility = 0,
}) {
  const db = await getDb();
  if (!db) return;
  db.prepare(`
    INSERT INTO experiment_log
      (job_id, platform, hypothesis, variant_a_description, variant_b_description,
       variant_a_engagement, variant_b_engagement, variant_a_impressions, variant_b_impressions,
       winner, lift, insight, supports_desire_theory, supports_antifragility)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(jobId, platform, hypothesis, variantADescription, variantBDescription || null,
    variantAEngagement || null, variantBEngagement || null,
    variantAImpressions || null, variantBImpressions || null,
    winner || null, lift || null, insight || null,
    supportsDesireTheory, supportsAntifragility);
}

/**
 * オーディエンス指紋を更新する（UPSERT）。
 */
export async function upsertAudienceFingerprint({ platform, category = 'general', characteristic, exampleContent }) {
  const db = await getDb();
  if (!db) return;
  const existing = db.prepare(`
    SELECT * FROM audience_fingerprint WHERE platform = ? AND category = ? AND characteristic = ?
  `).get(platform, category, characteristic);

  if (existing) {
    const newCount = existing.evidence_count + 1;
    const newConfidence = Math.min(0.95, existing.confidence + 0.06);
    db.prepare(`
      UPDATE audience_fingerprint
      SET evidence_count = ?, confidence = ?, last_updated = datetime('now'),
          example_content = COALESCE(?, example_content)
      WHERE platform = ? AND category = ? AND characteristic = ?
    `).run(newCount, newConfidence, exampleContent || null, platform, category, characteristic);
  } else {
    db.prepare(`
      INSERT INTO audience_fingerprint (platform, category, characteristic, evidence_count, confidence, example_content)
      VALUES (?, ?, ?, 1, 0.5, ?)
    `).run(platform, category, characteristic, exampleContent || null);
  }
}

/**
 * 直近の実験ログを取得する。
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
export async function getRecentExperiments(limit = 30) {
  const db = await getDb();
  if (!db) return [];
  return db.prepare(`
    SELECT platform, hypothesis, winner, lift, supports_desire_theory, supports_antifragility
    FROM experiment_log
    ORDER BY recorded_at DESC
    LIMIT ?
  `).all(limit);
}

/**
 * オーディエンス指紋を返す（confidence高い順）。
 */
export async function getAudienceFingerprint(platform, category = 'general', limit = 5) {
  const db = await getDb();
  if (!db) return [];
  return db.prepare(`
    SELECT * FROM audience_fingerprint
    WHERE platform = ? AND category = ?
    ORDER BY confidence DESC, evidence_count DESC
    LIMIT ?
  `).all(platform, category, limit);
}
