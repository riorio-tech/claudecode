import { readFileSync, existsSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../lib/logger.js';
import {
  insertMetrics,
  adoptPattern,
  getBaselineCvr,
  getDb,
} from '../../db/db.js';
import { config } from '../../config.js';

const getClient = () => new Anthropic();

/**
 * TikTok Analytics データを取り込み CVR を評価・DB記録する
 *
 * @param {{ jobId: string, dataPath: string, verbose: boolean }} params
 */
export async function runMeasurement({ jobId, dataPath, verbose }) {
  if (!existsSync(dataPath)) {
    throw new Error(`分析ファイルが見つかりません: ${dataPath}`);
  }

  const rawData = readFileSync(dataPath, 'utf8');
  const analyticsData = dataPath.endsWith('.json')
    ? JSON.parse(rawData)
    : parseCsv(rawData);

  const kpi = calculateKPIs(analyticsData);
  logger.info(`KPI:\n${JSON.stringify(kpi, null, 2)}`);

  // DBに記録
  const videoIndex = analyticsData.videoIndex != null ? Number(analyticsData.videoIndex) : 0;
  insertMetrics({
    jobId,
    videoIndex,
    metrics: {
      impressions: Number(analyticsData.impressions ?? 0),
      purchases: Number(analyticsData.purchases ?? 0),
      addToCart: Number(analyticsData.addToCart ?? 0),
      retention3s: kpi.retention3s,
      completionRate: kpi.completionRate,
      purchaseCvr: kpi.purchaseCvr,
      adSpend: Number(analyticsData.adSpend ?? 0),
      revenue: Number(analyticsData.revenue ?? 0),
    },
  });

  // ベースライン比較・採択判定
  const baselineCvr = getBaselineCvr();
  const impressions = Number(analyticsData.impressions ?? 0);
  const adopted = checkAdoption(kpi, baselineCvr, impressions);

  if (adopted && baselineCvr) {
    // shots テーブルから shot_id を取得して採択
    const db = getDb();
    if (db) {
      const shotRow = db.prepare(
        'SELECT id, hook_variant FROM shots WHERE job_id = ? AND video_index = ?'
      ).get(jobId, videoIndex);

      if (shotRow) {
        adoptPattern({
          shotId: shotRow.id,
          hookVariant: shotRow.hook_variant,
          cvrLift: kpi.purchaseCvr / baselineCvr,
          baseCvr: baselineCvr,
          winCvr: kpi.purchaseCvr,
          impressions,
          notes: `自動採択: CVR ${(kpi.purchaseCvr * 100).toFixed(3)}% (+${(((kpi.purchaseCvr / baselineCvr) - 1) * 100).toFixed(0)}%)`,
        });
        logger.success(`勝ちパターン採択: ${shotRow.hook_variant}`);
      }
    }
  }

  // Claude で改善提案を生成
  const suggestions = await generateSuggestions(kpi, baselineCvr, adopted);

  // サマリー表示
  logger.success(`\n計測結果 (Job: ${jobId}, video-${videoIndex})`);
  console.log(`  PurchaseCVR : ${(kpi.purchaseCvr * 100).toFixed(3)}%`);
  console.log(`  3s 維持率  : ${(kpi.retention3s * 100).toFixed(1)}%`);
  console.log(`  完視聴率   : ${(kpi.completionRate * 100).toFixed(1)}%`);
  console.log(`  採択        : ${adopted ? '✅ 採択' : '❌ 非採択'}`);
  if (suggestions.length > 0) {
    console.log(`\n改善提案:`);
    for (const s of suggestions) {
      console.log(`  [${s.target}] ${s.action}`);
    }
  }
}

function calculateKPIs(data) {
  const impressions = Number(data.impressions ?? 0);
  const purchases = Number(data.purchases ?? 0);
  const addToCart = Number(data.addToCart ?? 0);
  const retention3s = Number(data.retention3s ?? 0);
  const completionRate = Number(data.completionRate ?? 0);
  const adSpend = Number(data.adSpend ?? 0);
  const revenue = Number(data.revenue ?? 0);

  return {
    purchaseCvr: impressions > 0 ? purchases / impressions : 0,
    atcRate: impressions > 0 ? addToCart / impressions : 0,
    retention3s,
    completionRate,
    cpa: purchases > 0 ? adSpend / purchases : null,
    roas: adSpend > 0 ? revenue / adSpend : null,
  };
}

function checkAdoption(kpi, baselineCvr, impressions) {
  if (impressions < 3000) return false;
  if (!baselineCvr) return false;
  return kpi.purchaseCvr >= baselineCvr * 1.15;
}

async function generateSuggestions(kpi, baselineCvr, adopted) {
  const prompt = `TikTok Shop 動画の KPI を分析し、改善提案を JSON 配列で出力してください。

KPI:
${JSON.stringify(kpi, null, 2)}

ベースライン CVR: ${baselineCvr ? (baselineCvr * 100).toFixed(3) + '%' : 'なし（初回計測）'}
採択: ${adopted}

各改善提案の形式（1〜3件、JSON 配列のみ）:
[{ "target": "hook | benefit | proof | cta", "reason": "問題", "action": "具体的な改善アクション" }]`;

  try {
    const response = await getClient().messages.create({
      model: config.CLAUDE_HAIKU_MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
  } catch (e) {
    logger.warn(`改善提案の生成に失敗: ${e.message}`);
  }

  // ルールベースフォールバック
  const suggestions = [];
  if (kpi.retention3s < 0.4) {
    suggestions.push({ target: 'hook', reason: '3秒維持率が 40% 未満', action: 'overlayText を疑問形か「これ知らないと損」に変更' });
  }
  if (kpi.completionRate < 0.2) {
    suggestions.push({ target: 'proof', reason: '完視聴率が 20% 未満', action: 'proof カットに具体的な数字（★4.8、〇万個）を追加' });
  }
  if (kpi.purchaseCvr < kpi.atcRate * 0.3 && kpi.purchaseCvr > 0) {
    suggestions.push({ target: 'cta', reason: 'カート率に対して購入率が低い', action: 'CTA に価格・限定性・送料無料を明示' });
  }
  return suggestions;
}

function parseCsv(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV のフォーマットが不正です（ヘッダー行が必要）');
  const headers = lines[0].split(',').map(h => h.trim());
  const values = lines[1].split(',').map(v => v.trim());
  return Object.fromEntries(headers.map((h, i) => [h, values[i]]));
}
