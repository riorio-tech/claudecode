import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, writeFileSync } from 'node:fs';
import { logger } from '../lib/logger.js';

const execFileAsync = promisify(execFile);
const FFMPEG  = process.env.FFMPEG_PATH  ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

const COLOR_GRADE =
  'eq=brightness=0.03:contrast=1.08:saturation=1.15,' +
  'colorbalance=rs=0.04:gs=0.02:bs=-0.06:rm=0.02:gm=0.01:bm=-0.04:rh=0.01:gh=0.00:bh=-0.02';

const FONT_PATH = [
  '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc',
  '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc',
  '/Library/Fonts/Arial Unicode.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
].find(p => existsSync(p)) ?? null;

function fontfileOpt() {
  if (!FONT_PATH) return '';
  const esc = FONT_PATH.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  return `fontfile='${esc}':`;
}

async function getVideoDuration(filePath) {
  const { stdout } = await execFileAsync(FFPROBE, [
    '-v', 'quiet', '-print_format', 'json', '-show_streams', filePath,
  ]);
  const video = JSON.parse(stdout).streams.find(s => s.codec_type === 'video');
  return parseFloat(video.duration);
}

/**
 * Split script into short readable segments at natural break points.
 * Target: 12-18 chars per segment (one line in the video).
 */
function segmentScript(script, maxLen = 16) {
  const segments = [];
  let buf = '';
  for (const ch of script) {
    buf += ch;
    const hard = ['。', '！', '？', '…'].includes(ch);
    const soft  = ch === '、' && buf.length >= 10;
    if (hard || (soft && buf.length >= maxLen) || buf.length >= maxLen * 1.8) {
      if (buf.trim()) segments.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) segments.push(buf.trim());
  return segments;
}

/**
 * Build timed drawtext filters — one per segment, synced to narration timing.
 * Each segment written to a temp file to avoid all Unicode/quote escaping issues.
 */
function buildTimedSubtitleFilters(script, duration, videoIndex) {
  const segments  = segmentScript(script);
  const charsPerSec = script.replace(/\s/g, '').length / duration;
  const ff = fontfileOpt();
  const filters = [];
  let t = 0.2; // small lead-in before first subtitle

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const dur = seg.replace(/\s/g, '').length / charsPerSec;
    const tEnd = t + dur;

    const tmpFile = join(tmpdir(), `ugc-sub-${videoIndex}-${i}.txt`);
    writeFileSync(tmpFile, seg, 'utf8');
    const escapedPath = tmpFile.replace(/\\/g, '\\\\').replace(/:/g, '\\:');

    filters.push(
      `drawtext=${ff}textfile=${escapedPath}:` +
      `enable='between(t,${t.toFixed(2)},${tEnd.toFixed(2)})':` +
      'fontsize=44:fontcolor=white:' +
      'x=(w-text_w)/2:y=h*0.82:' +
      'box=1:boxcolor=black@0.5:boxborderw=10'
    );

    t = tEnd;
  }
  return filters;
}

/**
 * Subtle handheld-camera motion: 5% upscale + sinusoidal crop drift.
 * Simulates the natural sway of a hand-held UGC video.
 * Uses crop filter's `t` (timestamp, seconds) for time-varying position.
 */
function buildMotionFilter() {
  // Scale to 105% → crop back to 1080x1920 with sinusoidal xy offset
  // x range: 27 ± 8 = [19, 35]  (within safe [0, 54])
  // y range: 48 ± 6 = [42, 54]  (within safe [0, 96])
  return (
    'scale=w=1134:h=2016,' +
    "crop=w=1080:h=1920:x='27+8*sin(t*0.8)':y='48+6*sin(t*0.6+0.5)'"
  );
}

/**
 * Stage 5: Apply timed subtitles, camera motion, and color grade via ffmpeg.
 * No CTA overlay.
 * @param {{
 *   scripts: Array<{ script: string }>,
 *   avatarData: Array<{ index: number, localPath: string }>,
 *   outputDir: string
 * }} opts
 */
export async function assembly({ scripts, avatarData, outputDir }) {
  for (const { index, localPath } of avatarData) {
    const script  = scripts[index].script;
    const outFile = join(outputDir, `final_assembled_${index}.mp4`);

    logger.info(`  [${index + 1}/${avatarData.length}] ${outFile}`);

    const duration = await getVideoDuration(localPath);
    logger.info(`  duration=${duration.toFixed(1)}s`);

    const motionFilter    = buildMotionFilter();
    const subtitleFilters = buildTimedSubtitleFilters(script, duration, index);

    // Filter chain: motion (scale+crop) → timed subtitles → color grade
    const vf = [motionFilter, ...subtitleFilters, COLOR_GRADE].join(',');

    await execFileAsync(FFMPEG, [
      '-i', localPath,
      '-vf', vf,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      '-y',
      outFile,
    ]).catch(err => {
      throw new Error(`ffmpeg failed for avatar-${index}: ${err.stderr ?? err.message}`);
    });

    logger.success(`  final_assembled_${index}.mp4 saved`);
  }
}
