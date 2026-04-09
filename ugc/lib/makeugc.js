const BASE_URL = 'https://app.makeugc.ai/api/platform';

export class MakeUGCClient {
  /**
   * @param {{ apiKey: string, fetch?: Function }} opts
   * fetch is injectable for tests; defaults to globalThis.fetch
   */
  constructor({ apiKey, fetch: _fetch }) {
    this._apiKey = apiKey;
    this._fetch = _fetch ?? globalThis.fetch;
  }

  _headers() {
    return { 'X-Api-Key': this._apiKey, 'Content-Type': 'application/json' };
  }

  /**
   * @param {{ avatar_id: string, voice_id: string, script: string }} body
   * @returns {Promise<{ video_id: string }>}
   */
  async generateVideo({ avatar_id, voice_id, script }) {
    const res = await this._fetch(`${BASE_URL}/video/generate`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ avatar_id, voice_id, voice_script: script }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MakeUGC API error ${res.status}: ${text}`);
    }
    return res.json();
  }

  /**
   * @param {string} videoId
   * @returns {Promise<{ status: string, video_url?: string }>}
   */
  async getVideoStatus(videoId) {
    const res = await this._fetch(`${BASE_URL}/video/status?video_id=${encodeURIComponent(videoId)}`, {
      headers: this._headers(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MakeUGC status error ${res.status}: ${text}`);
    }
    return res.json();
  }

  /**
   * Polls getVideoStatus until status is 'completed' or 'failed'.
   * @param {string} videoId
   * @param {{ intervalMs?: number, maxAttempts?: number }} [opts]
   * @returns {Promise<{ status: string, video_url: string }>}
   */
  async pollUntilDone(videoId, { intervalMs = 10_000, maxAttempts = 60 } = {}) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.getVideoStatus(videoId);
      if (result.status === 'completed') return result;
      if (result.status === 'failed') throw new Error(`MakeUGC video ${videoId} failed`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`MakeUGC video ${videoId} timed out after ${maxAttempts} attempts`);
  }
}
