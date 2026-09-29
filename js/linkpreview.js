// リンクプレビュー（OGP / X の投稿）
// ブラウザから直接は取得できない（CORS）ため、Supabase Edge Function 経由で取得する。
// 取得結果は投稿に保存するので、一度取得したものはオフラインでも表示できる。
import * as db from './db.js';
import { extractUrls } from './util.js';
import { updatePost } from './posts.js';
import * as sync from './sync.js';

const RETRY_MS = 24 * 3600 * 1000;
let running = false;

export async function enabled() {
  return (await db.getMeta('pref.linkPreview', true)) && sync.isSignedIn();
}

function endpoint() {
  const c = sync.getConfig();
  return c ? `${c.url}/functions/v1/link-preview` : null;
}

async function fetchPreview(url) {
  const ep = endpoint();
  const token = await sync.accessToken();
  if (!ep || !token) return null;
  const c = sync.getConfig();
  const res = await fetch(`${ep}?url=${encodeURIComponent(url)}`, {
    headers: { Authorization: `Bearer ${token}`, apikey: c.key },
  });
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) return { error: true, at: Date.now() }; // 取得できないリンク（24時間後に再試行）
  const data = await res.json();
  if (!data || data.error) return { error: true, at: Date.now() };
  return { ...sanitize(data), fetchedAt: new Date().toISOString() };
}

const httpUrl = u => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
function sanitize(d) {
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
  return {
    type: d.type === 'tweet' ? 'tweet' : 'web',
    url: httpUrl(d.url), title: s(d.title, 300), description: s(d.description, 1000),
    image: httpUrl(d.image), siteName: s(d.siteName, 100),
    author: s(d.author, 100), authorHandle: s(d.authorHandle, 100), authorIcon: httpUrl(d.authorIcon),
    publishedAt: s(d.publishedAt, 40),
  };
}

// 未解決のリンクをまとめて解決する（投稿直後・起動時・オンライン復帰時）
export async function resolvePending(limit = 20) {
  if (running || !navigator.onLine || !(await enabled())) return;
  running = true;
  try {
    const all = await db.allPosts();
    const targets = [];
    for (const p of all) {
      if (p.deleted) continue;
      const url = extractUrls(p.text)[0];
      if (!url) continue;
      const cur = p.links?.[url];
      if (cur && !cur.error) continue;
      if (cur?.error && Date.now() - cur.at < RETRY_MS) continue;
      targets.push({ id: p.id, url });
    }
    for (const t of targets.slice(0, limit)) {
      let preview;
      try { preview = await fetchPreview(t.url); } catch { break; } // 通信エラーなら次回に回す
      if (!preview) break;
      const p = await db.getPost(t.id);
      if (!p) continue;
      // プレビュー追加は「編集」ではないので更新日時は変えない
      await updatePost(t.id, { links: { ...(p.links || {}), [t.url]: preview } }, { touch: false });
    }
  } finally {
    running = false;
  }
}
