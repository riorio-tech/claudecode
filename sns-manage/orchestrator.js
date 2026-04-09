import { createJobDir } from './lib/job-dir.js';
import { insertJob, updateJobStatus, updateJobParams, approvePost, getPostsByJob, insertAnalyticsSchedule, getKnowledgeBase } from './db/db.js';
import { config } from './config.js';
import { runResearch } from './agents/01_research/agent.js';
import { runPlanning } from './agents/02_planning/agent.js';
import { runWriter } from './agents/03_writer/agent.js';
import { runMarketing } from './agents/05_marketing/agent.js';
import { runPublish } from './agents/06_publish/agent.js';
import { logger } from './lib/logger.js';

/**
 * プラットフォームの knowledge_base confidence に基づき自動承認すべきか判定する。
 * TRUST_MODE に応じて動作:
 *   'auto'   → 常に true
 *   'manual' → 常に false
 *   'smart'  → knowledge_base の平均 confidence が TRUST_THRESHOLD 以上なら true
 * @param {string} platform
 * @returns {Promise<boolean>}
 */
export async function shouldAutoApprove(platform) {
  const { TRUST_MODE, TRUST_THRESHOLD } = config;
  if (TRUST_MODE === 'auto') return true;
  if (TRUST_MODE === 'manual') return false;
  // smart モード: このプラットフォームの平均 confidence を確認
  const kb = await getKnowledgeBase({ platform, limit: 10 });
  if (!kb.length) return false;  // データなし → 手動承認
  const avg = kb.reduce((s, k) => s + k.confidence, 0) / kb.length;
  logger.info(`[trust] platform=${platform} avg_confidence=${avg.toFixed(2)} threshold=${TRUST_THRESHOLD}`);
  return avg >= TRUST_THRESHOLD;
}

/**
 * SNS コンテンツ生成パイプラインを実行する。
 * @param {{ topic: string, platforms: string[], targetAudience?: string, category?: string, dryRun?: boolean }} params
 * @returns {Promise<{ jobId: string, status: 'completed' | 'awaiting_approval' }>}
 */
export async function runPipeline({ topic, platforms, targetAudience, category, dryRun = false, autoApprove = false }) {
  const { jobId } = createJobDir();

  await insertJob({
    id: jobId,
    topic,
    category: category || 'general',
    platforms,
    params: { targetAudience, dryRun },
  });

  try {
    logger.step(1, 'リサーチ');
    const researchResult = await runResearch(jobId, { topic, platforms, targetAudience, category });

    logger.step(2, '企画');
    const planningResult = await runPlanning(jobId);

    logger.step(3, 'ライティング');
    const writerResult = await runWriter(jobId);

    logger.step(5, 'マーケティング');
    const marketingResult = await runMarketing(jobId);

    const costs = {
      research: researchResult?.estimatedCost ?? 0,
      planning: planningResult?.estimatedCost ?? 0,
      writer: writerResult?.estimatedCost ?? 0,
      marketing: marketingResult?.estimatedCost ?? 0,
    };
    const totalCost = Object.values(costs).reduce((a, b) => a + b, 0);
    logger.info(`[cost] 推定 $${totalCost.toFixed(4)} (research:$${costs.research.toFixed(4)} / planning:$${costs.planning.toFixed(4)} / writer:$${costs.writer.toFixed(4)} / marketing:$${costs.marketing.toFixed(4)})`);
    await updateJobParams(jobId, { estimatedCost: totalCost, costBreakdown: costs });

    logger.success('コンテンツ生成完了。承認後に投稿できます。');
    await updateJobStatus(jobId, 'awaiting_approval');

    const shouldApprove = autoApprove || await shouldAutoApprove(platforms[0]);
    if (shouldApprove) {
      logger.step(6, '自動承認・投稿');

      // 承認
      await approvePost(jobId);
      logger.info('自動承認完了');

      // 投稿
      await runPublish(jobId, { dryRun });
      logger.info('自動投稿完了');

      // 分析スケジュール登録（24h / 72h / 168h後）
      const posts = await getPostsByJob(jobId);
      for (const post of posts.filter(p => p.status === 'published' || dryRun)) {
        for (const delayHours of [24, 72, 168]) {
          await insertAnalyticsSchedule({
            postId: post.id,
            jobId,
            platform: post.platform,
            delayHours,
          });
        }
      }
      logger.info(`分析スケジュール登録完了 (24h/72h/168h後)`);

      await updateJobStatus(jobId, 'completed');
      logger.success('パイプライン完了 (autoApprove)');
      return { jobId, status: 'completed' };
    }

    return { jobId, status: 'awaiting_approval' };
  } catch (err) {
    logger.error(`パイプラインエラー: ${err.message}`);
    await updateJobStatus(jobId, 'failed').catch(dbErr => logger.warn(`DBステータス更新失敗: ${dbErr.message}`));
    throw err;
  }
}
