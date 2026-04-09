# UGC × SNS 自動運用システム — 事業化・スケール設計

**作成日**: 2026-04-07  
**前提**: [sns-vision.md](../../VISION.md) の北極星をベースに、SNS代行業者向けSaaSとしてスケールさせる設計

---

## 1. ターゲット顧客とペインポイント

### なぜ「SNS代行業者」をターゲットにするか

| 観点 | 内容 |
|---|---|
| **痛みが深い** | 30クライアントを抱えても動画制作は人手頼り → 受注が増えるほどコストが線形に増える |
| **支払い能力がある** | 1クライアントあたり月5〜30万円を受注している → ツール代を払える |
| **普及コストが低い** | 1代行業者に売れば → その代行業者の30クライアント全員に使われる |
| **データが質高い** | プロが毎日使うため「何が効くか」のデータが早く・大量に蓄積される |

### 代行業者の業務実態

```
【現状の代行業者の1クライアント対応コスト】

月に30本投稿しようとすると:
  ・スクリプト作成: 3〜4時間（要ライター）
  ・撮影・出演者手配: 5〜10時間
  ・編集・字幕: 5〜8時間
  ・投稿・アナリティクス確認: 2〜3時間
  合計: 15〜25時間/クライアント/月

10クライアント抱えると → 150〜250時間/月 → 2〜3人分の工数
このままスケールすると採用コストが急増し、利益率が下がる

【このシステムを使った場合】
  ・商品画像とタイトルを入力: 10分
  ・スクリプト承認: 10分
  ・動画確認: 10分
  合計: 30〜40分/クライアント/月

10クライアント対応で 5〜7時間/月 → 1人で20〜30クライアントを担当できる
```

### ペルソナ（購買決定者）

**SNS代行業者のオーナー / ディレクター**
- 動画制作コストを下げて利益率を改善したい
- クオリティは維持しながらクライアント数を増やしたい
- 担当者が変わっても品質が均一であってほしい

---

## 2. ビジネスモデル

### 課金構造

| プラン | 月額 | ブランド上限 | 動画生成本数/月 | 対象 |
|---|---|---|---|---|
| **スターター** | 3万円 | 3ブランド | 30本 | 個人・小規模代行 |
| **プロ** | 8万円 | 10ブランド | 100本 | 中規模代行（5〜10名） |
| **エンタープライズ** | 20万円〜 | 無制限 | 無制限 | 大手代行・白ラベル |

### コスト構造（1本あたり）

| 項目 | 単価 |
|---|---|
| HeyGen / MakeUGC 動画生成 | 約100円 |
| Claude API（分析+リサーチ+スクリプト） | 約10〜20円 |
| **合計** | **約120〜150円/本** |

### 粗利試算

| プラン | 売上/月 | 原価/月 | 粗利/月 | 粗利率 |
|---|---|---|---|---|
| スターター (30本) | 3万円 | 0.45万円 | 2.55万円 | 85% |
| プロ (100本) | 8万円 | 1.5万円 | 6.5万円 | 81% |
| エンタープライズ (300本) | 20万円 | 4.5万円 | 15.5万円 | 78% |

**API コストが固定費でないため、使われれば使われるほど原価が増えるが、粗利率は高水準を維持できる。**

---

## 3. 差別化の源泉

### コモディティ化しやすい部分

- 動画生成（HeyGen/MakeUGC は誰でも使える）
- SNS自動投稿（Buffer/Hootsuite で代替可能）
- テキスト生成（ChatGPT でも可能）

### 参入障壁になる部分

```
「何が効いたか」の学習データ

  patterns テーブル    → 商品カテゴリ × フォーマット × フック別のCVR
  failure_patterns     → 失敗した投稿の要因分類
  desire_map           → 欲望連鎖パターンの蓄積
  knowledge_base       → confidence が積み上がるほど精度が上がる

使えば使うほど強くなる。
新規参入者は同じデータを一から集めなければならない。
```

**重要**: このシステムは最初は単なる「動画生成ツール」だが、データが蓄積されると「どの商品カテゴリに何が効くかを知っているシステム」になる。これが真の参入障壁。

---

## 4. マルチテナントアーキテクチャ

### 現状 → 目標

```
現状: 1ブランド × 1人 × CLIツール
         ↓
目標: N代行業者(テナント) × Nブランド × Nユーザー × セルフサービス
```

### テナント / ブランド 階層

```
テナント（代行業者）
  ├─ tenant_id: t_abc123
  ├─ api_keys: { anthropic, heygen, makeugc } ← テナントごとに管理
  │
  ├─ ブランドA（クライアント1: コスメブランド）
  │   ├─ brand_id: b_001
  │   ├─ avatar_pool: [20代女性清潔感, 専門家風]
  │   ├─ preferred_formats: [before-after, routine]
  │   ├─ tone: "信頼感 + 親しみやすい"
  │   ├─ hashtags: ["#スキンケア", "#美容"]
  │   └─ post_schedule: { tiktok: 19:00, instagram: 12:00 }
  │
  └─ ブランドB（クライアント2: 食品ブランド）
      ├─ brand_id: b_002
      ├─ avatar_pool: [30代女性生活感, ティーン]
      ├─ preferred_formats: [reaction, unboxing]
      └─ ...
```

### データ設計

```sql
-- テナント（代行業者）
CREATE TABLE tenants (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  plan         TEXT,  -- starter/pro/enterprise
  created_at   TEXT
);

-- ブランド（代行業者のクライアント）
CREATE TABLE brands (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT REFERENCES tenants(id),
  name             TEXT,
  category         TEXT,  -- beauty/food/gadget/lifestyle/...
  avatar_pool      TEXT,  -- JSON配列: [{id, type, gender, age_range}]
  voice_pool       TEXT,  -- JSON配列
  preferred_formats TEXT, -- JSON配列: ["before-after", "routine"]
  tone             TEXT,
  hashtags         TEXT,  -- JSON配列
  post_schedule    TEXT,  -- JSON: {tiktok: "19:00", instagram: "12:00"}
  created_at       TEXT
);

-- ジョブ（動画生成の記録）
CREATE TABLE jobs (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT REFERENCES tenants(id),
  brand_id     TEXT REFERENCES brands(id),
  operator     TEXT,  -- 実行者（Slack user_id等）
  status       TEXT,  -- pending/running/awaiting_approval/completed/failed
  image_path   TEXT,
  title        TEXT,
  output_dir   TEXT,
  cost_jpy     REAL,
  created_at   TEXT,
  updated_at   TEXT
);
```

### CLI の変更点

```bash
# 現状
node cli.js generate product.jpg --title "商品名"

# ブランド指定に対応
node cli.js generate product.jpg --title "商品名" --brand b_001

# ブランド一覧
node cli.js brands list

# ブランド設定を編集
node cli.js brands edit b_001
```

`brands.json` をプロジェクトルートに置いてブランド設定を管理するシンプルな実装から始める。

---

## 5. UGCキャラクターライブラリ拡張

### アバターの多様化（現状3本→8〜10本）

| タイプ | ターゲット商品カテゴリ | HeyGen/MakeUGC で用意すべき属性 |
|---|---|---|
| **20代女性・清潔感** | 美容・スキンケア・ファッション | 明るい・柔らかいトーン |
| **30代女性・生活感** | 食品・日用品・育児グッズ | 親しみやすい・信頼感 |
| **20代男性・カジュアル** | ガジェット・スポーツ・お酒 | テンション高め・フランク |
| **30代男性・ビジネス** | 健康食品・ビジネスツール | 落ち着き・説得力 |
| **専門家風（白衣等）** | 美容機器・医薬品・健康食品 | 権威性・信頼感 |
| **ティーン〜20代** | コスメ・ファッション・グルメ | トレンド感・フレッシュ |

**実装ステップ**:
1. HeyGen/MakeUGC でアバターIDを各タイプ1〜2本ずつ取得
2. `avatar_pool` をタイプ別に `brands.json` で管理
3. `research.js` が商品カテゴリ分析結果をもとにアバタータイプを推薦

### 動画フォーマットライブラリ

現状の「フック3種類（問題提起/数字/共感）」はスクリプト構造が同一。  
フォーマット（動画の構成パターン）を別の軸として追加する。

| フォーマット | 構成 | 適商品カテゴリ | TikTok での有効性 |
|---|---|---|---|
| **routine** ← 現状 | フック→メリット→CTA | 全般 | ★★★ |
| **before-after** | 悩み描写→使用→変化→CTA | 美容・ダイエット・掃除 | ★★★★★ |
| **unboxing** | 開封→第一印象→詳細→評価→CTA | ガジェット・コスメ・食品 | ★★★★ |
| **how-to** | 問題提起→手順（3ステップ）→結果→CTA | 調理器具・美容ツール | ★★★★ |
| **reaction** | 初見反応→使用→率直な感想→CTA | 食品・飲料・体験型 | ★★★★ |
| **challenge** | トレンドに乗せた使用シーン→結果→CTA | 若年層向け全般 | ★★★ |

**実装方針**:

```js
// script-plan.js のプロンプト変更
const FORMAT_PROMPTS = {
  'before-after': `
    スクリプトは以下の構成で書く:
    1. フック（悩み描写）: "〇〇で悩んでいたとき..."
    2. 使用シーン（3〜5秒）
    3. 変化・結果（具体的な数字・期間）
    4. CTA
  `,
  'unboxing': `...`,
  'how-to': `...`,
};

// research.js が format を推薦して渡す
const format = researchResult.recommendedFormat; // "before-after"
```

---

## 6. 技術スケールロードマップ

### Phase 1: マルチブランド対応（〜2週間）

**目標**: 1台のPCで複数ブランドを切り替えて使えるようになる

```
実装内容:
  ├─ brands.json でブランド設定を管理
  ├─ cli.js --brand フラグで切り替え
  ├─ audit.log に brand_id・tenant_id を記録
  ├─ outputDir を output/jobs/{uuid}/{brand_id}/ に変更
  └─ avatar_pool から商品カテゴリに合ったアバターを選択するロジック

完了定義:
  - 異なるブランド設定で同日に複数の動画を生成できる
  - audit.log でどのブランドに何が使われたか確認できる
```

### Phase 2: ジョブキューの導入（〜1ヶ月）

**目標**: 複数ブランドを並行処理できるようになる

```
実装内容:
  ├─ BullMQ（Redis）でジョブキューを持つ
  ├─ ジョブの状態管理（pending/running/awaiting_approval/completed）
  ├─ 並行ジョブ数の制限（HeyGen/MakeUGC のAPI制限に合わせる）
  └─ ジョブ失敗時の自動リトライ（最大3回）

完了定義:
  - 3ブランド分のジョブを同時に投入して並行実行できる
  - 1つが失敗しても他の2つは続行する
```

### Phase 3: Web ダッシュボード + API 化（〜3ヶ月）

**目標**: 代行業者がブラウザだけで全操作できるようになる

```
実装内容:
  ├─ REST API（Fastify）: ジョブ投入・ブランド管理・レポート取得
  ├─ Web UI（Next.js）: ダッシュボード・スクリプト承認・動画プレビュー
  ├─ 認証（Clerk / Auth.js）: テナントごとのログイン
  ├─ Slack Bot: /ugc コマンドで Web UI を経由せず操作可能に
  └─ Zapier / Make コネクタ: 他ツールとのノーコード連携

完了定義:
  - 代行業者がターミナルを使わず全操作できる
  - クライアントブランドごとの月次コストレポートが出力できる
```

---

## 7. GTM 戦略（最初の1社をどう獲得するか）

### 推奨アプローチ: 代行業者への直接提案

```
Step 1: 自社でこのシステムを使ってリアルな動画を30本作る
        → 「自社で使っている」という実績が最強の営業ツール

Step 2: その動画のCVRデータ（完視聴率・CTR・保存率）を持って提案する
        → データで話せる = 代行業者にとって魅力的

Step 3: 最初の1社は「無料or大幅割引」で3ヶ月使ってもらう
        → 彼らのフィードバックでシステムが磨かれる
        → 「SNS代行業者が実際に使っている」という事例が生まれる

Step 4: その業者の事例をもとに他の代行業者に展開
```

### 価格設定の注意点

最初から3プランを出す必要はない。  
最初は「月5万円 / 5ブランドまで / 月50本」の1プランだけで始めて、  
顧客の使い方を観察してからプラン設計を最適化する。

---

## 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| [sns-vision.md](../../VISION.md) | 北極星（ugc + sns-manage の上段設計） |
| [tech/multi-user-harness.md](tech/multi-user-harness.md) | 社員全員向けハーネス設計（先に実装が必要） |
| [tech/harness-engineering.md](tech/harness-engineering.md) | Layer A の実装詳細 |
| [tech/phase2-sns-distribution.md](tech/phase2-sns-distribution.md) | SNS投稿 API 仕様 |
