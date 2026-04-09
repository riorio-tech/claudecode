#!/usr/bin/env node
/**
 * setup.js — Threads API キーを .env に設定するセットアップスクリプト
 *
 * 実行: node setup.js  または  make SETUP
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const ENV_PATH = path.resolve('.env');

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';

function print(msg) { console.log(msg); }
function success(msg) { console.log(`${GREEN}✓${RESET} ${msg}`); }
function warn(msg) { console.log(`${YELLOW}⚠${RESET}  ${msg}`); }
function header(msg) { console.log(`\n${BOLD}${CYAN}${msg}${RESET}`); }

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const lines = fs.readFileSync(ENV_PATH, 'utf-8').split('\n');
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  }
  return env;
}

function writeEnvKey(key, value) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
  const regex = new RegExp(`^(${key}=).*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `$1${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf-8');
}

async function fetchUserId(token) {
  const res = await fetch(
    `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${token}`
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  header('Threads 自動投稿エージェント — セットアップ');
  print('');
  print('Threads APIのアクセストークンを設定します。');
  print(`${DIM}取得方法: https://developers.facebook.com/ → アプリ作成 → Threads API 有効化${RESET}`);
  print('');

  const env = readEnv();

  // ─── THREADS_ACCESS_TOKEN ────────────────────────────────────────────────
  let token = env['THREADS_ACCESS_TOKEN'] || '';
  if (token) {
    warn(`既存のトークンが見つかりました: ${token.slice(0, 10)}...`);
    const overwrite = await ask(rl, '上書きしますか？ [y/N]: ');
    if (overwrite.toLowerCase() !== 'y') {
      print('既存のトークンを使用します。');
    } else {
      token = '';
    }
  }

  if (!token) {
    token = (await ask(rl, `${BOLD}THREADS_ACCESS_TOKEN${RESET} を貼り付けてください:\n> `)).trim();
    if (!token) {
      warn('トークンが入力されませんでした。セットアップを中断します。');
      rl.close();
      process.exit(1);
    }
    writeEnvKey('THREADS_ACCESS_TOKEN', token);
    success('THREADS_ACCESS_TOKEN を .env に保存しました');
  }

  // ─── THREADS_USER_ID（自動取得） ─────────────────────────────────────────
  print('');
  print('ユーザーIDを自動取得中...');
  try {
    const me = await fetchUserId(token);
    writeEnvKey('THREADS_USER_ID', me.id);
    success(`THREADS_USER_ID を取得・保存しました: @${me.username} (${me.id})`);
  } catch (err) {
    warn(`ユーザーID の自動取得に失敗しました: ${err.message}`);
    const userId = (await ask(rl, `${BOLD}THREADS_USER_ID${RESET} を手動で入力してください:\n> `)).trim();
    if (userId) {
      writeEnvKey('THREADS_USER_ID', userId);
      success('THREADS_USER_ID を .env に保存しました');
    }
  }

  // ─── 完了 ────────────────────────────────────────────────────────────────
  print('');
  header('セットアップ完了');
  print('');
  print('次のコマンドで投稿文を確認できます:');
  print(`  ${BOLD}make DRY_RUN${RESET}   投稿文を生成（Threadsには投稿しない）`);
  print(`  ${BOLD}make POST${RESET}      実際にThreadsへ投稿`);
  print('');

  rl.close();
}

main().catch(err => {
  console.error('エラー:', err.message);
  process.exit(1);
});
