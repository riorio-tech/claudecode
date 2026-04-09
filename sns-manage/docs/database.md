# データベース設計

SQLite（better-sqlite3）を使用。`DB_PATH`（デフォルト: `./sns.db`）に保存される。

DBは**永続資産**として設計されている。データを削除しない。矛盾も含め全て記録し、知識が複利で積み上がる構造にする。

---

## テーブル一覧

### コアテーブル（運用データ）

| テーブル | 説明 |
|---|---|
| `jobs` | パイプライン実行履歴 |
| `contents` | 生成されたコンテンツ（バリアントA/B含む） |
| `posts` | 投稿レコード（status管理） |
| `metrics` | 投稿後の指標データ |
| `analytics_schedule` | 投稿後N時間後の分析スケジュール |
| `pdca_reports` | 週次PDCAレポート |
| `research_cache` | リサーチ結果の24時間キャッシュ |
| `platform_tokens` | OAuth トークン管理 |

### 永続資産テーブル（知識蓄積）

| テーブル | 説明 |
|---|---|
| `patterns` | **勝ちパターン**（アンチフラジリティ: 成功の燃料） |
| `failure_patterns` | **負けパターン**（アンチフラジリティ: 失敗の燃料） |
| `knowledge_base` | **蒸留インサイト**（confidence が実験のたびに上昇） |
| `desire_map` | **欲望連鎖の地図**（模倣欲望理論の実装） |
| `experiment_log` | **全A/Bテスト永続記録**（削除しない） |
| `audience_fingerprint` | **オーディエンス学習**（特性ごとに confidence 積み上げ） |
| `daily_snapshots` | 日次KPIスナップショット |
| `weekly_reports` | 週次AIレポート |

---

## 主要テーブル詳細

### jobs
```sql
id           TEXT PRIMARY KEY   -- UUID
topic        TEXT NOT NULL
category     TEXT NOT NULL DEFAULT 'general'
platforms    TEXT NOT NULL      -- JSON array: ["twitter","tiktok"]
status       TEXT NOT NULL      -- running|completed|failed|approved
params       TEXT               -- JSON
created_at   TEXT NOT NULL DEFAULT (datetime('now'))
completed_at TEXT
```

### posts
```sql
id           INTEGER PRIMARY KEY AUTOINCREMENT
job_id       TEXT NOT NULL REFERENCES jobs(id)
content_id   INTEGER REFERENCES contents(id)
platform     TEXT NOT NULL
variant_id   TEXT NOT NULL DEFAULT 'A'   -- A|B|C
post_id      TEXT    -- SNS側のポストID
post_url     TEXT
status       TEXT NOT NULL DEFAULT 'pending'  -- pending|approved|published|failed
published_at TEXT
error_msg    TEXT
```

**重要:** `status = 'approved'` でなければ 06_publish は投稿しない。

### patterns（勝ちパターン）
```sql
id               INTEGER PRIMARY KEY AUTOINCREMENT
platform         TEXT NOT NULL
category         TEXT NOT NULL DEFAULT 'general'
hook_variant     TEXT NOT NULL
hook_type        TEXT NOT NULL DEFAULT 'unknown'  -- object_centric | desire_centric
engagement_lift  REAL NOT NULL   -- ベースライン比
base_engagement  REAL NOT NULL
win_engagement   REAL NOT NULL
impressions      INTEGER NOT NULL
content_snippet  TEXT
adopted_at       TEXT NOT NULL DEFAULT (datetime('now'))
notes            TEXT
```

### failure_patterns（負けパターン）— patternsと対称設計
```sql
id                 INTEGER PRIMARY KEY AUTOINCREMENT
platform           TEXT NOT NULL
category           TEXT NOT NULL DEFAULT 'general'
hook_variant       TEXT NOT NULL
hook_type          TEXT NOT NULL DEFAULT 'unknown'
failure_mode       TEXT NOT NULL
  -- wrong_mediator | wrong_emotion | object_centric_drift | timing | low_quality | other
failure_reason     TEXT NOT NULL   -- 模倣欲望フレームでの要因分析
avoidance_rule     TEXT NOT NULL   -- 02_planningに注入されるルール文
experiment_insight TEXT            -- 予想と結果のギャップから得た発見
engagement_floor   REAL NOT NULL DEFAULT 0
impressions        INTEGER NOT NULL DEFAULT 0
content_snippet    TEXT
recorded_at        TEXT NOT NULL DEFAULT (datetime('now'))
notes              TEXT
```

### knowledge_base（蒸留インサイト）
```sql
id                  INTEGER PRIMARY KEY AUTOINCREMENT
insight_key         TEXT UNIQUE NOT NULL  -- 'twitter_desire_centric_wins' 等
category            TEXT NOT NULL         -- hook|emotion|platform|audience|timing|desire
platform            TEXT                  -- NULL = クロスプラットフォーム
statement           TEXT NOT NULL         -- 「Twitterでは欲望主語が商品主語の2.3倍のエンゲージを得る」
evidence_count      INTEGER NOT NULL DEFAULT 1
confidence          REAL NOT NULL DEFAULT 0.5   -- 証拠が増えるたびに +0.08（最大 0.95）
first_observed_at   TEXT NOT NULL DEFAULT (datetime('now'))
last_reinforced_at  TEXT NOT NULL DEFAULT (datetime('now'))
status              TEXT NOT NULL DEFAULT 'active'  -- active|deprecated|contradicted
contradiction_note  TEXT   -- 矛盾発見時のメモ（削除はせず記録する）
```

**confidence の積み上げロジック:**
- 確認する実験ごと: `+0.08`（上限 0.95）
- 矛盾する実験: `status = 'contradicted'`（削除しない）

### desire_map（欲望連鎖）
```sql
id              INTEGER PRIMARY KEY AUTOINCREMENT
topic           TEXT NOT NULL
platform        TEXT NOT NULL
mediator_type   TEXT   -- influencer|community|trend|event
trigger_emotion TEXT   -- aspiration|envy|fear|excitement|belonging
spread_pattern  TEXT   -- vertical（インフルエンサー起点）| horizontal（コミュニティ起点）
desire_object   TEXT   -- 何を欲しがっているか
desire_subject  TEXT   -- 誰が欲しがっているか（人物描写）
examples        TEXT   -- JSON array
cache_key       TEXT UNIQUE  -- topic-platform でupsert
observed_at     TEXT NOT NULL DEFAULT (datetime('now'))
```

### experiment_log（全A/Bテスト永続記録）
```sql
id                     INTEGER PRIMARY KEY AUTOINCREMENT
job_id                 TEXT
platform               TEXT NOT NULL
hypothesis             TEXT NOT NULL   -- 「欲望主語にすればエンゲージが上がるはず」
variant_a_description  TEXT NOT NULL
variant_b_description  TEXT
variant_a_engagement   REAL
variant_b_engagement   REAL
winner                 TEXT   -- A|B|tie|inconclusive
lift                   REAL
insight                TEXT   -- この実験から得られた1文のインサイト
supports_desire_theory INTEGER DEFAULT 0  -- 1 = 欲望主語が勝った
supports_antifragility INTEGER DEFAULT 0  -- 1 = 失敗から有意な発見があった
recorded_at            TEXT NOT NULL DEFAULT (datetime('now'))
```

---

## データの流れ

```
01_research → desire_map, audience_fingerprint に蓄積
05_marketing → contents テーブルに保存
06_publish   → posts テーブルに保存、analytics_schedule に登録
07_analytics → metrics テーブルに保存
08_evaluate  →
    勝ち: patterns に登録
    負け: failure_patterns に登録
    両方: experiment_log に記録、knowledge_base を更新
09_report    → daily_snapshots, weekly_reports に保存
```

---

## DBへの直接アクセス（確認用）

```bash
# 勝ちパターン確認
sqlite3 sns.db "SELECT platform, hook_type, engagement_lift, notes FROM patterns ORDER BY engagement_lift DESC LIMIT 10;"

# 負けパターン確認
sqlite3 sns.db "SELECT platform, failure_mode, avoidance_rule FROM failure_patterns ORDER BY recorded_at DESC LIMIT 10;"

# 知識ベース確認（confidence高い順）
sqlite3 sns.db "SELECT category, confidence, evidence_count, statement FROM knowledge_base WHERE status='active' ORDER BY confidence DESC;"

# 欲望連鎖確認
sqlite3 sns.db "SELECT topic, platform, trigger_emotion, desire_subject FROM desire_map ORDER BY observed_at DESC LIMIT 10;"

# 実験ログ確認
sqlite3 sns.db "SELECT platform, hypothesis, winner, lift, insight FROM experiment_log ORDER BY recorded_at DESC LIMIT 10;"
```
