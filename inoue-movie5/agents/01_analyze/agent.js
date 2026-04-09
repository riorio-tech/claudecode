import { writeFileSync } from 'fs';
import { join } from 'path';
import { validate, AnalyzeOutputSchema } from '../../lib/validate-json.js';
import { logger } from '../../lib/logger.js';

/**
 * 画像受理・jobId 発行エージェント（決定的処理）
 *
 * @param {{ jobId: string, jobDir: string, sourceImagePath: string, title: string, price: number|null, category: string }} params
 * @returns {object} 01_analyze-output.json の内容
 */
export async function runAnalyze({ jobId, jobDir, sourceImagePath, title, price, category }) {
  const output = {
    jobId,
    normalizedProduct: {
      productId: `SKU-${Date.now()}`,
      primaryImageUri: sourceImagePath,
      title,
      price: price ?? undefined,
      currency: 'JPY',
      category,
    },
  };

  const validated = validate(AnalyzeOutputSchema, output);
  const outputPath = join(jobDir, '01_analyze-output.json');
  writeFileSync(outputPath, JSON.stringify(validated, null, 2), 'utf8');

  logger.success(`01_analyze-output.json → ${outputPath}`);
  return validated;
}
