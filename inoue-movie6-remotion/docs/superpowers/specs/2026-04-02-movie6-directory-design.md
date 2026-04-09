# inoue-movie6 ディレクトリ設計仕様

**日付**: 2026-04-02  
**目的**: 商品画像をアップロードすると商品紹介動画が生成されるパイプラインの構築  
**参照元**: inoue-movie5 のアーキテクチャを整理・統合

---

## ゴール

CLI に商品画像を渡すと、TikTok Shop 向け縦型動画（20〜25秒）が自動生成される。  
CVR 最大化を第一目的とし、複数テンプレートの A/B テストに対応する。

---

## 技術スタック

| 役割 | 採用技術 | 理由 |
|------|---------|------|
| 動画レンダリング | 未定（Remotion / ffmpeg+canvas / その他）| 技術選定は render エージェント実装時に決定 |
| 言語 | TypeScript (`strict: true`) | エージェント間の JSON 受け渡しを型安全にする。movie5 の型なし JS バグを根絶 |
| AI（構成・テキスト・QA） | Claude API（Anthropic SDK） | 既存資産の継続利用 |
| 画像処理 | sharp | 高速・軽量、既存利用実績あり |
| DB | better-sqlite3 | ジョブ・CVR データの永続化（未インストール時もパイプラインは動作） |
| パッケージ管理 | pnpm | 高速・省ディスク |
| ランタイム | Node.js 20+ | |

---

## ディレクトリ構造

```
inoue-movie6/
├── src/
│   ├── agents/
│   │   ├── ingest/         # 画像受理 + Claude Vision で ProductInfo 抽出
│   │   │   ├── agent.ts
│   │   │   ├── schema.ts   # ProductInfo 型定義
│   │   │   └── CLAUDE.md
│   │   ├── plan/           # ShotPlan 生成（Claude、20カット）
│   │   │   ├── agent.ts
│   │   │   ├── schema.ts   # ShotPlan 型定義
│   │   │   └── CLAUDE.md
│   │   ├── render/         # 動画レンダリング（技術は実装時に選定）
│   │   │   ├── agent.ts
│   │   │   ├── schema.ts   # RenderInput / RenderOutput 型定義
│   │   │   └── CLAUDE.md
│   │   └── qa/             # 品質チェック + コンプライアンス + キャプション生成
│   │       ├── agent.ts
│   │       ├── schema.ts
│   │       └── CLAUDE.md
│   ├── video/
│   │   ├── templates/
│   │   │   ├── Standard/   # 汎用テンプレート（デフォルト）
│   │   │   │   └── index.ts
│   │   │   └── Minimal/    # シンプル版（A/B 比較用）
│   │   │       └── index.ts
│   │   └── components/     # 共通 UI パーツ（テキスト・価格・CTA）
│   ├── lib/
│   │   ├── claude.ts       # Claude API ラッパー（共通設定）
│   │   ├── job.ts          # jobId 発行・/tmp/inoue-job-{jobId}/ 管理
│   │   └── logger.ts       # 構造化ログ
│   └── db/
│       └── db.ts           # better-sqlite3（graceful degradation 対応）
├── cli.ts                  # エントリーポイント（commander）
├── config.ts               # プロバイダ・定数（ハードコード禁止）
├── package.json
├── tsconfig.json
└── .env.example
```

---

## パイプライン（データフロー）

```
cli.ts generate <image> [--template Standard|Minimal]
  │
  ├─ ingest  : 商品画像 → ProductInfo（JSON）
  │             title, price, features[], category
  │
  ├─ plan    : ProductInfo → ShotPlan（JSON）
  │             cuts[20]{ duration, visual, text, animation }
  │
  ├─ render  : ShotPlan + template → video.mp4
  │             動画レンダリング（1080×1920）
  │
  └─ qa      : video.mp4 → QAResult + caption.txt
                duration チェック、禁止表現スキャン、キャプション生成
```

すべての中間ファイルは `/tmp/inoue-job-{jobId}/` に保存する。

---

## movie5 からの主な変更点

| 項目 | movie5 | movie6 |
|------|--------|--------|
| 言語 | JavaScript | TypeScript |
| 動画生成 | ffmpeg（静止画連結） | 未定（実装時に選定） |
| エージェント数 | 9工程 | 4工程に統合 |
| Python 依存 | あり（pipeline/） | なし |
| テンプレート | なし | 複数（切り替え可能） |

---

## エスカレーション基準（変更なし）

- QA で `error` 級の違反が出た場合
- 動画の尺が 15 秒未満または 30 秒超過の場合
- 動画内の価格表示と商品価格が一致しない場合
- API 課金が 1 ジョブあたり 1,000 円を超えそうな場合

---

## CVR 採択基準

| 指標 | 採択ライン |
|------|-----------|
| PurchaseCVR | ベースライン比 +15% 以上（7日MA・3,000imp 以上） |
| 3秒維持率 | 参考値 50% 以上 |
| 完視聴率 | 参考値 30% 以上 |

CVR 計測は `cli.ts measure` サブコマンドとして独立（パイプライン外）。
