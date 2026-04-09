/**
 * 05_voice-gen — ElevenLabs 音声生成（Claude 不使用・直接 API 呼び出し）
 */

import { writeFileSync, createWriteStream } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';

const EL_BASE = 'https://api.elevenlabs.io/v1';

/**
 * ElevenLabs TTS を呼び出して MP3 を保存
 * with-timestamps を試み、失敗したら通常 TTS にフォールバック
 */
async function generateVoice(text, voiceId, model, voiceSettings, outputPath) {
  if (!voiceId) {
    logger.warn('ELEVENLABS_VOICE_NARRATOR 未設定 → 音声生成スキップ');
    return { durationSec: 0, alignment: null };
  }

  // まず with-timestamps を試みる
  const url = `${EL_BASE}/text-to-speech/${voiceId}/with-timestamps`;
  const body = {
    text,
    model_id: model,
    voice_settings: voiceSettings,
  };

  let audioBase64 = null;
  let durationSec = 0;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': config.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json();
      audioBase64 = json.audio_base64;
      const times = json.alignment?.character_end_times_seconds ?? [];
      durationSec = times.length > 0 ? times[times.length - 1] : 0;
    } else {
      throw new Error(`${res.status}`);
    }
  } catch (e) {
    logger.warn(`with-timestamps 失敗 (${e.message}) → 通常 TTS にフォールバック`);
    // 通常 TTS
    const res2 = await fetch(`${EL_BASE}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': config.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res2.ok) throw new Error(`ElevenLabs TTS 失敗: ${res2.status} ${await res2.text()}`);
    const mp3Buf = Buffer.from(await res2.arrayBuffer());
    audioBase64 = mp3Buf.toString('base64');
    // 尺は文字数から推算（日本語: 約 5 文字/秒）
    durationSec = Math.max(2, text.length / 5);
  }

  // モデルフォールバック（eleven_v3 非対応時）
  if (audioBase64 === null) {
    throw new Error('ElevenLabs: 音声データが取得できませんでした');
  }

  writeFileSync(outputPath, Buffer.from(audioBase64, 'base64'));
  return { durationSec };
}

/**
 * @param {{ jobId, jobDir, script, verbose }} params
 * @returns {object} VoicePlanSchema
 */
export async function runVoiceGen({ jobId, jobDir, script, verbose = false }) {
  const voiceDir = join(jobDir, '05_voice');
  const outputPath = join(voiceDir, 'narration.mp3');

  const voiceId = config.ELEVENLABS_VOICE_NARRATOR;
  const text = script.voiceScript;

  // 感情アークから voice_settings を決める（全体ナレーションなので中程度）
  const voiceSettings = {
    stability: 0.4,
    similarity_boost: 0.8,
    style: 0.5,
    use_speaker_boost: true,
  };

  // eleven_v3 → eleven_multilingual_v2 フォールバック
  let model = config.ELEVENLABS_MODEL;
  logger.info(`音声生成中... (${model})`);

  let result;
  try {
    result = await generateVoice(text, voiceId, model, voiceSettings, outputPath);
  } catch (e) {
    if (model === 'eleven_v3') {
      logger.warn(`eleven_v3 失敗 → eleven_multilingual_v2 にフォールバック`);
      model = 'eleven_multilingual_v2';
      try {
        result = await generateVoice(text, voiceId, model, voiceSettings, outputPath);
      } catch (e2) {
        logger.warn(`ElevenLabs 失敗 (${e2.message}) → 音声なしで続行`);
        const fallback = { jobId, audioPath: null, durationSec: 0, text };
        writeFileSync(join(voiceDir, '05_voice-plan.json'), JSON.stringify(fallback, null, 2), 'utf8');
        return fallback;
      }
    } else {
      logger.warn(`ElevenLabs 失敗 (${e.message}) → 音声なしで続行`);
      const fallback = { jobId, audioPath: null, durationSec: 0, text };
      writeFileSync(join(voiceDir, '05_voice-plan.json'), JSON.stringify(fallback, null, 2), 'utf8');
      return fallback;
    }
  }

  const voicePlan = {
    jobId,
    audioPath: outputPath,
    durationSec: result.durationSec,
    text,
  };

  writeFileSync(join(voiceDir, '05_voice-plan.json'), JSON.stringify(voicePlan, null, 2), 'utf8');
  logger.success(`narration.mp3 (${result.durationSec.toFixed(1)}秒) 完了`);
  return voicePlan;
}
