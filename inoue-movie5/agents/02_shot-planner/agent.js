import { writeFileSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { validate, ShotPlanV2Schema } from '../../lib/validate-json.js';
import { logger } from '../../lib/logger.js';
import { getTopPatterns } from '../../db/db.js';
import { config } from '../../config.js';

const getClient = () => new Anthropic();

const SYSTEM_PROMPT = `あなたは TikTok Shop の動画ディレクター兼台本ライターです。
商品情報を受け取り、1商品につき10本分のショットプランを生成してください。

## クリップ設計（v2: 10カット×1秒 = 合計10秒）

各動画は**10カット構成・各1秒固定**。
カット間の視点・距離・動きを必ず変化させること（同じ angleHint を連続させない）。

### ショット構成テンプレート（全動画共通 Shot 03〜09）

| index | role    | durationSec | angleHint        | motionHint         |
|-------|---------|-------------|------------------|--------------------|
| 3     | benefit | 1           | extreme_close    | slow_push_in       |
| 4     | benefit | 1           | overhead_flatlay | micro_drift        |
| 5     | benefit | 1           | orbit            | continuous_orbit   |
| 6     | benefit | 1           | hand_hold_pov    | gentle_sway        |
| 7     | proof   | 1           | lifestyle_scene  | parallax_drift     |
| 8     | proof   | 1           | split_comparison | slide_wipe_left    |
| 9     | cta     | 1           | hero_low_angle   | dolly_in_tilt_up   |

### HOOKカット Shot 00〜02（hookVariantごとに変える）

各 hookVariant で Shot 00〜02 の angleHint × motionHint 組み合わせを変えること。
10本で重複しないよう以下を各バリアントに割り当てる:

| hookVariant | Shot00 angle×motion | Shot01 angle×motion | Shot02 angle×motion |
|-------------|---------------------|---------------------|---------------------|
| 問題提起型 | shake_impact×fast_drop_bounce | dutch_angle×slow_roll | pull_back_reveal×zoom_out_fast |
| 驚き数字型 | pull_back_reveal×zoom_out_fast | shake_impact×fast_drop_bounce | dutch_angle×slow_roll |
| ビフォーアフター型 | dutch_angle×slow_roll | pull_back_reveal×zoom_out_fast | shake_impact×fast_drop_bounce |
| 疑問型 | shake_impact×fast_drop_bounce | pull_back_reveal×zoom_out_fast | dutch_angle×slow_roll |
| 共感型 | dutch_angle×slow_roll | shake_impact×fast_drop_bounce | pull_back_reveal×zoom_out_fast |
| ストーリー型 | pull_back_reveal×zoom_out_fast | dutch_angle×slow_roll | shake_impact×fast_drop_bounce |
| 警告型 | shake_impact×fast_drop_bounce | dutch_angle×slow_roll | pull_back_reveal×zoom_out_fast |
| 直接訴求型 | pull_back_reveal×zoom_out_fast | shake_impact×fast_drop_bounce | dutch_angle×slow_roll |
| UGC風型 | dutch_angle×slow_roll | pull_back_reveal×zoom_out_fast | shake_impact×fast_drop_bounce |
| 限定性型 | shake_impact×fast_drop_bounce | pull_back_reveal×zoom_out_fast | dutch_angle×slow_roll |

## angleHint カタログ

| angleHint | 説明 |
|-----------|------|
| shake_impact | 落下・衝撃演出、両手で持ち上げ |
| pull_back_reveal | 超接写→引いて全体像 |
| dutch_angle | 15〜30°傾いた構図 |
| extreme_close | テクスチャ・素材の超接写 |
| overhead_flatlay | 真上からの俯瞰 |
| hand_hold_pov | 手で持つ一人称視点 |
| orbit | 商品周囲をカメラが回る |
| hero_low_angle | やや下から見上げる正面 |
| lifestyle_scene | 実際の使用シーンに配置 |
| split_comparison | 左右ビフォーアフター |

## motionHint カタログ

| motionHint | 説明 |
|------------|------|
| fast_drop_bounce | 上から落下してバウンス |
| zoom_out_fast | 一気に引くリバースズーム |
| slow_push_in | ゆっくり寄っていく |
| continuous_orbit | 商品を中心に水平に回転 |
| gentle_sway | ゆっくり揺れる |
| parallax_drift | 背景と前景の微速ドリフト |
| slide_wipe_left | 左方向へのスライドワイプ |
| dolly_in_tilt_up | 寄りながらチルトアップ |
| micro_drift | 極小のゆるドリフト |
| slow_roll | ゆっくり傾き回転 |

## HOOKバリエーション10種（10本それぞれ異なるhookVariantを使う）

1. 問題提起型: 視聴者の悩みを直接指摘
2. 驚き数字型: 具体的な数字・実績で引く
3. ビフォーアフター型: 変化の対比で興味を引く
4. 疑問型: "なぜ？"で好奇心を刺激
5. 共感型: "あるある"で引き込む
6. ストーリー型: 偶然の発見ナラティブ
7. 警告型: "これ使わないで"で損失回避
8. 直接訴求型: 価格・コスパを前面に
9. UGC風型: リアルな口コミ感
10. 限定性型: 希少性・タイミングを演出

## overlayText のルール（重要）

- 最大20文字（日本語）
- HOOKカット: 視聴者を止める一言
- BENEFITカット: 商品の最強の特徴
- PROOFカット: 数字・実績・社会的証明
- CTAカット: 購買を後押しする一言（「今すぐチェック」など）

## 出力形式

以下の JSON のみを出力してください（説明・コメント不要）:

\`\`\`json
{
  "jobId": "{{jobId}}",
  "productSummary": {
    "target": "誰が",
    "pain": "どんな悩みを持っているか",
    "solution": "商品がどう解決するか"
  },
  "videos": [
    {
      "videoIndex": 0,
      "hookVariant": "問題提起型",
      "voiceScript": "動画全体のナレーション（60〜80文字）",
      "shots": [
        { "index": 0, "role": "hook",    "durationSec": 1, "scriptHint": "衝撃の開幕", "overlayText": "〇〇で悩んでる？",      "motionHint": "fast_drop_bounce", "angleHint": "shake_impact" },
        { "index": 1, "role": "hook",    "durationSec": 1, "scriptHint": "傾いた構図でインパクト", "overlayText": "実はこれ…",   "motionHint": "slow_roll",        "angleHint": "dutch_angle" },
        { "index": 2, "role": "hook",    "durationSec": 1, "scriptHint": "全体像を引きで見せる",  "overlayText": "正体はこれ",    "motionHint": "zoom_out_fast",    "angleHint": "pull_back_reveal" },
        { "index": 3, "role": "benefit", "durationSec": 1, "scriptHint": "...", "overlayText": "...", "motionHint": "slow_push_in",      "angleHint": "extreme_close" },
        { "index": 4, "role": "benefit", "durationSec": 1, "scriptHint": "...", "overlayText": "...", "motionHint": "micro_drift",       "angleHint": "overhead_flatlay" },
        { "index": 5, "role": "benefit", "durationSec": 1, "scriptHint": "...", "overlayText": "...", "motionHint": "continuous_orbit",  "angleHint": "orbit" },
        { "index": 6, "role": "benefit", "durationSec": 1, "scriptHint": "...", "overlayText": "...", "motionHint": "gentle_sway",       "angleHint": "hand_hold_pov" },
        { "index": 7, "role": "proof",   "durationSec": 1, "scriptHint": "...", "overlayText": "...", "motionHint": "parallax_drift",    "angleHint": "lifestyle_scene" },
        { "index": 8, "role": "proof",   "durationSec": 1, "scriptHint": "...", "overlayText": "...", "motionHint": "slide_wipe_left",   "angleHint": "split_comparison" },
        { "index": 9, "role": "cta",     "durationSec": 1, "scriptHint": "購買を後押し", "overlayText": "今すぐチェック", "motionHint": "dolly_in_tilt_up", "angleHint": "hero_low_angle" }
      ]
    }
    // ... 10本分（videoIndex: 0〜9）
  ]
}
\`\`\``;

/**
 * 10本分のショットプランを生成する
 *
 * @param {{ jobId: string, jobDir: string, analyzeOutput: object, verbose: boolean }} params
 * @returns {object} 02_shot-plan.json の内容
 */
export async function runShotPlanner({ jobId, jobDir, analyzeOutput, verbose }) {
  // DBから勝ちパターンを取得（あれば参照）
  const topPatterns = getTopPatterns(3);
  const patternContext = topPatterns.length > 0
    ? `\n\n## 過去の勝ちパターン（参考にしてください）\n${topPatterns.map(p =>
        `- hookVariant: ${p.hook_variant} / CVR向上: +${((p.cvr_lift - 1) * 100).toFixed(0)}% / ${p.impressions}imp`
      ).join('\n')}`
    : '';

  const userMessage = `以下の商品情報から10本分のショットプランを生成してください。
${patternContext}

## 商品情報
${JSON.stringify(analyzeOutput.normalizedProduct, null, 2)}

jobId: ${jobId}`;

  let shotPlan;
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) {
      logger.warn(`shot-planner リトライ... (試行 ${attempt}/2)`);
    }

    const messages = [{ role: 'user', content: userMessage }];
    if (attempt === 2 && lastError) {
      messages.push({ role: 'assistant', content: 'エラーが発生しました。修正して再出力します。' });
      messages.push({ role: 'user', content: `前回のエラー: ${lastError}\n\nJSON のみを出力してください。jobId は "${jobId}" です。` });
    }

    const response = await getClient().messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages,
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    if (verbose) {
      logger.info(`[shot-planner response]\n${text.slice(0, 500)}...`);
    }

    try {
      const parsed = extractJson(text);
      parsed.jobId = jobId;
      shotPlan = validate(ShotPlanV2Schema, parsed);
      break;
    } catch (e) {
      lastError = e.message;
      if (attempt === 2) {
        throw new Error(`shot-planner の出力が無効です: ${e.message}`);
      }
    }
  }

  const outputPath = join(jobDir, '02_shot-plan.json');
  writeFileSync(outputPath, JSON.stringify(shotPlan, null, 2), 'utf8');
  logger.success(`02_shot-plan.json (${shotPlan.videos.length}本分) → ${outputPath}`);
  return shotPlan;
}

function extractJson(text) {
  const codeBlockRe = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  const matches = [...text.matchAll(codeBlockRe)];
  if (matches.length > 0) {
    return JSON.parse(matches[matches.length - 1][1]);
  }
  const lastBrace = text.lastIndexOf('{');
  if (lastBrace !== -1) {
    const sub = text.slice(lastBrace);
    const lastClose = sub.lastIndexOf('}');
    if (lastClose !== -1) return JSON.parse(sub.slice(0, lastClose + 1));
  }
  throw new Error('JSON ブロックが見つかりません');
}
