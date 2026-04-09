import { readdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Stage 6: Read all pipeline/*.js + lib/*.js, send to Claude for review.
 * Appends result to outputDir/code_review.md and prints SUMMARY to terminal.
 * @param {{ outputDir: string }} opts
 */
export async function codeReview({ outputDir }) {
  const pipelineDir = __dirname;
  const libDir      = join(__dirname, '../lib');

  const selfPath = fileURLToPath(import.meta.url);
  const files = [
    ...collectJsFiles(pipelineDir),
    ...collectJsFiles(libDir),
  ].filter((f) => f !== selfPath);

  const sections = files.map((filePath) => {
    const content = readFileSync(filePath, 'utf8');
    return `### ${filePath}\n\`\`\`js\n${content}\n\`\`\``;
  });

  const MAX_PROMPT_CHARS = 150_000;
  const codeContent = sections.join('\n\n');
  if (codeContent.length > MAX_PROMPT_CHARS) {
    logger.warn(`code-review: prompt is ${codeContent.length} chars, truncating to ${MAX_PROMPT_CHARS}`);
  }
  const promptContent = codeContent.slice(0, MAX_PROMPT_CHARS);

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const msg = await client.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `You are a senior Node.js engineer. Review the following source files from a video generation pipeline.

Evaluate for:
1. **Bugs & missing error handling** — unhandled rejections, missing null checks, edge cases
2. **Security concerns** — API key exposure, injection risks, unsafe operations
3. **Readability & maintainability** — naming, structure, clarity
4. **Performance** — unnecessary awaits, inefficient loops, memory issues

For each issue: state the file name, describe the problem, and suggest a fix.

End your review with a section titled "## SUMMARY" containing 3-5 bullet points of the most important findings.

---

${promptContent}`,
      },
    ],
  });

  const block = msg.content[0];
  if (!block || block.type !== 'text') {
    throw new Error('code-review: unexpected response shape from Claude');
  }
  const review = block.text;
  const timestamp = new Date().toISOString();
  const entry     = `\n\n---\n## Code Review — ${timestamp}\n\n${review}\n`;

  const reviewPath = join(outputDir, 'code_review.md');
  appendFileSync(reviewPath, entry);
  logger.success(`Code review saved → ${reviewPath}`);

  // Print SUMMARY section to terminal
  const summaryMatch = review.match(/## SUMMARY[\s\S]*/i);
  if (summaryMatch) {
    console.log('\n' + summaryMatch[0]);
  } else {
    console.log('\n--- Code Review (last 600 chars) ---');
    console.log(review.slice(-600));
  }
}

function collectJsFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => join(dir, f));
}
