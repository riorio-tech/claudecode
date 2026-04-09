# セットアップガイド

---

## 前提条件

- Node.js 20以上
- SQLite3（システムにインストール済み）
- Twitter Developer App（Phase 1に必要）

---

## 1. インストール

```bash
cd /Users/reoreo/claudecode/sns-manage
npm install
npx playwright install chromium  # ブラウザ自動化を使う場合
```

---

## 2. 環境変数の設定

このプロジェクトは2段階で `.env` を読み込む:

1. `../. env`（`/Users/reoreo/claudecode/.env`）— 共有キー
2. `./.env`（このプロジェクト固有）— SNSプラットフォームキー

### 共有 `.env`（`/Users/reoreo/claudecode/.env`）に必要なもの

```env
ANTHROPIC_API_KEY=sk-ant-...     # 必須
API_KEY=your_dashboard_key        # ダッシュボードのAPIキー
```

### プロジェクト `.env`（`sns-manage/.env`）に必要なもの

```env
# Twitter/X API v2（https://developer.twitter.com から取得）
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_SECRET=
TWITTER_BEARER_TOKEN=

# Google Sheets連携（任意）
GOOGLE_SHEETS_ID=              # スプレッドシートのID（URLから取得）
GOOGLE_SERVICE_ACCOUNT_JSON=   # サービスアカウントJSON（1行に圧縮）

# スケジューラー設定
AUTO_APPROVE=false              # true にすると承認なしで自動投稿
POST_TIME=09:00                 # 毎日の投稿時刻（JST）
```

---

## 3. DBの初期化

初回起動時に自動で `sns.db` が作成される。手動で確認する場合:

```bash
node -e "import('./db/db.js').then(m => m.getDb())"
```

---

## 4. 起動

```bash
# サーバー起動
node api/server.js

# スケジューラー込みで起動（推奨）
node api/server.js --scheduler

# または別プロセスでスケジューラーを起動
node scheduler.js
```

ダッシュボード: `http://localhost:3000`（ブラウザで開く）

---

## 5. 初回動作確認

### テスト実行（ドライラン）

```bash
node orchestrator.js \
  --topic "夏のスキンケア" \
  --platforms twitter \
  --dry-run
```

`jobs/{jobId}/` 下に `01_research-output.json` 〜 `05_marketing-output.json` が生成されることを確認。

### Twitter投稿テスト

```bash
# APIキー設定後
node orchestrator.js --topic "テスト投稿" --platforms twitter

# ダッシュボードで承認
open http://localhost:3000

# または CLI で承認 + 投稿
node cli.js approve --job-id {jobId}
node cli.js publish --job-id {jobId}
```

---

## 6. ブラウザ自動化のセットアップ

TwitterのブラウザセッションはOAuth APIの代替として使用できる。

```bash
# Chromiumインストール（未実施の場合）
npx playwright install chromium

# ブラウザでTwitterにログイン（初回のみ）
# サーバー起動後にAPIを呼ぶ
curl -X POST http://localhost:3000/api/browser/login \
  -H "x-api-key: {API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"platform": "twitter"}'
```

ブラウザが開くのでTwitterにログインする。セッションは `browser-sessions/twitter/` に永続化され、以降はheadless投稿が可能。

---

## 7. Google Sheetsセットアップ（任意）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト作成
2. Google Sheets API を有効化
3. サービスアカウントを作成し、JSONキーをダウンロード
4. スプレッドシートをサービスアカウントのメールアドレスに共有（編集者権限）
5. JSONを1行に圧縮して `.env` の `GOOGLE_SERVICE_ACCOUNT_JSON` に設定

```bash
# JSONを1行に変換する例
cat service-account.json | tr -d '\n' | tr -d ' '
```

---

## 8. 自動投稿スケジューラーの本番設定

`topics.json` を作成:

```json
[
  {
    "topic": "夏のスキンケア",
    "platforms": ["twitter"],
    "category": "beauty",
    "targetAudience": "20代女性"
  }
]
```

`.env` で設定:

```env
AUTO_APPROVE=true          # 人間承認なしで投稿（運用確認後に有効化）
POST_TIME=09:00            # 投稿時刻
DAILY_TOPICS_FILE=./topics.json
```

---

## よくある問題

### `better-sqlite3` のインストールエラー
```bash
npm install --build-from-source better-sqlite3
```

### Playwright のインストールエラー
```bash
npx playwright install-deps chromium
npx playwright install chromium
```

### API_KEY 未設定でサーバーが起動しない
共有 `.env`（`/Users/reoreo/claudecode/.env`）に `API_KEY=xxx` を追加する。

### Twitter API 認証エラー
`TWITTER_ACCESS_TOKEN` と `TWITTER_ACCESS_SECRET` はアプリの認証ではなく、**投稿するアカウント**のアクセストークンが必要。Developer Portal の "User authentication settings" で OAuth 1.0a を有効化すること。
