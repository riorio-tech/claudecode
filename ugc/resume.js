#!/usr/bin/env node
// 中断したジョブのリカバリスクリプト
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve as resolvePath } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config({ path: resolvePath(__dirname, '.env') });
dotenv.config({ path: resolvePath(__dirname, '../.env') });

import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { HeyGenClient } from './lib/heygen.js';
import { logger } from './lib/logger.js';
import { assembly } from './pipeline/assembly.js';
import { config } from './config.js';

const JOB_DIR    = '/var/folders/k7/skmc4ksj2wj1bs45x85rmyd40000gn/T/ugc-job-70449247-9972-4c00-a7a4-428255aeb7fa';
const OUTPUT_DIR = '/Users/reoreo/claudecode/ugc/output/inpaint3';
const VIDEO_0_ID = '06b77cfef7184e7ba18a29aa7eecfb1a';

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  const ws = createWriteStream(dest);
  try {
    await pipeline(Readable.fromWeb(res.body), ws);
  } catch (err) {
    throw err;
  }
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const scripts = JSON.parse(readFileSync(join(JOB_DIR, '03_script-plan.json'), 'utf8'));
  logger.info(`Loaded ${scripts.length} scripts from job dir`);

  const client = new HeyGenClient({ apiKey: config.HEYGEN_API_KEY });
  const avatarIds = config.HEYGEN_AVATARS;
  const voiceIds  = config.HEYGEN_VOICES;

  const avatarData = [];

  // avatar-0: already completed, get fresh URL from API
  logger.step(1, 'Fetching fresh URL for avatar-0 (already completed)');
  const { video_url: url0 } = await client.getVideoStatus(VIDEO_0_ID);
  if (!url0) throw new Error('avatar-0: no video_url in status response');
  const path0 = join(JOB_DIR, 'avatar-0.mp4');
  await downloadFile(url0, path0);
  logger.success('avatar-0.mp4 saved');
  avatarData.push({ index: 0, videoId: VIDEO_0_ID, localPath: path0 });

  // avatar-1 and avatar-2: generate now
  for (let i = 1; i < scripts.length; i++) {
    const { script } = scripts[i];
    const avatarId = avatarIds[i];
    const voiceId  = voiceIds[i];
    logger.step(i + 1, `Submitting avatar-${i} — avatarId=${avatarId}`);

    const { video_id } = await client.generateVideo({ avatar_id: avatarId, voice_id: voiceId, script });
    logger.info(`  video_id=${video_id} — polling every 10s…`);

    const { video_url } = await client.pollUntilDone(video_id, { intervalMs: 10_000, maxAttempts: 120 });
    const localPath = join(JOB_DIR, `avatar-${i}.mp4`);
    await downloadFile(video_url, localPath);
    logger.success(`  avatar-${i}.mp4 saved`);
    avatarData.push({ index: i, videoId: video_id, localPath });
  }

  writeFileSync(join(JOB_DIR, '04_avatar-gen.json'), JSON.stringify(avatarData, null, 2));

  // Stage 5: assembly
  logger.step(5, 'assembly — ffmpeg subtitles + CTA + color grade');
  await assembly({ scripts, avatarData, outputDir: OUTPUT_DIR });
  logger.success('assembly complete');

  logger.info(`\n完了: ${OUTPUT_DIR}`);
}

main().catch(err => {
  logger.error(err.message);
  process.exit(1);
});
