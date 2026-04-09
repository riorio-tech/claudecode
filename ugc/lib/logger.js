const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export const logger = {
  step(stepNum, name) {
    console.log(`\n${CYAN}[Stage ${stepNum}]${RESET} ${name}`);
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
};
