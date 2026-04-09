# 01_analyze エージェント

## 役割

商品画像を受け取り、jobId を発行してジョブディレクトリを作成する。
商品情報を正規化して `01_analyze-output.json` に保存する。
将来的には Claude Vision で画像から商品特徴を自動抽出する。

## 入力

- 商品画像パス（JPG/PNG/WebP）
- CLI オプション: title, price, category

## 出力: `01_analyze-output.json`

```json
{
  "jobId": "uuid-v4",
  "normalizedProduct": {
    "productId": "SKU-...",
    "primaryImageUri": "/tmp/inoue-job-.../source.jpg",
    "title": "爪切り",
    "price": 980,
    "currency": "JPY",
    "category": "daily"
  }
}
```

## エスカレーション基準

- 画像が読み込めない場合は即座にエラー
- 商品名が空の場合は即座にエラー
