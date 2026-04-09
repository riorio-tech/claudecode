import { config } from '../config.js';

const BASE_URL = 'https://graph.threads.net/v1.0';

async function request(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Threads API error ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

export async function createContainer(text, replyToId = null) {
  const body = {
    media_type: 'TEXT',
    text,
    access_token: config.THREADS_ACCESS_TOKEN,
  };
  if (replyToId) body.reply_to_id = replyToId;
  return request('POST', `/${config.THREADS_USER_ID}/threads`, body);
}

export async function publishContainer(containerId) {
  return request('POST', `/${config.THREADS_USER_ID}/threads_publish`, {
    creation_id: containerId,
    access_token: config.THREADS_ACCESS_TOKEN,
  });
}

export async function publish(text) {
  const container = await createContainer(text);
  await new Promise(r => setTimeout(r, 500));
  const post = await publishContainer(container.id);
  return { containerId: container.id, postId: post.id };
}

// ツリー投稿: parts配列を順番にreply chainで投稿する
export async function publishThread(parts) {
  let prevPostId = null;
  const results = [];
  for (const text of parts) {
    const container = await createContainer(text, prevPostId);
    await new Promise(r => setTimeout(r, 500));
    const post = await publishContainer(container.id);
    prevPostId = post.id;
    results.push({ containerId: container.id, postId: post.id });
    // 投稿間に1秒待機（レートリミット対策）
    if (parts.indexOf(text) < parts.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return results;
}
