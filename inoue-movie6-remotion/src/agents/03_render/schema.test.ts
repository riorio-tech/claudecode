import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RenderInputSchema } from './schema.ts';

test('RenderInputSchema: 正常データをパースできる', () => {
  const result = RenderInputSchema.safeParse({
    jobId: '00000000-0000-0000-0000-000000000000',
    template: 'Standard',
    productInfo: {
      jobId: '00000000-0000-0000-0000-000000000000',
      title: 'テスト商品',
      price: 980,
      features: ['特徴1'],
      category: '日用品',
      imagePath: '/tmp/test.jpg',
    },
    shotPlan: {
      jobId: '00000000-0000-0000-0000-000000000000',
      totalDuration: 22,
      cuts: Array.from({ length: 20 }, (_, i) => ({
        index: i,
        duration: 1.1,
        visual: '商品',
        text: 'テキスト',
        animation: 'none',
      })),
    },
  });
  assert.ok(result.success);
});
