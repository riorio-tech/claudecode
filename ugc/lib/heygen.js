// ugc/lib/heygen.js
const BASE_URL = 'https://api.heygen.com/v2';

export class HeyGenClient {
  /**
   * @param {{ apiKey: string, fetch?: Function }} opts
   */
  constructor({ apiKey, fetch: _fetch }) {
    this._apiKey = apiKey;
    this._fetch = _fetch ?? globalThis.fetch;
  }

  _headers() {
    return { 'X-Api-Key': this._apiKey, 'Content-Type': 'application/json' };
  }

  /**
   * @param {{ avatar_id: string, voice_id: string, script: string }} opts
   * @returns {Promise<{ video_id: string }>}
   */
  async generateVideo({ avatar_id, voice_id, script }) {
    const res = await this._fetch(`${BASE_URL}/video/generate`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({
        video_inputs: [{
          character: { type: 'avatar', avatar_id, scale: 1 },
          voice: { type: 'text', input_text: script, voice_id },
        }],
        dimension: { width: 1080, height: 1920 },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HeyGen API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    const video_id = data.data?.video_id;
    if (!video_id) throw new Error(`HeyGen: no video_id in response: ${JSON.stringify(data)}`);
    return { video_id };
  }

  /**
   * @param {string} videoId
   * @returns {Promise<{ status: string, video_url?: string }>}
   */
  async getVideoStatus(videoId) {
    const res = await this._fetch(
      `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
      { headers: this._headers() },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HeyGen status error ${res.status}: ${text}`);
    }
    const data = await res.json();
    return {
      status: data.data?.status,
      video_url: data.data?.video_url,
    };
  }

  /**
   * @param {string} videoId
   * @param {{ intervalMs?: number, maxAttempts?: number }} opts
   * @returns {Promise<{ status: string, video_url: string }>}
   */
  async pollUntilDone(videoId, { intervalMs = 10_000, maxAttempts = 60 } = {}) {
    for (let i = 0; i < maxAttempts; i++) {
      const result = await this.getVideoStatus(videoId);
      if (result.status === 'completed') return result;
      if (result.status === 'failed') throw new Error(`HeyGen video ${videoId} failed`);
      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(`HeyGen video ${videoId} timed out after ${maxAttempts} attempts`);
  }
}
