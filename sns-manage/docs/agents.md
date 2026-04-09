# エージェント仕様

10本のエージェントがパイプライン形式で連携する。
エージェント間のデータは `jobs/{jobId}/*.json` ファイルで受け渡す。

---

## パイプライン構造

```
01_research
    ↓
02_planning  ← DB: 勝ちパターン + 負けパターン + 知識ベースを注入
    ↓
03_writer
    ↓
[04_design]  ← Phase3（未実装）
    ↓
05_marketing → DB: contents テーブルに保存
    ↓
06_publish   → DB: posts テーブルに保存（承認ゲート必須）
    ↓
07_analytics → DB: metrics テーブルに保存
    ↓
08_evaluate  → DB: patterns / failure_patterns / knowledge_base 更新
```

---

## 01_research — リサーチエージェント

**役割:** トレンド・競合・オーディエンス・欲望連鎖を調査する

| | |
|---|---|
| 入力 | topic, platforms, targetAudience, category |
| 出力 | `01_research-output.json` |
| モデル | Claude Sonnet |
| キャッシュ | 同一キーワードは24時間 `research_cache` テーブルにキャッシュ |

**出力フィールド:**
```json
{
  "trendKeywords": ["キーワード1", ...],
  "competitorInsights": [{ "platform": "tiktok", "hookPattern": "before/after型", "avgEngagement": 0.05 }],
  "audienceInsights": { "painPoints": [...], "desiredOutcome": "...", "peakHours": {...} },
  "recommendedAngles": ["訴求角度1", ...],
  "desireChain": {
    "desireObject": "欲しがっている対象（状態・体験）",
    "desireSubject": "欲しがっている人物像の描写",
    "mediatorType": "influencer | community | trend | event",
    "triggerEmotion": "aspiration | envy | fear | excitement | belonging",
    "spreadPattern": "vertical | horizontal"
  }
}
```

**哲学:** 問いは「何が流行っているか」ではなく「誰が何を欲しがっていて、誰がその欲望に共鳴しているか」。`desireChain` を `desire_map` テーブルに蓄積する。

---

## 02_planning — 企画エージェント

**役割:** リサーチ結果と蓄積知識を統合してコンテンツの設計図を作る

| | |
|---|---|
| 入力 | `01_research-output.json` |
| 出力 | `02_planning-output.json` |
| モデル | Claude Sonnet |
| DB参照 | `getTopPatterns()` + `getTopFailures()` + `getKnowledgeBase()` |

**システムプロンプトへの注入（学習ループの起点）:**
1. **勝ちパターン** — 「やるべきこと」
2. **負けパターン + 回避ルール** — 「やってはいけないこと」
3. **知識ベース（confidence付き）** — 蓄積されたインサイト

**哲学:** 勝ちパターンがないフェーズでも、負けパターンの蓄積がシステムを強化する（アンチフラジリティ）。

---

## 03_writer — ライターエージェント

**役割:** 各プラットフォーム向けテキストコンテンツを生成する

| | |
|---|---|
| 入力 | `02_planning-output.json` + `01_research-output.json` |
| 出力 | `03_writer-output.json` |
| モデル | Claude Sonnet（本文）+ Claude Haiku（ハッシュタグ最適化） |

**文字数制限（Zodで強制）:**
- Twitter/X: 280文字
- TikTok/Instagram: 2200文字
- YouTube: 5000文字

**執筆の鉄則（模倣欲望原則）:**
1. 商品・サービス・機能を主語にしない
2. 「欲しがっている人間の状態・感情・場面」を冒頭に描写する
3. 読者が「これは自分の話だ」と感じた瞬間にのみ伝播が始まる
4. CTAは欲望が高まった後に初めて置く

**禁止事項（薬機法・景表法）:** 効能断定・根拠なき最上級表現・不明確な価格表示

---

## 04_design — デザインエージェント（Phase 3）

**役割:** ビジュアル指示書・サムネイルプロンプト・storyboard を生成

現在はスケルトンのみ。fal.ai FLUX 連携は Phase 3 で実装。

---

## 05_marketing — マーケティングエージェント

**役割:** A/Bバリアントを生成し、配信戦略を決定する

| | |
|---|---|
| 入力 | `03_writer-output.json` + `02_planning-output.json` |
| 出力 | `05_marketing-output.json` |
| モデル | Claude Sonnet |
| DB書き込み | `contents` テーブルに各バリアントを保存 |

**A/Bテスト設計原則（模倣欲望理論の検証）:**
- 企画が `desire_centric` → Variant A = desire_centric, Variant B = object_centric
- 企画が `object_centric` → Variant A = object_centric, Variant B = desire_centric
- **必ず逆のhookTypeをペアにして実験する**

この蓄積によって「プラットフォーム×カテゴリ×hookType」のどの組み合わせが勝つかを継続学習する。

---

## 06_publish — 自動投稿エージェント

**役割:** 承認済みコンテンツを実際にSNSへ投稿する

| | |
|---|---|
| 入力 | `05_marketing-output.json` |
| 出力 | `06_publish-output.json` |
| 対応プラットフォーム | Twitter（OAuth 1.0a 実装済み） / その他 Phase2 |

**承認ゲート（絶対条件）:** `posts.status = 'approved'` でなければ投稿しない。この判定は削除・無効化禁止。

**リトライ:** 最大3回・指数バックオフ（1s → 4s → 16s）

投稿後、`analytics_schedule` に +24h/+72h/+168h の分析スケジュールを自動登録する。

---

## 07_analytics — 分析エージェント

**役割:** 投稿後の指標をPlatform APIから収集してDBに保存する

| | |
|---|---|
| 入力 | jobId, postId, platform |
| 出力 | `07_analytics-output.json` |
| モデル | Claude Haiku（インサイト生成） |
| 実行タイミング | 投稿後24h / 72h / 168h（スケジューラーが自動実行） |

**Twitter Metrics API:**
```
GET /2/tweets/:id?tweet.fields=public_metrics,non_public_metrics
→ impressions, like_count, retweet_count, reply_count, url_link_clicks
```

**フォールバック:** Platform APIが使えない場合は Claude Haiku で「推定インサイト」を生成し `manual: true` フラグを立てて保存。

---

## 08_evaluate — 評価エージェント

**役割:** A/Bテストを判定し、勝ち/負けパターンをDBに記録して知識ベースを更新する

| | |
|---|---|
| 入力 | `07_analytics-output.json` |
| 出力 | `08_evaluate-output.json` |
| モデル | Claude Haiku（失敗分析） |
| DB書き込み | patterns / failure_patterns / knowledge_base / experiment_log |

**採択基準:** `lift ≥ 1.1`（ベースライン比+10%以上）かつ `impressions ≥ 500`

**勝ちの場合:** `patterns` テーブルに登録 → 次回 02_planning が参照

**負けの場合（アンチフラジリティ）:**
1. `analyzeFailure()` で失敗モードを模倣欲望フレームで分類
2. `failure_patterns` テーブルに登録
3. `knowledge_base` を更新（experimentInsight があれば）

**失敗モード分類:**
- `wrong_mediator` — 欲望の媒介者が読者に近くなかった
- `wrong_emotion` — 感情の種類が間違っていた
- `object_centric_drift` — コンテンツが商品主語に戻っていた
- `timing` — タイミング・文脈が合わなかった
- `low_quality` — コンテンツ自体の品質問題

**週次PDCAレポート:** 月曜日の場合は直近7日のメトリクスで Claude Sonnet がレポートを生成し `pdca_reports` テーブルに保存。

---

## 09_report — レポートエージェント

**役割:** 日次スナップショット取得・週次AIレポート生成・Google Sheets 自動書き込み

| | |
|---|---|
| 実行タイミング | 毎日 0:00（スナップショット）/ 毎週月曜 0:00（週次レポート） |
| モデル | Claude Sonnet |
| DB書き込み | daily_snapshots / weekly_reports |
| 外部連携 | Google Sheets API v4 |

**スナップショット（`takeDailySnapshot()`）:**
その日に投稿・計測されたメトリクスをプラットフォーム別に集計し `daily_snapshots` テーブルと Google Sheets の "Daily Metrics" シートに保存。

**週次レポート（`generateWeeklyReport()`）:**
今週 vs 先週の比較分析を Claude Sonnet が行い、以下を含むJSONを生成:
- `summary` — 全体の総評
- `highlights` — 良かった点 / 悪かった点
- `suggestions` — 改善提案3つ（priority / category / action / expectedEffect）
- `nextWeekFocus` — 来週のフォーカスポイント
- `riskAlert` — 注意すべきリスク

生成結果は `weekly_reports` テーブル・Google Sheets・`reports/memory/` フォルダの3箇所に保存。

---

## 10_browser — ブラウザ自動化エージェント

**役割:** Playwright を使ったブラウザ経由の SNS 操作

| | |
|---|---|
| ブラウザ | Chromium（Playwright） |
| セッション | `browser-sessions/{platform}/` に永続化 |

**主要関数:**
- `loginInteractive(platform)` — 初回ログイン（headless: false でブラウザを開く）
- `postTwitterBrowser({ text })` — ログイン済みセッションでツイート
- `postInstagramBrowser({ caption })` — Instagram 投稿フロー開始
- `captureScreenshot({ url })` — 任意URLのスクリーンショット取得

**初回セットアップ:**
```bash
npx playwright install chromium
# → POST /api/browser/login { "platform": "twitter" } でブラウザを開いてログイン
# → セッションが永続化され以降はheadless投稿が可能
```
