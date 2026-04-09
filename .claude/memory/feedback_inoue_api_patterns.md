---
name: inoue-movie5 API呼び出しパターン（正しい実装）
description: fal.ai / Seedance / ElevenLabs / Anthropic の正しい呼び出し方。誤りパターンも記録
type: feedback
---

## fal.ai アップロード（raw HTTP）

SDK の `fal.storage.upload()` は DNS 問題が起きる。必ず raw HTTP を使う。

```javascript
async function uploadFile(filePath, mimeType) {
  const buf = readFileSync(filePath);
  const ext  = filePath.split('.').pop();
  const filename = `file.${ext}`;

  const { upload_url, file_url } = await fetch('https://rest.fal.ai/storage/upload/initiate', {
    method: 'POST',
    headers: { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_name: filename, content_type: mimeType }),
  }).then(r => r.json());

  await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: buf });
  return file_url;
}
```

---

## Seedance fal.ai queue パターン（submit → poll → result）

```javascript
// 1. Submit
const res = await fetch(`https://queue.fal.run/${SEEDANCE_MODEL}`, {
  method: 'POST',
  headers: { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ image_url, prompt, duration: 5, resolution: '720p', seed }),
});
const { request_id, status_url, response_url } = await res.json();

// 2. Poll（status_url / response_url は fal.ai が返す値をそのまま使う・手動構築しない）
while (true) {
  const st = await fetch(status_url, { headers: { 'Authorization': `Key ${FAL_KEY}` } }).then(r => r.json());
  if (st.status === 'COMPLETED') break;
  if (st.status === 'FAILED') throw new Error('Seedance failed');
  await new Promise(r => setTimeout(r, 3000));
}

// 3. Result
const result = await fetch(response_url, { headers: { 'Authorization': `Key ${FAL_KEY}` } }).then(r => r.json());
const videoUrl = result.video?.url;
```

**Why:** `@fal-ai/client` の `fal.subscribe()` にバグがあり、status/response URL を手動構築すると404になる。  
fal.ai が返す URL をそのまま使えば問題ない（v9方針）。

---

## ElevenLabs TTS（v3）

```javascript
const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
  method: 'POST',
  headers: {
    'xi-api-key': ELEVENLABS_API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text,
    model_id: 'eleven_v3',
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  }),
});
const audioBuf = Buffer.from(await res.arrayBuffer());
```

フォールバック: `eleven_v3` が失敗したら `eleven_multilingual_v2` を試す。

---

## Seedance モデル

```
fal-ai/bytedance/seedance/v1.5/pro/image-to-video
```
.env の `SEEDANCE_ENDPOINT` に設定。duration=5s, resolution=720p 固定。

---

## Claude Haiku 並列呼び出し禁止

Claude Haiku (claude-haiku-4-5-20251001) はフリープランで 5req/min の制限あり。  
ゾーン検出・品質チェック系の呼び出しは必ず**順次**実行すること。  
並列実行すると即座に 429 エラーになる。
