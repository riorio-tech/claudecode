import { readFileSync, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { extname } from 'path';

/**
 * fal.ai rembg で背景を除去した透過 PNG を出力する
 * FAL_KEY 未設定時は false を返して graceful degradation
 *
 * @param {string} inputImagePath - 入力画像パス
 * @param {string} outputPngPath  - 出力先 PNG パス（透過）
 * @returns {Promise<boolean>} 成功したら true、スキップなら false
 */
export async function removeBackground(inputImagePath, outputPngPath) {
  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    return false;
  }

  const { fal } = await import('@fal-ai/client');
  fal.config({ credentials: falKey });

  const imageData = readFileSync(inputImagePath);
  const ext = extname(inputImagePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  const fileName = `product${ext}`;
  const file = new File([imageData], fileName, { type: mimeType });

  const imageUrl = await fal.storage.upload(file);

  const result = await fal.subscribe('fal-ai/imageutils/rembg', {
    input: { image_url: imageUrl },
  });

  const imgUrl = result?.data?.image?.url ?? result?.image?.url;
  if (!imgUrl) throw new Error('rembg: 結果の URL が取得できませんでした');

  const response = await fetch(imgUrl);
  if (!response.ok) throw new Error(`rembg ダウンロード失敗: ${response.status}`);

  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(outputPngPath)
  );

  return true;
}
