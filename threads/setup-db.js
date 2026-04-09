/**
 * setup-db.js — 既存のposted.jsonをDBにインポートする初期化スクリプト
 * 実行: node setup-db.js
 */
import fs from 'fs';
import path from 'path';
import { upsertPost, getDb } from './lib/db.js';
import { config } from './config.js';

const postedPath = path.resolve('memory/posted.json');
const posted = JSON.parse(fs.readFileSync(postedPath, 'utf-8'));

let count = 0;
for (const p of posted) {
  if (!p.post_id && p.dry_run) continue; // dry_runのpost_idなしはスキップ
  try {
    upsertPost(p);
    count++;
  } catch (e) {
    // post_id重複はスキップ
  }
}

console.log(`インポート完了: ${count}/${posted.length}件`);
