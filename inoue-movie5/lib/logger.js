// ステップ進捗ログ（タイムスタンプ付き）

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export const logger = {
  step(stepNum, name) {
    console.log(`\n${CYAN}[Step ${stepNum}]${RESET} ${name}`);
  },

  info(msg) {
    console.log(`${DIM}${timestamp()}${RESET}  ${msg}`);
  },

  success(msg) {
    console.log(`${GREEN}✓${RESET} ${msg}`);
  },

  warn(msg) {
    console.warn(`${YELLOW}⚠${RESET}  ${msg}`);
  },

  error(msg) {
    console.error(`${RED}✗${RESET} ${msg}`);
  },

  summary(jobId, outputPath, durationSec, qaScore, caption, hashtags) {
    console.log(`
${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}
${GREEN}  完了${RESET}
${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}
  Job ID  : ${jobId}
  動画    : ${outputPath}
  尺      : ${durationSec}秒
  QAスコア: ${qaScore}/100
  キャプション: ${caption}
  ハッシュタグ: ${hashtags.join(' ')}
${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}
`);
  },
};
