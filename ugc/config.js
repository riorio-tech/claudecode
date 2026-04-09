// ugc/config.js
// Getters ensure env vars are read at call time (not at ES module import time).
export const config = {
  get AVATAR_PROVIDER()    { return process.env.AVATAR_PROVIDER ?? 'makeugc'; },
  get MAKEUGC_API_KEY()    { return process.env.MAKEUGC_API_KEY; },
  get MAKEUGC_AVATARS()    { return process.env.MAKEUGC_AVATARS?.split(',').filter(Boolean) ?? []; },
  get MAKEUGC_VOICES()     { return process.env.MAKEUGC_VOICES?.split(',').filter(Boolean) ?? []; },
  get HEYGEN_API_KEY()     { return process.env.HEYGEN_API_KEY; },
  get HEYGEN_AVATARS()     { return process.env.HEYGEN_AVATARS?.split(',').filter(Boolean) ?? []; },
  get HEYGEN_VOICES()      { return process.env.HEYGEN_VOICES?.split(',').filter(Boolean) ?? []; },
  get CLAUDE_MODEL()       { return process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'; },
  get ANTHROPIC_API_KEY()  { return process.env.ANTHROPIC_API_KEY; },
  OUTPUT_DIR: './output',
};
