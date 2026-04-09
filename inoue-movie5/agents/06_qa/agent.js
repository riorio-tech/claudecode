import { writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { validate, QAOutputSchema } from '../../lib/validate-json.js';
import { logger } from '../../lib/logger.js';

const ERROR_PATTERNS = [
  { code: 'ABSOLUTE_CURE', re: /絶対に治る|必ず効く|100%成功|確実に治|確実に効/, message: '断定的な効能訴求が含まれています。削除してください。' },
  { code: 'MEDICAL_CLAIM', re: /医師が認めた|臨床試験済み/, message: '根拠のない医学的主張が含まれています。' },
  { code: 'LOWEST_PRICE', re: /最安値|業界最安/, message: '根拠のない最安値表示が含まれています。' },
];

const WARN_PATTERNS = [
  { code: 'SUPERLATIVE', re: /最強|世界一|No\.?1/, message: 'No.1等の表現は根拠がある場合のみ使用できます。' },
  { code: 'COMPARISON', re: /より(?:も)?(?:優れ|良い|上)/, message: '競合比較表現が含まれています。競合名なしなら問題ありません。' },
  { code: 'URGENCY', re: /期間限定|残りわずか|在庫限り/, message: '限定性訴求は実際の状況と一致させてください。' },
];

/**
 * 1本の動画の QA・コンプライアンスチェック
 *
 * @param {{ jobId: string, jobDir: string, assemblyOutput: object, videoShotPlan: object, analyzeOutput: object, verbose: boolean }} params
 * @returns {object} QAOutputSchema 準拠の出力
 */
export async function runQA({ jobId, jobDir, assemblyOutput, videoShotPlan, analyzeOutput, verbose }) {
  const violations = [];
  const { videoIndex } = assemblyOutput;

  // A. 動画品質チェック
  const probeResult = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=width,height,codec_name',
    '-show_entries', 'format=duration',
    '-of', 'json',
    assemblyOutput.finalVideoPath,
  ], { encoding: 'utf8' });

  if (probeResult.status === 0) {
    const probe = JSON.parse(probeResult.stdout);
    const videoStream = probe.streams?.find(s => s.codec_name && s.width);
    const duration = parseFloat(probe.format?.duration);

    if (!isNaN(duration) && (duration < 15 || duration > 30)) {
      violations.push({
        code: 'DURATION_OUT_OF_RANGE',
        severity: 'error',
        message: `video-${videoIndex}: 尺が範囲外 ${duration.toFixed(2)}秒（許容: 15〜30秒）`,
        target: 'video.duration',
      });
    }

    if (videoStream) {
      const { width, height, codec_name } = videoStream;
      if (width !== 1080 || height !== 1920) {
        violations.push({
          code: 'RESOLUTION_MISMATCH',
          severity: 'error',
          message: `video-${videoIndex}: 解像度が不正 ${width}×${height}（期待: 1080×1920）`,
          target: 'video.resolution',
        });
      }
      if (codec_name !== 'h264') {
        violations.push({
          code: 'CODEC_MISMATCH',
          severity: 'warn',
          message: `video-${videoIndex}: コーデックが h264 ではありません: ${codec_name}`,
          target: 'video.codec',
        });
      }
    }
  } else {
    logger.warn(`video-${videoIndex}: ffprobe チェックをスキップ`);
  }

  // B. テキスト表現コンプライアンス
  const allText = [
    videoShotPlan.voiceScript,
    ...videoShotPlan.shots.map(s => s.overlayText),
    ...videoShotPlan.shots.map(s => s.scriptHint),
  ].join(' ');

  for (const { code, re, message } of ERROR_PATTERNS) {
    if (re.test(allText)) {
      violations.push({ code, severity: 'error', message, target: `text: "${allText.match(re)?.[0]}"` });
    }
  }
  for (const { code, re, message } of WARN_PATTERNS) {
    if (re.test(allText)) {
      violations.push({ code, severity: 'warn', message, target: `text: "${allText.match(re)?.[0]}"` });
    }
  }

  // C. 価格整合性
  const productPrice = analyzeOutput.normalizedProduct?.price;
  if (productPrice) {
    const overlayTexts = videoShotPlan.shots.map(s => s.overlayText).join(' ');
    const pricesInVideo = [...overlayTexts.matchAll(/(\d{1,5})円/g)].map(m => parseInt(m[1]));
    for (const p of pricesInVideo) {
      if (Math.abs(p - productPrice) > 1) {
        violations.push({
          code: 'PRICE_MISMATCH',
          severity: 'error',
          message: `video-${videoIndex}: 動画内価格 ${p}円 ≠ 商品価格 ${productPrice}円`,
          target: 'overlayText.price',
        });
      }
    }
  }

  const errorCount = violations.filter(v => v.severity === 'error').length;
  const warnCount = violations.filter(v => v.severity === 'warn').length;
  const score = Math.max(0, 100 - errorCount * 40 - warnCount * 15);
  const passed = errorCount === 0;

  if (verbose) {
    for (const v of violations) {
      if (v.severity === 'error') logger.error(`[QA ERROR] ${v.code}: ${v.message}`);
      else logger.warn(`[QA WARN] ${v.code}: ${v.message}`);
    }
  }

  if (passed) {
    logger.success(`video-${videoIndex}: QA 通過 (${score}/100, 警告 ${warnCount}件)`);
  } else {
    logger.error(`video-${videoIndex}: QA 失敗 (${score}/100, エラー ${errorCount}件)`);
  }

  const output = validate(QAOutputSchema, { jobId, videoIndex, passed, score, violations });

  // QA結果は jobDir 直下に動画ごとに保存
  const outputPath = join(jobDir, `06_qa-output-video${String(videoIndex).padStart(2, '0')}.json`);
  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  return output;
}
