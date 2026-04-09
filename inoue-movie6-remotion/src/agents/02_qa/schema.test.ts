import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QAResultSchema } from './schema.ts';

test('QAResultSchema: passed=true のデータをパースできる', () => {
  const result = QAResultSchema.safeParse({
    jobId: '00000000-0000-0000-0000-000000000000',
    passed: true,
    errors: [],
    warnings: [],
    caption: '商品キャプション',
    hashtags: ['#TikTokShop', '#日用品'],
  });
  assert.ok(result.success);
});

test('QAResultSchema: error が1件以上あれば passed=false が正しい', () => {
  const result = QAResultSchema.safeParse({
    jobId: '00000000-0000-0000-0000-000000000000',
    passed: false,
    errors: [{ code: 'DURATION_TOO_SHORT', message: '動画が短すぎます' }],
    warnings: [],
    caption: '',
    hashtags: [],
  });
  assert.ok(result.success);
  assert.equal(result.data?.passed, false);
});
