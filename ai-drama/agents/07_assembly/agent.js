/**
 * 07_assembly — FFmpeg 最終合成（Claude 不使用）
 *
 * 処理:
 *   1. クリップ結合 (concat)
 *   2. 音声ミックス (narration + BGM)
 *   3. 字幕 drawtext + カラーグレード
 *   4. final.mp4 出力
 */

import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { logger } from '../../lib/logger.js';
import { FFMPEG, FFPROBE } from '../../lib/ffmpeg-path.js';
import { config } from '../../config.js';

/** クリップのリストファイルを作成 */
function writeListFile(listPath, clipPaths) {
  const content = clipPaths.map(p => `file '${p}'`).join('\n');
  writeFileSync(listPath, content, 'utf8');
}

/** 字幕 drawtext フィルタ文字列を組み立てる（1行1フィルタ） */
function buildSubtitleFilters(scenes, clipDurationSec) {
  const fontFile = config.JAPANESE_FONT_PATH;
  const LINE_HEIGHT = 0.055; // h 比での行間
  const BASE_Y      = 0.78;  // 最初の行の Y 位置
  const filters = [];

  for (const scene of scenes) {
    if (!scene.subtitleLines || scene.subtitleLines.length === 0) continue;
    const start = scene.sceneIndex * clipDurationSec;
    const end   = start + clipDurationSec - 0.3;

    scene.subtitleLines.forEach((line, idx) => {
      const safe = line.replace(/\n/g, ' ').replace(/\\n/g, ' ').replace(/'/g, '').replace(/:/g, '\\:').replace(/,/g, '');
      if (!safe.trim()) return;
      const yExpr = `h*${(BASE_Y + idx * LINE_HEIGHT).toFixed(3)}`;
      filters.push(
        `drawtext=fontfile='${fontFile}':text='${safe}':fontsize=h*0.045:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=${yExpr}:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'`
      );
    });
  }
  return filters.join(',');
}

/**
 * @param {{ jobId, jobDir, clips, voicePlan, audioPlan, scenePlan, script, verbose }} params
 */
export async function runAssembly({ jobId, jobDir, clips, voicePlan, audioPlan, scenePlan, script, verbose = false }) {
  const assemblyDir = join(jobDir, '07_assembly');
  const listPath    = join(assemblyDir, 'list.txt');
  const concatPath  = join(assemblyDir, 'concat-noaudio.mp4');
  const finalPath   = join(assemblyDir, 'final.mp4');

  const okClips = clips.clips.filter(c => c.status === 'ok' && existsSync(c.clipPath));
  if (okClips.length === 0) throw new Error('合成できるクリップがありません');

  // ── Step 1: クリップ結合 ──────────────────────────────────────────────────
  logger.info('クリップ結合中...');
  writeListFile(listPath, okClips.map(c => c.clipPath));
  execFileSync(FFMPEG, [
    '-f', 'concat', '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    '-y', concatPath,
  ], { stdio: verbose ? 'inherit' : 'pipe' });

  // ── Step 2〜3: 音声 + 字幕 + カラーグレード → final.mp4 ─────────────────
  logger.info('音声ミックス + 字幕 + カラーグレード適用中...');

  // subtitleLines は script.scenes にある（scenePlan には含まれない）
  const subtitleFilter = buildSubtitleFilters(script?.scenes ?? scenePlan.scenes, config.CLIP_DURATION_SEC);
  const videoFilter = ['scale=1080:1920:flags=lanczos', config.FFMPEG_COLOR_GRADE, subtitleFilter].filter(Boolean).join(',');

  const hasNarration = voicePlan?.audioPath && existsSync(voicePlan.audioPath);
  const hasBgm       = audioPlan?.bgmPath    && existsSync(audioPlan.bgmPath);

  const ffArgs = ['-i', concatPath];

  if (hasNarration) ffArgs.push('-i', voicePlan.audioPath);
  if (hasBgm)       ffArgs.push('-i', audioPlan.bgmPath);

  // audio filter_complex
  let audioMap = null;
  if (hasNarration && hasBgm) {
    const narrIdx = 1, bgmIdx = 2;
    const bgmVol  = audioPlan.bgmVolume ?? 0.25;
    const fadeOut = audioPlan.bgmFadeOutSec ?? 2.0;
    ffArgs.push('-filter_complex',
      `[${narrIdx}:a]volume=1.0[narr];` +
      `[${bgmIdx}:a]volume=${bgmVol},aloop=loop=-1:size=2e+09,afade=t=out:st=${(audioPlan.totalEstimatedDurationSec - fadeOut).toFixed(1)}:d=${fadeOut}[bgm];` +
      `[narr][bgm]amix=inputs=2:duration=first[aout]`
    );
    audioMap = '[aout]';
  } else if (hasNarration) {
    ffArgs.push('-filter_complex', `[1:a]volume=1.0[aout]`);
    audioMap = '[aout]';
  } else if (hasBgm) {
    ffArgs.push('-filter_complex', `[1:a]volume=${audioPlan.bgmVolume ?? 0.25},aloop=loop=-1:size=2e+09[aout]`);
    audioMap = '[aout]';
  }

  if (videoFilter) {
    ffArgs.push('-vf', videoFilter);
  }
  ffArgs.push('-map', '0:v');
  if (audioMap) ffArgs.push('-map', audioMap);
  ffArgs.push(
    '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    '-y', finalPath,
  );

  execFileSync(FFMPEG, ffArgs, { stdio: verbose ? 'inherit' : 'pipe' });

  // ── Step 4: 尺を取得して検証 ────────────────────────────────────────────
  const probeOut = execFileSync(FFPROBE, [
    '-v', 'quiet', '-print_format', 'json', '-show_format', finalPath,
  ], { encoding: 'utf8' });
  const durationSec = parseFloat(JSON.parse(probeOut).format.duration ?? '0');

  if (durationSec < config.MIN_DURATION_SEC) {
    throw new Error(`動画尺が短すぎます: ${durationSec.toFixed(1)}秒 (最低 ${config.MIN_DURATION_SEC}秒)`);
  }

  const assemblyOutput = {
    jobId,
    finalVideoPath: finalPath,
    durationSec,
    hasAudio: hasNarration || hasBgm,
    sceneCount: okClips.length,
  };

  writeFileSync(join(assemblyDir, 'assembly-output.json'), JSON.stringify(assemblyOutput, null, 2), 'utf8');
  logger.success(`final.mp4 (${durationSec.toFixed(1)}秒) → ${finalPath}`);
  return assemblyOutput;
}
