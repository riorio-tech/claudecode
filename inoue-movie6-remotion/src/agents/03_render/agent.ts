import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../lib/logger.ts';
import { getJobDir, getJobPath } from '../../lib/job.ts';
import { insertShot } from '../../db/db.ts';
import { getTemplate } from '../../video/templates/index.ts';
import { makeClip, concatenateClips, getVideoDuration } from '../../video/renderer.ts';
import { config } from '../../../config.ts';
import type { RenderInput, RenderOutput } from './schema.ts';

export async function runRender(input: RenderInput): Promise<RenderOutput> {
  const { jobId, template: templateName, productInfo, shotPlan } = input;
  logger.info('render: 開始', { jobId, template: templateName, cuts: shotPlan.cuts.length });

  const template = getTemplate(templateName);
  const jobDir = getJobDir(jobId);
  const clipPaths: string[] = [];

  for (const cut of shotPlan.cuts) {
    const framePath = join(jobDir, `frame-${cut.index.toString().padStart(2, '0')}.png`);
    const clipPath = join(jobDir, `clip-${cut.index.toString().padStart(2, '0')}.mp4`);
    try {
      // 1. フレーム画像を生成
      const frameBuffer = await template.renderFrame(cut, productInfo);
      writeFileSync(framePath, frameBuffer);
      // 2. フレームからクリップを生成
      await makeClip(framePath, cut.duration, clipPath, cut.animation);
    } catch (e) {
      throw new Error(`render: カット ${cut.index} で失敗しました: ${String(e)}`);
    }
    clipPaths.push(clipPath);

    // DB記録
    insertShot(jobId, cut.index, templateName);

    logger.debug('render: カット完了', { jobId, index: cut.index });
  }

  // 3. 全クリップを連結
  const videoPath = getJobPath(jobId, 'output.mp4');
  await concatenateClips(clipPaths, videoPath);

  const duration = await getVideoDuration(videoPath);

  // エスカレーション: 尺チェック
  if (duration < config.MIN_DURATION || duration > config.MAX_DURATION) {
    throw new Error(
      `動画の尺が許容範囲外です: ${duration.toFixed(1)}秒（許容: ${config.MIN_DURATION}〜${config.MAX_DURATION}秒）`
    );
  }

  const output: RenderOutput = { jobId, videoPath, duration };
  writeFileSync(getJobPath(jobId, 'render-output.json'), JSON.stringify(output, null, 2));

  logger.info('render: 完了', { jobId, duration, videoPath });
  return output;
}
