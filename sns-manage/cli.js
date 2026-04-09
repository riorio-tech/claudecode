#!/usr/bin/env node
import { Command } from 'commander';
import { runPipeline } from './orchestrator.js';
import { approvePost, getJob } from './db/db.js';
import { runPublish } from './agents/06_publish/agent.js';
import { logger } from './lib/logger.js';

const program = new Command();
program.name('sns-manage').description('SNS管理AIエージェントシステム');

// run コマンド
program.command('run')
  .description('パイプラインを実行してコンテンツを生成する')
  .requiredOption('--topic <topic>', '投稿テーマ')
  .option('--platforms <platforms>', 'カンマ区切りのプラットフォーム', 'twitter')
  .option('--audience <audience>', 'ターゲットオーディエンス', '一般')
  .option('--category <category>', 'カテゴリ', 'general')
  .option('--dry-run', 'ドライラン（実際には投稿しない）', false)
  .action(async (opts) => {
    const platforms = opts.platforms.split(',').map(p => p.trim());
    const result = await runPipeline({
      topic: opts.topic,
      platforms,
      targetAudience: opts.audience,
      category: opts.category,
      dryRun: opts.dryRun,
    });
    logger.success(`Job ID: ${result.jobId}`);
    logger.info('承認するには: node cli.js approve --job-id ' + result.jobId);
  });

// approve コマンド
program.command('approve')
  .description('投稿を承認する')
  .requiredOption('--job-id <jobId>', 'ジョブID')
  .action(async (opts) => {
    await approvePost(opts.jobId);
    logger.success(`ジョブ ${opts.jobId} を承認しました`);
    logger.info('投稿するには: node cli.js publish --job-id ' + opts.jobId);
  });

// publish コマンド
program.command('publish')
  .description('承認済みコンテンツを投稿する')
  .requiredOption('--job-id <jobId>', 'ジョブID')
  .option('--dry-run', 'ドライラン', false)
  .action(async (opts) => {
    await runPublish(opts.jobId, { dryRun: opts.dryRun });
    logger.success('投稿完了');
  });

// status コマンド
program.command('status')
  .description('ジョブのステータスを確認する')
  .requiredOption('--job-id <jobId>', 'ジョブID')
  .action(async (opts) => {
    const job = await getJob(opts.jobId);
    if (!job) {
      logger.error('ジョブが見つかりません: ' + opts.jobId);
      process.exit(1);
    }
    console.log(JSON.stringify(job, null, 2));
  });

program.parseAsync(process.argv).catch(err => {
  logger.error(err.message);
  process.exit(1);
});
