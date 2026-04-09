import { createRequire } from 'node:module';
import { config } from '../../config.ts';

const require = createRequire(import.meta.url);
const sharp = require('sharp') as typeof import('sharp');

const { VIDEO_WIDTH: W, VIDEO_HEIGHT: H } = config;

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface FrameOptions {
  text: string;
  subText?: string;
}

export async function renderFrame(
  productImagePath: string,
  opts: FrameOptions
): Promise<Buffer> {
  // 商品画像をフルスクリーンにカバー表示（中央クロップ）
  const productImg = await sharp(productImagePath)
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  // テキスト行数によって高さを決定
  const hasSubText = !!opts.subText;
  const boxH = hasSubText ? 260 : 180;
  const boxY = H - boxH - 60;
  const mainTextY = boxY + (hasSubText ? 110 : 110);
  const subTextY = boxY + 195;

  const svgOverlay = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="black" stop-opacity="0"/>
      <stop offset="60%" stop-color="black" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.78"/>
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="rgba(0,0,0,0.95)"/>
    </filter>
  </defs>
  <!-- フルスクリーングラデーション -->
  <rect x="0" y="${H - 600}" width="${W}" height="600" fill="url(#grad)"/>
  <!-- テキスト背景ボックス（半透明黒） -->
  <rect x="60" y="${boxY}" width="${W - 120}" height="${boxH}" rx="16" ry="16"
    fill="black" fill-opacity="0.52"/>
  <!-- メインテキスト -->
  <text
    x="${W / 2}" y="${mainTextY}"
    text-anchor="middle"
    font-family="Hiragino Sans, Noto Sans CJK JP, sans-serif"
    font-size="76"
    font-weight="bold"
    fill="white"
    filter="url(#shadow)"
  >${escapeXml(opts.text)}</text>
  ${hasSubText
    ? `<text
    x="${W / 2}" y="${subTextY}"
    text-anchor="middle"
    font-family="Hiragino Sans, Noto Sans CJK JP, sans-serif"
    font-size="52"
    fill="white"
    opacity="0.92"
    filter="url(#shadow)"
  >${escapeXml(opts.subText!)}</text>`
    : ''}
</svg>`;

  return sharp(productImg)
    .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

/** 商品特徴一覧スライド（ホワイト背景 + 特徴リスト） */
export async function renderFeatureCard(
  productImagePath: string,
  opts: {
    title: string;
    features: string[];
    category: string;
  }
): Promise<Buffer> {
  const features = opts.features.slice(0, 5);

  // 商品画像を上部52%に contained 表示
  const imgH = Math.floor(H * 0.52);
  const imgW = W - 80;
  const productImg = await sharp(productImagePath)
    .resize(imgW, imgH, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();

  // 白背景
  const bg = await sharp({
    create: { width: W, height: H, channels: 4, background: '#FAFAFA' },
  })
    .png()
    .toBuffer();

  const sepY = imgH + 60;
  const titleY = sepY + 90;
  const featureStartY = titleY + 110;
  const featureLineH = 110;

  const featureItems = features
    .map((f, i) => {
      const y = featureStartY + i * featureLineH;
      return `
  <circle cx="110" cy="${y - 20}" r="28" fill="#C4973F"/>
  <text x="110" y="${y - 10}" text-anchor="middle"
    font-family="Hiragino Sans, sans-serif" font-size="34" font-weight="bold" fill="white"
  >✓</text>
  <text x="170" y="${y}"
    font-family="Hiragino Sans, Noto Sans CJK JP, sans-serif"
    font-size="46" font-weight="500" fill="#2A2A2A"
  >${escapeXml(f)}</text>`;
    })
    .join('');

  const svgCard = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <!-- セパレーター -->
  <rect x="60" y="${sepY}" width="${W - 120}" height="3" rx="2" fill="#C4973F" opacity="0.7"/>
  <!-- カテゴリラベル -->
  <text x="${W / 2}" y="${titleY - 20}"
    text-anchor="middle"
    font-family="Hiragino Sans, sans-serif"
    font-size="36" fill="#C4973F" font-weight="600"
  >${escapeXml(opts.category)}</text>
  <!-- 商品名 -->
  <text x="${W / 2}" y="${titleY + 60}"
    text-anchor="middle"
    font-family="Hiragino Sans, Noto Sans CJK JP, sans-serif"
    font-size="52" font-weight="bold" fill="#1A1A1A"
  >${escapeXml(opts.title)}</text>
  <!-- 特徴リスト -->
  ${featureItems}
</svg>`;

  return sharp(bg)
    .composite([
      { input: productImg, top: 40, left: 40 },
      { input: Buffer.from(svgCard), top: 0, left: 0 },
    ])
    .png()
    .toBuffer();
}
