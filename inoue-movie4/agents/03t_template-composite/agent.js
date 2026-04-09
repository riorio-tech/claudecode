import { mkdirSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { execSync, spawnSync } from 'child_process';
import sharp from 'sharp';
import { validate, TemplateCompositeOutputSchema } from '../../lib/validate-json.js';
import { logger } from '../../lib/logger.js';
import { FFMPEG, FFPROBE } from '../../lib/ffmpeg-path.js';
import { removeBackground } from '../../lib/fal-client.js';

/**
 * テンプレート動画に商品画像をコンポジットして MP4 を生成する
 *
 * @param {{
 *   jobId: string,
 *   videoIndex: number,
 *   templateVideoPath: string,
 *   sourceImagePath: string,
 *   zone: { x: number, y: number, w: number, h: number },
 *   outputDir: string,
 *   verbose: boolean,
 * }} params
 * @returns {object} TemplateCompositeOutputSchema 準拠の出力
 */
export async function runTemplateComposite({
  jobId,
  videoIndex,
  templateVideoPath,
  sourceImagePath,
  zone,
  outputDir,
  testClips = null,
  verbose,
}) {
  mkdirSync(outputDir, { recursive: true });

  const framesDir = join(outputDir, 'frames');
  const compositedDir = join(outputDir, 'composited');
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(compositedDir, { recursive: true });

  // Step 1: テンプレートフレーム抽出
  if (verbose) logger.info(`[template] video-${videoIndex}: フレーム抽出中 ${basename(templateVideoPath)}`);
  try {
    execSync(
      `"${FFMPEG}" -y -i "${templateVideoPath}" -r 30 "${framesDir}/frame_%04d.png"`,
      { stdio: verbose ? 'inherit' : 'pipe', timeout: 120_000 }
    );
  } catch (e) {
    throw new Error(`テンプレートフレーム抽出失敗: ${e.message}`);
  }

  let frameFiles = readdirSync(framesDir)
    .filter(f => f.endsWith('.png'))
    .sort();

  if (frameFiles.length === 0) {
    throw new Error(`テンプレートからフレームを抽出できませんでした: ${templateVideoPath}`);
  }

  // --test-clips N が指定された場合は先頭 N×30 フレームのみ処理
  if (testClips) {
    frameFiles = frameFiles.slice(0, testClips * 30);
    if (verbose) logger.info(`[template] video-${videoIndex}: テストモード — ${frameFiles.length} フレームに制限`);
  }

  if (verbose) logger.info(`[template] video-${videoIndex}: ${frameFiles.length} フレーム抽出完了`);

  // Step 2: 商品画像の背景除去（FAL_KEY 未設定時はスキップ）
  const productFgPath = join(outputDir, 'product-fg.png');
  let productSourcePath = sourceImagePath;

  try {
    const removedBg = await removeBackground(sourceImagePath, productFgPath);
    if (removedBg) {
      productSourcePath = productFgPath;
      if (verbose) logger.info(`[template] video-${videoIndex}: 背景除去完了`);
    } else {
      if (verbose) logger.info(`[template] video-${videoIndex}: FAL_KEY 未設定のため背景除去スキップ`);
    }
  } catch (e) {
    logger.warn(`[template] video-${videoIndex}: 背景除去失敗（元画像を使用）: ${e.message}`);
  }

  // Step 3: 商品画像をゾーンサイズにリサイズ（透過 PNG）
  const { x, y, w, h } = zone;
  const resizedProductBuf = await sharp(productSourcePath)
    .resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Step 4: フレームごとにコンポジット（20枚ずつ並列）
  if (verbose) logger.info(`[template] video-${videoIndex}: ${frameFiles.length} フレームをコンポジット中...`);

  const BATCH = 20;
  for (let i = 0; i < frameFiles.length; i += BATCH) {
    const batch = frameFiles.slice(i, i + BATCH);
    await Promise.all(batch.map(async (fname) => {
      const inPath = join(framesDir, fname);
      const outPath = join(compositedDir, fname);
      await sharp(inPath)
        .composite([{ input: resizedProductBuf, top: y, left: x }])
        .png()
        .toFile(outPath);
    }));
  }

  if (verbose) logger.info(`[template] video-${videoIndex}: コンポジット完了`);

  // Step 5: フレームを動画に戻す（音声は元テンプレートから維持）
  const compositedVideoPath = join(outputDir, 'composited.mp4');
  const hasTemplateAudio = checkHasAudio(templateVideoPath);

  try {
    if (hasTemplateAudio) {
      execSync(
        `"${FFMPEG}" -y -r 30 -i "${compositedDir}/frame_%04d.png" ` +
        `-i "${templateVideoPath}" -map 0:v -map 1:a ` +
        `-c:v libx264 -pix_fmt yuv420p -preset medium -b:v 12M -maxrate 15M -bufsize 30M ` +
        `-c:a aac -b:a 192k -ar 44100 -ac 2 -shortest "${compositedVideoPath}"`,
        { stdio: verbose ? 'inherit' : 'pipe', timeout: 180_000 }
      );
    } else {
      execSync(
        `"${FFMPEG}" -y -r 30 -i "${compositedDir}/frame_%04d.png" ` +
        `-c:v libx264 -pix_fmt yuv420p -preset medium -b:v 12M -maxrate 15M -bufsize 30M ` +
        `"${compositedVideoPath}"`,
        { stdio: verbose ? 'inherit' : 'pipe', timeout: 180_000 }
      );
    }
  } catch (e) {
    throw new Error(`コンポジット動画の生成失敗: ${e.message}`);
  }

  if (!existsSync(compositedVideoPath)) {
    throw new Error('コンポジット動画が生成されませんでした');
  }

  const durationSec = getDuration(compositedVideoPath);
  const templateName = basename(templateVideoPath, '.mp4');

  logger.success(`[template] video-${videoIndex}: ${durationSec.toFixed(1)}秒 コンポジット完了`);

  return validate(TemplateCompositeOutputSchema, {
    jobId,
    videoIndex,
    compositedVideoPath,
    templateName,
    durationSec,
    hasTemplateAudio,
  });
}

function checkHasAudio(videoPath) {
  const result = spawnSync(FFPROBE, [
    '-v', 'error',
    '-select_streams', 'a',
    '-show_entries', 'stream=codec_type',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ], { encoding: 'utf8' });
  return (result.stdout?.trim() ?? '') === 'audio';
}

function getDuration(videoPath) {
  const result = spawnSync(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ], { encoding: 'utf8' });
  const val = parseFloat(result.stdout?.trim());
  if (isNaN(val)) throw new Error(`ffprobe で尺を取得できませんでした: ${videoPath}`);
  return val;
}
