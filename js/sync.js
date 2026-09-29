// Supabase との同期（オフラインファースト）
// ・読み書きは常にローカル（IndexedDB）
// ・オンライン時に「未送信の変更を送る → サーバーの差分を受け取る」
// ・競合は updated_at が新しい方を採用（サーバー側トリガーでも同じ判定）
import * as db from './db.js';
import { emit } from './posts.js';
import { debounce } from './util.js';

const BUCKET = 'images';
const PAGE = 500;

let client = null;
let config = null;       // { url, key }
let session = null;
let running = null;
let again = false;
let status = { state: 'off', message: '', lastSyncAt: null, pending: 0 };

export const getStatus = () => ({ ...status, email: session?.user?.email || null, configured: !!config });
export const getConfig = () => config;
export const isSignedIn = () => !!session;

function setStatus(patch) {
  status = { ...status, ...patch };
  emit('sync-status', getStatus());
}

async function loadSupabaseLib() {
  if (window.supabase?.createClient) return window.supabase;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './vendor/supabase.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('同期ライブラリを読み込めませんでした'));
    document.head.appendChild(s);
  });
  return window.supabase;
}

async function makeClient(url, key) {
  if (window.__HITOKOTO_MOCK_CLIENT__) return window.__HITOKOTO_MOCK_CLIENT__(url, key); // テスト用
  const lib = await loadSupabaseLib();
  return lib.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'hitokoto-auth' },
  });
}

export async function init() {
  config = await db.getMeta('sync.config', null);
  status.lastSyncAt = await db.getMeta('sync.lastSyncAt', null);
  if (!config) { setStatus({ state: 'off' }); return; }
  try {
    client = await makeClient(config.url, config.key);
    const { data } = await client.auth.getSession();
    session = data.session;
    client.auth.onAuthStateChange((_ev, s) => { session = s; setStatus({}); });
    setStatus({ state: session ? 'idle' : 'signed-out' });
    if (session) scheduleSync(500);
  } catch (e) {
    setStatus({ state: 'error', message: e.message });
  }
}

export async function configure(url, key) {
  url = url.trim().replace(/\/+$/, '');
  key = key.trim();
  if (!/^https:\/\//.test(url)) throw new Error('URL は https:// から始めてください');
  if (!key) throw new Error('キーを入力してください');
  config = { url, key };
  await db.setMeta('sync.config', config);
  client = await makeClient(url, key);
  const { data } = await client.auth.getSession();
  session = data.session;
  client.auth.onAuthStateChange((_ev, s) => { session = s; setStatus({}); });
  setStatus({ state: session ? 'idle' : 'signed-out', message: '' });
}

export async function removeConfig() {
  if (client && session) await client.auth.signOut().catch(() => {});
  client = null; session = null; config = null;
  await db.setMeta('sync.config', null);
  setStatus({ state: 'off', message: '' });
}

async function afterSignIn() {
  const uid = session.user.id;
  const prev = await db.getMeta('sync.uid', null);
  if (prev && prev !== uid) {
    // 別アカウントに切り替えた場合は全件を送り直す
    const all = await db.allPosts();
    await db.putPosts(all.map(p => ({ ...p, dirty: 1 })));
    for (const img of await db.allImages()) await db.putImage({ ...img, uploaded: 0 });
  }
  await db.setMeta('sync.uid', uid);
  setStatus({ state: 'idle', message: '' });
  syncNow();
}

export async function signIn(email, password) {
  if (!client) throw new Error('先にサーバー設定を保存してください');
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(jaError(error));
  session = data.session;
  await afterSignIn();
}

export async function signUp(email, password) {
  if (!client) throw new Error('先にサーバー設定を保存してください');
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw new Error(jaError(error));
  if (data.session) { session = data.session; await afterSignIn(); return 'signed-in'; }
  return 'confirm-email';
}

export async function signOut() {
  if (client) await client.auth.signOut().catch(() => {});
  session = null;
  setStatus({ state: 'signed-out' });
}

export async function accessToken() {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token || null;
}

function jaError(e) {
  const m = e?.message || String(e);
  if (/Invalid login credentials/i.test(m)) return 'メールアドレスまたはパスワードが違います';
  if (/Email not confirmed/i.test(m)) return 'メールアドレスの確認が済んでいません（届いたメールのリンクを開いてください）';
  if (/Password should be/i.test(m)) return 'パスワードが短すぎます（6文字以上）';
  if (/already registered/i.test(m)) return 'このメールアドレスは登録済みです';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'サーバーに接続できませんでした';
  if (/relation .* does not exist|Could not find the table/i.test(m)) return 'posts テーブルがありません（schema.sql を実行してください）';
  if (/Bucket not found/i.test(m)) return '画像用のバケットがありません（schema.sql を実行してください）';
  return m;
}

// ---- 同期本体 ----
const toRow = (p, uid) => ({
  id: p.id, user_id: uid, text: p.text, created_at: p.createdAt, updated_at: p.updatedAt,
  deleted: !!p.deleted, liked: !!p.liked, parent_id: p.parentId || null,
  images: p.images || [], links: p.links || {},
});

const iso = v => (v ? new Date(v).toISOString() : v);
const fromRow = r => ({
  id: r.id, text: r.text || '', createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  deleted: r.deleted ? 1 : 0, liked: r.liked ? 1 : 0, parentId: r.parent_id || null,
  images: r.images || [], links: r.links || {}, dirty: 0,
});

async function push(uid) {
  const dirty = await db.dirtyPosts();
  if (!dirty.length) return 0;
  const storage = client.storage.from(BUCKET);
  for (const p of dirty) {
    for (const im of p.images || []) {
      const rec = await db.getImage(im.id);
      if (rec && !rec.uploaded) {
        const { error } = await storage.upload(`${uid}/${im.id}`, rec.blob, { contentType: rec.mime, upsert: true });
        if (error) throw error;
        await db.putImage({ ...rec, uploaded: 1 });
      }
    }
    if (p._removedImages?.length) {
      await storage.remove(p._removedImages.map(id => `${uid}/${id}`)).catch(() => {});
    }
  }
  for (let i = 0; i < dirty.length; i += 100) {
    const chunk = dirty.slice(i, i + 100);
    const { error } = await client.from('posts').upsert(chunk.map(p => toRow(p, uid)), { onConflict: 'id' });
    if (error) throw error;
    // 送信中に編集されていなければ送信済みにする
    for (const p of chunk) {
      const cur = await db.getPost(p.id);
      if (cur && cur.updatedAt === p.updatedAt && JSON.stringify(cur.links) === JSON.stringify(p.links)) {
        delete cur._removedImages;
        await db.putPost({ ...cur, dirty: 0 });
      }
    }
  }
  return dirty.length;
}

async function pull(uid) {
  const cursorKey = `sync.cursor:${uid}`;
  let cursor = await db.getMeta(cursorKey, '1970-01-01T00:00:00Z');
  let received = 0;
  const changedIds = [];
  for (;;) {
    const { data, error } = await client.from('posts').select('*')
      .gt('server_updated_at', cursor).order('server_updated_at', { ascending: true }).limit(PAGE);
    if (error) throw error;
    for (const r of data) {
      if (await mergeRemote(fromRow(r))) changedIds.push(r.id);
    }
    received += data.length;
    if (data.length) {
      cursor = data[data.length - 1].server_updated_at;
      await db.setMeta(cursorKey, cursor);
    }
    if (data.length < PAGE) break;
  }
  if (changedIds.length) emit('posts-changed', { ids: changedIds, remote: true });
  return received;
}

async function mergeRemote(remote) {
  const local = await db.getPost(remote.id);
  if (!local) {
    if (remote.deleted) { await db.putPost(remote); return false; }
    await db.putPost(remote);
    return true;
  }
  const remoteWins = remote.updatedAt > local.updatedAt || (remote.updatedAt === local.updatedAt && !local.dirty);
  if (remoteWins) {
    const links = { ...(local.links || {}), ...(remote.links || {}) };
    if (remote.deleted) {
      for (const im of local.images || []) await db.deleteImage(im.id).catch(() => {});
    } else {
      const keep = new Set((remote.images || []).map(i => i.id));
      for (const im of local.images || []) if (!keep.has(im.id)) await db.deleteImage(im.id).catch(() => {});
    }
    await db.putPost({ ...remote, links: remote.deleted ? {} : links });
    return true;
  }
  // ローカルの方が新しい：取得済みリンクプレビューだけ取り込む
  const add = Object.entries(remote.links || {}).filter(([u, v]) => !local.links?.[u] && v && !v.error);
  if (add.length) {
    await db.putPost({ ...local, links: { ...local.links, ...Object.fromEntries(add) } });
    return true;
  }
  return false;
}

export function syncNow() {
  if (running) { again = true; return running; }
  const job = (async () => {
    await null; // running に代入されてから処理を始める
    do {
      again = false;
      if (!client || !session) { setStatus({ state: config ? 'signed-out' : 'off' }); break; }
      if (!navigator.onLine) { setStatus({ state: 'offline' }); break; }
      setStatus({ state: 'syncing', message: '' });
      try {
        const uid = session.user.id;
        await push(uid);
        await pull(uid);
        await push(uid); // 取り込み中に付いたリンクプレビューなど
        const t = new Date().toISOString();
        await db.setMeta('sync.lastSyncAt', t);
        setStatus({ state: 'idle', lastSyncAt: t, pending: (await db.dirtyPosts()).length });
      } catch (e) {
        console.error('sync failed', e);
        setStatus({ state: navigator.onLine ? 'error' : 'offline', message: jaError(e) });
      }
    } while (again);
  })();
  running = job;
  job.finally(() => { if (running === job) running = null; });
  return job;
}

const debounced = debounce(() => syncNow(), 1500);
export function scheduleSync(ms) {
  if (ms) setTimeout(() => syncNow(), ms);
  else debounced();
}

export async function refreshPending() {
  setStatus({ pending: (await db.dirtyPosts()).length });
}

// ローカルに無い画像をサーバーから取得
const inflight = new Map();
export async function fetchRemoteImage(imageId) {
  if (!client || !session || !navigator.onLine) return null;
  if (inflight.has(imageId)) return inflight.get(imageId);
  const job = (async () => {
    const { data, error } = await client.storage.from(BUCKET).download(`${session.user.id}/${imageId}`);
    if (error || !data) return null;
    return data;
  })().finally(() => inflight.delete(imageId));
  inflight.set(imageId, job);
  return job;
}
