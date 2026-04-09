import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
import jobsRoutes from './routes/jobs.js';
import publishRoutes from './routes/publish.js';
import analyticsRoutes from './routes/analytics.js';
import schedulerRoutes from './routes/scheduler.js';
import reportRoutes from './routes/report.js';
import browserRoutes from './routes/browser.js';
import advisorRoutes from './routes/advisor.js';

// API_KEY 未設定チェック（起動ブロック）
if (!process.env.API_KEY) {
  console.error('[FATAL] 環境変数 API_KEY が設定されていません。.env を確認してください。');
  process.exit(1);
}

const app = Fastify({ logger: false });

// CORS
await app.register(cors, { origin: true });

// 静的ファイル配信（ダッシュボード）
await app.register(staticPlugin, {
  root: resolve(__dirname, '../public'),
  prefix: '/',
});

// topics.json を直接配信（ダッシュボードのランダム選択用）
app.get('/topics.json', async (_, reply) => {
  try {
    const { readFileSync } = await import('fs');
    const data = readFileSync(resolve(__dirname, '../topics.json'), 'utf-8');
    reply.type('application/json').send(data);
  } catch {
    reply.send([]);
  }
});

// APIキー認証ミドルウェア
app.addHook('preHandler', async (request, reply) => {
  // /healthz は認証不要
  if (request.url === '/healthz') return;
  const apiKey = request.headers['x-api-key'];
  if (apiKey !== config.API_KEY) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
});

// ルート登録
await app.register(jobsRoutes, { prefix: '/api' });
await app.register(publishRoutes, { prefix: '/api' });
await app.register(analyticsRoutes, { prefix: '/api' });
await app.register(schedulerRoutes, { prefix: '/api' });
await app.register(reportRoutes, { prefix: '/api' });
await app.register(browserRoutes, { prefix: '/api' });
await app.register(advisorRoutes, { prefix: '/api' });

// ヘルスチェック
app.get('/healthz', async () => ({ status: 'ok' }));

// 起動
try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  console.log(`SNS Manager API起動 → http://localhost:${config.PORT}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
