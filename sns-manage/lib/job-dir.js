import { v4 as uuidv4 } from 'uuid';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const JOBS_BASE = 'jobs';

/**
 * 新規ジョブディレクトリを作成する。
 * @returns {{ jobId: string, jobDir: string }}
 */
export function createJobDir() {
  const jobId = uuidv4();
  const jobDir = join(JOBS_BASE, jobId);
  mkdirSync(jobDir, { recursive: true });
  return { jobId, jobDir };
}

/**
 * ジョブディレクトリのパスを返す（作成しない）。
 * @param {string} jobId
 * @returns {string}
 */
export function getJobDir(jobId) {
  return join(JOBS_BASE, jobId);
}

/**
 * JSONデータをジョブディレクトリのファイルに書き込む。
 * @param {string} jobId
 * @param {string} filename
 * @param {unknown} data
 */
export function writeJobFile(jobId, filename, data) {
  const dir = getJobDir(jobId);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, filename);
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * ジョブディレクトリのJSONファイルを読み込む。
 * @param {string} jobId
 * @param {string} filename
 * @returns {unknown}
 * @throws {Error} ファイルが存在しない場合
 */
export function readJobFile(jobId, filename) {
  const filePath = join(getJobDir(jobId), filename);
  if (!existsSync(filePath)) {
    throw new Error(`ジョブファイルが見つかりません: ${filePath}`);
  }
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}
