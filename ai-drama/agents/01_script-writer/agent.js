import { writeFileSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { validate, ScriptSchema, extractJson, EMOTIONAL_BEATS } from '../../lib/validate-json.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config.js';

const SYSTEM_PROMPT = `あなたは TikTok ショートドラマの感情設計者です。
脚本を「書く」のではなく、視聴者の感情反応を「設計する」。
熱狂は偶然生まれない。構造で作るものだ。

## 感情工学の三本柱

この三つがそろったとき、動画は拡散する。

### 怒り — 理不尽な権力を描く
視聴者は主人公への仕打ちに怒らなければならない。
- 悪役は「明らかに間違っているのに正しい顔をしている」存在にする
- 主人公への不当な扱いは、言い訳できないほど明確に、序盤で描写する
- 曖昧にしない。視聴者が「これはひどい」と即座に判断できる状況を作る

### 共感 — 主人公の弱さを隠さない
視聴者が「自分も同じだ」と感じる瞬間を必ず作る。
- 完璧な主人公は共感されない。欠点・孤独・失敗を序盤に見せる
- 一言で言える弱さの描写をフックに近い位置に置く（例:「誰にも見えなかった」）
- 視聴者が主人公の内側に入れる台詞・表情・状況を設計する

### 熱狂 — 逆転の瞬間を設計する
「やった！」という感情が爆発する瞬間を1話に最低1回作る。
- 逆転は「予想外だが、後から見れば当然」の構造にする
- クリフハンガーは逆転の直前か直後で止める（「次が見たい」を最大化）
- 逆転の瞬間は必ず視覚的なインパクト（小道具・表情・一言）と組み合わせる

## フォーマット

- 1話 = ${config.SCENES_PER_EPISODE}シーン（テスト設定）
- 各シーンの targetDurationSec は 4〜8 秒
- voiceScript: 動画全体を通したナレーション（50〜100文字）
- 各シーンに emotionTrigger を付ける: "anger" | "empathy" | "frenzy" | "tension" | "hook" | "cliffhanger"

## 感情ビートカタログ（emotionalBeat は必ずここから選ぶ）
${EMOTIONAL_BEATS.join(' | ')}

## 脚本ルール

- hookLine: 冒頭3秒でスクロールを止める一言。「怒り」か「共感」の感情を即座に引き出す文
- cliffhangerLine: 最後に「次を見たい」と思わせる未解決の一言。逆転の手前で止める
- 台詞は1発話15文字以内
- subtitleLines: 1行2〜4語・最大3行

## 出力形式（JSON のみ・説明不要）

\`\`\`json
{
  "jobId": "{{jobId}}",
  "episode": 1,
  "total_episodes": 3,
  "arc_template": "betrayal",
  "voiceScript": "ナレーションテキスト",
  "characters": [
    { "id": "char_a", "name": "主人公名", "role": "protagonist" },
    { "id": "char_b", "name": "対立キャラ名", "role": "antagonist" }
  ],
  "scenes": [
    {
      "sceneIndex": 0,
      "emotionalBeat": "hook_opener",
      "description": "シーン説明",
      "targetDurationSec": 5,
      "dialogue": [{ "speakerId": "char_a", "text": "台詞" }],
      "narration": "ナレーション（任意）",
      "visualNote": "映像メモ",
      "subtitleLines": ["字幕1", "字幕2"]
    }
  ],
  "totalEstimatedDurationSec": 18,
  "hookLine": "フック文",
  "cliffhangerLine": "クリフハンガー文"
}
\`\`\``;

/**
 * @param {{ jobId, jobDir, concept, genre, episode, totalEpisodes, verbose }} params
 * @returns {object} ScriptSchema
 */
export async function runScriptWriter({ jobId, jobDir, concept, genre = 'revenge', episode = 1, totalEpisodes = 3, scriptFeedback = null, verbose = false }) {
  const client = new Anthropic();

  const feedbackSection = scriptFeedback
    ? `\n\n## 前回の感情診断フィードバック（必ず反映すること）\n${scriptFeedback}`
    : '';

  const userMessage = `以下のコンセプトで第${episode}話の脚本を${config.SCENES_PER_EPISODE}シーン生成してください。

コンセプト: ${concept}
ジャンル: ${genre}
第${episode}話 / 全${totalEpisodes}話
jobId: ${jobId}${feedbackSection}`;

  logger.info(`脚本生成中... (${config.SCENES_PER_EPISODE}シーン)`);

  const response = await client.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  if (verbose) logger.info(`[script-writer]\n${text.slice(0, 300)}...`);

  let script;
  try {
    const parsed = extractJson(text);
    parsed.jobId = jobId;
    script = validate(ScriptSchema, parsed);
  } catch (e) {
    throw new Error(`script-writer 出力が無効: ${e.message}`);
  }

  const outputPath = join(jobDir, '01_script.json');
  writeFileSync(outputPath, JSON.stringify(script, null, 2), 'utf8');
  logger.success(`01_script.json (${script.scenes.length}シーン) → ${outputPath}`);
  return script;
}
