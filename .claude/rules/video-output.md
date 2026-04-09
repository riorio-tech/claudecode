# inoue-movie5 アウトプット管理ルール

> 適用範囲: 生成された動画・ログ・評価レポートの保存・命名規則

## フォルダ構成

```
inoue-movie5/
├── output/
│   ├── inpaint1/          ← 最初の生成
│   │   ├── final.mp4                  # concat 後の生動画
│   │   ├── final_assembled.mp4        # 字幕・音声・グレード済み（最終成果物）
│   │   ├── narration.mp3              # ElevenLabs 生成ナレーション音声
│   │   ├── タンブラー-cut1_inpainted.mp4  # クリップ別
│   │   └── eval_log.md                # 評価ログ（自動追記）
│   ├── inpaint2/
│   └── inpaintN/          ← 連番で増やす
├── templates/
│   └── 00_Tumbler/        ← テンプレートクリップ（変更しない）
└── pipeline/
```

## 命名ルール

- 出力フォルダ: `output/inpaint{N}/`（N は既存フォルダの最大番号 + 1）
- 最終成果物: `final_.mp4`（必ずこの名前）
- クリップ別: `{clip.name}_inpainted.mp4`
- ナレーション音声: `narration.mp3`

## 生成ごとの出力確認

動画生成を実行する前に `ls output/` で現在の最大番号を確認し、
`--output-dir output/inpaint{N+1}` を指定する。

## eval_log.md

- 各出力フォルダに `eval_log.md` が生成される
- 生成のたびに追記（上書きしない）
- 過去の評価との比較、スコアの推移確認に使う

## テンプレートの扱い

- `templates/` フォルダ内のファイルは**変更・上書き禁止**
- テンプレートを追加するときは新しいフォルダを作る（例: `templates/01_Bottle/`）

## ジョブ一時ファイル

- `/tmp/inpaint-{jobId}/` に保存（Mac: `$TMPDIR/inpaint-{jobId}/`）
- `state.json` にジョブ状態・コスト・メタ情報を記録
- `--resume {jobId}` で中断再開が可能
