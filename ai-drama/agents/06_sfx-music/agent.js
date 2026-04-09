/**
 * 06_sfx-music — BGM 選択（Claude 不使用・ルールベース）
 */

import { writeFileSync, copyFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { logger } from '../../lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BGM_DIR = join(__dirname, '../../templates/bgm');

/** 感情ビート配列から BGM ファイル名を選ぶ */
function selectBgm(emotionalBeats) {
  const counts = {};
  for (const beat of emotionalBeats) counts[beat] = (counts[beat] ?? 0) + 1;

  const confrontation = (counts.confrontation ?? 0) + (counts.tension_build ?? 0);
  const melancholy    = (counts.despair ?? 0) + (counts.departure ?? 0);
  const silence       = counts.silent_stare ?? 0;

  if (silence >= 2)          return 'silence-01.mp3';
  if (confrontation >= melancholy && confrontation > 0) return 'confrontation-01.mp3';
  if (melancholy > 0)        return 'melancholy-01.mp3';
  return 'tension-01.mp3';
}

/**
 * @param {{ jobId, jobDir, script, clips }} params
 * @returns {object} AudioPlanSchema
 */
export async function runSfxMusic({ jobId, jobDir, script, clips }) {
  const sfxDir = join(jobDir, '06_sfx-music');

  const beats = script.scenes.map(s => s.emotionalBeat);
  const bgmFileName = selectBgm(beats);
  const bgmSrc = join(BGM_DIR, bgmFileName);

  let bgmPath = null;
  if (existsSync(bgmSrc)) {
    bgmPath = join(sfxDir, 'bgm-selected.mp3');
    copyFileSync(bgmSrc, bgmPath);
    logger.success(`BGM 選択: ${bgmFileName}`);
  } else {
    logger.warn(`BGM ファイルが見つかりません: ${bgmSrc} → BGM なしで続行`);
  }

  const totalSec = clips.clips
    .filter(c => c.status === 'ok')
    .reduce((s, c) => s + c.durationSec, 0);

  const audioPlan = {
    jobId,
    bgmPath,
    bgmVolume:     0.25,
    bgmFadeInSec:  1.0,
    bgmFadeOutSec: 2.0,
    totalEstimatedDurationSec: totalSec,
  };

  writeFileSync(join(sfxDir, '06_audio-plan.json'), JSON.stringify(audioPlan, null, 2), 'utf8');
  return audioPlan;
}
