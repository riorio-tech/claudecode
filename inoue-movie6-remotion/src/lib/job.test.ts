import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createJobDir, getJobDir } from './job.ts';

test('job: createJobDir が /tmp/inoue-job-{id}/ を作成する', async () => {
  const jobId = await createJobDir();
  assert.match(jobId, /^[0-9a-f-]{36}$/);
  assert.ok(existsSync(getJobDir(jobId)));
});

test('job: getJobDir が正しいパスを返す', () => {
  const id = 'test-job-id';
  assert.equal(getJobDir(id), `/tmp/inoue-job-${id}`);
});
