import { z } from 'zod';

export const ProductInfoSchema = z.object({
  jobId: z.string().uuid(),
  title: z.string().min(1),
  price: z.number().nonnegative(),
  features: z.array(z.string()).min(1).max(10),
  category: z.string().min(1),
  imagePath: z.string().min(1),
});

export type ProductInfo = z.infer<typeof ProductInfoSchema>;
