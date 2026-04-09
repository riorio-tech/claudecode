import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Creates a fresh job directory under $TMPDIR/ugc-job-{uuid}.
 * @returns {{ jobId: string, jobDir: string }}
 */
export function createJobDir() {
  const jobId = randomUUID();
  const jobDir = join(process.env.TMPDIR || '/tmp', `ugc-job-${jobId}`);
  mkdirSync(jobDir, { recursive: true });
  return { jobId, jobDir };
}

/**
 * Reads existing inpaint{N} dirs in outputBase and returns the next path.
 * Does NOT create the directory — caller must mkdirSync.
 * @param {string} outputBase  absolute path to the output/ directory
 * @returns {string}  e.g. /abs/path/output/inpaint3
 */
export function getNextOutputDir(outputBase) {
  let max = 0;
  if (existsSync(outputBase)) {
    for (const name of readdirSync(outputBase)) {
      const m = name.match(/^inpaint(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return join(outputBase, `inpaint${max + 1}`);
}
