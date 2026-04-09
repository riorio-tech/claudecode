export default async function advisorRoutes(app) {
  // GET /api/advisor/latest — 最新アクションプランを返す
  app.get('/advisor/latest', async (request, reply) => {
    try {
      const { readFileSync, existsSync } = await import('fs');
      const { join, dirname } = await import('path');
      const { fileURLToPath } = await import('url');
      const memoryDir = join(dirname(fileURLToPath(import.meta.url)), '../../reports/memory');
      const filePath = join(memoryDir, 'latest_action_plan.json');
      if (!existsSync(filePath)) {
        return { status: 'no_data', message: 'まだデータがありません。アドバイザーを実行してください。' };
      }
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch (err) {
      console.error('[advisor]', err);
      return reply.code(500).send({ error: 'アドバイザーデータの取得に失敗しました' });
    }
  });

  // POST /api/advisor/generate — 手動でアドバイザーを実行
  app.post('/advisor/generate', async (request, reply) => {
    try {
      const { runAdvisor } = await import('../../agents/11_advisor/agent.js');
      const plan = await runAdvisor();
      return { ok: true, plan };
    } catch (err) {
      console.error('[advisor]', err);
      return reply.code(500).send({ error: 'アドバイザー実行に失敗しました' });
    }
  });

  // POST /api/advisor/apply — weeklyPlan を topics.json に適用
  app.post('/advisor/apply', async (request, reply) => {
    try {
      const { readFileSync, existsSync, writeFileSync, copyFileSync } = await import('fs');
      const { join, dirname, resolve } = await import('path');
      const { fileURLToPath } = await import('url');
      const { config } = await import('../../config.js');

      const memoryDir = join(dirname(fileURLToPath(import.meta.url)), '../../reports/memory');
      const filePath = join(memoryDir, 'latest_action_plan.json');

      if (!existsSync(filePath)) {
        return reply.code(404).send({ error: 'アクションプランがありません。先にアドバイザーを実行してください。' });
      }

      const plan = JSON.parse(readFileSync(filePath, 'utf-8'));
      const weeklyPlan = plan.weeklyPlan;
      if (!weeklyPlan?.length) {
        return reply.code(400).send({ error: 'weeklyPlan が空です' });
      }

      const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
      const topicsPath = resolve(projectRoot, config.DAILY_TOPICS_FILE);
      if (existsSync(topicsPath)) {
        copyFileSync(topicsPath, topicsPath + '.bak');
      }

      const topics = weeklyPlan.slice(0, 7).map(item => ({
        topic: item.topic,
        platform: item.platform || 'twitter',
        category: item.hookType === 'desire_centric' ? 'desire' : 'general',
        targetAudience: '一般',
      }));

      writeFileSync(topicsPath, JSON.stringify(topics, null, 2), 'utf-8');
      return { ok: true, appliedCount: topics.length, topics };
    } catch (err) {
      console.error('[advisor]', err);
      return reply.code(500).send({ error: 'topics.json の更新に失敗しました' });
    }
  });
}
