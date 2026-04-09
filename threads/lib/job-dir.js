import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export function createJobDir() {
  const jobId = randomUUID();
  const dir = path.join(process.env.TMPDIR ?? '/tmp', `threads-job-${jobId}`);
  fs.mkdirSync(dir, { recursive: true });
  return { jobId, dir };
}

export function writeJson(dir, filename, data) {
  const file = path.join(dir, filename);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  return file;
}

export function readJson(dir, filename) {
  const file = path.join(dir, filename);
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}
