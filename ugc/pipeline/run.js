import { fileURLToPath } from 'url';
import { dirname, resolve as resolvePath } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../lib/logger.js';
import { createJobDir, getNextOutputDir } from '../lib/job-dir.js';
import { analyze } from './analyze.js';
import { research } from './research.js';
import { scriptPlan } from './script-plan.js';
import { avatarGen } from './avatar-gen.js';
import { assembly } from './assembly.js';
import { codeReview } from './code-review.js';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_BASE = resolvePath(__dirname, '..', config.OUTPUT_DIR);

/**
 * @param {{ imagePath: string, title: string }} opts
 */
export async function runPipeline({ imagePath, title }) {
  const { jobId, jobDir } = createJobDir();
  logger.info(`Job started: ${jobId}`);
  logger.info(`Job dir: ${jobDir}`);

  const outputDir = getNextOutputDir(OUTPUT_BASE);
  mkdirSync(outputDir, { recursive: true });
  logger.info(`Output dir: ${outputDir}`);

  try {
    // Stage 1
    logger.step(1, 'analyze — product image analysis');
    const analysis = await analyze({ imagePath, title, jobDir });
    writeFileSync(join(jobDir, '01_analyze.json'), JSON.stringify(analysis, null, 2));
    logger.success('analyze complete');

    // Stage 2
    logger.step(2, 'research — UGC pattern research');
    const researchData = await research({ analysis, jobDir });
    writeFileSync(join(jobDir, '02_research.json'), JSON.stringify(researchData, null, 2));
    logger.success('research complete');

    // Stage 3
    logger.step(3, 'script-plan — generate 3 script variants');
    const scripts = await scriptPlan({ analysis, researchData, jobDir });
    writeFileSync(join(jobDir, '03_script-plan.json'), JSON.stringify(scripts, null, 2));
    logger.success('script-plan complete');

    // Stage 4
    logger.step(4, 'avatar-gen — MakeUGC video generation');
    const avatarData = await avatarGen({ scripts, jobDir });
    writeFileSync(join(jobDir, '04_avatar-gen.json'), JSON.stringify(avatarData, null, 2));
    logger.success('avatar-gen complete');

    // Stage 5
    logger.step(5, 'assembly — ffmpeg subtitles + CTA + color grade');
    await assembly({ scripts, avatarData, outputDir });
    logger.success('assembly complete');

    // Stage 6 (auto)
    logger.step(6, 'code-review — automated Claude code review');
    await codeReview({ outputDir });
    logger.success('code-review complete');

    logger.info(`\nAll stages complete. Output: ${outputDir}`);
  } catch (err) {
    rmSync(outputDir, { recursive: true, force: true });
    throw err;
  }
}
