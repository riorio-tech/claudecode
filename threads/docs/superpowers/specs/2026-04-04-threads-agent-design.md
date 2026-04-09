# Threads 自動投稿AIエージェント 設計仕様

**作成日**: 2026-04-04  
**対象ディレクトリ**: `/Users/reoreo/claudecode/threads/`  
**ステータス**: 設計中

---

## 哲学 — 尖端にあるものを、届ける

AIは平等をもたらさない。**使う者だけが加速する。**

知っている者と知らない者の間に、すでに埋めがたい差が生まれている。
「プロンプトエンジニアリング」「エージェント」「RAG」——言葉が先行し、
本当に必要な人の手に届かないまま、差は広がり続ける。

善意は情報格差を埋めない。**伝え方だけが埋める。**

このエージェントは、AI初心者に向けて毎日投稿する。
教科書ではなく体験談として。説教ではなく発見の共有として。
「自分にも使えるかも」と思わせる一言を、2時間おきに打ち込み続ける。

積み重ねは小さくていい。
加速する人間を、一人でも増やすことが目的だ。

---

## ターゲット

| 属性 | 詳細 |
|------|------|
| 主要ターゲット | AI初心者・AIを学び始めた社会人・学生 |
| ペルソナ | 「ChatGPTは使ったことあるけど、それ以上は知らない」人 |
| 避けるべきトーン | 技術自慢・専門用語の羅列・マウント・未来予言 |
| 目指すトーン | 隣の人の体験談・小さな発見の共有・背中を押す言葉 |

---

## コンテンツカテゴリ（ローテーション）

2時間おきに投稿（1日最大12投稿）。以下のパターンで循環する。

| カテゴリ | 内容 | 1日の割合 |
|---------|------|---------|
| `tip` | 即使えるAI活用tips（1投稿完結） | 5投稿 |
| `story` | 体験談・聞いた話（ストーリー形式） | 3投稿 |
| `concept` | AI概念をやさしく解説 | 2投稿 |
| `question` | フォロワーへの問いかけ（エンゲージメント目的） | 2投稿 |

**ローテーション例（1日12投稿）:**
`tip → story → tip → concept → tip → question → story → tip → concept → tip → story → question`

---

## トリガー

```bash
# 1回手動実行
cd threads && make POST

# ドライラン（投稿せず内容確認）
make DRY_RUN

# スケジュール設定（2時間おき）
make SCHEDULE

# フォーマット型を再リサーチ（初回 or 更新時のみ）
make RESEARCH_FORMATS

# アカウント設計（スキル経由でのみ呼び出し）
/threads-account-design
```

---

## ディレクトリ構造

```
threads/
├── Makefile
├── package.json
├── config.js
├── .env.example
├── cli.js
├── pipeline/
│   ├── run.js               # オーケストレーター
│   │
│   ├── # === AIエージェント（Claude使用・コストあり） ===
│   ├── researcher.js        # Stage 2: Web検索リサーチ
│   ├── writer.js            # Stage 3: フォーマット型に沿って投稿文生成
│   ├── reviewer.js          # Stage 4: トーン・品質チェック
│   ├── format-research.js   # 初回のみ: 投稿フォーマット型10個リサーチ
│   │
│   └── # === システムエージェント（コストゼロ） ===
│       ├── theme-picker.js  # Stage 1: 決定論的ローテーション
│       ├── format-picker.js # Stage 2.5: formats.jsonから型を選択
│       ├── poster.js        # Stage 5: Threads API HTTP
│       └── reflector.js     # Stage 6: ファイルI/Oのみ
├── lib/
│   ├── threads-api.js
│   ├── logger.js
│   └── job-dir.js
├── memory/
│   ├── posted.json          # 投稿履歴
│   ├── themes.json          # トピックプール + ローテーションIndex
│   ├── formats.json         # 投稿フォーマット10型（format-research.jsが生成）
│   └── patterns.json        # 反応記録
├── docs/
└── output/
    └── post_{YYYYMMDD}/
```

---

## エージェント分類

### AIエージェント（Claude必須・コストあり）

| エージェント | 役割 | 実行頻度 |
|------------|------|---------|
| `researcher.js` | Web検索でテーマの生情報を収集 | 毎投稿 |
| `writer.js` | フォーマット型に沿って3バリアント生成 | 毎投稿 |
| `reviewer.js` | 3バリアントを採点・最良を選択 | 毎投稿 |
| `format-research.js` | SNS人気フォーマット10型をリサーチ | 初回のみ |

### システムエージェント（コストゼロ）

| エージェント | 役割 | 実装 |
|------------|------|------|
| `theme-picker.js` | ローテーション計算 + トピック選択 | 純粋なJS |
| `format-picker.js` | formats.jsonから今回の型を選ぶ | 純粋なJS |
| `poster.js` | Threads APIへのHTTPリクエスト | fetch のみ |
| `reflector.js` | 履歴・output保存 | ファイルI/Oのみ |

---

## パイプライン（6ステージ）

### Stage 1 — theme-picker.js（システム）
- `memory/posted.json` のレコード数でカテゴリを決定（ROTATION配列の剰余）
- `memory/themes.json` の `rotationIndex` でトピックを選択
- Claude不使用。計算のみ
- 出力: `01_theme.json`

### Stage 2 — researcher.js（AI）
- Claude Sonnet + Web検索でテーマの生情報を収集
- `hookIdeas`, `keyFacts`, `useCases`, `beginnerPains` を抽出
- 出力: `02_research.json`

### Stage 2.5 — format-picker.js（システム）
- `memory/formats.json` からカテゴリに合う型を選択
- `posted.json` で直近に使った型を避ける（重複防止）
- Claude不使用。配列フィルタのみ
- 出力: `02b_format.json`

### Stage 3 — writer.js（AI）
- 選ばれた型の `structure` テンプレートに沿って3バリアント生成
- 各バリアントは同じ型・異なるフックで書く
- 出力: `03_draft.json`

### Stage 4 — reviewer.js（AI）
- 3バリアントを採点（トーン・フック力・具体性・重複・NG表現）
- 最高スコアを選び、必要なら軽微修正
- 出力: `04_review.json`

### Stage 5 — poster.js（システム）
- Threads API raw HTTP で投稿
- dry-run時はスキップ
- 出力: `05_result.json`

### Stage 6 — reflector.js（システム）
- `posted.json` に追記
- `themes.json` の rotationIndex を更新
- `output/post_{YYYYMMDD}/` にファイル保存
- 出力: `06_reflect.json`

---

## 投稿フォーマット10型（formats.json）

`format-research.js` が初回のみ実行してリサーチ・生成する。
各フォーマットは以下の構造を持つ:

```json
{
  "id": "before_after",
  "name": "Before/After型",
  "categories": ["tip", "story"],
  "structure": "以前: [課題・悩み]\n今: [AIで解決した状態]\n\n変えたのは[1行で説明]だけ。",
  "hook_template": "以前の私、〇〇で毎回詰まってた。",
  "when_to_use": "行動変容・習慣改善系のテーマに最適",
  "example": "以前: 毎回メールの書き出しで5分悩んでた。\n今: 「丁寧なビジネスメールで」と言うだけで30秒。\n\n変えたのはChatGPTに最初の一言を頼むだけ。"
}
```

---

## アカウント設計スキル（別エージェント）

スキル名: `threads-account-design`
起動: `/threads-account-design` コマンドでのみ実行
パイプラインには組み込まない。

設計するもの:
- アカウントコンセプト（ペルソナ・世界観）
- プロフィール文（bio）の候補3案
- 投稿トーン指針（言葉遣い・口調・禁止表現）
- ハッシュタグ戦略
- フォロワー獲得の初期戦略

出力: `threads/docs/account-design.md`

---

## Threads API 仕様

| 項目 | 値 |
|------|-----|
| Base URL | `https://graph.threads.net/v1.0` |
| 認証 | `Authorization: Bearer {THREADS_ACCESS_TOKEN}` |
| コンテナ作成 | `POST /{THREADS_USER_ID}/threads` |
| 投稿公開 | `POST /{THREADS_USER_ID}/threads/publish` |
| 最大文字数 | 500文字 |

---

## 設定 (.env)

```env
THREADS_ACCESS_TOKEN=
THREADS_USER_ID=
ANTHROPIC_API_KEY=
CLAUDE_MODEL=claude-sonnet-4-6
POST_INTERVAL_HOURS=2
```

---

## エスカレーション基準

- Threads API エラー（トークン期限切れ等）→ 停止してユーザーに通知
- 全バリアントのレビュースコアが30/50未満 → 再生成（最大1回）
- `formats.json` が存在しない → `make RESEARCH_FORMATS` を促す
