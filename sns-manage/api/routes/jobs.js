import { runPipeline } from '../../orchestrator.js';
import { getJob, getJobs } from '../../db/db.js';

export default async function jobsRoutes(app) {
  // POST /api/jobs — パイプライン起動
  app.post('/jobs', async (request, reply) => {
    const {
      topic,
      platforms = ['twitter'],
      targetAudience = '一般',
      category = 'general',
      dryRun = false,
    } = request.body || {};

    if (!topic) {
      return reply.code(400).send({ error: 'topic は必須です' });
    }

    const validPlatforms = ['twitter', 'x', 'tiktok', 'instagram', 'youtube'];
    const filteredPlatforms = platforms.filter(p => validPlatforms.includes(p.toLowerCase()));
    if (filteredPlatforms.length === 0) {
      return reply.code(400).send({ error: '有効なプラットフォームが指定されていません' });
    }

    // パイプラインをバックグラウンドで起動（jobIdはrunPipeline内部で生成）
    runPipeline({ topic, platforms: filteredPlatforms, targetAudience, category, dryRun })
      .then(result => console.log(`パイプライン完了: ${result.jobId}`))
      .catch(err => console.error(`パイプラインエラー: ${err.message}`));

    return reply.code(202).send({
      message: 'パイプライン開始しました。GET /api/jobs で確認してください。',
    });
  });

  // GET /api/jobs — ジョブ一覧
  app.get('/jobs', async () => {
    const jobs = await getJobs(20);
    return { jobs };
  });

  // GET /api/jobs/:id — ジョブ詳細
  app.get('/jobs/:id', async (request, reply) => {
    const job = await getJob(request.params.id);
    if (!job) return reply.code(404).send({ error: 'ジョブが見つかりません' });
    return { job };
  });
}
