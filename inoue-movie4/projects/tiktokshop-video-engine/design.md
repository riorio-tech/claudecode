# TikTok Shop 商品動画 自動生成パイプライン — 上段設計書

> ゴール: GMV 月間 1,000万円達成のために「動画を見たら商品を購入する」仕組みを自動化する

---

## 1. 完成動画のイメージ

| 項目 | 仕様 |
|------|------|
| 尺 | **20秒** |
| カット数 | **20カット**（1秒1カット、ジェットカット） |
| アスペクト比 | 9:16（TikTok縦型） |
| 解像度 | 1080 × 1920px |
| 音声 | AI音声ナレーション + BGM |
| 字幕 | 各カットにオーバーレイテキスト |
| 編集スタイル | ジェットカット（無音・間を削除）で高テンポ |

---

## 2. パイプライン全体フロー

```
商品画像（1枚）を CLI に投入
            │
            ▼
┌─────────────────────────────────┐
│  STEP 1: 動画設計プランニング    │  shot-planner_ag
│  ├── 全体設計（20カット構成）    │
│  ├── 台本作成（各カットの訴求）  │
│  ├── 音声スクリプト生成          │
│  └── モーションパターン定義      │
└─────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────┐
│  STEP 2: 画像生成（20枚）        │  image-variant_ag
│  ├── 異なる画角（引き・寄り・斜め等）
│  ├── 異なるモーション（ズームイン・アウト・パン）
│  └── ショットの role に合わせた構図
└─────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────┐
│  STEP 3: 動画生成（クリップ×20） │  video-cut_ag
│  各画像を 1秒クリップに変換      │
│  + モーションエフェクト付与       │
└─────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────┐
│  STEP 4: 動画編集・仕上げ        │  assembly_ag
│  ├── 20クリップ連結（ジェットカット）
│  ├── AI音声ナレーション追加      │
│  ├── BGM ミックス（音量調整）    │
│  └── 字幕・オーバーレイテキスト │
└─────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────┐
│  STEP 5: QA・コンプライアンス    │  qa-compliance_ag
│  ├── 禁止表現チェック            │
│  ├── 動画尺確認（19.5〜20.5秒）  │
│  └── 価格表示の正確性確認        │
└─────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────┐
│  STEP 6: 投稿準備                │  publish-prep_ag
│  ├── キャプション生成            │
│  ├── ハッシュタグ（5〜8個）      │
│  └── サムネイル推奨フレーム      │
└─────────────────────────────────┘
            │
            ▼
        TikTok Shop 投稿
            │
            ▼
┌─────────────────────────────────┐
│  STEP 7: CVR 計測・改善          │  measurement_ag
│  └── 計測結果 → 台本・構成に反映 │
└─────────────────────────────────┘
```

---

## 3. STEP 1: 動画設計プランニング

### 3-1. 全体設計（20カット構成）

```
カット 00〜02 (3秒)  ── HOOK        視聴者の悩み・驚きで止める
カット 03〜07 (5秒)  ── BENEFIT     商品が解決することを見せる
カット 08〜12 (5秒)  ── PROOF       実証・数字・レビューで信頼獲得
カット 13    (1秒)  ── TRANSITION  視線誘導・区切り
カット 14    (1秒)  ── BENEFIT再訴求
カット 15    (1秒)  ── PROOF再証拠
カット 16〜19 (4秒)  ── CTA         価格・限定性・購入ボタン
```

### 3-2. 台本テンプレ（爪切り商品の例）

| カット | role | 音声ナレーション | 画面テキスト |
|-------|------|----------------|------------|
| 00 | hook | 「爪、うまく切れてますか？」 | 「これ知らないと損」 |
| 01 | hook | 「ギザギザ、痛い、時間かかる」 | 「❌ 普通の爪切り」 |
| 02 | hook | 「それ全部、解決します」 | 「✅ これで秒解決」 |
| 03 | benefit | 「刃がカーブしていて」 | 「滑らかカット設計」 |
| 04 | benefit | 「力を入れなくても切れる」 | 「軽い力でサクッ」 |
| 05〜07 | benefit | （商品特徴を続ける） | （各特徴テキスト） |
| 08〜12 | proof | 「レビュー★4.8、3,200件」 | 「実際に使った声→」 |
| 13 | transition | （無音 or SE） | 「→」 |
| 14 | benefit | 「毎日使うものだから」 | 「長く使える品質」 |
| 15 | proof | 「ステンレス製、錆びない」 | 「素材にもこだわり」 |
| 16 | cta | 「今なら〇〇円」 | 「💥 期間限定価格」 |
| 17 | cta | 「送料無料で届きます」 | 「🚀 送料無料」 |
| 18 | cta | 「在庫残り少なめ」 | 「⚡ 残りわずか」 |
| 19 | cta | 「プロフィールから購入できます」 | 「👆 今すぐチェック」 |

### 3-3. モーションパターン定義

| role | 推奨モーション | 効果 |
|------|--------------|------|
| hook | **ズームイン** | 視聴者を引き込む |
| benefit | **スライド（左→右）** | 特徴を次々と見せる |
| proof | **静止 or ゆっくりズームアウト** | 安心感・信頼感 |
| transition | **フラッシュ or カット** | テンポを上げる |
| cta | **ズームイン + テキストフラッシュ** | 購買衝動を高める |

---

## 4. STEP 2: 画像生成（20枚バリエーション）

### 4-1. 画角パターン

| パターン | 説明 | 使用するカット |
|---------|------|--------------|
| **全体引き** | 商品全体を写す | hook, cta |
| **寄り（クローズアップ）** | 商品の特徴部分にズーム | benefit, proof |
| **斜め45度** | 立体感・存在感を出す | hook, benefit |
| **正面フラット** | 価格・テキスト重ねやすい | cta |
| **使用シーン** | 手に持っている / 使っているところ | proof |

### 4-2. 20枚の割り当て例

```
variant-00〜02  : 全体引き（HOOK用）
variant-03〜07  : 寄り・各特徴部（BENEFIT用）
variant-08〜12  : 使用シーン・結果（PROOF用）
variant-13      : 全体引き（TRANSITION用）
variant-14      : 特徴部（BENEFIT再）
variant-15      : 使用シーン（PROOF再）
variant-16〜19  : 正面フラット（CTA用、テキスト重ね）
```

---

## 5. STEP 3 & 4: 動画生成・編集仕様

### 5-1. クリップ仕様

| 項目 | 設定値 |
|------|--------|
| 1クリップ尺 | **1秒（30フレーム）** |
| 解像度 | 1080 × 1920（9:16） |
| コーデック | H.264 / yuv420p |
| モーション | ffmpeg の `zoompan` フィルタで実現 |

### 5-2. モーション実装（ffmpeg）

```bash
# ズームインの例
ffmpeg -loop 1 -i input.jpg -t 1 -r 30 \
  -vf "zoompan=z='min(zoom+0.002,1.5)':d=30:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)',scale=1080:1920" \
  -c:v libx264 -pix_fmt yuv420p clip-00.mp4

# スライドの例（左→右）
ffmpeg -loop 1 -i input.jpg -t 1 -r 30 \
  -vf "crop=iw/2:ih:x='iw/2*t':0,scale=1080:1920" \
  -c:v libx264 -pix_fmt yuv420p clip-03.mp4
```

### 5-3. ジェットカット編集

```bash
# 20クリップを concat で無音連結（ジェットカット）
ffmpeg -f concat -safe 0 -i list.txt -c copy final-noaudio.mp4
```

### 5-4. 音声追加

```bash
# AI音声 + BGM をミックスして最終動画へ
ffmpeg -i final-noaudio.mp4 \
       -i narration.mp3 \
       -i bgm.mp3 \
       -filter_complex "[1]volume=1.0[v1];[2]volume=0.2[v2];[v1][v2]amix=inputs=2[aout]" \
       -map 0:v -map "[aout]" \
       -shortest final-20s.mp4
```

---

## 6. AIエージェント一覧と責務

| エージェントフォルダ | 役割 | 実装方式 | 状態 |
|---------------------|------|----------|------|
| `agent/ingest_ag/` | 画像受理・jobId発行 | Node.js 直接 | ✅ 実装済み |
| `agent/shot-planner_ag/` | 台本・20カット構成・音声スクリプト | Claude API | ✅ 実装済み |
| `agent/image-variant_ag/` | 20枚の画角・モーション定義 | Sharp 直接 | ✅ 実装済み |
| `agent/video-cut_ag/` | 1秒クリップ×20生成（モーション付き） | ffmpeg 直接 | ✅ 実装済み |
| `agent/assembly_ag/` | ジェットカット連結・音声・字幕 | ffmpeg 直接 | ✅ 実装済み |
| `agent/qa-compliance_ag/` | 尺・禁止表現・価格チェック | Node.js + ffprobe | ✅ 実装済み |
| `agent/publish-prep_ag/` | キャプション・ハッシュタグ生成 | Claude API | ✅ 実装済み |
| `agent/measurement_ag/` | CVR計測→台本へフィードバック | Claude API + CSV | ✅ 実装済み |

---

## 7. 施策候補 10案（CVR優先度順）

| 優先度 | 施策名 | CVR強み | 難易度 |
|--------|--------|---------|--------|
| 1 | **20カット固定ファネル型（本設計）** | 購買ファネルに直結 | ★☆☆ |
| 2 | **レビュー要約挿入型** | 社会的証明が最も効く | ★★☆ |
| 3 | **UGC風テンプレ量産** | TikTokユーザーの信頼感高 | ★★☆ |
| 4 | **価格訴求ダイナミック最適化** | 割引訴求は最強トリガー | ★★★ |
| 5 | **ペルソナ別動画自動分岐** | ターゲット精度高 | ★★☆ |
| 6 | **在庫連動型クリエイティブ** | 希少性・緊急性で即購買 | ★★★ |
| 7 | **問題提起→解決デモ（Before/After）** | 高単価・美容に強い | ★★☆ |
| 8 | **商品ページ一致最適化（LP整合）** | 動画→LPの離脱を防ぐ | ★★☆ |
| 9 | **季節・イベント自動切替型** | 季節需要の最適化 | ★★☆ |
| 10 | **競合比較型（法令準拠版）** | 比較優位で購買動機強化 | ★★★ |

---

## 8. KPI・実験フレーム

| 指標 | 採択基準 |
|------|----------|
| **PurchaseCVR**（購入/imp） | ベースライン比 **+15%**（7日移動平均） |
| **3秒維持率** | フック品質の目安 |
| **完視聴率** | 台本・編集品質の目安 |
| CPA / ROAS | スケール判断 |

- 最小サンプル: 1案あたり **3,000 imp**
- 並走数: 1商品あたり同時 **最大3パターン**

---

## 9. フェーズ計画

| フェーズ | 内容 | 完了条件 | 状態 |
|---------|------|----------|------|
| **Phase 1** | 全エージェントの CLAUDE.md 整備 | `claude` で各エージェントが自律動作する | ✅ 完了 |
| **Phase 2** | CLI → 20秒動画 E2E 実装 | `node cli.js <image>` で動画が出る | ✅ 完了 |
| **Phase 3** | 画像生成 API 統合・音質向上 | IMAGE_GEN_API_KEY で高品質画角生成 | 🔲 次フェーズ |
| **Phase 4** | CVR 計測ループ稼働 | `node cli.js measure` でABテストが回る | 🔲 次フェーズ |
| **Phase 5** | 候補10施策を順次実装・検証 | 勝ちパターンの標準化 | 🔲 将来 |

---

## 10. 次のアクション

1. 商品画像を用意して `node cli.js <image> --title "商品名"` で E2E テスト実行
2. `node cli.js measure --job-id <jobId> --data analytics.csv` で CVR 計測ループを開始
3. Phase 3: `IMAGE_GEN_API_KEY` を設定して高品質画角生成を有効化

---

## 11. 実装アーキテクチャ（Phase 2 採用: モジュラー Node.js）

### ファイル構成

```
inoue-movie4/
├── package.json          # Node 20+, ESM, commander/sharp/zod/@anthropic-ai/sdk
├── cli.js                # エントリー: node cli.js <image> [options]
├── orchestrator.js       # パイプライン連鎖・エラーエスカレーション
├── lib/
│   ├── run-agent.js      # claude --print サブプロセスラッパー（将来用）
│   ├── job-dir.js        # /tmp/inoue-job-{jobId}/ 作成
│   ├── validate-json.js  # Zod スキーマ検証
│   └── logger.js         # 進捗ログ
├── agents/
│   ├── ingest.js         # 決定的処理（UUID + ファイルコピー）
│   ├── shot-planner.js   # Claude API (@anthropic-ai/sdk)
│   ├── image-variant.js  # Sharp 直接処理
│   ├── video-cut.js      # ffmpeg 直接実行
│   ├── assembly.js       # ffmpeg + macOS say TTS
│   ├── qa-compliance.js  # regex + ffprobe
│   ├── publish-prep.js   # Claude API
│   └── measurement.js    # Claude API + CSV 解析
└── prompts/
    ├── shot-planner.md   # shot-planner_ag/CLAUDE.md から蒸留
    └── publish-prep.md   # publish-prep_ag/CLAUDE.md から蒸留
```

### エージェント実装方式の選択基準

| 工程 | 方式 | 理由 |
|------|------|------|
| 創造的テキスト生成 | Claude API | shot-planner, publish-prep |
| 決定的メディア変換 | Sharp / ffmpeg 直接 | image-variant, video-cut, assembly |
| ルールベース検査 | Node.js + regex + ffprobe | qa-compliance |
| 分析・判断 | Claude API | measurement |

---

## 12. CLI リファレンス

```bash
# 動画生成
node cli.js generate <image-path> \
  --title "商品名"         # 必須
  --price 1980             # 任意: 価格（数値）
  --category daily         # daily|beauty|electronics|food|fashion
  --output ./video.mp4     # デフォルト: ./output-{jobId}.mp4
  --dry-run                # shot-plan のみ出力（動画生成スキップ）
  --skip-qa                # QA をスキップ（開発用）
  --verbose                # 詳細ログを表示

# CVR 計測
node cli.js measure \
  --job-id <UUID>          # 必須: 生成時の Job ID
  --data analytics.csv     # 必須: TikTok 分析 CSV/JSON

# 終了コード
# 0: 正常終了
# 1: エラー終了（画像不正・QA 違反・ffmpeg 失敗等）
```

---

## 13. エージェント契約テーブル

| エージェント | 入力ファイル | 出力ファイル | エスカレーション条件 |
|-------------|-------------|-------------|-------------------|
| ingest | （CLI 引数） | `ingest-output.json` | 画像 <500px → 即終了 |
| shot-planner | `ingest-output.json` | `shot-plan.json` | shots≠20 → 1回リトライ後終了 |
| image-variant | `shot-plan.json`, 元画像 | `image-variants.json` + 20枚 jpg | Sharp エラー → 終了 |
| video-cut | `image-variants.json`, `shot-plan.json` | `video-clips.json` + 20本 mp4 | ffmpeg エラー → 終了 |
| assembly | `video-clips.json`, `shot-plan.json` | `assembly-output.json` + `final-20s.mp4` | 尺 <19.5 or >20.5s → 終了 |
| qa-compliance | `assembly-output.json`, `shot-plan.json` | `qa-output.json` | error 級違反 → 終了 |
| publish-prep | `qa-output.json`, `ingest-output.json` | `publish-prep-output.json` | QA 未通過 → 警告のみ |
| measurement | analytics CSV/JSON | `data/experiments/{jobId}-measurement.json` | 別サブコマンドで呼び出し |

---

## 14. ファイルシステム契約（/tmp/inoue-job-{jobId}/）

| ファイル | 生成元 | 内容 |
|---------|--------|------|
| `source.{jpg|png|webp}` | ingest | 元画像（コピー） |
| `ingest-output.json` | ingest | 商品情報 + jobId |
| `shot-plan.json` | shot-planner | 20カット構成 + 音声スクリプト |
| `variant-00〜19.jpg` | image-variant | 1080×1920 画像バリアント |
| `image-variants.json` | image-variant | バリアントの一覧 |
| `clip-00〜19.mp4` | video-cut | 1秒クリップ（H.264） |
| `video-clips.json` | video-cut | クリップの一覧 |
| `list.txt` | assembly | ffmpeg concat 用リスト |
| `concat-noaudio.mp4` | assembly | 20クリップ連結（無音） |
| `narration.aiff` | assembly | macOS say 出力（中間） |
| `narration.mp3` | assembly | AI 音声ナレーション |
| `final-20s.mp4` | assembly | 完成動画（音声・字幕付き） |
| `assembly-output.json` | assembly | 最終動画パス・尺・音声フラグ |
| `qa-output.json` | qa-compliance | スコア・違反リスト |
| `publish-prep-output.json` | publish-prep | キャプション・ハッシュタグ |
