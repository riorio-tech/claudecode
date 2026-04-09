import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

/**
 * Stage 3: Generate 3 script variants using analysis + research.
 * @param {{ analysis: object, researchData: object }} opts
 * @returns {Promise<Array<{ avatarId: string, voiceId: string, hookType: string, script: string }>>}
 */
export async function scriptPlan({ analysis, researchData }) {
  const avatars = config.AVATAR_PROVIDER === 'heygen' ? config.HEYGEN_AVATARS : config.MAKEUGC_AVATARS;
  const voices  = config.AVATAR_PROVIDER === 'heygen' ? config.HEYGEN_VOICES  : config.MAKEUGC_VOICES;
  const provider = config.AVATAR_PROVIDER ?? 'makeugc';

  if (avatars.length < 3) {
    throw new Error(`${provider.toUpperCase()}_AVATARS must have at least 3 comma-separated avatar IDs in .env`);
  }
  if (voices.length < 3) {
    throw new Error(`${provider.toUpperCase()}_VOICES must have at least 3 comma-separated voice IDs in .env`);
  }

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const msg = await client.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `You are a TikTok UGC scriptwriter for Japanese TikTok Shop.

Product analysis: ${JSON.stringify(analysis, null, 2)}
UGC research: ${JSON.stringify(researchData, null, 2)}

Write exactly 3 Japanese UGC scripts. Rules:
- Each script ≤ 1500 characters
- Natural spoken Japanese (first-person reviewer perspective)
- Structure for each: hook (≈2 seconds) → product benefits (≈15 seconds) → CTA (≈5 seconds)
- Total spoken length: 20-25 seconds each
- Use the research data to pick the best phrases and hooks

Hook types MUST be used in this exact order:
  1. 問題提起型: open with a problem/question the viewer has
  2. 驚き数字型: open with a surprising number, price, or statistic
  3. 共感型: open with an empathy statement ("わかる〜" style)

Return ONLY a valid JSON array (no markdown):
[
  { "hookType": "問題提起型", "script": "..." },
  { "hookType": "驚き数字型", "script": "..." },
  { "hookType": "共感型", "script": "..." }
]`,
      },
    ],
  });

  const raw = msg.content[0].text;
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`script-plan: no JSON array in Claude response:\n${raw.slice(0, 300)}`);

  const scripts = JSON.parse(match[0]);

  for (const s of scripts) {
    if (s.script.length > 1500) {
      throw new Error(
        `script-plan: script for hookType "${s.hookType}" is ${s.script.length} chars (max 1500)`
      );
    }
  }

  return scripts.map((s, i) => ({
    avatarId: avatars[i],
    voiceId: voices[i],
    hookType: s.hookType,
    script: s.script,
  }));
}
