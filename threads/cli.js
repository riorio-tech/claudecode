#!/usr/bin/env node
import { program } from 'commander';
import cron from 'node-cron';
import { run } from './pipeline/run.js';
import { formatResearch } from './pipeline/format-research.js';
import { syncer } from './pipeline/syncer.js';
import { reporter } from './pipeline/reporter.js';
import { logger } from './lib/logger.js';
import { config } from './config.js';

program
  .name('threads-agent')
  .description('AI初心者向けThreads自動投稿エージェント');

program
  .command('post')
  .description('1回投稿する')
  .option('--dry-run', '投稿せず内容確認のみ')
  .action(async (opts) => {
    try {
      await run({ dryRun: opts.dryRun });
    } catch (err) {
      logger.error(err.message);
      process.exit(1);
    }
  });

program
  .command('schedule')
  .description('スケジュール実行（デフォルト2時間おき）')
  .option('--interval <hours>', '投稿間隔（時間）', String(config.POST_INTERVAL_HOURS))
  .option('--until <hour>', '何時まで投稿するか（例: 18）')
  .option('--dry-run', '実際には投稿しない')
  .action(async (opts) => {
    const hours = parseInt(opts.interval);
    const untilHour = opts.until ? parseInt(opts.until) : null;
    const cronExpr = `0 */${hours} * * *`;
    logger.info(`スケジュール開始: ${hours}時間おき（${cronExpr}）${untilHour !== null ? ` / ${untilHour}時まで` : ''}`);
    logger.info('Ctrl+C で停止');

    // 起動直後に1回実行
    logger.info('初回実行...');
    await run({ dryRun: opts.dryRun, untilHour }).catch(err => logger.error(err.message));

    cron.schedule(cronExpr, async () => {
      logger.info('スケジュール実行');
      await run({ dryRun: opts.dryRun, untilHour }).catch(err => logger.error(err.message));
    }, { timezone: 'Asia/Tokyo' });

    // 毎日21時に日次レポート
    cron.schedule('0 21 * * *', async () => {
      logger.info('日次レポート実行（21時）');
      await reporter().catch(err => logger.error(err.message));
    }, { timezone: 'Asia/Tokyo' });
    logger.info('日次レポート: 毎日21時に自動実行');
  });

program
  .command('sync')
  .description('投稿済み記事のエンゲージメントをThreads APIから取得してDBに保存')
  .action(async () => {
    try {
      await syncer();
    } catch (err) {
      logger.error(err.message);
      process.exit(1);
    }
  });

program
  .command('report')
  .description('日次エンゲージメントレポートを即時実行する')
  .action(async () => {
    try {
      await reporter();
    } catch (err) {
      logger.error(err.message);
      process.exit(1);
    }
  });

program
  .command('research-formats')
  .description('投稿フォーマット型をリサーチして formats.json を更新する（初回のみ）')
  .action(async () => {
    try {
      await formatResearch();
    } catch (err) {
      logger.error(err.message);
      process.exit(1);
    }
  });

program
  .command('dashboard')
  .description('ダッシュボードを起動する（http://localhost:3000）')
  .option('--port <port>', 'ポート番号', '3000')
  .action(async (opts) => {
    process.env.DASHBOARD_PORT = opts.port;
    await import('./dashboard/server.js');
  });

program.parse();
