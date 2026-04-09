# Phase 1: HeyGen 統合

## プロバイダ抽象化

`config.js` の `AVATAR_PROVIDER` 環境変数で切り替え。`avatar-gen.js` の呼び出し側は変更不要。

```js
// avatar-gen.js
function createAvatarClient() {
  if (config.AVATAR_PROVIDER === 'heygen') {
    return new HeyGenClient({ apiKey: config.HEYGEN_API_KEY });
  }
  return new MakeUGCClient({ apiKey: config.MAKEUGC_API_KEY });
}
```

## HeyGen API 仕様

| 項目 | 値 |
|------|-----|
| Generate Base URL | `https://api.heygen.com/v2` |
| Status Base URL | `https://api.heygen.com/v1` |
| 認証 | `X-Api-Key: {key}` ヘッダー |
| 動画生成 | `POST /v2/video/generate` |
| ステータス確認 | `GET /v1/video_status.get?video_id={id}` |
| アバター一覧 | `GET /v2/avatars` |
| ボイス一覧 | `GET /v2/voices` |

## 動画生成リクエスト形式

```js
POST /v2/video/generate
{
  "video_inputs": [{
    "character": { "type": "avatar", "avatar_id": "...", "scale": 1 },
    "voice": { "type": "text", "input_text": "...", "voice_id": "..." }
  }],
  "dimension": { "width": 1080, "height": 1920 }
}
// レスポンス: { "data": { "video_id": "..." } }
```

## ステータスレスポンス形式

```js
GET /v1/video_status.get?video_id={id}
// レスポンス: { "data": { "status": "completed|failed|processing", "video_url": "..." } }
```

## lib/heygen.js インターフェース（MakeUGCClient と同一形状）

```js
class HeyGenClient {
  async generateVideo({ avatar_id, voice_id, script }) → { video_id }
  async getVideoStatus(videoId)                        → { status, video_url }
  async pollUntilDone(videoId, { intervalMs, maxAttempts }) → { status, video_url }
}
```

## .env 設定

```env
AVATAR_PROVIDER=heygen

HEYGEN_API_KEY=
HEYGEN_AVATARS=avatar_id1,avatar_id2,avatar_id3
HEYGEN_VOICES=voice_id1,voice_id2,voice_id3
```

## 日本語アバター確認手順

Phase 1 着手前に以下で確認:

```bash
curl -H "X-Api-Key: $HEYGEN_API_KEY" \
  "https://api.heygen.com/v2/avatars" | jq '.data.avatars[] | select(.avatar_name | test("japan|jp"; "i"))'
```
