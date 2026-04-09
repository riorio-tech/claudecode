import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { MakeUGCClient } from '../lib/makeugc.js';
import { HeyGenClient } from '../lib/heygen.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';

function createAvatarClient() {
  if (config.AVATAR_PROVIDER === 'heygen') {
    return new HeyGenClient({ apiKey: config.HEYGEN_API_KEY });
  }
  return new MakeUGCClient({ apiKey: config.MAKEUGC_API_KEY });
}

function getAvatarIds() {
  return config.AVATAR_PROVIDER === 'heygen' ? config.HEYGEN_AVATARS : config.MAKEUGC_AVATARS;
}

function getVoiceIds() {
  return config.AVATAR_PROVIDER === 'heygen' ? config.HEYGEN_VOICES : config.MAKEUGC_VOICES;
}

/**
 * Stage 4: Generate avatar videos (sequential — one at a time).
 * Supports HeyGen and MakeUGC via AVATAR_PROVIDER config.
 * @param {{
 *   scripts: Array<{ hookType: string, script: string }>,
 *   jobDir: string
 * }} opts
 * @returns {Promise<Array<{ index: number, videoId: string, localPath: string }>>}
 */
export async function avatarGen({ scripts, jobDir }) {
  const client = createAvatarClient();
  const avatarIds = getAvatarIds();
  const voiceIds = getVoiceIds();
  logger.info(`  Using provider: ${config.AVATAR_PROVIDER}`);
  const results = [];

  for (let i = 0; i < scripts.length; i++) {
    const { script } = scripts[i];
    const avatarId = avatarIds[i];
    const voiceId  = voiceIds[i];
    if (!avatarId || !voiceId) throw new Error(`avatar-gen: missing avatarId/voiceId at index ${i}`);
    logger.info(`  [${i + 1}/${scripts.length}] Submitting — avatarId=${avatarId}`);

    const { video_id } = await client.generateVideo({
      avatar_id: avatarId,
      voice_id: voiceId,
      script,
    });

    logger.info(`  [${i + 1}/${scripts.length}] video_id=${video_id} — polling every 10s…`);
    const { video_url } = await client.pollUntilDone(video_id, { intervalMs: 10_000 });

    if (!video_url) {
      throw new Error(`avatar-gen: video_id=${video_id} completed but returned no video_url`);
    }

    logger.info(`  [${i + 1}/${scripts.length}] Downloading…`);
    const localPath = join(jobDir, `avatar-${i}.mp4`);
    await downloadFile(video_url, localPath);
    logger.success(`  avatar-${i}.mp4 saved`);

    results.push({ index: i, videoId: video_id, localPath });
  }

  return results;
}

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  const ws = createWriteStream(dest);
  try {
    await pipeline(Readable.fromWeb(res.body), ws);
  } catch (err) {
    await unlink(dest).catch(() => {});  // remove partial file
    throw err;
  }
}
