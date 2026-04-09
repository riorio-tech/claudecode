import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { validate, VideoClipsSchema } from '../../lib/validate-json.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config.js';
import { FFMPEG } from '../../lib/ffmpeg-path.js';

/**
 * 1本分の動画クリップを生成する
 *
 * @param {{ jobId: string, videoGenDir: string, imageVariants: object, videoShotPlan: object, verbose: boolean }} params
 * @returns {object} VideoClipsSchema 準拠の出力
 */
export async function runVideoGen({ jobId, videoGenDir, imageVariants, videoShotPlan, verbose }) {
  mkdirSync(videoGenDir, { recursive: true });

  if (config.VIDEO_GEN_PROVIDER === 'local') {
    return runLocalVideoGen({ jobId, videoGenDir, imageVariants, videoShotPlan, verbose });
  }

  if (config.VIDEO_GEN_PROVIDER === 'runway') {
    return runRunwayVideoGen({ jobId, videoGenDir, imageVariants, videoShotPlan, verbose });
  }

  throw new Error(`VIDEO_GEN_PROVIDER "${config.VIDEO_GEN_PROVIDER}" は未実装です`);
}

// ─── Runway Gen-3 via fal.ai queue ──────────────────────────────────────────

// motionHint / motion → Runway プロンプトテキストのマッピング（v2 motionHint + 旧互換）
const MOTION_TO_PROMPT = {
  // v2 motionHint
  'fast_drop_bounce': 'product drops rapidly into frame from above and bounces, dynamic impact motion with strong momentum',
  'zoom_out_fast':    'camera rapidly pulls back from extreme close-up to full product reveal, fast reverse zoom with energy',
  'slow_push_in':     'camera slowly and smoothly pushes in toward product, gentle purposeful dolly forward',
  'continuous_orbit': 'camera orbits around product in smooth horizontal arc, 360-degree circular reveal',
  'gentle_sway':      'product gently sways side to side in hands, natural soft handheld motion',
  'parallax_drift':   'subtle parallax shift between foreground product and background, slow cinematic drift',
  'slide_wipe_left':  'frame slides smoothly to the left in a clean wipe transition',
  'dolly_in_tilt_up': 'camera dollies in while tilting upward, revealing product from base to top in one fluid move',
  'micro_drift':      'extremely subtle camera drift, nearly still with micro vibration, product sharp in focus',
  'slow_roll':        'camera slowly rolls and rotates as product tilts, dynamic dutch angle motion',
  // 旧互換
  'zoom-in':    'slow dolly in, camera slowly moves forward toward the subject',
  'zoom-out':   'slow dolly out, camera slowly pulls back from the subject',
  'slide-left': 'smooth pan left, camera tracks horizontally to the left',
  'slide-right':'smooth pan right, camera tracks horizontally to the right',
  'flash':      'dynamic energetic camera movement with quick push in',
  'static':     'subtle handheld camera drift, minimal movement, natural feel',
};

async function runRunwayVideoGen({ jobId, videoGenDir, imageVariants, videoShotPlan, verbose }) {
  checkFfmpeg();

  const falKey = process.env.FAL_KEY?.trim();
  if (!falKey) throw new Error('FAL_KEY が設定されていません');

  const { fal } = await import('@fal-ai/client');
  fal.config({ credentials: falKey });

  const { videoIndex, shots } = videoShotPlan;
  const shotMap = Object.fromEntries(shots.map(s => [s.index, s]));

  // 全バリアントを並列で Runway に投げる
  const clips = await Promise.all(
    imageVariants.variants.map(variant =>
      runRunwayClip({ variant, shotMap, videoGenDir, falKey, verbose })
    )
  );

  const output = validate(VideoClipsSchema, { jobId, videoIndex, clips });
  const outputJsonPath = join(videoGenDir, `${String(videoIndex).padStart(2, '0')}-video-clips.json`);
  writeFileSync(outputJsonPath, JSON.stringify(output, null, 2), 'utf8');

  if (verbose) {
    logger.success(`video-${videoIndex}: ${clips.length}クリップ生成完了（Runway via fal.ai）`);
  }
  return output;
}

async function runRunwayClip({ variant, shotMap, videoGenDir, falKey, verbose }) {
  const { fal } = await import('@fal-ai/client');
  const { videoIndex, shotIndex, imagePath } = variant;
  const shot = shotMap[shotIndex];
  const motionKey = shot?.motionHint ?? shot?.motion ?? 'static';
  const durationSec = shot?.durationSec ?? 1;
  const promptText = MOTION_TO_PROMPT[motionKey] ?? MOTION_TO_PROMPT['static'];

  const filename = `${String(videoIndex).padStart(2, '0')}-clip-${String(shotIndex).padStart(2, '0')}.mp4`;
  const clipPath = join(videoGenDir, filename);

  // 画像を fal.ai にアップロードして URL 取得
  const imageBuffer = readFileSync(imagePath);
  const mimeType = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const imageUrl = await fal.storage.upload(
    new File([imageBuffer], 'image.jpg', { type: mimeType })
  );

  if (verbose) {
    logger.info(`[runway] video-${videoIndex} clip-${shotIndex} [${motion}] submit...`);
  }

  // 最大3回リトライ（静止画検出時）
  for (let attempt = 0; attempt < 3; attempt++) {
    const retryPrompt = attempt > 0
      ? `DYNAMIC VIDEO. ${promptText} Strong visible motion throughout.`
      : promptText;

    await generateRunwayClip({ imageUrl, prompt: retryPrompt, clipPath, falKey, verbose });

    if (!isStaticClip(clipPath)) break;

    if (attempt < 2) {
      if (verbose) logger.info(`[runway] video-${videoIndex} clip-${shotIndex} 静止画検出 → リトライ ${attempt + 1}/3`);
    }
  }

  return { videoIndex, shotIndex, videoPath: clipPath, durationSec, motion: motionKey };
}

/**
 * Runway Gen-3 を fal.ai queue HTTP API 経由で呼び出す
 *
 * Note: @fal-ai/client の fal.subscribe はネストしたモデルパス
 * (fal-ai/runway-gen3/alpha/image-to-video) の result URL を誤構築するため、
 * Python 参照スクリプト(swap.py)と同じく生 HTTP API を使用する。
 */
async function generateRunwayClip({ imageUrl, prompt, clipPath, falKey, verbose }) {
  const model = config.RUNWAY_FAL_MODEL;
  const headers = { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' };

  // 1. Submit
  const submitRes = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ image_url: imageUrl, prompt, duration: 5, ratio: '9:16' }),
  });
  if (!submitRes.ok) {
    const body = await submitRes.text();
    throw new Error(`Runway submit 失敗 ${submitRes.status}: ${body}`);
  }
  const submitData = await submitRes.json();
  const requestId = submitData.request_id;
  const base = `https://queue.fal.run/${model}/requests/${requestId}`;
  const statusUrl = `${base}/status`;

  // 2. Poll（最大15分）
  const deadline = Date.now() + 15 * 60 * 1000;
  while (true) {
    if (Date.now() > deadline) throw new Error(`Runway タイムアウト（15分超過）request_id=${requestId}`);
    await new Promise(r => setTimeout(r, 5000));
    const st = await fetch(statusUrl, { headers });
    if (!st.ok) continue;
    const statusData = await st.json();
    const status = statusData.status ?? statusData.state;
    if (verbose) logger.info(`[runway] ${requestId} status: ${status}`);
    if (status === 'FAILED') throw new Error(`Runway 失敗: ${JSON.stringify(statusData)}`);
    if (status === 'COMPLETED') break;
  }

  // 3. Fetch result
  const rr = await fetch(base, { headers });
  if (!rr.ok) {
    const body = await rr.text();
    throw new Error(`Runway result 取得失敗 ${rr.status}: ${body}`);
  }
  const result = await rr.json();
  const videoUrl = result?.video?.url ?? result?.url;
  if (!videoUrl) throw new Error(`Runway 結果 URL なし: ${JSON.stringify(result)}`);

  // 4. Download
  const dl = await fetch(videoUrl);
  if (!dl.ok) throw new Error(`動画ダウンロード失敗: ${dl.status}`);
  writeFileSync(clipPath, Buffer.from(await dl.arrayBuffer()));
}

function isStaticClip(videoPath) {
  if (!existsSync(videoPath)) return false;
  try {
    const result = execSync(
      `"${FFMPEG}" -i "${videoPath}" -vf "freezedetect=n=0.003:d=2.0" -f null -`,
      { stdio: 'pipe', timeout: 30_000 }
    ).toString('utf8');
    return result.includes('freeze_duration');
  } catch (e) {
    // stderr にも出るので stderr を確認
    return (e.stderr?.toString() ?? '').includes('freeze_duration');
  }
}

// ─── local（ffmpeg zoompan） ────────────────────────────────────────────────

async function runLocalVideoGen({ jobId, videoGenDir, imageVariants, videoShotPlan, verbose }) {
  checkFfmpeg();

  const { videoIndex, shots } = videoShotPlan;
  const shotMap = Object.fromEntries(shots.map(s => [s.index, s]));

  const clips = [];

  for (const variant of imageVariants.variants) {
    const { shotIndex, imagePath } = variant;
    const shot = shotMap[shotIndex];
    const motion = shot?.motionHint ?? shot?.motion ?? 'static';
    const durationSec = shot?.durationSec ?? 1;

    const filename = `${String(videoIndex).padStart(2, '0')}-clip-${String(shotIndex).padStart(2, '0')}.mp4`;
    const clipPath = join(videoGenDir, filename);

    const cmd = buildFfmpegCmd(imagePath, clipPath, motion, durationSec);

    if (verbose) {
      logger.info(`[ffmpeg] video-${videoIndex} clip-${shotIndex} [${motion}] ${durationSec}s`);
    }

    try {
      execSync(cmd, { stdio: verbose ? 'inherit' : 'pipe', timeout: 120_000 });
    } catch (e) {
      throw new Error(`video-${videoIndex} clip-${shotIndex}.mp4 の生成に失敗: ${e.message}`);
    }

    if (!existsSync(clipPath)) {
      throw new Error(`video-${videoIndex} clip-${shotIndex}.mp4 が生成されませんでした`);
    }

    clips.push({
      videoIndex,
      shotIndex,
      videoPath: clipPath,
      durationSec,
      motion,
    });
  }

  const output = validate(VideoClipsSchema, { jobId, videoIndex, clips });
  const outputJsonPath = join(videoGenDir, `${String(videoIndex).padStart(2, '0')}-video-clips.json`);
  writeFileSync(outputJsonPath, JSON.stringify(output, null, 2), 'utf8');

  if (verbose) {
    logger.success(`video-${videoIndex}: ${clips.length}クリップ生成完了`);
  }
  return output;
}

function buildFfmpegCmd(inputJpg, outputMp4, motion, durationSec) {
  const frames = Math.round(durationSec * 30);
  const base = `"${FFMPEG}" -y -loop 1 -i "${inputJpg}" -t ${durationSec} -r 30`;
  const codec = `-c:v libx264 -pix_fmt yuv420p -preset medium -b:v 12M -maxrate 15M -bufsize 30M`;

  let vf;
  switch (motion) {
    case 'zoom-in':
      vf = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
           `zoompan=z='min(1.0+on/${frames}*0.25,1.25)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,setsar=1`;
      break;
    case 'zoom-out':
      vf = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
           `zoompan=z='max(1.25-on/${frames}*0.25,1.0)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,setsar=1`;
      break;
    case 'slide-left':
      vf = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
           `zoompan=z='1.15':d=${frames}:x='iw/2-(iw/zoom/2)+iw*0.1*(1-on/${frames})':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,setsar=1`;
      break;
    case 'slide-right':
      vf = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
           `zoompan=z='1.15':d=${frames}:x='iw/2-(iw/zoom/2)-iw*0.1*(1-on/${frames})':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,setsar=1`;
      break;
    case 'flash':
      vf = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
           `zoompan=z='min(1.0+on/${frames}*0.2,1.2)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,setsar=1`;
      break;
    case 'static':
    default:
      vf = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
           `zoompan=z='1.05':d=${frames}:x='iw/2-(iw/zoom/2)+sin(on/15)*8':y='ih/2-(ih/zoom/2)+cos(on/20)*5':s=1080x1920:fps=30,setsar=1`;
      break;
  }

  return `${base} -vf "${vf}" ${codec} "${outputMp4}"`;
}

function checkFfmpeg() {
  try {
    execSync(`"${FFMPEG}" -version`, { stdio: 'pipe' });
  } catch {
    throw new Error(`ffmpeg が見つかりません: ${FFMPEG}`);
  }
}
