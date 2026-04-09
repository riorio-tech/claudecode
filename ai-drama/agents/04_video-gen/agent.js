/**
 * 04_video-gen — Kling AI 動画生成（Claude 不使用・fal.ai raw HTTP）
 *
 * SDK 使用禁止 → raw HTTP queue パターン
 * status_url / response_url は fal.ai が返す値をそのまま使う（URL 手動構築禁止）
 */

import { writeFileSync, createWriteStream } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { execFileSync } from 'child_process';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { FFMPEG } from '../../lib/ffmpeg-path.js';
import { readFileSync } from 'fs';

const FAL_QUEUE_BASE = 'https://queue.fal.run';
const POLL_INTERVAL_MS = 4000;
const MAX_POLL = 150; // 最大 10 分待機

/** 使用するモデルエンドポイントを返す */
function getVideoModel() {
  if (config.VIDEO_GEN_PROVIDER === 'seedance') return config.SEEDANCE_ENDPOINT;
  return config.KLING_FAL_MODEL;
}

/** テンプレートからモーションプロンプトを取得 */
function getMotionPrompt(motionCode) {
  try {
    const raw = readFileSync(new URL('../../templates/motion-prompts.json', import.meta.url), 'utf8');
    const map = JSON.parse(raw);
    return map[motionCode] ?? 'cinematic camera movement, dynamic drama scene';
  } catch {
    return 'cinematic camera movement, dynamic drama scene';
  }
}

/** fal.ai ストレージへ画像をアップロード → public URL を返す */
async function uploadImage(imagePath) {
  const bytes = readFileSync(imagePath);

  const initiateRes = await fetch('https://rest.alpha.fal.ai/storage/upload/initiate', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${config.FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file_name: 'keyframe.jpg', content_type: 'image/jpeg' }),
  });
  if (!initiateRes.ok) throw new Error(`upload initiate 失敗: ${initiateRes.status}`);
  const { upload_url, file_url } = await initiateRes.json();

  await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: bytes,
  });

  return file_url;
}

/** Kling AI でクリップを生成（最大 2 回リトライ） */
async function generateClip(imageUrl, motionCode, outputPath, attempt = 1, sceneIndex = null) {
  const basePrompt = getMotionPrompt(motionCode);
  const prompt = attempt > 1
    ? `DYNAMIC DRAMATIC CAMERA MOVEMENT. ${basePrompt}. photorealistic, 9:16 vertical, cinematic drama`
    : `${basePrompt}. photorealistic, 9:16 vertical, cinematic drama`;

  const headers = {
    'Authorization': `Key ${config.FAL_KEY}`,
    'Content-Type': 'application/json',
  };

  const model = getVideoModel();
  // Step 1: ジョブ投入（response_url / status_url を受け取る）
  const submitRes = await fetch(`${FAL_QUEUE_BASE}/${model}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      image_url:    imageUrl,
      prompt,
      duration:     config.CLIP_DURATION_SEC,
      aspect_ratio: '9:16',
    }),
  });
  if (!submitRes.ok) throw new Error(`Kling submit 失敗: ${submitRes.status} ${await submitRes.text()}`);
  const submit = await submitRes.json();
  const { status_url, response_url } = submit;
  if (!status_url || !response_url) throw new Error(`fal.ai レスポンスに URL なし: ${JSON.stringify(submit)}`);

  // Step 2: status_url でポーリング（fal.ai が返す URL をそのまま使う）
  for (let i = 0; i < MAX_POLL; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const st = await fetch(status_url, { headers: { 'Authorization': `Key ${config.FAL_KEY}` } });
    if (!st.ok) continue;
    const { status } = await st.json();
    if (status === 'COMPLETED') break;
    if (status === 'FAILED') throw new Error('Kling 生成失敗');
    if (i % 5 === 0) logger.info(`  Kling 待機中... scene-${sceneIndex ?? ''} (${(i * POLL_INTERVAL_MS / 1000).toFixed(0)}秒)`);
  }

  // Step 3: response_url で結果取得
  const resultRes = await fetch(response_url, { headers: { 'Authorization': `Key ${config.FAL_KEY}` } });
  if (!resultRes.ok) throw new Error(`Kling result 取得失敗: ${resultRes.status} ${await resultRes.text()}`);
  const result = await resultRes.json();
  const videoUrl = result.video?.url;
  if (!videoUrl) throw new Error(`Kling: video URL が見つかりません: ${JSON.stringify(result)}`);

  // Step 4: ダウンロード
  const dlRes = await fetch(videoUrl);
  if (!dlRes.ok) throw new Error(`動画ダウンロード失敗: ${dlRes.status}`);
  const ws = createWriteStream(outputPath);
  await pipeline(dlRes.body, ws);

  // Step 5: 静止フレーム検出
  if (attempt === 1) {
    try {
      const out = execFileSync(FFMPEG, [
        '-i', outputPath,
        '-vf', 'freezedetect=n=0.003:d=2.0',
        '-f', 'null', '-',
      ], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
      if (out.includes('freeze_start')) {
        logger.warn(`scene フリーズ検出 → リトライ`);
        return generateClip(imageUrl, motionCode, outputPath, 2);
      }
    } catch { /* freeze detect 失敗は無視 */ }
  }
}

/**
 * @param {{ jobId, jobDir, imageVariants, verbose }} params
 * @returns {object} ClipsSchema
 */
export async function runVideoGen({ jobId, jobDir, imageVariants, verbose = false }) {
  const videosDir = join(jobDir, '04_video-gen');

  logger.info(`Kling AI 動画生成 (${imageVariants.scenes.length}シーン・並列)`);

  // 全シーンを並列投入
  const results = await Promise.allSettled(
    imageVariants.scenes.map(async (scene) => {
      const outputPath = join(videosDir, `scene-${String(scene.sceneIndex).padStart(2, '0')}-clip.mp4`);
      logger.info(`  scene-${scene.sceneIndex}: 画像アップロード中...`);
      const imageUrl = await uploadImage(scene.imagePath);
      logger.info(`  scene-${scene.sceneIndex}: Kling 投入...`);
      await generateClip(imageUrl, scene.motionCode, outputPath);
      logger.success(`  scene-${scene.sceneIndex} クリップ完了`);
      return { sceneIndex: scene.sceneIndex, clipPath: outputPath, durationSec: config.CLIP_DURATION_SEC, status: 'ok' };
    })
  );

  const clips = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    logger.warn(`scene-${imageVariants.scenes[i].sceneIndex} 失敗: ${r.reason?.message}`);
    return {
      sceneIndex: imageVariants.scenes[i].sceneIndex,
      clipPath: '',
      durationSec: 0,
      status: 'failed',
    };
  });

  const okClips = clips.filter(c => c.status === 'ok');
  if (okClips.length === 0) throw new Error('全クリップの生成に失敗しました');

  const output = { jobId, clips };
  writeFileSync(join(videosDir, '04_clips.json'), JSON.stringify(output, null, 2), 'utf8');
  logger.success(`04_clips.json (${okClips.length}/${clips.length} 成功) 完了`);
  return output;
}
