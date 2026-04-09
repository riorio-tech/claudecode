import { writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { validate, QAOutputSchema } from '../../lib/validate-json.js';
import { logger } from '../../lib/logger.js';
import { FFPROBE } from '../../lib/ffmpeg-path.js';

/**
 * 1本の動画の QA チェック（ffprobe による技術仕様のみ）
 *
 * チェック項目:
 *   - 尺: 15〜30 秒（ERROR）
 *   - 解像度: 1080×1920（ERROR）
 *   - コーデック: H.264（WARN）
 *
 * @param {{ jobId: string, jobDir: string, assemblyOutput: object, verbose: boolean }} params
 * @returns {object} QAOutputSchema 準拠の出力
 */
export async function runQA({ jobId, jobDir, assemblyOutput, verbose }) {
  const violations = [];
  const { videoIndex } = assemblyOutput;

  const probeResult = spawnSync(FFPROBE, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,codec_name',
    '-show_entries', 'format=duration',
    '-of', 'json',
    assemblyOutput.finalVideoPath,
  ], { encoding: 'utf8' });

  if (probeResult.status === 0) {
    const probe = JSON.parse(probeResult.stdout);
    const vs = probe.streams?.[0];
    const duration = parseFloat(probe.format?.duration);

    if (!isNaN(duration) && (duration < 15 || duration > 30)) {
      violations.push({
        code: 'DURATION_OUT_OF_RANGE',
        severity: 'error',
        message: `video-${videoIndex}: 尺が範囲外 ${duration.toFixed(2)}秒（許容: 15〜30秒）`,
        target: 'video.duration',
      });
    }

    if (vs) {
      if (vs.width !== 1080 || vs.height !== 1920) {
        violations.push({
          code: 'RESOLUTION_MISMATCH',
          severity: 'error',
          message: `video-${videoIndex}: 解像度が不正 ${vs.width}×${vs.height}（期待: 1080×1920）`,
          target: 'video.resolution',
        });
      }
      if (vs.codec_name !== 'h264') {
        violations.push({
          code: 'CODEC_MISMATCH',
          severity: 'warn',
          message: `video-${videoIndex}: コーデックが h264 ではありません: ${vs.codec_name}`,
          target: 'video.codec',
        });
      }
    }
  } else {
    logger.warn(`video-${videoIndex}: ffprobe が実行できませんでした（スキップ）`);
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
    logger.success(`video-${videoIndex}: QA 通過 (score ${score}/100)`);
  } else {
    logger.error(`video-${videoIndex}: QA 失敗 (score ${score}/100, エラー ${errorCount}件)`);
  }

  const output = validate(QAOutputSchema, { jobId, videoIndex, passed, score, violations });
  const outputPath = join(jobDir, `06_qa-output-video${String(videoIndex).padStart(2, '0')}.json`);
  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  return output;
}
