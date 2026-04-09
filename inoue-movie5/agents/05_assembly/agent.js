import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync, spawnSync } from 'child_process';
import { validate, AssemblyOutputSchema } from '../../lib/validate-json.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config.js';
import { FFMPEG, FFPROBE } from '../../lib/ffmpeg-path.js';

/**
 * 1本分のクリップを連結・アップスケール・音声・字幕・カラーグレードして final.mp4 を生成する
 */
export async function runAssembly({ jobId, assemblyDir, videoClips, compositedVideoPath, videoShotPlan, verbose }) {
  mkdirSync(assemblyDir, { recursive: true });

  const { videoIndex, voiceScript, shots } = videoShotPlan;

  // ─── Step 1: concat ────────────────────────────────────────────────────────
  let concatPath;
  if (compositedVideoPath) {
    concatPath = compositedVideoPath;
    if (verbose) {
      const dur = getDuration(concatPath);
      logger.info(`video-${videoIndex}: テンプレートモード ${dur.toFixed(2)}秒`);
    }
  } else {
    const listPath = join(assemblyDir, 'list.txt');
    const sortedClips = [...videoClips.clips].sort((a, b) => a.shotIndex - b.shotIndex);
    writeFileSync(listPath, sortedClips.map(c => `file '${c.videoPath}'`).join('\n'), 'utf8');

    concatPath = join(assemblyDir, 'concat-noaudio.mp4');
    run(`"${FFMPEG}" -y -f concat -safe 0 -i "${listPath}" -c copy "${concatPath}"`, verbose);

    const durationSec = getDuration(concatPath);
    if (durationSec < 15 || durationSec > 30) {
      throw new Error(
        `video-${videoIndex}: 動画の尺が範囲外: ${durationSec.toFixed(2)}秒（許容: 15〜30秒）`
      );
    }
    if (verbose) logger.info(`video-${videoIndex}: 連結後の尺 ${durationSec.toFixed(2)}秒`);
  }

  // ─── Step 2: Real-ESRGAN 4K アップスケール ────────────────────────────────
  const upscalePath = await upscaleVideo(concatPath, assemblyDir, videoIndex, verbose);

  // ─── Step 3: ElevenLabs ナレーション + タイムスタンプ ───────────────────────
  const narrationPath = join(assemblyDir, 'narration.mp3');
  const { hasNarration, alignment } = await generateNarration(voiceScript, narrationPath, verbose, videoIndex);

  // ─── Step 4: 字幕セグメント構築 ───────────────────────────────────────────
  const totalDur = getDuration(upscalePath);
  let subtitleSegments;
  if (hasNarration && alignment) {
    subtitleSegments = buildSubtitleFromAlignment(alignment);
  } else {
    subtitleSegments = buildSubtitleFromShots(shots);
  }

  // ─── Step 5: 音声ミックス + 字幕 + ウォームカラーグレード ──────────────────
  const finalPath = join(assemblyDir, 'final.mp4');
  await assembleFinal({ upscalePath, narrationPath: hasNarration ? narrationPath : null, subtitleSegments, finalPath, verbose });

  if (!existsSync(finalPath)) {
    throw new Error(`video-${videoIndex}: final.mp4 の生成に失敗しました`);
  }

  const finalDuration = getDuration(finalPath);
  logger.success(`video-${videoIndex}: final.mp4 完成 (${finalDuration.toFixed(1)}秒)`);

  const output = validate(AssemblyOutputSchema, {
    jobId,
    videoIndex,
    finalVideoPath: finalPath,
    durationSec: finalDuration,
    hasAudio: hasNarration,
  });

  writeFileSync(join(assemblyDir, 'assembly-output.json'), JSON.stringify(output, null, 2), 'utf8');
  return output;
}

// ─── Real-ESRGAN 4K アップスケール ──────────────────────────────────────────

async function upscaleVideo(srcPath, assemblyDir, videoIndex, verbose) {
  if (config.UPSCALE_PROVIDER === 'none') {
    if (verbose) logger.info(`video-${videoIndex}: アップスケールスキップ`);
    return srcPath;
  }

  const upscalePath = join(assemblyDir, 'concat-4k.mp4');
  if (existsSync(upscalePath)) {
    if (verbose) logger.info(`video-${videoIndex}: アップスケールキャッシュ済み`);
    return upscalePath;
  }

  if (verbose) logger.info(`video-${videoIndex}: Real-ESRGAN 4K アップスケール中...`);

  try {
    const falKey = process.env.FAL_KEY?.trim();
    if (!falKey) throw new Error('FAL_KEY が未設定');

    const { fal } = await import('@fal-ai/client');
    fal.config({ credentials: falKey });

    const { readFileSync } = await import('fs');
    const videoBuffer = readFileSync(srcPath);
    const videoUrl = await fal.storage.upload(
      new File([videoBuffer], 'concat.mp4', { type: 'video/mp4' })
    );

    const result = await fal.subscribe('fal-ai/real-esrgan', {
      input: { video_url: videoUrl, scale: 4, model: 'RealESRGAN_x4plus' },
      pollInterval: 10000,
      timeout: 600_000,
      logs: verbose,
    });

    const upscaledUrl = result.data?.video?.url ?? result.data?.url;
    if (!upscaledUrl) throw new Error('Real-ESRGAN 結果 URL なし');

    const res = await fetch(upscaledUrl);
    if (!res.ok) throw new Error(`ダウンロード失敗: ${res.status}`);
    const rawPath = join(assemblyDir, 'upscale-raw.mp4');
    writeFileSync(rawPath, Buffer.from(await res.arrayBuffer()));

    // 2160×3840 に正規化
    run(
      `"${FFMPEG}" -y -i "${rawPath}" -vf "scale=2160:3840:flags=lanczos" ` +
      `-c:v libx264 -pix_fmt yuv420p -preset fast -b:v 55M -c:a copy "${upscalePath}"`,
      verbose
    );
    try { execSync(`rm -f "${rawPath}"`); } catch {}

  } catch (e) {
    logger.warn(`video-${videoIndex}: Real-ESRGAN 失敗 → ソフトウェアアップスケール: ${e.message}`);
    run(
      `"${FFMPEG}" -y -i "${srcPath}" -vf "scale=2160:3840:flags=lanczos+accurate_rnd" ` +
      `-c:v libx264 -pix_fmt yuv420p -preset medium -b:v 55M -c:a copy "${upscalePath}"`,
      verbose
    );
  }

  const res = getResolution(upscalePath);
  if (verbose) logger.info(`video-${videoIndex}: アップスケール完了 → ${res}`);
  return upscalePath;
}

// ─── ElevenLabs v3 TTS ──────────────────────────────────────────────────────

async function generateNarration(voiceScript, narrationPath, verbose, videoIndex) {
  if (config.TTS_PROVIDER === 'elevenlabs') {
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    const voiceId = process.env.ELEVENLABS_VOICE?.trim();
    if (!apiKey || !voiceId) {
      throw new Error('ELEVENLABS_API_KEY または ELEVENLABS_VOICE が未設定');
    }
    try {
      const alignment = await elevenlabsTTS(voiceScript, narrationPath, apiKey, voiceId, verbose, videoIndex);
      return { hasNarration: true, alignment };
    } catch (e) {
      throw new Error(`ElevenLabs TTS 失敗: ${e.message}`);
    }
  }

  // say コマンド（macOS）フォールバック
  const checkSay = spawnSync('which', ['say'], { encoding: 'utf8' });
  if (checkSay.status !== 0) {
    logger.warn(`video-${videoIndex}: say コマンドが見つかりません。音声なしで続行します。`);
    return { hasNarration: false, alignment: null };
  }

  const aiffPath = narrationPath.replace('.mp3', '.aiff');
  const sayResult = spawnSync('say', ['-v', 'Kyoko', '-o', aiffPath, voiceScript], {
    encoding: 'utf8', timeout: 30_000,
  });

  if (sayResult.status !== 0) {
    logger.warn(`video-${videoIndex}: 音声生成失敗。音声なしで続行します。`);
    return { hasNarration: false, alignment: null };
  }

  try {
    run(`"${FFMPEG}" -y -i "${aiffPath}" "${narrationPath}"`, verbose);
    return { hasNarration: true, alignment: null };
  } catch (e) {
    logger.warn(`video-${videoIndex}: AIFF→MP3変換失敗: ${e.message}`);
    return { hasNarration: false, alignment: null };
  }
}

async function elevenlabsTTS(text, outPath, apiKey, voiceId, verbose, videoIndex) {
  const headers = { 'xi-api-key': apiKey, 'Content-Type': 'application/json' };

  // 利用可能モデル確認（eleven_v3 は有料プランのみ）
  let modelsToTry = ['eleven_v3', 'eleven_multilingual_v2'];
  try {
    const mr = await fetch('https://api.elevenlabs.io/v1/models', {
      headers: { 'xi-api-key': apiKey },
    });
    if (mr.ok) {
      const list = await mr.json();
      const ids = new Set(list.map(m => m.model_id));
      if (!ids.has('eleven_v3')) {
        modelsToTry = ['eleven_multilingual_v2'];
        if (verbose) logger.info(`video-${videoIndex}: eleven_v3 非対応プラン → eleven_multilingual_v2`);
      }
    }
  } catch {}

  const body = {
    text,
    voice_settings: {
      stability: 0.30,
      similarity_boost: 0.75,
      style: 0.45,
      use_speaker_boost: true,
    },
  };

  for (const modelId of modelsToTry) {
    body.model_id = modelId;
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
      { method: 'POST', headers, body: JSON.stringify(body) }
    );

    if (r.ok) {
      const data = await r.json();
      const audioBuf = Buffer.from(data.audio_base64, 'base64');
      writeFileSync(outPath, audioBuf);
      if (verbose) logger.info(`video-${videoIndex}: ElevenLabs ${modelId} 完了`);
      return data.alignment ?? null;
    }

    if ((r.status === 402 || r.status === 422) && modelId === 'eleven_v3') {
      if (verbose) logger.info(`video-${videoIndex}: eleven_v3 不可 → eleven_multilingual_v2 にフォールバック`);
      continue;
    }

    throw new Error(`ElevenLabs API エラー ${r.status}: ${await r.text()}`);
  }

  throw new Error('ElevenLabs TTS 失敗（全モデル試行済み）');
}

// ─── 字幕セグメント構築 ──────────────────────────────────────────────────────

/** ElevenLabs 文字レベルタイムスタンプから字幕セグメントを生成 */
function buildSubtitleFromAlignment(alignment) {
  const chars  = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends   = alignment?.character_end_times_seconds ?? [];
  if (!chars.length) return [];

  const segments = [];
  let phraseChars = [];
  let phraseStart = null;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (phraseStart === null) phraseStart = starts[i] ?? 0;
    phraseChars.push(char);
    if ('。！？'.includes(char) || i === chars.length - 1) {
      const phraseText = phraseChars.join('').trim();
      const phraseEnd  = ends[i] ?? (starts[i] ?? 0);
      if (phraseText) {
        segments.push({ text: phraseText, start: +phraseStart.toFixed(3), end: +phraseEnd.toFixed(3) });
      }
      phraseChars = [];
      phraseStart = null;
    }
  }
  return segments;
}

/** フォールバック: ショット境界ベースの字幕タイミング */
function buildSubtitleFromShots(shots) {
  let currentTime = 0;
  return shots.map(shot => {
    const start = currentTime;
    const end   = currentTime + (shot.durationSec ?? 3);
    currentTime = end;
    return { text: shot.overlayText ?? '', start, end };
  });
}

// ─── 音声ミックス + 字幕 + ウォームカラーグレード ───────────────────────────

async function assembleFinal({ upscalePath, narrationPath, subtitleSegments, finalPath, verbose }) {
  const fontPath = findJapaneseFont();
  const fontOpt  = fontPath ? `fontfile='${fontPath}':` : '';

  const res = getResolution(upscalePath);
  const inW = parseInt(res.split('×')[0]) || 720;
  const baseFontsize = Math.max(40, Math.round(40 * inW / 720));

  // ウォームカラーグレード（参照スクリプトと同一パラメータ）
  const warmGrade = [
    'eq=brightness=0.03:contrast=1.08:saturation=1.15',
    'colorbalance=rs=0.04:gs=0.02:bs=-0.06:rm=0.02:gm=0.01:bm=-0.04:rh=0.01:gh=0.00:bh=-0.02',
  ].join(',');

  // 字幕 drawtext フィルター
  const drawtextFilters = subtitleSegments
    .filter(s => s.text)
    .map(s => {
      const safe = escapeDrawtext(s.text);
      return (
        `drawtext=${fontOpt}text='${safe}':fontsize=${baseFontsize}:fontcolor=white` +
        `:x=(w-text_w)/2:y=h*0.88` +
        `:shadowcolor=black@0.8:shadowx=2:shadowy=2` +
        `:borderw=3:bordercolor=black@0.7` +
        `:enable='between(t,${s.start},${s.end})'`
      );
    });

  // 4K 済みかどうか判定してスケールフィルター決定
  const needsScale = inW < 2160;
  const vfParts = needsScale
    ? [warmGrade, `scale=2160:3840:flags=lanczos`, ...drawtextFilters]
    : [warmGrade, ...drawtextFilters];
  const vf = vfParts.join(',') || 'null';

  const videoQuality = `-c:v libx264 -pix_fmt yuv420p -preset medium -b:v 55M -maxrate 65M -bufsize 130M`;
  const audioQuality = `-c:a aac -b:a 192k -ar 44100 -ac 2`;

  if (narrationPath && existsSync(narrationPath)) {
    run(
      `"${FFMPEG}" -y -i "${upscalePath}" -i "${narrationPath}" ` +
      `-map 0:v:0 -map 1:a:0 ` +
      `-vf "${vf}" -r 30 ` +
      `${videoQuality} ${audioQuality} -shortest "${finalPath}"`,
      verbose
    );
  } else {
    run(
      `"${FFMPEG}" -y -i "${upscalePath}" ` +
      `-vf "${vf}" -r 30 ` +
      `${videoQuality} "${finalPath}"`,
      verbose
    );
  }
}

// ─── ユーティリティ ──────────────────────────────────────────────────────────

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

function getResolution(videoPath) {
  const result = spawnSync(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ], { encoding: 'utf8' });
  const parts = result.stdout?.trim().split('\n') ?? [];
  return parts.length >= 2 ? `${parts[0]}×${parts[1]}` : '720×1280';
}

function findJapaneseFont() {
  const candidates = [
    '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc',
    '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc',
    '/Library/Fonts/Arial Unicode.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function escapeDrawtext(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/%/g, '\\%');
}

function run(cmd, verbose) {
  try {
    execSync(cmd, { stdio: verbose ? 'inherit' : 'pipe', timeout: 300_000 });
  } catch (e) {
    throw new Error(`ffmpeg コマンド失敗: ${e.message}`);
  }
}
