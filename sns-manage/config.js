// dotenv がインストールされていない場合でも動作する（graceful degradation）
// 読み込み優先順位: ../. env（共有）→ ./.env（プロジェクト固有）
try {
  const { default: dotenv } = await import('dotenv');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  // まず上位の共有 .env（/Users/reoreo/claudecode/.env）を読む
  dotenv.config({ path: resolve(__dirname, '../.env') });
  // 次にプロジェクト固有の .env で上書き（SNS固有の設定のみ書ける）
  dotenv.config({ path: resolve(__dirname, '.env'), override: true });
} catch {
  // dotenv 未インストール時はスキップ
}

// 必須キーが未設定の場合は警告のみ（クラッシュしない）
const REQUIRED_FOR_PRODUCTION = [
  'ANTHROPIC_API_KEY',
  'API_KEY',
];

for (const key of REQUIRED_FOR_PRODUCTION) {
  if (!process.env[key]) {
    console.warn(`[config] 警告: 環境変数 ${key} が未設定です`);
  }
}

export const config = {
  // Claude モデル
  CLAUDE_MODEL: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
  CLAUDE_HAIKU_MODEL: process.env.CLAUDE_HAIKU_MODEL || 'claude-haiku-4-5-20251001',

  // Anthropic
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',

  // DB / サーバー
  DB_PATH: process.env.DB_PATH || './sns.db',
  PORT: Number(process.env.PORT) || 3000,
  API_KEY: process.env.API_KEY || 'dev-key',

  // Twitter/X
  TWITTER_API_KEY: process.env.TWITTER_API_KEY || '',
  TWITTER_API_SECRET: process.env.TWITTER_API_SECRET || '',
  TWITTER_ACCESS_TOKEN: process.env.TWITTER_ACCESS_TOKEN || '',
  TWITTER_ACCESS_SECRET: process.env.TWITTER_ACCESS_SECRET || '',
  TWITTER_BEARER_TOKEN: process.env.TWITTER_BEARER_TOKEN || '',

  // TikTok
  TIKTOK_CLIENT_KEY: process.env.TIKTOK_CLIENT_KEY || '',
  TIKTOK_CLIENT_SECRET: process.env.TIKTOK_CLIENT_SECRET || '',
  TIKTOK_ACCESS_TOKEN: process.env.TIKTOK_ACCESS_TOKEN || '',

  // YouTube
  YOUTUBE_CLIENT_ID: process.env.YOUTUBE_CLIENT_ID || '',
  YOUTUBE_CLIENT_SECRET: process.env.YOUTUBE_CLIENT_SECRET || '',
  YOUTUBE_REFRESH_TOKEN: process.env.YOUTUBE_REFRESH_TOKEN || '',

  // Instagram
  INSTAGRAM_ACCESS_TOKEN: process.env.INSTAGRAM_ACCESS_TOKEN || '',
  INSTAGRAM_USER_ID: process.env.INSTAGRAM_USER_ID || '',

  // Threads
  THREADS_ACCESS_TOKEN: process.env.THREADS_ACCESS_TOKEN || '',
  THREADS_USER_ID: process.env.THREADS_USER_ID || '',

  // Google Sheets
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
  GOOGLE_SHEETS_ID: process.env.GOOGLE_SHEETS_ID || '',

  // 自動スケジューラー設定
  AUTO_APPROVE: process.env.AUTO_APPROVE === 'true',
  TRUST_MODE: process.env.TRUST_MODE || 'manual',
  // 値: 'manual' | 'auto' | 'smart'
  // manual: 常に人間の承認が必要（デフォルト）
  // auto:   常に自動承認（旧 AUTO_APPROVE=true と同等）
  // smart:  knowledge_base の confidence が閾値を超えた場合に自動承認

  TRUST_THRESHOLD: parseFloat(process.env.TRUST_THRESHOLD || '0.65'),
  // smart モードで使用: 自動承認の平均 confidence 閾値
  POST_TIME: process.env.POST_TIME || '09:00',           // JST "HH:MM"（後方互換用）
  POST_TIMES: (() => {
    const raw = process.env.POST_TIMES || process.env.POST_TIME || '09:00';
    return raw.split(',').map(s => s.trim()).filter(s => /^\d{1,2}:\d{2}$/.test(s));
  })(),
  DAILY_POST_COUNT: Number(process.env.DAILY_POST_COUNT) || 1,
  ANALYTICS_DELAY_HOURS: Number(process.env.ANALYTICS_DELAY_HOURS) || 24,
  DAILY_TOPICS_FILE: process.env.DAILY_TOPICS_FILE || './topics.json',
};
