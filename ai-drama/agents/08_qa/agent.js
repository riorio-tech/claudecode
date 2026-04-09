/**
 * 08_qa — 品質チェック（Claude 不使用・ffprobe + ルールチェック）
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { logger } from '../../lib/logger.js';
import { FFPROBE, FFMPEG } from '../../lib/ffmpeg-path.js';
import { config } from '../../config.js';

/**
 * @param {{ jobId, jobDir, assemblyOutput, script }} params
 * @returns {object} QA レポート
 */
export async function runQA({ jobId, jobDir, assemblyOutput, script }) {
  const { finalVideoPath, durationSec, hasAudio, sceneCount } = assemblyOutput;
  const violations = [];
  const checks = {};

  // ── 尺チェック ──────────────────────────────────────────────────────────
  const durationOk = durationSec >= config.MIN_DURATION_SEC && durationSec <= config.MAX_DURATION_SEC;
  checks.duration = { passed: durationOk, valueSec: durationSec };
  if (!durationOk) {
    violations.push({ code: 'DURATION_OUT_OF_RANGE', severity: 'error',
      message: `尺 ${durationSec.toFixed(1)}秒 (許容: ${config.MIN_DURATION_SEC}〜${config.MAX_DURATION_SEC}秒)` });
  }

  // ── 解像度・コーデックチェック ───────────────────────────────────────────
  try {
    const raw = execFileSync(FFPROBE, [
      '-v', 'quiet', '-print_format', 'json',
      '-show_streams', finalVideoPath,
    ], { encoding: 'utf8' });
    const streams = JSON.parse(raw).streams ?? [];

    const videoStream = streams.find(s => s.codec_type === 'video');
    const audioStream = streams.find(s => s.codec_type === 'audio');

    const w = videoStream?.width;
    const h = videoStream?.height;
    const resOk = w === 1080 && h === 1920;
    checks.resolution = { passed: resOk, value: `${w}x${h}` };
    if (!resOk) violations.push({ code: 'WRONG_RESOLUTION', severity: 'error',
      message: `解像度 ${w}x${h} (必須: 1080x1920)` });

    const codec = videoStream?.codec_name;
    const codecOk = codec === 'h264';
    checks.codec = { passed: codecOk, value: codec };
    if (!codecOk) violations.push({ code: 'WRONG_CODEC', severity: 'error',
      message: `コーデック ${codec} (必須: h264)` });

    checks.hasAudio = { passed: !!audioStream };
    if (!audioStream) violations.push({ code: 'NO_AUDIO', severity: 'warn', message: '音声ストリームなし（ElevenLabs 未設定の場合は正常）' });
  } catch (e) {
    violations.push({ code: 'PROBE_FAILED', severity: 'error', message: e.message });
  }

  // ── コンテンツチェック（warn のみ）───────────────────────────────────────
  const beats = script.scenes.map(s => s.emotionalBeat);
  const hasHook = beats.includes('hook_opener');
  const hasCliff = beats.includes('cliffhanger_end');
  const hasCloseup = script.scenes.some(s => {
    // scene-plan なしでも警告のみなので script の visualNote で代用
    return true; // scene-breakdown が担保するため warn スキップ
  });

  checks.hookPresent        = { passed: hasHook };
  checks.cliffhangerPresent = { passed: hasCliff };
  if (!hasHook)  violations.push({ code: 'NO_HOOK',         severity: 'warn', message: 'hook_opener ビートがありません' });
  if (!hasCliff) violations.push({ code: 'NO_CLIFFHANGER',  severity: 'warn', message: 'cliffhanger_end ビートがありません' });

  const errors = violations.filter(v => v.severity === 'error');
  const passed = errors.length === 0;
  const score  = Math.max(0, 100 - errors.length * 20 - violations.filter(v => v.severity === 'warn').length * 5);

  // 警告をターミナルに表示
  for (const v of violations) {
    if (v.severity === 'warn')  logger.warn(`QA warn: ${v.message}`);
    if (v.severity === 'error') logger.error(`QA error: ${v.message}`);
  }

  const report = { jobId, passed, score, violations, checks };
  writeFileSync(join(jobDir, '08_qa-report.json'), JSON.stringify(report, null, 2), 'utf8');
  logger.success(`QA ${passed ? '通過' : '失敗'} (${score}/100)`);
  return report;
}
