import { mkdirSync, copyFileSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { createJobDir } from './lib/job-dir.js';
import { logger } from './lib/logger.js';
import { runScriptWriter }   from './agents/01_script-writer/agent.js';
import { runSceneBreakdown } from './agents/02_scene-breakdown/agent.js';
import { runImageGen }       from './agents/03_image-gen/agent.js';
import { runVideoGen }       from './agents/04_video-gen/agent.js';
import { runVoiceGen }       from './agents/05_voice-gen/agent.js';
import { runSfxMusic }       from './agents/06_sfx-music/agent.js';
import { runAssembly }       from './agents/07_assembly/agent.js';
import { runQA }             from './agents/08_qa/agent.js';
import { runEval }           from './agents/09_eval/agent.js';
import { runImprove }          from './agents/10_improve/agent.js';
import { runEmotionDiagnose }  from './agents/11_emotion-diagnose/agent.js';
import { insertJob, updateJobStatus, insertEvalResult, markEvalAsBest, insertConceptHistory, upsertEmotionPattern } from './db/db.js';
import { buildEmotionWave, renderWaveChart, appendEmotionRecord } from './lib/emotion-wave.js';
import { analyzeText, analyzeFrames, analyzeAudio } from './lib/emotion-analyzer.js';
import { config } from './config.js';

/** 脚本情報を人間が読みやすい Markdown に変換 */
function buildScriptMarkdown(concept, script, scenePlan, episode) {
  const totalSec = script.totalEstimatedDurationSec;
  const sceneMap = Object.fromEntries((scenePlan?.scenes ?? []).map(s => [s.sceneIndex, s]));

  const sceneRows = script.scenes.map(s => {
    const plan = sceneMap[s.sceneIndex] ?? {};
    const dialogue = s.dialogue?.map(d => `  > **${d.speakerId}**: ${d.text}`).join('\n') ?? '';
    const narration = s.narration ? `  *ナレーション: ${s.narration}*` : '';
    const subtitle = s.subtitleLines?.length ? `  字幕: 「${s.subtitleLines.join(' / ')}」` : '';
    return [
      `### Scene ${s.sceneIndex + 1} — ${s.emotionalBeat}`,
      `**ショット**: ${plan.shotType ?? '-'}  **モーション**: ${plan.motionCode ?? '-'}  **照明**: ${plan.lightingCode ?? '-'}`,
      `${s.description}`,
      dialogue,
      narration,
      subtitle,
      s.visualNote ? `*映像メモ: ${s.visualNote}*` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n---\n\n');

  return `# 第${episode}話

## コンセプト
${concept}

## 基本情報
- アーク: ${script.arc_template}
- 想定尺: ${totalSec}秒
- シーン数: ${script.scenes.length}

## フック
> ${script.hookLine}

## クリフハンガー
> ${script.cliffhangerLine}

## ナレーション全文
${script.voiceScript}

---

## 登場人物
${script.characters.map(c => `- **${c.name}** (${c.id}) — ${c.role}`).join('\n')}

---

## シーン詳細

${sceneRows}
`;
}

/**
 * @param {{ concept, genre, episode, totalEpisodes, outputDir, referencePath, targetScore, maxIterations, dryRun, skipQA, verbose }} opts
 */
export async function runPipeline({ concept, genre, episode = 1, totalEpisodes = 3, outputDir = './output', referencePath = null, targetScore = 75, maxIterations = 3, dryRun = false, skipQA = false, verbose = false }) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`ai-drama パイプライン 開始`);
  console.log(`コンセプト: ${concept}`);
  console.log(`シーン数  : ${config.SCENES_PER_EPISODE} (SCENES_PER_EPISODE)`);
  if (dryRun) console.log('（ドライランモード: 脚本+映像設計のみ）');
  console.log(`${'─'.repeat(50)}`);

  const { jobId, jobDir } = createJobDir();
  logger.info(`Job ID: ${jobId}`);
  logger.info(`Job Dir: ${jobDir}`);

  await insertJob({ jobId, concept, genre, arcTemplate: 'auto' });

  // ── Step 1: 脚本生成（Claude Sonnet） ─────────────────────────────────────
  logger.step(1, '01_script-writer — 脚本生成');
  const script = await runScriptWriter({ jobId, jobDir, concept, genre, episode, totalEpisodes, verbose });

  // ── Step 2: 映像設計（Claude Sonnet） ─────────────────────────────────────
  logger.step(2, '02_scene-breakdown — 映像演出設計');
  const scenePlan = await runSceneBreakdown({ jobId, jobDir, script, verbose });

  if (dryRun) {
    logger.success('ドライラン完了（脚本 + 映像設計のみ）');
    console.log(`\n01_script.json    → ${join(jobDir, '01_script.json')}`);
    console.log(`02_scene-plan.json → ${join(jobDir, '02_scene-plan.json')}`);
    await updateJobStatus(jobId, 'completed');
    return { jobId };
  }

  // ── Step 3〜5: 映像ブランチ・音声ブランチ 並列 ─────────────────────────────
  logger.step(3, '03〜05 — 画像生成 / 動画生成 / 音声生成（並列）');

  const [imageVariants, voicePlan] = await Promise.all([
    // 映像ブランチ: 画像 → 動画
    (async () => {
      const imgs = await runImageGen({ jobId, jobDir, scenePlan, verbose });
      const vids = await runVideoGen({ jobId, jobDir, imageVariants: imgs, verbose });
      return { imgs, vids };
    })(),
    // 音声ブランチ: ElevenLabs
    runVoiceGen({ jobId, jobDir, script, verbose }),
  ]);

  const { imgs, vids } = imageVariants;

  // ── Step 4: BGM 選択 ───────────────────────────────────────────────────────
  logger.step(4, '06_sfx-music — BGM 選択');
  const audioPlan = await runSfxMusic({ jobId, jobDir, script, clips: vids });

  // ── Step 5: FFmpeg 合成 ────────────────────────────────────────────────────
  logger.step(5, '07_assembly — FFmpeg 最終合成');
  const assemblyOutput = await runAssembly({ jobId, jobDir, clips: vids, voicePlan, audioPlan, scenePlan, script, verbose });

  // ── Step 6: QA ────────────────────────────────────────────────────────────
  let qaReport = { passed: true, score: 100 };
  if (!skipQA) {
    logger.step(6, '08_qa — 品質チェック');
    qaReport = await runQA({ jobId, jobDir, assemblyOutput, script });
    if (!qaReport.passed) {
      await updateJobStatus(jobId, 'failed');
      const errors = qaReport.violations.filter(v => v.severity === 'error').map(v => v.message).join(', ');
      throw new Error(`QA 失敗: ${errors}`);
    }
  }

  // ── Step 7: eval 評価（初回）─────────────────────────────────────────────
  const evalLogPath = join(outputDir, 'eval_log.md');
  let realSignals = {};  // 3信号分析結果（スコープ共有）
  let evalReport = null;
  logger.step(7, '09_eval — 品質評価（初回）');
  try {
    evalReport = await runEval({
      jobId, jobDir,
      finalVideoPath: assemblyOutput.finalVideoPath,
      script, referencePath, evalLogPath,
    });
    if (evalReport) await insertEvalResult({ jobId, iteration: 0, evalReport });
  } catch (e) {
    logger.warn(`eval 失敗（スキップ）: ${e.message}`);
  }

  // ── フィードバックループ ─────────────────────────────────────────────────
  let bestEvalReport     = evalReport;
  let bestAssemblyOutput = assemblyOutput;
  let bestScenePlan      = scenePlan;
  let bestScript         = script;
  let bestIteration      = 0;
  let bestVoicePlan      = voicePlan;
  let bestAudioPlan      = audioPlan;

  if (evalReport && evalReport.totalScore < targetScore && maxIterations > 1) {
    const CYAN = '\x1b[36m', RESET = '\x1b[0m';

    // ── Step A: 3信号で感情診断 ───────────────────────────────────────────
    logger.step('A', '11_emotion-diagnose — 3信号統合診断');
    let diagnosis = null;
    let realSignals = {};
    try {
      const emotionTmpDir = join(jobDir, '11_emotion-diagnose');
      const [textAnalysis, frameAnalysis] = await Promise.all([
        analyzeText(script).catch(e => { logger.warn(`テキスト分析失敗: ${e.message}`); return null; }),
        analyzeFrames(assemblyOutput.finalVideoPath, emotionTmpDir).catch(e => { logger.warn(`フレーム分析失敗: ${e.message}`); return null; }),
      ]);
      const audioAnalysis = analyzeAudio(voicePlan?.audioPath, assemblyOutput.durationSec);
      realSignals = { textAnalysis, frameAnalysis, audioAnalysis };

      diagnosis = await runEmotionDiagnose({
        jobId, jobDir,
        textAnalysis, frameAnalysis, audioAnalysis,
        evalReport, script,
      });
    } catch (e) {
      logger.warn(`感情診断失敗 (${e.message}) → visual のみで改善`);
      diagnosis = { layer: 'visual', scriptFeedback: null, visualFeedback: null };
    }

    // ── Step B: 脚本が弱い場合 → 01から全工程再実行（1回のみ）──────────────
    if ((diagnosis.layer === 'script' || diagnosis.layer === 'both') && diagnosis.scriptFeedback) {
      console.log(`\n${CYAN}━━ 脚本改善ループ — 01_script から再実行${RESET}`);
      try {
        const scriptJobDir = join(jobDir, '10_improve', 'script-iter');
        mkdirSync(join(scriptJobDir, '03_image-gen'), { recursive: true });
        mkdirSync(join(scriptJobDir, '04_video-gen'), { recursive: true });
        mkdirSync(join(scriptJobDir, '05_voice'),     { recursive: true });
        mkdirSync(join(scriptJobDir, '06_sfx-music'), { recursive: true });
        mkdirSync(join(scriptJobDir, '07_assembly'),  { recursive: true });
        mkdirSync(join(scriptJobDir, '09_eval'),      { recursive: true });

        logger.step('B-1', '01_script-writer — フィードバックを反映した脚本再生成');
        const improvedScript = await runScriptWriter({
          jobId, jobDir: scriptJobDir, concept, genre, episode, totalEpisodes,
          scriptFeedback: diagnosis.scriptFeedback, verbose,
        });

        logger.step('B-2', '02_scene-breakdown — 映像設計再生成');
        const improvedScenePlan2 = await runSceneBreakdown({ jobId, jobDir: scriptJobDir, script: improvedScript, verbose });

        logger.step('B-3', '03〜05 — 画像/動画/音声 並列生成');
        const [imgVar2, voice2] = await Promise.all([
          (async () => {
            const imgs2 = await runImageGen({ jobId, jobDir: scriptJobDir, scenePlan: improvedScenePlan2, verbose });
            const vids2 = await runVideoGen({ jobId, jobDir: scriptJobDir, imageVariants: imgs2, verbose });
            return { imgs: imgs2, vids: vids2 };
          })(),
          runVoiceGen({ jobId, jobDir: scriptJobDir, script: improvedScript, verbose }),
        ]);
        const audio2 = await runSfxMusic({ jobId, jobDir: scriptJobDir, script: improvedScript, clips: imgVar2.vids });
        const assembly2 = await runAssembly({ jobId, jobDir: scriptJobDir, clips: imgVar2.vids, voicePlan: voice2, audioPlan: audio2, scenePlan: improvedScenePlan2, script: improvedScript, verbose });

        logger.step('B-4', '09_eval — 脚本改善後の再評価');
        const eval2 = await runEval({ jobId, jobDir: scriptJobDir, finalVideoPath: assembly2.finalVideoPath, script: improvedScript, referencePath, evalLogPath });
        if (eval2) await insertEvalResult({ jobId, iteration: 'script-1', evalReport: eval2 });

        if ((eval2?.totalScore ?? 0) > (bestEvalReport?.totalScore ?? 0)) {
          logger.success(`脚本改善: ${bestEvalReport?.totalScore} → ${eval2.totalScore} ✓ 採用`);
          bestScript         = improvedScript;
          bestScenePlan      = improvedScenePlan2;
          bestEvalReport     = eval2;
          bestAssemblyOutput = assembly2;
          bestVoicePlan      = voice2;
          bestAudioPlan      = audio2;
          bestIteration      = 'script-1';
          // 実信号も更新
          const [ta2, fa2] = await Promise.all([
            analyzeText(improvedScript).catch(() => null),
            analyzeFrames(assembly2.finalVideoPath, join(scriptJobDir, '11_emotion-diagnose')).catch(() => null),
          ]);
          realSignals = { textAnalysis: ta2, frameAnalysis: fa2, audioAnalysis: analyzeAudio(voice2?.audioPath, assembly2.durationSec) };
        } else {
          logger.warn(`脚本改善: スコア改善なし (${eval2?.totalScore ?? 0} <= ${bestEvalReport?.totalScore ?? 0})`);
        }
      } catch (e) {
        logger.warn(`脚本改善失敗 (${e.message}) → 映像改善のみ継続`);
      }
    }

    // ── Step C: 映像改善ループ（残りイテレーション）──────────────────────────
    const visualIters = diagnosis.layer === 'script' ? maxIterations - 2 : maxIterations - 1;
    for (let iter = 1; iter <= Math.max(1, visualIters); iter++) {
      if ((bestEvalReport?.totalScore ?? 0) >= targetScore) {
        logger.success(`目標スコア ${targetScore} 達成 → ループ終了`);
        break;
      }
      console.log(`\n${CYAN}━━ 映像改善ループ iter-${iter}  現スコア: ${bestEvalReport?.totalScore ?? '-'}/100 → 目標: ${targetScore}${RESET}`);

      let improvedScenePlan;
      try {
        improvedScenePlan = await runImprove({
          jobId, jobDir,
          scenePlan: bestScenePlan,
          evalReport: bestEvalReport,
          script: bestScript, iteration: iter, verbose,
        });
      } catch (e) {
        logger.warn(`improve 失敗 (${e.message}) → ループ終了`);
        break;
      }

      const iterJobDir = join(jobDir, '10_improve', `iter-${iter}`);
      mkdirSync(join(iterJobDir, '03_image-gen'), { recursive: true });
      mkdirSync(join(iterJobDir, '04_video-gen'), { recursive: true });
      mkdirSync(join(iterJobDir, '07_assembly'),  { recursive: true });
      mkdirSync(join(iterJobDir, '09_eval'),      { recursive: true });

      let iterAssembly, iterEval;
      try {
        const iterImgs = await runImageGen({ jobId, jobDir: iterJobDir, scenePlan: improvedScenePlan, verbose });
        const iterVids = await runVideoGen({ jobId, jobDir: iterJobDir, imageVariants: iterImgs, verbose });
        iterAssembly   = await runAssembly({ jobId, jobDir: iterJobDir, clips: iterVids, voicePlan: bestVoicePlan, audioPlan: bestAudioPlan, scenePlan: improvedScenePlan, script: bestScript, verbose });
      } catch (e) {
        logger.warn(`iter-${iter} 生成失敗 (${e.message}) → 次のイテレーションへ`);
        continue;
      }

      try {
        iterEval = await runEval({ jobId, jobDir: iterJobDir, finalVideoPath: iterAssembly.finalVideoPath, script: bestScript, referencePath, evalLogPath });
        if (iterEval) await insertEvalResult({ jobId, iteration: iter, evalReport: iterEval });
      } catch (e) {
        logger.warn(`iter-${iter} eval 失敗 (${e.message})`);
      }

      const prevScore = bestEvalReport?.totalScore ?? 0;
      const newScore  = iterEval?.totalScore ?? 0;
      if (newScore > prevScore) {
        logger.success(`iter-${iter}: ${prevScore} → ${newScore} ✓ 採用`);
        bestEvalReport     = iterEval;
        bestAssemblyOutput = iterAssembly;
        bestScenePlan      = improvedScenePlan;
        bestIteration      = iter;
      } else {
        logger.warn(`iter-${iter}: スコア改善なし (${newScore} <= ${prevScore})`);
      }
    }

    // ── Step D: 最終感情波（実測信号で再計算）────────────────────────────────
    // realSignals を更新して波グラフに反映
    Object.assign(realSignals, { _updated: true });
  }

  // realSignals をスコープ外でも使えるように

  // ── 最終動画・画像を output にコピー ──────────────────────────────────────
  const videosDir = join(outputDir, 'videos');
  const imagesDir = join(outputDir, 'images');
  mkdirSync(videosDir, { recursive: true });
  mkdirSync(imagesDir, { recursive: true });

  const videoFilename = `drama-${jobId.slice(0, 8)}-ep${episode}.mp4`;
  const destPath = join(videosDir, videoFilename);
  copyFileSync(bestAssemblyOutput.finalVideoPath, destPath);

  // キーフレーム画像（初回生成分）を output/images/ にコピー
  for (const scene of (imgs.scenes ?? [])) {
    if (existsSync(scene.imagePath)) {
      const dest = join(imagesDir, `${jobId.slice(0, 8)}-ep${episode}-scene-${String(scene.sceneIndex).padStart(2, '0')}.jpg`);
      copyFileSync(scene.imagePath, dest);
    }
  }

  // ── 脚本・シーンプランを output/scripts/ に保存 ────────────────────────────
  const scriptDir = join(outputDir, 'scripts');
  mkdirSync(scriptDir, { recursive: true });
  const prefix = `${jobId.slice(0, 8)}-ep${episode}`;

  copyFileSync(join(jobDir, '01_script.json'),     join(scriptDir, `${prefix}-script.json`));
  copyFileSync(join(jobDir, '02_scene-plan.json'),  join(scriptDir, `${prefix}-scene-plan.json`));
  writeFileSync(join(scriptDir, `${prefix}-summary.md`), buildScriptMarkdown(concept, script, bestScenePlan, episode), 'utf8');

  await updateJobStatus(jobId, 'completed');

  // ── 感情の波を生成・表示・記録（実測3信号を使用）─────────────────────────
  const waveData = buildEmotionWave(bestScript, bestEvalReport, realSignals);
  renderWaveChart(waveData, { jobId, concept });
  appendEmotionRecord(outputDir, {
    jobId, concept, genre, episode,
    script: bestScript, evalReport: bestEvalReport,
    waveData, finalVideoPath: destPath,
  });
  logger.info(`感情ログ → ${join(outputDir, 'emotion_log.csv')}`);

  // ── 知見をDBに蓄積（資産として永続化）────────────────────────────────────
  if (bestEvalReport) {
    // 採用スコアをベストとしてマーク
    await markEvalAsBest(jobId, bestIteration);

    // コンセプト履歴に記録（似たコンセプトの過去実績参照用）
    await insertConceptHistory({ jobId, concept, genre, evalReport: bestEvalReport, finalVideoPath: destPath });

    // 感情パターンを更新（何が熱狂を生むかの知見を蓄積）
    const emotionalBeatSeq = script.scenes?.map(s => s.emotionalBeat) ?? [];
    const emotionTriggerSeq = script.scenes?.map(s => s.emotionTrigger).filter(Boolean) ?? [];
    await upsertEmotionPattern({
      arcTemplate: script.arc_template,
      emotionalBeatSequence: emotionalBeatSeq,
      emotionTriggerSequence: emotionTriggerSeq,
      evalReport: bestEvalReport,
    });
  }

  logger.summary({ jobId, outputPath: destPath, durationSec: bestAssemblyOutput.durationSec, score: qaReport.score });
  if (bestEvalReport) {
    console.log(`  最終スコア    : ${bestEvalReport.totalScore}/100 ${bestEvalReport.judgment}`);
    console.log(`  eval_log.md   → ${evalLogPath}`);
    console.log(`  images/       → ${imagesDir}`);
    const s = bestEvalReport.scores ?? {};
    if (s.anger || s.empathy || s.frenzy) {
      console.log(`  感情スコア    : 怒り ${s.anger?.score ?? '-'}/10  共感 ${s.empathy?.score ?? '-'}/10  熱狂 ${s.frenzy?.score ?? '-'}/10`);
    }
  }
  return { jobId, outputPath: destPath, evalReport: bestEvalReport };
}
