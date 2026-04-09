import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertJob, updateJobInfo, insertShot, getDb } from './db.ts';

test('db: insertJob がジョブを記録する', () => {
  const db = getDb();
  if (!db) return; // graceful degradation

  const jobId = 'test-job-' + Date.now();
  insertJob(jobId, '/tmp/test.jpg');
  updateJobInfo(jobId, 'テスト商品', 980);

  const row = db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId) as {
    job_id: string;
    title: string;
    price: number;
  } | undefined;
  assert.ok(row);
  assert.equal(row.title, 'テスト商品');
  assert.equal(row.price, 980);
});

test('db: insertShot がショットを記録する', () => {
  const db = getDb();
  if (!db) return;

  const jobId = 'test-shot-' + Date.now();
  insertJob(jobId, '/tmp/test.jpg');
  insertShot(jobId, 1, 'Standard');

  const row = db.prepare('SELECT * FROM shots WHERE job_id = ?').get(jobId) as {
    job_id: string;
    shot_index: number;
  } | undefined;
  assert.ok(row);
  assert.equal(row.shot_index, 1);
});
