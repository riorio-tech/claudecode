#!/usr/bin/env node
// ugc/cli.js
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve as resolvePath } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
// ローカル .env があれば優先、なければ親ディレクトリの .env を使う
dotenv.config({ path: resolvePath(__dirname, '.env') });
dotenv.config({ path: resolvePath(__dirname, '../.env') });

import { program } from 'commander';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { logger } from './lib/logger.js';
import { runPipeline } from './pipeline/run.js';

program
  .name('ugc')
  .description('AI avatar UGC video generation pipeline')
  .version('0.1.0');

program
  .command('generate <image>', { isDefault: true })
  .description('Generate 3 UGC avatar videos from a product image')
  .requiredOption('--title <title>', 'Product title (required)')
  .action(async (imageArg, opts) => {
    const imagePath = resolve(imageArg);

    if (!existsSync(imagePath)) {
      logger.error(`Image file not found: ${imagePath}`);
      process.exit(1);
    }

    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = extname(imagePath).toLowerCase();
    if (!allowed.includes(ext)) {
      logger.error(`Unsupported extension ${ext}. Allowed: ${allowed.join(', ')}`);
      process.exit(1);
    }

    const title = opts.title?.trim();
    if (!title) {
      logger.error('--title is required');
      process.exit(1);
    }

    try {
      await runPipeline({ imagePath, title });
    } catch (err) {
      logger.error(err.message);
      process.exit(1);
    }
  });

try {
  await program.parseAsync(process.argv);
} catch (err) {
  logger.error(err.message);
  process.exit(1);
}
