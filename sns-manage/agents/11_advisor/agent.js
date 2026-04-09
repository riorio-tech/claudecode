import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../../config.js';
import {
  getDb,
  getKnowledgeBase,
  getTopPatterns,
  getTopFailures,
  getWeeklyComparison,
  getDailySnapshots,
  getTopPerformingPosts,
  getRecentExperiments,
} from '../../db/db.js';
import { logger } from '../../lib/logger.js';
import { extractJson } from '../../lib/validate-json.js';

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
  logger.info(`[11_advisor] メモリ保存: ${path}`);
}

/**
 * 今日の日付文字列 (YYYY-MM-DD, JST) を返す。
 */
function todayJST() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

/**
 * データ品質レベルを判定する。
 * @param {object[]} patterns
 * @param {object[]} experiments
 * @returns {'bootstrap'|'developing'|'mature'}
 */
function judgeDataQuality(patterns, experiments) {
  const totalSignals = patterns.length + experiments.length;
  if (totalSignals === 0) return 'bootstrap';
  if (totalSignals < 10) return 'developing';
  return 'mature';
}

/**
 * データ分析 + ネクストアクション提案エージェント。
 * DBに蓄積されたデータを読み込み、Claude Sonnet でファクトベースの週次アクションプランを生成する。
 *
 * @param {string|null} jobId オプション（スタンドアロン実行時は null）
 * @returns {Promise<object>} 生成されたアクションプランオブジェクト
 */
export async function runAdvisor(jobId = null) {
  logger.info(`[11_advisor] アドバイザー開始${jobId ? ` (jobId: ${jobId})` : ''}`);

  // ---- 1. DBデータ収集 ----
  const [knowledge, patterns, failures, weeklyData, snapshots28d, topPosts, experiments] =
    await Promise.all([
      getKnowledgeBase({ limit: 20 }),
      getTopPatterns(10),
      getTopFailures(10),
      getWeeklyComparison(),
      getDailySnapshots(28),
      getTopPerformingPosts(10),
      getRecentExperiments(),
    ]);

  const { thisWeek, lastWeek, changes } = weeklyData;
  const dataQuality = judgeDataQuality(patterns, experiments);

  logger.info(`[11_advisor] データ収集完了: patterns=${patterns.length}, experiments=${experiments.length}, dataQuality=${dataQuality}`);

  // ---- 2. Claude Sonnet でアクションプラン生成 ----
  const isBootstrap = dataQuality === 'bootstrap';

  const prompt = `あなたはSNSマーケティング戦略の専門家です。以下の蓄積データを分析し、今週のアクションプランをJSON形式で生成してください。

## データ品質ステータス
${isBootstrap
  ? '⚠️ まだ十分なデータがありません（ブートストラップモード）。SNSのベストプラクティスに基づいて初期推奨を生成してください。各アクションには「ファクトなし・初期推奨」と明記してください。'
  : `データ品質: ${dataQuality === 'developing' ? '蓄積中（developing）' : '十分（mature）'}`
}

## 採択パターン（エンゲージメントリフト高い順）
${JSON.stringify(patterns, null, 2)}

## 失敗パターン（回避ルール）
${JSON.stringify(failures, null, 2)}

## 知識ベース（信頼度スコア付きインサイト）
${JSON.stringify(knowledge, null, 2)}

## 今週 vs 先週のKPI比較
今週: ${JSON.stringify(thisWeek, null, 2)}
先週: ${JSON.stringify(lastWeek, null, 2)}
変化率(%): ${JSON.stringify(changes, null, 2)}

## 直近28日の日次スナップショット（件数: ${snapshots28d.length}件）
${JSON.stringify(snapshots28d.slice(0, 20), null, 2)}

## トップ投稿（エンゲージ率順）
${JSON.stringify(topPosts.slice(0, 5), null, 2)}

## 実験ログ（直近30件）
${JSON.stringify(experiments, null, 2)}

---

以下の形式でJSONを出力してください。フィールドは必ず全て含めてください:

{
  "generatedAt": "ISO timestamp（現在時刻）",
  "dataQuality": "${dataQuality}",
  "winningAxis": {
    "winner": "desire_centric|object_centric|inconclusive",
    "desireCentricWins": 数値,
    "objectCentricWins": 数値,
    "evidenceCount": 数値,
    "confidence": "low|medium|high",
    "summary": "1文の説明（日本語）"
  },
  "weeklyPlan": [
    {
      "priority": 1,
      "topic": "投稿トピック（日本語）",
      "platform": "twitter|threads|instagram|tiktok",
      "hookType": "desire_centric|object_centric",
      "reason": "なぜこのトピックを今週投稿すべきかのファクト根拠（日本語）",
      "suggestedAngle": "具体的な訴求角度（日本語）"
    }
  ],
  "nextHypotheses": [
    {
      "hypothesis": "仮説文（日本語）",
      "why": "なぜこれをテストすべきかのファクト根拠（日本語）",
      "expectedOutcome": "期待される結果（日本語）",
      "platform": "twitter"
    }
  ],
  "optimalTimes": {
    "twitter": "HH:MM",
    "threads": "HH:MM"
  },
  "riskWarnings": ["警告1（日本語）", "警告2（日本語）"]
}

weeklyPlan は5〜7件、nextHypotheses は3件にしてください。
${isBootstrap ? 'weeklyPlan の reason には必ず「ファクトなし・初期推奨」と冒頭に含めてください。' : ''}`;

  let actionPlan;
  try {
    const response = await client.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text;
    actionPlan = extractJson(text);
    // generatedAt を確実に現在時刻で上書き
    actionPlan.generatedAt = new Date().toISOString();
    actionPlan.dataQuality = dataQuality;

    logger.success(`[11_advisor] アクションプラン生成完了`);
  } catch (err) {
    logger.warn(`[11_advisor] AI生成エラー: ${err.message}`);
    // フォールバック: 最小限の構造を返す
    actionPlan = {
      generatedAt: new Date().toISOString(),
      dataQuality,
      winningAxis: {
        winner: 'inconclusive',
        desireCentricWins: 0,
        objectCentricWins: 0,
        evidenceCount: experiments.length,
        confidence: 'low',
        summary: 'データ不足または生成エラーのため判定できませんでした',
      },
      weeklyPlan: [],
      nextHypotheses: [],
      optimalTimes: { twitter: '09:00', threads: '09:00' },
      riskWarnings: [`AI生成エラー: ${err.message}`],
    };
  }

  // ---- 3. ファイル保存 ----
  const dateStr = todayJST();
  saveToMemory(`action_plan_${dateStr}.json`, actionPlan);
  saveToMemory('latest_action_plan.json', actionPlan);

  // ---- 4. 改善提案をターミナルに表示 ----
  logger.info('\n========================================');
  logger.info(`[11_advisor] アクションプラン (${dateStr})`);
  logger.info(`データ品質: ${actionPlan.dataQuality}`);
  logger.info(`勝利軸: ${actionPlan.winningAxis?.winner} (信頼度: ${actionPlan.winningAxis?.confidence})`);
  logger.info(`${actionPlan.winningAxis?.summary}`);

  if (actionPlan.weeklyPlan?.length > 0) {
    logger.info('\n--- 今週の投稿プラン ---');
    for (const item of actionPlan.weeklyPlan) {
      logger.info(`[${item.priority}] ${item.platform} / ${item.topic}`);
      logger.info(`    理由: ${item.reason}`);
      logger.info(`    訴求: ${item.suggestedAngle}`);
    }
  }

  if (actionPlan.nextHypotheses?.length > 0) {
    logger.info('\n--- 次のテスト仮説 ---');
    for (const h of actionPlan.nextHypotheses) {
      logger.info(`・${h.hypothesis}`);
      logger.info(`  根拠: ${h.why}`);
    }
  }

  if (actionPlan.riskWarnings?.length > 0) {
    logger.warn('\n--- リスク警告 ---');
    for (const w of actionPlan.riskWarnings) {
      logger.warn(`⚠ ${w}`);
    }
  }

  logger.info('========================================\n');
  logger.success(`[11_advisor] 完了: reports/memory/action_plan_${dateStr}.json`);

  return actionPlan;
}
