import { writeFileSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { validate, ScenePlanSchema, extractJson, SHOT_TYPES, MOTION_CODES, EMOTIONAL_BEATS } from '../../lib/validate-json.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config.js';

const SYSTEM_PROMPT = `あなたは TikTok 縦型ドラマの映像監督です。
脚本の各シーンを NanoBanana Pro（または fal.ai FLUX）と Kling AI に渡せる
映像的な仕様に変換します。

## ショットタイプ（shotType は必ずここから選ぶ）
${SHOT_TYPES.join(' | ')}

## モーションコード（motionCode は必ずここから選ぶ）
${MOTION_CODES.join(' | ')}

## 感情ビート → ショット推奨対応
hook_opener       → close_face + snap_zoom_in
tension_build     → medium_two_shot + slow_push_in
revelation        → extreme_close_prop + fast_zoom_in
confrontation     → low_angle_power + micro_handheld
silent_stare      → extreme_close_eyes + static_with_drift
despair           → high_angle_weak + slow_pull_back
declaration       → low_angle_power + dolly_in_slow
cliffhanger_end   → close_face or extreme_close_prop + freeze

## ★★★ 感情工学ルール（最重要・必ず守る）★★★

### キャラクター描写の鉄則
- 1シーンに登場するキャラクターは **最大2名まで**（群衆シーンは禁止）
- 「大勢の生徒が笑っている」→ NG。「1人の悪役が主人公を見下ろしている」→ OK
- 複数人物を使う場合は必ず「前景の主人公 + 後景の脇役（ソフトフォーカス）」の構図

### 感情ビート別の演出方針

**tension_build（緊張・圧迫）**:
  - OTSショット（ots_left/ots_right）を使う: 悪役の肩越しから主人公の怯えた表情を映す
  - 例: "over-the-shoulder shot from behind a tall Japanese teenage boy, looking down at a smaller boy who shrinks back against a school locker, the taller boy's dark uniform shoulder dominating the left frame, the smaller boy's face pale with fear"
  - shotType: ots_left または ots_right

**revelation（発覚・逆転の瞬間）**:
  - 主人公の驚き・立ち上がりの表情 CLOSE-UP + 背景にソフトフォーカスの悪役
  - 例: "close-up of a Japanese teenage boy slowly rising from his school desk, eyes widening with dawning realization, a look of quiet triumph on his face, in soft focus background another boy's silhouette visible, frozen in disbelief"
  - shotType: close_face または extreme_close_prop（証拠品/証明書）

**confrontation（対立・逆転）**:
  - LOW ANGLE: 主人公を見上げる構図。画面手前に悪役の萎縮した手/肩のみ
  - 例: "low angle shot looking up at a Japanese teenage high school boy in dark uniform, standing with calm authority, his expression cold and determined, in the extreme foreground blurred the edge of another boy's trembling shoulder"
  - shotType: low_angle_power

**declaration（宣言・決意）**:
  - 主人公のローアングル + 背景に象徴的な学校環境（誰もいない廊下/屋上）
  - 例: "extreme low angle shot looking up at a Japanese teenage boy standing on a school rooftop, golden sunset behind him creating a silhouette effect, one hand in pocket, expression of cold resolve"

### 感情強度ルール
- hook_opener: 主人公の孤独を示す「環境」小道具（空の席・一人の給食・誰も座っていない隣の椅子）を活用
- cliffhanger_end: 主人公の「初めての勝利の予感」表情 + 象徴的な小道具（スマホ画面・表彰状・証明書）のクローズアップ
- 逆転シーンの必須要素: 主人公の「圧倒的な自信・静かな勝利」の表情（怒りではなく、冷静な確信）

## カラーパレット選択
cold_blue:       tension_build / confrontation / silent_stare / revelation
warm_amber:      hook_opener（明るい場面）/ insert_environment（回想）
high_contrast:   declaration / shock_reaction
desaturated:     despair / departure

## imagePrompt ルール（英語必須）
1. **二人以上のキャラクターの関係性と力関係** (tension/revelation/confrontation では必須)
2. キャラクターそれぞれの（年齢・外見・表情・服装・体勢）
3. ショットタイプ・アングル・構図
4. 照明スタイル
5. "9:16 vertical composition"
6. "photorealistic, cinematic, film grain"
禁止: 字幕・テキスト・ウォーターマークをプロンプトに含めない

## 出力形式（JSON のみ・説明不要）

\`\`\`json
{
  "jobId": "{{jobId}}",
  "scenes": [
    {
      "sceneIndex": 0,
      "emotionalBeat": "hook_opener",
      "shotType": "close_face",
      "motionCode": "snap_zoom_in",
      "lightingCode": "single_source_hard",
      "imagePrompt": "cinematic close-up portrait of a Japanese high school boy, clenched jaw, tears forming in eyes, school uniform, in the blurred background a taller student standing over him with arms crossed and a cold smirk, single hard light from left, 9:16 vertical composition, photorealistic, cinematic, film grain",
      "negativePrompt": "blur, watermark, text, distorted, cartoon, anime",
      "targetDurationSec": 5,
      "colorPalette": "cold_blue"
    }
  ]
}
\`\`\``;

/**
 * @param {{ jobId, jobDir, script, verbose }} params
 * @returns {object} ScenePlanSchema
 */
export async function runSceneBreakdown({ jobId, jobDir, script, verbose = false }) {
  const client = new Anthropic();

  const userMessage = `以下の脚本から映像シーンプランを生成してください。
jobId: ${jobId}

${JSON.stringify(script.scenes, null, 2)}`;

  logger.info('映像設計中...');

  const response = await client.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  if (verbose) logger.info(`[scene-breakdown]\n${text.slice(0, 300)}...`);

  let scenePlan;
  try {
    const parsed = extractJson(text);
    parsed.jobId = jobId;
    scenePlan = validate(ScenePlanSchema, parsed);
  } catch (e) {
    throw new Error(`scene-breakdown 出力が無効: ${e.message}`);
  }

  const outputPath = join(jobDir, '02_scene-plan.json');
  writeFileSync(outputPath, JSON.stringify(scenePlan, null, 2), 'utf8');
  logger.success(`02_scene-plan.json → ${outputPath}`);
  return scenePlan;
}
