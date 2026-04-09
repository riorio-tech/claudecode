#!/usr/bin/env node

// .env を最初にロード
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);
require('dotenv').config({ path: resolve(__dirname, '../.env') });

import { program } from 'commander';
import { logger }      from './lib/logger.js';
import { runPipeline } from './orchestrator.js';

program
  .name('ai-drama')
  .description('AI ショートドラマ動画生成パイプライン')
  .version('1.0.0');

// ── generate: コンセプトから動画を生成 ────────────────────────────────────────

program
  .command('generate <concept>', { isDefault: true })
  .description('コンセプトからドラマ動画を生成する')
  .option('-g, --genre <genre>',           'ジャンル: revenge | betrayal | romance_drama | family_drama', 'revenge')
  .option('-e, --episode <n>',             '話数', v => parseInt(v, 10), 1)
  .option('--total-episodes <n>',          '全話数', v => parseInt(v, 10), 3)
  .option('-o, --output-dir <dir>',        '出力先ディレクトリ', './output')
  .option('-r, --reference <path>',        '参照動画パス（eval 比較用）', '/Users/reoreo/Desktop/画面収録 2026-04-03 14.10.38.mov')
  .option('--target-score <n>',            '改善ループの目標スコア (0-100)', v => parseInt(v, 10), 75)
  .option('--iterations <n>',              '最大改善反復回数（1=改善なし）', v => parseInt(v, 10), 3)
  .option('--dry-run',                     '脚本+映像設計のみ実行（画像・動画生成なし）', false)
  .option('--skip-qa',                     'QA スキップ（開発用）', false)
  .option('--verbose',                     '詳細ログ表示', false)
  .action(async (concept, opts) => {
    if (!concept?.trim()) {
      logger.error('コンセプトを入力してください');
      process.exit(1);
    }
    try {
      await runPipeline({
        concept:       concept.trim(),
        genre:         opts.genre,
        episode:       opts.episode,
        totalEpisodes: opts.totalEpisodes,
        outputDir:     opts.outputDir,
        referencePath: opts.reference ?? null,
        targetScore:   opts.targetScore,
        maxIterations: opts.iterations,
        dryRun:        opts.dryRun,
        skipQA:        opts.skipQa,
        verbose:       opts.verbose,
      });
    } catch (err) {
      logger.error(err.message);
      if (opts.verbose) console.error(err);
      process.exit(1);
    }
  });

// ── script: 脚本のみ生成 ───────────────────────────────────────────────────────

program
  .command('script <concept>')
  .description('脚本のみ生成（API 課金なし・高速プレビュー）')
  .option('-g, --genre <genre>', 'ジャンル', 'revenge')
  .action(async (concept, opts) => {
    // dry-run として orchestrator を呼ぶ
    try {
      await runPipeline({ concept, genre: opts.genre, dryRun: true });
    } catch (err) {
      logger.error(err.message);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
