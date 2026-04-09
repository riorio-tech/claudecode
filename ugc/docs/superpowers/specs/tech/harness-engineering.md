# ハーネスエンジニアリング設計

パイプラインを「本番で信頼できるシステム」にするための6つのギャップと対応。

---

## 1. 設定バリデーション（起動時チェック）

現状: 必須 API キーが未設定でも起動し、実行中に初めてエラーになる。

```js
// config.js に追加
export function validateConfig() {
  const required = {
    heygen: ['HEYGEN_API_KEY', 'HEYGEN_AVATARS', 'HEYGEN_VOICES'],
    makeugc: ['MAKEUGC_API_KEY', 'MAKEUGC_AVATARS', 'MAKEUGC_VOICES'],
  };
  const provider = process.env.AVATAR_PROVIDER ?? 'makeugc';
  const missing = required[provider]?.filter(k => !process.env[k]) ?? [];
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);
}
// cli.js の action() 冒頭で validateConfig() を呼ぶ
```

---

## 2. ジョブ状態の永続化（中断再開）

現状: プロセスが途中でクラッシュすると、HeyGen に課金済みの video_id が失われる。

```js
// lib/job-state.js
export function saveJobState(jobDir, state) {
  writeFileSync(join(jobDir, 'state.json'), JSON.stringify(state, null, 2));
}
export function loadJobState(jobDir) {
  const p = join(jobDir, 'state.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}
// cli.js で --resume {jobId} フラグを受け取り、既存 jobDir を復元
```

---

## 3. ヒューマンインザループ承認ゲート

現状: スクリプトが自動承認されて即座に動画生成・投稿まで進む。

```js
// pipeline/run.js の Stage 3 完了後
import { createInterface } from 'node:readline';

async function confirm(question) {
  if (process.env.AUTO_APPROVE === 'true') return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve, reject) => {
    rl.question(`\n${question} [y/N] `, ans => {
      rl.close();
      if (ans.toLowerCase() !== 'y') reject(new Error('Aborted by user'));
      else resolve();
    });
  });
}

// Stage 3 後に呼ぶ
await confirm('スクリプトを確認しました。動画生成に進みますか？');
```

---

## 4. エラーアラート（Slack 通知）

現状: パイプラインが深夜に失敗しても誰も気づかない。

```js
// lib/alert.js
export async function alertError(message) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;  // 未設定時はサイレント
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `🚨 UGC Pipeline Error\n${message}` }),
  });
}
// run.js の catch ブロックで alertError(err.message) を呼ぶ
```

```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx
```

---

## 5. API クォータ管理（HeyGen 上限監視）

現状: HeyGen の残高・上限を超えても気づかず失敗する。

```js
// lib/heygen.js に追加
async getRemainingCredits() {
  const res = await this._fetch('https://api.heygen.com/v2/user/remaining_quota', {
    headers: this._headers(),
  });
  const data = await res.json();
  return data.data?.remaining_quota ?? 0;
}

// avatar-gen.js の generateVideo 前に残高チェック
const credits = await client.getRemainingCredits();
if (credits < scripts.length) {
  throw new Error(`HeyGen credits insufficient: ${credits} remaining, ${scripts.length} needed`);
}
```

---

## 6. 監査ログ（何がいつ実行されたか）

現状: どのジョブがいつ何を生成・投稿したかの履歴がない。

```js
// lib/audit-log.js
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const LOG_PATH = join(process.cwd(), 'audit.log');

export function auditLog(event, data) {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...data,
  }) + '\n';
  appendFileSync(LOG_PATH, entry);
}

// 使用例
auditLog('job_started', { jobId, imagePath, title });
auditLog('video_generated', { jobId, videoId, provider: 'heygen' });
auditLog('post_published', { jobId, platform: 'instagram', mediaId });
```

---

## 実装優先順位

| 優先度 | ギャップ | 理由 |
|---|---|---|
| 🔴 高 | 1. 設定バリデーション | 実行前にエラーを検知できる |
| 🔴 高 | 2. ジョブ状態永続化 | HeyGen 課金損失を防ぐ |
| 🟡 中 | 3. 承認ゲート | 誤投稿・スクリプト品質管理 |
| 🟡 中 | 4. Slack アラート | 夜間バッチの失敗検知 |
| 🟢 低 | 5. クォータ管理 | 残高十分なら不要 |
| 🟢 低 | 6. 監査ログ | トラブル時の調査用 |
