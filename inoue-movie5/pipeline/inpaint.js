#!/usr/bin/env node
/**
 * Video-to-Video プロダクト差し替えパイプライン
 *
 * テンプレート動画の全フレームに FLUX Pro Fill を適用し、
 * 商品だけを差し替えた動画を再構築する。
 * 手・背景・カメラモーション・構図はオリジナルを完全に維持。
 *
 * 使い方:
 *   node pipeline/inpaint.js \
 *     --clips-dir templates/00_Tumbler \
 *     --product /path/to/product.jpg \
 *     --title "ネックマッサージャー" \
 *     [--output-dir output/inpaint] \
 *     [--resume <job_id>] \
 *     [--no-assembly]
 *
 * 処理フロー:
 *   1. クリップ検出・フレーム数取得
 *   2. 全クリップ（並列）:
 *      a. 全フレーム抽出（1080×1920 にスケール）
 *      b. 中間フレームで Claude Vision ゾーン検出（製品が写っているフレーム）
 *      c. マスク生成・アップロード（クリップ単位で1回）
 *      d. 全フレームを fal.ai にアップロード
 *      e. FLUX Pro Fill で全フレームを差し替え（同一 seed で一貫性確保）
 *      f. 差し替え済みフレームをダウンロード
 *      g. ffmpeg で動画再構築（元の fps を維持）
 *   3. 全クリップ concat → final.mp4
 *   4. ポストアセンブリ（ナレーション・字幕・カラーグレード・CTA） → final_assembled.mp4
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'fs';
import { join, basename, extname, resolve } from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require    = createRequire(import.meta.url);
const dotenv     = require('dotenv');
dotenv.config({ path: resolve(__dirname, '../.env') });

import sharp from 'sharp';
import { FFMPEG, FFPROBE } from '../lib/ffmpeg-path.js';
import { program } from 'commander';

const FLUX_MODEL     = 'fal-ai/flux-pro/v1/fill';
const FAL_KEY        = process.env.FAL_KEY?.trim();
const TARGET_W       = 1080;
const TARGET_H       = 1920;
const FLUX_CONCUR    = 15; // 同時実行数

// ─── 商品動画 20パターン（TikTok人気構成） ─────────────────────────────────────
// ショットパターン — 参考動画（モバイル充電器.mp4）を分析して設計
// カテゴリ: HOOK（フック・目を止める）/ SHOW（商品詳細を見せる）/ CLOSE（締め・信頼感）
// 各カットに異なるカテゴリを割り当ててユーザー維持率を最大化する

// SHOT_PATTERNS — templates/02_Tumblerver2/ の各クリップから実際の動きを分析して定義
// 各パターンは商品が変わっても再利用できるよう汎用的に記述
const SHOT_PATTERNS = {
  // ─── HOOK: 冒頭0〜2秒で目を止める ────────────────────────────────────────
  hook: [
    {
      id: 'handle_grip_swing',
      name: 'ハンドルグリップ・スウィング',
      // cut1: 片手でハンドル/トップを掴み商品がスイングしながら正位置に収まる
      motion: 'FAST DRAMATIC SWING: one hand grips the top of product firmly, arm swings product in a wide confident arc from side to center, strong pendulum momentum, product bounces slightly at stop, low-angle camera tilt, highly dynamic movement',
    },
    {
      id: 'side_sweep_fast',
      name: '右端から高速スウィープイン',
      // cut2: 商品が右端から素早くスイープイン、下部グリップ
      motion: 'HIGH-SPEED SWEEP: product rockets into frame from right edge with strong motion blur trail, arm fully extended then snaps product to center with wrist flick, fast deceleration, energy and speed, hand grips lower body tightly',
    },
    {
      id: 'fast_entry_bottom_grip',
      name: '高速飛び込み・下部グリップ',
      // cut10: 商品が右から素早く飛び込んでくる、片手で下部グリップ、ブレあり
      motion: 'EXPLOSIVE ENTRY: product blasts into frame from right with heavy motion blur, hand grips base firmly, hard impact stop at center frame, camera shake from force, aggressive fast movement fills screen instantly',
    },
    {
      id: 'upside_down_grip',
      name: '逆さグリップショット',
      motion: 'BOLD INVERSION: hand confidently grips product base and holds it fully upside-down, camera starts low looking up then tilts to reveal inverted product dramatically, strong wrist lock holds steady, unexpected orientation',
    },
    {
      id: 'thrust_to_camera',
      name: 'カメラ直撃プッシュ',
      motion: 'DIRECT CAMERA THRUST: hand shoots product directly at lens in one explosive fast push, product grows rapidly filling 90% of frame, sharp stop right at camera, forceful in-your-face presentation',
    },
    {
      id: 'dramatic_invert',
      name: 'ダイナミック逆さフリップ',
      motion: 'RAPID WRIST FLIP: hand holds product upright then executes sharp fast wrist rotation flipping product completely upside-down, continuous spinning motion with visible rotation blur, surprising and dynamic',
    },
  ],

  // ─── SHOW: 商品の特徴・詳細を見せる ──────────────────────────────────────
  show: [
    {
      id: 'lid_button_point',
      name: '蓋ボタン・指さしデモ',
      // cut3: 片手で本体を持ち、もう片方の人差し指が蓋のボタンを指さし→押す
      motion: 'FEATURE SPOTLIGHT: one hand firmly holds product, second hand enters quickly with index finger stabbing directly at product feature, camera zooms toward the interaction point, sharp decisive tap gesture, close-up reveals detail clearly',
    },
    {
      id: 'lid_open_demo',
      name: '蓋開けデモ',
      // cut4: 両手で蓋開閉メカニズムを操作、徐々に開口部が見える
      motion: 'SATISFYING OPEN: both hands grip product firmly and pull lid apart with visible effort, opening snaps or clicks open with tension, reveal of interior in one smooth satisfying motion, close overhead angle, strong hand action',
    },
    {
      id: 'body_tilt_closeup',
      name: '本体傾け・ボディクローズアップ',
      // cut5: 両手で本体を持ち、カメラ側へ傾けてボディ面を見せる
      motion: 'BOLD TILT REVEAL: both hands grip product and thrust it toward camera at sharp 30-degree tilt, product surface fills frame, camera pushes in simultaneously, dramatic close-up of label and texture, confident display motion',
    },
    {
      id: 'base_tilt_reveal',
      name: '底部傾け・ベースリビール',
      // cut6: 両手で商品を傾けて底面・ベース部分を見せる
      motion: 'DRAMATIC BOTTOM REVEAL: both hands flip product sharply to 60-degree angle exposing base completely, fast rotation motion, camera follows tilt movement, crisp reveal of underside in decisive single move',
    },
    {
      id: 'bottom_cap_spin',
      name: '底面キャップ・親指スピン',
      // cut7: 両手で底面キャップを持ち、親指が回転させる
      motion: 'SPINNING CLOSE-UP: both hands hold product base inches from camera, thumb aggressively rotates base component in fast continuous spin, macro close-up captures spinning motion blur, satisfying mechanical movement',
    },
    {
      id: 'two_finger_point',
      name: '2本指ボディポイント',
      // cut8: 片手ホールド、もう片方の2本指でボディを指し示す
      motion: 'EMPHATIC POINT: one hand holds product, second hand enters from off-frame with two fingers jabbing sharply at product surface twice, aggressive pointing gesture, camera briefly zooms toward touch point, strong emphasis',
    },
  ],

  // ─── CLOSE: 購買意欲を高める締めショット ─────────────────────────────────
  close: [
    {
      id: 'thumbs_up_present',
      name: 'サムズアップ・おすすめ演出',
      // cut9: 片手ホールド、もう片方がサムズアップジェスチャー
      motion: 'CONFIDENT ENDORSEMENT: one hand raises product high at center, second hand slams into frame with big emphatic thumbs-up, both held strong for viewer, camera pushes in slowly, warm energetic presentation',
    },
    {
      id: 'present_both_hands',
      name: '両手差し出し・クロース',
      motion: 'POWERFUL OFFER: both hands thrust product firmly toward camera in strong forward extension, arms fully stretched presenting product at lens level, confident commercial stance, slight push at end for emphasis',
    },
    {
      id: 'grip_shake_confident',
      name: '自信グリップ・シェイク',
      motion: 'POWER SHAKE: hand grips product tightly and delivers three rapid hard shakes directly toward camera, product bounces aggressively, strong wrist movement, decisive authoritative motion, then holds steady front-facing',
    },
    {
      id: 'point_and_hold',
      name: '指さし→ホールドフィニッシュ',
      motion: 'SHARP POINT FREEZE: one hand holds product up, second hand shoots in fast from side pointing index finger hard at product, freezes in emphatic hold, camera slightly zooms in on the pointed gesture, dramatic pause',
    },
    {
      id: 'zoom_in_label',
      name: 'ラベル・ブランドズームイン',
      motion: 'AGGRESSIVE ZOOM: camera rushes forward fast toward product label or logo, rapid push-in with slight tilt, label grows to fill 80% of frame, motion blur on approach, sharp focus stop on brand detail',
    },
    {
      id: 'dramatic_center_hold',
      name: 'センターホールド・フィニッシュ',
      motion: 'TRIUMPHANT LIFT: both hands raise product swiftly upward to dead center, product slams to stop at eye level facing camera, strong upward momentum, confident commercial hold, camera tilts up with the lift motion',
    },
  ],
};

// ── セーフパターン（品質チェック失敗時のリトライ用：ズーム・チルト・パン・クローズアップのみ） ──
const SAFE_PATTERNS = [
  {
    id: 'safe_zoom_in',
    name: 'セーフ ズームイン',
    motion: 'camera slowly zooming in toward the product already in frame, smooth forward dolly, product fills frame gradually, single hand only, no duplicate products, no extra hands or arms',
  },
  {
    id: 'safe_zoom_out',
    name: 'セーフ ズームアウト',
    motion: 'camera slowly pulling back revealing full product already in frame, smooth backward dolly, single hand only, no duplicate products, no extra hands or arms',
  },
  {
    id: 'safe_tilt_up',
    name: 'セーフ チルトアップ',
    motion: 'camera slowly tilting upward along product already in frame, vertical pan from bottom to top, single hand only, no duplicate products, no extra hands or arms',
  },
  {
    id: 'safe_tilt_down',
    name: 'セーフ チルトダウン',
    motion: 'camera slowly tilting downward along product already in frame, vertical pan from top to bottom, single hand only, no duplicate products, no extra hands or arms',
  },
  {
    id: 'safe_pan_left',
    name: 'セーフ パン左',
    motion: 'camera smoothly panning left while tracking product already in frame, product centered throughout, single hand only, no duplicate products, no extra hands or arms',
  },
  {
    id: 'safe_pan_right',
    name: 'セーフ パン右',
    motion: 'camera smoothly panning right while tracking product already in frame, product centered throughout, single hand only, no duplicate products, no extra hands or arms',
  },
  {
    id: 'safe_closeup_detail',
    name: 'セーフ クローズアップ',
    motion: 'extreme close-up shot of product already in frame, very slow subtle drift across surface, showcasing texture and detail, single hand only, no duplicate products, no extra hands or arms',
  },
  {
    id: 'safe_macro_scan',
    name: 'セーフ マクロスキャン',
    motion: 'camera scanning slowly across product surface in macro close-up, product already in frame, detail exploration from one end to the other, single hand only, no duplicate products, no extra hands or arms',
  },
];

// ─── CLI ────────────────────────────────────────────────────────────────────

program
  .name('inpaint')
  .description('テンプレート動画の商品をフレーム単位で FLUX Fill 差し替え（video-to-video）')
  .requiredOption('--clips-dir <dir>', 'テンプレートクリップのディレクトリ')
  .requiredOption('--product <path>', '差し替え後の商品画像パス')
  .requiredOption('--title <title>', '商品名（プロンプト用）')
  .option('--output-dir <dir>', '出力先', 'output/inpaint')
  .option('--resume <jobId>', '中断した job_id から再開')
  .option('--no-assembly', 'ポストアセンブリ（ナレーション・字幕・CTA）をスキップ')
  .option('--test', 'テストモード: 最初の3カットのみ生成（本番は --production）', false)
  .option('--production', '本番モード: 全カット生成（デフォルト）', false)
  .option('--verbose', '詳細ログ', false)
  .parse(process.argv);

const opts = program.opts();
await main(opts);

// ─── main ────────────────────────────────────────────────────────────────────

async function main({ clipsDir, product, title, outputDir: rawOut, resume, assembly, test: testMode, verbose }) {
  if (!FAL_KEY) { console.error('❌ FAL_KEY が設定されていません'); process.exit(1); }

  const outputDir = resolve(rawOut);
  clipsDir = resolve(clipsDir);
  product  = resolve(product);

  const jobId   = resume ?? crypto.randomUUID().slice(0, 8);
  const workDir = join(process.env.TMPDIR ?? '/tmp', `inpaint-${jobId}`);
  mkdirSync(workDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  // images/ と videos/ サブフォルダを作成
  const imagesDir = join(outputDir, 'images');
  const videosDir = join(outputDir, 'videos');
  mkdirSync(imagesDir, { recursive: true });
  mkdirSync(videosDir, { recursive: true });

  const statePath = join(workDir, 'state.json');
  const state     = loadState(statePath);

  // 全クリップ共通 seed（商品外観の一貫性確保）
  if (!state.sharedSeed) {
    state.sharedSeed = Math.floor(Math.random() * 999999);
    saveState(statePath, state);
  }
  const sharedSeed = state.sharedSeed;

  // コスト・時間トラッキング
  if (!state.meta) state.meta = { startTime: Date.now(), apiCalls: { fluxFill: 0, seedance: 0, claudeVision: 0, elevenlabs: 0 } };
  state.meta.outputDir = outputDir;
  state.meta.title     = title;
  saveState(statePath, state);

  console.log(`\n🎬 Video-to-Video Inpaint — Job: ${jobId}`);
  console.log(`   商品: ${title}`);
  console.log(`   クリップ: ${clipsDir}`);
  console.log(`   出力先: ${outputDir}\n`);

  // ─── Step 1: クリップ一覧 ────────────────────────────────────────────────
  const clips = readdirSync(clipsDir)
    .filter(f => /\.(mp4|mov|MP4|MOV)$/.test(f) && !f.includes('full'))
    .sort()
    .map(f => {
      const p = join(clipsDir, f);
      const name = basename(f, extname(f));
      const { fps, frameCount } = getVideoInfo(p);
      const duration = frameCount / fps;
      return { path: p, name, fps, frameCount, duration };
    });

  if (!clips.length) { console.error(`❌ クリップなし: ${clipsDir}`); process.exit(1); }

  // テストモード: 最初の3カットのみ生成
  const MAX_CLIPS = testMode ? 3 : clips.length;
  const activeClips = clips.slice(0, MAX_CLIPS);
  if (testMode) console.log(`⚡ テストモード: ${activeClips.length}カットのみ生成（本番は --production で全${clips.length}カット）\n`);

  const videoProvider = process.env.VIDEO_GEN_PROVIDER ?? 'flux';

  // カテゴリ別パターン選択（ユーザー維持率最適化）
  // 3カット: HOOK → SHOW → CLOSE の順で異なる動きを保証
  // カット数が増えた場合はサイクルを繰り返す
  const categoryOrder = ['hook', 'show', 'close'];
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const usedIds = new Set();
  activeClips.forEach((clip, i) => {
    const category = categoryOrder[i % categoryOrder.length];
    const pool = SHOT_PATTERNS[category].filter(p => !usedIds.has(p.id));
    const pattern = rand(pool.length > 0 ? pool : SHOT_PATTERNS[category]);
    clip.pattern = { ...pattern, category }; // カテゴリを合成構図選択に使う
    usedIds.add(pattern.id);
  });

  console.log(`Step 1: ${activeClips.length}本 / プロバイダ: ${videoProvider}`);
  activeClips.forEach(c => console.log(`   ${c.name}: [${c.pattern.name}]`));
  console.log();

  // ─── Step 2: 全クリップ並列処理 ──────────────────────────────────────────
  // ゾーン検出のみ順次実行（Claude Vision レートリミット対策）
  console.log('Step 2a: ゾーン検出（順次）...');
  for (const clip of activeClips) {
    const key = `clip_${clip.name}`;
    if (!state[key]) state[key] = {};
    if (state[key].maskUrl) { if (verbose) console.log(`  ${clip.name}: キャッシュ済み`); continue; }

    const outPath = join(outputDir, `${clip.name}_inpainted.mp4`);
    if (existsSync(outPath)) { state[key].done = true; saveState(statePath, state); continue; }

    const framesDir = join(workDir, `${clip.name}_frames`);
    mkdirSync(framesDir, { recursive: true });

    // 中間フレーム抽出
    const midIdx  = Math.floor(clip.frameCount / 2);
    const midPath = join(framesDir, 'frame_mid.jpg');
    extractFrame(clip.path, midPath, midIdx, clip.fps);

    // ゾーン検出
    const zone = await detectProductZone(midPath, title, verbose);
    state[key].zone       = zone;
    state[key].hasProduct = zone.confidence !== 'none';

    // マスク生成 + アップロード
    const maskPath = join(workDir, `${clip.name}_mask.png`);
    await createMask(zone, maskPath);
    state[key].maskUrl = await uploadFile(maskPath, 'image/png');
    state.meta.apiCalls.claudeVision += 1;
    saveState(statePath, state);
    console.log(`  ${clip.name}: ゾーン検出完了 hasProduct=${state[key].hasProduct}`);
  }

  console.log(`\nStep 2b: 全クリップ並列処理（${videoProvider === 'seedance' ? 'FLUX Fill 1フレーム → Seedance video-to-video' : 'FLUX Fill 全フレーム'}）...`);
  await Promise.all(activeClips.map(clip =>
    processClip({ clip, title, product, workDir, outputDir, imagesDir, videosDir, state, statePath, verbose, videoProvider, sharedSeed, pattern: clip.pattern })
  ));

  // ─── Step 3: concat ──────────────────────────────────────────────────────
  console.log('\nStep 3: 全クリップを連結中...');
  const outPaths  = activeClips.map(c => join(videosDir, `${c.name}_inpainted.mp4`));
  const listPath  = join(workDir, 'concat_list.txt');
  const finalPath = join(videosDir, 'final.mp4');

  writeFileSync(listPath, outPaths.map(p => `file '${p}'`).join('\n'), 'utf8');
  // Fix 1: concat 時にもスケールフィルタを適用してリエンコード
  spawnOrThrow(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-vf', `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,crop=${TARGET_W}:${TARGET_H}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-b:v', '15M', '-an', finalPath]);

  const dur = getDuration(finalPath);
  console.log(`\n✅ concat 完了 — ${activeClips.length}本 → final.mp4 (${dur.toFixed(2)}秒)${testMode ? ' [テストモード]' : ''}`);
  state.meta.finalPath = finalPath;

  // ─── Step 4: ポストアセンブリ ─────────────────────────────────────────────
  if (assembly !== false) {
    console.log('\nStep 4: ポストアセンブリ（ナレーション・字幕・カラーグレード・CTA）...');
    await runPostAssembly(finalPath, title, workDir, outputDir, videosDir, state, statePath);
  } else {
    console.log('\nStep 4: --no-assembly フラグ指定 → スキップ');
  }

  const assembledPath = join(videosDir, 'final_assembled.mp4');
  const displayPath   = existsSync(assembledPath) ? assembledPath : finalPath;

  // 終了時刻・コスト記録
  state.meta.endTime       = Date.now();
  state.meta.assembledPath = assembledPath;
  saveState(statePath, state);

  const elapsedSec = ((state.meta.endTime - state.meta.startTime) / 1000).toFixed(0);
  const cost = estimateCost(state.meta.apiCalls);
  console.log(`\n✅ 完了`);
  console.log(`   出力先: ${displayPath}`);
  console.log(`   ⏱️  生成時間: ${Math.floor(elapsedSec/60)}分${elapsedSec%60}秒`);
  console.log(`   💰 推定コスト: ¥${cost.jpy} ($${cost.usd})`);
  console.log(`\n   Job ID: ${jobId} (--resume ${jobId} で再開可能)`);

  // ─── Step 5: 品質評価（自動） ──────────────────────────────────────────────
  if (existsSync(displayPath)) {
    try {
      const { runEval } = await import('./eval.js');
      const defaultRef = resolve(__dirname, '../templates/Tumbler-full.mp4');
      await runEval({
        generatedPath: displayPath,
        referencePath: existsSync(defaultRef) ? defaultRef : undefined,
        outputDir,
        jobId,
        meta: state.meta,
      });
    } catch (e) {
      console.warn(`\n⚠️  評価エージェント失敗（スキップ）: ${e.message}`);
    }
  }
}

// ─── per-clip 処理（プロバイダ切替） ─────────────────────────────────────────

async function processClip({ clip, title, product, workDir, outputDir, imagesDir, videosDir, state, statePath, verbose, videoProvider, sharedSeed, pattern }) {
  const key     = `clip_${clip.name}`;
  const st      = state[key];
  const outPath = join(videosDir, `${clip.name}_inpainted.mp4`);

  if (existsSync(outPath)) {
    if (verbose) console.log(`  ✅ ${clip.name}: スキップ`);
    return;
  }

  // 商品が写っていないクリップはオリジナルをそのままコピー
  if (!st.hasProduct) {
    console.log(`  ${clip.name}: 商品なし → オリジナルをコピー`);
    spawnOrThrow(FFMPEG, ['-y', '-i', clip.path,
      '-vf', `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease,pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2:color=black`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-b:v', '15M', '-an', outPath]);
    return;
  }

  if (videoProvider === 'seedance') {
    await processSeedanceClip({ clip, title, product, workDir, outputDir, imagesDir, videosDir, state, statePath, verbose, outPath, sharedSeed, pattern });
  } else {
    await processFluxClip({ clip, title, workDir, outputDir, videosDir, state, statePath, verbose, outPath, sharedSeed });
  }
}

// ─── Seedance video-to-video ─────────────────────────────────────────────────

async function processSeedanceClip({ clip, title, product, workDir, outputDir, imagesDir, videosDir, state, statePath, verbose, outPath, sharedSeed, pattern }) {
  const key = `clip_${clip.name}`;
  const st  = state[key];

  const framesDir = join(workDir, `${clip.name}_frames`);
  mkdirSync(framesDir, { recursive: true });

  // a. キーフレーム抽出（中間フレーム、未実施の場合）
  const midPath = join(framesDir, 'frame_mid.jpg');
  if (!existsSync(midPath)) {
    const midIdx = Math.floor(clip.frameCount / 2);
    extractFrame(clip.path, midPath, midIdx, clip.fps);
  }

  // b. Sharp で商品画像をキーフレームに直接合成（商品画像を確実に使用）
  // カテゴリ別に構図を変える → Seedance の入力フレームに視覚的多様性を持たせる
  const replacedKeyframePath = join(imagesDir, `${clip.name}_keyframe.jpg`); // images/ サブフォルダに保存
  if (!existsSync(replacedKeyframePath)) {
    console.log(`  ${clip.name}: Sharp 合成中 [${pattern.category ?? 'hook'}]...`);
    await compositeProduct(midPath, product, st.zone, replacedKeyframePath, pattern.category ?? 'hook');

    // 品質チェック
    const quality = await checkImageQuality(replacedKeyframePath, title);
    console.log(`  ${clip.name}: 品質チェック ${quality.score}/10 — ${quality.reason}`);
    st.qualityScore = quality.score;
    saveState(statePath, state);
  }

  // d. Seedance 用に fal.ai ストレージへアップロード（実際の形式で）
  const uploadedImageUrl = await uploadFile(replacedKeyframePath, 'image/jpeg'); // Sharp 出力は常に JPEG

  // e. ショットパターンからモーションプロンプトを構築
  const allPatterns = [...SHOT_PATTERNS.hook, ...SHOT_PATTERNS.show, ...SHOT_PATTERNS.close];
  const pat = pattern ?? allPatterns[0];
  const buildMotionPrompt = (motion) =>
    `${title} product already held in hand in frame. ${motion}. IMPORTANT: generate strong visible motion and dynamic camera movement throughout the entire clip. photorealistic, home video style, natural indoor lighting, warm ambient light, handheld camera feel, slight camera shake, realistic skin texture, single hand only, no duplicate products, no extra hands`;
  console.log(`  ${clip.name}: [${pat.name}] ${pat.motion.slice(0, 60)}...`);

  // f. Seedance へ submit（キャッシュあればスキップ）+ 品質チェック＋リトライ（最大2回）
  const MAX_RETRY = 2;
  let seedanceVideoUrl = st.seedanceVideoUrl;
  let rawPath = join(workDir, `${clip.name}_seedance_raw.mp4`);

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    const attemptSuffix = attempt === 0 ? '' : `_retry${attempt}`;
    const cacheKey      = attempt === 0 ? 'seedanceVideoUrl' : `seedanceVideoUrl_retry${attempt}`;
    const rawPathAttempt = attempt === 0
      ? join(workDir, `${clip.name}_seedance_raw.mp4`)
      : join(workDir, `${clip.name}_seedance_raw_retry${attempt}.mp4`);

    // キャッシュ確認（attempt=0 は既存キャッシュ、retry は別キー）
    let videoUrl = st[cacheKey];

    if (!videoUrl) {
      const currentMotion = attempt === 0
        ? pat.motion
        : SAFE_PATTERNS[Math.floor(Math.random() * SAFE_PATTERNS.length)].motion;
      const motionPrompt = buildMotionPrompt(currentMotion);

      if (attempt > 0) {
        console.log(`  ${clip.name}: リトライ ${attempt}/${MAX_RETRY}...`);
      } else {
        console.log(`  ${clip.name}: Seedance 生成中...`);
      }

      videoUrl = await runSeedance(uploadedImageUrl, motionPrompt, clip.duration);
      st[cacheKey] = videoUrl;
      state.meta.apiCalls.seedance += 1;
      saveState(statePath, state);
    }

    // ダウンロード
    if (!existsSync(rawPathAttempt)) {
      await downloadFile(videoUrl, rawPathAttempt);
    }

    // 品質チェック（既に seedanceVideoUrl がキャッシュされていた attempt=0 はチェックをスキップ）
    if (attempt === 0 && st.seedanceVideoUrl && st.videoFrameCheckPassed) {
      // 既にチェック通過済み → スキップ
      rawPath = rawPathAttempt;
      seedanceVideoUrl = videoUrl;
      console.log(`  ${clip.name}: ビデオフレームチェック済み（キャッシュ）`);
      break;
    }

    const checkFramePath = join(workDir, `${clip.name}${attemptSuffix}_raw_check.jpg`);
    // 中間フレームを抽出してチェック
    try {
      spawnOrThrow(FFMPEG, [
        '-y', '-ss', '2', '-i', rawPathAttempt,
        '-frames:v', '1', '-q:v', '2', checkFramePath,
      ]);
    } catch (e) {
      console.warn(`  ${clip.name}: チェックフレーム抽出失敗 → チェックスキップ: ${e.message}`);
      rawPath = rawPathAttempt;
      seedanceVideoUrl = videoUrl;
      break;
    }

    const frameCheck = await checkVideoFrame(checkFramePath);
    console.log(`  ${clip.name}: ビデオフレームチェック pass=${frameCheck.pass} issues=${JSON.stringify(frameCheck.issues)}`);

    if (frameCheck.pass || attempt === MAX_RETRY) {
      rawPath = rawPathAttempt;
      seedanceVideoUrl = videoUrl;
      if (frameCheck.pass) {
        st.videoFrameCheckPassed = true;
        saveState(statePath, state);
      } else {
        console.warn(`  ${clip.name}: 品質チェック失敗（リトライ上限）→ 最後の結果を使用`);
      }
      break;
    }
    // pass=false かつリトライ余地あり → ループ継続
  }

  // h. 元の尺にトリム + 解像度正規化
  spawnOrThrow(FFMPEG, [
    '-y', '-i', rawPath,
    '-t', String(clip.duration.toFixed(3)),
    '-vf', `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,crop=${TARGET_W}:${TARGET_H}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-b:v', '15M', '-an',
    outPath,
  ]);

  console.log(`  ✅ ${clip.name}: Seedance 完了 (${clip.duration.toFixed(2)}sにトリム)`);
}

// ─── FLUX Fill 全フレーム（従来フロー） ───────────────────────────────────────

async function processFluxClip({ clip, title, workDir, outputDir, state, statePath, verbose, outPath, sharedSeed }) {
  const key = `clip_${clip.name}`;
  const st  = state[key];

  const framesDir   = join(workDir, `${clip.name}_frames`);
  const replacedDir = join(workDir, `${clip.name}_replaced`);
  mkdirSync(framesDir,   { recursive: true });
  mkdirSync(replacedDir, { recursive: true });

  const framePattern = join(framesDir, 'frame_%04d.jpg');
  if (!existsSync(join(framesDir, 'frame_0001.jpg'))) {
    console.log(`  ${clip.name}: フレーム抽出中（${clip.frameCount}フレーム）...`);
    spawnOrThrow(FFMPEG, [
      '-y', '-i', clip.path,
      '-vf', `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease,pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2:color=black`,
      '-q:v', '2', framePattern,
    ]);
  }

  const framePaths = readdirSync(framesDir)
    .filter(f => f.startsWith('frame_') && f.endsWith('.jpg') && f !== 'frame_mid.jpg')
    .sort()
    .map(f => join(framesDir, f));

  const seed = sharedSeed;

  const prompt = `${title}, naturally held in hand, realistic lighting, seamless product replacement, high quality`;

  const pending = framePaths.filter(p => !existsSync(join(replacedDir, basename(p))));
  if (pending.length > 0) {
    console.log(`  ${clip.name}: FLUX Fill ${pending.length}フレーム処理中...`);
    await runWithConcurrency(pending, FLUX_CONCUR, async (framePath) => {
      const replacedPath = join(replacedDir, basename(framePath));
      const frameUrl = await uploadFile(framePath, 'image/jpeg');
      const resultUrl = await runFluxFill({
        frameUrl, maskUrl: st.maskUrl, prompt, seed, label: `${clip.name}/${basename(framePath)}`,
      });
      await downloadFile(resultUrl, replacedPath);
    });
  }

  console.log(`  ${clip.name}: 動画再構築中...`);
  spawnOrThrow(FFMPEG, [
    '-y', '-framerate', String(clip.fps),
    '-i', join(replacedDir, 'frame_%04d.jpg'),
    '-vf', `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,crop=${TARGET_W}:${TARGET_H}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-b:v', '15M', '-an', outPath,
  ]);
  console.log(`  ✅ ${clip.name}: 完了`);
}

// ─── Seedance fal.ai queue ────────────────────────────────────────────────────

async function runSeedance(imageUrl, prompt, clipDuration) {
  const model   = process.env.SEEDANCE_ENDPOINT ?? 'fal-ai/bytedance/seedance/v1.5/pro/image-to-video';
  const headers = { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' };

  // Seedance は 5s / 10s のみサポート
  const duration = clipDuration > 5 ? '10' : '5';

  // Submit
  const submitRes = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ image_url: imageUrl, prompt, duration, aspect_ratio: '9:16', resolution: '1080p' }),
  });
  if (!submitRes.ok) {
    const body = await submitRes.text();
    throw new Error(`Seedance submit 失敗 ${submitRes.status}: ${body}`);
  }
  const submitData = await submitRes.json();
  const requestId  = submitData.request_id;
  // fal.ai が返す URL をそのまま使用（手動構築しない）
  const statusUrl  = submitData.status_url  ?? `https://queue.fal.run/${model}/requests/${requestId}/status`;
  const resultUrl  = submitData.response_url ?? `https://queue.fal.run/${model}/requests/${requestId}`;

  // Poll（最大 20 分）
  const deadline = Date.now() + 20 * 60 * 1000;
  while (true) {
    if (Date.now() > deadline) throw new Error('Seedance タイムアウト（20分超過）');
    await sleep(5000);
    try {
      const st = await fetch(statusUrl, { headers });
      if (!st.ok) continue;
      const s = await st.json();
      const status = s.status ?? s.state;
      if (status === 'FAILED') throw new Error(`Seedance 失敗: ${JSON.stringify(s)}`);
      if (status === 'COMPLETED') break;
    } catch (e) {
      if ((e.message ?? '').includes('Seedance 失敗')) throw e;
      // ネットワークエラー → リトライ
    }
  }

  // Result
  const rr = await fetch(resultUrl, { headers });
  if (!rr.ok) throw new Error(`Seedance result 取得失敗 ${rr.status}`);
  const result   = await rr.json();
  const videoUrl = result?.video?.url ?? result?.url;
  if (!videoUrl) throw new Error(`Seedance 結果 URL なし: ${JSON.stringify(result)}`);
  return videoUrl;
}

// ─── モーションプロンプト生成（Claude Vision） ───────────────────────────────

async function generateMotionPrompt(clip, title, framePath, verbose) {
  const fallback = `${title} held in hand against white background, person's hand gently holding product, subtle camera drift, photorealistic, cinematic`;
  const apiKey   = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return fallback;

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const imgBuf = readFileSync(framePath);
    const b64    = imgBuf.toString('base64');
    const isPng  = imgBuf[0] === 0x89 && imgBuf[1] === 0x50;
    const mime   = isPng ? 'image/png' : 'image/jpeg';

    const msg = await client.messages.create({
      model: process.env.CLAUDE_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
          // 商品の形状・種類を一切描写させず、カメラと手の動きだけに限定
          { type: 'text', text: `Describe ONLY the camera angle and hand gesture in this frame. Do NOT mention any product name, shape, or type. Use 8 words max. Examples: "hand holding object, slow zoom in", "close-up hand grip, slight tilt", "two hands displaying object, static shot". English only.` },
        ],
      }],
    });

    const motion = msg.content[0]?.text?.trim();
    if (motion && motion.length > 5) {
      // 商品名を先頭に明示 + 元商品（タンブラー等）を否定
      return `${title}, ${motion}, photorealistic, cinematic lighting, no tumbler, no bottle, no cup`;
    }
  } catch (e) {
    if (verbose) console.warn(`  モーションプロンプト生成スキップ: ${e.message}`);
  }
  return fallback;
}

// ─── ポストアセンブリ ──────────────────────────────────────────────────────

async function runPostAssembly(finalPath, title, workDir, outputDir, videosDir, state, statePath) {
  const assembledPath = join(videosDir, 'final_assembled.mp4');

  try {
    // Step 1: ナレーションスクリプト生成
    let script = `${title}です。疲れた首や肩に最適。振動と熱で深部までほぐします。コンパクトで持ち運び便利。今すぐ下のリンクからチェックしてみて。`;
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (apiKey) {
      try {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey });
        const msg = await client.messages.create({
          model: process.env.CLAUDE_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          messages: [{
            role: 'user',
            content: `以下の商品の TikTok 動画用ナレーション原稿を80文字以内の日本語で1文で書いてください。CTA「今すぐ下のリンクからチェックしてみて」で締めてください。商品名: ${title}\n原稿のみ返してください（説明不要）。`,
          }],
        });
        const candidate = msg.content[0]?.text?.trim();
        if (candidate && candidate.length >= 20 && candidate.length <= 120) {
          script = candidate;
          console.log(`  ナレーション: ${script}`);
        }
      } catch (e) {
        console.warn(`  ナレーション生成スキップ（API エラー）: ${e.message}`);
      }
    }

    // Step 2: TTS（with-timestamps でナレーションと字幕を同期）
    const mp3Path = join(workDir, 'narration.mp3');
    let hasAudio = false;
    let subtitleChunks = []; // { text, t0, t1 }[]

    const ttsProvider = process.env.TTS_PROVIDER ?? 'say';
    if (ttsProvider === 'elevenlabs') {
      const elKey   = process.env.ELEVENLABS_API_KEY?.trim();
      const voiceId = process.env.ELEVENLABS_VOICE?.trim() ?? '4sirbXwrtRlmPV80MJkQ';
      if (!elKey) {
        console.warn('  ELEVENLABS_API_KEY 未設定 → TTS スキップ');
      } else {
        try {
          console.log(`  ElevenLabs TTS (voice: ${voiceId})...`);
          const elRes = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
            {
              method: 'POST',
              headers: { 'xi-api-key': elKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: script,
                model_id: 'eleven_v3',
                voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
              }),
            }
          );
          if (!elRes.ok) {
            const errBody = await elRes.text();
            throw new Error(`ElevenLabs API ${elRes.status}: ${errBody}`);
          }
          const tsJson = await elRes.json();
          const audioBuffer = Buffer.from(tsJson.audio_base64, 'base64');
          writeFileSync(mp3Path, audioBuffer);
          const outMp3Path = join(videosDir, 'narration.mp3');
          writeFileSync(outMp3Path, audioBuffer);
          hasAudio = audioBuffer.length > 1000;
          if (state?.meta) { state.meta.apiCalls.elevenlabs += 1; saveState(statePath, state); }
          console.log(`  ✅ ElevenLabs TTS 完了 (${audioBuffer.length} bytes) → ${outMp3Path}`);

          // タイムスタンプから字幕チャンクを生成
          const alignment = tsJson.alignment ?? tsJson.normalized_alignment;
          if (alignment?.characters) {
            subtitleChunks = buildSubtitleChunks(
              alignment.characters,
              alignment.character_start_times_seconds,
              alignment.character_end_times_seconds,
            );
            console.log(`  字幕チャンク: ${subtitleChunks.length}件`);
          }
        } catch (e) {
          console.warn(`  ElevenLabs TTS 失敗 → 音声なし: ${e.message}`);
        }
      }
    } else {
      // macOS say フォールバック
      const aiffPath = join(workDir, 'narration.aiff');
      const sayResult = spawnSync('say', ['-v', 'Kyoko', '-o', aiffPath, script], { stdio: 'pipe' });
      if (sayResult.status === 0 && existsSync(aiffPath)) {
        try {
          spawnOrThrow(FFMPEG, ['-y', '-i', aiffPath, '-ar', '44100', '-ac', '2', '-b:a', '128k', mp3Path]);
          hasAudio = existsSync(mp3Path);
        } catch (e) {
          console.warn(`  音声変換スキップ: ${e.message}`);
        }
      } else {
        console.warn('  say コマンド失敗 → 音声なし');
      }
    }

    // Step 3: 動画の尺を取得
    const totalDur = getDuration(finalPath);
    if (totalDur <= 0) throw new Error('final.mp4 の尺が取得できませんでした');

    // タイムスタンプなしの場合は均等分割にフォールバック
    if (subtitleChunks.length === 0) {
      const segs = script.split(/[、。！？]+/).filter(s => s.trim().length > 0);
      const segDur = totalDur / segs.length;
      subtitleChunks = segs.map((seg, i) => ({
        text: seg.trim(),
        t0: i * segDur,
        t1: (i + 1) * segDur,
      }));
    }

    // Step 4: drawtext フィルタ構築
    // フォント確認
    const hiroFont = '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc';
    const fontFile = existsSync(hiroFont) ? hiroFont : '';

    // ffmpeg drawtext 用テキストエスケープ（spawnSync 経由・シェルなし）
    // オプション区切りは plain `:` を使う（`\:` はオプション値内のリテラルコロン用）
    function escapeDrawtext(str) {
      return str
        .replace(/\\/g, '\\\\')
        .replace(/'/g, '')       // アポストロフィ除去（d'Alba → dAlba）
        .replace(/:/g, '\\:')    // 値内のコロンをエスケープ
        .replace(/%/g, '%%');
    }

    function makeDrawtext(text, { fontsize = 32, fontcolor = 'white', y = 0.62, box = false, boxcolor = 'black@0.5', boxborderw = 10, enable }) {
      const escaped = escapeDrawtext(text);
      const parts = [
        `text='${escaped}'`,
        `fontsize=${fontsize}`,
        `fontcolor=${fontcolor}`,
        `x=(w-text_w)/2`,
        `y=h*${y}`,
        `shadowx=2`,
        `shadowy=2`,
        `shadowcolor=black`,
        ...(box ? [`box=1`, `boxcolor=${boxcolor}`, `boxborderw=${boxborderw}`] : []),
        `enable='${enable}'`,
      ].join(':');
      return fontFile
        ? `drawtext=fontfile='${fontFile}':${parts}`
        : `drawtext=${parts}`;
    }

    // 字幕フィルタ（タイムスタンプ同期）
    const subtitleFilters = subtitleChunks.map(({ text, t0, t1 }) =>
      makeDrawtext(text, { enable: `between(t,${t0.toFixed(3)},${t1.toFixed(3)})` })
    );

    // カラーグレード + 字幕
    const colorGrade = 'eq=brightness=0.03:contrast=1.08:saturation=1.15,colorbalance=rs=0.04:gs=0.02:bs=-0.06:rm=0.02:gm=0.01:bm=-0.04:rh=0.01:gh=0.00:bh=-0.02';
    const vfFilter = [colorGrade, ...subtitleFilters].join(',');

    // BGM ランダム選択（templates/bgm/ から）
    const bgmDir = resolve(__dirname, '../templates/bgm');
    let bgmPath = null;
    try {
      const bgmFiles = readdirSync(bgmDir).filter(f => /\.(mp3|MP3|m4a|M4A|wav|WAV)$/.test(f));
      if (bgmFiles.length > 0) {
        bgmPath = join(bgmDir, bgmFiles[Math.floor(Math.random() * bgmFiles.length)]);
        console.log(`  BGM: ${basename(bgmPath)}`);
      }
    } catch (_) { /* bgm フォルダなければスキップ */ }

    // Step 6: 最終 ffmpeg コマンド
    const ffmpegArgs = ['-y', '-i', finalPath];
    if (hasAudio) ffmpegArgs.push('-i', mp3Path);
    if (bgmPath)  ffmpegArgs.push('-i', bgmPath);

    ffmpegArgs.push(
      '-vf', vfFilter,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'medium',
      '-b:v', '15M',
    );

    if (hasAudio && bgmPath) {
      // ナレーション(input1) + BGM(input2) をミックス: BGM は 15% ボリュームでループ
      const narIdx = 1;
      const bgmIdx = 2;
      ffmpegArgs.push(
        '-filter_complex',
        `[${narIdx}:a]volume=1.0[narr];[${bgmIdx}:a]volume=0.15,aloop=loop=-1:size=2e+09[bgm];[narr][bgm]amix=inputs=2:duration=first[aout]`,
        '-map', '0:v',
        '-map', '[aout]',
        '-c:a', 'aac', '-b:a', '128k', '-shortest',
      );
    } else if (bgmPath && !hasAudio) {
      // BGM のみ（ナレーションなし）
      ffmpegArgs.push(
        '-filter_complex',
        `[1:a]volume=0.15,aloop=loop=-1:size=2e+09[bgm];[bgm]atrim=duration=${totalDur.toFixed(3)}[aout]`,
        '-map', '0:v',
        '-map', '[aout]',
        '-c:a', 'aac', '-b:a', '128k', '-shortest',
      );
    } else if (hasAudio) {
      // ナレーションのみ（BGM なし）
      ffmpegArgs.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
    }

    ffmpegArgs.push(assembledPath);

    spawnOrThrow(FFMPEG, ffmpegArgs);
    const assembledDur = getDuration(assembledPath);
    console.log(`  ✅ ポストアセンブリ完了 → final_assembled.mp4 (${assembledDur.toFixed(2)}秒)`);

  } catch (err) {
    console.warn(`  ⚠️  ポストアセンブリエラー（フォールバック: final.mp4 をコピー）: ${err.message}`);
    try {
      copyFileSync(finalPath, assembledPath);
      console.log(`  フォールバック完了 → final_assembled.mp4`);
    } catch (copyErr) {
      console.warn(`  フォールバックコピー失敗: ${copyErr.message}`);
    }
  }
}

// ─── 商品画像を 1080×1920 に整形（Seedance 入力用） ────────────────────────────
// テンプレートフレームへの合成は行わず、商品画像をそのまま縦型にリサイズして
// Seedance に渡す。これにより正確な商品が動画に映ることを保証する。

async function compositeProduct(framePath, productPath, zone, outPath, category = 'hook') {
  // 家での撮影感を出すウォームベージュ背景（室内自然光のような温かみ）
  // テンプレートフレームの色を参考にしつつ、ウォームトーンに補正
  const { dominant } = await sharp(framePath)
    .resize(1, 1)
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data }) => ({ dominant: { r: data[0], g: data[1], b: data[2] } }));

  // ウォームベージュ: 明るすぎず暗すぎない室内撮影風の背景色
  const bg = {
    r: Math.min(255, Math.round(dominant.r * 0.4 + 248 * 0.6 + 8)),
    g: Math.min(255, Math.round(dominant.g * 0.4 + 243 * 0.6 + 3)),
    b: Math.min(255, Math.round(dominant.b * 0.4 + 228 * 0.6 - 8)),
  };

  if (category === 'hook') {
    // HOOK: cover でフレーム全体に商品を広げ、-2°傾きで手ブレ感（ウォーム背景がコーナーに出る）
    await sharp(productPath)
      .resize(TARGET_W, TARGET_H, { fit: 'cover', position: 'centre' })
      .rotate(-2, { background: bg })  // 傾き → コーナーにウォーム背景が自然に出る
      .resize(TARGET_W, TARGET_H, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 95 })
      .toFile(outPath);

  } else if (category === 'show') {
    // SHOW: 80%サイズ・上寄り配置・+1°傾き — 商品を手で持って見せるミディアムショット
    const prodW   = Math.round(TARGET_W * 0.80);
    const prodH   = Math.round(TARGET_H * 0.80);
    const padLeft = Math.round((TARGET_W - prodW) / 2);
    const padTop  = Math.round(TARGET_H * 0.06);
    const padBot  = TARGET_H - prodH - padTop;
    const padRight = TARGET_W - prodW - padLeft;

    await sharp(productPath)
      .resize(prodW, prodH, { fit: 'contain', background: bg })
      .extend({ top: padTop, bottom: padBot, left: padLeft, right: padRight, background: bg })
      .rotate(1, { background: bg })  // +1°微傾き
      .resize(TARGET_W, TARGET_H, { fit: 'cover' })
      .jpeg({ quality: 95 })
      .toFile(outPath);

  } else {
    // CLOSE: 90%サイズ・下寄り + +3°傾き — 手で持って見せているリアルな家撮り感
    const prodW   = Math.round(TARGET_W * 0.90);
    const prodH   = Math.round(TARGET_H * 0.90);
    const padLeft = Math.round((TARGET_W - prodW) / 2);
    const padTop  = Math.round(TARGET_H * 0.10);
    const padBot  = TARGET_H - prodH - padTop;
    const padRight = TARGET_W - prodW - padLeft;

    await sharp(productPath)
      .resize(prodW, prodH, { fit: 'contain', background: bg })
      .extend({ top: padTop, bottom: padBot, left: padLeft, right: padRight, background: bg })
      .rotate(3, { background: bg })   // +3°傾き（手持ち感）
      .resize(TARGET_W, TARGET_H, { fit: 'cover' })
      .jpeg({ quality: 95 })
      .toFile(outPath);
  }
}

// ─── nano-banana-2 edit ──────────────────────────────────────────────────────

async function runNanoBanana({ imageUrl, maskUrl, prompt, label }) {
  const model = process.env.NANO_BANANA_EDIT_ENDPOINT ?? 'fal-ai/nano-banana-2/edit';

  // まず submit して API が受け付けるパラメータを確認
  const headers = { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' };
  const submitRes = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ image_urls: [imageUrl], mask_image_url: maskUrl, prompt }),
  });
  if (!submitRes.ok) {
    const body = await submitRes.text();
    throw new Error(`nano-banana submit 失敗 ${submitRes.status}: ${body}`);
  }
  const submitData = await submitRes.json();
  const requestId = submitData.request_id;
  const statusUrl = submitData.status_url  ?? `https://queue.fal.run/${model}/requests/${requestId}/status`;
  const resultUrl = submitData.response_url ?? `https://queue.fal.run/${model}/requests/${requestId}`;

  // Poll（最大 10 分）
  const deadline = Date.now() + 10 * 60 * 1000;
  while (true) {
    if (Date.now() > deadline) throw new Error(`nano-banana タイムアウト: ${label}`);
    await sleep(3000);
    try {
      const st = await fetch(statusUrl, { headers });
      if (!st.ok) continue;
      const s = await st.json();
      const status = s.status ?? s.state;
      if (status === 'FAILED') throw new Error(`nano-banana 失敗: ${JSON.stringify(s)}`);
      if (status === 'COMPLETED') break;
    } catch (e) {
      if ((e.message ?? '').includes('nano-banana 失敗')) throw e;
    }
  }

  // Result
  const rr = await fetch(resultUrl, { headers });
  if (!rr.ok) {
    const body = await rr.text();
    throw new Error(`nano-banana result 取得失敗 ${rr.status}: ${body.slice(0, 300)}`);
  }
  const result = await rr.json();
  const url = result?.images?.[0]?.url
    ?? result?.image?.url
    ?? result?.output?.images?.[0]?.url
    ?? result?.data?.images?.[0]?.url;
  if (!url) throw new Error(`nano-banana URL なし: ${label} — ${JSON.stringify(result).slice(0, 300)}`);
  return url;
}

// ─── 画像品質チェック（Claude Vision） ───────────────────────────────────────

async function checkImageQuality(imagePath, title) {
  const noCheck = { pass: true, score: 7, reason: 'チェックスキップ' };
  const apiKey  = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return noCheck;

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const imgBuf  = readFileSync(imagePath);
    const b64     = imgBuf.toString('base64');
    // PNG シグネチャ: 0x89 0x50 0x4E 0x47
    const isPng   = imgBuf[0] === 0x89 && imgBuf[1] === 0x50;
    const mimeType = isPng ? 'image/png' : 'image/jpeg';

    const msg = await client.messages.create({
      model: process.env.CLAUDE_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: b64 } },
          { type: 'text', text: `Quality check. The product in this image should be: "${title}". Score 1-10 based only on: (1) Is a clear product visible? (2) Does it look like a real photo (not AI hallucination)? (3) Is the image sharp and natural? Do NOT judge by product category name—just assess visual quality and realism. Reply JSON only: {"score":N,"pass":boolean,"reason":"<15 words"}. pass=true if score>=6.` },
        ],
      }],
    });

    const raw  = msg.content[0].text.trim();
    const json = raw.match(/\{[\s\S]*?\}/)?.[0] ?? raw;
    const parsed = JSON.parse(json);
    return { pass: !!parsed.pass, score: parsed.score ?? 5, reason: parsed.reason ?? '' };
  } catch (e) {
    console.warn(`  品質チェックエラー（スキップ）: ${e.message}`);
    return noCheck;
  }
}

// ─── ビデオフレーム品質チェック（Claude Vision） ─────────────────────────────

async function checkVideoFrame(framePath) {
  const noCheck = { pass: true, issues: [] };
  const apiKey  = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return noCheck;

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const imgBuf  = readFileSync(framePath);
    const b64     = imgBuf.toString('base64');
    const isPng   = imgBuf[0] === 0x89 && imgBuf[1] === 0x50;
    const mimeType = isPng ? 'image/png' : 'image/jpeg';

    const msg = await client.messages.create({
      model: process.env.CLAUDE_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: b64 } },
          { type: 'text', text: 'Check this product video frame. Reply JSON only: {"pass":boolean,"issues":["..."]}. Fail if: (1) multiple duplicate products visible, (2) extra or deformed hands/arms, (3) product looks completely wrong. Pass if only minor issues.' },
        ],
      }],
    });

    const raw    = msg.content[0].text.trim();
    const json   = raw.match(/\{[\s\S]*?\}/)?.[0] ?? raw;
    const parsed = JSON.parse(json);
    return { pass: !!parsed.pass, issues: parsed.issues ?? [] };
  } catch (e) {
    console.warn(`  ビデオフレームチェックエラー（スキップ）: ${e.message}`);
    return noCheck;
  }
}

// ─── FLUX Pro Fill ───────────────────────────────────────────────────────────

async function runFluxFill({ frameUrl, maskUrl, prompt, seed, label }) {
  const { fal } = await import('@fal-ai/client');
  fal.config({ credentials: FAL_KEY });

  const result = await fal.subscribe(FLUX_MODEL, {
    input: { image_url: frameUrl, mask_url: maskUrl, prompt, seed, num_inference_steps: 28 },
    logs: false,
  });

  const url = result?.data?.images?.[0]?.url ?? result?.images?.[0]?.url;
  if (!url) throw new Error(`FLUX Fill URL なし: ${label}`);
  return url;
}

// ─── フレーム抽出（指定インデックス） ────────────────────────────────────────

function extractFrame(clipPath, outPath, frameIndex, fps) {
  const ts = (frameIndex / fps).toFixed(3);
  spawnOrThrow(FFMPEG, [
    '-y', '-ss', ts, '-i', clipPath,
    '-vf', `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease,pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2:color=black`,
    '-frames:v', '1', '-q:v', '2', outPath,
  ]);
}

// ─── 商品ゾーン検出（Claude Vision） ─────────────────────────────────────────

// Fix 2: 429 レートリミットリトライ付き
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── ゾーン + モーション同時検出 ─────────────────────────────────────────────
// 3フレーム（序盤・中盤・終盤）を1回のClaude呼び出しで分析し、
// ゾーン（中間フレーム基準）とカメラモーション（フレーム間変化）を返す

async function detectZoneAndMotion(framePaths, midPath, productTitle, verbose) {
  const DEFAULT_ZONE = { x: 100, y: 200, w: TARGET_W - 200, h: TARGET_H - 400, confidence: 'default' };
  const DEFAULT_MOTION = 'product held in hand, gentle slow movement, camera stable';
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { zone: { ...DEFAULT_ZONE, confidence: 'none' }, motion: DEFAULT_MOTION };

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const imageContent = framePaths.map((p, i) => ([
    { type: 'text', text: i === 0 ? '【序盤フレーム】' : i === 1 ? '【中盤フレーム】' : '【終盤フレーム】' },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: readFileSync(p).toString('base64') } },
  ])).flat();

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      console.log(`  ゾーン+モーション検出リトライ (${attempt}/2) — 20秒待機中...`);
      await sleep(20000);
    }
    try {
      const msg = await client.messages.create({
        model: process.env.CLAUDE_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            ...imageContent,
            { type: 'text', text: `These are 3 frames from a ${TARGET_W}×${TARGET_H} product video (early, middle, late).

Task 1 – From the MIDDLE frame: find the bounding box of the main product (bottle/container/device being showcased, NOT hands/background). Include 5% padding.

Task 2 – Compare all 3 frames to detect the exact camera and subject motion:
- Does the camera zoom in, zoom out, or stay at same distance?
- Does the camera pan left or right?
- Does the camera tilt up or down?
- Does the product rotate/spin?
- Is there hand/wrist movement direction?
Describe the motion precisely in 1 English sentence suitable for a video generation prompt.

Reply ONLY with JSON (no other text):
{"zone":{"x":int,"y":int,"w":int,"h":int,"confidence":"high"|"low"|"none"},"motion":"exact motion description"}` },
          ],
        }],
      });

      const raw  = msg.content[0].text.trim();
      const json = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
      const parsed = JSON.parse(json);

      // zone の処理
      let zone = DEFAULT_ZONE;
      if (parsed.zone && parsed.zone.confidence !== 'none' && parsed.zone.w > 20 && parsed.zone.h > 20) {
        const z = parsed.zone;
        const pad = 0.10;
        zone = {
          x:          Math.max(0, Math.round(z.x - z.w * pad)),
          y:          Math.max(0, Math.round(z.y - z.h * pad)),
          w:          Math.min(TARGET_W, Math.round(z.w * (1 + 2 * pad))),
          h:          Math.min(TARGET_H, Math.round(z.h * (1 + 2 * pad))),
          confidence: z.confidence ?? 'high',
        };
      } else if (parsed.zone?.confidence === 'none') {
        zone = { ...DEFAULT_ZONE, confidence: 'none' };
      }

      const motion = (parsed.motion && parsed.motion.length > 5) ? parsed.motion : DEFAULT_MOTION;
      return { zone, motion };

    } catch (err) {
      lastError = err;
      const is429 = err.status === 429 || (err.message ?? '').includes('rate_limit');
      if (!is429) break;
    }
  }

  console.warn(`  ゾーン+モーション検出失敗（デフォルト使用）: ${lastError?.message}`);
  return { zone: DEFAULT_ZONE, motion: DEFAULT_MOTION };
}

async function detectProductZone(framePath, productTitle, verbose) {
  const DEFAULT = { x: 100, y: 200, w: TARGET_W - 200, h: TARGET_H - 400, confidence: 'default' };
  const apiKey  = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ...DEFAULT, confidence: 'none' };

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const b64    = readFileSync(framePath).toString('base64');

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Fix 2: リトライ前の待機（初回はスキップ）
      if (attempt > 0) {
        console.log(`  ゾーン検出リトライ (${attempt}/2) — 20秒待機中...`);
        await sleep(20000);
      }

      // Fix 3: プロンプト改善（製品全体のバウンディングボックス + 5% パディング）
      const msg = await client.messages.create({
        model: process.env.CLAUDE_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
            { type: 'text', text: `This is a ${TARGET_W}×${TARGET_H} image from a product video. Find the ENTIRE main product object (bottle, tumbler, container, or any product being showcased — NOT hands/background). Include 5% padding around the product in the bounding box. If no clear product is visible, reply: {"confidence":"none"}. Otherwise reply ONLY with JSON: {"x":int,"y":int,"w":int,"h":int,"confidence":"high"|"low"} bounding box in pixels. No other text.` },
          ],
        }],
      });

      try {
        const raw  = msg.content[0].text.trim();
        const json = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
        const zone = JSON.parse(json);
        if (zone.confidence === 'none') return { ...DEFAULT, confidence: 'none' };
        if (!zone.w || !zone.h || zone.w < 20 || zone.h < 20) return DEFAULT;

        // Fix 3: さらに 10% パディングを適用
        const pad = 0.10;
        zone.x = Math.max(0, Math.round(zone.x - zone.w * pad));
        zone.y = Math.max(0, Math.round(zone.y - zone.h * pad));
        zone.w = Math.min(TARGET_W - zone.x, Math.round(zone.w * (1 + 2 * pad)));
        zone.h = Math.min(TARGET_H - zone.y, Math.round(zone.h * (1 + 2 * pad)));

        return { x: zone.x, y: zone.y, w: zone.w, h: zone.h, confidence: zone.confidence ?? 'high' };
      } catch {
        return DEFAULT;
      }
    } catch (err) {
      lastError = err;
      // Fix 2: 429 レートリミットのみリトライ
      const is429 = err.status === 429 || (err.message ?? '').includes('rate_limit');
      if (!is429) break;
      // attempt < 2 なら次のループでリトライ
    }
  }

  // 3回失敗 or 非429エラー
  console.warn(`  ゾーン検出失敗（デフォルトゾーン使用）: ${lastError?.message}`);
  return DEFAULT;
}

// ─── マスク生成 ──────────────────────────────────────────────────────────────

async function createMask(zone, outPath) {
  const zx = Math.max(0, zone.x);
  const zy = Math.max(0, zone.y);
  const zw = Math.min(zone.w, TARGET_W - zx);
  const zh = Math.min(zone.h, TARGET_H - zy);

  await sharp({ create: { width: TARGET_W, height: TARGET_H, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{
      input: { create: { width: zw, height: zh, channels: 3, background: { r: 255, g: 255, b: 255 } } },
      left: zx, top: zy,
    }])
    .png()
    .toFile(outPath);
}

// ─── 並列実行（concurrency 制限） ────────────────────────────────────────────

async function runWithConcurrency(items, limit, fn) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i    = idx++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ─── ElevenLabs タイムスタンプ → 字幕チャンク ────────────────────────────────
// 句読点か最大文字数でフレーズを区切り、各フレーズの音声タイミングを返す

function buildSubtitleChunks(chars, startTimes, endTimes, maxChars = 10) {
  const chunks = [];
  let text = '';
  let t0 = null;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (t0 === null) t0 = startTimes[i];
    text += ch;

    const isPunct = '、。！？!?\n'.includes(ch);
    const isLong  = text.trim().length >= maxChars;
    const isLast  = i === chars.length - 1;

    if ((isPunct || isLong || isLast) && text.trim().length > 0) {
      chunks.push({ text: text.trim(), t0, t1: endTimes[i] });
      text = '';
      t0   = null;
    }
  }
  return chunks;
}

// ─── fal.ai アップロード ──────────────────────────────────────────────────────

async function uploadFile(filePath, mimeType) {
  const buf = readFileSync(filePath);
  const ext = filePath.split('.').pop();
  const filename = `file.${ext}`;

  // fal.ai storage upload via raw HTTP (avoids @fal-ai/client DNS issues)
  const initRes = await fetch('https://rest.fal.ai/storage/upload/initiate', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file_name: filename, content_type: mimeType }),
  });
  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`fal.ai upload initiate failed ${initRes.status}: ${text}`);
  }
  const { upload_url, file_url } = await initRes.json();

  // PUT to pre-signed URL
  const putRes = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: buf,
  });
  if (!putRes.ok) throw new Error(`fal.ai upload PUT failed ${putRes.status}`);

  return file_url;
}

// ─── ダウンロード ────────────────────────────────────────────────────────────

async function downloadFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ダウンロード失敗 ${res.status}: ${url}`);
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

// ─── ユーティリティ ──────────────────────────────────────────────────────────

function getVideoInfo(filePath) {
  const r = spawnSync(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=r_frame_rate,nb_frames',
    '-of', 'csv=p=0', filePath,
  ], { encoding: 'utf8' });
  const [rateStr, nbStr] = r.stdout.trim().split(',');
  const [num, den] = rateStr.split('/').map(Number);
  const fps        = den ? num / den : 30;
  const frameCount = parseInt(nbStr) || Math.round(fps * getDuration(filePath));
  return { fps, frameCount };
}

function getDuration(filePath) {
  const r = spawnSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ], { encoding: 'utf8' });
  return parseFloat(r.stdout?.trim()) || 0;
}

function spawnOrThrow(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'pipe' });
  if (r.status !== 0) throw new Error(`${basename(cmd)} 失敗:\n${r.stderr?.toString().slice(-400)}`);
  return r;
}

function loadState(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

function saveState(path, state) {
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
}

// ─── コスト推定 ──────────────────────────────────────────────────────────────
// fal.ai 公式価格: FLUX Pro Fill $0.05/img, Seedance Pro 5s $0.09/call
// Claude Haiku: $0.80/M input + $4.00/M output → ゾーン検出1回 ≈ $0.001
// ElevenLabs v3: 有料プランで月額固定 → 参考値 $0.30/1000chars
function estimateCost(apiCalls) {
  const usd =
    (apiCalls.nanoBanana  ?? 0) * 0.05 +
    (apiCalls.fluxFill    ?? 0) * 0.05 +
    (apiCalls.seedance    ?? 0) * 0.09 +
    (apiCalls.claudeVision ?? 0) * 0.001 +
    (apiCalls.elevenlabs  ?? 0) * 0.03;
  const jpy = Math.round(usd * 150);
  return { usd: usd.toFixed(3), jpy };
}
