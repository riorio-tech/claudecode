import { z } from 'zod';

export const ViolationSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const QAResultSchema = z.object({
  jobId: z.string().uuid(),
  passed: z.boolean(),
  errors: z.array(ViolationSchema),
  warnings: z.array(ViolationSchema),
  caption: z.string(),
  hashtags: z.array(z.string()),
});

export type QAResult = z.infer<typeof QAResultSchema>;
export type Violation = z.infer<typeof ViolationSchema>;
