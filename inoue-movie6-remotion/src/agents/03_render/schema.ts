import { z } from 'zod';
import { ProductInfoSchema } from '../00_ingest/schema.ts';
import { ShotPlanSchema } from '../01_plan/schema.ts';

export const RenderInputSchema = z.object({
  jobId: z.string().uuid(),
  template: z.enum(['Standard', 'Minimal']),
  productInfo: ProductInfoSchema,
  shotPlan: ShotPlanSchema,
});

export const RenderOutputSchema = z.object({
  jobId: z.string().uuid(),
  videoPath: z.string(),
  duration: z.number().positive(),
});

export type RenderInput = z.infer<typeof RenderInputSchema>;
export type RenderOutput = z.infer<typeof RenderOutputSchema>;
