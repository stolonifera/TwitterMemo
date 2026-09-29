// IndexedDB ラッパー
// posts:  { id, text, createdAt, updatedAt, deleted(0/1), liked(0/1), parentId, images:[{id,mime,width,height}], links:{url:preview}, dirty(0/1) }
// images: { id, blob, mime, width, height, uploaded(0/1) }
// meta:   { key, value }

const DB_NAME = new URLSearchParams(location.search).get('db') || 'hitokoto';
const DB_VERSION = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('posts')) {
        const s = db.createObjectStore('posts', { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
        s.createIndex('dirty', 'dirty');
        s.createIndex('parentId', 'parentId');
      }
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const wrap = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

// ---- posts ----
export async function getPost(id) {
  return wrap((await store('posts')).get(id));
}

export async function putPost(post) {
  return wrap((await store('posts', 'readwrite')).put(post));
}

export async function putPosts(posts) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('posts', 'readwrite');
    const s = tx.objectStore('posts');
    for (const p of posts) s.put(p);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function allPosts() {
  return wrap((await store('posts')).getAll());
}

export async function dirtyPosts() {
  return wrap((await store('posts')).index('dirty').getAll(1));
}

export async function childrenOf(parentId) {
  const list = await wrap((await store('posts')).index('parentId').getAll(parentId));
  return list.filter(p => !p.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// 新しい順にページ取得。before は createdAt（これより古いもの）
export async function pagePosts({ before = null, limit = 40, filter = null } = {}) {
  const s = await store('posts');
  const range = before ? IDBKeyRange.upperBound(before, true) : null;
  return new Promise((resolve, reject) => {
    const out = [];
    const req = s.index('createdAt').openCursor(range, 'prev');
    req.onsuccess = () => {
      const c = req.result;
      if (!c || out.length >= limit) return resolve(out);
      const p = c.value;
      if (!p.deleted && (!filter || filter(p))) out.push(p);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function countPosts() {
  const all = await allPosts();
  return all.filter(p => !p.deleted).length;
}

// ---- images ----
export async function getImage(id) {
  return wrap((await store('images')).get(id));
}
export async function putImage(img) {
  return wrap((await store('images', 'readwrite')).put(img));
}
export async function deleteImage(id) {
  return wrap((await store('images', 'readwrite')).delete(id));
}
export async function allImages() {
  return wrap((await store('images')).getAll());
}

// ---- meta ----
export async function getMeta(key, fallback = null) {
  const r = await wrap((await store('meta')).get(key));
  return r ? r.value : fallback;
}
export async function setMeta(key, value) {
  return wrap((await store('meta', 'readwrite')).put({ key, value }));
}

export async function clearAll() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['posts', 'images', 'meta'], 'readwrite');
    tx.objectStore('posts').clear();
    tx.objectStore('images').clear();
    tx.objectStore('meta').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
