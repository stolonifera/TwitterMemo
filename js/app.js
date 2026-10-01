// ひとこと — SNS 風ひとりメモ（オフラインファースト PWA）
import * as db from './db.js';
import * as P from './posts.js';
import * as sync from './sync.js';
import * as LP from './linkpreview.js';
import * as backup from './backup.js';
import {
  esc, renderText, relTime, fullTime, extractUrls, debounce, compressImage,
  blobToDataUrl, formatBytes, localStamp, dayKey,
} from './util.js';

export const APP_VERSION = '1.2.0';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const view = $('#view');
const overlayRoot = $('#overlay-root');
const wide = matchMedia('(min-width: 700px)');

const I = {
  reply: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 8-8h1a7 7 0 0 1 0 14h-2l-5 3v-4.5A8 8 0 0 1 4 12z"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9.2-8.6C1.4 8.6 3 5 6.5 5c2 0 3.3 1.1 4.1 2.3L12 9l1.4-1.7C14.2 6.1 15.5 5 17.5 5 21 5 22.6 8.6 21.2 11.4 19 15.6 12 20 12 20z"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M19 12H5M11 5l-7 7 7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4.3 4.3 0 0 1-.5 8.5z"/></svg>',
  cloudOff: '<svg viewBox="0 0 24 24"><path d="M7 18a4.5 4.5 0 0 1-.6-9m3-2.4A6 6 0 0 1 18 9.5a4.3 4.3 0 0 1 2.3 7.2M3 3l18 18"/></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16m0 4v-4h-4"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  arrowDown: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  repost: '<svg viewBox="0 0 24 24"><path d="M7 17V8a2 2 0 0 1 2-2h9M15 3l3 3-3 3M17 7v9a2 2 0 0 1-2 2H6M9 21l-3-3 3-3"/></svg>',
  chevD: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  chevR: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
};

const DEFAULT_PROFILE = { name: '自分', handle: 'me', avatar: null, banner: null, bio: '', location: '', website: '' };
let profile = { ...DEFAULT_PROFILE };

// プロフィールを保存する（updatedAt を付けて、同期の送信待ちにする）
async function saveProfile(next) {
  profile = { ...next, updatedAt: new Date().toISOString() };
  await db.setMeta('profile', profile);
  await db.setMeta('profile.dirty', true);
  sync.scheduleSync();
}
let route = { name: 'home', params: {} };
const home = { items: [], done: false, loading: false };
const skipRender = new Set();

// =====================================================================
// 汎用 UI
// =====================================================================
let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { t.classList.remove('show'); action.run(); };
    t.appendChild(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 8000 : 2600);
}

// ---------- 投稿画面を開いたときに、すぐキーボードを出すしくみ ----------
// iPhone では、JavaScript から入力欄にフォーカスしてもキーボードが出るとは限らない
// （Safari は出すが、Chrome など Safari 以外のブラウザは出さないことがある）。
// そこで、＋ボタンや返信ボタンの上に「透明な入力欄」を重ねておく。
// 指はこの入力欄を直接タップするので、どのブラウザでも普通にキーボードが開く。
// そのタップの処理の中で投稿画面を作り、本物の入力欄へフォーカスを移す（キーボードは開いたまま）。
const kbCatch = (kind, id = '') =>
  `<textarea class="kb-catch" data-kb="${kind}"${id ? ` data-id="${esc(id)}"` : ''} tabindex="-1" aria-hidden="true" rows="1" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>`;

// 透明な入力欄をタップすると、同じタップの click が少しあとに届く。
// 投稿画面の下にあったボタンが押されたことにならないよう、その1回だけ捨てる。
let swallowClicksUntil = 0;
window.addEventListener('click', e => {
  if (Date.now() < swallowClicksUntil) {
    swallowClicksUntil = 0; // 捨てるのは1回だけ（すぐ押したキャンセルなどは効くように）
    e.preventDefault(); e.stopPropagation();
  }
}, true);

const kbActions = {
  new: () => openComposer(),
  quote: id => openComposer({ quoteId: id }),
  reply: id => {
    if (route.name === 'post' && route.params.id === id) $('.reply-box textarea')?.focus();
    else openComposer({ parentId: id });
  },
};
document.addEventListener('focusin', e => {
  const c = e.target;
  if (!c.classList?.contains('kb-catch')) return;
  c.value = '';
  const run = kbActions[c.dataset.kb];
  if (!run) return;
  swallowClicksUntil = Date.now() + 300;
  run(c.dataset.id); // ここで同期的に（await せずに）本物の入力欄へフォーカスする
});

function openOverlay(html, { onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  overlayRoot.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  const close = () => {
    wrap.remove();
    if (!overlayRoot.children.length) document.body.style.overflow = '';
    onClose?.();
  };
  wrap.querySelector('.backdrop')?.addEventListener('click', close);
  return { el: wrap, close };
}

function actionSheet(items) {
  return new Promise(resolve => {
    const html = `<div class="backdrop"></div><div class="sheet" role="menu"><div class="grab"></div>
      ${items.map((it, i) => {
        const btn = `<button class="item ${it.danger ? 'danger' : ''}" data-i="${i}">${it.icon || ''}<span>${esc(it.label)}</span></button>`;
        return it.kb ? `<div class="kb-wrap block">${btn}${kbCatch('sheet')}</div>` : btn;
      }).join('')}
      <button class="item" data-i="-1"><span style="color:var(--fg-2)">キャンセル</span></button></div>`;
    let chosen = null;
    const o = openOverlay(html, { onClose: () => resolve(chosen) });
    o.el.querySelectorAll('.item').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.i;
      chosen = i >= 0 ? items[i].value : null;
      o.close();
    }));
    // 透明な入力欄がタップされたら、先に次の画面を開いてフォーカスを移し、それからシートを閉じる
    o.el.querySelectorAll('.kb-wrap').forEach(w => w.querySelector('.kb-catch').addEventListener('focus', () => {
      const i = +w.querySelector('.item').dataset.i;
      swallowClicksUntil = Date.now() + 300;
      chosen = null;
      items[i].kb();
      o.close();
    }));
  });
}

// =====================================================================
// 画像
// =====================================================================
const urlCache = new Map();
async function imageUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  let rec = await db.getImage(id);
  if (!rec) {
    const blob = await sync.fetchRemoteImage(id).catch(() => null);
    if (!blob) return null;
    rec = { id, blob, mime: blob.type || 'image/jpeg', uploaded: 1 };
    await db.putImage(rec);
  }
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(id, url);
  return url;
}

async function hydrateImages(root = view) {
  const nodes = $$('[data-img]:not([data-ready])', root);
  await Promise.all(nodes.map(async el => {
    el.dataset.ready = '1';
    const url = await imageUrl(el.dataset.img);
    if (url) {
      el.innerHTML = `<img src="${url}" alt="" loading="lazy" decoding="async">`;
    } else {
      el.innerHTML = `<div class="ph">${sync.isSignedIn() ? '画像を取得できません（オフライン）' : '画像はこの端末にありません'}</div>`;
      delete el.dataset.ready; // 次回再試行
    }
  }));
}

// =====================================================================
// 描画
// =====================================================================
function avatarHtml(cls = '', prof = profile) {
  const style = prof.avatar ? ` style="background-image:url('${prof.avatar}')"` : '';
  const letter = prof.avatar ? '' : esc(Array.from(prof.name || '?')[0] || '?');
  return `<div class="avatar ${cls}"${style} aria-hidden="true">${letter}</div>`;
}

const cssUrl = u => String(u).replace(/["'()\\\s]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));

function mediaHtml(p) {
  const imgs = (p.images || []).slice(0, 4);
  if (!imgs.length) return '';
  const one = imgs.length === 1 && imgs[0].width ? ` style="aspect-ratio:${imgs[0].width}/${imgs[0].height}"` : '';
  return `<div class="media n${imgs.length}">${imgs.map((im, i) =>
    `<div class="m" data-img="${esc(im.id)}" data-act="img" data-id="${esc(p.id)}" data-idx="${i}"${one}><div class="ph"></div></div>`).join('')}</div>`;
}

function cardHtml(p, linkState) {
  const url = extractUrls(p.text)[0];
  if (!url) return '';
  const pv = p.links?.[url];
  if (!pv) {
    return linkState.enabled && navigator.onLine
      ? `<div class="card pending">${I.globe}<span>リンク情報を取得しています…</span></div>` : '';
  }
  if (pv.error) return '';
  const href = esc(pv.url || url);
  if (pv.type === 'tweet') {
    return `<a class="card tweet" href="${href}" target="_blank" rel="noopener noreferrer">
      <div class="tw-head">${pv.authorIcon ? `<img src="${esc(pv.authorIcon)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
        <b>${esc(pv.author || '')}</b><span>@${esc(pv.authorHandle || '')}</span></div>
      <div class="tw-text">${esc(pv.description || pv.title || '')}</div>
      ${pv.image ? `<div class="tw-img" style="background-image:url('${esc(cssUrl(pv.image))}')"></div>` : ''}
    </a>`;
  }
  let host = '';
  try { host = new URL(pv.url || url).hostname.replace(/^www\./, ''); } catch {}
  const site = esc(pv.siteName || host);
  const large = !!pv.image;
  return `<a class="card ${large ? '' : 'compact'}" href="${href}" target="_blank" rel="noopener noreferrer">
    ${large ? `<div class="thumb" style="background-image:url('${esc(cssUrl(pv.image))}')"></div>` : ''}
    <div class="info"><div class="site">${site}</div>
      <div class="ttl">${esc(pv.title || host)}</div>
      ${pv.description ? `<div class="desc">${esc(pv.description)}</div>` : ''}
    </div></a>`;
}

function actionsHtml(p, ctx) {
  const replyCount = ctx.replies.get(p.id), quoteCount = ctx.quotes.get(p.id);
  return `<div class="actions">
    <span class="kb-wrap"><button class="act" data-act="reply" data-id="${esc(p.id)}" aria-label="返信">${I.reply}<span>${replyCount || ''}</span></button>${kbCatch('reply', p.id)}</span>
    <span class="kb-wrap"><button class="act quote" data-act="quote" data-id="${esc(p.id)}" aria-label="引用">${I.repost}<span>${quoteCount || ''}</span></button>${kbCatch('quote', p.id)}</span>
    <button class="act like ${p.liked ? 'on' : ''}" data-act="like" data-id="${esc(p.id)}" aria-label="いいね">${I.heart}</button>
    <button class="act" data-act="more" data-id="${esc(p.id)}" aria-label="その他">${I.more}</button>
  </div>`;
}

// 引用したポストを、カードとして埋め込む
function quoteEmbedHtml(quoteId, byId) {
  if (!quoteId) return '';
  const q = byId.get(quoteId);
  if (!q || q.deleted) {
    return `<div class="qcard gone">${q ? 'このポストは削除されました' : 'このポストは表示できません（まだ同期されていない可能性があります）'}</div>`;
  }
  const imgs = (q.images || []).slice(0, 4);
  return `<div class="qcard" data-act="open" data-id="${esc(q.id)}" role="link">
    <div class="qmeta">${avatarHtml('xs')}<b>${esc(profile.name)}</b><span class="handle">@${esc(profile.handle)}</span><span>·</span><time data-t="${esc(q.createdAt)}">${relTime(q.createdAt)}</time></div>
    ${q.text ? `<div class="qtext">${renderText(q.text)}</div>` : ''}
    ${imgs.length ? `<div class="qmedia">${imgs.map(im => `<div class="m" data-img="${esc(im.id)}"><div class="ph"></div></div>`).join('')}</div>` : ''}
    ${q.quoteId ? '<div class="qnote">さらに別のポストを引用しています</div>' : ''}
  </div>`;
}

function postHtml(p, ctx) {
  const parent = p.parentId ? ctx.parents.get(p.parentId) : null;
  const replyTo = p.parentId && ctx.showReplyTo !== false
    ? `<div class="replyto">返信先: ${parent && !parent.deleted
        ? `<a href="#/post/${esc(parent.id)}">${esc(parent.text.slice(0, 40) || '(画像)')}</a>`
        : '削除された投稿'}</div>` : '';
  return `<article class="post ${ctx.cls || ''}" data-act="open" data-id="${esc(p.id)}">
    <div class="avatar-col" data-act="profile">${avatarHtml(ctx.avatarCls || '')}</div>
    <div class="body">
      <div class="meta"><b>${esc(profile.name)}</b><span class="handle">@${esc(profile.handle)}</span><span>·</span><time data-t="${esc(p.createdAt)}" title="${esc(fullTime(p.createdAt))}">${relTime(p.createdAt)}</time></div>
      ${replyTo}
      ${p.text ? `<div class="text">${renderText(p.text)}</div>` : ''}
      ${mediaHtml(p)}
      ${quoteEmbedHtml(p.quoteId, ctx.byId)}
      ${cardHtml(p, ctx.link)}
      ${actionsHtml(p, ctx)}
    </div>
  </article>`;
}

function mainPostHtml(p, ctx) {
  return `<article class="post main" data-id="${esc(p.id)}">
    <div class="head"><span data-act="profile">${avatarHtml()}</span><div class="who"><b>${esc(profile.name)}</b><span>@${esc(profile.handle)}</span></div></div>
    ${p.text ? `<div class="text">${renderText(p.text)}</div>` : ''}
    ${mediaHtml(p)}
    ${quoteEmbedHtml(p.quoteId, ctx.byId)}
    ${cardHtml(p, ctx.link)}
    <div class="when">${esc(fullTime(p.createdAt))}</div>
    ${ctx.stats || ''}
    ${actionsHtml(p, ctx)}
  </article>`;
}

// 描画に必要な周辺情報（返信数・引用数・返信先・引用元・リンク設定）
async function buildCtx(posts) {
  const all = await db.allPosts();
  const replies = new Map(), quotes = new Map();
  const byId = new Map(all.map(p => [p.id, p]));
  for (const p of all) {
    if (p.deleted) continue;
    if (p.parentId) replies.set(p.parentId, (replies.get(p.parentId) || 0) + 1);
    if (p.quoteId) quotes.set(p.quoteId, (quotes.get(p.quoteId) || 0) + 1);
  }
  const parents = new Map();
  for (const p of posts) if (p.parentId) parents.set(p.parentId, byId.get(p.parentId));
  return { replies, quotes, parents, byId, link: { enabled: await LP.enabled() } };
}

async function listHtml(posts, extra = {}) {
  const ctx = { ...(await buildCtx(posts)), ...extra };
  return posts.map(p => postHtml(p, ctx)).join('');
}

// =====================================================================
// 投稿フォーム
// =====================================================================
function composerHtml({ placeholder = 'いまどうしてる？', submitLabel = '投稿する', showAvatar = true } = {}) {
  return `<div class="composer">
    ${showAvatar ? avatarHtml() : ''}
    <div class="c-body">
      <textarea rows="2" placeholder="${esc(placeholder)}" aria-label="本文"></textarea>
      <div class="c-thumbs"></div>
      <div class="c-quote"></div>
      <div class="c-bar">
        <button class="icon-btn" data-c="img" aria-label="画像を追加">${I.image}</button>
        <input type="file" accept="image/*" multiple hidden>
        <span class="spacer"></span>
        <span class="c-count"></span>
        <button class="btn sm" data-c="submit" disabled>${esc(submitLabel)}</button>
      </div>
    </div>
  </div>`;
}

// 投稿フォームの振る舞いを取り付ける
function mountComposer(root, { text = '', images = [], parentId = null, quoteId = null, editId = null, draftKey = null, autofocus = false, onDone } = {}) {
  const ta = $('textarea', root);
  const thumbs = $('.c-thumbs', root);
  const submit = $('[data-c="submit"]', root);
  const fileInput = $('input[type=file]', root);
  const count = $('.c-count', root);
  let imgs = [...images];
  const added = new Set();
  let busy = false;

  ta.value = text;
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.55) + 'px'; };
  const refresh = () => {
    const n = Array.from(ta.value).length;
    count.textContent = n ? String(n) : '';
    submit.disabled = busy || (!ta.value.trim() && !imgs.length && !quoteId); // 引用だけならコメントなしでも投稿できる
    autosize();
  };
  const saveDraft = draftKey ? debounce(() => db.setMeta(draftKey, ta.value), 400) : () => {};

  async function renderThumbs() {
    thumbs.innerHTML = imgs.map(im => `<div class="c-thumb" data-img-thumb="${esc(im.id)}"><button data-rm="${esc(im.id)}" aria-label="画像を外す">${I.close}</button></div>`).join('');
    for (const im of imgs) {
      const url = await imageUrl(im.id);
      const el = thumbs.querySelector(`[data-img-thumb="${CSS.escape(im.id)}"]`);
      if (url && el) el.insertAdjacentHTML('afterbegin', `<img src="${url}" alt="">`);
    }
    refresh();
  }

  async function addFiles(files) {
    const room = 4 - imgs.length;
    if (room <= 0) { toast('画像は4枚までです'); return; }
    const list = [...files].slice(0, room);
    if (files.length > room) toast('画像は4枚までです');
    try {
      const out = await P.addImagesFromFiles(list);
      out.forEach(o => added.add(o.id));
      imgs.push(...out);
      renderThumbs();
    } catch (e) { toast(e.message); }
  }

  ta.addEventListener('input', () => { refresh(); saveDraft(); });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!submit.disabled) submit.click(); }
  });
  ta.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  root.addEventListener('dragover', e => { e.preventDefault(); });
  root.addEventListener('drop', e => {
    const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  $('[data-c="img"]', root).addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  thumbs.addEventListener('click', e => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    const id = b.dataset.rm;
    imgs = imgs.filter(i => i.id !== id);
    if (added.has(id)) { added.delete(id); db.deleteImage(id); }
    renderThumbs();
  });
  submit.addEventListener('click', async () => {
    if (busy) return;
    busy = true; refresh();
    try {
      let post;
      if (editId) post = await P.editText(editId, ta.value, imgs);
      else post = await P.createPost({ text: ta.value, images: imgs, parentId, quoteId });
      added.clear();
      imgs = [];
      ta.value = '';
      if (draftKey) await db.setMeta(draftKey, '');
      renderThumbs();
      onDone?.(post);
    } catch (e) {
      toast('保存できませんでした: ' + e.message);
    } finally {
      busy = false; refresh();
    }
  });

  if (imgs.length) renderThumbs();
  refresh();
  if (autofocus) {
    const focusEnd = () => { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); };
    focusEnd();                       // ダミー入力欄から引き継ぐ
    requestAnimationFrame(focusEnd);  // 念のため描画後にもう一度
  }

  return {
    // キャンセル時：新しく追加しただけの画像を片付ける
    discard() { for (const id of added) db.deleteImage(id); added.clear(); },
    isDirty() { return ta.value.trim() !== text.trim() || added.size > 0 || imgs.length !== images.length; },
    focus() { ta.focus(); },
  };
}

// ※ キーボードを出すため、この関数は await より前に入力欄へフォーカスする（async にしない）
function openComposer({ parentId = null, editId = null, quoteId = null } = {}) {
  const draftKey = !parentId && !editId && !quoteId ? 'draft' : null;
  const title = editId ? '編集' : parentId ? '返信' : quoteId ? '引用' : '';
  const html = `<div class="backdrop"></div><div class="modal" role="dialog" aria-label="${title || '投稿'}">
    <div class="modal-head"><button class="link" data-m="cancel">キャンセル</button><b>${title}</b><span style="width:72px"></span></div>
    <div class="modal-body">
      ${parentId ? '<div class="quote"></div>' : ''}
      ${composerHtml({ placeholder: parentId ? '返信を書く' : quoteId ? 'コメントを追加' : 'いまどうしてる？', submitLabel: editId ? '保存' : parentId ? '返信' : '投稿する' })}
    </div></div>`;
  let comp = null;
  const o = openOverlay(html, { onClose: () => comp?.discard() });
  // ヘッダー右に送信ボタンを移動（スマホで押しやすく）
  const submitBtn = $('[data-c="submit"]', o.el);
  const head = $('.modal-head', o.el);
  head.lastElementChild.replaceWith(submitBtn);
  $('[data-m="cancel"]', o.el).addEventListener('click', () => o.close());
  $('.backdrop', o.el).replaceWith($('.backdrop', o.el).cloneNode()); // 背景タップで閉じない（誤操作防止）

  // タップと同じ処理の中でフォーカスする（ここより前に await を置かないこと）
  const ta = $('textarea', o.el);
  ta.focus({ preventScroll: true });

  // 下書き・編集する本文・返信先は、フォーカスしたあとで読み込む
  (async () => {
    let text = '', images = [];
    if (editId) {
      const p = await db.getPost(editId);
      if (!p) { o.close(); toast('投稿が見つかりません'); return; }
      text = p.text; images = p.images || [];
      quoteId = p.quoteId || null; // 引用ポストの編集では、引用元も表示する
    } else if (draftKey) {
      text = await db.getMeta(draftKey, '') || '';
    }
    if (quoteId) {
      const q = await db.getPost(quoteId);
      const box = $('.c-quote', o.el);
      box.innerHTML = quoteEmbedHtml(quoteId, new Map(q ? [[q.id, q]] : []));
      hydrateImages(box);
    }
    if (parentId) {
      const parent = await db.getPost(parentId);
      $('.quote', o.el).textContent = (parent?.text || '').slice(0, 200);
    }
    if (!o.el.isConnected) return; // 読み込み中に閉じられた
    if (!editId && ta.value) text = ta.value; // 読み込み中に打ち始めていたら、それを残す
    comp = mountComposer(o.el, {
      text, images, parentId, quoteId: editId ? null : quoteId, editId, draftKey, autofocus: true,
      onDone: post => {
        o.close();
        if (editId) toast('保存しました');
        else if (parentId) toast('返信しました');
        else if (quoteId) toast('引用しました', { label: '表示', run: () => go(`#/post/${post.id}`) });
        else if (route.name !== 'home') toast('投稿しました', { label: '表示', run: () => go(`#/post/${post.id}`) });
      },
    });
  })();
}

// =====================================================================
// 画像ビューア
// =====================================================================
async function openViewer(postId, idx) {
  const p = await db.getPost(postId);
  if (!p?.images?.length) return;
  let i = idx;
  const o = openOverlay(`<div class="viewer" role="dialog" aria-label="画像">
    <img alt="">
    <button class="v-close" aria-label="閉じる">${I.close}</button>
    ${p.images.length > 1 ? `<button class="v-nav v-prev" aria-label="前へ"><svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg></button>
    <button class="v-nav v-next" aria-label="次へ"><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></button>
    <div class="v-count"></div>` : ''}
  </div>`, { onClose: () => document.removeEventListener('keydown', onKey) });
  const img = $('img', o.el);
  const show = async () => {
    img.src = (await imageUrl(p.images[i].id)) || '';
    const c = $('.v-count', o.el);
    if (c) c.textContent = `${i + 1} / ${p.images.length}`;
  };
  const move = d => { i = (i + d + p.images.length) % p.images.length; show(); };
  const onKey = e => {
    if (e.key === 'Escape') o.close();
    if (e.key === 'ArrowRight') move(1);
    if (e.key === 'ArrowLeft') move(-1);
  };
  document.addEventListener('keydown', onKey);
  const v = $('.viewer', o.el);
  v.addEventListener('click', e => {
    if (e.target.closest('.v-prev')) return move(-1);
    if (e.target.closest('.v-next')) return move(1);
    if (e.target === img && p.images.length > 1) return;
    o.close();
  });
  let sx = 0, sy = 0;
  v.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  v.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) o.close();
    else if (Math.abs(dx) > 50 && p.images.length > 1) move(dx < 0 ? 1 : -1);
  });
  show();
}

// =====================================================================
// 投稿へのアクション
// =====================================================================
async function postMenu(id) {
  const p = await db.getPost(id);
  if (!p) return;
  const choice = await actionSheet([
    { label: '編集', value: 'edit', icon: I.edit, kb: () => openComposer({ editId: id }) },
    { label: 'テキストをコピー', value: 'copy', icon: I.copy },
    ...(extractUrls(p.text).length ? [{ label: 'リンク情報を再取得', value: 'refetch', icon: I.link }] : []),
    { label: '削除', value: 'delete', icon: I.trash, danger: true },
  ]);
  if (choice === 'edit') openComposer({ editId: id });
  if (choice === 'copy') {
    try { await navigator.clipboard.writeText(p.text); toast('コピーしました'); }
    catch { toast('コピーできませんでした'); }
  }
  if (choice === 'refetch') {
    await P.updatePost(id, { links: {} }, { touch: false });
    if (!(await LP.enabled())) toast('リンク情報の取得には同期のログインが必要です');
    else LP.resolvePending();
  }
  if (choice === 'delete') {
    if (!confirm('この投稿を削除しますか？')) return;
    await P.deletePost(id);
    toast('削除しました');
    if (route.name === 'post' && route.params.id === id) history.back();
  }
}

document.addEventListener('click', e => {
  if (e.target.closest('#overlay-root')) return;
  if (e.target.closest('.kb-catch')) return; // 透明な入力欄（focusin で処理済み）
  const a = e.target.closest('a');
  const act = e.target.closest('[data-act]');
  if (a) {
    if (act?.dataset.act === 'open') e.stopPropagation();
    return; // リンクは通常どおり
  }
  if (!act) return;
  const id = act.dataset.id;
  switch (act.dataset.act) {
    case 'open':
      if (getSelection()?.toString()) return; // テキスト選択中は開かない
      if (route.name === 'post' && route.params.id === id) return;
      go(`#/post/${id}`);
      break;
    case 'like': {
      e.stopPropagation();
      const on = !act.classList.contains('on');
      act.classList.toggle('on', on);
      act.classList.remove('pop'); void act.offsetWidth;
      if (on) act.classList.add('pop');
      skipRender.add(id);
      P.toggleLike(id);
      break;
    }
    case 'reply':
      e.stopPropagation();
      if (route.name === 'post' && route.params.id === id) $('.reply-box textarea')?.focus();
      else openComposer({ parentId: id });
      break;
    case 'quote':
      e.stopPropagation();
      openComposer({ quoteId: id });
      break;
    case 'tree': // 返信ツリーの折りたたみ
      e.stopPropagation();
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      softRender();
      break;
    case 'to-quotes':
      e.stopPropagation();
      $('#quotes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    case 'more':
      e.stopPropagation();
      postMenu(id);
      break;
    case 'img':
      e.stopPropagation();
      openViewer(id, +act.dataset.idx);
      break;
    case 'profile':
      e.stopPropagation();
      go('#/profile');
      break;
  }
});

// =====================================================================
// 画面
// =====================================================================
function setChrome({ title, subtitle = '', back = false, fab = true, tab = null }) {
  $('#title').innerHTML = subtitle
    ? `<span class="topbar-title">${esc(title)}<small>${esc(subtitle)}</small></span>` : esc(title);
  const left = $('#topLeft');
  if (back) {
    left.innerHTML = I.back;
    left.className = 'icon-btn back-btn';
    left.setAttribute('aria-label', '戻る');
    left.onclick = () => (history.length > 1 ? history.back() : go('#/home'));
  } else {
    left.innerHTML = avatarHtml('sm');
    left.className = 'icon-btn';
    left.setAttribute('aria-label', 'プロフィール');
    left.onclick = () => go('#/profile');
  }
  $('#fab').hidden = !fab;
  $$('#tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
}

// ---------- ホーム ----------
async function renderHome({ keepScroll = false, restoreY = null } = {}) {
  setChrome({ title: 'ホーム', tab: 'home', fab: !wide.matches });
  const y = scrollY;
  const n = Math.max(40, home.items.length);
  home.items = await db.pagePosts({ limit: n });
  home.done = home.items.length < n;
  const body = home.items.length ? await listHtml(home.items)
    : `<div class="empty"><h2>ようこそ</h2><p>思いついたことを、つぶやくようにメモしましょう。<br>投稿はこの端末に保存され、オフラインでも使えます。</p>
       ${wide.matches ? '' : `<span class="kb-wrap"><button class="btn" id="firstPost">最初の投稿をする</button>${kbCatch('new')}</span>`}</div>`;
  const hasComposer = !!$('#inlineComposer');
  if (keepScroll && $('#list') && hasComposer === wide.matches) {
    // 入力中のフォームは残して一覧だけ差し替える
    $('#list').innerHTML = body;
    $('#more').textContent = home.done ? '' : '読み込み中…';
  } else {
    view.innerHTML = `${wide.matches ? `<div id="inlineComposer">${composerHtml()}</div>` : ''}<div id="list">${body}</div>
      <div class="loading-more" id="more">${home.done ? '' : '読み込み中…'}</div>`;
    if (wide.matches) {
      const text = await db.getMeta('draft', '') || '';
      mountComposer($('#inlineComposer'), { text, draftKey: 'draft' });
    }
  }
  $('#firstPost')?.addEventListener('click', () => openComposer());
  if (keepScroll) scrollTo(0, y);
  else if (restoreY) scrollTo(0, restoreY);
  hydrateImages();
  observeMore();
}

let io;
function observeMore() {
  io?.disconnect();
  const el = $('#more');
  if (!el || home.done) return;
  io = new IntersectionObserver(async ents => {
    if (!ents[0].isIntersecting || home.loading || home.done) return;
    home.loading = true;
    const last = home.items[home.items.length - 1];
    const next = await db.pagePosts({ before: last?.createdAt, limit: 40 });
    home.items.push(...next);
    home.done = next.length < 40;
    $('#list').insertAdjacentHTML('beforeend', await listHtml(next));
    if (home.done) el.textContent = '';
    home.loading = false;
    hydrateImages();
  }, { rootMargin: '600px' });
  io.observe(el);
}

// ---------- 検索 ----------
async function renderSearch(params) {
  setChrome({ title: '検索', tab: 'search' });
  const q = params.q || '';
  const day = params.day || '';
  if (!$('#searchInput')) {
    view.innerHTML = `<div class="searchbar">
      <label class="field">${I.search}<input id="searchInput" type="search" placeholder="キーワード・#タグ" enterkeyhint="search" autocomplete="off"></label>
      <input id="searchDay" type="date" aria-label="日付で絞り込み">
    </div><div id="results"></div>`;
    const input = $('#searchInput'), dayInput = $('#searchDay');
    const update = debounce(() => {
      const qs = new URLSearchParams();
      if (input.value) qs.set('q', input.value);
      if (dayInput.value) qs.set('day', dayInput.value);
      const hash = `#/search${qs.toString() ? '?' + qs : ''}`;
      history.replaceState(null, '', hash);
      route = parseRoute();
      renderSearchResults(input.value, dayInput.value);
    }, 250);
    input.addEventListener('input', update);
    dayInput.addEventListener('change', update);
  }
  $('#searchInput').value = q;
  $('#searchDay').value = day;
  await renderSearchResults(q, day);
}

async function renderSearchResults(q, day) {
  const box = $('#results');
  if (!box) return;
  if (!q.trim() && !day) {
    const tags = await P.tagStats();
    box.innerHTML = tags.length
      ? `<div class="section-title">ハッシュタグ</div><div class="chips">${tags.map(([t, n]) =>
          `<a class="chip" href="#/search?q=${encodeURIComponent('#' + t)}">#${esc(t)}<small>${n}</small></a>`).join('')}</div>`
      : `<div class="empty"><p>キーワードや <b>#タグ</b>、日付で投稿を探せます。</p></div>`;
    return;
  }
  const results = await P.search({ q, day: day || null });
  box.innerHTML = `<div class="result-count">${results.length} 件</div>` +
    (results.length ? await listHtml(results.slice(0, 300)) : '<div class="empty"><p>見つかりませんでした</p></div>');
  hydrateImages(box);
}

// ---------- いいね ----------
async function renderLikes() {
  setChrome({ title: 'いいね', tab: 'likes' });
  const list = await P.search({ likedOnly: true });
  view.innerHTML = list.length ? await listHtml(list)
    : `<div class="empty"><h2>いいねした投稿</h2><p>ハートを押した投稿がここに集まります。</p></div>`;
  hydrateImages();
}

// ---------- 投稿の詳細（スレッド） ----------
// 返信ツリーで折りたたんだ投稿の id
const collapsed = new Set();
const TREE_MAX_INDENT = 4; // これより深い返信は、字下げせずに並べる（スマホの幅に収めるため）

// 返信ツリーを入れ子の HTML にする
function treeHtml(nodes, ctx, depth = 0) {
  return nodes.map(({ post, children }) => {
    const hasKids = children.length > 0;
    const isClosed = collapsed.has(post.id);
    const cls = ['tree-post', depth ? 'nested' : '', hasKids ? 'has-kids' : ''].join(' ');
    const branch = !hasKids ? '' : `
      <div class="tbranch${depth + 1 >= TREE_MAX_INDENT ? ' flat' : ''}">
        <button class="tree-toggle" data-act="tree" data-id="${esc(post.id)}">${isClosed
          ? `${I.chevR}<span>返信 ${P.countTree(children)}件を表示</span>`
          : `${I.chevD}<span>返信を折りたたむ</span>`}</button>
        ${isClosed ? '' : treeHtml(children, ctx, depth + 1)}
      </div>`;
    return `<div class="tnode${depth ? '' : ' top'}">
      ${postHtml(post, { ...ctx, cls, showReplyTo: false, avatarCls: depth ? 'sm' : '' })}
      ${branch}
    </div>`;
  }).join('');
}

async function renderPost(id) {
  setChrome({ title: 'ポスト', back: true, fab: false });
  const t = await P.getThread(id);
  if (!t || t.post.deleted) {
    view.innerHTML = `<div class="empty"><h2>投稿が見つかりません</h2><p>削除された可能性があります。</p></div>`;
    return;
  }
  const visibleAnc = t.ancestors.filter(a => !a.deleted);
  const tree = await P.getReplyTree(id);
  const quotes = await P.quotesOf(id);
  const ctx = await buildCtx([...visibleAnc, t.post, ...quotes]);
  const totalReplies = P.countTree(tree);
  const stats = totalReplies || quotes.length ? `<div class="stats">
      ${totalReplies ? `<span><b>${totalReplies}</b> 件の返信</span>` : ''}
      ${quotes.length ? `<button data-act="to-quotes"><b>${quotes.length}</b> 件の引用</button>` : ''}
    </div>` : '';
  const same = view.dataset.postId === id;
  const oldBox = same ? $('.reply-box') : null;
  view.dataset.postId = id;
  view.innerHTML = `
    ${visibleAnc.map(a => postHtml(a, { ...ctx, cls: 'thread-parent', showReplyTo: false })).join('')}
    ${mainPostHtml(t.post, { ...ctx, stats })}
    <div class="reply-box">${composerHtml({ placeholder: '返信を書く', submitLabel: '返信' })}</div>
    <div id="replies" class="tree">${treeHtml(tree, ctx)}</div>
    ${quotes.length ? `<div id="quotes"><div class="section-label">${I.repost}このポストを引用したポスト</div>${quotes.map(q => postHtml(q, ctx)).join('')}</div>` : ''}`;
  if (oldBox) $('.reply-box').replaceWith(oldBox); // 入力中の返信フォームを維持
  else mountComposer($('.reply-box'), { parentId: id, onDone: () => toast('返信しました') });
  hydrateImages();
  if (visibleAnc.length && !same) $('.post.main').scrollIntoView({ block: 'start' });
}

// ---------- 設定 ----------
async function renderSettings() {
  setChrome({ title: '設定', tab: 'settings', fab: false });
  const st = sync.getStatus();
  const cfg = sync.getConfig();
  const look = await getLook();
  const lpOn = await db.getMeta('pref.linkPreview', true);
  const lastBackup = await db.getMeta('backup.lastAt', null);
  const count = await db.countPosts();
  let est = null, persisted = null;
  try { est = await navigator.storage?.estimate?.(); persisted = await navigator.storage?.persisted?.(); } catch {}

  const stateLabel = syncStateLabel(st.state);

  let syncBody;
  if (!cfg) {
    syncBody = `<div class="stack">
      <label for="sUrl">Project URL</label><input id="sUrl" type="url" placeholder="https://xxxx.supabase.co" autocomplete="off" autocapitalize="off">
      <label for="sKey">Publishable key（anon key）</label><input id="sKey" type="text" placeholder="sb_publishable_… または eyJ…" autocomplete="off" autocapitalize="off">
      <div class="btns"><button class="btn sm" id="sSave">保存</button></div>
    </div>`;
  } else if (!st.email) {
    syncBody = `<div class="row"><div class="label">サーバー<small>${esc(cfg.url)}</small></div></div>
    <div class="stack">
      <label for="sEmail">メールアドレス</label><input id="sEmail" type="email" autocomplete="username" autocapitalize="off">
      <label for="sPass">パスワード</label><input id="sPass" type="password" autocomplete="current-password">
      <div class="btns"><button class="btn sm" id="sLogin">ログイン</button><button class="btn sm ghost" id="sSignup">新規登録</button></div>
    </div>
    <button class="row danger" id="sForget"><span class="label">サーバー設定を解除</span></button>`;
  } else {
    syncBody = `<div class="row"><div class="label">アカウント<small>${esc(st.email)}</small></div></div>
    <div class="row"><div class="label">最終同期<small id="sLast">${syncLastText(st)}</small></div>
      <button class="btn sm" id="sNow">今すぐ同期</button></div>
    <button class="row" id="sLogout"><span class="label">ログアウト</span></button>`;
  }

  view.innerHTML = `<div class="settings">
    <div class="group"><h3>プロフィール</h3><div class="box">
      <a class="row" href="#/profile" style="color:inherit">${avatarHtml('sm')}<span class="label">${esc(profile.name)}<small>@${esc(profile.handle)}</small></span><span class="value">表示・編集 ›</span></a>
    </div></div>

    <div class="group" id="sync"><h3>同期</h3><div class="box">
      <div class="row"><div class="status-line"><i class="${esc(st.state)}"></i><span>${esc(stateLabel)}</span></div></div>
      <div class="row" id="sErr"${st.state === 'error' && st.message ? '' : ' hidden'}><div class="label" style="color:var(--danger);font-size:13px">${esc(st.message || '')}</div></div>
      ${syncBody}
    </div><p class="hint">Supabase（無料枠あり）を使って PC など他の端末と同期します。設定しなくても、この端末だけでオフラインで使えます。</p></div>

    <div class="group"><h3>リンクの埋め込み</h3><div class="box">
      <div class="row"><div class="label">リンク先の情報を表示<small>Web ページや X の投稿をカードで表示します。同期にログインしている時だけ取得します。</small></div>
        <label class="toggle"><input type="checkbox" id="lpToggle" ${lpOn ? 'checked' : ''}><span></span></label></div>
    </div></div>

    <div class="group"><h3>表示</h3><div class="box">
      <div class="row"><div class="label">テーマ</div><div class="seg" data-look="theme">
        ${[['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']].map(([v, l]) => `<button data-v="${v}" class="${look.theme === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="row"><div class="label">アクセント</div><div class="swatches" data-look="accent">
        ${[['blue', '#1f8fe5'], ['green', '#17a36b'], ['orange', '#f07a1a'], ['purple', '#7b5cf0'], ['pink', '#e8458b']].map(([v, c]) =>
          `<button class="swatch ${look.accent === v ? 'on' : ''}" data-v="${v}" style="background:${c}" aria-label="${v}"></button>`).join('')}</div></div>
      <div class="row"><div class="label">アイコンの形</div><div class="seg" data-look="avatar">
        ${[['square', '四角'], ['circle', '丸']].map(([v, l]) => `<button data-v="${v}" class="${look.avatar === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="row"><div class="label">文字サイズ</div><div class="seg" data-look="font">
        ${[['s', '小'], ['m', '中'], ['l', '大']].map(([v, l]) => `<button data-v="${v}" class="${look.font === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    </div></div>

    <div class="group"><h3>バックアップ</h3><div class="box">
      <button class="row" id="bCsv"><span class="label">CSV で書き出す<small>表計算ソフトで開けます（画像は含みません）</small></span></button>
      <button class="row" id="bJson"><span class="label">完全バックアップ（JSON）<small>画像も含めて書き出します。復元に使えます</small></span></button>
      <button class="row" id="bImport"><span class="label">バックアップから読み込む<small>JSON / CSV に対応。同じ投稿は新しい方を残します</small></span></button>
      <input type="file" id="bFile" accept=".json,.csv,application/json,text/csv" hidden>
      <div class="row"><div class="label">前回のバックアップ</div><span class="value">${lastBackup ? esc(fullTime(lastBackup)) : 'なし'}</span></div>
    </div></div>

    <div class="group"><h3>ストレージ</h3><div class="box">
      <div class="row"><div class="label">投稿数</div><span class="value">${count.toLocaleString()} 件</span></div>
      <div class="row"><div class="label">使用量</div><span class="value">${est ? `${formatBytes(est.usage)}` : '-'}</span></div>
      <div class="row"><div class="label">自動削除からの保護<small>ホーム画面に追加して使うと保護されやすくなります</small></div><span class="value">${persisted ? '有効' : '未確定'}</span></div>
    </div></div>

    <div class="group"><h3>アプリ</h3><div class="box">
      <div class="row"><div class="label">バージョン</div><span class="value">${APP_VERSION}</span></div>
      <button class="row" id="aUpdate"><span class="label">アップデートを確認</span></button>
      <button class="row danger" id="aWipe"><span class="label">この端末のデータをすべて削除</span></button>
    </div></div>
  </div>`;

  bindSettings();
  if (location.hash.includes('sync-focus')) $('#sync').scrollIntoView();
}

function syncStateLabel(state) {
  return {
    off: '未設定（この端末のみに保存）', 'signed-out': 'ログインしていません', idle: '同期済み',
    syncing: '同期中…', error: 'エラー', offline: 'オフライン（接続時に同期します）',
  }[state] || state;
}
function syncLastText(st) {
  return `${st.lastSyncAt ? esc(fullTime(st.lastSyncAt)) : '-'}${st.pending ? ` ・未送信 ${st.pending} 件` : ''}`;
}
// 入力中のフォームを壊さないよう、状態表示だけ書き換える
function updateSettingsStatus(st) {
  const line = $('#sync .status-line');
  if (!line) return;
  line.innerHTML = `<i class="${esc(st.state)}"></i><span>${esc(syncStateLabel(st.state))}</span>`;
  const err = $('#sErr');
  if (err) {
    err.hidden = !(st.state === 'error' && st.message);
    err.firstElementChild.textContent = st.message || '';
  }
  const last = $('#sLast');
  if (last) last.innerHTML = syncLastText(st);
}

function bindSettings() {
  const on = (sel, ev, fn) => $(sel)?.addEventListener(ev, fn);
  const withBusy = fn => async e => {
    const b = e.currentTarget; b.disabled = true;
    try { await fn(e); } catch (err) { toast(err.message); } finally { b.disabled = false; }
  };

  // 同期
  on('#sSave', 'click', withBusy(async () => {
    await sync.configure($('#sUrl').value, $('#sKey').value);
    toast('保存しました。ログインしてください');
    renderSettings();
  }));
  on('#sLogin', 'click', withBusy(async () => {
    await sync.signIn($('#sEmail').value.trim(), $('#sPass').value);
    toast('ログインしました');
    renderSettings();
    LP.resolvePending();
  }));
  on('#sSignup', 'click', withBusy(async () => {
    const r = await sync.signUp($('#sEmail').value.trim(), $('#sPass').value);
    if (r === 'confirm-email') toast('確認メールを送りました。リンクを開いてからログインしてください');
    else { toast('登録しました'); renderSettings(); }
  }));
  on('#sForget', 'click', async () => {
    if (!confirm('サーバー設定を解除しますか？（この端末の投稿は残ります）')) return;
    await sync.removeConfig(); renderSettings();
  });
  on('#sNow', 'click', withBusy(async () => { await sync.syncNow(); await LP.resolvePending(); renderSettings(); }));
  on('#sLogout', 'click', async () => {
    if (!confirm('ログアウトしますか？（この端末の投稿は残ります）')) return;
    await sync.signOut(); renderSettings();
  });

  on('#lpToggle', 'change', async e => {
    await db.setMeta('pref.linkPreview', e.target.checked);
    if (e.target.checked) LP.resolvePending();
  });

  // 表示
  $$('[data-look]').forEach(group => group.addEventListener('click', async e => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    const look = await getLook();
    look[group.dataset.look] = b.dataset.v;
    await setLook(look);
    renderSettings();
  }));

  // バックアップ
  on('#bCsv', 'click', withBusy(async () => { const n = await backup.exportCsv(); toast(`${n} 件を書き出しました`); }));
  on('#bJson', 'click', withBusy(async () => { const r = await backup.exportJson(); toast(`${r.posts} 件・画像 ${r.images} 枚を書き出しました`); }));
  on('#bImport', 'click', () => $('#bFile').click());
  on('#bFile', 'change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      if (/\.csv$/i.test(f.name) || f.type.includes('csv')) {
        const n = await backup.importCsv(f);
        toast(`${n} 件を読み込みました`);
      } else {
        const r = await backup.importJson(f);
        toast(`${r.posts} 件・画像 ${r.images} 枚を読み込みました`);
      }
      profile = await db.getMeta('profile', profile);
      renderSettings();
    } catch (err) { toast('読み込めませんでした: ' + err.message); }
  });

  on('#aUpdate', 'click', async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return toast('オフライン機能が有効になっていません');
    await reg.update().catch(() => {});
    if (reg.waiting || reg.installing) toast('新しいバージョンを準備しています…');
    else toast('最新版です');
  });
  on('#aWipe', 'click', async () => {
    if (!confirm('この端末のすべての投稿・画像・設定を削除します。\n（同期済みのデータはサーバーに残ります）')) return;
    if (!confirm('本当に削除しますか？元に戻せません。')) return;
    await sync.removeConfig().catch(() => {});
    await db.clearAll();
    try { localStorage.clear(); } catch {}
    location.reload();
  });
}

// ---------- プロフィール ----------
const PF_TABS = [['posts', 'ポスト'], ['replies', '返信'], ['media', 'メディア'], ['likes', 'いいね']];
const PF_FILTERS = {
  posts: p => !p.parentId,
  replies: p => !!p.parentId,
  media: p => (p.images || []).length > 0,
  likes: p => !!p.liked,
};
const PF_EMPTY = {
  posts: 'まだポストがありません', replies: 'まだ返信がありません',
  media: '画像つきのポストがここに表示されます', likes: 'いいねしたポストがここに表示されます',
};

// 入力された Web サイトを安全なリンクにする
function websiteLink(w) {
  const raw = (w || '').trim();
  if (!raw) return '';
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try { new URL(url); } catch { return esc(raw); }
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${I.link}${esc(raw.replace(/^https?:\/\//i, '').replace(/\/$/, ''))}</a>`;
}

async function renderProfile(params) {
  const tab = PF_FILTERS[params.tab] ? params.tab : 'posts';
  const all = (await db.allPosts()).filter(p => !p.deleted).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const list = all.filter(PF_FILTERS[tab]);
  const since = profile.since || all[all.length - 1]?.createdAt || new Date().toISOString();
  const d = new Date(since);
  setChrome({ title: profile.name, subtitle: `${all.length.toLocaleString()} 件のポスト`, back: true });

  const banner = profile.banner ? ` style="background-image:url('${profile.banner}')"` : '';
  const body = list.length ? await listHtml(list.slice(0, 200)) : `<div class="empty"><p>${PF_EMPTY[tab]}</p></div>`;
  view.innerHTML = `
    <div class="pf-banner"${banner}></div>
    <div class="pf-top">${avatarHtml()}<button class="btn ghost sm" id="pfEdit">プロフィールを編集</button></div>
    <div class="pf-info">
      <h2>${esc(profile.name)}</h2>
      <div class="handle">@${esc(profile.handle)}</div>
      ${profile.bio ? `<p class="bio">${renderText(profile.bio)}</p>` : ''}
      <div class="pf-meta">
        ${profile.location ? `<span>${I.pin}${esc(profile.location)}</span>` : ''}
        ${websiteLink(profile.website)}
        <span>${I.calendar}${d.getFullYear()}年${d.getMonth() + 1}月から利用しています</span>
      </div>
      <div class="pf-stats">
        <span><b>${all.filter(PF_FILTERS.posts).length.toLocaleString()}</b>ポスト</span>
        <span><b>${all.filter(PF_FILTERS.media).length.toLocaleString()}</b>メディア</span>
        <span><b>${all.filter(PF_FILTERS.likes).length.toLocaleString()}</b>いいね</span>
      </div>
    </div>
    <nav class="pf-tabs">${PF_TABS.map(([k, l]) =>
      `<a href="#/profile${k === 'posts' ? '' : `?tab=${k}`}" class="${k === tab ? 'on' : ''}"><span>${l}</span></a>`).join('')}</nav>
    <div id="pfList">${body}</div>`;
  $('#pfEdit').addEventListener('click', openProfileEditor);
  hydrateImages();
}

// Twitter 風の「プロフィールを編集」画面
function openProfileEditor() {
  const draft = { ...profile };
  const original = JSON.stringify(profile);
  const field = (key, label, max, multiline = false) => `
    <div class="fbox">
      <label for="pe-${key}">${label}</label>
      <span class="cnt" data-cnt="${key}"></span>
      ${multiline
        ? `<textarea id="pe-${key}" data-k="${key}" maxlength="${max}" rows="3">${esc(draft[key] || '')}</textarea>`
        : `<input id="pe-${key}" data-k="${key}" maxlength="${max}" value="${esc(draft[key] || '')}" ${key === 'handle' || key === 'website' ? 'autocapitalize="off" autocorrect="off"' : ''}>`}
    </div>`;
  const o = openOverlay(`<div class="backdrop"></div><div class="modal" role="dialog" aria-label="プロフィールを編集">
    <div class="modal-head">
      <button class="icon-btn x" data-pe="close" aria-label="閉じる">${I.close}</button>
      <span class="title">プロフィールを編集</span>
      <button class="btn sm" data-pe="save">保存</button>
    </div>
    <div class="modal-body">
      <div class="pe-banner"><div class="pe-btns"></div></div>
      <div class="pe-avatar-wrap"></div>
      <input type="file" accept="image/*" hidden data-file="banner">
      <input type="file" accept="image/*" hidden data-file="avatar">
      <div class="pe-fields">
        ${field('name', '名前', 50)}
        ${field('handle', 'ユーザー名', 30)}
        ${field('bio', '自己紹介', 160, true)}
        ${field('location', '場所', 30)}
        ${field('website', 'ウェブサイト', 100)}
      </div>
    </div></div>`);
  $('.backdrop', o.el).replaceWith($('.backdrop', o.el).cloneNode()); // 背景タップで閉じない

  // 画像部分の描き直し
  const paint = () => {
    const b = $('.pe-banner', o.el);
    b.style.backgroundImage = draft.banner ? `url('${draft.banner}')` : '';
    $('.pe-btns', o.el).innerHTML = `<button class="pe-cam" data-pe="banner" aria-label="ヘッダー画像を変更">${I.camera}</button>` +
      (draft.banner ? `<button class="pe-cam" data-pe="banner-rm" aria-label="ヘッダー画像を削除">${I.close}</button>` : '');
    $('.pe-avatar-wrap', o.el).innerHTML = avatarHtml('', draft) +
      `<button class="pe-cam" data-pe="avatar" aria-label="アイコン画像を変更">${I.camera}</button>`;
  };
  const counts = () => $$('[data-k]', o.el).forEach(inp => {
    $(`[data-cnt="${inp.dataset.k}"]`, o.el).textContent = `${Array.from(inp.value).length} / ${inp.maxLength}`;
  });
  paint(); counts();

  const close = () => {
    const now = JSON.stringify({ ...draft, ...readFields() });
    if (now !== original && !confirm('変更を破棄しますか？')) return;
    o.close();
  };
  const readFields = () => Object.fromEntries($$('[data-k]', o.el).map(i => [i.dataset.k, i.value.trim()]));

  o.el.addEventListener('input', e => {
    if (e.target.dataset.k === 'name' && !draft.avatar) { draft.name = e.target.value; paint(); }
    counts();
  });
  o.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-pe]');
    if (!b) return;
    const act = b.dataset.pe;
    if (act === 'close') close();
    if (act === 'banner' || act === 'avatar') $(`[data-file="${act}"]`, o.el).click();
    if (act === 'banner-rm') { draft.banner = null; paint(); }
    if (act === 'save') {
      const f = readFields();
      Object.assign(draft, f, {
        name: f.name || '自分',
        handle: f.handle.replace(/^@/, '').replace(/\s+/g, '') || 'me',
      });
      await saveProfile(draft);
      o.close();
      toast('プロフィールを保存しました');
      render({ soft: true });
    }
  });
  $$('[data-file]', o.el).forEach(input => input.addEventListener('change', async () => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    try {
      const isBanner = input.dataset.file === 'banner';
      const { blob } = await compressImage(f, isBanner ? 1500 : 400, 0.85);
      draft[isBanner ? 'banner' : 'avatar'] = await blobToDataUrl(blob);
      paint();
    } catch (err) { toast(err.message); }
  }));
}

// ---------- 引っ張って更新 ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ptr = (() => {
  const el = document.createElement('div');
  el.id = 'ptr';
  el.innerHTML = I.arrowDown;
  document.body.appendChild(el);
  const TH = 64;    // これ以上引っ張って離すと更新
  const MAX = 110;  // 引っ張れる最大距離
  let startY = null, dist = 0, busy = false;

  const enabled = () => ['home', 'profile'].includes(route.name) && !busy && scrollY <= 0 && !overlayRoot.children.length;
  function paint(d, animate) {
    el.classList.toggle('animate', animate);
    view.classList.toggle('ptr-animate', animate);
    view.style.transform = d ? `translateY(${d}px)` : '';
    el.style.opacity = Math.min(1, d / TH);
    el.style.transform = `translateY(${Math.min(d, TH) * 0.9 - 50}px)`;
  }

  addEventListener('touchstart', e => {
    if (!enabled() || e.touches.length > 1) return;
    startY = e.touches[0].clientY;
    dist = 0;
  }, { passive: true });

  addEventListener('touchmove', e => {
    if (startY == null) return;
    if (scrollY > 0) { startY = null; return; }
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) { if (dist) { dist = 0; paint(0); } return; }
    if (e.cancelable) e.preventDefault(); // ページ自体が伸びるのを止める
    dist = Math.min(MAX, dy * 0.5);       // 指より少し重く動かす
    el.classList.toggle('ready', dist >= TH);
    paint(dist, false);
  }, { passive: false });

  const end = () => {
    if (startY == null) return;
    startY = null;
    if (dist >= TH) refresh();
    else paint(0, true);
    dist = 0;
  };
  addEventListener('touchend', end);
  addEventListener('touchcancel', end);

  async function refresh() {
    if (busy) return;
    busy = true;
    el.classList.remove('ready');
    el.innerHTML = I.sync;
    el.classList.add('spinning');
    paint(56, true);
    el.style.transform = 'translateY(10px)';
    el.style.opacity = 1;
    const t0 = Date.now();
    const st = sync.getStatus();
    if (st.configured && st.email && navigator.onLine) {
      await sync.syncNow();
      LP.resolvePending();
    }
    // 一瞬で終わっても「更新した感」が出るよう少し待つ
    const rest = 900 - (Date.now() - t0);
    if (rest > 0) await sleep(rest);
    await render({ soft: true });
    el.classList.remove('spinning');
    paint(0, true);
    await sleep(260);
    el.innerHTML = I.arrowDown;
    el.classList.remove('animate');
    view.classList.remove('ptr-animate');
    busy = false;
  }
  return { refresh };
})();

// ---------- 見た目 ----------
async function getLook() {
  return { theme: 'auto', accent: 'blue', font: 'm', avatar: 'square', ...(await db.getMeta('pref.look', {})) };
}
async function setLook(look) {
  await db.setMeta('pref.look', look);
  applyLook(look);
}
function applyLook(look) {
  const h = document.documentElement;
  h.dataset.theme = look.theme; h.dataset.accent = look.accent; h.dataset.font = look.font; h.dataset.avatar = look.avatar;
  try { localStorage.setItem('hitokoto-look', JSON.stringify(look)); } catch {}
}

// ---------- 同期ボタン ----------
function renderSyncBtn(st = sync.getStatus()) {
  const b = $('#syncBtn');
  const state = st.configured ? st.state : 'off';
  b.dataset.state = state;
  b.innerHTML = (state === 'off' || state === 'offline' || state === 'signed-out' ? I.cloudOff : state === 'syncing' ? I.sync : I.cloud) +
    (st.pending && st.email ? '<span class="dot"></span>' : '');
  b.title = { off: '同期は未設定です', 'signed-out': 'ログインしていません', idle: '同期済み', syncing: '同期中', error: '同期エラー', offline: 'オフライン' }[state] || '';
}
$('#syncBtn').addEventListener('click', async () => {
  const st = sync.getStatus();
  if (!st.configured || !st.email) return go('#/settings');
  if (!navigator.onLine) return toast('オフラインです。接続時に自動で同期します');
  await sync.syncNow();
  const s2 = sync.getStatus();
  toast(s2.state === 'error' ? `同期エラー: ${s2.message}` : '同期しました');
});

// =====================================================================
// ルーティング
// =====================================================================
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '') || 'home';
  const [path, qs] = h.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  const [name, id] = path.split('/');
  if (name === 'post' && id) return { name: 'post', params: { id } };
  if (['home', 'search', 'likes', 'settings', 'profile'].includes(name)) return { name, params };
  return { name: 'home', params: {} };
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

async function render({ soft = false } = {}) {
  const prev = route;
  route = parseRoute();
  const moved = prev.name !== route.name || prev.params.id !== route.params.id;
  if (!soft && moved) {
    if (prev.name === 'home') home.y = scrollY;
    if (route.name !== 'search') view.innerHTML = '';
    scrollTo(0, 0);
  }
  if (route.name !== 'post') delete view.dataset.postId;
  switch (route.name) {
    case 'home': return renderHome({ keepScroll: soft || !moved, restoreY: moved ? home.y : null });
    case 'search': return renderSearch(route.params);
    case 'likes': return renderLikes();
    case 'post': return renderPost(route.params.id);
    case 'settings': return renderSettings();
    case 'profile': return renderProfile(route.params);
  }
}

window.addEventListener('hashchange', () => render());
// 表示中のタブをもう一度押すと先頭へ
$('#tabbar').addEventListener('click', e => {
  const a = e.target.closest('a[data-tab]');
  if (!a || a.dataset.tab !== route.name) return;
  e.preventDefault();
  // 先頭にいるときにホームを押すと更新（Twitter と同じ動き）
  if (route.name === 'home' && scrollY < 5) ptr.refresh();
  else scrollTo({ top: 0, behavior: 'smooth' });
});

// 変更があれば画面を更新（スクロール位置は維持）
const softRender = debounce(async () => {
  if (overlayRoot.querySelector('.modal')) { pendingSoft = true; return; }
  if (route.name === 'settings') return;
  const y = scrollY;
  if (route.name === 'search') await renderSearchResults($('#searchInput')?.value || '', $('#searchDay')?.value || '');
  else await render({ soft: true });
  scrollTo(0, y);
}, 120);
let pendingSoft = false;
new MutationObserver(() => {
  if (pendingSoft && !overlayRoot.querySelector('.modal')) { pendingSoft = false; softRender(); }
}).observe(overlayRoot, { childList: true });

P.bus.addEventListener('posts-changed', e => {
  const { ids = [], remote } = e.detail || {};
  const onlyLikes = ids.length && ids.every(id => skipRender.has(id));
  ids.forEach(id => skipRender.delete(id));
  if (!remote) { sync.scheduleSync(); sync.refreshPending(); LP.resolvePending(); }
  if (onlyLikes && route.name !== 'likes') return;
  softRender();
});
P.bus.addEventListener('profile-changed', async () => {
  profile = { ...DEFAULT_PROFILE, ...(await db.getMeta('profile', {})) };
  softRender();
});
let lastSyncState = null;
P.bus.addEventListener('sync-status', e => {
  renderSyncBtn(e.detail);
  if (route.name === 'settings') updateSettingsStatus(e.detail);
  // 同期が終わったら、未取得のリンク情報を取りに行く
  if (e.detail.state === 'idle' && lastSyncState === 'syncing') LP.resolvePending();
  lastSyncState = e.detail.state;
});

// 相対時刻を定期更新
setInterval(() => {
  $$('time[data-t]').forEach(t => { t.textContent = relTime(t.dataset.t); });
}, 60 * 1000);

// =====================================================================
// 起動
// =====================================================================
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const prompt = w => toast('新しいバージョンがあります', { label: '更新', run: () => w.postMessage('skipWaiting') });
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(e => console.warn('SW registration failed', e));
  // 更新ボタンで新しい版に切り替わったときだけ再読み込み（初回インストール時はしない）
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
}

async function boot() {
  const stored = await db.getMeta('profile', null);
  if (stored && !stored.updatedAt) {
    // v1.1 以前に編集したプロフィール：同期できるよう日時を付けて送信待ちにする
    await db.setMeta('profile', { ...stored, updatedAt: new Date().toISOString() });
    await db.setMeta('profile.dirty', true);
  }
  profile = { ...DEFAULT_PROFILE, ...(await db.getMeta('profile', {})) };
  applyLook(await getLook());
  $('#fab').insertAdjacentHTML('beforeend', kbCatch('new'));
  $('#fab').addEventListener('click', e => {
    if (e.target.closest('.kb-catch')) return; // 透明な入力欄から開いた場合
    openComposer();
  });
  $('#fab').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openComposer(); }
  });
  wide.addEventListener('change', () => route.name === 'home' && renderHome());
  await render();
  renderSyncBtn();
  await sync.init();
  sync.refreshPending();
  LP.resolvePending();

  window.addEventListener('online', () => { sync.syncNow(); LP.resolvePending(); softRender(); });
  window.addEventListener('offline', () => renderSyncBtn());
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const last = sync.getStatus().lastSyncAt;
    if (!last || Date.now() - new Date(last) > 30 * 1000) sync.syncNow();
  });
  setInterval(() => { if (document.visibilityState === 'visible') sync.syncNow(); }, 5 * 60 * 1000);

  // 端末のストレージを消されにくくする
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {}
  registerSW();
}

boot();

// デバッグ・テスト用
window.hitokoto = { db, P, sync, LP, backup, APP_VERSION };
