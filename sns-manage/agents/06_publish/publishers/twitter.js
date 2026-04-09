import crypto from 'crypto';
import { config } from '../../../config.js';
import { logger } from '../../../lib/logger.js';

const TWITTER_API_URL = 'https://api.twitter.com/2/tweets';

/**
 * OAuth 1.0a 署名付き Authorization ヘッダーを生成する。
 * @param {string} method HTTPメソッド
 * @param {string} url エンドポイントURL
 * @param {object} bodyParams リクエストボディのパラメータ（署名対象）
 * @returns {string} Authorization ヘッダーの値
 */
function buildOAuthHeader(method, url, bodyParams = {}) {
  const oauthParams = {
    oauth_consumer_key: config.TWITTER_API_KEY,
    oauth_nonce: crypto.randomBytes(32).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: config.TWITTER_ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  // 署名ベース文字列の作成
  const allParams = { ...oauthParams, ...bodyParams };
  const paramStr = Object.keys(allParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const signatureBase = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(paramStr),
  ].join('&');

  // 署名キーの作成
  const signingKey = [
    encodeURIComponent(config.TWITTER_API_SECRET),
    encodeURIComponent(config.TWITTER_ACCESS_SECRET),
  ].join('&');

  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(signatureBase)
    .digest('base64');

  oauthParams.oauth_signature = signature;

  // Authorization ヘッダーの組み立て
  const authHeader = 'OAuth ' + Object.keys(oauthParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');

  return authHeader;
}

/**
 * Twitter API v2 を使ってツイートを投稿する。
 * @param {{ text: string, dryRun?: boolean }} options
 * @returns {Promise<{ post_id: string, post_url: string }>}
 */
export async function publishToTwitter({ text, dryRun = false }) {
  if (dryRun) {
    logger.info(`[Twitter dryRun] 投稿テキスト:\n${text}`);
    return { post_id: 'dry-run', post_url: 'dry-run' };
  }

  const body = JSON.stringify({ text });
  const authHeader = buildOAuthHeader('POST', TWITTER_API_URL);

  const response = await fetch(TWITTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Twitter API エラー (${response.status}): ${errText}`);
  }

  const json = await response.json();
  const tweetId = json.data.id;
  const post_url = `https://twitter.com/i/web/status/${tweetId}`;

  return { post_id: tweetId, post_url };
}
