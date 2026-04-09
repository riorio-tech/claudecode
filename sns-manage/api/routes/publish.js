import { getJob, getContents, getPostsByJob, approvePost } from '../../db/db.js';
import { runPublish } from '../../agents/06_publish/agent.js';

export default async function publishRoutes(app) {
  // GET /api/jobs/:id/preview — コンテンツプレビュー（承認前確認）
  app.get('/jobs/:id/preview', async (request, reply) => {
    const { id } = request.params;
    const job = await getJob(id);
    if (!job) return reply.code(404).send({ error: 'ジョブが見つかりません' });
    const contents = await getContents(id);
    const posts = await getPostsByJob(id);
    return { job, contents, posts };
  });

  // POST /api/jobs/:id/approve — 投稿承認
  app.post('/jobs/:id/approve', async (request, reply) => {
    const { id } = request.params;
    const job = await getJob(id);
    if (!job) return reply.code(404).send({ error: 'ジョブが見つかりません' });
    await approvePost(id);
    return { message: '承認しました', jobId: id };
  });

  // POST /api/jobs/:id/publish — 即時投稿
  app.post('/jobs/:id/publish', async (request, reply) => {
    const { id } = request.params;
    const { dryRun = false } = request.body || {};
    const job = await getJob(id);
    if (!job) return reply.code(404).send({ error: 'ジョブが見つかりません' });
    try {
      const result = await runPublish(id, { dryRun });
      return { message: '投稿完了', result };
    } catch (err) {
      console.error(`[publish] エラー job=${id}: ${err.message}`);
      return reply.code(500).send({ error: '投稿処理中にエラーが発生しました。サーバーログを確認してください。' });
    }
  });
}
