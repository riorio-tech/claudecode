/**
 * theme-picker.js — システムエージェント（コストゼロ）
 *
 * 役割: カテゴリローテーションとトピック選択。Claude不使用。
 *       posted.json の件数と themes.json の rotationIndex で決定論的に動く。
 */
import fs from 'fs';
import path from 'path';
import { writeJson } from '../lib/job-dir.js';
import { logger } from '../lib/logger.js';

// 1日12投稿（2時間おき）のカテゴリローテーション
const ROTATION = [
  'tip', 'story', 'tip', 'concept',
  'tip', 'question', 'story', 'tip',
  'concept', 'tip', 'story', 'question',
];

export function themePicker(jobDir) {
  logger.stage(1, 'テーマ選定（システム）');

  const postedPath = path.resolve('memory/posted.json');
  const themesPath = path.resolve('memory/themes.json');

  const posted = JSON.parse(fs.readFileSync(postedPath, 'utf-8'));
  const themes = JSON.parse(fs.readFileSync(themesPath, 'utf-8'));

  // カテゴリ: 投稿総数の剰余でROTATIONを循環
  const category = ROTATION[posted.length % ROTATION.length];

  // トピック: rotationIndex で循環、直近20投稿のテーマを除外
  const recentThemes = new Set(posted.slice(-20).map(p => p.theme));
  const available = themes.topics.filter(t => !recentThemes.has(t));
  const pool = available.length > 0 ? available : themes.topics;
  const topic = pool[themes.rotationIndex % pool.length];

  const result = {
    category,
    theme: topic,
    angle: categoryAngle(category),
    keywords: extractKeywords(topic),
  };

  writeJson(jobDir, '01_theme.json', result);
  logger.success(`カテゴリ: ${category} / テーマ: ${topic}`);
  return { theme: result, posted };
}

function categoryAngle(category) {
  const angles = {
    tip: '体験ベース・すぐ使える',
    story: '体験談・聞いた話',
    concept: 'やさしい例え話',
    question: 'フォロワーへの問いかけ',
  };
  return angles[category] ?? '体験ベース';
}

function extractKeywords(topic) {
  // 簡易的にトピック文を単語分割してキーワード抽出
  const words = topic.replace(/[「」・。、]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
  return words.slice(0, 3);
}
