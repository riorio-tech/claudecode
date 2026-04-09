# inoue-movie6 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 商品画像をCLIに渡すと、TikTok Shop向け縦型動画（1080×1920, 20〜25秒）が自動生成されるパイプラインを構築する

**Architecture:** ingest → plan → render → qa の4エージェントがJSON経由で連携。sharp でフレームを合成し ffmpeg で動画化。テンプレート切り替えでA/Bテストに対応。すべての成果物は `/tmp/inoue-job-{jobId}/` に保存。

**Tech Stack:** TypeScript 5 (strict), Node.js 20+, tsx, @anthropic-ai/sdk, sharp, @ffmpeg-installer/ffmpeg, better-sqlite3, commander, zod, pnpm

---

## ファイルマップ

```
inoue-movie6/
├── src/
│   ├── agents/
│   │   ├── ingest/
│   │   │   ├── agent.ts       # Claude Vision → ProductInfo
│   │   │   └── schema.ts      # ProductInfo zod schema + type
│   │   ├── plan/
│   │   │   ├── agent.ts       # Claude → ShotPlan
│   │   │   └── schema.ts      # ShotPlan/Cut zod schema + type
│   │   ├── render/
│   │   │   ├── agent.ts       # sharp + ffmpeg → video.mp4
│   │   │   └── schema.ts      # RenderInput/Output types
│   │   └── qa/
│   │       ├── agent.ts       # QA checks + caption生成
│   │       └── schema.ts      # QAResult type
│   ├── video/
│   │   ├── renderer.ts        # ffmpeg ラッパー（clip作成・連結）
│   │   ├── frame.ts           # sharp フレーム合成
│   │   └── templates/
│   │       ├── Standard/index.ts   # 白背景・商品中央テンプレート
│   │       └── Minimal/index.ts    # 黒背景・全面テンプレート
│   ├── lib/
│   │   ├── claude.ts          # Anthropic client factory
│   │   ├── job.ts             # jobId + /tmp/inoue-job-{id}/ 管理
│   │   └── logger.ts          # 構造化ログ
│   └── db/
│       └── db.ts              # better-sqlite3（graceful degradation）
├── cli.ts                     # commander エントリーポイント
├── config.ts                  # 定数・プロバイダ設定
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Task 1: プロジェクトスキャフォールド

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`

- [ ] **Step 1: package.json を作成する**

```json
{
  "name": "inoue-movie6",
  "version": "0.1.0",
  "description": "TikTok Shop 商品動画 自動生成パイプライン",
  "type": "module",
  "engines": { "node": ">=20.0.0" },
  "bin": { "inoue-movie6": "./cli.ts" },
  "scripts": {
    "start": "tsx cli.ts",
    "test": "node --import tsx/esm --test 'src/**/*.test.ts'",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "@ffmpeg-installer/ffmpeg": "^1.1.0",
    "better-sqlite3": "^9.4.0",
    "commander": "^12.0.0",
    "dotenv": "^16.0.0",
    "sharp": "^0.33.0",
    "uuid": "^10.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: tsconfig.json を作成する**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src/**/*", "cli.ts", "config.ts"]
}
```

- [ ] **Step 3: .env.example を作成する**

```
ANTHROPIC_API_KEY=sk-ant-...
FAL_KEY=                   # 画像生成（将来対応）
VIDEO_TEMPLATE=Standard    # Standard | Minimal
```

- [ ] **Step 4: 依存関係をインストールする**

```bash
pnpm install
```

Expected: `node_modules/` が作成される

- [ ] **Step 5: コミット**

```bash
git init
git add package.json tsconfig.json .env.example
git commit -m "chore: プロジェクトスキャフォールド"
```

---

## Task 2: 設定・共通ユーティリティ

**Files:**
- Create: `config.ts`
- Create: `src/lib/logger.ts`
- Create: `src/lib/job.ts`
- Create: `src/lib/job.test.ts`

- [ ] **Step 1: config.ts のテストを書く**

```typescript
// src/lib/config.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('config: 解像度が正しい', async () => {
  const { config } = await import('../../config.ts');
  assert.equal(config.VIDEO_WIDTH, 1080);
  assert.equal(config.VIDEO_HEIGHT, 1920);
  assert.equal(config.FPS, 30);
});

test('config: 動画尺の許容範囲が正しい', async () => {
  const { config } = await import('../../config.ts');
  assert.equal(config.MIN_DURATION, 15);
  assert.equal(config.MAX_DURATION, 30);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
node --import tsx/esm --test src/lib/config.test.ts
```

Expected: FAIL（config.ts が存在しない）

- [ ] **Step 3: config.ts を実装する**

```typescript
// config.ts
import 'dotenv/config';

export const config = {
  // 動画仕様
  VIDEO_WIDTH: 1080,
  VIDEO_HEIGHT: 1920,
  FPS: 30,
  MIN_DURATION: 15,
  MAX_DURATION: 30,
  TARGET_DURATION: 22,
  CUTS_PER_VIDEO: 20,

  // テンプレート
  DEFAULT_TEMPLATE: (process.env.VIDEO_TEMPLATE ?? 'Standard') as 'Standard' | 'Minimal',

  // API
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
  ANTHROPIC_MODEL: 'claude-opus-4-6',
} as const;
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
node --import tsx/esm --test src/lib/config.test.ts
```

Expected: PASS

- [ ] **Step 5: src/lib/logger.ts を実装する（テスト不要）**

```typescript
// src/lib/logger.ts
const levels = ['info', 'warn', 'error', 'debug'] as const;
type Level = typeof levels[number];

function log(level: Level, message: string, data?: unknown): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(data !== undefined ? { data } : {}),
  };
  const out = level === 'error' ? process.stderr : process.stdout;
  out.write(JSON.stringify(entry) + '\n');
}

export const logger = {
  info: (msg: string, data?: unknown) => log('info', msg, data),
  warn: (msg: string, data?: unknown) => log('warn', msg, data),
  error: (msg: string, data?: unknown) => log('error', msg, data),
  debug: (msg: string, data?: unknown) => log('debug', msg, data),
};
```

- [ ] **Step 6: src/lib/job.ts のテストを書く**

```typescript
// src/lib/job.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createJobDir, getJobDir } from './job.ts';

test('job: createJobDir が /tmp/inoue-job-{id}/ を作成する', async () => {
  const jobId = await createJobDir();
  assert.match(jobId, /^[0-9a-f-]{36}$/);
  assert.ok(existsSync(getJobDir(jobId)));
});

test('job: getJobDir が正しいパスを返す', () => {
  const id = 'test-job-id';
  assert.equal(getJobDir(id), `/tmp/inoue-job-${id}`);
});
```

- [ ] **Step 7: テストが失敗することを確認する**

```bash
node --import tsx/esm --test src/lib/job.test.ts
```

Expected: FAIL

- [ ] **Step 8: src/lib/job.ts を実装する**

```typescript
// src/lib/job.ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';

export function getJobDir(jobId: string): string {
  return `/tmp/inoue-job-${jobId}`;
}

export async function createJobDir(): Promise<string> {
  const jobId = uuidv4();
  const dir = getJobDir(jobId);
  mkdirSync(dir, { recursive: true });
  return jobId;
}

export function getJobPath(jobId: string, filename: string): string {
  return join(getJobDir(jobId), filename);
}
```

- [ ] **Step 9: テストが通ることを確認する**

```bash
node --import tsx/esm --test src/lib/job.test.ts
```

Expected: PASS

- [ ] **Step 10: コミット**

```bash
git add config.ts src/lib/
git commit -m "feat: 設定・共通ユーティリティ（config, logger, job）"
```

---

## Task 3: Claude クライアント

**Files:**
- Create: `src/lib/claude.ts`

- [ ] **Step 1: src/lib/claude.ts を実装する**

```typescript
// src/lib/claude.ts
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.ts';

let _client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!_client) {
    if (!config.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY が設定されていません');
    }
    _client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }
  return _client;
}

/** テスト用：クライアントをリセット */
export function _resetClient(): void {
  _client = null;
}
```

- [ ] **Step 2: typecheck が通ることを確認する**

```bash
pnpm typecheck
```

Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/lib/claude.ts
git commit -m "feat: Claude APIクライアントファクトリ"
```

---

## Task 4: データベース

**Files:**
- Create: `src/db/db.ts`
- Create: `src/db/db.test.ts`

- [ ] **Step 1: db.test.ts を書く**

```typescript
// src/db/db.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertJob, insertShot, getDb } from './db.ts';

test('db: insertJob がジョブを記録する', () => {
  const db = getDb();
  if (!db) return; // graceful degradation

  const jobId = 'test-job-' + Date.now();
  insertJob(jobId, '/tmp/test.jpg', 'テスト商品', 980);

  const row = db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId) as {
    job_id: string; title: string; price: number;
  } | undefined;
  assert.ok(row);
  assert.equal(row.title, 'テスト商品');
  assert.equal(row.price, 980);
});

test('db: insertShot がショットを記録する', () => {
  const db = getDb();
  if (!db) return;

  const jobId = 'test-shot-' + Date.now();
  insertJob(jobId, '/tmp/test.jpg', 'テスト商品', 980);
  insertShot(jobId, 1, 'Standard');

  const row = db.prepare('SELECT * FROM shots WHERE job_id = ?').get(jobId) as {
    job_id: string; shot_index: number;
  } | undefined;
  assert.ok(row);
  assert.equal(row.shot_index, 1);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
node --import tsx/esm --test src/db/db.test.ts
```

Expected: FAIL

- [ ] **Step 3: src/db/db.ts を実装する**

```typescript
// src/db/db.ts
import { logger } from '../lib/logger.ts';

type Database = import('better-sqlite3').Database;
let _db: Database | null = null;

export function getDb(): Database | null {
  if (_db) return _db;
  try {
    const Database = (await import('better-sqlite3')).default;
    _db = new Database('/tmp/inoue-movie6.db');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        image_path TEXT NOT NULL,
        title TEXT NOT NULL,
        price REAL,
        template TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS shots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        shot_index INTEGER NOT NULL,
        template TEXT,
        video_path TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        impressions INTEGER,
        purchases INTEGER,
        three_sec_rate REAL,
        completion_rate REAL,
        recorded_at TEXT DEFAULT (datetime('now'))
      );
    `);
    return _db;
  } catch {
    logger.warn('better-sqlite3 が利用できません。DB永続化をスキップします。');
    return null;
  }
}

export function insertJob(jobId: string, imagePath: string, title: string, price: number): void {
  const db = getDb();
  if (!db) return;
  db.prepare(
    'INSERT OR IGNORE INTO jobs (job_id, image_path, title, price) VALUES (?, ?, ?, ?)'
  ).run(jobId, imagePath, title, price);
}

export function insertShot(jobId: string, shotIndex: number, template: string): void {
  const db = getDb();
  if (!db) return;
  db.prepare(
    'INSERT INTO shots (job_id, shot_index, template) VALUES (?, ?, ?)'
  ).run(jobId, shotIndex, template);
}

export function updateJobStatus(jobId: string, status: string): void {
  const db = getDb();
  if (!db) return;
  db.prepare('UPDATE jobs SET status = ? WHERE job_id = ?').run(status, jobId);
}

export function insertMetrics(
  jobId: string,
  impressions: number,
  purchases: number,
  threSecRate: number,
  completionRate: number
): void {
  const db = getDb();
  if (!db) return;
  db.prepare(
    'INSERT INTO metrics (job_id, impressions, purchases, three_sec_rate, completion_rate) VALUES (?, ?, ?, ?, ?)'
  ).run(jobId, impressions, purchases, threSecRate, completionRate);
}
```

> **Note:** `getDb()` は同期処理で動作するが、`import('better-sqlite3')` は動的インポートのため非同期。実際には `require` を使う必要がある。`createRequire` を使って解決する：

```typescript
// src/db/db.ts （修正版 - ESM から CJS モジュールを require する）
import { createRequire } from 'node:module';
import { logger } from '../lib/logger.ts';

const require = createRequire(import.meta.url);

type BetterSqlite3 = typeof import('better-sqlite3');
type Database = InstanceType<BetterSqlite3['default']>;

let _db: Database | null = null;

export function getDb(): Database | null {
  if (_db !== undefined && _db !== null) return _db;
  try {
    const Database = (require('better-sqlite3') as BetterSqlite3).default;
    _db = new Database('/tmp/inoue-movie6.db');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        image_path TEXT NOT NULL,
        title TEXT NOT NULL,
        price REAL,
        template TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS shots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        shot_index INTEGER NOT NULL,
        template TEXT,
        video_path TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        impressions INTEGER,
        purchases INTEGER,
        three_sec_rate REAL,
        completion_rate REAL,
        recorded_at TEXT DEFAULT (datetime('now'))
      );
    `);
    return _db;
  } catch {
    logger.warn('better-sqlite3 が利用できません。DB永続化をスキップします。');
    _db = null;
    return null;
  }
}

export function insertJob(jobId: string, imagePath: string, title: string, price: number): void {
  const db = getDb();
  if (!db) return;
  db.prepare(
    'INSERT OR IGNORE INTO jobs (job_id, image_path, title, price) VALUES (?, ?, ?, ?)'
  ).run(jobId, imagePath, title, price);
}

export function insertShot(jobId: string, shotIndex: number, template: string): void {
  const db = getDb();
  if (!db) return;
  db.prepare(
    'INSERT INTO shots (job_id, shot_index, template) VALUES (?, ?, ?)'
  ).run(jobId, shotIndex, template);
}

export function updateJobStatus(jobId: string, status: string): void {
  const db = getDb();
  if (!db) return;
  db.prepare('UPDATE jobs SET status = ? WHERE job_id = ?').run(status, jobId);
}

export function insertMetrics(
  jobId: string,
  impressions: number,
  purchases: number,
  threeSecRate: number,
  completionRate: number
): void {
  const db = getDb();
  if (!db) return;
  db.prepare(
    'INSERT INTO metrics (job_id, impressions, purchases, three_sec_rate, completion_rate) VALUES (?, ?, ?, ?, ?)'
  ).run(jobId, impressions, purchases, threeSecRate, completionRate);
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
node --import tsx/esm --test src/db/db.test.ts
```

Expected: PASS（または better-sqlite3 未インストール時はスキップ）

- [ ] **Step 5: コミット**

```bash
git add src/db/
git commit -m "feat: DB永続化（jobs/shots/metrics）graceful degradation対応"
```

---

## Task 5: ingest エージェント

**Files:**
- Create: `src/agents/ingest/schema.ts`
- Create: `src/agents/ingest/agent.ts`
- Create: `src/agents/ingest/schema.test.ts`

- [ ] **Step 1: schema.test.ts を書く**

```typescript
// src/agents/ingest/schema.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProductInfoSchema } from './schema.ts';

test('ProductInfoSchema: 正常データをパースできる', () => {
  const result = ProductInfoSchema.safeParse({
    jobId: 'test-id',
    title: 'テスト商品',
    price: 980,
    features: ['特徴1', '特徴2'],
    category: '日用品',
    imagePath: '/tmp/test.jpg',
  });
  assert.ok(result.success);
});

test('ProductInfoSchema: title が空の場合はエラー', () => {
  const result = ProductInfoSchema.safeParse({
    jobId: 'test-id',
    title: '',
    price: 980,
    features: [],
    category: '日用品',
    imagePath: '/tmp/test.jpg',
  });
  assert.ok(!result.success);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
node --import tsx/esm --test src/agents/ingest/schema.test.ts
```

Expected: FAIL

- [ ] **Step 3: schema.ts を実装する**

```typescript
// src/agents/ingest/schema.ts
import { z } from 'zod';

export const ProductInfoSchema = z.object({
  jobId: z.string().uuid(),
  title: z.string().min(1),
  price: z.number().nonnegative(),
  features: z.array(z.string()).min(1).max(10),
  category: z.string().min(1),
  imagePath: z.string().min(1),
});

export type ProductInfo = z.infer<typeof ProductInfoSchema>;
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
node --import tsx/esm --test src/agents/ingest/schema.test.ts
```

Expected: PASS

- [ ] **Step 5: agent.ts を実装する**

```typescript
// src/agents/ingest/agent.ts
import { readFileSync } from 'node:fs';
import { getClient } from '../../lib/claude.ts';
import { logger } from '../../lib/logger.ts';
import { getJobPath } from '../../lib/job.ts';
import { ProductInfoSchema, type ProductInfo } from './schema.ts';

export async function runIngest(
  jobId: string,
  imagePath: string
): Promise<ProductInfo> {
  logger.info('ingest: 開始', { jobId, imagePath });

  const imageData = readFileSync(imagePath);
  const base64 = imageData.toString('base64');
  const mediaType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

  const client = getClient();
  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: `この商品画像を分析して、以下のJSON形式で返してください。日本語で答えること。
{
  "title": "商品名（画像から推定）",
  "price": 0,
  "features": ["特徴1", "特徴2", "特徴3"],
  "category": "カテゴリ名"
}
JSONのみを返してください。説明は不要です。`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const parsed = JSON.parse(text) as {
    title: string;
    price: number;
    features: string[];
    category: string;
  };

  const productInfo: ProductInfo = ProductInfoSchema.parse({
    jobId,
    title: parsed.title,
    price: parsed.price,
    features: parsed.features,
    category: parsed.category,
    imagePath,
  });

  // jobディレクトリに保存
  const outPath = getJobPath(jobId, 'product-info.json');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, JSON.stringify(productInfo, null, 2));

  logger.info('ingest: 完了', { jobId, title: productInfo.title });
  return productInfo;
}
```

- [ ] **Step 6: typecheck が通ることを確認する**

```bash
pnpm typecheck
```

Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/agents/ingest/
git commit -m "feat: ingest エージェント（Claude Vision → ProductInfo）"
```

---

## Task 6: plan エージェント

**Files:**
- Create: `src/agents/plan/schema.ts`
- Create: `src/agents/plan/agent.ts`
- Create: `src/agents/plan/schema.test.ts`

- [ ] **Step 1: schema.test.ts を書く**

```typescript
// src/agents/plan/schema.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShotPlanSchema } from './schema.ts';

test('ShotPlanSchema: 正常データをパースできる', () => {
  const result = ShotPlanSchema.safeParse({
    jobId: '00000000-0000-0000-0000-000000000000',
    totalDuration: 22,
    cuts: Array.from({ length: 20 }, (_, i) => ({
      index: i,
      duration: 1.1,
      visual: '商品全体',
      text: 'テキスト',
      animation: 'none',
    })),
  });
  assert.ok(result.success);
});

test('ShotPlanSchema: cuts が 20 個でない場合はエラー', () => {
  const result = ShotPlanSchema.safeParse({
    jobId: '00000000-0000-0000-0000-000000000000',
    totalDuration: 5,
    cuts: [{ index: 0, duration: 5, visual: '商品', text: 'テキスト', animation: 'none' }],
  });
  assert.ok(!result.success);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
node --import tsx/esm --test src/agents/plan/schema.test.ts
```

Expected: FAIL

- [ ] **Step 3: schema.ts を実装する**

```typescript
// src/agents/plan/schema.ts
import { z } from 'zod';

export const CutSchema = z.object({
  index: z.number().int().min(0).max(19),
  duration: z.number().positive(),
  visual: z.string().min(1),
  text: z.string(),
  animation: z.enum(['none', 'zoom-in', 'fade']),
});

export const ShotPlanSchema = z.object({
  jobId: z.string().uuid(),
  totalDuration: z.number().positive(),
  cuts: z.array(CutSchema).length(20),
});

export type Cut = z.infer<typeof CutSchema>;
export type ShotPlan = z.infer<typeof ShotPlanSchema>;
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
node --import tsx/esm --test src/agents/plan/schema.test.ts
```

Expected: PASS

- [ ] **Step 5: agent.ts を実装する**

```typescript
// src/agents/plan/agent.ts
import { writeFileSync } from 'node:fs';
import { getClient } from '../../lib/claude.ts';
import { logger } from '../../lib/logger.ts';
import { getJobPath } from '../../lib/job.ts';
import type { ProductInfo } from '../ingest/schema.ts';
import { ShotPlanSchema, type ShotPlan } from './schema.ts';

export async function runPlan(productInfo: ProductInfo): Promise<ShotPlan> {
  const { jobId } = productInfo;
  logger.info('plan: 開始', { jobId });

  const client = getClient();
  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `TikTok Shop向けの商品紹介動画のショット構成を20カットで考えてください。

商品情報:
- 商品名: ${productInfo.title}
- 価格: ${productInfo.price}円
- 特徴: ${productInfo.features.join('、')}
- カテゴリ: ${productInfo.category}

以下のJSON形式で返してください。totalDurationは20〜25秒にすること。
{
  "totalDuration": 22,
  "cuts": [
    {
      "index": 0,
      "duration": 1.1,
      "visual": "画面に表示するビジュアルの説明",
      "text": "テキストオーバーレイ（短く・インパクトがあること）",
      "animation": "none"
    }
    // ... 20カット分
  ]
}
animationは "none" | "zoom-in" | "fade" のいずれか。JSONのみ返すこと。`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const raw = JSON.parse(text) as { totalDuration: number; cuts: unknown[] };

  const shotPlan: ShotPlan = ShotPlanSchema.parse({
    jobId,
    totalDuration: raw.totalDuration,
    cuts: raw.cuts,
  });

  const outPath = getJobPath(jobId, 'shot-plan.json');
  writeFileSync(outPath, JSON.stringify(shotPlan, null, 2));

  logger.info('plan: 完了', { jobId, totalDuration: shotPlan.totalDuration });
  return shotPlan;
}
```

- [ ] **Step 6: typecheck が通ることを確認する**

```bash
pnpm typecheck
```

Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/agents/plan/
git commit -m "feat: plan エージェント（Claude → ShotPlan 20カット）"
```

---

## Task 7: ビデオ基盤（フレーム合成・ffmpeg）

**Files:**
- Create: `src/video/frame.ts`
- Create: `src/video/renderer.ts`
- Create: `src/video/frame.test.ts`

- [ ] **Step 1: frame.test.ts を書く**

```typescript
// src/video/frame.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml } from './frame.ts';

test('escapeXml: 特殊文字をエスケープする', () => {
  assert.equal(escapeXml('<Hello & "World">'), '&lt;Hello &amp; &quot;World&quot;&gt;');
});

test('escapeXml: 通常の文字列はそのまま返す', () => {
  assert.equal(escapeXml('通常のテキスト'), '通常のテキスト');
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
node --import tsx/esm --test src/video/frame.test.ts
```

Expected: FAIL

- [ ] **Step 3: src/video/frame.ts を実装する**

```typescript
// src/video/frame.ts
import sharp from 'sharp';
import { config } from '../../config.ts';

const { VIDEO_WIDTH: W, VIDEO_HEIGHT: H } = config;

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface FrameOptions {
  bgColor: string;
  textColor: string;
  text: string;
  subText?: string;
}

export async function renderFrame(
  productImagePath: string,
  opts: FrameOptions
): Promise<Buffer> {
  // 背景
  const bg = await sharp({
    create: { width: W, height: H, channels: 4, background: opts.bgColor },
  })
    .png()
    .toBuffer();

  // 商品画像：上部60%に収める
  const imgH = Math.floor(H * 0.58);
  const imgW = W - 80;
  const productImg = await sharp(productImagePath)
    .resize(imgW, imgH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // テキストSVG（下部に表示）
  const svgText = `
<svg width="${W}" height="600" xmlns="http://www.w3.org/2000/svg">
  <text
    x="${W / 2}" y="80"
    text-anchor="middle"
    font-family="Hiragino Sans, sans-serif"
    font-size="64"
    font-weight="bold"
    fill="${opts.textColor}"
  >${escapeXml(opts.text)}</text>
  ${
    opts.subText
      ? `<text
    x="${W / 2}" y="180"
    text-anchor="middle"
    font-family="Hiragino Sans, sans-serif"
    font-size="48"
    fill="${opts.textColor}"
    opacity="0.85"
  >${escapeXml(opts.subText)}</text>`
      : ''
  }
</svg>`;

  const composed = await sharp(bg)
    .composite([
      { input: productImg, top: 60, left: 40 },
      { input: Buffer.from(svgText), top: H - 650, left: 0 },
    ])
    .png()
    .toBuffer();

  return composed;
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
node --import tsx/esm --test src/video/frame.test.ts
```

Expected: PASS

- [ ] **Step 5: src/video/renderer.ts を実装する**

```typescript
// src/video/renderer.ts
import { execFile } from 'node:child_process';
import { writeFileSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { logger } from '../lib/logger.ts';
import { config } from '../../config.ts';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

function getFfmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const installer = require('@ffmpeg-installer/ffmpeg') as { path: string };
  return installer.path;
}

/** 静止画フレームから指定秒数の動画クリップを生成 */
export async function makeClip(
  framePath: string,
  duration: number,
  outputPath: string
): Promise<void> {
  const ffmpeg = getFfmpegPath();
  await execFileAsync(ffmpeg, [
    '-y',
    '-loop', '1',
    '-i', framePath,
    '-t', String(duration),
    '-vf', `scale=${config.VIDEO_WIDTH}:${config.VIDEO_HEIGHT}`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', String(config.FPS),
    outputPath,
  ]);
}

/** 複数クリップを連結して最終動画を生成 */
export async function concatenateClips(
  clipPaths: string[],
  outputPath: string
): Promise<void> {
  const ffmpeg = getFfmpegPath();
  const listPath = join(outputPath, '..', 'clips.txt').replace(/\/[^/]+$/, '/clips.txt');
  const listContent = clipPaths.map(p => `file '${p}'`).join('\n');
  writeFileSync(listPath, listContent);

  await execFileAsync(ffmpeg, [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    outputPath,
  ]);

  logger.info('renderer: 動画連結完了', { outputPath, clips: clipPaths.length });
}

/** 動画の実際の尺（秒）を取得 */
export async function getVideoDuration(videoPath: string): Promise<number> {
  const ffmpeg = getFfmpegPath().replace(/ffmpeg$/, 'ffprobe');
  const { stdout } = await execFileAsync(ffmpeg, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ]);
  return parseFloat(stdout.trim());
}
```

- [ ] **Step 6: typecheck が通ることを確認する**

```bash
pnpm typecheck
```

Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/video/
git commit -m "feat: ビデオ基盤（sharp フレーム合成・ffmpeg レンダリング）"
```

---

## Task 8: ビデオテンプレート

**Files:**
- Create: `src/video/templates/Standard/index.ts`
- Create: `src/video/templates/Minimal/index.ts`

- [ ] **Step 1: テンプレートの共通インターフェースを定義する**

`src/video/templates/Standard/index.ts` の冒頭に型を定義する：

```typescript
// src/video/templates/Standard/index.ts
import { renderFrame } from '../../frame.ts';
import type { Cut } from '../../../agents/plan/schema.ts';
import type { ProductInfo } from '../../../agents/ingest/schema.ts';

export interface Template {
  name: string;
  renderFrame(cut: Cut, productInfo: ProductInfo): Promise<Buffer>;
}
```

- [ ] **Step 2: Standard テンプレートを実装する**

```typescript
// src/video/templates/Standard/index.ts （続き）
export const StandardTemplate: Template = {
  name: 'Standard',

  async renderFrame(cut: Cut, productInfo: ProductInfo): Promise<Buffer> {
    return renderFrame(productInfo.imagePath, {
      bgColor: '#FFFFFF',
      textColor: '#1A1A1A',
      text: cut.text || productInfo.title,
      subText: cut.index === 0 ? `¥${productInfo.price.toLocaleString()}` : undefined,
    });
  },
};
```

- [ ] **Step 3: Minimal テンプレートを実装する**

```typescript
// src/video/templates/Minimal/index.ts
import { renderFrame } from '../../frame.ts';
import type { Cut } from '../../../agents/plan/schema.ts';
import type { ProductInfo } from '../../../agents/ingest/schema.ts';
import type { Template } from '../Standard/index.ts';

export const MinimalTemplate: Template = {
  name: 'Minimal',

  async renderFrame(cut: Cut, productInfo: ProductInfo): Promise<Buffer> {
    return renderFrame(productInfo.imagePath, {
      bgColor: '#0A0A0A',
      textColor: '#FFFFFF',
      text: cut.text || productInfo.title,
      subText: cut.index === 19 ? `¥${productInfo.price.toLocaleString()} で購入` : undefined,
    });
  },
};
```

- [ ] **Step 4: テンプレート読み込みユーティリティを新規作成する**

`src/video/templates/index.ts` を新規作成する：

```typescript
// src/video/templates/index.ts
import { StandardTemplate } from './Standard/index.ts';
import { MinimalTemplate } from './Minimal/index.ts';
import type { Template } from './Standard/index.ts';

export { type Template };

export function getTemplate(name: string): Template {
  switch (name) {
    case 'Standard': return StandardTemplate;
    case 'Minimal': return MinimalTemplate;
    default: throw new Error(`未知のテンプレート: ${name}`);
  }
}
```

- [ ] **Step 5: typecheck が通ることを確認する**

```bash
pnpm typecheck
```

Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/video/templates/
git commit -m "feat: ビデオテンプレート（Standard・Minimal）"
```

---

## Task 9: render エージェント

**Files:**
- Create: `src/agents/render/schema.ts`
- Create: `src/agents/render/agent.ts`
- Create: `src/agents/render/schema.test.ts`

- [ ] **Step 1: schema.test.ts を書く**

```typescript
// src/agents/render/schema.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RenderInputSchema } from './schema.ts';

test('RenderInputSchema: 正常データをパースできる', () => {
  const result = RenderInputSchema.safeParse({
    jobId: '00000000-0000-0000-0000-000000000000',
    template: 'Standard',
    productInfo: {
      jobId: '00000000-0000-0000-0000-000000000000',
      title: 'テスト商品',
      price: 980,
      features: ['特徴1'],
      category: '日用品',
      imagePath: '/tmp/test.jpg',
    },
    shotPlan: {
      jobId: '00000000-0000-0000-0000-000000000000',
      totalDuration: 22,
      cuts: Array.from({ length: 20 }, (_, i) => ({
        index: i,
        duration: 1.1,
        visual: '商品',
        text: 'テキスト',
        animation: 'none',
      })),
    },
  });
  assert.ok(result.success);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
node --import tsx/esm --test src/agents/render/schema.test.ts
```

Expected: FAIL

- [ ] **Step 3: schema.ts を実装する**

```typescript
// src/agents/render/schema.ts
import { z } from 'zod';
import { ProductInfoSchema } from '../ingest/schema.ts';
import { ShotPlanSchema } from '../plan/schema.ts';

export const RenderInputSchema = z.object({
  jobId: z.string().uuid(),
  template: z.enum(['Standard', 'Minimal']),
  productInfo: ProductInfoSchema,
  shotPlan: ShotPlanSchema,
});

export const RenderOutputSchema = z.object({
  jobId: z.string().uuid(),
  videoPath: z.string(),
  duration: z.number().positive(),
});

export type RenderInput = z.infer<typeof RenderInputSchema>;
export type RenderOutput = z.infer<typeof RenderOutputSchema>;
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
node --import tsx/esm --test src/agents/render/schema.test.ts
```

Expected: PASS

- [ ] **Step 5: agent.ts を実装する**

```typescript
// src/agents/render/agent.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../lib/logger.ts';
import { getJobDir, getJobPath } from '../../lib/job.ts';
import { insertShot } from '../../db/db.ts';
import { getTemplate } from '../../video/templates/index.ts';
import { makeClip, concatenateClips, getVideoDuration } from '../../video/renderer.ts';
import { config } from '../../../config.ts';
import type { RenderInput, RenderOutput } from './schema.ts';

export async function runRender(input: RenderInput): Promise<RenderOutput> {
  const { jobId, template: templateName, productInfo, shotPlan } = input;
  logger.info('render: 開始', { jobId, template: templateName, cuts: shotPlan.cuts.length });

  const template = getTemplate(templateName);
  const jobDir = getJobDir(jobId);
  const clipPaths: string[] = [];

  for (const cut of shotPlan.cuts) {
    // 1. フレーム画像を生成
    const framePath = join(jobDir, `frame-${cut.index.toString().padStart(2, '0')}.png`);
    const frameBuffer = await template.renderFrame(cut, productInfo);
    writeFileSync(framePath, frameBuffer);

    // 2. フレームからクリップを生成
    const clipPath = join(jobDir, `clip-${cut.index.toString().padStart(2, '0')}.mp4`);
    await makeClip(framePath, cut.duration, clipPath);
    clipPaths.push(clipPath);

    // DB記録
    insertShot(jobId, cut.index, templateName);

    logger.debug('render: カット完了', { jobId, index: cut.index });
  }

  // 3. 全クリップを連結
  const videoPath = getJobPath(jobId, 'output.mp4');
  await concatenateClips(clipPaths, videoPath);

  const duration = await getVideoDuration(videoPath);

  // エスカレーション: 尺チェック
  if (duration < config.MIN_DURATION || duration > config.MAX_DURATION) {
    throw new Error(
      `動画の尺が許容範囲外です: ${duration.toFixed(1)}秒（許容: ${config.MIN_DURATION}〜${config.MAX_DURATION}秒）`
    );
  }

  const output: RenderOutput = { jobId, videoPath, duration };
  writeFileSync(getJobPath(jobId, 'render-output.json'), JSON.stringify(output, null, 2));

  logger.info('render: 完了', { jobId, duration, videoPath });
  return output;
}
```

- [ ] **Step 6: typecheck が通ることを確認する**

```bash
pnpm typecheck
```

Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/agents/render/
git commit -m "feat: render エージェント（sharp + ffmpeg → video.mp4）"
```

---

## Task 10: qa エージェント

**Files:**
- Create: `src/agents/qa/schema.ts`
- Create: `src/agents/qa/agent.ts`
- Create: `src/agents/qa/schema.test.ts`

- [ ] **Step 1: schema.test.ts を書く**

```typescript
// src/agents/qa/schema.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QAResultSchema } from './schema.ts';

test('QAResultSchema: passed=true のデータをパースできる', () => {
  const result = QAResultSchema.safeParse({
    jobId: '00000000-0000-0000-0000-000000000000',
    passed: true,
    errors: [],
    warnings: [],
    caption: '商品キャプション',
    hashtags: ['#TikTokShop', '#日用品'],
  });
  assert.ok(result.success);
});

test('QAResultSchema: error が1件以上あれば passed=false が正しい', () => {
  const result = QAResultSchema.safeParse({
    jobId: '00000000-0000-0000-0000-000000000000',
    passed: false,
    errors: [{ code: 'DURATION_TOO_SHORT', message: '動画が短すぎます' }],
    warnings: [],
    caption: '',
    hashtags: [],
  });
  assert.ok(result.success);
  assert.equal(result.data?.passed, false);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
node --import tsx/esm --test src/agents/qa/schema.test.ts
```

Expected: FAIL

- [ ] **Step 3: schema.ts を実装する**

```typescript
// src/agents/qa/schema.ts
import { z } from 'zod';

export const ViolationSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const QAResultSchema = z.object({
  jobId: z.string().uuid(),
  passed: z.boolean(),
  errors: z.array(ViolationSchema),
  warnings: z.array(ViolationSchema),
  caption: z.string(),
  hashtags: z.array(z.string()),
});

export type QAResult = z.infer<typeof QAResultSchema>;
export type Violation = z.infer<typeof ViolationSchema>;
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
node --import tsx/esm --test src/agents/qa/schema.test.ts
```

Expected: PASS

- [ ] **Step 5: agent.ts を実装する**

```typescript
// src/agents/qa/agent.ts
import { writeFileSync } from 'node:fs';
import { getClient } from '../../lib/claude.ts';
import { logger } from '../../lib/logger.ts';
import { getJobPath } from '../../lib/job.ts';
import { config } from '../../../config.ts';
import type { ProductInfo } from '../ingest/schema.ts';
import type { RenderOutput } from '../render/schema.ts';
import { type QAResult, type Violation } from './schema.ts';

// 禁止表現リスト（compliance check）
const BANNED_PATTERNS = [
  /絶対/,
  /必ず治る/,
  /100%効果/,
  /No\.1(?!.*出典)/,
];

export async function runQA(
  productInfo: ProductInfo,
  renderOutput: RenderOutput,
  shotPlanTexts: string[]
): Promise<QAResult> {
  const { jobId } = productInfo;
  logger.info('qa: 開始', { jobId });

  const errors: Violation[] = [];
  const warnings: Violation[] = [];

  // 1. 動画尺チェック
  if (renderOutput.duration < config.MIN_DURATION) {
    errors.push({ code: 'DURATION_TOO_SHORT', message: `尺が短すぎます: ${renderOutput.duration.toFixed(1)}秒` });
  }
  if (renderOutput.duration > config.MAX_DURATION) {
    errors.push({ code: 'DURATION_TOO_LONG', message: `尺が長すぎます: ${renderOutput.duration.toFixed(1)}秒` });
  }

  // 2. コンプライアンスチェック（テキスト）
  for (const text of shotPlanTexts) {
    for (const pattern of BANNED_PATTERNS) {
      if (pattern.test(text)) {
        errors.push({ code: 'BANNED_EXPRESSION', message: `禁止表現が含まれています: "${text}"` });
      }
    }
  }

  // 3. Claude でキャプション生成
  let caption = '';
  let hashtags: string[] = [];

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `以下の商品のTikTok投稿用キャプションとハッシュタグを生成してください。

商品名: ${productInfo.title}
価格: ${productInfo.price}円
カテゴリ: ${productInfo.category}
特徴: ${productInfo.features.join('、')}

以下のJSON形式で返してください:
{
  "caption": "キャプション文（100文字以内）",
  "hashtags": ["#ハッシュタグ1", "#ハッシュタグ2", "#ハッシュタグ3", "#ハッシュタグ4", "#ハッシュタグ5"]
}
JSONのみ返すこと。`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const parsed = JSON.parse(text) as { caption: string; hashtags: string[] };
    caption = parsed.caption ?? '';
    hashtags = parsed.hashtags ?? [];
  } catch (e) {
    warnings.push({ code: 'CAPTION_GENERATION_FAILED', message: 'キャプション生成に失敗しました' });
  }

  const result: QAResult = {
    jobId,
    passed: errors.length === 0,
    errors,
    warnings,
    caption,
    hashtags,
  };

  writeFileSync(getJobPath(jobId, 'qa-result.json'), JSON.stringify(result, null, 2));
  writeFileSync(getJobPath(jobId, 'caption.txt'), `${caption}\n\n${hashtags.join(' ')}`);

  // エスカレーション
  if (!result.passed) {
    logger.error('qa: エラーが検出されました。処理を停止します。', { errors: result.errors });
    throw new Error(`QAエラー: ${result.errors.map(e => e.message).join(', ')}`);
  }

  logger.info('qa: 完了', { jobId, warnings: result.warnings.length });
  return result;
}
```

- [ ] **Step 6: typecheck が通ることを確認する**

```bash
pnpm typecheck
```

Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/agents/qa/
git commit -m "feat: qa エージェント（品質チェック + キャプション生成）"
```

---

## Task 11: CLI エントリーポイント

**Files:**
- Create: `cli.ts`

- [ ] **Step 1: cli.ts を実装する**

```typescript
// cli.ts
import 'dotenv/config';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { createJobDir } from './src/lib/job.ts';
import { insertJob, insertMetrics, updateJobStatus } from './src/db/db.ts';
import { logger } from './src/lib/logger.ts';
import { config } from './config.ts';
import { runIngest } from './src/agents/ingest/agent.ts';
import { runPlan } from './src/agents/plan/agent.ts';
import { runRender } from './src/agents/render/agent.ts';
import { runQA } from './src/agents/qa/agent.ts';

const program = new Command();

program
  .name('inoue-movie6')
  .description('TikTok Shop 商品動画 自動生成パイプライン')
  .version('0.1.0');

program
  .command('generate <image>')
  .description('商品画像から動画を生成する')
  .option('-t, --template <name>', 'テンプレート名', config.DEFAULT_TEMPLATE)
  .action(async (imagePath: string, opts: { template: string }) => {
    if (!existsSync(imagePath)) {
      logger.error(`画像ファイルが見つかりません: ${imagePath}`);
      process.exit(1);
    }

    const jobId = await createJobDir();
    logger.info('パイプライン開始', { jobId, imagePath, template: opts.template });

    try {
      insertJob(jobId, imagePath, '', 0);

      // 1. ingest
      const productInfo = await runIngest(jobId, imagePath);
      insertJob(jobId, imagePath, productInfo.title, productInfo.price);

      // 2. plan
      const shotPlan = await runPlan(productInfo);

      // 3. render
      const renderOutput = await runRender({
        jobId,
        template: opts.template as 'Standard' | 'Minimal',
        productInfo,
        shotPlan,
      });

      // 4. qa
      const shotTexts = shotPlan.cuts.map(c => c.text);
      const qaResult = await runQA(productInfo, renderOutput, shotTexts);

      updateJobStatus(jobId, 'completed');

      console.log('\n✅ 生成完了');
      console.log(`   jobId    : ${jobId}`);
      console.log(`   動画     : ${renderOutput.videoPath}`);
      console.log(`   尺       : ${renderOutput.duration.toFixed(1)}秒`);
      console.log(`   キャプション: ${qaResult.caption}`);
      if (qaResult.warnings.length > 0) {
        console.log(`   ⚠️  警告: ${qaResult.warnings.map(w => w.message).join(', ')}`);
      }
    } catch (err) {
      updateJobStatus(jobId, 'failed');
      logger.error('パイプライン失敗', { jobId, error: String(err) });
      process.exit(1);
    }
  });

program
  .command('measure')
  .description('CVR計測データを記録する')
  .requiredOption('--job-id <id>', 'ジョブID')
  .requiredOption('--impressions <n>', '表示回数', parseInt)
  .requiredOption('--purchases <n>', '購入数', parseInt)
  .option('--three-sec-rate <r>', '3秒維持率', parseFloat)
  .option('--completion-rate <r>', '完視聴率', parseFloat)
  .action((opts: {
    jobId: string;
    impressions: number;
    purchases: number;
    threeSecRate?: number;
    completionRate?: number;
  }) => {
    insertMetrics(
      opts.jobId,
      opts.impressions,
      opts.purchases,
      opts.threeSecRate ?? 0,
      opts.completionRate ?? 0
    );
    const cvr = opts.purchases / opts.impressions;
    console.log(`✅ 計測記録完了`);
    console.log(`   CVR: ${(cvr * 100).toFixed(2)}%`);
  });

program.parse();
```

- [ ] **Step 2: typecheck が通ることを確認する**

```bash
pnpm typecheck
```

Expected: エラーなし

- [ ] **Step 3: ヘルプが表示されることを確認する**

```bash
tsx cli.ts --help
```

Expected:
```
Usage: inoue-movie6 [options] [command]

TikTok Shop 商品動画 自動生成パイプライン

Options:
  -V, --version          output the version number
  -h, --help             display help for command

Commands:
  generate [options] <image>  商品画像から動画を生成する
  measure [options]           CVR計測データを記録する
```

- [ ] **Step 4: 全テストが通ることを確認する**

```bash
pnpm test
```

Expected: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add cli.ts
git commit -m "feat: CLI エントリーポイント（generate / measure コマンド）"
```

---

## 動作確認（手動）

実際の商品画像で end-to-end テストを行う：

```bash
# .env を作成
cp .env.example .env
# ANTHROPIC_API_KEY を設定

# テスト画像で実行（任意のJPG/PNGを指定）
tsx cli.ts generate /path/to/product.jpg --template Standard
```

Expected:
```
✅ 生成完了
   jobId    : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   動画     : /tmp/inoue-job-xxxx.../output.mp4
   尺       : 22.0秒
   キャプション: ...
```
