import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MakeUGCClient } from '../lib/makeugc.js';

describe('MakeUGCClient.generateVideo', () => {
  it('POSTs to /video/generate and returns video_id', async () => {
    const fakeFetch = async (url, opts) => {
      assert.ok(url.endsWith('/video/generate'));
      assert.equal(opts.method, 'POST');
      const body = JSON.parse(opts.body);
      assert.equal(body.avatar_id, 'av1');
      assert.equal(body.voice_id, 'vo1');
      assert.equal(body.voice_script, 'hello');
      return { ok: true, json: async () => ({ video_id: 'vid123' }) };
    };
    const client = new MakeUGCClient({ apiKey: 'key', fetch: fakeFetch });
    const result = await client.generateVideo({ avatar_id: 'av1', voice_id: 'vo1', script: 'hello' });
    assert.equal(result.video_id, 'vid123');
  });

  it('throws on non-ok response', async () => {
    const fakeFetch = async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' });
    const client = new MakeUGCClient({ apiKey: 'key', fetch: fakeFetch });
    await assert.rejects(
      () => client.generateVideo({ avatar_id: 'a', voice_id: 'v', script: 's' }),
      /MakeUGC API error 401/,
    );
  });
});

describe('MakeUGCClient.getVideoStatus', () => {
  it('GETs /video/status and returns status + video_url', async () => {
    const fakeFetch = async (url) => {
      assert.ok(url.includes('video_id=abc'));
      return {
        ok: true,
        json: async () => ({ status: 'completed', video_url: 'https://example.com/vid.mp4' }),
      };
    };
    const client = new MakeUGCClient({ apiKey: 'key', fetch: fakeFetch });
    const result = await client.getVideoStatus('abc');
    assert.equal(result.status, 'completed');
    assert.equal(result.video_url, 'https://example.com/vid.mp4');
  });
});

describe('MakeUGCClient.pollUntilDone', () => {
  it('resolves once status becomes completed', async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      const status = calls < 3 ? 'processing' : 'completed';
      return {
        ok: true,
        json: async () => ({ status, video_url: calls >= 3 ? 'https://x.com/v.mp4' : undefined }),
      };
    };
    const client = new MakeUGCClient({ apiKey: 'key', fetch: fakeFetch });
    const result = await client.pollUntilDone('id1', { intervalMs: 0 });
    assert.equal(result.status, 'completed');
    assert.equal(result.video_url, 'https://x.com/v.mp4');
    assert.equal(calls, 3);
  });

  it('throws if status is failed', async () => {
    const fakeFetch = async () => ({ ok: true, json: async () => ({ status: 'failed' }) });
    const client = new MakeUGCClient({ apiKey: 'key', fetch: fakeFetch });
    await assert.rejects(
      () => client.pollUntilDone('id2', { intervalMs: 0 }),
      /MakeUGC video id2 failed/,
    );
  });

  it('throws after maxAttempts if never completes', async () => {
    const fakeFetch = async () => ({ ok: true, json: async () => ({ status: 'processing' }) });
    const client = new MakeUGCClient({ apiKey: 'key', fetch: fakeFetch });
    await assert.rejects(
      () => client.pollUntilDone('id3', { intervalMs: 0, maxAttempts: 3 }),
      /timed out after 3 attempts/,
    );
  });
});
