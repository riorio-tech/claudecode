import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync, spawnSync } from 'child_process';
import { validate, AssemblyOutputSchema } from '../../lib/validate-json.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config.js';
import { FFMPEG, FFPROBE } from '../../lib/ffmpeg-path.js';

/**
 * 1本分のクリップを連結・音声・字幕追加して final.mp4 を生成する
 *
 * @param {{
 *   jobId: string,
 *   assemblyDir: string,
 *   videoClips: object|null,
 *   compositedVideoPath: string|null,
 *   videoShotPlan: object,
 *   verbose: boolean
 * }} params
 * @returns {object} AssemblyOutputSchema 準拠の出力
 */
export async function runAssembly({ jobId, assemblyDir, videoClips, compositedVideoPath, videoShotPlan, verbose }) {
  mkdirSync(assemblyDir, { recursive: true });

  const { videoIndex, voiceScript, shots } = videoShotPlan;

  let concatPath;

  if (compositedVideoPath) {
    // テンプレートモード: コンポジット済み動画をそのまま使う（concat スキップ）
    concatPath = compositedVideoPath;
    if (verbose) {
      const durationSec = getDuration(concatPath);
      logger.info(`video-${videoIndex}: テンプレートモード ${durationSec.toFixed(2)}秒`);
    }
  } else {
    // 通常モード: クリップ連結
    // Step 1: concat リスト生成
    const listPath = join(assemblyDir, 'list.txt');
    const sortedClips = [...videoClips.clips].sort((a, b) => a.shotIndex - b.shotIndex);
    const listContent = sortedClips.map(c => `file '${c.videoPath}'`).join('\n');
    writeFileSync(listPath, listContent, 'utf8');

    // Step 2: クリップ連結
    concatPath = join(assemblyDir, 'concat-noaudio.mp4');
    run(`"${FFMPEG}" -y -f concat -safe 0 -i "${listPath}" -c copy "${concatPath}"`, verbose);

    // Step 3: 尺確認
    const durationSec = getDuration(concatPath);
    if (durationSec < 15 || durationSec > 30) {
      throw new Error(
        `video-${videoIndex}: 動画の尺が範囲外です: ${durationSec.toFixed(2)}秒（許容: 15〜30秒）\n` +
        `クリップ数: ${videoClips.clips.length}`
      );
    }
    if (verbose) {
      logger.info(`video-${videoIndex}: 連結後の尺 ${durationSec.toFixed(2)}秒`);
    }
  }

  // Step 4: 音声生成
  const narrationPath = join(assemblyDir, 'narration.mp3');
  const hasNarration = await generateNarration(voiceScript, narrationPath, verbose, videoIndex);

  // Step 5: 字幕フィルター構築（カット開始時刻を累積で計算）
  const drawtextFilter = buildDrawtextFilter(shots);

  // Step 6: 音声ミックス + 字幕
  const finalPath = join(assemblyDir, 'final.mp4');

  const videoQuality = `-c:v libx264 -preset medium -b:v 12M -maxrate 15M -bufsize 30M`;
  const audioQuality = `-c:a aac -b:a 192k -ar 44100 -ac 2`;

  if (hasNarration) {
    run(
      `"${FFMPEG}" -y -i "${concatPath}" -i "${narrationPath}" ` +
      `-filter_complex "[1]volume=1.0[v1];[v1]aresample=44100[aout]" ` +
      `-map 0:v -map "[aout]" ` +
      `-vf "${drawtextFilter}" ` +
      `${videoQuality} ${audioQuality} -shortest "${finalPath}"`,
      verbose
    );
  } else {
    run(
      `"${FFMPEG}" -y -i "${concatPath}" ` +
      `-vf "${drawtextFilter}" ` +
      `${videoQuality} "${finalPath}"`,
      verbose
    );
  }

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

  const outputJsonPath = join(assemblyDir, 'assembly-output.json');
  writeFileSync(outputJsonPath, JSON.stringify(output, null, 2), 'utf8');
  return output;
}

async function generateNarration(voiceScript, narrationPath, verbose, videoIndex) {
  if (config.TTS_PROVIDER === 'elevenlabs') {
    throw new Error('ElevenLabs は未実装です。TTS_PROVIDER を "say" にしてください。');
  }

  // say コマンド（macOS デフォルト）
  const checkSay = spawnSync('which', ['say'], { encoding: 'utf8' });
  if (checkSay.status !== 0) {
    logger.warn(`video-${videoIndex}: say コマンドが見つかりません。音声なしで続行します。`);
    return false;
  }

  const aiffPath = narrationPath.replace('.mp3', '.aiff');
  const sayResult = spawnSync('say', ['-v', 'Kyoko', '-o', aiffPath, voiceScript], {
    encoding: 'utf8',
    timeout: 30_000,
  });

  if (sayResult.status !== 0) {
    logger.warn(`video-${videoIndex}: 音声生成に失敗しました。音声なしで続行します。`);
    return false;
  }

  try {
    run(`"${FFMPEG}" -y -i "${aiffPath}" "${narrationPath}"`, verbose);
    return true;
  } catch (e) {
    logger.warn(`video-${videoIndex}: AIFF→MP3変換失敗: ${e.message}`);
    return false;
  }
}

function buildDrawtextFilter(shots) {
  const fontPath = findJapaneseFont();
  const fontOption = fontPath ? `fontfile='${fontPath}':` : '';

  let currentTime = 0;
  const filters = shots.map(shot => {
    const { overlayText, durationSec } = shot;
    const startSec = currentTime;
    const endSec = currentTime + durationSec;
    currentTime += durationSec;

    const text = (overlayText || '')
      .replace(/'/g, "\\'")
      .replace(/:/g, '\\:')
      .replace(/\\/g, '\\\\');

    return `drawtext=${fontOption}text='${text}':fontsize=72:fontcolor=white:` +
      `x=(w-text_w)/2:y=h*0.78:` +
      `shadowcolor=black:shadowx=4:shadowy=4:shadowx=4:` +
      `borderw=3:bordercolor=black@0.6:` +
      `enable='between(t,${startSec.toFixed(2)},${endSec.toFixed(2)})'`;
  });

  return filters.join(',');
}

function findJapaneseFont() {
  const candidates = [
    '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/Library/Fonts/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJKjp-Regular.otf',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
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

function run(cmd, verbose) {
  try {
    execSync(cmd, { stdio: verbose ? 'inherit' : 'pipe', timeout: 180_000 });
  } catch (e) {
    throw new Error(`ffmpeg コマンド失敗: ${e.message}`);
  }
}
