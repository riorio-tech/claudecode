/**
 * モデル・APIプロバイダ切替設定
 * 値は .env から読み込む（環境変数でも上書き可能）
 */
export const config = {
  // 動画生成プロバイダ: "local" | "fal"
  VIDEO_GEN_PROVIDER: process.env.VIDEO_GEN_PROVIDER ?? 'local',

  // fal.ai 動画生成モデル（VIDEO_GEN_PROVIDER=fal 時に使用）
  // 例: fal-ai/kling-video/v2.1/standard/image-to-video
  //     fal-ai/kling-video/v1.6/standard/image-to-video
  //     fal-ai/wan/v2.1/image-to-video
  //     fal-ai/minimax/video-01-live
  //     fal-ai/luma-dream-machine/image-to-video
  VIDEO_GEN_MODEL: process.env.VIDEO_GEN_MODEL ?? 'fal-ai/kling-video/v1.6/standard/image-to-video',

  // 画像生成プロバイダ: "sharp" | "fal" | "dalle"
  IMAGE_GEN_PROVIDER: process.env.IMAGE_GEN_PROVIDER ?? 'sharp',

  // 音声合成プロバイダ: "say" | "elevenlabs" | "voicevox"
  TTS_PROVIDER: process.env.TTS_PROVIDER ?? 'say',

  // Claude モデル（台本・スカウト・キャプション生成）
  CLAUDE_MODEL: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',

  // Claude Haiku（計測・軽量タスク）
  CLAUDE_HAIKU_MODEL: process.env.CLAUDE_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001',

  // 1商品あたりの動画生成本数（テスト中は1、本番は10）
  VIDEOS_PER_PRODUCT: Number(process.env.VIDEOS_PER_PRODUCT ?? 1),

  // DB ファイルパス
  DB_PATH: process.env.DB_PATH ?? './inoue-movie.db',
};
