# 社員全員向けハーネスエンジニアリング設計

**関連**: [harness-engineering.md](harness-engineering.md)（Layer A の実装詳細）  
**ステータス**: 設計中

---

## 現状: 「1人の開発者専用ツール」

今の `ugc/` は開発者が `.env` を書いてターミナルを叩くことを前提としている。  
会社の全員が使おうとすると、以下が壊れる:

| 問題 | 壊れ方 |
|---|---|
| CLI のみ | マーケ担当者はターミナルを開けない |
| `.env` 手動設定 | MakeUGC のアバター ID を自分で調べられない |
| エラーがコード | `"no JSON in Claude response"` の意味が分からない |
| スクリプト自動承認 | ブランドと合わないコンテンツが動画になる |
| ジョブが1人前提 | 2人が同時実行すると `outputDir` の番号が競合する |
| 誰が何をしたか不明 | 誤投稿があっても追跡できない |

---

## 「社員全員が使える」の定義

### 操作者ペルソナ

| ペルソナ | スキル | 使い方 |
|---|---|---|
| **エンジニア** | ターミナル・CLI 操作可能 | 現状の CLI で十分 |
| **マーケ担当者** | Slack / Notion を日常利用 | ターミナル不要のインターフェースが必要 |
| **承認者（ブランド管理）** | 最終投稿内容の確認のみ | スクリプト・動画の確認と承認ボタンのみ |

### ユーザーストーリー（達成基準）

```
As マーケ担当者:
  Slack で商品画像URLとタイトルを送るだけで動画が生成される
  スクリプトを確認して「承認」ボタンを押すだけで動画生成が始まる
  エラーが起きても「何が起きているか」が日本語で分かる

As 承認者:
  誰かが作った動画候補を Slack で受け取り、投稿する/しないを判断できる
  承認なしでは TikTok / Instagram に投稿されない

As 管理者:
  誰がいくら API を使ったかを月次で把握できる
  どのコンテンツをいつ誰が投稿したかを追跡できる
```

---

## ハーネスエンジニアリング 3層モデル

```
┌─────────────────────────────────────────────┐
│  Layer C: インターフェース層                  │
│  Slack Bot / Web UI / Notion トリガー        │
├─────────────────────────────────────────────┤
│  Layer B: 多人数アクセス制御                  │
│  実行者識別 / シークレット管理 / コスト追跡    │
├─────────────────────────────────────────────┤
│  Layer A: パイプライン堅牢性（前提条件）       │
│  設定バリデーション / 状態永続化 / 承認ゲート   │
└─────────────────────────────────────────────┘
```

**依存関係**: Layer C は Layer B の上に、Layer B は Layer A の上に成り立つ。  
Layer A が未実装のまま Layer C を作っても、エラーで崩れる。

---

## Layer A: パイプライン堅牢性（前提条件）

詳細実装は [harness-engineering.md](harness-engineering.md) を参照。

| ギャップ | 優先度 | 実装内容 |
|---|---|---|
| 1. 設定バリデーション | 🔴 必須 | 起動時に全 API キーをチェック。実行前に失敗させる |
| 2. ジョブ状態永続化 | 🔴 必須 | `state.json` でクラッシュ後も再開可能 |
| 3. スクリプト承認ゲート | 🟡 重要 | 動画生成前に人間確認。`AUTO_APPROVE=true` で無効化可 |
| 4. Slack アラート | 🟡 重要 | パイプライン失敗時に Webhook 通知 |
| 5. クォータ管理 | 🟢 推奨 | HeyGen 残高を生成前にチェック |
| 6. 監査ログ | 🟢 推奨 | `audit.log` に全イベントと実行者を記録 |

---

## Layer B: 多人数アクセス制御

### B-1. 実行者の識別

**最小実装（今すぐできる）**:
```bash
OPERATOR=yamada make UGC IMG=product.jpg TITLE="商品名"
# → audit.log に { operator: "yamada", ... } が記録される
```

`OPERATOR` は自己申告なので改ざん可能だが、監査の第一歩として十分。  
Slack Bot 化すると Slack ユーザー ID が自動付与されるため、この問題が解消される。

### B-2. シークレット管理（`.env` の共有問題）

`.env` ファイルを複数人で共有すると:
- 誰かがキーを変えると全員に影響する
- ファイルを Slack で送ると Slack のサーバーに残る
- 退職者が API キーを持ち出せる

**方式の選択肢**:

| 方式 | コスト | スケール | 推奨場面 |
|---|---|---|---|
| `.env` ファイル直書き | ゼロ | 1人のみ | 現状（開発者1人） |
| 1Password Secrets Automation | 月800円〜 | 〜10人 | 社内共有フェーズ ← **推奨** |
| Doppler | 月0〜数千円 | 10〜100人 | 成長期 |
| AWS Secrets Manager | 使用量課金 | 無制限 | 本格クラウド運用 |

**推奨: 1Password Secrets Automation**

```bash
# op run で secrets を注入してパイプラインを実行
op run --env-file=".env.op" -- node cli.js generate product.jpg --title "商品名"
```

```env
# .env.op（リポジトリに入れてよい）
ANTHROPIC_API_KEY=op://ugc-vault/anthropic/api-key
HEYGEN_API_KEY=op://ugc-vault/heygen/api-key
MAKEUGC_API_KEY=op://ugc-vault/makeugc/api-key
```

メリット: API キーが `.env` ファイルに残らない / 1Password の権限管理でアクセス制御できる

### B-3. 同時実行の分離

```
現状の問題:
  User A が実行 → output/inpaint3 を確保
  User B が同じタイミングで実行 → output/inpaint3 を取得 → 上書き競合

解決:
  outputDir = output/jobs/{uuid} に変更するだけで競合がなくなる
  （jobDir は既に /tmp/ugc-job-{uuid}/ で UUID を使っている）
```

```js
// lib/job-dir.js の変更（1行）
// Before: output/inpaint{N}
// After:  output/jobs/{uuid}
```

### B-4. コスト追跡

`audit.log` に コスト情報を追加することで、月次レポートが作れる:

```json
{
  "ts": "2026-04-07T10:00:00Z",
  "event": "job_completed",
  "operator": "yamada",
  "provider": "heygen",
  "videosGenerated": 3,
  "claudeInputTokens": 4200,
  "claudeOutputTokens": 1800,
  "estimatedCostJPY": 45
}
```

```bash
# 月次コストレポート（jq で集計）
cat audit.log | jq -r 'select(.event=="job_completed") | [.operator, .estimatedCostJPY] | @tsv' | awk '{ sum[$1]+=$2 } END { for (k in sum) print k, sum[k] }'
```

---

## Layer C: インターフェース層

### 選択肢の比較

| 方式 | 開発コスト | 使いやすさ | 承認フロー | 推奨 |
|---|---|---|---|---|
| **Slack Bot** | 中（1〜2週間） | ★★★★★ | ボタンで承認 | ✅ 推奨 |
| **Web UI** | 高（1〜2ヶ月） | ★★★★☆ | Web 画面で承認 | 将来対応 |
| **Notion DB トリガー** | 低（2〜3日） | ★★★★☆ | Status 変更でトリガー | 検討余地あり |
| **Google スプレッドシート** | 低（1日） | ★★★☆☆ | セル変更でトリガー | 最小 MVP として検討 |
| **CLI + ガイド強化** | 最低（半日） | ★★☆☆☆ | readline 承認 | エンジニアのみ |

### 推奨: Slack Bot（2段階で実装）

#### Stage 1: 起動 + スクリプト承認

```
[社員] /ugc https://example.com/product.jpg キャンペーン商品名

[Bot]  ✅ パイプライン開始しました
       分析中... (通常1〜2分)

[Bot]  📝 スクリプト候補が3本生成されました

       **バリアント1: 問題提起型**
       "肌荒れで悩んでいたとき、これに出会ってから..."

       **バリアント2: 驚き数字型**
       "使って3日で変化を実感したのは..."

       **バリアント3: 共感型**
       "敏感肌の私でもずっと使い続けられる理由..."

       [✅ 承認して動画生成へ] [❌ 却下] [✏️ 修正依頼]

[承認者] ✅ ボタンを押す

[Bot]  🎬 動画を生成中です（通常5〜10分）
       完成したら通知します
```

#### Stage 2: 完成動画のプレビュー + 投稿承認

```
[Bot]  🎉 動画が完成しました（3本）

       [動画1: 問題提起型] → Slack に直接添付 or S3 URL
       [動画2: 驚き数字型]
       [動画3: 共感型]

       [📤 TikTokに投稿] [📤 Instagramに投稿] [🗑 却下] [🕐 後で投稿]
```

#### Slack Bot の技術構成

```
Slack Bolt for Node.js
  ↓
Socket Mode（サーバー不要・ファイアウォール内で動作可能）
  ↓
ugc/pipeline/run.js（既存パイプライン）
  ↓
S3 / Cloudflare R2（動画の一時保存・プレビュー URL 生成）
```

**Socket Mode を選ぶ理由**: 公開 HTTPS エンドポイントが不要。社内 PC やローカルサーバーでも動く。

---

## 実装ロードマップ

```
Step 1: Layer A（前提条件）           期間: 1〜2日
  ├ config.js に validateConfig() 追加
  ├ lib/job-state.js — state.json の読み書き
  ├ cli.js に --resume フラグ追加
  ├ lib/alert.js — Slack Webhook 通知
  └ run.js の catch で alertError() を呼ぶ

Step 2: Layer B 最小実装              期間: 半日
  ├ OPERATOR 環境変数を audit.log に記録
  ├ outputDir を output/jobs/{uuid} に変更
  └ audit.log のコストフィールド追加

Step 3: Layer C Phase 1（Slack Bot）  期間: 1週間
  ├ bot/index.js — Slack Bolt + Socket Mode
  ├ /ugc コマンド → pipeline run → スクリプトを Slack に送信
  └ [承認] ボタン → avatar-gen ステージを実行

Step 4: Layer C Phase 2（動画投稿）   期間: 1週間
  ├ 完成動画を R2 にアップロード → Slack にプレビュー
  └ [投稿] ボタン → distribute.js（Phase 2 と連携）
```

### 各ステップの完了定義

| ステップ | 完了定義 |
|---|---|
| Step 1 | APIキー未設定で即エラー / crash 後 `--resume` で再開できる |
| Step 2 | 2人が同時実行してもジョブが競合しない / audit.log に operator が記録される |
| Step 3 | マーケ担当者が Slack のみで動画を生成・承認できる |
| Step 4 | 承認者が Slack のボタンだけで TikTok/Instagram に投稿できる |

---

## 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| [harness-engineering.md](harness-engineering.md) | Layer A の実装詳細（コードあり） |
| [phase2-sns-distribution.md](phase2-sns-distribution.md) | Step 4 で使う SNS 投稿 API 仕様 |
| [../../sns-vision.md](../../VISION.md) | このシステムの北極星 |
