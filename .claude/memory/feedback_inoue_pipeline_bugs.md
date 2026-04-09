---
name: inoue-movie5 パイプライン既知バグと修正パターン
description: pipeline/inpaint.js で踏んだバグ・修正内容の記録（再発防止用）
type: feedback
---

## Commander `--no-assembly` が常に false になる問題

`.option('--no-assembly', '...', false)` のように第3引数に `false` を渡すと、
Commander が `assembly` を常に `false` にセットする（デフォルト反転の仕組みと干渉）。

**Why:** Commander の `--no-X` オプションは第3引数なしで使うと自動で `X=true` がデフォルトになる。  
**Fix:** 第3引数を削除 → `assembly` のデフォルトが `true` になり `--no-assembly` で `false` に切り替わる。

---

## macOS `say` コマンドの `--data-format=LEF32@22050` フラグ

macOS の `say` に `--data-format=LEF32@22050` を渡すとエラーになる。

**Fix:** フラグを削除。`say` はデフォルト設定のまま使う。

---

## nano-banana が正しい商品を生成しない

nano-banana はテキストプロンプトのみで生成するため、指定した商品画像の外観を再現できない。
まったく別の商品が生成される。

**Fix:** nano-banana を廃止し、Sharp で直接商品画像を 1080×1920 に合成する方式に変更。  
**How to apply:** IMAGE_GEN_PROVIDER の設定に関わらず、Seedance 用の入力フレームは常に Sharp で生成する。

---

## Sharp `contain` フィットで灰色のレターボックスが入る

商品画像が正方形・横長の場合、`contain` フィットだと上下に灰色帯が入り不自然。

**Fix:** `fit: 'cover'` に変更 → 商品が画面いっぱいに拡大されて自然な縦型構図になる。

---

## Seedance で商品が2個映る・手が変になる

"entrance" 系のモーションプロンプト（「左から商品が画面外から入る」など）を使うと、
Seedance が既存フレームの商品＋新たに生成した商品の2つを描画する。

**Fix:**
1. SHOT_PATTERNS を全て「すでにフレーム内にある商品が動く」連続モーションに書き換え
2. 全パターンのプロンプトに `product already held in hand in frame` `single hand only, no duplicate products, no extra hands or arms` を追加
3. SAFE_PATTERNS（8種）を追加し、品質チェック失敗時のリトライに使用

---

## Claude Haiku の 429 レートリミット（5回/分）

ゾーン検出・品質チェックを並列実行すると Haiku の 5req/min 制限に即座に当たる。

**Fix:** ゾーン検出は既に順次実行に変更済み。モーションプロンプト生成の Claude 呼び出しを廃止し、SHOT_PATTERNS に直書きしたプロンプトを使う。

---

## eval.js の Claude レスポンスが JSON 途中で切れる

`max_tokens: 1000` では 10項目のスコア + コメントを含む JSON が途中で切れる。

**Fix:** `max_tokens: 2000 → 3000` に増やす。

---

## fal.ai `@fal-ai/client` SDK の DNS エラー（rest.fal.ai）

`fal.storage.upload()` を使うと `getaddrinfo ENOTFOUND rest.fal.ai` が発生することがある。
DNS は解決できているが SDK 内部の fetch が失敗する。

**Fix:** SDK を使わず raw HTTP で直接アップロードする:
```javascript
// 1. initiate
const { upload_url, file_url } = await fetch('https://rest.fal.ai/storage/upload/initiate', {
  method: 'POST',
  headers: { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ file_name: filename, content_type: mimeType }),
}).then(r => r.json());

// 2. PUT to pre-signed URL
await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: buf });

return file_url;
```

---

## nano-banana が PNG を返すのに image/jpeg を Claude に送る

nano-banana のレスポンスが JPEG か PNG かはレスポンスヘッダーではなくバイナリで判断する必要がある。

**Fix:** マジックバイト検出:
```javascript
const isPng = imgBuf[0] === 0x89 && imgBuf[1] === 0x50;
const mimeType = isPng ? 'image/png' : 'image/jpeg';
```

---

## 字幕の位置・サイズ

デフォルトの `y=h*0.85, fontsize=50` はフレーム下部に大きく表示されすぎる。

**Fix:** `y=h*0.62, fontsize=32` → フレーム中央やや下・小さめに変更（参照画像に基づく）。

---

## ffmpeg バイナリが CLI から使えない

このプロジェクトは `@ffmpeg-installer/ffmpeg` npm パッケージでffmpegを管理しており、
`/opt/homebrew/bin/ffmpeg` などシステムパスにffmpegは存在しない。

**Why:** macOS に homebrew が入っていない環境のため。  
**Fix:** バイナリパスを `require('@ffmpeg-installer/ffmpeg').path` で取得する。
```javascript
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
// → node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg
```
bash から直接使う場合は: `/Users/reoreo/claudecode/inoue-movie5/node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg`

---

## Claude Code sandbox では $TMPDIR=/tmp/claude、/tmp直下は書き込み不可

Bash ツールから `/tmp/somefile` に書き込もうとすると権限エラーになる。

**Why:** sandboxの書き込み許可は `$TMPDIR`（= `/tmp/claude`）のみ。`/tmp/` 直下は不可。  
**Fix:** 一時ファイルは必ず `$TMPDIR/...` パスを使う。

---

## ffmpegで日本語ファイル名パスへの出力が失敗する

ffmpegは入力ファイルとして日本語パスを読める（`-i "タンブラー-cut3.mov"`）が、
出力先パスに日本語が含まれると `Could not open file` エラーになる。

**Why:** ffmpegの出力パス内文字コード処理の制限。  
**Fix:** 出力ファイル名は必ず ASCII のみにする（例: `cut3_f0.jpg`、`タンブラー-cut3_f0.jpg` はNG）。
