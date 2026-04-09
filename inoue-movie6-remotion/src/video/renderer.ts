import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { logger } from '../lib/logger.ts';
import { config } from '../../config.ts';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

function getFfmpegPath(): string {
  const installer = require('@ffmpeg-installer/ffmpeg') as { path: string };
  return installer.path;
}

function getFfprobePath(): string {
  try {
    const installer = require('@ffprobe-installer/ffprobe') as { path: string };
    return installer.path;
  } catch {
    throw new Error('@ffprobe-installer/ffprobe がインストールされていません。`pnpm add @ffprobe-installer/ffprobe` を実行してください。');
  }
}

/** 静止画フレームから指定秒数の動画クリップを生成 */
export async function makeClip(
  framePath: string,
  duration: number,
  outputPath: string,
  animation: 'none' | 'zoom-in' | 'zoom-out' | 'fade' = 'none'
): Promise<void> {
  const ffmpeg = getFfmpegPath();
  const W = config.VIDEO_WIDTH;
  const H = config.VIDEO_HEIGHT;
  const fps = config.FPS;
  const totalFrames = Math.max(1, Math.ceil(duration * fps));

  let vf: string;
  if (animation === 'zoom-in') {
    // Ken Burns: 1.0 → 1.25 ズームイン
    vf = `zoompan=z='min(1.0+0.25*on/${totalFrames},1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=10000:s=${W}x${H}:fps=${fps}`;
  } else if (animation === 'zoom-out') {
    // Ken Burns: 1.25 → 1.0 ズームアウト
    vf = `zoompan=z='max(1.0,1.25-0.25*on/${totalFrames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=10000:s=${W}x${H}:fps=${fps}`;
  } else if (animation === 'fade') {
    // フェードイン（最初の0.4秒）+ 静止
    const fadeFrames = Math.ceil(fps * 0.4);
    vf = `scale=${W}:${H},fade=in:0:${fadeFrames}`;
  } else {
    vf = `scale=${W}:${H}`;
  }

  await execFileAsync(ffmpeg, [
    '-y',
    '-loop', '1',
    '-i', framePath,
    '-t', String(duration),
    '-vf', vf,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    outputPath,
  ]);
}

/** 複数クリップを連結して最終動画を生成 */
export async function concatenateClips(
  clipPaths: string[],
  outputPath: string
): Promise<void> {
  const ffmpeg = getFfmpegPath();
  // clips.txt を outputPath と同じディレクトリに置く
  const listPath = join(dirname(outputPath), 'clips.txt');
  // ffmpeg concat 形式: パス内の単一引用符を '\'' でエスケープ
  const listContent = clipPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  writeFileSync(listPath, listContent);

  await execFileAsync(ffmpeg, [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    outputPath,
  ]);

  logger.info('renderer: 動画連結完了', { outputPath, clips: clipPaths.length });
}

/** 動画の実際の尺（秒）を取得 */
export async function getVideoDuration(videoPath: string): Promise<number> {
  const ffmpeg = getFfprobePath();
  const { stdout } = await execFileAsync(ffmpeg, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ]);
  const d = parseFloat(stdout.trim());
  if (isNaN(d)) throw new Error(`renderer: ffprobe が無効な尺を返しました: "${stdout.trim()}"`);
  return d;
}
