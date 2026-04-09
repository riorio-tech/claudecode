import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShotPlanSchema } from './schema.ts';

test('ShotPlanSchema: 正常データをパースできる', () => {
  const result = ShotPlanSchema.safeParse({
    jobId: '00000000-0000-0000-0000-000000000000',
    totalDuration: 22,
    cuts: Array.from({ length: 20 }, (_, i) => ({
      index: i,
      duration: 1.1,
      visual: '商品全体',
      text: 'テキスト',
      animation: 'none',
    })),
  });
  assert.ok(result.success);
});

test('ShotPlanSchema: cuts が 20 個でない場合はエラー', () => {
  const result = ShotPlanSchema.safeParse({
    jobId: '00000000-0000-0000-0000-000000000000',
    totalDuration: 5,
    cuts: [{ index: 0, duration: 5, visual: '商品', text: 'テキスト', animation: 'none' }],
  });
  assert.ok(!result.success);
});
