import {
  getWeeklyComparison,
  getDailySnapshots,
  getTopPerformingPosts,
  getWeeklyReports,
  getLatestWeeklyReport,
} from '../../db/db.js';

export default async function reportRoutes(app) {
  // GET /api/report/weekly — 今週 vs 先週比較 + AIインサイト
  app.get('/report/weekly', async (request, reply) => {
    try {
      const [comparison, topPosts, latestReport, snapshots] = await Promise.all([
        getWeeklyComparison(),
        getTopPerformingPosts(5),
        getLatestWeeklyReport(),
        getDailySnapshots(14),
      ]);

      return {
        ...comparison,
        topPosts,
        latestReport,
        snapshots,
      };
    } catch (err) {
      return reply.code(500).send({ error: 'レポートデータの取得に失敗しました' });
    }
  });

  // GET /api/report/history?weeks=4 — 週次レポート履歴
  app.get('/report/history', async (request, reply) => {
    try {
      const weeks = Math.min(Number(request.query.weeks) || 4, 12);
      return getWeeklyReports(weeks);
    } catch (err) {
      return reply.code(500).send({ error: 'レポート履歴の取得に失敗しました' });
    }
  });

  // GET /api/report/snapshots?days=14 — 日次スナップショット
  app.get('/report/snapshots', async (request, reply) => {
    try {
      const days = Math.min(Number(request.query.days) || 14, 90);
      return getDailySnapshots(days);
    } catch (err) {
      return reply.code(500).send({ error: 'スナップショットの取得に失敗しました' });
    }
  });

  // POST /api/report/snapshot — 手動でスナップショット取得
  app.post('/report/snapshot', async (request, reply) => {
    try {
      const { takeDailySnapshot } = await import('../../agents/09_report/agent.js');
      const result = await takeDailySnapshot();
      return { ok: true, ...result };
    } catch (err) {
      return reply.code(500).send({ error: 'スナップショット取得に失敗しました' });
    }
  });

  // POST /api/report/generate — 手動で週次レポート生成
  app.post('/report/generate', async (request, reply) => {
    try {
      const { generateWeeklyReport } = await import('../../agents/09_report/agent.js');
      const result = await generateWeeklyReport();
      return { ok: true, report: result };
    } catch (err) {
      return reply.code(500).send({ error: 'レポート生成に失敗しました' });
    }
  });
}
