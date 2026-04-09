const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';

function timestamp() {
  return new Date().toLocaleTimeString('ja-JP');
}

export const logger = {
  stage(n, name) {
    console.log(`\n${BOLD}${CYAN}[Stage ${n}] ${name}${RESET}`);
  },
  info(msg) {
    console.log(`${DIM}${timestamp()}${RESET} ${msg}`);
  },
  success(msg) {
    console.log(`${GREEN}✓${RESET} ${msg}`);
  },
  warn(msg) {
    console.log(`${YELLOW}⚠${RESET} ${msg}`);
  },
  error(msg) {
    console.error(`${RED}✗${RESET} ${msg}`);
  },
  post(text) {
    console.log(`\n${MAGENTA}${'─'.repeat(50)}${RESET}`);
    console.log(text);
    console.log(`${MAGENTA}${'─'.repeat(50)}${RESET}\n`);
  },
};
