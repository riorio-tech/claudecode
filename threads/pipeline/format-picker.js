/**
 * format-picker.js — システムエージェント（コストゼロ）
 *
 * 役割: formats.json から今回投稿に使うフォーマット型を選ぶ。
 *       直近で使った型を避けて重複を防ぐ。Claude不使用。
 */
import fs from 'fs';
import path from 'path';
import { writeJson } from '../lib/job-dir.js';
import { logger } from '../lib/logger.js';

const FORMATS_PATH = path.resolve('memory/formats.json');

export function formatPicker(jobDir, theme, posted) {
  logger.stage('2.5', 'フォーマット型選択（システム）');

  if (!fs.existsSync(FORMATS_PATH)) {
    throw new Error('formats.json が見つかりません。先に make RESEARCH_FORMATS を実行してください。');
  }

  const { formats } = JSON.parse(fs.readFileSync(FORMATS_PATH, 'utf-8'));

  // カテゴリに合う型を絞り込む
  const compatible = formats.filter(f => f.categories.includes(theme.category));

  // 直近5投稿で使った型を避ける
  const recentFormatIds = posted.slice(-5).map(p => p.format_id).filter(Boolean);
  const candidates = compatible.filter(f => !recentFormatIds.includes(f.id));

  // 候補がなければ全互換型、それも空なら全フォーマットから選ぶ
  const pool = candidates.length > 0 ? candidates : compatible.length > 0 ? compatible : formats;

  // インデックスはposted件数で循環
  const idx = posted.length % pool.length;
  const selected = pool[idx];

  writeJson(jobDir, '02b_format.json', selected);
  logger.success(`フォーマット型: [${selected.id}] ${selected.name}`);
  return selected;
}
