/**
 * emotion-analyzer — 3信号による感情分析
 *
 * 1. analyzeText   : Claude Haiku でセリフ・ナレーションテキストを感情スコア化
 * 2. analyzeFrames : Claude Sonnet Vision で映像フレームの表情を分析
 * 3. analyzeAudio  : ffmpeg で音声エネルギーを5秒ごとに計測
 */

import { mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execFileSync, spawnSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import { FFMPEG } from './ffmpeg-path.js';
import { config } from '../config.js';
import { logger } from './logger.js';

const HAIKU_MODEL  = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = config.CLAUDE_MODEL;

// ── 1. テキスト分析 ──────────────────────────────────────────────────────────

/**
 * シーンのセリフ・ナレーションから感情スコアを抽出
 * @param {object} script - ScriptSchema
 * @returns {{ scenes: Array<{ sceneIndex, anger, empathy, frenzy, dominant, reasoning }> }}
 */
export async function analyzeText(script) {
  const client = new Anthropic();

  const sceneSummaries = script.scenes.map(s => {
    const lines = [
      `Scene ${s.sceneIndex} [${s.emotionalBeat}]`,
      s.description,
      ...(s.dialogue ?? []).map(d => `  ${d.speakerId}: "${d.text}"`),
      s.narration ? `  ナレーション: "${s.narration}"` : '',
    ].filter(Boolean).join('\n');
    return lines;
  }).join('\n\n');

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 2048,
    system: `あなたはドラマのセリフ・ナレーションから感情強度を分析する専門家です。
以下の3軸で各シーンを採点します（0〜10）:
- anger: 視聴者が怒りを感じるか（悪役の理不尽さ・不当な扱い）
- empathy: 視聴者が共感するか（主人公の弱さ・孤独・痛み）
- frenzy: 視聴者が熱狂するか（逆転・勝利・カタルシス）

JSON のみ出力。説明不要。`,
    messages: [{
      role: 'user',
      content: `以下の脚本シーンを分析してください:\n\n${sceneSummaries}\n\n出力形式:\n\`\`\`json\n{"scenes":[{"sceneIndex":0,"anger":7,"empathy":3,"frenzy":2,"dominant":"anger","reasoning":"〜のため"}]}\n\`\`\``,
    }],
  });

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (!match) throw new Error('analyzeText: JSON not found');
  return JSON.parse(match[1]);
}

// ── 2. フレーム表情分析 ──────────────────────────────────────────────────────

/** 動画からフレームを等間隔で抽出して base64 配列を返す */
function extractFramesForEmotion(videoPath, tmpDir, count = 6) {
  const frameDir = join(tmpDir, 'emotion_frames');
  mkdirSync(frameDir, { recursive: true });

  try {
    execFileSync(FFMPEG, [
      '-i', videoPath,
      '-vf', `select='not(mod(n,20))',scale=512:-1`,
      '-frames:v', String(count),
      '-vsync', 'vfr',
      '-y', join(frameDir, 'frame-%02d.jpg'),
    ], { stdio: 'pipe' });
  } catch {
    // フォールバック: 時間指定で抽出
    for (let i = 0; i < count; i++) {
      try {
        execFileSync(FFMPEG, [
          '-ss', String(i * 2),
          '-i', videoPath,
          '-frames:v', '1', '-s', '512x910', '-y',
          join(frameDir, `frame-${String(i + 1).padStart(2, '0')}.jpg`),
        ], { stdio: 'pipe' });
      } catch {}
    }
  }

  const frames = [];
  for (let i = 1; i <= count; i++) {
    const p = join(frameDir, `frame-${String(i).padStart(2, '0')}.jpg`);
    if (existsSync(p)) frames.push(readFileSync(p).toString('base64'));
  }
  return frames;
}

/**
 * Claude Vision で各フレームの表情・感情を分析
 * @param {string} videoPath
 * @param {string} tmpDir
 * @returns {{ frames: Array<{ frameIndex, anger, empathy, frenzy, expression, note }>, summary: { anger, empathy, frenzy } }}
 */
export async function analyzeFrames(videoPath, tmpDir) {
  const frames = extractFramesForEmotion(videoPath, tmpDir, 6);
  if (frames.length === 0) {
    logger.warn('analyzeFrames: フレーム取得失敗');
    return { frames: [], summary: { anger: 5, empathy: 5, frenzy: 5 } };
  }

  const client = new Anthropic();
  const content = [
    { type: 'text', text: `以下は動画から抽出した${frames.length}フレームです。各フレームの人物の表情・構図から感情強度を分析してください。` },
    ...frames.map((b64, i) => [
      { type: 'text', text: `\n--- フレーム${i + 1} ---` },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
    ]).flat(),
    { type: 'text', text: `
各フレームについて:
- anger (0-10): 表情・構図から視聴者が怒りを感じるか（人物が見下されている、悔しそう、など）
- empathy (0-10): 孤独・悲しみ・痛みが表情から伝わるか
- frenzy (0-10): 勝利感・逆転・喜びが表情から伝わるか
- expression: 表情の1行描写（日本語）

JSON のみ出力:
\`\`\`json
{
  "frames": [
    {"frameIndex":1,"anger":7,"empathy":3,"frenzy":2,"expression":"睨みつける表情、眉が下がり唇が固く結ばれている"}
  ],
  "summary": {"anger":6.5,"empathy":4.0,"frenzy":3.0}
}
\`\`\`` },
  ];

  const response = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content }],
  });

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (!match) throw new Error('analyzeFrames: JSON not found');
  return JSON.parse(match[1]);
}

// ── 3. 音声エネルギー分析 ──────────────────────────────────────────────────────

/**
 * ffmpeg で5秒ごとの音声エネルギーを計測
 * エネルギー高 → 怒り/熱狂、エネルギー低/無音 → 共感/沈黙
 * @param {string} audioPath
 * @param {number} totalSec
 * @returns {{ timePoints: number[], energy: number[], anger: number[], empathy: number[], frenzy: number[] }}
 */
export function analyzeAudio(audioPath, totalSec) {
  if (!audioPath || !existsSync(audioPath)) {
    logger.warn('analyzeAudio: 音声ファイルなし → スキップ');
    return null;
  }

  const INTERVAL = 5;
  const timePoints = [];
  const energy = [], anger = [], empathy = [], frenzy = [];

  for (let t = 0; t < totalSec; t += INTERVAL) {
    timePoints.push(t);

    // ffmpeg で該当セグメントの音量を計測
    let meanDb = -40; // デフォルト（無音相当）
    try {
      const result = spawnSync(FFMPEG, [
        '-ss', String(t),
        '-t',  String(INTERVAL),
        '-i',  audioPath,
        '-af', 'volumedetect',
        '-vn', '-f', 'null', '/dev/null',
      ], { encoding: 'utf8', stdio: 'pipe' });

      const stderr = result.stderr ?? '';
      const m = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
      if (m) meanDb = parseFloat(m[1]);
    } catch {}

    // dB → 0〜10 の強度スコアに変換（-50dB=0, -10dB=10）
    const intensity = Math.max(0, Math.min(10, (meanDb + 50) / 4));
    energy.push(parseFloat(intensity.toFixed(1)));

    // エネルギーレベルで3軸に振り分ける
    // 高エネルギー(7以上) → 怒り・熱狂、低エネルギー(3以下) → 共感・沈黙
    if (intensity >= 7) {
      anger.push(parseFloat((intensity * 0.9).toFixed(1)));
      frenzy.push(parseFloat((intensity * 0.8).toFixed(1)));
      empathy.push(parseFloat((10 - intensity * 0.5).toFixed(1)));
    } else if (intensity <= 3) {
      anger.push(parseFloat((intensity * 0.5).toFixed(1)));
      frenzy.push(parseFloat((intensity * 0.4).toFixed(1)));
      empathy.push(parseFloat(Math.min(10, (10 - intensity) * 0.9).toFixed(1)));
    } else {
      anger.push(parseFloat((intensity * 0.7).toFixed(1)));
      empathy.push(parseFloat((intensity * 0.6).toFixed(1)));
      frenzy.push(parseFloat((intensity * 0.6).toFixed(1)));
    }
  }

  return { timePoints, energy, anger, empathy, frenzy };
}
