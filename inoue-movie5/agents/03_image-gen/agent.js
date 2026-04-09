import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import sharp from 'sharp';
import { validate, ImageVariantsSchema } from '../../lib/validate-json.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config.js';

const TARGET_W = 1080;
const TARGET_H = 1920;

// ─── 背景色パレット（白スタジオ排除・スマホ撮影感のある自然な背景） ──────────────
const BG = {
  warmCream:  { r: 242, g: 232, b: 215 },  // 温かみのあるクリーム（木の机）
  lightCream: { r: 248, g: 244, b: 236 },  // 明るめのクリーム（明るい部屋）
  softGray:   { r: 228, g: 224, b: 218 },  // ニュートラルグレー（コンクリ・大理石調）
  darkWood:   { r: 52,  g: 44,  b: 36  },  // 暗い木目調（scene用・ライフスタイル感）
};

// ─── 画角ヒント → 3面図ベースビュー マッピング（v2 angleHints + 旧互換） ────────
const ANGLE_TO_BASE = {
  // v2
  shake_impact:     'front',
  pull_back_reveal: 'perspective',
  dutch_angle:      'front',
  extreme_close:    'perspective',
  overhead_flatlay: 'perspective',
  hand_hold_pov:    'front',
  orbit:            'side',
  hero_low_angle:   'front',
  lifestyle_scene:  'perspective',
  split_comparison: 'front',
  // 旧互換
  wide:             'front',
  close:            'perspective',
  front:            'front',
  angle:            'side',
  scene:            'perspective',
};

/**
 * 1本の動画分の画角画像を生成する
 *
 * Pipeline:
 *   Phase 1: 商品画像 → 3面図（正面・側面・斜め視点）
 *   Phase 2: 各ショットの angleHint に合わせた構図 + スマホ撮影風エフェクト
 *
 * @param {{ jobId, imageGenDir, sourceImagePath, videoShotPlan, verbose }} params
 */
export async function runImageGen({ jobId, imageGenDir, sourceImagePath, videoShotPlan, verbose }) {
  mkdirSync(imageGenDir, { recursive: true });

  const { videoIndex, shots } = videoShotPlan;
  const vStr = String(videoIndex).padStart(2, '0');
  const variants = [];

  if (config.IMAGE_GEN_PROVIDER === 'fal') {
    return runFluxFillImageGen({ jobId, imageGenDir, sourceImagePath, videoShotPlan, verbose });
  }

  if (config.IMAGE_GEN_PROVIDER !== 'sharp') {
    throw new Error(`IMAGE_GEN_PROVIDER "${config.IMAGE_GEN_PROVIDER}" は未実装です`);
  }

  // ─── Phase 1: 3面図を生成 ──────────────────────────────────────────────────
  if (verbose) logger.info(`video-${videoIndex}: Phase 1 — 3面図生成`);
  const threeViews = await generate3Views(sourceImagePath, imageGenDir, vStr, verbose);
  logger.success(`video-${videoIndex}: 3面図生成完了 → ${vStr}-3view-composite.jpg`);

  // ─── Phase 2: 各ショットの画角画像を生成 ───────────────────────────────────
  if (verbose) logger.info(`video-${videoIndex}: Phase 2 — 画角別スマホ撮影風画像生成`);

  for (const shot of shots) {
    const { index: shotIndex, angleHint } = shot;
    const filename = `${vStr}-angle-${String(shotIndex).padStart(2, '0')}.jpg`;
    const outputPath = join(imageGenDir, filename);

    const baseKey = ANGLE_TO_BASE[angleHint] ?? 'front';
    const baseImagePath = threeViews[baseKey];

    await generateAngleShot(baseImagePath, outputPath, angleHint, videoIndex, shotIndex);

    if (verbose) {
      logger.info(`  [${vStr}] shot-${shotIndex} [${angleHint}] ← 3view-${baseKey} → ${filename}`);
    }

    variants.push({ videoIndex, shotIndex, imagePath: outputPath, angleLabel: angleHint });
  }

  const output = validate(ImageVariantsSchema, { jobId, videoIndex, variants });
  writeFileSync(
    join(imageGenDir, `${vStr}-image-variants.json`),
    JSON.stringify(output, null, 2),
    'utf8',
  );

  logger.success(`video-${videoIndex}: ${variants.length}枚のスマホ撮影風画像生成完了`);
  return output;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 1: 3面図の生成
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 商品画像から3面図（正面・側面・斜め視点）を生成する
 * → 各ビューはスマホ撮影の「ベース素材」として使用される
 */
async function generate3Views(src, dir, vStr, verbose) {
  const frontPath = join(dir, `${vStr}-3view-front.jpg`);
  const sidePath  = join(dir, `${vStr}-3view-side.jpg`);
  const perspPath = join(dir, `${vStr}-3view-perspective.jpg`);

  await Promise.all([
    generateFrontView(src, frontPath),
    generateSideView(src, sidePath),
    generatePerspectiveView(src, perspPath),
  ]);

  // 確認用コンポジット（3面を横並びで1枚にまとめる）
  await create3ViewComposite(frontPath, sidePath, perspPath, join(dir, `${vStr}-3view-composite.jpg`));

  return { front: frontPath, side: sidePath, perspective: perspPath };
}

/** 正面ビュー: 商品を画面の90%に収める、温かみのあるクリーム背景 */
async function generateFrontView(src, dest) {
  const resizeW = Math.round(TARGET_W * 0.90);
  const resizeH = Math.round(TARGET_H * 0.90);
  const padV = Math.round((TARGET_H - resizeH) / 2);
  const padH = Math.round((TARGET_W - resizeW) / 2);

  await sharp(src)
    .resize(resizeW, resizeH, { fit: 'contain', background: BG.warmCream })
    .extend({ top: padV, bottom: padV, left: padH, right: padH, background: BG.warmCream })
    .resize(TARGET_W, TARGET_H, { fit: 'cover' })
    .jpeg({ quality: 95 })
    .toFile(dest);
}

/**
 * 側面ビュー: 商品を左寄りに配置して右に空間を作る（横からの視点を擬似再現）
 * 水平方向の空白 = カメラがわずかに右にずれた位置から撮っている感
 */
async function generateSideView(src, dest) {
  const resizeW = Math.round(TARGET_W * 0.72);
  const resizeH = Math.round(TARGET_H * 0.80);
  const padTop  = Math.round(TARGET_H * 0.10);
  const padBot  = TARGET_H - resizeH - padTop;
  const padLeft = Math.round(TARGET_W * 0.06);
  const padRight = TARGET_W - resizeW - padLeft;

  await sharp(src)
    .resize(resizeW, resizeH, { fit: 'contain', background: BG.lightCream })
    .extend({ top: padTop, bottom: padBot, left: padLeft, right: padRight, background: BG.lightCream })
    .resize(TARGET_W, TARGET_H, { fit: 'cover' })
    .jpeg({ quality: 95 })
    .toFile(dest);
}

/**
 * 斜め視点ビュー: 商品を上寄りに配置（やや上から俯瞰しているアングルを再現）
 * 上の余白を少なく、下の余白を多くする = カメラが少し上から撮っている感
 */
async function generatePerspectiveView(src, dest) {
  const resizeW = Math.round(TARGET_W * 0.82);
  const resizeH = Math.round(TARGET_H * 0.80);
  const padTop   = Math.round(TARGET_H * 0.06);
  const padBot   = TARGET_H - resizeH - padTop;
  const padH     = Math.round((TARGET_W - resizeW) / 2);

  await sharp(src)
    .resize(resizeW, resizeH, { fit: 'contain', background: BG.softGray })
    .extend({ top: padTop, bottom: padBot, left: padH, right: padH, background: BG.softGray })
    .resize(TARGET_W, TARGET_H, { fit: 'cover' })
    .jpeg({ quality: 95 })
    .toFile(dest);
}

/** 3面図の確認用コンポジット（横3分割レイアウト） */
async function create3ViewComposite(frontPath, sidePath, perspPath, outputPath) {
  const panelW = Math.round(TARGET_W / 3);
  const panelH = Math.round(panelW * (TARGET_H / TARGET_W));  // 縦横比維持

  const [f, s, p] = await Promise.all([
    sharp(frontPath).resize(panelW, panelH, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer(),
    sharp(sidePath ).resize(panelW, panelH, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer(),
    sharp(perspPath).resize(panelW, panelH, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer(),
  ]);

  await sharp({
    create: { width: TARGET_W, height: panelH, channels: 3, background: BG.warmCream },
  })
    .composite([
      { input: f, left: 0,              top: 0 },
      { input: s, left: panelW,         top: 0 },
      { input: p, left: panelW * 2,     top: 0 },
    ])
    .jpeg({ quality: 85 })
    .toFile(outputPath);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2: 画角ショット生成 + スマホ撮影風仕上げ
// ═══════════════════════════════════════════════════════════════════════════════

async function generateAngleShot(baseImagePath, outputPath, angleHint, videoIndex, shotIndex) {
  const composedBuf = await composeAngle(baseImagePath, angleHint, shotIndex);
  await applyPhonePhotoLook(composedBuf, outputPath, angleHint, videoIndex, shotIndex);
}

/**
 * angleHint に応じた構図を適用する（クロップ・レイアウト）
 * → バッファを返す（ファイル書き出しは applyPhonePhotoLook が行う）
 */
async function composeAngle(baseImagePath, angleHint, shotIndex) {
  const meta = await sharp(baseImagePath).metadata();
  const { width: bw, height: bh } = meta;

  switch (angleHint) {
    // ── v2 angleHints ──────────────────────────────────────────────────────────

    case 'shake_impact': {
      // 落下・衝撃: 商品を上寄りに大きく配置（持ち上げた瞬間を演出）
      const cropH = Math.round(bh * 0.82);
      return sharp(baseImagePath)
        .extract({ left: 0, top: 0, width: bw, height: Math.min(cropH, bh) })
        .resize(TARGET_W, TARGET_H, { fit: 'cover' })
        .modulate({ brightness: 1.06, saturation: 1.08 })
        .jpeg({ quality: 93 })
        .toBuffer();
    }

    case 'pull_back_reveal': {
      // 超接写: 中央40%を非常に狭くクロップ（テクスチャ・ロゴ部分）
      const cropW = Math.round(bw * 0.40);
      const cropH = Math.round(bh * 0.36);
      const left  = Math.round((bw - cropW) / 2);
      const top   = Math.max(0, Math.round(bh * 0.18));
      return sharp(baseImagePath)
        .extract({ left, top, width: cropW, height: Math.min(cropH, bh - top) })
        .resize(TARGET_W, TARGET_H, { fit: 'cover' })
        .jpeg({ quality: 93 })
        .toBuffer();
    }

    case 'dutch_angle': {
      // 傾いた構図: -18°回転で斜めの緊張感
      return sharp(baseImagePath)
        .rotate(-18, { background: BG.warmCream })
        .resize(TARGET_W, TARGET_H, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: 93 })
        .toBuffer();
    }

    case 'extreme_close': {
      // 超接写（テクスチャ）: 斜め視点ベースの35%クロップ
      const cropW = Math.round(bw * 0.35);
      const cropH = Math.round(bh * 0.38);
      const left  = Math.round((bw - cropW) / 2);
      const top   = Math.max(0, Math.round(bh * 0.22));
      return sharp(baseImagePath)
        .extract({ left, top, width: cropW, height: Math.min(cropH, bh - top) })
        .resize(TARGET_W, TARGET_H, { fit: 'cover' })
        .modulate({ saturation: 1.12 })
        .jpeg({ quality: 95 })
        .toBuffer();
    }

    case 'overhead_flatlay': {
      // 真上からの俯瞰: 斜め視点ベース + 上部を多くカット + 明るく
      const topCut = Math.round(bh * 0.25);
      const cropH  = bh - topCut;
      return sharp(baseImagePath)
        .extract({ left: 0, top: topCut, width: bw, height: Math.min(cropH, bh - topCut) })
        .resize(TARGET_W, TARGET_H, { fit: 'cover' })
        .modulate({ brightness: 1.08 })
        .jpeg({ quality: 93 })
        .toBuffer();
    }

    case 'hand_hold_pov': {
      // 一人称視点: 正面ビューを下部中心にクロップ（手が伸びてくる感）
      const cropW = Math.round(bw * 0.88);
      const cropH = Math.round(bh * 0.82);
      const left  = Math.round((bw - cropW) / 2);
      const top   = Math.round(bh * 0.10);
      return sharp(baseImagePath)
        .extract({ left, top, width: cropW, height: Math.min(cropH, bh - top) })
        .resize(TARGET_W, TARGET_H, { fit: 'cover' })
        .modulate({ brightness: 1.03 })
        .jpeg({ quality: 93 })
        .toBuffer();
    }

    case 'orbit': {
      // 側面45°: 側面ビューをそのまま（軽くシフト）
      const offsetX = Math.round(bw * 0.05);
      return sharp(baseImagePath)
        .extract({ left: offsetX, top: 0, width: bw - offsetX, height: bh })
        .resize(TARGET_W, TARGET_H, { fit: 'cover' })
        .jpeg({ quality: 93 })
        .toBuffer();
    }

    case 'hero_low_angle': {
      // ローアングル: 商品を下から見上げる → 下部50%をクロップして縦伸ばし
      const topCut = Math.round(bh * 0.50);
      const cropH  = bh - topCut;
      return sharp(baseImagePath)
        .extract({ left: 0, top: topCut, width: bw, height: Math.min(cropH, bh - topCut) })
        .resize(TARGET_W, TARGET_H, { fit: 'cover' })
        .modulate({ brightness: 1.05, saturation: 1.10 })
        .jpeg({ quality: 93 })
        .toBuffer();
    }

    case 'lifestyle_scene': {
      // 使用シーン: 暗い木目背景でライフスタイル感（旧 scene と同じ）
      const topCut = Math.round(bh * 0.18);
      const cropH  = bh - topCut;
      const resizeW = Math.round(TARGET_W * 0.76);
      const resizeH = Math.round(TARGET_H * 0.66);
      const padTop  = Math.round(TARGET_H * 0.09);
      const padBot  = TARGET_H - resizeH - padTop;
      const padH    = Math.round((TARGET_W - resizeW) / 2);
      return sharp(baseImagePath)
        .extract({ left: 0, top: topCut, width: bw, height: Math.min(cropH, bh - topCut) })
        .resize(resizeW, resizeH, { fit: 'contain', background: BG.darkWood })
        .extend({ top: padTop, bottom: padBot, left: padH, right: padH, background: BG.darkWood })
        .resize(TARGET_W, TARGET_H, { fit: 'cover' })
        .jpeg({ quality: 93 })
        .toBuffer();
    }

    case 'split_comparison': {
      // ビフォーアフター: 左半分に商品配置
      const halfW  = Math.round(TARGET_W / 2);
      const resizeH = Math.round(bh * (halfW / bw));
      const padTop  = Math.round((TARGET_H - Math.min(resizeH, TARGET_H)) / 2);
      return sharp(baseImagePath)
        .resize(halfW, TARGET_H, { fit: 'contain', background: BG.lightCream })
        .extend({ left: 0, right: halfW, top: 0, bottom: 0, background: BG.softGray })
        .resize(TARGET_W, TARGET_H, { fit: 'cover' })
        .jpeg({ quality: 93 })
        .toBuffer();
    }

    // ── 旧互換 angleHints ────────────────────────────────────────────────────

    case 'wide': {
      return sharp(baseImagePath)
        .resize(TARGET_W, TARGET_H, { fit: 'cover' })
        .jpeg({ quality: 93 })
        .toBuffer();
    }

    case 'close': {
      const cropW = Math.round(bw * 0.55);
      const cropH = Math.round(bh * 0.52);
      const left  = Math.round((bw - cropW) / 2);
      const top   = Math.max(0, Math.round(bh * 0.14));
      return sharp(baseImagePath)
        .extract({ left, top, width: cropW, height: Math.min(cropH, bh - top) })
        .resize(TARGET_W, TARGET_H, { fit: 'cover' })
        .jpeg({ quality: 93 })
        .toBuffer();
    }

    case 'front': {
      return sharp(baseImagePath)
        .resize(TARGET_W, TARGET_H, { fit: 'cover' })
        .modulate({ brightness: 1.04 })
        .jpeg({ quality: 93 })
        .toBuffer();
    }

    case 'angle': {
      const shiftRight = shotIndex % 2 === 0;
      const offsetX = shiftRight ? Math.round(bw * 0.08) : 0;
      const cropW   = bw - Math.round(bw * 0.08);
      return sharp(baseImagePath)
        .extract({ left: offsetX, top: 0, width: Math.min(cropW, bw - offsetX), height: bh })
        .resize(TARGET_W, TARGET_H, { fit: 'cover' })
        .jpeg({ quality: 93 })
        .toBuffer();
    }

    case 'scene': {
      const topCut = Math.round(bh * 0.18);
      const cropH  = bh - topCut;
      const resizeW = Math.round(TARGET_W * 0.76);
      const resizeH = Math.round(TARGET_H * 0.66);
      const padTop  = Math.round(TARGET_H * 0.09);
      const padBot  = TARGET_H - resizeH - padTop;
      const padH    = Math.round((TARGET_W - resizeW) / 2);
      return sharp(baseImagePath)
        .extract({ left: 0, top: topCut, width: bw, height: Math.min(cropH, bh - topCut) })
        .resize(resizeW, resizeH, { fit: 'contain', background: BG.darkWood })
        .extend({ top: padTop, bottom: padBot, left: padH, right: padH, background: BG.darkWood })
        .resize(TARGET_W, TARGET_H, { fit: 'cover' })
        .jpeg({ quality: 93 })
        .toBuffer();
    }

    default: {
      return sharp(baseImagePath)
        .resize(TARGET_W, TARGET_H, { fit: 'cover' })
        .jpeg({ quality: 93 })
        .toBuffer();
    }
  }
}

/**
 * スマホ撮影風エフェクトを適用する
 *
 * 効果:
 *  - 温かみのある色調（スマホカメラ特有の温色バイアス）
 *  - やや高彩度（スマホの画像処理エンジン）
 *  - 自動露出による微妙な明るさ変化
 *  - わずかな手持ち傾き（-1.2° 〜 +1.2°）
 *  - スマホレンズの柔らかさ（軽微なブラー）
 *  - ビネット（周辺光量落ち）
 */
async function applyPhonePhotoLook(inputBuffer, outputPath, angleHint, videoIndex, shotIndex) {
  // 決定論的なバリエーション（videoIndex × shotIndex でシード）
  const seed  = (videoIndex * 13 + shotIndex * 7) % 20;
  const tilt  = ((seed % 5) - 2) * 0.55;              // -1.1° 〜 +1.1°
  const hue   = 5 + (seed % 4);                       // 5〜8度: 温色方向にシフト
  const sat   = 1.10 + (seed % 4) * 0.03;             // 1.10〜1.19: スマホ鮮やかさ
  const bri   = 0.995 + (seed % 6) * 0.008;           // 0.995〜1.04: 自動露出変化

  // scene は暗め・クール系に（ライフスタイル感）
  const isScene = angleHint === 'scene';
  const finalHue = isScene ? -2 : hue;
  const finalSat = isScene ? sat * 0.88 : sat;
  const finalBri = isScene ? bri * 0.82 : bri;

  const bgColor   = isScene ? BG.darkWood : BG.warmCream;
  const vigOpacity = isScene ? 0.50 : 0.30;

  const vignetteSvg = buildVignetteSvg(vigOpacity);

  await sharp(inputBuffer)
    // 手持ち感のある微妙な傾き（背景色で補填）
    .rotate(tilt, { background: bgColor })
    .resize(TARGET_W, TARGET_H, { fit: 'cover', position: 'centre' })
    // スマホカメラ特有の色調：温かみ・高彩度・自動露出
    .modulate({ brightness: finalBri, saturation: finalSat, hue: finalHue })
    // スマホレンズのソフトな描写（ガラス越し感）
    .blur(0.38)
    // 周辺光量落ち（ビネット）
    .composite([{ input: Buffer.from(vignetteSvg), blend: 'over', top: 0, left: 0 }])
    .jpeg({ quality: 88, chromaSubsampling: '4:2:0' })
    .toFile(outputPath);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLUX Pro Fill インペインティング（IMAGE_GEN_PROVIDER=fal）
// ═══════════════════════════════════════════════════════════════════════════════

// angleHint → FLUX Fill インペインティングプロンプト（v2: unboxing前提）
const ANGLE_INPAINT_PROMPTS = {
  // v2
  shake_impact:     'hands lifting {product_desc} out of open box with dramatic upward motion, product tilted 25 degrees, unboxing reveal, box open in background, photorealistic',
  pull_back_reveal: 'extreme close-up of {product_desc} logo or surface texture, fingertips at edge, slowly pulling back to reveal full product, open box in soft bokeh, photorealistic',
  dutch_angle:      '{product_desc} held in hands at 20-degree dutch angle, dynamic tilted composition, open box visible at lower corner, cinematic feel, photorealistic',
  extreme_close:    'extreme macro of {product_desc} surface texture, fingertips visible at edge, open box in soft bokeh background, shallow depth of field, photorealistic',
  overhead_flatlay: 'top-down view, open box with {product_desc} partially lifted by hands, unboxing flat lay, clean background, photorealistic',
  hand_hold_pov:    'first-person POV of hands holding {product_desc} taken from open box, natural indoor lighting, box flap visible at bottom, photorealistic',
  orbit:            '{product_desc} held in one hand from 45-degree side angle, open box beside it on surface, orbital camera perspective, photorealistic',
  hero_low_angle:   '{product_desc} held up triumphantly, low angle looking up, open box and hands visible at bottom frame, heroic presentation, photorealistic',
  lifestyle_scene:  '{product_desc} in natural use environment, hands interacting with product, lifestyle context, real setting, warm lighting, photorealistic',
  split_comparison: '{product_desc} held in hands, open box visible beside it on flat surface, left half composition, clean background, photorealistic',
  // 旧互換
  wide:    'A {product_desc} held firmly by a hand. Studio white background. Professional product photography. Clean and natural looking.',
  close:   'A {product_desc} extreme close-up detail. Clean white background. Studio lighting.',
  front:   'A {product_desc} placed upright on a clean white surface. Minimal lifestyle setting. Soft overhead lighting.',
  angle:   'A {product_desc} cradled in two hands. Soft studio lighting. Clean white background.',
  scene:   'A {product_desc} held by two hands at chest level, front view. Warm lifestyle lighting. Natural look.',
};

// 商品ゾーン（1080×1920 座標系）
const ANGLE_ZONES = {
  // v2
  shake_impact:     { x: 90,  y: 280,  w: 900, h: 1300 },
  pull_back_reveal: { x: 200, y: 500,  w: 680, h: 680  },
  dutch_angle:      { x: 100, y: 300,  w: 880, h: 1200 },
  extreme_close:    { x: 240, y: 680,  w: 600, h: 750  },
  overhead_flatlay: { x: 80,  y: 250,  w: 920, h: 1100 },
  hand_hold_pov:    { x: 60,  y: 380,  w: 960, h: 1200 },
  orbit:            { x: 140, y: 290,  w: 800, h: 1200 },
  hero_low_angle:   { x: 120, y: 430,  w: 840, h: 1050 },
  lifestyle_scene:  { x: 100, y: 350,  w: 880, h: 1150 },
  split_comparison: { x: 40,  y: 290,  w: 500, h: 1050 },
  // 旧互換
  wide:  { x: 100, y: 200, w: 880, h: 1400 },
  close: { x: 200, y: 600, w: 680, h: 900  },
  front: { x: 140, y: 350, w: 800, h: 1100 },
  angle: { x: 160, y: 260, w: 760, h: 1050 },
  scene: { x: 125, y: 200, w: 830, h: 1200 },
};

/**
 * FLUX Pro Fill でインペインティングして各ショット画像を生成する
 */
async function runFluxFillImageGen({ jobId, imageGenDir, sourceImagePath, videoShotPlan, verbose }) {
  const falKey = process.env.FAL_KEY?.trim();
  if (!falKey) throw new Error('FAL_KEY が設定されていません');

  const { fal } = await import('@fal-ai/client');
  fal.config({ credentials: falKey });

  const { videoIndex, shots } = videoShotPlan;
  const vStr = String(videoIndex).padStart(2, '0');
  const variants = [];

  // 商品タイトルを 01_analyze-output.json から取得
  const jobDir = dirname(imageGenDir);
  let productTitle = '商品';
  try {
    const analyzeJson = JSON.parse(readFileSync(join(jobDir, '01_analyze-output.json'), 'utf8'));
    productTitle = analyzeJson.normalizedProduct?.title ?? productTitle;
  } catch {}

  // 商品説明をビジュアルに変換（Claudeで英語記述生成）
  const productDesc = await describeProduct(productTitle, verbose);
  if (verbose) logger.info(`video-${videoIndex}: product_desc = "${productDesc}"`);

  // 元画像を fal.ai にアップロード
  const srcBuf = readFileSync(sourceImagePath);
  const srcExt = sourceImagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const frameUrl = await fal.storage.upload(new File([srcBuf], 'source.jpg', { type: srcExt }));

  if (verbose) logger.info(`video-${videoIndex}: Phase 1 — 3面図生成（sharp fallback）`);
  const threeViews = await generate3Views(sourceImagePath, imageGenDir, vStr, verbose);

  if (verbose) logger.info(`video-${videoIndex}: Phase 2 — FLUX Fill インペインティング`);

  for (const shot of shots) {
    const { index: shotIndex, angleHint } = shot;
    const filename = `${vStr}-angle-${String(shotIndex).padStart(2, '0')}.jpg`;
    const outputPath = join(imageGenDir, filename);

    const zone = ANGLE_ZONES[angleHint] ?? ANGLE_ZONES['hand_hold_pov'];
    const inpaintPromptTmpl = ANGLE_INPAINT_PROMPTS[angleHint] ?? ANGLE_INPAINT_PROMPTS['hand_hold_pov'];
    const inpaintPrompt = inpaintPromptTmpl.replace('{product_desc}', productDesc);

    // sharp でマスク画像生成（ゾーンを白、背景を黒）
    const maskPath = join(imageGenDir, `${vStr}-mask-${String(shotIndex).padStart(2, '0')}.png`);
    await createZoneMask(zone, maskPath);

    // ベース画像は sharp 3面図から（FLUX Fill は image/mask が同サイズ必須 → 1080×1920 に強制）
    const baseKey = ANGLE_TO_BASE[angleHint] ?? 'front';
    const baseImagePath = threeViews[baseKey];
    const baseBuf = await sharp(baseImagePath)
      .resize(TARGET_W, TARGET_H, { fit: 'cover' })
      .jpeg({ quality: 92 })
      .toBuffer();
    const baseFrameUrl = await fal.storage.upload(new File([baseBuf], 'frame.jpg', { type: 'image/jpeg' }));
    const maskBuf = readFileSync(maskPath);
    const maskUrl = await fal.storage.upload(new File([maskBuf], 'mask.png', { type: 'image/png' }));

    if (verbose) logger.info(`  [${vStr}] shot-${shotIndex} [${angleHint}] FLUX Fill...`);

    const result = await fal.subscribe('fal-ai/flux-pro/v1/fill', {
      input: {
        image_url: baseFrameUrl,
        mask_url: maskUrl,
        prompt: inpaintPrompt,
        guidance_scale: 20,
        num_inference_steps: 28,
        output_format: 'jpeg',
      },
      pollInterval: 3000,
      timeout: 120_000,
    });

    const resultUrl = result.data?.images?.[0]?.url ?? result.data?.url;
    if (!resultUrl) throw new Error(`FLUX Fill 結果 URL なし: ${JSON.stringify(result.data)}`);

    const res = await fetch(resultUrl);
    if (!res.ok) throw new Error(`画像ダウンロード失敗: ${res.status}`);
    writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));

    variants.push({ videoIndex, shotIndex, imagePath: outputPath, angleLabel: angleHint });
  }

  const output = validate(ImageVariantsSchema, { jobId, videoIndex, variants });
  writeFileSync(join(imageGenDir, `${vStr}-image-variants.json`), JSON.stringify(output, null, 2), 'utf8');

  logger.success(`video-${videoIndex}: FLUX Fill ${variants.length}枚生成完了`);
  return output;
}

async function describeProduct(productTitle, verbose) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return productTitle;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: process.env.CLAUDE_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001',
    max_tokens: 64,
    messages: [{
      role: 'user',
      content:
        `Describe the visual appearance of this product in 10-15 English words suitable for an AI image generator prompt.\n` +
        `Product: ${productTitle}\n` +
        `Focus on: shape, color, material, distinctive features. No brand names unless visual.\n` +
        `Example: 'white cylindrical stainless steel water bottle with gray screw cap'\n` +
        `Reply with the description only.`,
    }],
  });
  return msg.content[0].text.trim();
}

async function createZoneMask(zone, outPath) {
  const { x, y, w, h } = zone;
  await sharp({
    create: { width: TARGET_W, height: TARGET_H, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([{
      input: {
        create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } },
      },
      left: x,
      top: y,
    }])
    .png()
    .toFile(outPath);
}

/** ラジアルグラデーションで周辺光量落ち(ビネット)を表現するSVGを生成 */
function buildVignetteSvg(opacity = 0.30) {
  return `<svg width="${TARGET_W}" height="${TARGET_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="v" cx="50%" cy="47%" r="72%" gradientUnits="userSpaceOnUse"
      fx="${TARGET_W * 0.5}" fy="${TARGET_H * 0.45}"
      x1="0" y1="0" x2="${TARGET_W}" y2="${TARGET_H}">
      <stop offset="35%" stop-color="black" stop-opacity="0"/>
      <stop offset="100%" stop-color="black" stop-opacity="${opacity.toFixed(2)}"/>
    </radialGradient>
  </defs>
  <rect width="${TARGET_W}" height="${TARGET_H}" fill="url(#v)"/>
</svg>`;
}
