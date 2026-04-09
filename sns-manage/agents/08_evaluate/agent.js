import { z } from 'zod';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { extractJson, validate } from '../../lib/validate-json.js';
import { readJobFile, writeJobFile } from '../../lib/job-dir.js';
import Anthropic from '@anthropic-ai/sdk';
import {
  insertPattern,
  insertPdcaReport,
  getRecentMetrics,
  getTopPerformingPosts,
  insertFailurePattern,
  upsertKnowledgeBase,
  insertExperimentLog,
  upsertAudienceFingerprint,
} from '../../db/db.js';

// ---- Zodスキーマ ----

const WeeklyReportSchema = z.object({
  markdown: z.string(),
  topPattern: z.string().optional(),
  avgEngagement: z.number().optional(),
  totalReach: z.number().optional(),
});

// ---- 失敗パターン分析（アンチフラジリティ） ----

/**
 * 失敗バリアントを模倣欲望フレームで分析し、failure_reasonとavoidance_ruleを生成する。
 * アンチフラジリティ: 失敗から最大の学習を引き出す。
 */
async function analyzeFailure({ platform, hookVariant, hookType, engagementRate, baseline, impressions, contentSnippet }) {
  if (!config.ANTHROPIC_API_KEY) {
    return {
      failureMode: 'other',
      failureReason: 'APIキー未設定のため分析できませんでした',
      avoidanceRule: 'APIキーを設定してください',
      experimentInsight: null,
    };
  }

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const prompt = `あなたはSNSマーケティングの失敗分析専門家です。
ルネ・ジラールの模倣欲望理論の視点から、この投稿がなぜ伝播しなかったかを分析してください。

プラットフォーム: ${platform}
フック種類: ${hookVariant}（${hookType}）
エンゲージメント率: ${(engagementRate * 100).toFixed(3)}%（ベースライン: ${(baseline * 100).toFixed(3)}%）
インプレッション: ${impressions}
コンテンツ: ${contentSnippet || '（データなし）'}

失敗モードを以下から1つ選んでください:
- wrong_mediator: 欲望の媒介者（モデル）の設定が読者に近くなかった
- wrong_emotion: 感情の種類が間違っていた（例：憧れの場面で不安を刺激した）
- object_centric_drift: コンテンツが商品主語に戻ってしまった（欲望主語でなかった）
- timing: タイミング・文脈が合わなかった
- low_quality: コンテンツ自体の品質問題
- other: その他

以下のJSON形式で返してください:
{
  "failureMode": "wrong_mediator",
  "failureReason": "読者と媒介者の距離感が遠すぎた。成功者を見せたが、読者は「自分には関係ない話」と感じた可能性が高い",
  "avoidanceRule": "次回は読者と同じ立場（同世代・同職種）の媒介者を設定する。成功者ではなく「気づき始めた人」を主語にする",
  "experimentInsight": "aspirationよりbelongingの感情を狙うべきカテゴリだった可能性がある"
}`;

  try {
    const response = await client.messages.create({
      model: config.CLAUDE_HAIKU_MODEL,  // 軽量タスクなのでHaiku
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = response.content[0].text;
    const parsed = JSON.parse((raw.match(/\{[\s\S]*\}/) || ['{}'])[0]);
    return {
      failureMode: parsed.failureMode || 'other',
      failureReason: parsed.failureReason || '分析不能',
      avoidanceRule: parsed.avoidanceRule || '記録のみ',
      experimentInsight: parsed.experimentInsight || null,
    };
  } catch (err) {
    logger.warn(`[08_evaluate] 失敗分析エラー: ${err.message}`);
    return {
      failureMode: 'other',
      failureReason: `分析中にエラー: ${err.message}`,
      avoidanceRule: '記録のみ',
      experimentInsight: null,
    };
  }
}

// ---- 週次PDCAレポート生成（Claude Sonnet） ----

async function generateWeeklyReport({ recentMetrics, topPosts }) {
  if (!config.ANTHROPIC_API_KEY) {
    logger.warn('[08_evaluate] ANTHROPIC_API_KEY 未設定 — 週次レポート生成をスキップ');
    return {
      markdown: '## 週次PDCAレポート\n\nAPIキーが未設定のためレポートを生成できませんでした。',
      topPattern: undefined,
      avgEngagement: undefined,
      totalReach: undefined,
    };
  }

  const systemPrompt = `あなたはSNSマーケティングのデータアナリストです。
直近7日間の投稿パフォーマンスデータを分析し、PDCAレポートを作成してください。

以下のJSON形式で返してください:
{
  "markdown": "## 週次PDCAレポート\\n### Plan\\n...\\n### Do\\n...\\n### Check\\n...\\n### Act\\n...",
  "topPattern": "最高パフォーマンスのhookVariant名",
  "avgEngagement": 0.045,
  "totalReach": 12000
}`;

  const userPrompt = `直近7日のメトリクス:\n${JSON.stringify(recentMetrics, null, 2)}\n\nトップ投稿:\n${JSON.stringify(topPosts, null, 2)}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.CLAUDE_MODEL,
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude API エラー: ${response.status} ${text}`);
  }

  const data = await response.json();
  const raw = data.content?.[0]?.text ?? '';
  const parsed = extractJson(raw);
  return validate(WeeklyReportSchema, parsed);
}

// ---- メインエントリーポイント ----

/**
 * 08_evaluate エージェント: A/Bテスト判定・勝ちパターン登録・週次PDCAレポート生成。
 * @param {string} jobId
 */
export async function runEvaluate(jobId) {
  logger.step(8, 'evaluate');
  logger.info(`jobId: ${jobId}`);

  // Step 1: analytics出力を読み込む
  logger.info('[08_evaluate] Step 1: 07_analytics-output.json 読み込み');
  const analyticsOutput = readJobFile(jobId, '07_analytics-output.json');
  // { platform, metrics: { impressions, likes, shares, engagementRate }, insights, manual }

  // Step 2: ベイジアンA/Bテスト判定
  logger.info('[08_evaluate] Step 2: ベースライン取得・採択判定');
  const recentMetrics = await getRecentMetrics(7);
  const baseline = recentMetrics.length > 0
    ? recentMetrics.reduce((sum, m) => sum + (m.avg_engagement_rate || 0), 0) / recentMetrics.length
    : 0.03;  // デフォルトベースライン 3%

  const lift = baseline > 0 ? analyticsOutput.metrics.engagementRate / baseline : 1.0;
  const adoptedAsPattern = lift >= 1.1 && analyticsOutput.metrics.impressions >= 500;

  logger.info(`[08_evaluate] baseline=${(baseline * 100).toFixed(2)}%  lift=${lift.toFixed(2)}  impressions=${analyticsOutput.metrics.impressions}  adopted=${adoptedAsPattern}`);

  // Step 3a: 勝ちパターン登録（adoptedAsPattern === true の場合）
  let hookVariant = 'unknown';
  let hookType = 'unknown';
  try {
    const planningOutput = readJobFile(jobId, '02_planning-output.json');
    const plan = planningOutput.contentPlan?.find(p => p.platform === analyticsOutput.platform);
    hookVariant = plan?.hookType || 'unknown';
    hookType = plan?.hookType?.includes('desire') ? 'desire_centric' : 'object_centric';
  } catch (err) {
    logger.warn(`[08_evaluate] 02_planning-output.json 読み込み失敗: ${err.message}`);
  }

  // コンテンツスニペットを取得
  let contentSnippet = null;
  try {
    const writerOutput = readJobFile(jobId, '03_writer-output.json');
    const content = writerOutput.contents?.find(c => c.platform === analyticsOutput.platform);
    contentSnippet = content?.caption?.slice(0, 200) || null;
  } catch { /* スキップ */ }

  if (adoptedAsPattern) {
    logger.info('[08_evaluate] Step 3a: 勝ちパターン登録');

    await insertPattern({
      platform: analyticsOutput.platform,
      category: 'general',
      hookVariant,
      engagementLift: lift,
      baseEngagement: baseline,
      winEngagement: analyticsOutput.metrics.engagementRate,
      impressions: analyticsOutput.metrics.impressions,
      contentSnippet,
      notes: analyticsOutput.insights,
    });

    logger.success(`勝ちパターン登録: hookVariant="${hookVariant}", lift=${lift.toFixed(2)}`);

    // 知識ベースに蓄積（勝ちの場合）
    await upsertKnowledgeBase({
      insightKey: `${analyticsOutput.platform}_${hookType}_lift`,
      category: 'hook',
      platform: analyticsOutput.platform,
      statement: `${analyticsOutput.platform}では${hookType === 'desire_centric' ? '欲望主語' : '商品主語'}のフックがlift ${lift.toFixed(2)}倍のエンゲージを達成（${analyticsOutput.metrics.impressions}imp）`,
    });

    // desire_centricが勝った場合はdesire理論の知識を強化
    if (hookType === 'desire_centric') {
      await upsertKnowledgeBase({
        insightKey: `${analyticsOutput.platform}_desire_centric_wins`,
        category: 'desire',
        platform: analyticsOutput.platform,
        statement: `${analyticsOutput.platform}では欲望主語コンテンツが商品主語より高エンゲージを達成する傾向がある`,
      });
    }

  } else {
    logger.info('[08_evaluate] Step 3a: 採択基準未達 — 失敗分析を実行します');

    // 失敗分析（アンチフラジリティ: 失敗から燃料を抽出する）
    const failure = await analyzeFailure({
      platform: analyticsOutput.platform,
      hookVariant,
      hookType,
      engagementRate: analyticsOutput.metrics.engagementRate,
      baseline,
      impressions: analyticsOutput.metrics.impressions,
      contentSnippet,
    });

    await insertFailurePattern({
      platform: analyticsOutput.platform,
      category: 'general',
      hookVariant,
      hookType,
      failureMode: failure.failureMode,
      failureReason: failure.failureReason,
      avoidanceRule: failure.avoidanceRule,
      experimentInsight: failure.experimentInsight,
      engagementFloor: analyticsOutput.metrics.engagementRate,
      impressions: analyticsOutput.metrics.impressions,
      contentSnippet,
      notes: analyticsOutput.insights,
    });

    logger.info(`[08_evaluate] 負けパターン登録: mode="${failure.failureMode}"`);

    // 知識ベースに蓄積（負けの場合もインサイトを記録）
    if (failure.experimentInsight) {
      await upsertKnowledgeBase({
        insightKey: `failure_${analyticsOutput.platform}_${failure.failureMode}_insight`,
        category: 'hook',
        platform: analyticsOutput.platform,
        statement: failure.experimentInsight,
      });
    }
  }

  // Step 3b: 実験ログを記録（勝ち負け両方）
  await insertExperimentLog({
    jobId,
    platform: analyticsOutput.platform,
    hypothesis: `hookType=${hookType}のコンテンツはベースラインを超えるエンゲージを得られる`,
    variantADescription: `${hookType}: ${hookVariant}`,
    variantAEngagement: analyticsOutput.metrics.engagementRate,
    variantAImpressions: analyticsOutput.metrics.impressions,
    winner: adoptedAsPattern ? 'A' : 'inconclusive',
    lift,
    insight: adoptedAsPattern
      ? `lift ${lift.toFixed(2)}倍達成。${hookType}フックが有効。`
      : `ベースライン未達（lift ${lift.toFixed(2)}）。失敗モード: ${!adoptedAsPattern ? '分析済' : '—'}`,
    supportsDesireTheory: hookType === 'desire_centric' && adoptedAsPattern ? 1 : 0,
    supportsAntifragility: !adoptedAsPattern ? 1 : 0,  // 失敗実験はアンチフラジリティの証拠
  });
  logger.info('[08_evaluate] 実験ログ記録完了');

  // Step 4: 週次PDCAレポート生成（月曜日の場合）
  const now = new Date();
  const isMonday = now.getDay() === 1;

  if (isMonday) {
    logger.info('[08_evaluate] Step 4: 週次PDCAレポート生成（月曜日）');
    try {
      const weeklyMetrics = await getRecentMetrics(7);
      const topPosts = await getTopPerformingPosts(3);

      const report = await generateWeeklyReport({ recentMetrics: weeklyMetrics, topPosts });

      await insertPdcaReport({
        reportType: 'weekly',
        periodStart: new Date(now - 7 * 24 * 3600_000).toISOString().split('T')[0],
        periodEnd: now.toISOString().split('T')[0],
        summary: report.markdown,
        topPattern: report.topPattern,
        avgEngagement: report.avgEngagement,
        totalReach: report.totalReach,
      });

      logger.success('[08_evaluate] 週次PDCAレポート登録完了');
    } catch (err) {
      logger.warn(`[08_evaluate] 週次レポート生成失敗: ${err.message}`);
    }
  } else {
    logger.info('[08_evaluate] Step 4: 月曜日以外のためPDCAレポートスキップ');
  }

  // Step 5: 出力JSON
  const output = {
    jobId,
    platform: analyticsOutput.platform,
    engagementRate: analyticsOutput.metrics.engagementRate,
    baseline,
    lift,
    adoptedAsPattern,
    weeklyReportGenerated: isMonday,
    evaluatedAt: now.toISOString(),
  };

  writeJobFile(jobId, '08_evaluate-output.json', output);

  logger.success('08_evaluate 完了');
  return output;
}
