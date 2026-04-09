import { readFileSync, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { extname } from 'path';

/**
 * fal.ai クライアントの初期化（シングルトン）
 * @returns {Promise<import('@fal-ai/client').FalClient>}
 */
async function getFalClient() {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new Error('FAL_KEY が設定されていません');
  const { fal } = await import('@fal-ai/client');
  fal.config({ credentials: falKey });
  return fal;
}

/**
 * ローカル画像ファイルを fal.ai ストレージにアップロードして URL を返す
 * @param {string} imagePath
 * @returns {Promise<string>} アップロード済み URL
 */
export async function uploadImage(imagePath) {
  const fal = await getFalClient();
  const imageData = readFileSync(imagePath);
  const ext = extname(imagePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  const file = new File([imageData], `image${ext}`, { type: mimeType });
  return fal.storage.upload(file);
}

/**
 * fal.ai で画像から動画クリップを生成してローカルに保存する
 *
 * @param {{
 *   modelEndpoint: string,   // 例: "fal-ai/kling-video/v1.6/standard/image-to-video"
 *   imageUrl: string,        // fal.ai ストレージ URL
 *   prompt: string,          // モーション・シーン説明プロンプト
 *   durationSec: number,     // 目標秒数（5 or 10 に丸める）
 *   outputPath: string,      // 保存先 MP4 パス
 *   verbose: boolean,
 * }} params
 * @returns {Promise<void>}
 */
export async function generateVideoClip({ modelEndpoint, imageUrl, prompt, durationSec, outputPath, verbose }) {
  const fal = await getFalClient();

  // モデルごとのサポート duration を判定
  const duration = resolveDuration(modelEndpoint, durationSec);

  const input = buildInput(modelEndpoint, { imageUrl, prompt, duration });

  if (verbose) {
    console.log(`  [fal] ${modelEndpoint} prompt="${prompt.slice(0, 60)}..." duration=${duration}`);
  }

  const result = await fal.subscribe(modelEndpoint, {
    input,
    logs: false,
  });

  // レスポンス形式はモデルによって異なるため複数パスを試みる
  const videoUrl =
    result?.data?.video?.url ??
    result?.data?.videos?.[0]?.url ??
    result?.video?.url ??
    result?.videos?.[0]?.url;

  if (!videoUrl) {
    throw new Error(`fal.ai からの動画 URL が取得できませんでした: ${JSON.stringify(result)}`);
  }

  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(`動画ダウンロード失敗 (${response.status}): ${videoUrl}`);

  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(outputPath)
  );
}

/**
 * fal.ai rembg で背景を除去した透過 PNG を出力する
 * FAL_KEY 未設定時は false を返して graceful degradation
 *
 * @param {string} inputImagePath
 * @param {string} outputPngPath
 * @returns {Promise<boolean>}
 */
export async function removeBackground(inputImagePath, outputPngPath) {
  const falKey = process.env.FAL_KEY;
  if (!falKey) return false;

  const fal = await getFalClient();
  const imageUrl = await uploadImage(inputImagePath);

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

// ─── 内部ヘルパー ────────────────────────────────────────────────────────────

/**
 * モデルのサポート duration に合わせて秒数文字列を返す
 */
function resolveDuration(modelEndpoint, durationSec) {
  // minimax・luma は duration 指定なし
  if (modelEndpoint.includes('minimax') || modelEndpoint.includes('luma')) {
    return null;
  }
  // kling・wan・hunyuan は "5" or "10"
  return durationSec > 5 ? '10' : '5';
}

/**
 * モデルごとの input オブジェクトを組み立てる
 */
function buildInput(modelEndpoint, { imageUrl, prompt, duration }) {
  const base = {
    image_url: imageUrl,
    prompt,
  };

  if (modelEndpoint.includes('kling-video')) {
    return {
      ...base,
      duration: duration ?? '5',
      aspect_ratio: '9:16',
    };
  }

  if (modelEndpoint.includes('wan')) {
    return {
      ...base,
      duration: duration ?? '5',
      resolution: '480p',    // wan は 480p/720p
      aspect_ratio: '9:16',
    };
  }

  if (modelEndpoint.includes('hunyuan')) {
    return {
      ...base,
      num_frames: duration === '10' ? 257 : 129,  // ~8.5s / ~4.3s at 30fps
    };
  }

  if (modelEndpoint.includes('minimax')) {
    return {
      ...base,
      prompt_optimizer: true,
    };
  }

  if (modelEndpoint.includes('luma')) {
    return {
      ...base,
      aspect_ratio: '9:16',
    };
  }

  // 汎用フォールバック
  return base;
}
