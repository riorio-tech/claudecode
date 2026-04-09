import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function resolveBinary(envKey, packageName) {
  if (process.env[envKey]) return process.env[envKey];
  try {
    return require(packageName).path;
  } catch {
    return packageName.includes('ffprobe') ? 'ffprobe' : 'ffmpeg';
  }
}

export const FFMPEG  = resolveBinary('FFMPEG_PATH',  '@ffmpeg-installer/ffmpeg');
export const FFPROBE = resolveBinary('FFPROBE_PATH', '@ffprobe-installer/ffprobe');
