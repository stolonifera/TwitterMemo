// 投稿の作成・編集・削除などのドメイン操作
import * as db from './db.js';
import { uuid, nowIso, compressImage } from './util.js';

export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

// 変更を通知（UI 更新・同期予約に使う）
function changed(ids) { emit('posts-changed', { ids }); }

export async function addImagesFromFiles(files) {
  const out = [];
  for (const f of files) {
    if (!f.type.startsWith('image/') && !/\.(heic|heif)$/i.test(f.name)) continue;
    const { blob, width, height, mime } = await compressImage(f);
    const id = uuid();
    await db.putImage({ id, blob, mime, width, height, uploaded: 0 });
    out.push({ id, mime, width, height });
  }
  return out;
}

export async function createPost({ text, images = [], parentId = null }) {
  const t = nowIso();
  const post = {
    id: uuid(), text: text.trim(), createdAt: t, updatedAt: t,
    deleted: 0, liked: 0, parentId, images, links: {}, dirty: 1,
  };
  await db.putPost(post);
  changed([post.id]);
  return post;
}

export async function updatePost(id, patch, { touch = true } = {}) {
  const p = await db.getPost(id);
  if (!p) return null;
  Object.assign(p, patch, { dirty: 1 });
  if (touch) p.updatedAt = nowIso();
  await db.putPost(p);
  changed([id]);
  return p;
}

export async function editText(id, text, images) {
  const p = await db.getPost(id);
  if (!p) return;
  const patch = { text: text.trim() };
  if (images) {
    // 外した画像はローカルから削除
    const keep = new Set(images.map(i => i.id));
    const removed = (p.images || []).filter(img => !keep.has(img.id)).map(img => img.id);
    for (const rid of removed) await db.deleteImage(rid).catch(() => {});
    patch.images = images;
    if (removed.length) patch._removedImages = [...(p._removedImages || []), ...removed];
  }
  return updatePost(id, patch);
}

export async function toggleLike(id) {
  const p = await db.getPost(id);
  if (!p) return;
  return updatePost(id, { liked: p.liked ? 0 : 1 });
}

export async function deletePost(id) {
  const p = await db.getPost(id);
  if (!p) return;
  // 論理削除：本文と画像は消して、削除済みフラグだけ残す（他端末に削除を伝えるため）
  const oldImages = p.images || [];
  await updatePost(id, { deleted: 1, text: '', links: {}, images: [], _removedImages: [...(p._removedImages || []), ...oldImages.map(i => i.id)] });
  for (const img of oldImages) await db.deleteImage(img.id).catch(() => {});
}

export async function getThread(id) {
  const post = await db.getPost(id);
  if (!post) return null;
  const ancestors = [];
  let cur = post;
  const seen = new Set([post.id]);
  while (cur.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    const parent = await db.getPost(cur.parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    cur = parent;
  }
  const replies = await db.childrenOf(id);
  return { post, ancestors, replies };
}

export async function replyCounts(ids) {
  const out = {};
  await Promise.all(ids.map(async id => { out[id] = (await db.childrenOf(id)).length; }));
  return out;
}

// 検索：テキスト（スペース区切り AND）、#タグ、日付
export async function search({ q = '', day = null, likedOnly = false }) {
  const terms = q.trim().toLowerCase().split(/[\s　]+/).filter(Boolean);
  const all = await db.allPosts();
  return all
    .filter(p => !p.deleted)
    .filter(p => !likedOnly || p.liked)
    .filter(p => {
      if (day) {
        const d = new Date(p.createdAt);
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (k !== day) return false;
      }
      const text = p.text.toLowerCase();
      return terms.every(t => text.includes(t));
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function tagStats(limit = 30) {
  const all = await db.allPosts();
  const counts = new Map();
  const re = /(^|[\s　(（])#([\p{L}\p{N}_]+)/gu;
  for (const p of all) {
    if (p.deleted) continue;
    const seen = new Set();
    for (const m of p.text.matchAll(re)) seen.add(m[2]);
    for (const t of seen) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}
