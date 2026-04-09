// Vercel サーバーレス用エントリポイント（api/server.js の listen なし版）
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from '../config.js';
import jobsRoutes from './routes/jobs.js';
import publishRoutes from './routes/publish.js';
import analyticsRoutes from './routes/analytics.js';
import schedulerRoutes from './routes/scheduler.js';
import reportRoutes from './routes/report.js';
import browserRoutes from './routes/browser.js';
import advisorRoutes from './routes/advisor.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: false });

await app.register(cors, { origin: true });

// APIキー認証
app.addHook('preHandler', async (request, reply) => {
  if (request.url === '/healthz' || request.url === '/topics.json') return;
  const apiKey = request.headers['x-api-key'];
  if (apiKey !== config.API_KEY) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
});

await app.register(jobsRoutes, { prefix: '/api' });
await app.register(publishRoutes, { prefix: '/api' });
await app.register(analyticsRoutes, { prefix: '/api' });
await app.register(schedulerRoutes, { prefix: '/api' });
await app.register(reportRoutes, { prefix: '/api' });
await app.register(browserRoutes, { prefix: '/api' });
await app.register(advisorRoutes, { prefix: '/api' });

app.get('/healthz', async () => ({ status: 'ok' }));

app.get('/topics.json', async (_, reply) => {
  try {
    const data = readFileSync(resolve(__dirname, '../topics.json'), 'utf-8');
    reply.type('application/json').send(data);
  } catch {
    reply.send([]);
  }
});

await app.ready();

export default async (req, res) => {
  app.server.emit('request', req, res);
};
