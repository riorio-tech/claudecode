/**
 * 03_image-gen — キーフレーム画像生成（Claude 不使用・直接 API 呼び出し）
 *
 * プロバイダ:
 *   IMAGE_GEN_PROVIDER=fal_flux  → fal.ai FLUX Pro (デフォルト)
 *   IMAGE_GEN_PROVIDER=nanobanana → NanoBanana Pro (API 仕様確定後に実装)
 */

import { writeFileSync, createWriteStream } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';

const FAL_QUEUE_BASE = 'https://queue.fal.run';
const FAL_FLUX_MODEL = 'fal-ai/flux/dev';

/** fal.ai ストレージへ画像をアップロード → public URL を返す */
async function uploadToFal(imagePath) {
  const { readFileSync } = await import('fs');
  const bytes = readFileSync(imagePath);

  // Step 1: アップロード URL を取得
  const initiateRes = await fetch('https://rest.alpha.fal.ai/storage/upload/initiate', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${config.FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file_name: 'image.jpg', content_type: 'image/jpeg' }),
  });
  if (!initiateRes.ok) throw new Error(`fal.ai upload initiate 失敗: ${initiateRes.status}`);
  const { upload_url, file_url } = await initiateRes.json();

  // Step 2: 画像を PUT
  const putRes = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: bytes,
  });
  if (!putRes.ok) throw new Error(`fal.ai PUT 失敗: ${putRes.status}`);

  return file_url;
}

/** fal.ai queue 経由で画像を生成し、ダウンロードして保存 */
async function generateViaFalFlux(imagePrompt, negativePrompt, outputPath) {
  const headers = {
    'Authorization': `Key ${config.FAL_KEY}`,
    'Content-Type': 'application/json',
  };

  // Step 1: ジョブ投入（response_url / status_url を受け取る）
  const submitRes = await fetch(`${FAL_QUEUE_BASE}/${FAL_FLUX_MODEL}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt: imagePrompt,
      image_size: { width: config.IMAGE_WIDTH, height: config.IMAGE_HEIGHT },
      num_inference_steps: 28,
      num_images: 1,
      output_format: 'jpeg',
      enable_safety_checker: false,
    }),
  });
  if (!submitRes.ok) throw new Error(`FLUX submit 失敗: ${submitRes.status} ${await submitRes.text()}`);
  const submit = await submitRes.json();
  const { status_url, response_url } = submit;
  if (!status_url || !response_url) throw new Error(`fal.ai レスポンスに URL なし: ${JSON.stringify(submit)}`);

  // Step 2: status_url でポーリング（fal.ai が返す URL をそのまま使う）
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const st = await fetch(status_url, { headers: { 'Authorization': `Key ${config.FAL_KEY}` } });
    if (!st.ok) continue;
    const { status } = await st.json();
    if (status === 'COMPLETED') break;
    if (status === 'FAILED') throw new Error('FLUX 生成失敗');
  }

  // Step 3: response_url で結果取得
  const resultRes = await fetch(response_url, { headers: { 'Authorization': `Key ${config.FAL_KEY}` } });
  if (!resultRes.ok) throw new Error(`FLUX result 取得失敗: ${resultRes.status} ${await resultRes.text()}`);
  const result = await resultRes.json();
  const imageUrl = result.images?.[0]?.url ?? result.image?.url;
  if (!imageUrl) throw new Error(`FLUX: image URL が見つかりません: ${JSON.stringify(result)}`);

  // Step 4: ダウンロード
  const dlRes = await fetch(imageUrl);
  if (!dlRes.ok) throw new Error(`画像ダウンロード失敗: ${dlRes.status}`);
  const ws = createWriteStream(outputPath);
  await pipeline(dlRes.body, ws);
}

/** nano-banana-2 via fal.ai queue */
async function generateViaNanoBanana(imagePrompt, negativePrompt, outputPath) {
  const headers = {
    'Authorization': `Key ${config.FAL_KEY}`,
    'Content-Type': 'application/json',
  };
  const endpoint = config.NANO_BANANA_ENDPOINT;

  const submitRes = await fetch(`${FAL_QUEUE_BASE}/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt: imagePrompt,
      image_size: { width: config.IMAGE_WIDTH, height: config.IMAGE_HEIGHT },
      num_images: 1,
    }),
  });
  if (!submitRes.ok) throw new Error(`nano-banana submit 失敗: ${submitRes.status} ${await submitRes.text()}`);
  const submit = await submitRes.json();
  const { status_url, response_url } = submit;
  if (!status_url || !response_url) throw new Error(`fal.ai URL なし: ${JSON.stringify(submit)}`);

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const st = await fetch(status_url, { headers: { 'Authorization': `Key ${config.FAL_KEY}` } });
    if (!st.ok) continue;
    const { status } = await st.json();
    if (status === 'COMPLETED') break;
    if (status === 'FAILED') throw new Error('nano-banana 生成失敗');
  }

  const resultRes = await fetch(response_url, { headers: { 'Authorization': `Key ${config.FAL_KEY}` } });
  if (!resultRes.ok) throw new Error(`nano-banana result 失敗: ${resultRes.status}`);
  const result = await resultRes.json();
  const imageUrl = result.images?.[0]?.url ?? result.image?.url;
  if (!imageUrl) throw new Error(`nano-banana: image URL なし: ${JSON.stringify(result)}`);

  const dlRes = await fetch(imageUrl);
  if (!dlRes.ok) throw new Error(`画像ダウンロード失敗: ${dlRes.status}`);
  const ws = createWriteStream(outputPath);
  await pipeline(dlRes.body, ws);
}

/**
 * @param {{ jobId, jobDir, scenePlan, verbose }} params
 * @returns {object} ImageVariantsSchema
 */
export async function runImageGen({ jobId, jobDir, scenePlan, verbose = false }) {
  const imagesDir = join(jobDir, '03_image-gen');
  const scenes = [];

  for (const scene of scenePlan.scenes) {
    const outputPath = join(imagesDir, `scene-${String(scene.sceneIndex).padStart(2, '0')}-keyframe.jpg`);
    logger.info(`画像生成 scene-${scene.sceneIndex} (${config.IMAGE_GEN_PROVIDER})...`);

    try {
      if (config.IMAGE_GEN_PROVIDER === 'nano-banana') {
        await generateViaNanoBanana(scene.imagePrompt, scene.negativePrompt, outputPath);
      } else {
        await generateViaFalFlux(scene.imagePrompt, scene.negativePrompt, outputPath);
      }
      logger.success(`scene-${scene.sceneIndex} 画像完了`);
    } catch (e) {
      logger.warn(`scene-${scene.sceneIndex} 画像生成失敗: ${e.message}`);
      // 失敗シーンはスキップ（後段でエラー処理）
      continue;
    }

    scenes.push({
      sceneIndex:        scene.sceneIndex,
      imagePath:         outputPath,
      motionCode:        scene.motionCode,
      targetDurationSec: scene.targetDurationSec,
    });
  }

  if (scenes.length === 0) throw new Error('全シーンの画像生成に失敗しました');

  const variants = { jobId, scenes };
  writeFileSync(join(jobDir, '03_image-gen', '03_image-variants.json'), JSON.stringify(variants, null, 2), 'utf8');
  logger.success(`03_image-variants.json (${scenes.length}シーン) 完了`);
  return variants;
}
