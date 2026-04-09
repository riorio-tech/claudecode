import { mkdirSync, existsSync, copyFileSync } from 'fs';
import { join, extname } from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * ジョブディレクトリを作成し jobId と jobDir を返す
 * @param {string} sourceImagePath - 元画像の絶対パス
 * @returns {{ jobId: string, jobDir: string, sourceImagePath: string }}
 */
export function createJobDir(sourceImagePath) {
  const jobId = uuidv4();
  const jobDir = `/tmp/inoue-job-${jobId}`;

  mkdirSync(jobDir, { recursive: true });

  // 元画像をジョブディレクトリにコピー
  const ext = extname(sourceImagePath).toLowerCase();
  const destImagePath = join(jobDir, `source${ext}`);
  copyFileSync(sourceImagePath, destImagePath);

  return { jobId, jobDir, sourceImagePath: destImagePath };
}
