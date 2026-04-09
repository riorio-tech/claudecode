import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProductInfoSchema } from './schema.ts';

test('ProductInfoSchema: 正常データをパースできる', () => {
  const result = ProductInfoSchema.safeParse({
    jobId: '00000000-0000-0000-0000-000000000000',
    title: 'テスト商品',
    price: 980,
    features: ['特徴1', '特徴2'],
    category: '日用品',
    imagePath: '/tmp/test.jpg',
  });
  assert.ok(result.success);
});

test('ProductInfoSchema: title が空の場合はエラー', () => {
  const result = ProductInfoSchema.safeParse({
    jobId: '00000000-0000-0000-0000-000000000000',
    title: '',
    price: 980,
    features: [],
    category: '日用品',
    imagePath: '/tmp/test.jpg',
  });
  assert.ok(!result.success);
});
