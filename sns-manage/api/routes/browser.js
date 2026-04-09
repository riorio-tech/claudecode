export default async function browserRoutes(app) {
  // POST /api/browser/login — インタラクティブログイン（ヘッドレスでなく表示）
  // { platform: 'twitter'|'instagram'|'tiktok' }
  app.post('/browser/login', async (request, reply) => {
    const { platform } = request.body || {};
    if (!platform) return reply.code(400).send({ error: 'platform is required' });
    // headlessサーバー環境ではインタラクティブログイン不可
    if (!process.env.DISPLAY && process.platform !== 'darwin' && process.platform !== 'win32') {
      return reply.code(400).send({
        error: 'このエンドポイントはディスプレイのある環境（Mac/Windows/X11）でのみ使用できます。headlessサーバーでは /browser/login は機能しません。ローカル環境から実行してください。',
      });
    }
    try {
      const { loginInteractive } = await import('../../agents/10_browser/agent.js');
      // バックグラウンドで実行（ブロックしない）
      loginInteractive(platform).catch(err =>
        console.error(`[browser/login] ${err.message}`)
      );
      return { ok: true, message: `${platform} のブラウザを開きました。ログインしてください。` };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/browser/post — ブラウザ経由で投稿
  // { platform: 'twitter'|'instagram'|'tiktok', text: '...', headless: true }
  app.post('/browser/post', async (request, reply) => {
    const { platform, text, caption, headless = true } = request.body || {};
    if (!platform) return reply.code(400).send({ error: 'platform is required' });

    try {
      const mod = await import('../../agents/10_browser/agent.js');
      let result;
      if (platform === 'twitter')        result = await mod.postTwitterBrowser({ text: text || caption, headless });
      else if (platform === 'instagram') result = await mod.postInstagramBrowser({ caption: caption || text, headless });
      else if (platform === 'tiktok')    result = await mod.postTikTokBrowser({ caption: caption || text, headless });
      else return reply.code(400).send({ error: `未対応プラットフォーム: ${platform}` });
      return result;
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/browser/screenshot — 任意URLのスクリーンショット
  app.post('/browser/screenshot', async (request, reply) => {
    const { url, filename } = request.body || {};
    if (!url) return reply.code(400).send({ error: 'url is required' });
    try {
      const { captureScreenshot } = await import('../../agents/10_browser/agent.js');
      return await captureScreenshot({ url, filename });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}
