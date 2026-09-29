// 汎用ユーティリティ

export const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
      return (c === 'x' ? r : (r & 3) | 8).toString(16);
    }));

export const nowIso = () => new Date().toISOString();

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// URL 抽出（全角の閉じ括弧や句読点で止める）
const URL_RE = /https?:\/\/[^\s<>"'　、。）」』】\]]+/g;
export function extractUrls(text) {
  const out = [];
  for (const m of String(text || '').matchAll(URL_RE)) {
    const u = m[0].replace(/[.,!?;:)]+$/, '');
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

const TAG_RE = /(^|[\s　(（])#([\p{L}\p{N}_]+)/gu;
export function extractTags(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(TAG_RE)) out.add(m[2]);
  return [...out];
}

// 本文 → 安全な HTML（URL と #タグをリンク化）
export function renderText(text) {
  const src = String(text || '');
  const tokens = [];
  const re = new RegExp(`${URL_RE.source}|${TAG_RE.source}`, 'gu');
  let last = 0;
  for (const m of src.matchAll(re)) {
    let start = m.index, str = m[0];
    if (str.startsWith('http')) {
      const trimmed = str.replace(/[.,!?;:)]+$/, '');
      tokens.push(esc(src.slice(last, start)));
      const display = trimmed.replace(/^https?:\/\/(www\.)?/, '');
      tokens.push(`<a href="${esc(trimmed)}" target="_blank" rel="noopener noreferrer" class="lnk">${esc(display.length > 40 ? display.slice(0, 39) + '…' : display)}</a>`);
      last = start + trimmed.length;
    } else {
      const lead = m[1] ?? '';
      const tag = m[2];
      tokens.push(esc(src.slice(last, start + lead.length)));
      tokens.push(`<a href="#/search?q=${encodeURIComponent('#' + tag)}" class="tag">#${esc(tag)}</a>`);
      last = start + str.length;
    }
  }
  tokens.push(esc(src.slice(last)));
  return tokens.join('');
}

export function relTime(iso) {
  const d = new Date(iso), now = new Date();
  const s = Math.floor((now - d) / 1000);
  if (s < 60) return '今';
  if (s < 3600) return `${Math.floor(s / 60)}分`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fullTime(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function localStamp(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function dayKey(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// 画像を縮小して JPEG に変換
export async function compressImage(file, maxSide = 2048, quality = 0.85) {
  const img = await loadImage(file);
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
  if (img.close) img.close();
  return { blob, width: w, height: h, mime: 'image/jpeg' };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

// ファイル保存：iOS のホーム画面アプリではダウンロードが不安定なので共有シートを優先
export async function saveFile(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

export function formatBytes(n) {
  if (!n && n !== 0) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
