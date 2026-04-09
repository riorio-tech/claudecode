import { google } from 'googleapis';
import { config } from '../../config.js';

/**
 * Google Sheets APIクライアントを初期化する。
 * GOOGLE_SERVICE_ACCOUNT_JSON が未設定の場合はnullを返す（graceful degradation）。
 */
function createSheetsClient() {
  if (!config.GOOGLE_SERVICE_ACCOUNT_JSON || !config.GOOGLE_SHEETS_ID) return null;
  try {
    const creds = JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth });
  } catch (err) {
    console.warn(`[sheets] 初期化失敗: ${err.message}`);
    return null;
  }
}

/**
 * 日次スナップショット行をスプレッドシートに追記する。
 * シート名: "Daily Metrics"
 * 列: 日付 | プラットフォーム | インプレッション | いいね | コメント | シェア | エンゲージ率 | フォロワー増減 | リンククリック | 投稿数
 */
export async function appendDailySnapshot(snapshots) {
  const sheets = createSheetsClient();
  if (!sheets) {
    console.warn('[sheets] Google Sheets未設定。スキップします。');
    return;
  }

  // ヘッダー行が存在するか確認し、なければ作成
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.GOOGLE_SHEETS_ID,
      range: 'Daily Metrics!A1:A1',
    });
    if (!res.data.values) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.GOOGLE_SHEETS_ID,
        range: 'Daily Metrics!A1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['日付', 'プラットフォーム', 'インプレッション', 'いいね', 'コメント', 'シェア', 'エンゲージ率', 'フォロワー増減', 'リンククリック', '投稿数']],
        },
      });
    }
  } catch {
    // シートが存在しない場合も続行
  }

  const rows = snapshots.map(s => [
    s.snapshotDate,
    s.platform,
    s.impressions,
    s.likes,
    s.comments,
    s.shares,
    s.engagementRate,
    s.followerDelta,
    s.linkClicks,
    s.postCount,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.GOOGLE_SHEETS_ID,
    range: 'Daily Metrics!A:J',
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  console.log(`[sheets] ${rows.length}行を Daily Metrics に追記しました`);
}

/**
 * 週次レポートをスプレッドシートに追記する。
 * シート名: "Weekly Reports"
 */
export async function appendWeeklyReport(report) {
  const sheets = createSheetsClient();
  if (!sheets) return;

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.GOOGLE_SHEETS_ID,
      range: 'Weekly Reports!A1:A1',
    });
    if (!res.data.values) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.GOOGLE_SHEETS_ID,
        range: 'Weekly Reports!A1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['期間開始', '期間終了', 'インプレッション', 'いいね', 'エンゲージ率', 'フォロワー増減', 'AIインサイト概要']],
        },
      });
    }
  } catch { /* skip */ }

  const summary = report.summaryJson || {};
  const insightSummary = Array.isArray(report.aiInsights?.suggestions)
    ? report.aiInsights.suggestions.slice(0, 2).map(s => s.action).join(' / ')
    : (report.aiInsights?.summary || '');

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.GOOGLE_SHEETS_ID,
    range: 'Weekly Reports!A:G',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        report.weekStart,
        report.weekEnd,
        summary.impressions || 0,
        summary.likes || 0,
        summary.avgEngagement || 0,
        summary.followerDelta || 0,
        insightSummary,
      ]],
    },
  });

  console.log('[sheets] Weekly Reports に追記しました');
}
