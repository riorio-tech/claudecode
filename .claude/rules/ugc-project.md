# ugc プロジェクト — 判断ルール

> 適用範囲: `/Users/reoreo/claudecode/ugc/` 配下の全作業

---

## このシステムの目的（北極星）

「動画を作るツール」ではなく、**SNS代行業者が複数クライアントブランドを自律運用するためのSaaSプラットフォーム**。

- 対象顧客: SNS代行業者（複数ブランドを並行管理）
- 課金単位: ブランド数 + 月間動画生成本数
- 差別化: patterns / failure_patterns の学習データが蓄積されるほど精度が上がる

---1

## ハーネスエンジニアリング原則

コードを書く前に、この3層モデルで設計を考える:

```
Layer C: インターフェース層  → 非エンジニアが使える接触面（Slack Bot 推奨）
Layer B: 多人数アクセス制御 → 実行者識別 / シークレット管理 / 同時実行分離
Layer A: パイプライン堅牢性 → 設定バリデーション / ジョブ状態永続化 / 承認ゲート
```

**Layer A が未実装のまま Layer C を作らない。**

### Layer A の実装ルール

- 起動時に必須 API キーを全チェックする（実行中の失敗より起動時の失敗が安全）
- ジョブ状態は `state.json` に永続化し、`--resume` で再開できる設計にする
- スクリプト生成後、動画生成前に承認ゲートを置く（`AUTO_APPROVE=true` でスキップ可能）
- エラーは Slack Webhook で通知する（夜間バッチの失敗を検知するため）
- 全イベントを `audit.log` に記録する（operator / brand_id / cost を含める）

### Layer B の実装ルール

- `outputDir` は UUID ベース（`output/jobs/{uuid}/`）にする — 同時実行の競合を防ぐ
- API キーは `.env` ファイルに直書きしない。将来的に 1Password Secrets Automation に移行する
- `OPERATOR` 環境変数を audit.log に記録し、誰が実行したかを追跡できるようにする

---

## マルチブランド設計ルール

- ブランド設定（アバター / ボイス / フォーマット / ハッシュタグ）は `brands.json` で管理する
- `cli.js --brand brand_id` でブランドを切り替えられるように設計する
- アバターは商品カテゴリ（beauty / food / gadget / lifestyle）に対応したタイプを用意する
- 動画フォーマットは 6種類対応を目標にする: routine / before-after / unboxing / how-to / reaction / challenge

---

## 事業化視点での判断基準

機能追加を検討するとき、以下の問いで優先度を判断する:

| 問い | 高優先度 | 低優先度 |
|---|---|---|
| 粗利に影響するか | 原価削減 / 単価向上に直結 | 間接的な改善のみ |
| 参入障壁になるか | データ蓄積・学習機能の強化 | 他社でも容易に複製できる機能 |
| 代行業者のスケールを助けるか | 1人で管理できるブランド数が増える | 個別ブランドの作業が少し楽になる |

**追加してはいけないもの**: 1ブランドにしか使えない機能・競合がすでに実装している機能・データ蓄積に繋がらない機能

---

## コスト意識

- 動画1本あたりのコスト目標: **150円以下**（HeyGen 100円 + Claude API 50円）
- 1ジョブあたり Claude API コストが 200円を超えそうな場合はプロンプト最適化を先に行う
- HeyGen 課金は動画生成前に残高チェックを必須にする

---

## 参照ドキュメント

| ドキュメント | 内容 |
|---|---|
| `ugc/sns-vision.md` | 北極星・ユーザーニーズ・3層成果定義・Claude Code×UGCベストプラクティス |
| `ugc/docs/superpowers/specs/tech/harness-engineering.md` | Layer A の実装詳細（コードあり） |
| `ugc/docs/superpowers/specs/tech/multi-user-harness.md` | Layer A/B/C の全体設計・Slack Bot 仕様 |
| `ugc/docs/superpowers/specs/2026-04-07-business-scale-design.md` | 事業化設計・ビジネスモデル・GTM戦略 |
