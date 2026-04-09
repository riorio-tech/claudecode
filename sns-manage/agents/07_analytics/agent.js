import { z } from 'zod';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { extractJson, validate } from '../../lib/validate-json.js';
import { readJobFile, writeJobFile } from '../../lib/job-dir.js';
import { insertMetrics, markAnalyticsCompleted } from '../../db/db.js';

// ---- Zodスキーマ ----

const AnalyticsOutputSchema = z.object({
  insights: z.string(),
});

// ---- Claude Haiku でインサイト生成 ----

async function generateInsights(platform, impressions, engagementRate, likes, shares) {
  if (!config.ANTHROPIC_API_KEY) {
    logger.warn('[07_analytics] ANTHROPIC_API_KEY 未設定 — インサイト生成をスキップ');
    return '分析データが収集されました。APIキーを設定するとインサイト生成が利用できます。';
  }

  const prompt = `以下の投稿パフォーマンスを分析し、1〜2文の改善提案をしてください:
プラットフォーム: ${platform}
インプレッション: ${impressions}
エンゲージメント率: ${(engagementRate * 100).toFixed(2)}%
いいね: ${likes} / RT: ${shares}
JSON: { "insights": "改善提案テキスト" }`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.CLAUDE_HAIKU_MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude API エラー: ${response.status} ${text}`);
  }

  const data = await response.json();
  const raw = data.content?.[0]?.text ?? '';
  const parsed = extractJson(raw);
  const validated = validate(AnalyticsOutputSchema, parsed);
  return validated.insights;
}

// ---- フォールバック: dry-run またはAPI失敗時 ----

async function generateFallbackInsights(jobId, postId, platform) {
  logger.warn(`[07_analytics] フォールバックモード (jobId: ${jobId}, platform: ${platform})`);

  // writerOutputからコンテンツを読み込んでインサイトを推定
  let contentBody = '';
  try {
    const writerOutput = readJobFile(jobId, '03_writer-output.json');
    const content = writerOutput.contents?.find(c => c.platform === platform);
    contentBody = content?.caption || '';
  } catch {
    logger.warn('[07_analytics] 03_writer-output.json の読み込みに失敗。コンテンツなしで推定');
  }

  // 推定メトリクス（フォールバック時は0）
  const metrics = {
    impressions: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    linkClicks: 0,
    followerDelta: 0,
    engagementRate: 0,
  };

  // DB保存
  await insertMetrics({
    postId,
    impressions: metrics.impressions,
    likes: metrics.likes,
    comments: metrics.comments,
    shares: metrics.shares,
    engagementRate: metrics.engagementRate,
  });

  // インサイト生成（コンテンツがあれば参考にする）
  let insights = '投稿データをまだ収集できていません。24時間後に再度確認することをお勧めします。';
  if (config.ANTHROPIC_API_KEY && contentBody) {
    try {
      const prompt = `以下の投稿コンテンツの推定パフォーマンス分析と改善提案を1〜2文でしてください:
プラットフォーム: ${platform}
投稿内容: ${contentBody.slice(0, 200)}
注意: 実際のメトリクスはまだ取得できていません（dry-runまたはAPI未対応）
JSON: { "insights": "改善提案テキスト" }`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.CLAUDE_HAIKU_MODEL,
          max_tokens: 512,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const raw = data.content?.[0]?.text ?? '';
        const parsed = extractJson(raw);
        const validated = validate(AnalyticsOutputSchema, parsed);
        insights = validated.insights;
      }
    } catch (err) {
      logger.warn(`[07_analytics] フォールバックインサイト生成失敗: ${err.message}`);
    }
  }

  return {
    metrics,
    insights,
    tweetId: null,
    manual: true,
  };
}

// ---- Twitter Metrics API 呼び出し ----

async function fetchTwitterMetrics(tweetId) {
  const response = await fetch(
    `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=public_metrics`,
    { headers: { Authorization: `Bearer ${config.TWITTER_BEARER_TOKEN}` } }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Twitter API エラー: ${response.status} ${text}`);
  }

  const data = await response.json();
  const pm = data.data?.public_metrics;
  if (!pm) {
    throw new Error('Twitter APIレスポンスに public_metrics が含まれていません');
  }

  return pm;
}

// ---- フォロワー変化取得 ----

async function fetchFollowerDelta() {
  if (!config.TWITTER_USER_ID) {
    return 0;
  }

  try {
    const response = await fetch(
      `https://api.twitter.com/2/users/${config.TWITTER_USER_ID}?user.fields=public_metrics`,
      { headers: { Authorization: `Bearer ${config.TWITTER_BEARER_TOKEN}` } }
    );

    if (!response.ok) {
      logger.warn(`[07_analytics] フォロワー数取得失敗: ${response.status}`);
      return 0;
    }

    const data = await response.json();
    // 変化量は計算できないため現在値を返す（scheduler側で差分計算が必要）
    return data.data?.public_metrics?.followers_count ?? 0;
  } catch (err) {
    logger.warn(`[07_analytics] フォロワー数取得エラー: ${err.message}`);
    return 0;
  }
}

// ---- メインエントリーポイント ----

/**
 * 07_analytics エージェント: 投稿のメトリクスを収集してDB・ファイルに保存する。
 * @param {string} jobId
 * @param {number} postId - DBのposts.id（整数）
 * @param {string} platform - 'twitter' など
 * @param {{ scheduleId?: number }} options
 */
export async function runAnalytics(jobId, postId, platform, { scheduleId } = {}) {
  logger.step(7, 'analytics');
  logger.info(`jobId: ${jobId}  postId: ${postId}  platform: ${platform}`);

  // Step 1: 06_publish-output.json から tweetId を取得
  let tweetId = null;
  try {
    const publishOutput = readJobFile(jobId, '06_publish-output.json');
    const publishResult = publishOutput.publishResults?.find(
      r => r.platform === platform && r.status === 'published'
    );
    tweetId = publishResult?.postId ?? null;
  } catch (err) {
    logger.warn(`[07_analytics] 06_publish-output.json の読み込み失敗: ${err.message}`);
  }

  // dry-run または postId なし → フォールバック
  if (!tweetId || tweetId === 'dry-run') {
    logger.info('[07_analytics] tweetId なし → フォールバックモードへ');
    const fallback = await generateFallbackInsights(jobId, postId, platform);

    const output = {
      jobId,
      platform,
      postId,
      tweetId: null,
      metrics: fallback.metrics,
      insights: fallback.insights,
      manual: true,
      collectedAt: new Date().toISOString(),
    };

    writeJobFile(jobId, '07_analytics-output.json', output);

    if (scheduleId) {
      await markAnalyticsCompleted(scheduleId);
    }

    logger.success('07_analytics 完了（フォールバックモード）');
    return output;
  }

  // Step 2: Bearer Token チェック
  if (!config.TWITTER_BEARER_TOKEN) {
    logger.warn('[07_analytics] TWITTER_BEARER_TOKEN 未設定 → フォールバックモードへ');
    const fallback = await generateFallbackInsights(jobId, postId, platform);

    const output = {
      jobId,
      platform,
      postId,
      tweetId,
      metrics: fallback.metrics,
      insights: fallback.insights,
      manual: true,
      collectedAt: new Date().toISOString(),
    };

    writeJobFile(jobId, '07_analytics-output.json', output);

    if (scheduleId) {
      await markAnalyticsCompleted(scheduleId);
    }

    logger.success('07_analytics 完了（フォールバックモード）');
    return output;
  }

  // Step 3: Twitter Metrics API 呼び出し
  let pm;
  let manual = false;
  let metrics;

  try {
    pm = await fetchTwitterMetrics(tweetId);

    const engagementRate = pm.impression_count > 0
      ? (pm.like_count + pm.retweet_count + pm.reply_count) / pm.impression_count
      : 0;

    const followerDelta = await fetchFollowerDelta();

    metrics = {
      impressions: pm.impression_count || 0,
      likes: pm.like_count || 0,
      comments: pm.reply_count || 0,
      shares: pm.retweet_count || 0,
      linkClicks: 0,
      followerDelta,
      engagementRate,
    };

    // Step 4: DB保存
    await insertMetrics({
      postId,
      impressions: metrics.impressions,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      engagementRate: metrics.engagementRate,
    });

    logger.success(`[07_analytics] メトリクス取得成功: imp=${metrics.impressions} like=${metrics.likes} rt=${metrics.shares}`);
  } catch (err) {
    logger.warn(`[07_analytics] Twitter API失敗 → フォールバックへ: ${err.message}`);
    const fallback = await generateFallbackInsights(jobId, postId, platform);

    const output = {
      jobId,
      platform,
      postId,
      tweetId,
      metrics: fallback.metrics,
      insights: fallback.insights,
      manual: true,
      collectedAt: new Date().toISOString(),
    };

    writeJobFile(jobId, '07_analytics-output.json', output);

    if (scheduleId) {
      await markAnalyticsCompleted(scheduleId);
    }

    logger.success('07_analytics 完了（フォールバックモード）');
    return output;
  }

  // Step 5: Claude Haiku でインサイト生成
  let insights = '';
  try {
    insights = await generateInsights(
      platform,
      metrics.impressions,
      metrics.engagementRate,
      metrics.likes,
      metrics.shares
    );
  } catch (err) {
    logger.warn(`[07_analytics] インサイト生成失敗: ${err.message}`);
    insights = 'インサイトの生成に失敗しました。メトリクスを確認してください。';
  }

  // Step 6: 出力ファイル書き込み
  const output = {
    jobId,
    platform,
    postId,
    tweetId,
    metrics,
    insights,
    manual,
    collectedAt: new Date().toISOString(),
  };

  writeJobFile(jobId, '07_analytics-output.json', output);

  // Step 7: スケジュール完了マーク
  if (scheduleId) {
    await markAnalyticsCompleted(scheduleId);
  }

  logger.success('07_analytics 完了');
  return output;
}
