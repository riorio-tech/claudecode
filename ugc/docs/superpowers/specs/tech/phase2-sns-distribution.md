# Phase 2: SNS 配信

## Makefile コマンド

```makefile
# 動画生成のみ
make UGC IMG=product.jpg TITLE="商品名"

# 動画生成 + 即時投稿
make UGC_POST IMG=product.jpg TITLE="商品名"

# 既存動画を投稿
make POST DIR=output/inpaint3
```

## distribute.js の責務

3本の動画を TikTok / Instagram / YouTube に投稿し、結果を `post_result.json` に保存。

**実装順:** Instagram → YouTube → TikTok（TikTok は法人アカウント審査が必要なため後回し）

## 各プラットフォーム投稿フロー

### TikTok（Content Posting API v2）

```
POST /v2/post/publish/video/init  → upload_url + publish_id
PUT {upload_url} + video binary
GET /v2/post/publish/status       → 公開確認
```

認証: `TIKTOK_ACCESS_TOKEN`（法人アカウント審査が必要）

### Instagram（Graph API）

```
POST /{account_id}/media          → container_id（動画URLを渡す）
POST /{account_id}/media_publish  → media_id
```

**注意:** 動画は公開URLが必要 → Cloudflare R2（無料枠）に一時アップロードして URL を生成。

### YouTube（Data API v3）

```
POST /upload/youtube/v3/videos    → multipart upload
OAuth2 refresh_token で認証
```

初回のみ `make AUTH_YOUTUBE` で手動ブラウザ認証 → `refresh_token` を `.env` に保存。

## スケジュール投稿

```env
TIKTOK_POST_HOUR=19      # 19:00 JST
INSTAGRAM_POST_HOUR=12   # 12:00 JST
YOUTUBE_POST_HOUR=8      # 08:00 JST
```

OS cron で `make POST DIR=...` を呼び出す形式（Node.js setTimeout は使わない）。

## post_result.json 形式

```json
{
  "jobId": "uuid",
  "postedAt": "2026-04-06T10:00:00Z",
  "videos": [
    {
      "index": 0,
      "hookType": "問題提起型",
      "platforms": {
        "tiktok":    { "video_id": "...", "url": "..." },
        "instagram": { "media_id": "...", "url": "..." },
        "youtube":   { "video_id": "...", "url": "..." }
      }
    }
  ]
}
```

## .env 追加

```env
TIKTOK_ACCESS_TOKEN=
TIKTOK_OPEN_ID=
INSTAGRAM_ACCESS_TOKEN=
INSTAGRAM_BUSINESS_ACCOUNT_ID=
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=
CLOUDFLARE_R2_BUCKET=
CLOUDFLARE_R2_ACCESS_KEY=
CLOUDFLARE_R2_SECRET_KEY=
TIKTOK_POST_HOUR=19
INSTAGRAM_POST_HOUR=12
YOUTUBE_POST_HOUR=8
```
