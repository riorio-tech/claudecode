import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config({ path: resolve(__dirname, '../.env') });

export const config = {
  // ── 画像生成 ──────────────────────────────────────────────────────────────
  // "nano-banana" | "fal_flux"
  IMAGE_GEN_PROVIDER: process.env.IMAGE_GEN_PROVIDER ?? 'fal_flux',
  NANO_BANANA_ENDPOINT: process.env.NANO_BANANA_ENDPOINT ?? 'fal-ai/nano-banana-2',
  IMAGE_WIDTH:  1080,
  IMAGE_HEIGHT: 1920,

  // ── 動画生成（fal.ai）─────────────────────────────────────────────────────
  // "seedance" | "kling"
  VIDEO_GEN_PROVIDER: process.env.VIDEO_GEN_PROVIDER ?? 'kling',
  FAL_KEY: process.env.FAL_KEY ?? '',
  SEEDANCE_ENDPOINT: process.env.SEEDANCE_ENDPOINT ??
    'fal-ai/bytedance/seedance/v1.5/pro/image-to-video',
  KLING_FAL_MODEL: process.env.KLING_FAL_MODEL ?? process.env.KLING_ENDPOINT ??
    'fal-ai/kling-video/v1.6/standard/image-to-video',
  CLIP_DURATION_SEC: Number(process.env.CLIP_DURATION_SEC ?? 5),

  // ── 音声生成（ElevenLabs）─────────────────────────────────────────────────
  ELEVENLABS_API_KEY:        process.env.ELEVENLABS_API_KEY ?? '',
  // ELEVENLABS_VOICE または ELEVENLABS_VOICE_NARRATOR どちらでも可
  ELEVENLABS_VOICE_NARRATOR: process.env.ELEVENLABS_VOICE ?? process.env.ELEVENLABS_VOICE_NARRATOR ?? '',
  // "eleven_v3" | "eleven_multilingual_v2"
  ELEVENLABS_MODEL: process.env.ELEVENLABS_MODEL ?? 'eleven_v3',

  // ── Claude ────────────────────────────────────────────────────────────────
  CLAUDE_MODEL: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',

  // ── パイプライン ──────────────────────────────────────────────────────────
  // テスト: 3 / 本番: 6〜7
  SCENES_PER_EPISODE: Number(process.env.SCENES_PER_EPISODE ?? 3),
  MIN_DURATION_SEC:   Number(process.env.MIN_DURATION_SEC   ?? 10),
  MAX_DURATION_SEC:   Number(process.env.MAX_DURATION_SEC   ?? 90),
  SKIP_QA: process.env.SKIP_QA === 'true',

  // ── DB ────────────────────────────────────────────────────────────────────
  DB_PATH: process.env.DB_PATH ?? './ai-drama.db',

  // ── 字幕フォント ──────────────────────────────────────────────────────────
  JAPANESE_FONT_PATH: process.env.JAPANESE_FONT_PATH ??
    '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc',

  // ── FFmpeg カラーグレード（ドラマ用コールド）────────────────────────────
  FFMPEG_COLOR_GRADE: process.env.FFMPEG_COLOR_GRADE ??
    'eq=brightness=-0.01:contrast=1.12:saturation=0.88,' +
    'colorbalance=rs=-0.02:gs=0.00:bs=0.04:rm=-0.01:gm=0.00:bm=0.03:rh=-0.01:gh=0.00:bh=0.02',
};
