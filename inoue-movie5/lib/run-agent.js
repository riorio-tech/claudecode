import { spawnSync } from 'child_process';
import { logger } from './logger.js';

/**
 * claude --print を使ってエージェントを実行し、出力から最後の JSON ブロックを取得する
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt - システムプロンプト文字列
 * @param {string} opts.userMessage - ユーザーメッセージ（コンテキスト JSON など）
 * @param {string[]} [opts.allowedTools] - 許可するツール（デフォルト: Bash,Read,Write）
 * @param {number} [opts.timeoutMs] - タイムアウト ms（デフォルト: 120000）
 * @param {boolean} [opts.verbose] - claude の stdout を全表示するか
 * @returns {object} パースされた JSON オブジェクト
 */
export function runAgent({ systemPrompt, userMessage, allowedTools = ['Bash', 'Read', 'Write'], timeoutMs = 120_000, verbose = false }) {
  const args = [
    '--print',
    '--allowedTools', allowedTools.join(','),
    '--system', systemPrompt,
    userMessage,
  ];

  const result = spawnSync('claude', args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024, // 10MB
  });

  if (result.error) {
    throw new Error(`claude プロセス起動失敗: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const errMsg = result.stderr?.trim() || '（stderr なし）';
    throw new Error(`claude が終了コード ${result.status} で終了: ${errMsg}`);
  }

  const stdout = result.stdout || '';

  if (verbose) {
    logger.info(`[claude stdout]\n${stdout}`);
  }

  return extractJson(stdout);
}

/**
 * stdout の末尾から最初に見つかる JSON ブロックを取得する
 * コードブロック(```json ... ```) または生の JSON オブジェクトに対応
 */
function extractJson(text) {
  // ```json ... ``` ブロックを探す（末尾から）
  const codeBlockRe = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  const matches = [...text.matchAll(codeBlockRe)];
  if (matches.length > 0) {
    const last = matches[matches.length - 1][1];
    try {
      return JSON.parse(last);
    } catch {
      // fall through
    }
  }

  // 生 JSON オブジェクト（最後の { ... } を探す）
  const lastBrace = text.lastIndexOf('{');
  if (lastBrace !== -1) {
    const candidate = text.slice(lastBrace);
    try {
      return JSON.parse(candidate);
    } catch {
      // 閉じ括弧を末尾から探してスライス
      for (let i = text.length - 1; i > lastBrace; i--) {
        if (text[i] === '}') {
          try {
            return JSON.parse(text.slice(lastBrace, i + 1));
          } catch {
            // continue
          }
        }
      }
    }
  }

  throw new Error(`claude の出力から JSON を抽出できませんでした。\n出力(末尾500文字):\n${text.slice(-500)}`);
}
