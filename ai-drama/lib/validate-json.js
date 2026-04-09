import { z } from 'zod';

// ── カタログ定数 ──────────────────────────────────────────────────────────────

export const EMOTIONAL_BEATS = [
  'hook_opener', 'tension_build', 'revelation', 'confrontation',
  'despair', 'declaration', 'departure', 'silent_stare',
  'insert_environment', 'shock_reaction', 'cliffhanger_end',
];

export const SHOT_TYPES = [
  'establishing', 'medium_two_shot', 'medium_single', 'ots_left', 'ots_right',
  'close_face', 'extreme_close_eyes', 'extreme_close_prop', 'low_angle_power',
  'high_angle_weak', 'dutch_angle', 'pov_subjective', 'insert_environment',
  'back_walkaway', 'silhouette',
];

export const MOTION_CODES = [
  'slow_push_in', 'snap_zoom_in', 'micro_handheld', 'dolly_in_slow',
  'slow_pull_back', 'track_follow', 'freeze', 'static_with_drift',
  'fast_zoom_in', 'dutch_drift', 'whip_pan_cut', 'orbit_slow',
];

// ── スキーマ定義 ──────────────────────────────────────────────────────────────

const ScriptSceneSchema = z.object({
  sceneIndex:        z.number().int().min(0),
  emotionalBeat:     z.enum(EMOTIONAL_BEATS),
  description:       z.string().min(1),
  targetDurationSec: z.number().min(2).max(20),
  dialogue:          z.array(z.object({ speakerId: z.string(), text: z.string() })).default([]),
  narration:         z.string().nullish().transform(v => v ?? undefined),
  visualNote:        z.string().min(1),
  subtitleLines:     z.array(z.string()).max(3).default([]),
});

export const ScriptSchema = z.object({
  jobId:                     z.string().uuid(),
  episode:                   z.number().int().min(1).default(1),
  total_episodes:            z.number().int().min(1).default(3),
  arc_template:              z.string(),
  voiceScript:               z.string().min(1),  // 動画全体のナレーション（1本）
  characters:                z.array(z.object({
    id: z.string(), name: z.string(), role: z.string(),
  })),
  scenes:                    z.array(ScriptSceneSchema).min(2).max(10),
  totalEstimatedDurationSec: z.number().min(5).max(95),
  hookLine:                  z.string().min(1),
  cliffhangerLine:           z.string().min(1),
});

const ScenePlanEntrySchema = z.object({
  sceneIndex:        z.number().int().min(0),
  emotionalBeat:     z.enum(EMOTIONAL_BEATS),
  shotType:          z.enum(SHOT_TYPES),
  motionCode:        z.enum(MOTION_CODES),
  lightingCode:      z.string(),
  imagePrompt:       z.string().min(20),
  negativePrompt:    z.string().default('blur, watermark, text, distorted, cartoon, anime'),
  targetDurationSec: z.number().min(2).max(20),
  colorPalette:      z.enum(['cold_blue', 'warm_amber', 'desaturated', 'high_contrast']),
});

export const ScenePlanSchema = z.object({
  jobId:  z.string().uuid(),
  scenes: z.array(ScenePlanEntrySchema).min(2).max(10),
});

export const ImageVariantsSchema = z.object({
  jobId:  z.string().uuid(),
  scenes: z.array(z.object({
    sceneIndex: z.number().int(),
    imagePath:  z.string(),
    motionCode: z.enum(MOTION_CODES),
    targetDurationSec: z.number(),
  })),
});

export const ClipsSchema = z.object({
  jobId:  z.string().uuid(),
  clips:  z.array(z.object({
    sceneIndex:  z.number().int(),
    clipPath:    z.string(),
    durationSec: z.number(),
    status:      z.enum(['ok', 'failed']).default('ok'),
  })),
});

export const VoicePlanSchema = z.object({
  jobId:      z.string().uuid(),
  audioPath:  z.string().nullable(),
  durationSec: z.number(),
  text:       z.string(),
});

export const AudioPlanSchema = z.object({
  jobId:         z.string().uuid(),
  bgmPath:       z.string().nullable(),
  bgmVolume:     z.number().default(0.25),
  bgmFadeInSec:  z.number().default(1.0),
  bgmFadeOutSec: z.number().default(2.0),
  totalEstimatedDurationSec: z.number(),
});

export const AssemblyOutputSchema = z.object({
  jobId:         z.string().uuid(),
  finalVideoPath: z.string(),
  durationSec:   z.number(),
  hasAudio:      z.boolean(),
  sceneCount:    z.number().int(),
});

// ── バリデーション関数 ────────────────────────────────────────────────────────

export function validate(schema, data) {
  return schema.parse(data);
}

/** Claude 出力テキストから最後の JSON ブロックを抽出 */
export function extractJson(text) {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/g)];
  if (blocks.length > 0) {
    return JSON.parse(blocks[blocks.length - 1][1]);
  }
  const i = text.lastIndexOf('{');
  if (i !== -1) {
    const sub = text.slice(i);
    const j = sub.lastIndexOf('}');
    if (j !== -1) return JSON.parse(sub.slice(0, j + 1));
  }
  throw new Error(`JSON が見つかりません (末尾500文字):\n${text.slice(-500)}`);
}
