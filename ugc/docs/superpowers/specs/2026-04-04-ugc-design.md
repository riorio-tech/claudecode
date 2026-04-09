# UGC動画自動生成システム 設計仕様

**作成日**: 2026-04-04  
**対象ディレクトリ**: `/Users/reoreo/claudecode/ugc/`  
**ステータス**: 承認済み

---

## 概要

商品画像とタイトルを入力として受け取り、AI アバター（MakeUGC）が商品を紹介する UGC スタイルの TikTok 縦型動画（9:16）を自動生成するシステム。

inoue-movie5 のパイプライン思想（JSON 受け渡し・jobId 管理・output/inpaintN 形式）を継承しつつ、`ugc/` ディレクトリ内に完結させる。

TikTok・SNS の人気商品紹介動画をリサーチし、実績のある台本パターン・言い回しをスクリプト生成に反映する。

---

## トリガー

```bash
cd ugc && make UGC IMG=../product.jpg TITLE="爪切り"
# または
make -C ugc UGC IMG=../product.jpg TITLE="爪切り"
```

---

## ディレクトリ構造

```
ugc/
├── Makefile
├── package.json
├── config.js              # provider/model 設定（.env 経由）
├── .env.example
├── cli.js                 # Commander.js エントリーポイント
├── pipeline/
│   ├── run.js             # 6ステージのオーケストレーター
│   ├── analyze.js         # Stage 1: 商品情報 + 特徴抽出
│   ├── research.js        # Stage 2: 人気UGC動画リサーチ（Web検索）
│   ├── script-plan.js     # Stage 3: アバター別スクリプトバリアント生成
│   ├── avatar-gen.js      # Stage 4: MakeUGC API 動画生成
│   ├── assembly.js        # Stage 5: ffmpeg 字幕・CTA・カラーグレード
│   └── code-review.js     # Stage 6: Claude によるソースコード品質レビュー（自動実行）
├── lib/
│   ├── makeugc.js         # MakeUGC raw HTTP クライアント
│   ├── logger.js          # カラーコンソールログ
│   └── job-dir.js         # $TMPDIR/ugc-job-{jobId}/ 管理
├── docs/
│   └── superpowers/specs/ # 本ドキュメント
└── output/
    ├── inpaint1/
    │   ├── final_assembled_0.mp4  # 最終成果物（バリアント別）
    │   └── code_review.md
    └── inpaintN/
```

---

## パイプライン（6ステージ）

### Stage 1 — analyze.js
- 商品画像を Claude Sonnet でビジュアル解析（base64 エンコードして送信）
- 出力: `{ productName, category, features[], appealPoints[], estimatedPrice }`
- ファイル: `$TMPDIR/ugc-job-{jobId}/01_analyze.json`

### Stage 2 — research.js
- Claude Sonnet + Web 検索で人気 UGC 商品紹介動画のパターンをリサーチ
- 検索クエリ例: `"TikTok UGC {category} script viral 2024"` `"{productName} TikTok review hook"`
- 抽出する情報:
  - 人気フック（冒頭セリフ）のパターン
  - 効果的なベネフィット訴求の言い回し
  - CTA の表現例
- 出力: `$TMPDIR/ugc-job-{jobId}/02_research.json`（`{ hookPatterns[], benefitPhrases[], ctaExamples[] }`）

### Stage 3 — script-plan.js
- Stage 2 のリサーチ結果を参考に Claude Sonnet でスクリプトを生成
- アバター数分（デフォルト3）のバリアントを生成
- 構成: フック（冒頭2秒）→ ベネフィット → CTA（合計 20〜25 秒・1500文字以内）
- フックバリアント（リサーチ結果から最適なものを選択）:
  - `問題提起型`: 「〇〇で悩んでいませんか？」
  - `驚き数字型`: 「たった〇〇円でこれが手に入る」
  - `共感型`: 「これ使い始めてから〇〇が変わった」
- アバター/ボイス ID は `MAKEUGC_AVATARS` / `MAKEUGC_VOICES`（カンマ区切り）から順に割り当て
- 出力: `$TMPDIR/ugc-job-{jobId}/03_script-plan.json`

### Stage 4 — avatar-gen.js
- MakeUGC API `POST /video/generate` を raw HTTP で呼び出し
  - Base URL: `https://app.makeugc.ai/api`
  - 認証: `X-Api-Key: {MAKEUGC_API_KEY}` ヘッダー
  - スクリプト3本を **逐次実行**（クレジット消費を制御）
- polling: `GET /video/status?video_id={id}` を 10 秒間隔でステータス確認
- 完成 MP4 を `$TMPDIR/ugc-job-{jobId}/avatar-{i}.mp4` にダウンロード
- 出力: `$TMPDIR/ugc-job-{jobId}/04_avatar-gen.json`（video_id・ファイルパス一覧）

### Stage 5 — assembly.js
- ffmpeg で各アバター動画に字幕・CTA・カラーグレードを適用
- 字幕: `y=h*0.62 fontsize=32 白文字・影`
- CTA: `y=h*0.88 赤背景ボックス fontsize=48 「⬇ ここから買える」`
- カラーグレード: `eq=brightness=0.03:contrast=1.08:saturation=1.15, colorbalance=rs=0.04:gs=0.02:bs=-0.06:rm=0.02:gm=0.01:bm=-0.04:rh=0.01:gh=0.00:bh=-0.02`（inoue-movie5 と同一パラメータ）
- 出力先: `ugc/output/inpaint{N}/final_assembled_{i}.mp4`（N は既存最大番号+1）

### Stage 6 — code-review.js（自動実行）
- make UGC 完了後に **自動で起動**（run.js の最終ステップとして呼び出し）
- `ugc/pipeline/*.js` と `ugc/lib/*.js` の全ファイルを読み込む
- Claude Sonnet に以下の観点でレビューを依頼:
  - バグ・エラーハンドリングの漏れ
  - セキュリティ上の懸念（APIキー露出・インジェクション等）
  - 可読性・保守性の問題
  - パフォーマンス改善の余地
- 出力: `ugc/output/inpaint{N}/code_review.md` に追記（上書き禁止）
- ターミナルに改善提案のサマリーを表示
- **自動修正は行わない**（提案のみ）

---

## MakeUGC API 仕様

| 項目 | 値 |
|------|-----|
| Base URL | `https://app.makeugc.ai/api` |
| 認証 | `X-Api-Key: {key}` ヘッダー |
| 動画生成 | `POST /video/generate` |
| ステータス確認 | `GET /video/status?video_id={id}` |
| アバター一覧 | `GET /video/avatars` |
| ボイス一覧 | `GET /video/voices` |
| スクリプト上限 | 1500 文字 |
| polling 推奨間隔 | 10 秒 |

---

## 設定 (.env)

```env
MAKEUGC_API_KEY=
MAKEUGC_AVATARS=avatar_id1,avatar_id2,avatar_id3
MAKEUGC_VOICES=voice_id1,voice_id2,voice_id3
CLAUDE_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=
```

## config.js

```js
export const config = {
  MAKEUGC_API_KEY: process.env.MAKEUGC_API_KEY,
  MAKEUGC_AVATARS: process.env.MAKEUGC_AVATARS?.split(',') ?? [],
  MAKEUGC_VOICES: process.env.MAKEUGC_VOICES?.split(',') ?? [],
  CLAUDE_MODEL: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
  OUTPUT_DIR: './output',
};
```

---

## Makefile

`ugc/Makefile` に配置。

```makefile
.PHONY: UGC

UGC:
	node cli.js generate $(IMG) --title "$(TITLE)"
```

---

## 出力形式

inoue-movie5 の `output/inpaintN/` 形式に準拠:

```
ugc/output/inpaint{N}/
├── final_assembled_0.mp4    # 問題提起型アバター
├── final_assembled_1.mp4    # 驚き数字型アバター
├── final_assembled_2.mp4    # 共感型アバター
└── code_review.md           # コードレビュー結果（自動追記）
```

---

## エスカレーション基準

- MakeUGC API が `failed` ステータスを返した場合
- 生成動画の尺が 15 秒未満または 30 秒超過の場合
- クレジット残量不足エラーが出た場合（ユーザーにチャージを依頼）

---

## 検証方法

1. `cd ugc && make UGC IMG=../test.jpg TITLE="テスト商品"` で動作確認
2. `ugc/output/inpaint{N}/` に3本の動画が生成されることを確認
3. 各動画が 20〜25 秒・9:16 縦型であることを確認
4. 字幕・CTA が正しく表示されることを確認
5. Stage 6 終了後 `ugc/output/inpaint{N}/code_review.md` が生成されていることを確認
6. ターミナルにコードレビューサマリーが表示されることを確認
