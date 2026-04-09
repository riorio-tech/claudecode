import { z } from 'zod';

export const CutSchema = z.object({
  index: z.number().int().min(0).max(19),
  duration: z.number().positive(),
  visual: z.string().min(1),
  text: z.string(),
  animation: z.enum(['none', 'zoom-in', 'fade']),
});

export const ShotPlanSchema = z.object({
  jobId: z.string().uuid(),
  totalDuration: z.number().positive(),
  cuts: z.array(CutSchema).length(20),
});

export type Cut = z.infer<typeof CutSchema>;
export type ShotPlan = z.infer<typeof ShotPlanSchema>;
