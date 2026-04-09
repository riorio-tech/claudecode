import { mkdirSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { tmpdir } from 'os';

/**
 * ジョブ作業ディレクトリを作成する
 * @returns {{ jobId: string, jobDir: string }}
 */
export function createJobDir() {
  const jobId = uuidv4();
  const jobDir = join(tmpdir(), `drama-job-${jobId}`);

  mkdirSync(join(jobDir, '03_image-gen'), { recursive: true });
  mkdirSync(join(jobDir, '04_video-gen'), { recursive: true });
  mkdirSync(join(jobDir, '05_voice'),     { recursive: true });
  mkdirSync(join(jobDir, '06_sfx-music'), { recursive: true });
  mkdirSync(join(jobDir, '07_assembly'),  { recursive: true });
  mkdirSync(join(jobDir, '09_eval'),      { recursive: true });
  mkdirSync(join(jobDir, '10_improve'),         { recursive: true });
  mkdirSync(join(jobDir, '11_emotion-diagnose'), { recursive: true });

  return { jobId, jobDir };
}
