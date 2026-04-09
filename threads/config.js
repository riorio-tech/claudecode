import dotenv from 'dotenv';
import path from 'path';

// claudecode直下の共通.envを優先読み込み、threads/.envで上書き可能
dotenv.config({ path: path.resolve('../.env') });
dotenv.config({ path: path.resolve('.env') });

export const config = {
  THREADS_ACCESS_TOKEN: process.env.THREADS_ACCESS_TOKEN,
  THREADS_USER_ID: process.env.THREADS_USER_ID,

  // AIプロバイダー切替: AI_PROVIDER=anthropic or openai
  AI_PROVIDER: process.env.AI_PROVIDER ?? 'anthropic',

  // Anthropic
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  CLAUDE_MODEL: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
  CLAUDE_HAIKU_MODEL: process.env.CLAUDE_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001',

  // OpenAI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? 'gpt-4o',
  OPENAI_MINI_MODEL: process.env.OPENAI_MINI_MODEL ?? 'gpt-4o-mini',

  POST_INTERVAL_HOURS: parseInt(process.env.POST_INTERVAL_HOURS ?? '2'),
  OUTPUT_DIR: './output',
  MEMORY_DIR: './memory',
};
