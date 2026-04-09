#!/usr/bin/env node
import cron from 'node-cron';
import { readFileSync, existsSync } from 'fs';
import { config } from './config.js';
import { runPipeline } from './orchestrator.js';
import { getPendingAnalytics, markAnalyticsCompleted } from './db/db.js';
import { logger } from './lib/logger.js';

// スケジューラーの状態
let isRunning = false;
let dailyTasks = [];   // 複数時刻分のタスク
let dailyTask = null;  // 後方互換用（最初のタスクを参照）
let analyticsTask = null;
let snapshotTask = null;   // 毎日0時スナップショット
let weeklyReportTask = null; // 毎週月曜0時レポート
let advisorTask = null;
let topicIndex = 0;  // topics.jsonを順番に使うインデックス
let usedTopicIndicesForToday = new Set();
let lastResetDate = '';

/**
 * topics.jsonから次のトピックを取得する。
 * ファイルがない/空の場合はデフォルトトピックを返す。
 */
function getNextTopic() {
  try {
    if (!existsSync(config.DAILY_TOPICS_FILE)) {
      return { topic: '今日のおすすめ情報', category: 'general', targetAudience: '一般' };
    }
    const topics = JSON.parse(readFileSync(config.DAILY_TOPICS_FILE, 'utf-8'));
    if (!topics.length) {
      return { topic: '今日のおすすめ情報', category: 'general', targetAudience: '一般' };
    }
    // JST で日付リセット（同日内の重複を防ぐ）
    const todayStr = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    if (todayStr !== lastResetDate) {
      usedTopicIndicesForToday.clear();
      lastResetDate = todayStr;
    }
    const available = topics.map((_, i) => i).filter(i => !usedTopicIndicesForToday.has(i));
    const pool = available.length > 0 ? available : topics.map((_, i) => i);
    const idx = pool[topicIndex % pool.length];
    topicIndex++;
    usedTopicIndicesForToday.add(idx);
    return topics[idx];
  } catch {
    return { topic: '今日のおすすめ情報', category: 'general', targetAudience: '一般' };
  }
}

/**
 * 毎日の自動投稿サイクルを実行する。
 */
async function runDailyCycle(dryRun = false) {
  const { topic, category, targetAudience } = getNextTopic();
  logger.info(`[scheduler] 日次サイクル開始: "${topic}"`);

  try {
    const result = await runPipeline({
      topic,
      platforms: ['twitter'],  // Phase2で全プラットフォームに拡張
      targetAudience,
      category,
      dryRun,
      autoApprove: config.AUTO_APPROVE,
    });
    logger.success(`[scheduler] 日次サイクル完了: jobId=${result.jobId}, status=${result.status}`);
  } catch (err) {
    logger.error(`[scheduler] 日次サイクルエラー: ${err.message}`);
  }
}

/**
 * 実行待ちの分析タスクを処理する。
 */
async function runPendingAnalytics() {
  const pending = await getPendingAnalytics();
  if (pending.length === 0) return;

  logger.info(`[scheduler] 分析タスク ${pending.length}件 を処理中...`);

  // 07_analytics が存在しない場合は動的importで安全に処理
  let runAnalytics;
  try {
    const mod = await import('./agents/07_analytics/agent.js');
    runAnalytics = mod.runAnalytics;
  } catch {
    logger.warn('[scheduler] 07_analytics エージェントが見つかりません。スキップします。');
    return;
  }

  for (const schedule of pending) {
    try {
      await runAnalytics(schedule.job_id, schedule.post_id, schedule.platform);
      await markAnalyticsCompleted(schedule.id);
      logger.success(`[scheduler] 分析完了: scheduleId=${schedule.id}, platform=${schedule.platform}`);
    } catch (err) {
      logger.error(`[scheduler] 分析エラー scheduleId=${schedule.id}: ${err.message}`);
      // 失敗しても次のタスクを処理する（markAnalyticsCompleted を呼ばない = retryable）
    }
  }
}

/**
 * 日次スナップショットを取得してDBとGoogle Sheetsに保存する。
 */
async function runDailySnapshot() {
  logger.info('[scheduler] 日次スナップショット実行中...');
  try {
    const { takeDailySnapshot } = await import('./agents/09_report/agent.js');
    const result = await takeDailySnapshot();
    logger.success(`[scheduler] スナップショット完了: ${result.count}件`);
  } catch (err) {
    logger.error(`[scheduler] スナップショットエラー: ${err.message}`);
  }
}

/**
 * 週次AIレポートを生成する（毎週月曜0時）。
 */
async function runWeeklyReport() {
  const now = new Date(Date.now() + 9 * 3600_000);
  if (now.getDay() !== 1) return; // 月曜日のみ実行
  logger.info('[scheduler] 週次レポート生成中...');
  try {
    const { generateWeeklyReport } = await import('./agents/09_report/agent.js');
    await generateWeeklyReport();
    logger.success('[scheduler] 週次レポート生成完了');
  } catch (err) {
    logger.error(`[scheduler] 週次レポートエラー: ${err.message}`);
  }
}

/**
 * 週次アドバイザーを実行し、TRUST_MODE=smart の場合は topics.json を自動更新する。
 */
async function runWeeklyAdvisor() {
  logger.info('[scheduler] 週次アドバイザー実行中...');
  try {
    const { runAdvisor } = await import('./agents/11_advisor/agent.js');
    const plan = await runAdvisor();
    logger.success('[scheduler] アドバイザー完了');

    // TRUST_MODE=smart の場合、topics.json を自動更新する
    if (config.TRUST_MODE === 'smart' && plan?.weeklyPlan?.length) {
      await updateTopicsFromPlan(plan.weeklyPlan);
    }
  } catch (err) {
    logger.error(`[scheduler] アドバイザーエラー: ${err.message}`);
  }
}

/**
 * weeklyPlan から topics.json を生成・更新する。
 */
async function updateTopicsFromPlan(weeklyPlan) {
  const { writeFileSync, copyFileSync, existsSync } = await import('fs');

  // バックアップ（既存のtopics.jsonがある場合）
  const topicsPath = config.DAILY_TOPICS_FILE;  // './topics.json' by default
  if (existsSync(topicsPath)) {
    copyFileSync(topicsPath, topicsPath + '.bak');
    logger.info(`[scheduler] topics.json をバックアップ: ${topicsPath}.bak`);
  }

  // weeklyPlan の上位7件を topics.json フォーマットに変換
  const topics = weeklyPlan.slice(0, 7).map(item => ({
    topic: item.topic,
    platform: item.platform || 'twitter',
    category: item.hookType === 'desire_centric' ? 'desire' : 'general',
    targetAudience: '一般',
  }));

  writeFileSync(topicsPath, JSON.stringify(topics, null, 2), 'utf-8');
  logger.success(`[scheduler] topics.json を自動更新しました (${topics.length}件)`);
}

/**
 * POST_TIME ("HH:MM") からcron式を生成する。
 * 例: "09:00" → "0 9 * * *"
 */
function buildCronExpression(timeStr) {
  const [hh, mm] = timeStr.split(':').map(Number);
  if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    logger.warn(`[scheduler] 無効なPOST_TIME "${timeStr}"。デフォルト09:00を使用します。`);
    return '0 9 * * *';
  }
  return `${mm} ${hh} * * *`;
}

/**
 * スケジューラーを起動する。
 * @param {{ runNow?: boolean, dryRun?: boolean }} opts
 */
export function startScheduler({ runNow = false, dryRun = false } = {}) {
  if (isRunning) {
    logger.warn('[scheduler] すでに起動中です。');
    return;
  }
  isRunning = true;

  const postTimes = config.POST_TIMES;
  logger.info(`[scheduler] 起動 — 投稿時刻: ${postTimes.join(', ')} JST`);
  logger.info(`[scheduler] AUTO_APPROVE: ${config.AUTO_APPROVE}`);
  logger.info(`[scheduler] TRUST_MODE: ${config.TRUST_MODE}`);

  // 毎日の自動投稿ジョブ（複数時刻対応）
  dailyTasks = [];
  for (const timeStr of postTimes) {
    const cronExpr = buildCronExpression(timeStr);
    logger.info(`[scheduler] cronジョブ登録: ${timeStr} JST (cron: ${cronExpr})`);
    const task = cron.schedule(cronExpr, () => runDailyCycle(dryRun), { timezone: 'Asia/Tokyo' });
    dailyTasks.push(task);
  }
  dailyTask = dailyTasks[0] || null;

  // 毎時の分析チェック
  analyticsTask = cron.schedule('0 * * * *', runPendingAnalytics);

  // 毎日0時: 日次スナップショット + 週次レポート（月曜のみ）
  snapshotTask = cron.schedule('0 0 * * *', async () => {
    await runDailySnapshot();
    await runWeeklyReport();
  }, { timezone: 'Asia/Tokyo' });

  // 毎週月曜 01:00 JST: アドバイザー実行 + topics.json 自動更新
  advisorTask = cron.schedule('0 1 * * 1', runWeeklyAdvisor, {
    timezone: 'Asia/Tokyo',
  });
  logger.info('[scheduler] アドバイザータスク登録: 毎週月曜 01:00 JST');

  logger.success('[scheduler] スケジューラー起動完了');

  // --run-now フラグ時は即時実行
  if (runNow) {
    logger.info('[scheduler] --run-now: 即時実行中...');
    runDailyCycle(dryRun).catch(err => logger.error(err.message));
  }
}

/**
 * スケジューラーを停止する。
 */
export function stopScheduler() {
  dailyTasks.forEach(t => t?.stop());
  dailyTasks = [];
  dailyTask = null;
  analyticsTask?.stop();
  snapshotTask?.stop();
  weeklyReportTask?.stop();
  advisorTask?.stop();
  isRunning = false;
  logger.info('[scheduler] 停止しました');
}

/**
 * スケジューラーのステータスを返す。
 */
export function getSchedulerStatus() {
  return {
    isRunning,
    postTime: config.POST_TIME,
    postTimes: config.POST_TIMES,
    dailyPostCount: config.POST_TIMES.length,
    autoApprove: config.AUTO_APPROVE,
    trustMode: config.TRUST_MODE,
    trustThreshold: config.TRUST_THRESHOLD,
    topicIndex,
    snapshotTime: '00:00',
    weeklyReportDay: '月曜日',
    advisorTime: '01:00 (月曜)',
  };
}

// --- CLI エントリポイント ---
// node scheduler.js [--run-now] [--dry-run]
if (process.argv[1]?.endsWith('scheduler.js')) {
  const runNow = process.argv.includes('--run-now');
  const dryRun = process.argv.includes('--dry-run');

  startScheduler({ runNow, dryRun });

  // Ctrl+C でグレースフルシャットダウン
  process.on('SIGINT', () => {
    logger.info('[scheduler] シャットダウン中...');
    stopScheduler();
    process.exit(0);
  });

  if (!runNow) {
    logger.info('[scheduler] 待機中... Ctrl+C で停止');
  }
}
