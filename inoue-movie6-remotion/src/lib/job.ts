import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';

export function getJobDir(jobId: string): string {
  return `/tmp/inoue-job-${jobId}`;
}

export async function createJobDir(): Promise<string> {
  const jobId = uuidv4();
  const dir = getJobDir(jobId);
  mkdirSync(dir, { recursive: true });
  return jobId;
}

export function getJobPath(jobId: string, filename: string): string {
  return join(getJobDir(jobId), filename);
}
