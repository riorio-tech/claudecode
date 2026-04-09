// カラーコード定数
const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';

function timestamp() {
  return `${DIM}[${new Date().toISOString()}]${RESET}`;
}

export const logger = {
  /**
   * ステップ表示（例: [Step 1] content-plan）
   * @param {number} stepNum
   * @param {string} name
   */
  step(stepNum, name) {
    console.log(`\n${CYAN}[Step ${stepNum}]${RESET} ${name}`);
  },

  /**
   * 一般情報ログ
   * @param {string} msg
   */
  info(msg) {
    console.log(`${timestamp()} ${msg}`);
  },

  /**
   * 成功ログ（緑）
   * @param {string} msg
   */
  success(msg) {
    console.log(`${timestamp()} ${GREEN}✔ ${msg}${RESET}`);
  },

  /**
   * 警告ログ（黄）
   * @param {string} msg
   */
  warn(msg) {
    console.warn(`${timestamp()} ${YELLOW}⚠ ${msg}${RESET}`);
  },

  /**
   * エラーログ（赤）
   * @param {string} msg
   */
  error(msg) {
    console.error(`${timestamp()} ${RED}✖ ${msg}${RESET}`);
  },
};
