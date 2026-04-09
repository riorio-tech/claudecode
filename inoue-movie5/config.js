/**
 * モデル・APIプロバイダ切替設定
 * 値は .env から読み込む（環境変数でも上書き可能）
 */
export const config = {
  // 動画生成プロバイダ: "local" | "runway"
  VIDEO_GEN_PROVIDER: process.env.VIDEO_GEN_PROVIDER ?? 'runway',

  // Runway fal.ai モデルパス（VIDEO_GEN_PROVIDER=runway 時に使用）
  RUNWAY_FAL_MODEL: process.env.RUNWAY_FAL_MODEL ?? 'fal-ai/runway-gen3/alpha/image-to-video',

  // 画像生成プロバイダ: "sharp" | "fal"
  // fal: FLUX Pro Fill でインペインティング
  IMAGE_GEN_PROVIDER: process.env.IMAGE_GEN_PROVIDER ?? 'fal',

  // 音声合成プロバイダ: "say" | "elevenlabs"
  TTS_PROVIDER: process.env.TTS_PROVIDER ?? 'elevenlabs',

  // アップスケールプロバイダ: "none" | "esrgan"
  UPSCALE_PROVIDER: process.env.UPSCALE_PROVIDER ?? 'esrgan',

  // Claude モデル（台本・スカウト・キャプション生成）
  CLAUDE_MODEL: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',

  // Claude Haiku（計測・軽量タスク）
  CLAUDE_HAIKU_MODEL: process.env.CLAUDE_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001',

  // 1商品あたりの動画生成本数（テスト中は1、本番は10）
  VIDEOS_PER_PRODUCT: Number(process.env.VIDEOS_PER_PRODUCT ?? 1),

  // DB ファイルパス
  DB_PATH: process.env.DB_PATH ?? './inoue-movie.db',
};
