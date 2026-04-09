import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { createJobDir } from './lib/job-dir.js';
import { logger } from './lib/logger.js';
import { runAnalyze } from './agents/01_analyze/agent.js';
import { runShotPlanner } from './agents/02_shot-planner/agent.js';
import { runImageGen } from './agents/03_image-gen/agent.js';
import { runVideoGen } from './agents/04_video-gen/agent.js';
import { runTemplateComposite } from './agents/03t_template-composite/agent.js';
import { runAssembly } from './agents/05_assembly/agent.js';
import { runQA } from './agents/06_qa/agent.js';
import { runPublishPrep } from './agents/07_publish-prep/agent.js';
import { insertJob, updateJobStatus, insertShot } from './db/db.js';
import { config } from './config.js';

/**
 * テンプレート名からテンプレート動画パスとゾーン設定を読み込む
 * @param {string} templateName - テンプレート名（拡張子なし）
 * @returns {{ templateVideoPath: string, zone: object }}
 */
function loadTemplate(templateName) {
  const templatesDir = resolve(new URL('.', import.meta.url).pathname, 'templates');
  const videoPath = join(templatesDir, `${templateName}.mp4`);
  const zonePath = join(templatesDir, `${templateName}.zone.json`);

  if (!existsSync(videoPath)) {
    throw new Error(`テンプレート動画が見つかりません: ${videoPath}`);
  }
  if (!existsSync(zonePath)) {
    throw new Error(
      `テンプレートのゾーン設定が見つかりません: ${zonePath}\n` +
      `zone.json を作成してください: { "x": 0, "y": 0, "w": 500, "h": 700, "notes": "" }`
    );
  }

  const zone = JSON.parse(readFileSync(zonePath, 'utf8'));
  return { templateVideoPath: videoPath, zone };
}

export async function runPipeline({ imagePath, title, price, category, templateName, count, outputDir, dryRun, skipQA, verbose }) {
  console.log(`\nTikTok Shop 動画生成パイプライン 開始`);
  console.log(`商品: ${title}${price ? ` (¥${price.toLocaleString()})` : ''} [${category}]`);
  if (templateName) console.log(`テンプレートモード: ${templateName}`);
  if (dryRun) console.log('（ドライランモード: shot-planner のみ実行）');

  // テンプレートモード時は事前にファイル存在確認
  let templateConfig = null;
  if (templateName) {
    templateConfig = loadTemplate(templateName);
  }

  // ─── Step 1: ジョブ作成・画像受理 ─────────────────────────────────────────
  logger.step(1, '01_analyze — 画像受理・ジョブ作成');
  const { jobId, jobDir, sourceImagePath } = createJobDir(imagePath);
  logger.info(`Job ID: ${jobId}`);
  logger.info(`Job Dir: ${jobDir}`);

  // ジョブをDBに記録
  insertJob({ jobId, title, price, category, imagePath: sourceImagePath, params: { dryRun, skipQA } });

  const analyzeOutput = await runAnalyze({ jobId, jobDir, sourceImagePath, title, price, category });

  // ─── Step 2: 10本分ショットプラン生成 ─────────────────────────────────────
  logger.step(2, '02_shot-planner — 10本分 HOOKバリエーション生成');
  const shotPlan = await runShotPlanner({ jobId, jobDir, analyzeOutput, verbose });

  if (dryRun) {
    logger.success('ドライラン完了');
    console.log(`\n02_shot-plan.json → ${join(jobDir, '02_shot-plan.json')}`);
    console.log('\n--- 商品サマリー ---');
    console.log(`ターゲット: ${shotPlan.productSummary.target}`);
    console.log(`悩み: ${shotPlan.productSummary.pain}`);
    console.log(`解決: ${shotPlan.productSummary.solution}`);
    console.log('\n--- 10本のHOOKバリエーション ---');
    for (const v of shotPlan.videos) {
      console.log(`[video-${v.videoIndex}] ${v.hookVariant}: ${v.shots[0]?.overlayText ?? ''}`);
    }
    updateJobStatus(jobId, 'completed');
    return;
  }

  // ─── 中間ディレクトリ準備 ─────────────────────────────────────────────────
  const imageGenDir = join(jobDir, '03_image-gen');
  const videoGenDir = join(jobDir, '04_video-gen');
  const templateBaseDir = join(jobDir, '03t_template');
  const assemblyBaseDir = join(jobDir, '05_assembly');
  if (!templateConfig) {
    mkdirSync(imageGenDir, { recursive: true });
    mkdirSync(videoGenDir, { recursive: true });
  } else {
    mkdirSync(templateBaseDir, { recursive: true });
  }
  mkdirSync(assemblyBaseDir, { recursive: true });

  // ─── Step 3〜5: 並列生成 ─────────────────────────────────────────────────
  const targetVideos = shotPlan.videos.slice(0, count ?? config.VIDEOS_PER_PRODUCT);
  const modeLabel = templateConfig ? 'template-composite → assembly' : 'image → video → assembly';
  logger.step(3, `03〜05 — ${targetVideos.length}本を並列生成 (${modeLabel})`);

  const videoResults = await Promise.allSettled(
    targetVideos.map(async (videoShotPlan) => {
      const { videoIndex } = videoShotPlan;
      const vStr = String(videoIndex).padStart(2, '0');

      // DBにショット構成を記録
      insertShot({
        jobId,
        videoIndex,
        hookVariant: videoShotPlan.hookVariant,
        structure: videoShotPlan.shots,
      });

      let videoClips = null;
      let compositedVideoPath = null;

      if (templateConfig) {
        // テンプレートモード: 03t_template-composite
        const templateOutput = await runTemplateComposite({
          jobId,
          videoIndex,
          templateVideoPath: templateConfig.templateVideoPath,
          sourceImagePath,
          zone: templateConfig.zone,
          outputDir: join(templateBaseDir, `video-${vStr}`),
          verbose,
        });
        compositedVideoPath = templateOutput.compositedVideoPath;
      } else {
        // 通常モード: 03_image-gen → 04_video-gen
        const imageVariants = await runImageGen({
          jobId,
          imageGenDir,
          sourceImagePath,
          videoShotPlan,
          verbose,
        });

        const clips = await runVideoGen({
          jobId,
          videoGenDir,
          imageVariants,
          videoShotPlan,
          verbose,
        });
        videoClips = clips;
      }

      // 05: 動画組み立て
      const assemblyDir = join(assemblyBaseDir, `video-${vStr}`);
      const assemblyOutput = await runAssembly({
        jobId,
        assemblyDir,
        videoClips,
        compositedVideoPath,
        videoShotPlan,
        verbose,
      });

      return { videoIndex, assemblyOutput, videoShotPlan };
    })
  );

  // 成功・失敗を分類
  const succeeded = videoResults
    .map((r, i) => ({ result: r, videoIndex: targetVideos[i]?.videoIndex }))
    .filter(({ result }) => result.status === 'fulfilled')
    .map(({ result }) => result.value);

  const failed = videoResults
    .map((r, i) => ({ result: r, videoIndex: targetVideos[i]?.videoIndex }))
    .filter(({ result }) => result.status === 'rejected')
    .map(({ result, videoIndex }) => ({ videoIndex, reason: result.reason?.message }));

  if (failed.length > 0) {
    for (const f of failed) {
      logger.warn(`video-${f.videoIndex} 生成失敗: ${f.reason}`);
    }
  }

  if (succeeded.length === 0) {
    updateJobStatus(jobId, 'failed');
    throw new Error('全動画の生成に失敗しました');
  }

  logger.info(`${succeeded.length}/${targetVideos.length} 本の動画生成完了`);

  // ─── Step 6: QA（並列）─────────────────────────────────────────────────────
  logger.step(6, '06_qa — QA・コンプライアンスチェック（並列）');

  let qaResults;
  if (!skipQA) {
    qaResults = await Promise.allSettled(
      succeeded.map(({ videoIndex, assemblyOutput, videoShotPlan }) =>
        runQA({ jobId, jobDir, assemblyOutput, videoShotPlan, analyzeOutput, verbose })
      )
    );
  } else {
    logger.warn('--skip-qa が指定されているため QA をスキップします');
    qaResults = succeeded.map(() => ({
      status: 'fulfilled',
      value: { passed: true, score: 100, violations: [] },
    }));
  }

  const passedVideos = succeeded.filter((_, i) => qaResults[i]?.value?.passed !== false);

  if (passedVideos.length === 0) {
    updateJobStatus(jobId, 'failed');
    throw new Error('全動画が QA に失敗しました。shot-plan の修正が必要です。');
  }

  logger.info(`QA 通過: ${passedVideos.length}/${succeeded.length} 本`);

  // ─── Step 7: 投稿準備 ─────────────────────────────────────────────────────
  logger.step(7, '07_publish-prep — キャプション・ハッシュタグ生成');
  let publishPrep;
  try {
    publishPrep = await runPublishPrep({ jobId, jobDir, analyzeOutput, shotPlan, verbose });
  } catch (e) {
    logger.warn(`publish-prep エラー（続行）: ${e.message}`);
    publishPrep = {
      caption: '（生成失敗）',
      hashtags: ['#TikTokShop'],
      thumbnailHint: 'HOOKカット推奨',
      charCount: 0,
    };
  }

  // ─── Step 8: 最終動画を出力先にコピー ────────────────────────────────────
  const destDir = outputDir ?? '.';
  mkdirSync(destDir, { recursive: true });

  const copiedPaths = [];
  for (const { videoIndex, assemblyOutput } of passedVideos) {
    const destPath = join(destDir, `output-${jobId}-${String(videoIndex).padStart(2, '0')}.mp4`);
    copyFileSync(assemblyOutput.finalVideoPath, destPath);
    copiedPaths.push(destPath);
  }

  // ─── サマリー表示 ─────────────────────────────────────────────────────────
  updateJobStatus(jobId, 'completed');

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`✅ 完了 — Job: ${jobId}`);
  console.log(`   生成本数: ${passedVideos.length} 本 / ${targetVideos.length} 本`);
  console.log(`   出力先: ${destDir}/`);
  for (const p of copiedPaths) {
    console.log(`     ${p}`);
  }
  console.log(`\n   キャプション: ${publishPrep.caption}`);
  console.log(`   ハッシュタグ: ${publishPrep.hashtags.join(' ')}`);
  console.log(`${'─'.repeat(60)}\n`);
}
