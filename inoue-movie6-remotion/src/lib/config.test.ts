import { test } from 'node:test';
import assert from 'node:assert/strict';

test('config: 解像度が正しい', async () => {
  const { config } = await import('../../config.ts');
  assert.equal(config.VIDEO_WIDTH, 1080);
  assert.equal(config.VIDEO_HEIGHT, 1920);
  assert.equal(config.FPS, 30);
});

test('config: 動画尺の許容範囲が正しい', async () => {
  const { config } = await import('../../config.ts');
  assert.equal(config.MIN_DURATION, 15);
  assert.equal(config.MAX_DURATION, 30);
});
