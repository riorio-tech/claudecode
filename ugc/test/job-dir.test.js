import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createJobDir, getNextOutputDir } from '../lib/job-dir.js';

const TMP_BASE = join(process.env.TMPDIR || '/tmp', 'ugc-test-' + Date.now());

describe('createJobDir', () => {
  after(() => {
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('creates a directory and returns jobId and jobDir', () => {
    const { jobId, jobDir } = createJobDir();
    assert.match(jobId, /^[0-9a-f-]{36}$/);
    assert.ok(existsSync(jobDir), `jobDir should exist: ${jobDir}`);
    assert.ok(jobDir.includes(jobId), 'jobDir should contain jobId');
  });
});

describe('getNextOutputDir', () => {
  let testOutputBase;

  before(() => {
    testOutputBase = join(TMP_BASE, 'output');
    mkdirSync(testOutputBase, { recursive: true });
  });

  it('returns inpaint1 when output dir is empty', () => {
    const result = getNextOutputDir(testOutputBase);
    assert.equal(result, join(testOutputBase, 'inpaint1'));
  });

  it('returns inpaint3 when inpaint1 and inpaint2 already exist', () => {
    mkdirSync(join(testOutputBase, 'inpaint1'), { recursive: true });
    mkdirSync(join(testOutputBase, 'inpaint2'), { recursive: true });
    const result = getNextOutputDir(testOutputBase);
    assert.equal(result, join(testOutputBase, 'inpaint3'));
  });

  it('skips non-inpaint directories', () => {
    mkdirSync(join(testOutputBase, 'other'), { recursive: true });
    const result = getNextOutputDir(testOutputBase);
    assert.equal(result, join(testOutputBase, 'inpaint3'));
  });
});
