/**
 * reflector.js — システムエージェント（コストゼロ）
 *
 * 役割: 投稿結果を memory/ と output/ に記録する。ファイルI/Oのみ。
 */
import fs from 'fs';
import path from 'path';
import { writeJson } from '../lib/job-dir.js';
import { logger } from '../lib/logger.js';
import { upsertPost } from '../lib/db.js';

export function reflector(jobDir, theme, format, result) {
  logger.stage(6, '記録（システム）');

  const postedPath = path.resolve('memory/posted.json');
  const themesPath = path.resolve('memory/themes.json');

  // posted.json 更新
  const posted = JSON.parse(fs.readFileSync(postedPath, 'utf-8'));
  const entry = {
    date: new Date().toISOString().slice(0, 10),
    timestamp: result.timestamp,
    category: result.category,
    theme: result.theme,
    format_id: format.id,
    format_name: format.name,
    post_id: result.post_id ?? null,
    dry_run: result.dry_run ?? false,
    eval_score: result.eval_score ?? null,
    eval_passed: result.eval_passed ?? null,
    text: result.text,
  };
  posted.push(entry);
  fs.writeFileSync(postedPath, JSON.stringify(posted, null, 2), 'utf-8');

  // DB に保存（post_id が null の dry_run も記録）
  try {
    upsertPost({ ...entry, job_id: path.basename(jobDir) });
  } catch (e) {
    logger.warn(`DB保存スキップ: ${e.message}`);
  }

  // themes.json の rotationIndex 更新
  const themes = JSON.parse(fs.readFileSync(themesPath, 'utf-8'));
  themes.rotationIndex = (themes.rotationIndex + 1) % themes.topics.length;
  fs.writeFileSync(themesPath, JSON.stringify(themes, null, 2), 'utf-8');

  // output/post_{YYYYMMDD}/ に保存
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const outDir = path.resolve(`output/post_${today}`);
  fs.mkdirSync(outDir, { recursive: true });

  const draftPath = path.join(jobDir, '03_draft.json');
  if (fs.existsSync(draftPath)) {
    const draft = JSON.parse(fs.readFileSync(draftPath, 'utf-8'));
    const draftMd = draft.variants.map(v =>
      `## バリアント${v.id}（${v.hook_variation}）\n\n${v.text}\n`
    ).join('\n---\n\n');
    fs.appendFileSync(
      path.join(outDir, 'draft.md'),
      `# ${result.theme}（${format.name}）\n\n${draftMd}\n`
    );
  }

  const resultJsonPath = path.join(outDir, 'result.json');
  const existing = fs.existsSync(resultJsonPath)
    ? JSON.parse(fs.readFileSync(resultJsonPath, 'utf-8'))
    : [];
  existing.push(result);
  fs.writeFileSync(resultJsonPath, JSON.stringify(existing, null, 2), 'utf-8');

  writeJson(jobDir, '06_reflect.json', { posted_total: posted.length });
  logger.success(`記録完了（累計 ${posted.length} 投稿）`);
  logger.info(`出力先: output/post_${today}/`);
}
