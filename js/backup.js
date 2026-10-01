// バックアップ（CSV / JSON）とインポート
import * as db from './db.js';
import { uuid, nowIso, localStamp, extractUrls, blobToDataUrl, dataUrlToBlob, saveFile } from './util.js';
import { emit } from './posts.js';

const stamp = () => localStamp(nowIso()).replace(/[-: ]/g, '').slice(0, 12);

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportCsv() {
  const posts = (await db.allPosts()).filter(p => !p.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const header = ['id', 'datetime', 'text', 'liked', 'reply_to', 'quote_of', 'images', 'urls', 'created_at', 'updated_at'];
  const rows = posts.map(p => [
    p.id, localStamp(p.createdAt), p.text, p.liked ? 1 : 0, p.parentId || '', p.quoteId || '',
    (p.images || []).length, extractUrls(p.text).join(' '), p.createdAt, p.updatedAt,
  ]);
  const csv = '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  await saveFile(blob, `hitokoto-${stamp()}.csv`);
  await db.setMeta('backup.lastAt', nowIso());
  return posts.length;
}

export async function exportJson() {
  const posts = await db.allPosts();
  const images = [];
  for (const p of posts) {
    if (p.deleted) continue;
    for (const im of p.images || []) {
      const rec = await db.getImage(im.id);
      if (rec?.blob) images.push({ id: rec.id, mime: rec.mime, width: rec.width, height: rec.height, data: await blobToDataUrl(rec.blob) });
    }
  }
  const profile = await db.getMeta('profile', null);
  const payload = {
    app: 'hitokoto', format: 1, exportedAt: nowIso(), profile,
    posts: posts.map(({ dirty, _removedImages, ...p }) => p),
    images,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  await saveFile(blob, `hitokoto-backup-${stamp()}.json`);
  await db.setMeta('backup.lastAt', nowIso());
  return { posts: posts.filter(p => !p.deleted).length, images: images.length };
}

// 新しい方を採用してマージ
async function mergePost(incoming) {
  const local = await db.getPost(incoming.id);
  if (local && local.updatedAt >= incoming.updatedAt) return false;
  await db.putPost({ ...incoming, dirty: 1 });
  return true;
}

export async function importJson(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'hitokoto' || !Array.isArray(data.posts)) throw new Error('このアプリのバックアップファイルではありません');
  let imgCount = 0, postCount = 0;
  for (const im of data.images || []) {
    if (await db.getImage(im.id)) continue;
    const blob = await dataUrlToBlob(im.data);
    await db.putImage({ id: im.id, blob, mime: im.mime, width: im.width, height: im.height, uploaded: 0 });
    imgCount++;
  }
  for (const p of data.posts) {
    if (!p.id || !p.createdAt) continue;
    const post = {
      id: p.id, text: p.text || '', createdAt: p.createdAt, updatedAt: p.updatedAt || p.createdAt,
      deleted: p.deleted ? 1 : 0, liked: p.liked ? 1 : 0, parentId: p.parentId || null, quoteId: p.quoteId || null,
      images: p.images || [], links: p.links || {},
    };
    if (await mergePost(post)) postCount++;
  }
  if (data.profile && !(await db.getMeta('profile', null))) {
    await db.setMeta('profile', { ...data.profile, updatedAt: nowIso() });
    await db.setMeta('profile.dirty', true);
  }
  emit('posts-changed', { ids: [], bulk: true });
  return { posts: postCount, images: imgCount };
}

export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c !== ''));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseDate(s) {
  if (!s) return null;
  const t = s.trim().replace(/\//g, '-');
  const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  let d;
  if (m) d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  else d = new Date(t);
  return isNaN(d) ? null : d.toISOString();
}

// 本アプリの CSV のほか、「text（本文）」列と日時列だけの CSV も読み込める
export async function importCsv(file) {
  const rows = parseCsv(await file.text());
  if (rows.length < 2) throw new Error('データがありません');
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => head.findIndex(h => names.includes(h));
  const cText = col('text', '本文', 'content', 'memo', 'メモ', 'body');
  if (cText < 0) throw new Error('本文の列（text / 本文）が見つかりません');
  const cId = col('id');
  const cCreated = col('created_at');
  const cDate = col('datetime', 'date', '日時', '日付', 'created');
  const cUpdated = col('updated_at');
  const cLiked = col('liked', 'いいね');
  const cReply = col('reply_to');
  const cQuote = col('quote_of');
  let count = 0;
  for (const r of rows.slice(1)) {
    const text = r[cText] ?? '';
    if (!text.trim()) continue;
    const createdAt = (cCreated >= 0 && parseDate(r[cCreated])) || (cDate >= 0 && parseDate(r[cDate])) || nowIso();
    const id = cId >= 0 && UUID_RE.test(r[cId] || '') ? r[cId].toLowerCase() : uuid();
    const existing = await db.getPost(id);
    const post = {
      id, text, createdAt,
      updatedAt: (cUpdated >= 0 && parseDate(r[cUpdated])) || createdAt,
      deleted: 0, liked: cLiked >= 0 && /^(1|true|yes)$/i.test(r[cLiked] || '') ? 1 : 0,
      parentId: cReply >= 0 && UUID_RE.test(r[cReply] || '') ? r[cReply].toLowerCase() : null,
      quoteId: cQuote >= 0 && UUID_RE.test(r[cQuote] || '') ? r[cQuote].toLowerCase() : null,
      images: existing?.images || [], links: existing?.links || {},
    };
    if (await mergePost(post)) count++;
  }
  emit('posts-changed', { ids: [], bulk: true });
  return count;
}
