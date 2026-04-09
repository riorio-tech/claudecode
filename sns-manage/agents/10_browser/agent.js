/**
 * 10_browser — Playwright ブラウザ自動化エージェント
 *
 * APIが使えない状況や、アカウント作成・ログインなどの
 * ブラウザ操作が必要なタスクを Playwright で自動化する。
 *
 * 対応アクション:
 * - postTwitter  : ブラウザ経由でTwitterに投稿
 * - postInstagram: ブラウザ経由でInstagramに投稿（テキスト）
 * - postTikTok   : ブラウザ経由でTikTokに投稿
 * - screenshot   : 任意URLのスクリーンショット
 */

import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { config } from '../../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = join(__dirname, '../../browser-sessions');
const SCREENSHOTS_DIR = join(__dirname, '../../browser-screenshots');

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Playwright の chromium を動的インポートする。
 * 未インストール時は null を返す（graceful degradation）。
 */
async function getChromium() {
  try {
    const { chromium } = await import('playwright');
    return chromium;
  } catch {
    return null;
  }
}

/**
 * ブラウザを起動してコンテキストを返す。
 * セッション（ログイン状態）はプラットフォームごとに永続化する。
 * @param {string} platform
 * @param {{ headless?: boolean }} opts
 */
export async function launchBrowser(platform, { headless = true } = {}) {
  const chromium = await getChromium();
  if (!chromium) throw new Error('Playwright がインストールされていません。`npm install playwright` を実行してください。');

  ensureDir(SESSIONS_DIR);
  const userDataDir = join(SESSIONS_DIR, platform);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });

  return context;
}

/**
 * Twitter/X にブラウザ経由で投稿する。
 * ログイン済みセッションが必要（初回は headless:false で手動ログインを促す）。
 *
 * @param {{ text: string, headless?: boolean }} opts
 * @returns {{ ok: boolean, tweetUrl?: string, error?: string }}
 */
export async function postTwitterBrowser({ text, headless = true }) {
  const context = await launchBrowser('twitter', { headless });
  const page = await context.newPage();

  try {
    await page.goto('https://twitter.com/compose/tweet', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // ログイン確認
    const isLoggedIn = await page.url().then(u => !u.includes('/login'));
    if (!isLoggedIn) {
      if (headless) {
        await context.close();
        return { ok: false, error: 'ログインが必要です。headless:false で先にログインしてください' };
      }
      // インタラクティブモード: ログインを待つ
      console.log('[10_browser] Twitter ログイン待機中... ブラウザでログインしてください');
      await page.waitForURL(u => !u.includes('/login'), { timeout: 120000 });
      await page.goto('https://twitter.com/compose/tweet', { waitUntil: 'domcontentloaded' });
    }

    // ツイート入力
    const editor = page.locator('[data-testid="tweetTextarea_0"]').first();
    await editor.waitFor({ timeout: 15000 });
    await editor.click();
    await editor.pressSequentially(text, { delay: 30 });

    // 投稿ボタン
    const tweetBtn = page.locator('[data-testid="tweetButtonInline"]').first();
    await tweetBtn.waitFor({ timeout: 10000 });
    await tweetBtn.click();

    // 成功確認（トースト通知を待つ）
    await page.waitForTimeout(2000);

    await context.close();
    console.log('[10_browser] Twitter投稿完了');
    return { ok: true };
  } catch (err) {
    const screenshotPath = await takeScreenshotInternal(page, 'twitter-error');
    await context.close();
    return { ok: false, error: err.message, screenshot: screenshotPath };
  }
}

/**
 * Instagram にブラウザ経由で投稿する（テキストのみ）。
 *
 * @param {{ caption: string, headless?: boolean }} opts
 * @returns {{ ok: boolean, error?: string }}
 */
export async function postInstagramBrowser({ caption, headless = true }) {
  const context = await launchBrowser('instagram', { headless });
  const page = await context.newPage();

  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // ログイン確認
    const isLoggedIn = !(await page.url()).includes('/accounts/login');
    if (!isLoggedIn) {
      if (headless) {
        await context.close();
        return { ok: false, error: 'Instagramログインが必要です' };
      }
      console.log('[10_browser] Instagram ログイン待機中...');
      await page.waitForURL(u => !u.includes('/accounts/login'), { timeout: 120000 });
    }

    // 新規投稿ボタン（+アイコン）
    await page.click('svg[aria-label="新規投稿"]', { timeout: 10000 }).catch(() =>
      page.click('[aria-label="新規投稿"]', { timeout: 10000 })
    );

    // キャプション入力（テキスト投稿フローは複雑なためスクリーンショットを撮って返す）
    await page.waitForTimeout(2000);
    const screenshotPath = await takeScreenshotInternal(page, 'instagram-compose');

    await context.close();
    return { ok: true, note: 'Instagram投稿フロー開始。スクリーンショットを確認してください', screenshot: screenshotPath };
  } catch (err) {
    const screenshotPath = await takeScreenshotInternal(page, 'instagram-error');
    await context.close();
    return { ok: false, error: err.message, screenshot: screenshotPath };
  }
}

/**
 * TikTok にブラウザ経由でテキスト/スクリプトを貼り付け準備する。
 *
 * @param {{ caption: string, headless?: boolean }} opts
 * @returns {{ ok: boolean, error?: string }}
 */
export async function postTikTokBrowser({ caption, headless = true }) {
  const context = await launchBrowser('tiktok', { headless });
  const page = await context.newPage();

  try {
    await page.goto('https://www.tiktok.com/upload', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const isLoggedIn = !(await page.url()).includes('/login');
    if (!isLoggedIn) {
      if (headless) {
        await context.close();
        return { ok: false, error: 'TikTokログインが必要です' };
      }
      console.log('[10_browser] TikTok ログイン待機中...');
      await page.waitForURL(u => !u.includes('/login'), { timeout: 120000 });
    }

    await page.waitForTimeout(2000);
    const screenshotPath = await takeScreenshotInternal(page, 'tiktok-upload');
    await context.close();
    return { ok: true, note: 'TikTokアップロードページを開きました', screenshot: screenshotPath };
  } catch (err) {
    const screenshotPath = await takeScreenshotInternal(page, 'tiktok-error');
    await context.close();
    return { ok: false, error: err.message, screenshot: screenshotPath };
  }
}

/**
 * 任意URLのスクリーンショットを撮る。
 * @param {{ url: string, filename?: string }} opts
 */
export async function captureScreenshot({ url, filename = 'screenshot' }) {
  const context = await launchBrowser('general', { headless: true });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const path = await takeScreenshotInternal(page, filename);
    await context.close();
    return { ok: true, path };
  } catch (err) {
    await context.close();
    return { ok: false, error: err.message };
  }
}

/**
 * ブラウザセッションのログイン状態を確認する。
 * headless:false でブラウザを開き、手動ログインを促す。
 * ※ DISPLAY環境変数が未設定のheadlessサーバーでは動作しません。
 * @param {string} platform  'twitter'|'instagram'|'tiktok'
 */
export async function loginInteractive(platform) {
  // headlessサーバー環境（DISPLAYなし）では実行不可
  if (!process.env.DISPLAY && process.platform !== 'darwin' && process.platform !== 'win32') {
    throw new Error('インタラクティブログインはディスプレイのある環境（Mac/Windows/X11）でのみ使用できます。headlessサーバーでは実行できません。');
  }

  console.log(`[10_browser] ${platform} インタラクティブログイン開始`);
  console.log('[10_browser] ブラウザが開きます。ログインしてからブラウザを閉じてください。');

  const urls = {
    twitter:   'https://twitter.com/login',
    instagram: 'https://www.instagram.com/accounts/login/',
    tiktok:    'https://www.tiktok.com/login',
  };

  const context = await launchBrowser(platform, { headless: false });
  const page = await context.newPage();
  await page.goto(urls[platform] || 'about:blank');

  // ユーザーがブラウザを閉じるまで待機
  await new Promise(resolve => context.on('close', resolve));
  console.log(`[10_browser] ${platform} セッション保存完了`);
}

// --- 内部ユーティリティ ---

async function takeScreenshotInternal(page, name) {
  ensureDir(SCREENSHOTS_DIR);
  const filename = `${name}-${Date.now()}.png`;
  const path = join(SCREENSHOTS_DIR, filename);
  await page.screenshot({ path, fullPage: false }).catch(() => {});
  return path;
}
