/**
 * emotion-wave — 感情の波グラフ生成 + スプレッドシート記録
 *
 * 役割:
 *   1. スクリプトの感情ビートから5秒ごとの感情強度を算出
 *   2. ターミナルにASCIIグラフで表示
 *   3. output/emotion_log.csv に追記（スプレッドシート）
 */

import { appendFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

// ── 感情ビート → 感情プロファイル ────────────────────────────────────────────
// 各ビートで「怒り・共感・熱狂」がどの強度で発生するかの基準値 (0〜10)
const BEAT_PROFILES = {
  hook_opener:       { anger: 3, empathy: 8, frenzy: 4 },
  tension_build:     { anger: 7, empathy: 4, frenzy: 5 },
  revelation:        { anger: 7, empathy: 5, frenzy: 7 },
  confrontation:     { anger: 9, empathy: 3, frenzy: 7 },
  despair:           { anger: 4, empathy: 9, frenzy: 2 },
  declaration:       { anger: 4, empathy: 6, frenzy: 9 },
  departure:         { anger: 3, empathy: 7, frenzy: 6 },
  silent_stare:      { anger: 3, empathy: 9, frenzy: 2 },
  insert_environment:{ anger: 2, empathy: 4, frenzy: 3 },
  shock_reaction:    { anger: 6, empathy: 7, frenzy: 6 },
  cliffhanger_end:   { anger: 5, empathy: 5, frenzy: 9 },
};
const DEFAULT_PROFILE = { anger: 5, empathy: 5, frenzy: 5 };

/**
 * 5秒ごとの感情強度データを生成
 *
 * 3信号（テキスト・フレーム・音声）が揃っている場合はそれを優先使用。
 * ない場合はビートプロファイルで補完。
 *
 * @param {object} script
 * @param {object} evalReport
 * @param {{ textAnalysis, frameAnalysis, audioAnalysis }} realSignals - 実測信号（任意）
 */
export function buildEmotionWave(script, evalReport, realSignals = {}) {
  const scenes = script.scenes ?? [];
  const totalSec = script.totalEstimatedDurationSec ?? scenes.reduce((s, sc) => s + (sc.targetDurationSec ?? 5), 0);

  // シーンの時間範囲を構築
  let cursor = 0;
  const sceneRanges = scenes.map(sc => {
    const dur = sc.targetDurationSec ?? 5;
    const range = { start: cursor, end: cursor + dur, scene: sc };
    cursor += dur;
    return range;
  });

  const INTERVAL = 5;
  const timePoints = [];
  const anger = [], empathy = [], frenzy = [], composite = [];
  const sources = []; // デバッグ用: どの信号ソースを使ったか

  // テキスト分析をシーンインデックスでマップ化
  const textByScene = Object.fromEntries(
    (realSignals.textAnalysis?.scenes ?? []).map(s => [s.sceneIndex, s])
  );

  // 音声分析の時間マップ
  const audioSignal = realSignals.audioAnalysis;

  // フレーム分析サマリー（全体スケーリングに使用）
  const frameSummary = realSignals.frameAnalysis?.summary ?? null;

  // eval スコアをキャリブレーション係数として使用
  const ev = evalReport?.scores ?? {};
  const evalCal = (key) => 0.5 + ((ev[key]?.score ?? 7) / 10) * 0.5;

  for (let t = 0; t <= totalSec; t += INTERVAL) {
    timePoints.push(t);

    const activeRange = sceneRanges.find(r => t >= r.start && t < r.end) ?? sceneRanges[sceneRanges.length - 1];
    const sceneIdx = activeRange?.scene?.sceneIndex ?? 0;
    const beat = activeRange?.scene?.emotionalBeat ?? 'hook_opener';

    // ── 基底値の決定 ──────────────────────────────────────────────────────
    const beatProfile = BEAT_PROFILES[beat] ?? DEFAULT_PROFILE;
    const textSignal  = textByScene[sceneIdx];

    let baseAnger, baseEmpathy, baseFrenzy, src;

    if (textSignal) {
      // テキスト分析が最も信頼度が高い（セリフの意図を直接反映）
      baseAnger   = textSignal.anger;
      baseEmpathy = textSignal.empathy;
      baseFrenzy  = textSignal.frenzy;
      src = 'text';
    } else {
      // フォールバック: ビートプロファイル
      baseAnger   = beatProfile.anger;
      baseEmpathy = beatProfile.empathy;
      baseFrenzy  = beatProfile.frenzy;
      src = 'beat';
    }

    // ── 音声エネルギーで補正 ──────────────────────────────────────────────
    if (audioSignal) {
      const audioIdx = audioSignal.timePoints.findIndex(tp => tp >= t);
      if (audioIdx >= 0) {
        const audioAnger  = audioSignal.anger[audioIdx]  ?? baseAnger;
        const audioEmpathy= audioSignal.empathy[audioIdx] ?? baseEmpathy;
        const audioFrenzy = audioSignal.frenzy[audioIdx]  ?? baseFrenzy;
        // テキスト70% + 音声30% のブレンド
        baseAnger   = baseAnger   * 0.7 + audioAnger   * 0.3;
        baseEmpathy = baseEmpathy * 0.7 + audioEmpathy * 0.3;
        baseFrenzy  = baseFrenzy  * 0.7 + audioFrenzy  * 0.3;
        src += '+audio';
      }
    }

    // ── フレーム分析でスケーリング ────────────────────────────────────────
    if (frameSummary) {
      // フレームの平均値と eval の乖離でスケーリング
      const frameScale = (frameSummary.anger + frameSummary.empathy + frameSummary.frenzy) / 30;
      baseAnger   *= frameScale;
      baseEmpathy *= frameScale;
      baseFrenzy  *= frameScale;
      src += '+frame';
    }

    // eval キャリブレーション適用
    const finalAnger   = Math.min(10, Math.max(0, Math.round(baseAnger   * evalCal('anger')   * 10) / 10));
    const finalEmpathy = Math.min(10, Math.max(0, Math.round(baseEmpathy * evalCal('empathy') * 10) / 10));
    const finalFrenzy  = Math.min(10, Math.max(0, Math.round(baseFrenzy  * evalCal('frenzy')  * 10) / 10));

    anger.push(finalAnger);
    empathy.push(finalEmpathy);
    frenzy.push(finalFrenzy);
    composite.push(Math.round((finalAnger + finalEmpathy + finalFrenzy) / 3 * 10) / 10);
    sources.push(src);
  }

  return { timePoints, anger, empathy, frenzy, composite, totalSec, sceneRanges, sources };
}

/**
 * ターミナルにASCIIグラフで感情の波を表示
 */
export function renderWaveChart(waveData, { jobId, concept }) {
  const { timePoints, anger, empathy, frenzy, sceneRanges } = waveData;

  const CYAN  = '\x1b[36m';
  const RED   = '\x1b[31m';
  const GREEN = '\x1b[32m';
  const BLUE  = '\x1b[34m';
  const YELLOW= '\x1b[33m';
  const DIM   = '\x1b[2m';
  const RESET = '\x1b[0m';

  const WIDTH = timePoints.length;
  const HEIGHT = 10; // 1〜10

  console.log(`\n${CYAN}━━ 感情の波グラフ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`   Job: ${jobId.slice(0, 8)}  「${concept.slice(0, 30)}${concept.length > 30 ? '…' : ''}」`);
  console.log(`   ${RED}A${RESET} 怒り  ${GREEN}E${RESET} 共感  ${BLUE}F${RESET} 熱狂`);
  console.log(`${CYAN}─────────────────────────────────────────────────────────────────${RESET}`);

  // グリッドを構築
  const grid = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(' '));

  for (let col = 0; col < WIDTH; col++) {
    const aRow = HEIGHT - Math.round(anger[col] ?? 0);
    const eRow = HEIGHT - Math.round(empathy[col] ?? 0);
    const fRow = HEIGHT - Math.round(frenzy[col] ?? 0);

    // 優先度: frenzy > anger > empathy（重なる場合）
    if (eRow >= 0 && eRow < HEIGHT) grid[eRow][col] = `${GREEN}E${RESET}`;
    if (aRow >= 0 && aRow < HEIGHT) grid[aRow][col] = `${RED}A${RESET}`;
    if (fRow >= 0 && fRow < HEIGHT) grid[fRow][col] = `${BLUE}F${RESET}`;

    // 同じ位置に複数の感情が重なる場合は複合マーク
    const uniq = new Set([aRow, eRow, fRow]);
    if (uniq.size < 3) {
      // 2つ以上が同じ行にある = 交差点
    }
  }

  // 行を描画
  for (let row = 0; row < HEIGHT; row++) {
    const level = HEIGHT - row;
    const label = String(level).padStart(2);
    const line = grid[row].join('');
    console.log(`  ${DIM}${label}${RESET} │ ${line}`);
  }

  // X軸
  const xAxis = timePoints.map(t => String(t + 's').padEnd(4)).join(' ').slice(0, WIDTH * 5);
  console.log(`     ${DIM}└${'─'.repeat(WIDTH + 1)}${RESET}`);
  console.log(`       ${DIM}${xAxis}${RESET}`);

  // シーン境界を表示
  console.log(`\n   シーン構成:`);
  for (const r of sceneRanges) {
    const beat = r.scene.emotionalBeat;
    const profile = BEAT_PROFILES[beat] ?? DEFAULT_PROFILE;
    const dominant = Object.entries(profile).sort((a, b) => b[1] - a[1])[0][0];
    const emotionLabel = dominant === 'anger' ? `${RED}怒り${RESET}` : dominant === 'empathy' ? `${GREEN}共感${RESET}` : `${BLUE}熱狂${RESET}`;
    console.log(`   ${DIM}${String(r.start).padStart(3)}s〜${String(r.end).padEnd(3)}s${RESET}  ${beat.padEnd(20)} → ${emotionLabel}が支配`);
  }

  console.log(`${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);
}

/**
 * output/emotion_log.csv に1行追記
 * 動画が作成されるたびに感情スコアと波データを記録
 */
export function appendEmotionRecord(outputDir, { jobId, concept, genre, episode, script, evalReport, waveData, finalVideoPath }) {
  const csvPath = join(outputDir, 'emotion_log.csv');

  const ev = evalReport?.scores ?? {};
  const score = (key) => ev[key]?.score ?? '';

  // ヘッダー行（ファイルが存在しない場合のみ書き込む）
  if (!existsSync(csvPath)) {
    const sceneCols = (script.scenes ?? []).map((_, i) => `scene${i}_beat,scene${i}_dominant_emotion,scene${i}_anger,scene${i}_empathy,scene${i}_frenzy`).join(',');
    const waveCols  = (waveData?.timePoints ?? []).map(t => `t${t}s_anger,t${t}s_empathy,t${t}s_frenzy`).join(',');
    const header = [
      'timestamp', 'jobId', 'concept', 'genre', 'episode',
      'total_score', 'hook', 'anger', 'empathy', 'frenzy', 'viral', 'cliffhanger',
      'character', 'drama', 'subtitle', 'audio',
      'duration_sec', 'scene_count',
      sceneCols,
      waveCols,
      'video_path',
    ].filter(Boolean).join(',');
    writeFileSync(csvPath, header + '\n', 'utf8');
  }

  const totalSec = script.totalEstimatedDurationSec ?? '';
  const sceneCnt = script.scenes?.length ?? '';

  // シーンごとのデータ
  const sceneCells = (script.scenes ?? []).map((sc) => {
    const profile = BEAT_PROFILES[sc.emotionalBeat] ?? DEFAULT_PROFILE;
    const dominant = Object.entries(profile).sort((a, b) => b[1] - a[1])[0][0];
    return [sc.emotionalBeat, dominant, profile.anger, profile.empathy, profile.frenzy].join(',');
  }).join(',');

  // 波データ（5秒ごと）
  const waveCells = (waveData?.timePoints ?? []).map((_, i) => {
    return [
      (waveData.anger[i]   ?? '').toFixed(1),
      (waveData.empathy[i] ?? '').toFixed(1),
      (waveData.frenzy[i]  ?? '').toFixed(1),
    ].join(',');
  }).join(',');

  const safeConcept = `"${(concept ?? '').replace(/"/g, '""')}"`;
  const safeVideoPath = `"${(finalVideoPath ?? '').replace(/"/g, '""')}"`;

  const row = [
    new Date().toISOString().slice(0, 19).replace('T', ' '),
    jobId,
    safeConcept,
    genre ?? '',
    episode ?? 1,
    evalReport?.totalScore ?? '',
    score('hook'), score('anger'), score('empathy'), score('frenzy'),
    score('viral'), score('cliffhanger'),
    score('character'), score('drama'), score('subtitle'), score('audio'),
    totalSec, sceneCnt,
    sceneCells,
    waveCells,
    safeVideoPath,
  ].join(',');

  appendFileSync(csvPath, row + '\n', 'utf8');
}
