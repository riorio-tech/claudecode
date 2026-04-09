import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../../config.js';
import {
  getDb,
  upsertDailySnapshot,
  getDailySnapshots,
  getWeeklyComparison,
  getTopPerformingPosts,
  getLatestPdcaReport,
  insertWeeklyReport,
  getLatestWeeklyReport,
} from '../../db/db.js';
import { appendDailySnapshot, appendWeeklyReport } from './sheets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(__dirname, '../../reports/memory');

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

/**
 * メモリディレクトリが存在しない場合は作成する。
 */
function ensureMemoryDir() {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

/**
 * インサイトをメモリフォルダに保存する。
 * @param {string} filename
 * @param {object} data
 */
function saveToMemory(filename, data) {
  ensureMemoryDir();
  const path = join(MEMORY_DIR, filename);
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[09_report] メモリ保存: ${path}`);
}

/**
 * 今日の日付文字列 (YYYY-MM-DD, JST) を返す。
 */
function todayJST() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

/**
 * 日次スナップショットを取得してDBとGoogle Sheetsに保存する。
 * 毎日0時に scheduler から呼ばれる。
 */
export async function takeDailySnapshot() {
  const snapshotDate = todayJST();
  console.log(`[09_report] 日次スナップショット開始: ${snapshotDate}`);

  // 直近7日のメトリクスを集計して今日の数字を算出
  const snapshots7d = await getDailySnapshots(7);

  // プラットフォーム別に集計（today分だけ使う or 7日平均をfallback）
  // 実際には07_analyticsが収集した当日データを使う
  // ここではdaily_snapshotsに「今日投稿分のメトリクス合計」を保存する
  const platforms = ['twitter', 'tiktok', 'youtube', 'instagram'];
  const savedSnapshots = [];

  for (const platform of platforms) {
    // その日のメトリクスをDBから直接集計
    const db = await getDb();
    if (!db) continue;

    const row = db.prepare(`
      SELECT
        COUNT(DISTINCT p.id) AS post_count,
        SUM(m.impressions)   AS impressions,
        SUM(m.likes)         AS likes,
        SUM(m.comments)      AS comments,
        SUM(m.shares)        AS shares,
        AVG(m.engagement_rate) AS engagement_rate,
        SUM(m.follower_delta)  AS follower_delta,
        SUM(m.link_clicks)     AS link_clicks
      FROM posts p
      JOIN metrics m ON m.post_id = p.id
      WHERE p.platform = ?
        AND date(m.measured_at) = ?
        AND p.status = 'published'
    `).get(platform, snapshotDate);

    if (!row || row.post_count === 0) continue;

    const snap = {
      snapshotDate,
      platform,
      impressions:    row.impressions    || 0,
      likes:          row.likes          || 0,
      comments:       row.comments       || 0,
      shares:         row.shares         || 0,
      engagementRate: Math.round((row.engagement_rate || 0) * 10000) / 10000,
      followerDelta:  row.follower_delta || 0,
      linkClicks:     row.link_clicks    || 0,
      postCount:      row.post_count     || 0,
    };

    await upsertDailySnapshot(snap);
    savedSnapshots.push(snap);
  }

  // Google Sheets に追記
  if (savedSnapshots.length > 0) {
    try {
      await appendDailySnapshot(savedSnapshots);
    } catch (err) {
      console.warn(`[09_report] Sheets書き込みエラー: ${err.message}`);
    }
  }

  console.log(`[09_report] 日次スナップショット完了: ${savedSnapshots.length}件`);
  return { snapshotDate, count: savedSnapshots.length, snapshots: savedSnapshots };
}

/**
 * 週次AIレポートを生成してDBとGoogle Sheetsに保存する。
 * 毎週月曜0時に scheduler から呼ばれる。
 */
export async function generateWeeklyReport() {
  console.log('[09_report] 週次レポート生成開始');

  // 今週 vs 先週の比較データ
  const { thisWeek, lastWeek, changes } = await getWeeklyComparison();
  const topPosts = await getTopPerformingPosts(5);
  const snapshots14d = await getDailySnapshots(14);

  // 週の日付範囲
  const now = new Date(Date.now() + 9 * 3600_000);
  const weekEnd = now.toISOString().slice(0, 10);
  const weekStartDate = new Date(now.getTime() - 6 * 86400_000);
  const weekStart = weekStartDate.toISOString().slice(0, 10);

  // Claude Sonnet にインサイト生成を依頼
  const prompt = `あなたはSNSマーケティングの専門家です。以下の今週と先週のデータを分析し、クライアントに向けた週次レポートをJSON形式で生成してください。

## 今週のKPI
${JSON.stringify(thisWeek, null, 2)}

## 先週のKPI
${JSON.stringify(lastWeek, null, 2)}

## 先週比変化率（%）
${JSON.stringify(changes, null, 2)}

## 今週のTop投稿（エンゲージ率順）
${JSON.stringify(topPosts.slice(0, 3), null, 2)}

## 日次トレンド（直近14日）
プラットフォーム別の日次データ行数: ${snapshots14d.length}件

以下の形式でJSONを出力してください:
{
  "summary": "今週全体の1〜2文の総評（日本語）",
  "highlights": [
    { "type": "good", "metric": "指標名", "description": "良かった点の説明" },
    { "type": "bad",  "metric": "指標名", "description": "悪かった点の説明" }
  ],
  "suggestions": [
    { "priority": 1, "category": "コンテンツ|タイミング|ハッシュタグ|形式", "action": "具体的な改善アクション", "expectedEffect": "期待される効果" },
    { "priority": 2, "category": "...", "action": "...", "expectedEffect": "..." },
    { "priority": 3, "category": "...", "action": "...", "expectedEffect": "..." }
  ],
  "nextWeekFocus": "来週最も力を入れるべき1点",
  "riskAlert": "注意すべきリスクや懸念事項（なければnull）"
}`;

  let aiInsights;
  try {
    const response = await client.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    aiInsights = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: text, highlights: [], suggestions: [] };
  } catch (err) {
    console.warn(`[09_report] AI生成エラー: ${err.message}`);
    aiInsights = { summary: 'データ不足のため分析できませんでした', highlights: [], suggestions: [] };
  }

  const summaryJson = { ...thisWeek, weekStart, weekEnd };

  // DB保存
  const topPostId = topPosts[0]?.id || null;
  await insertWeeklyReport({ weekStart, weekEnd, aiInsights, topPostId, summaryJson });

  // Google Sheets 保存
  try {
    await appendWeeklyReport({ weekStart, weekEnd, aiInsights, summaryJson });
  } catch (err) {
    console.warn(`[09_report] Sheets週次レポートエラー: ${err.message}`);
  }

  // メモリフォルダに保存（将来のセッションで参照可能）
  const memoryData = {
    generatedAt: new Date().toISOString(),
    weekStart,
    weekEnd,
    kpiSummary: thisWeek,
    changes,
    aiInsights,
  };
  saveToMemory(`weekly_${weekStart}.json`, memoryData);

  // 最新インサイトを latest.json にも保存
  saveToMemory('latest.json', memoryData);

  console.log('[09_report] 週次レポート生成完了');
  return memoryData;
}

/**
 * 最新の週次レポートを取得する（API用）。
 */
export async function getLatestReport() {
  return getLatestWeeklyReport();
}
