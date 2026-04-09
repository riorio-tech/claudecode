import { getRecentMetrics, getTopPerformingPosts, getLatestPdcaReport } from '../../db/db.js';

export default async function analyticsRoutes(app) {
  // GET /api/analytics/summary — 直近7日のKPIサマリー
  app.get('/analytics/summary', async () => {
    const metrics = await getRecentMetrics(7);

    // 集計
    const totalImpressions = metrics.reduce((s, m) => s + (m.total_impressions || 0), 0);
    const totalLikes = metrics.reduce((s, m) => s + (m.total_likes || 0), 0);
    const totalLinkClicks = metrics.reduce((s, m) => s + (m.total_link_clicks || 0), 0);
    const totalFollowerDelta = metrics.reduce((s, m) => s + (m.total_follower_delta || 0), 0);
    const avgEngagement = metrics.length > 0
      ? metrics.reduce((s, m) => s + (m.avg_engagement_rate || 0), 0) / metrics.length
      : 0;

    const topPosts = await getTopPerformingPosts(3);

    return {
      period: '7days',
      summary: {
        totalImpressions,
        totalLikes,
        totalLinkClicks,
        totalFollowerDelta,
        avgEngagementRate: Math.round(avgEngagement * 10000) / 10000,
      },
      topPosts,
    };
  });

  // GET /api/analytics/chart — 時系列データ（?days=7 or 30）
  app.get('/analytics/chart', async (request) => {
    const days = Math.min(Number(request.query.days) || 7, 90);
    const metrics = await getRecentMetrics(days);
    return { days, data: metrics };
  });

  // GET /api/reports/latest — 最新PDCAレポート
  app.get('/reports/latest', async (request, reply) => {
    const row = await getLatestPdcaReport();
    if (!row) return reply.code(404).send({ error: 'レポートがまだありません' });
    return { report: row };
  });
}
