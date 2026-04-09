#!/usr/bin/env node
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve as resolvePath } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config({ path: resolvePath(__dirname, '.env') });

import { program } from 'commander';
import { existsSync } from 'fs';
import { resolve, extname } from 'path';
import sharp from 'sharp';
import { logger } from './lib/logger.js';
import { runPipeline } from './orchestrator.js';

program
  .name('inoue-movie')
  .description('TikTok Shop 商品動画 自動生成パイプライン')
  .version('0.2.0');

// ─── generate: 商品画像から10本の動画を生成 ──────────────────────────────────

program
  .command('generate <image>', { isDefault: true })
  .description('商品画像から 20〜25 秒の縦型動画を10本生成する')
  .requiredOption('-t, --title <title>', '商品名（必須）')
  .option('-p, --price <price>', '価格（数値）', parseFloat)
  .option('-c, --category <category>', 'カテゴリ: daily | beauty | electronics | food | fashion', 'daily')
  .option('-o, --output-dir <dir>', '出力ディレクトリ（デフォルト: カレントディレクトリ）')
  .option('--template <name>', 'テンプレート動画名（templates/{name}.mp4 を使用）')
  .option('--count <n>', '生成本数（デフォルト: 10）', parseInt)
  .option('--dry-run', 'shot-planner のみ実行（動画生成スキップ）', false)
  .option('--skip-qa', 'QA ステップをスキップ（開発用）', false)
  .option('--verbose', '各エージェントの出力を全表示', false)
  .action(async (imageArg, opts) => {
    const imagePath = resolve(imageArg);

    if (!existsSync(imagePath)) {
      logger.error(`画像ファイルが見つかりません: ${imagePath}`);
      process.exit(1);
    }

    const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = extname(imagePath).toLowerCase();
    if (!allowedExts.includes(ext)) {
      logger.error(`対応拡張子: ${allowedExts.join(', ')}  受け取った拡張子: ${ext}`);
      process.exit(1);
    }

    let meta;
    try {
      meta = await sharp(imagePath).metadata();
    } catch (e) {
      logger.error(`画像の読み込みに失敗しました: ${e.message}`);
      process.exit(1);
    }

    if (!meta.width || !meta.height || meta.width < 500 || meta.height < 500) {
      logger.error(`画像サイズが小さすぎます（最低 500×500px 必要）: ${meta.width}×${meta.height}`);
      process.exit(1);
    }

    if (!opts.title || opts.title.trim() === '') {
      logger.error('--title が指定されていません');
      process.exit(1);
    }

    try {
      await runPipeline({
        imagePath,
        title: opts.title.trim(),
        price: opts.price ?? null,
        category: opts.category,
        templateName: opts.template ?? null,
        count: opts.count ?? null,
        outputDir: opts.outputDir ?? null,
        dryRun: opts.dryRun,
        skipQA: opts.skipQa,
        verbose: opts.verbose,
      });
    } catch (err) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// ─── scout: 商品候補をスカウト ────────────────────────────────────────────────

program
  .command('scout')
  .description('AIが商品候補を提案してDBに保存する（週次実行）')
  .option('-c, --category <category>', 'カテゴリ: daily | beauty | electronics | food | fashion', 'daily')
  .option('-l, --limit <num>', '提案件数', parseInt, 5)
  .option('--context <text>', '補足情報（季節・競合状況など）', '')
  .option('--verbose', '詳細出力', false)
  .action(async (opts) => {
    const { runProductScout } = await import('./agents/00_product-scout/agent.js');
    try {
      const result = await runProductScout({
        category: opts.category,
        limit: opts.limit,
        context: opts.context,
        verbose: opts.verbose,
      });
      console.log('\n--- 商品候補 ---');
      for (const c of result.candidates) {
        console.log(`\n[${c.category}] ${c.title}${c.price ? ` (¥${Number(c.price).toLocaleString()})` : ''}`);
        console.log(`  理由: ${c.scoutReason}`);
        if (c.estimatedCvr) console.log(`  CVR仮説: ${c.estimatedCvr}`);
      }
      console.log('\n✅ DBに保存しました。承認後に generate を実行してください。');
    } catch (err) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// ─── measure: CVR 計測データを取り込む ────────────────────────────────────────

program
  .command('measure')
  .description('TikTok 計測データを取り込み CVR を評価・DB記録する')
  .requiredOption('--job-id <jobId>', 'ジョブ ID（UUID）')
  .requiredOption('--data <path>', 'TikTok Analytics CSV/JSON ファイルパス')
  .option('--verbose', '詳細出力', false)
  .action(async (opts) => {
    const { runMeasurement } = await import('./agents/08_measurement/agent.js');
    try {
      await runMeasurement({
        jobId: opts.jobId,
        dataPath: resolve(opts.data),
        verbose: opts.verbose,
      });
    } catch (err) {
      logger.error(err.message);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
