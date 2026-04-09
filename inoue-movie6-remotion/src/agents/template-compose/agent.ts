import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { getClient } from '../../lib/claude.ts';
import { logger } from '../../lib/logger.ts';
import { getJobDir, getJobPath } from '../../lib/job.ts';
import { renderFrame, renderFeatureCard } from '../../video/frame.ts';
import { makeClip, concatenateClips } from '../../video/renderer.ts';
import { config } from '../../../config.ts';
import type { ProductInfo } from '../00_ingest/schema.ts';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

// テンプレート全体で目標とする合計尺（秒）
const TARGET_TOTAL_DURATION = 22;
// フィーチャーカードを挿入する位置（0-indexed: 3 = cut3の後）
const FEATURE_CARD_INSERT_AFTER = 2;
// フィーチャーカードの尺
const FEATURE_CARD_DURATION = 5;
// 各テンプレートクリップに割り当てるアニメーション（ループ）
const ANIMATION_SEQUENCE: Array<'zoom-in' | 'zoom-out' | 'fade'> = [
  'zoom-in', 'fade', 'zoom-out', 'zoom-in', 'fade',
];

function getFfprobePath(): string {
  const installer = require('@ffprobe-installer/ffprobe') as { path: string };
  return installer.path;
}

function getFfmpegPath(): string {
  const installer = require('@ffmpeg-installer/ffmpeg') as { path: string };
  return installer.path;
}

async function getVideoDuration(videoPath: string): Promise<number> {
  const ffprobe = getFfprobePath();
  const { stdout } = await execFileAsync(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ]);
  const d = parseFloat(stdout.trim());
  if (isNaN(d)) throw new Error(`ffprobe が無効な尺を返しました: "${stdout.trim()}"`);
  return d;
}

async function extractFrame(videoPath: string, outputPath: string): Promise<void> {
  const ffmpeg = getFfmpegPath();
  await execFileAsync(ffmpeg, [
    '-y', '-ss', '0.1',
    '-i', videoPath,
    '-vframes', '1',
    '-vf', 'scale=540:-1',
    outputPath,
  ]);
}

interface CutText {
  text: string;
}

async function planTextsWithClaude(
  productInfo: ProductInfo,
  templateFramePaths: string[],
  scaledDurations: number[]
): Promise<CutText[]> {
  const client = getClient();

  const contentParts: object[] = [];
  for (let i = 0; i < templateFramePaths.length; i++) {
    const base64 = readFileSync(templateFramePaths[i]).toString('base64');
    contentParts.push(
      { type: 'text', text: `【カット${i + 1}（尺: ${scaledDurations[i].toFixed(1)}秒）】` },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } }
    );
  }

  contentParts.push({
    type: 'text',
    text: `上記は商品紹介動画の${templateFramePaths.length}カットのフレームです。
商品「${productInfo.title}」（カテゴリ: ${productInfo.category}、特徴: ${productInfo.features.join('、')}）の
TikTok Shop動画として、各カットに表示する日本語テキストを提案してください。

ルール:
- 各テキストは12文字以内
- カット1はフック（視聴者を引き込む）
- 中盤は商品特徴・ベネフィット
- 最終カットはCTA（「リンクから」「今すぐ」等）
- 絵文字1〜2個OK

JSONのみ返してください:
[{"cut":1,"text":"テキスト"},{"cut":2,"text":"テキスト"},...] `,
  });

  const response = await client.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: contentParts as Parameters<typeof client.messages.create>[0]['messages'][0]['content'] }],
  });

  const firstContent = response.content[0];
  if (!firstContent || firstContent.type !== 'text') {
    throw new Error('template-compose: Claude が予期しないレスポンスを返しました');
  }
  const rawText = firstContent.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  const parsed = JSON.parse(rawText) as Array<{ cut: number; text: string }>;

  return templateFramePaths.map((_, i) => ({
    text: parsed[i]?.text ?? productInfo.title,
  }));
}

export async function runTemplateCompose(
  productInfo: ProductInfo,
  templatesDir: string
): Promise<string> {
  const { jobId } = productInfo;
  logger.info('template-compose: 開始', { jobId, templatesDir });

  // 1. テンプレート動画を収集
  const templateVideos = ['AI_cut1.mp4', 'AI_cut2.mp4', 'AI_cut3.mp4', 'AI_cut4.mp4', 'AI_cut5.mp4']
    .map(f => join(templatesDir, f))
    .filter(existsSync);

  if (templateVideos.length === 0) {
    throw new Error(`テンプレート動画が見つかりません: ${templatesDir}`);
  }

  // 2. 各テンプレートの尺取得 & フレーム抽出
  const jobDir = getJobDir(jobId);
  const rawDurations: number[] = [];
  const framePaths: string[] = [];

  for (let i = 0; i < templateVideos.length; i++) {
    const duration = await getVideoDuration(templateVideos[i]);
    rawDurations.push(duration);
    const framePath = join(jobDir, `tpl-ref-${i}.jpg`);
    await extractFrame(templateVideos[i], framePath);
    framePaths.push(framePath);
    logger.debug('template-compose: テンプレート取得', {
      jobId, cut: i + 1, file: basename(templateVideos[i]), duration: duration.toFixed(2)
    });
  }

  // 3. 尺をスケール: (TARGET - FEATURE_CARD) を rawDurations の比率で分配
  const rawTotal = rawDurations.reduce((a, b) => a + b, 0);
  const availableForClips = TARGET_TOTAL_DURATION - FEATURE_CARD_DURATION;
  const scaledDurations = rawDurations.map(d =>
    Math.max(1.0, parseFloat(((d / rawTotal) * availableForClips).toFixed(2)))
  );

  logger.info('template-compose: 尺スケール完了', {
    jobId,
    rawTotal: rawTotal.toFixed(2),
    scaledTotal: scaledDurations.reduce((a, b) => a + b, 0).toFixed(2),
    featureCard: FEATURE_CARD_DURATION,
  });

  // 4. Claude でテキストを生成
  logger.info('template-compose: テキスト生成中', { jobId });
  const cutTexts = await planTextsWithClaude(productInfo, framePaths, scaledDurations);
  logger.info('template-compose: テキスト生成完了', { jobId });

  // 5. 各クリップ生成
  const allClipPaths: string[] = [];
  let clipIndex = 0;

  for (let i = 0; i < templateVideos.length; i++) {
    const duration = scaledDurations[i];
    const animation = ANIMATION_SEQUENCE[i % ANIMATION_SEQUENCE.length];
    const framePath = join(jobDir, `tpl-frame-${clipIndex.toString().padStart(2, '0')}.png`);
    const clipPath = join(jobDir, `tpl-clip-${clipIndex.toString().padStart(2, '0')}.mp4`);

    const frameBuffer = await renderFrame(productInfo.imagePath, { text: cutTexts[i].text });
    writeFileSync(framePath, frameBuffer);
    await makeClip(framePath, duration, clipPath, animation);
    allClipPaths.push(clipPath);
    logger.debug('template-compose: カット完了', {
      jobId, cut: i + 1, text: cutTexts[i].text, duration: duration.toFixed(2), animation
    });
    clipIndex++;

    // フィーチャーカードを指定位置の後に挿入
    if (i === FEATURE_CARD_INSERT_AFTER) {
      const fcFramePath = join(jobDir, `tpl-frame-${clipIndex.toString().padStart(2, '0')}.png`);
      const fcClipPath = join(jobDir, `tpl-clip-${clipIndex.toString().padStart(2, '0')}.mp4`);
      const fcBuffer = await renderFeatureCard(productInfo.imagePath, {
        title: productInfo.title,
        features: productInfo.features,
        category: productInfo.category,
      });
      writeFileSync(fcFramePath, fcBuffer);
      await makeClip(fcFramePath, FEATURE_CARD_DURATION, fcClipPath, 'none');
      allClipPaths.push(fcClipPath);
      logger.debug('template-compose: フィーチャーカード完了', { jobId, duration: FEATURE_CARD_DURATION });
      clipIndex++;
    }
  }

  // 6. 全クリップを連結
  const videoPath = getJobPath(jobId, 'output.mp4');
  await concatenateClips(allClipPaths, videoPath);

  const totalDuration = scaledDurations.reduce((a, b) => a + b, 0) + FEATURE_CARD_DURATION;
  logger.info('template-compose: 完了', {
    jobId, videoPath,
    clips: allClipPaths.length,
    totalDuration: totalDuration.toFixed(1)
  });
  return videoPath;
}
