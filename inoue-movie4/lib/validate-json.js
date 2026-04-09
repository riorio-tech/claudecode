import { z } from 'zod';

// ─── 共通ショットスキーマ（5〜8カット構成、plan.md準拠）────────────────────────

const ShotSchema = z.object({
  index: z.number().int().min(0).max(7),
  role: z.enum(['hook', 'benefit', 'proof', 'cta']),
  durationSec: z.number().min(2).max(8),
  scriptHint: z.string(),
  overlayText: z.string().max(20),
  motion: z.enum(['zoom-in', 'zoom-out', 'slide-left', 'slide-right', 'static', 'flash']),
  angleHint: z.enum(['wide', 'close', 'front', 'angle', 'scene']),
});

// ─── 1本分のショットプラン ──────────────────────────────────────────────────────

const VideoShotPlanSchema = z.object({
  videoIndex: z.number().int().min(0).max(9),
  hookVariant: z.string().min(1),          // HOOKの型の名前（例: "問題提起型"）
  voiceScript: z.string(),
  shots: z.array(ShotSchema).min(3).max(8),
});

// ─── 10本分のショットプラン（新メインスキーマ）────────────────────────────────

export const ShotPlanV2Schema = z.object({
  jobId: z.string().uuid(),
  productSummary: z.object({
    target: z.string(),
    pain: z.string(),
    solution: z.string(),
  }),
  videos: z.array(VideoShotPlanSchema).length(10),
});

// ─── 各エージェントの入出力スキーマ ────────────────────────────────────────────

export const AnalyzeOutputSchema = z.object({
  jobId: z.string().uuid(),
  normalizedProduct: z.object({
    productId: z.string().optional(),
    primaryImageUri: z.string(),
    title: z.string().min(1),
    price: z.number().optional(),
    currency: z.string().default('JPY'),
    category: z.string().default('daily'),
  }),
});

// 後方互換: 旧 IngestOutputSchema は AnalyzeOutputSchema と同じ
export const IngestOutputSchema = AnalyzeOutputSchema;

const VariantSchema = z.object({
  videoIndex: z.number().int().min(0).max(9),
  shotIndex: z.number().int().min(0).max(7),
  imagePath: z.string(),
  angleLabel: z.string(),
});

export const ImageVariantsSchema = z.object({
  jobId: z.string().uuid(),
  videoIndex: z.number().int().min(0).max(9),
  variants: z.array(VariantSchema).min(3).max(8),
});

const ClipSchema = z.object({
  videoIndex: z.number().int().min(0).max(9),
  shotIndex: z.number().int().min(0).max(7),
  videoPath: z.string(),
  durationSec: z.number(),
  motion: z.string(),
});

export const VideoClipsSchema = z.object({
  jobId: z.string().uuid(),
  videoIndex: z.number().int().min(0).max(9),
  clips: z.array(ClipSchema).min(3).max(8),
});

export const AssemblyOutputSchema = z.object({
  jobId: z.string().uuid(),
  videoIndex: z.number().int().min(0).max(9),
  finalVideoPath: z.string(),
  durationSec: z.number().min(15).max(30),  // 20〜25秒（余裕を持たせる）
  hasAudio: z.boolean(),
});

export const QAOutputSchema = z.object({
  jobId: z.string().uuid(),
  videoIndex: z.number().int().min(0).max(9).optional(),
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  violations: z.array(z.object({
    code: z.string(),
    severity: z.enum(['error', 'warn']),
    message: z.string(),
    target: z.string().optional(),
  })).default([]),
});

export const PublishPrepOutputSchema = z.object({
  jobId: z.string().uuid(),
  caption: z.string().max(150),
  hashtags: z.array(z.string()).min(5).max(8),
  thumbnailHint: z.string(),
  charCount: z.number(),
});

export const TemplateCompositeOutputSchema = z.object({
  jobId: z.string().uuid(),
  videoIndex: z.number().int().min(0).max(9),
  compositedVideoPath: z.string(),
  templateName: z.string(),
  durationSec: z.number().positive(),
  hasTemplateAudio: z.boolean(),
});

export const ProductScoutOutputSchema = z.object({
  candidates: z.array(z.object({
    title: z.string(),
    category: z.string(),
    price: z.number().optional(),
    scoutReason: z.string(),
    estimatedCvr: z.string().optional(),
  })).min(1).max(20),
});

/**
 * Zod スキーマで検証し、失敗時は ZodError をスロー
 * @template T
 * @param {z.ZodSchema<T>} schema
 * @param {unknown} data
 * @returns {T}
 */
export function validate(schema, data) {
  return schema.parse(data);
}
