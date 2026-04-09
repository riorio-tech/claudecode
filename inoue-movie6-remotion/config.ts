import 'dotenv/config';

export const config = {
  VIDEO_WIDTH: 1080,
  VIDEO_HEIGHT: 1920,
  FPS: 30,
  MIN_DURATION: 15,
  MAX_DURATION: 30,
  TARGET_DURATION: 22,
  CUTS_PER_VIDEO: 20,
  DEFAULT_TEMPLATE: (process.env.VIDEO_TEMPLATE ?? 'Standard') as 'Standard' | 'Minimal',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
  ANTHROPIC_MODEL: 'claude-opus-4-6',
} as const;
