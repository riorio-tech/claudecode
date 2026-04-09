import { startScheduler, stopScheduler, getSchedulerStatus } from '../../scheduler.js';

export default async function schedulerRoutes(app) {
  // GET /api/scheduler/status
  app.get('/scheduler/status', async () => {
    return getSchedulerStatus();
  });

  // POST /api/scheduler/start
  app.post('/scheduler/start', async (request) => {
    const { dryRun = false } = request.body || {};
    startScheduler({ dryRun });
    return { message: 'スケジューラーを起動しました', status: getSchedulerStatus() };
  });

  // POST /api/scheduler/stop
  app.post('/scheduler/stop', async () => {
    stopScheduler();
    return { message: 'スケジューラーを停止しました' };
  });
}
