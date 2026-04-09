#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { createJobDir } from './src/lib/job.ts';
import { insertJob, updateJobInfo, insertMetrics, updateJobStatus } from './src/db/db.ts';
import { logger } from './src/lib/logger.ts';
import { config } from './config.ts';
import { runIngest } from './src/agents/00_ingest/agent.ts';
import { runPlan } from './src/agents/01_plan/agent.ts';
import { runRender } from './src/agents/03_render/agent.ts';
import { runQA } from './src/agents/02_qa/agent.ts';
import { runTemplateCompose } from './src/agents/template-compose/agent.ts';

const program = new Command();

program
  .name('inoue-movie6')
  .description('TikTok Shop 商品動画 自動生成パイプライン')
  .version('0.1.0');

program
  .command('generate <image>')
  .description('商品画像から動画を生成する')
  .option('-t, --template <name>', 'テンプレート名', config.DEFAULT_TEMPLATE)
  .action(async (imagePath: string, opts: { template: string }) => {
    if (!existsSync(imagePath)) {
      logger.error(`画像ファイルが見つかりません: ${imagePath}`);
      process.exit(1);
    }
    if (!['Standard', 'Minimal'].includes(opts.template)) {
      logger.error(`不明なテンプレート: ${opts.template}。Standard または Minimal を指定してください。`);
      process.exit(1);
    }

    const jobId = await createJobDir();
    logger.info('パイプライン開始', { jobId, imagePath, template: opts.template });

    try {
      insertJob(jobId, imagePath);

      // 1. ingest
      const productInfo = await runIngest(jobId, imagePath);
      updateJobInfo(jobId, productInfo.title, productInfo.price);

      // 2. plan
      const shotPlan = await runPlan(productInfo);

      // 3. render
      const renderOutput = await runRender({
        jobId,
        template: opts.template as 'Standard' | 'Minimal',
        productInfo,
        shotPlan,
      });

      // 4. qa
      const shotTexts = shotPlan.cuts.map(c => c.text);
      const qaResult = await runQA(productInfo, renderOutput, shotTexts);

      updateJobStatus(jobId, 'completed');

      console.log('\n✅ 生成完了');
      console.log(`   jobId    : ${jobId}`);
      console.log(`   動画     : ${renderOutput.videoPath}`);
      console.log(`   尺       : ${renderOutput.duration.toFixed(1)}秒`);
      console.log(`   キャプション: ${qaResult.caption}`);
      if (qaResult.warnings.length > 0) {
        console.log(`   ⚠️  警告: ${qaResult.warnings.map(w => w.message).join(', ')}`);
      }
    } catch (err) {
      updateJobStatus(jobId, 'failed');
      logger.error('パイプライン失敗', { jobId, error: String(err) });
      process.exit(1);
    }
  });

program
  .command('compose <image>')
  .description('テンプレート動画の商品を差し替えて連結する')
  .option('--templates-dir <path>', 'テンプレート動画ディレクトリ', './templates')
  .action(async (imagePath: string, opts: { templatesDir: string }) => {
    if (!existsSync(imagePath)) {
      logger.error(`画像ファイルが見つかりません: ${imagePath}`);
      process.exit(1);
    }
    if (!existsSync(opts.templatesDir)) {
      logger.error(`テンプレートディレクトリが見つかりません: ${opts.templatesDir}`);
      process.exit(1);
    }

    const jobId = await createJobDir();
    logger.info('composeパイプライン開始', { jobId, imagePath, templatesDir: opts.templatesDir });

    try {
      insertJob(jobId, imagePath);

      // 1. ingest
      const productInfo = await runIngest(jobId, imagePath);
      updateJobInfo(jobId, productInfo.title, productInfo.price);

      // 2. テンプレートベースで動画を合成
      const videoPath = await runTemplateCompose(productInfo, opts.templatesDir);

      updateJobStatus(jobId, 'completed');

      console.log('\n✅ compose完了');
      console.log(`   jobId : ${jobId}`);
      console.log(`   動画  : ${videoPath}`);
    } catch (err) {
      updateJobStatus(jobId, 'failed');
      logger.error('composeパイプライン失敗', { jobId, error: String(err) });
      process.exit(1);
    }
  });

program
  .command('measure')
  .description('CVR計測データを記録する')
  .requiredOption('--job-id <id>', 'ジョブID')
  .requiredOption('--impressions <n>', '表示回数', parseInt)
  .requiredOption('--purchases <n>', '購入数', parseInt)
  .option('--three-sec-rate <r>', '3秒維持率', parseFloat)
  .option('--completion-rate <r>', '完視聴率', parseFloat)
  .action((opts: {
    jobId: string;
    impressions: number;
    purchases: number;
    threeSecRate?: number;
    completionRate?: number;
  }) => {
    if (opts.impressions === 0) {
      console.error('エラー: --impressions に 0 は指定できません');
      process.exit(1);
    }
    insertMetrics(
      opts.jobId,
      opts.impressions,
      opts.purchases,
      opts.threeSecRate ?? 0,
      opts.completionRate ?? 0
    );
    const cvr = opts.purchases / opts.impressions;
    console.log(`✅ 計測記録完了`);
    console.log(`   CVR: ${(cvr * 100).toFixed(2)}%`);
  });

program.parse();
