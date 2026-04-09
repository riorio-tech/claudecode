# Phase 3: 分析・最適化

## analytics.js の責務

各プラットフォームから指標を収集し、SQLite に保存。Claude Sonnet で勝ちパターンを分析し `analytics_report.md` に追記。

## 収集指標

| 指標 | TikTok | Instagram | YouTube |
|------|--------|-----------|---------|
| 再生数 | ✓ | ✓ | ✓ |
| 完視聴率 | ✓ | ✓ | ✓ |
| いいね・保存 | ✓ | ✓ | ✓ |
| CTR | ✓ | ✓ | ✓ |

計測タイミング: 投稿後 **24h / 72h / 7日** の3点。

## SQLite スキーマ（metrics-db.js）

```sql
CREATE TABLE posts (
  id               TEXT PRIMARY KEY,
  job_dir          TEXT,
  hook_type        TEXT,
  platform         TEXT,
  video_id         TEXT,
  posted_at        TEXT,
  views            INTEGER,
  completion_rate  REAL,
  ctr              REAL,
  saves            INTEGER,
  updated_at       TEXT
);

CREATE TABLE analytics_snapshots (
  id          TEXT PRIMARY KEY,
  post_id     TEXT REFERENCES posts(id),
  snapshot_h  INTEGER,   -- 24 / 72 / 168
  views       INTEGER,
  completion_rate REAL,
  ctr         REAL,
  saves       INTEGER,
  taken_at    TEXT
);
```

## フィードバックループ

`make ANALYTICS` 実行時:
1. 全プラットフォームから指標を取得・DB 更新
2. Claude Sonnet で勝ちパターンを分析（フック別・プラットフォーム別）
3. `ugc/output/analytics_report.md` に追記（上書き禁止・appendFileSync）
4. 次回の `research.js` がこのレポートを参照してフック・CTA を選択

## analytics_report.md 形式

```markdown
## Analytics Report — 2026-04-10T12:00:00Z

### 勝ちパターン（7日データ）

| フック型 | 完視聴率 | CTR | 保存率 | 推奨 |
|---|---|---|---|---|
| 問題提起型 | 38% | 2.4% | 4.1% | ✅ 継続 |
| 驚き数字型 | 22% | 1.2% | 1.8% | ⚠️ CTA見直し |
| 共感型 | 41% | 3.1% | 5.2% | ✅ 次回優先 |

### 改善提案
- 「驚き数字型」は数字をフックの冒頭2語以内に入れると離脱率が下がる傾向
- Instagram は保存率が高い → 保存を促すCTAを追加
```

## research.js での参照方法

```js
// Stage 2 冒頭で analytics_report.md を読み込んでプロンプトに注入
import { existsSync, readFileSync } from 'node:fs';

const reportPath = join(OUTPUT_BASE, 'analytics_report.md');
const pastReport = existsSync(reportPath)
  ? readFileSync(reportPath, 'utf8').slice(-3000)  // 直近3000文字
  : '（過去データなし）';
```
