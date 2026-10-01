// Service Worker：アプリ本体をキャッシュしてオフラインで起動できるようにする
// アプリを更新したら VERSION を変えること（キャッシュが入れ替わる）
const VERSION = 'v1.2.0';
const CACHE = `hitokoto-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/posts.js',
  './js/sync.js',
  './js/linkpreview.js',
  './js/backup.js',
  './js/util.js',
  './vendor/supabase.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('hitokoto-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Supabase やリンク先はそのまま通す

  // ページ遷移はキャッシュの index.html を返す（オフライン起動）
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cached = await caches.match('./index.html', { ignoreSearch: true });
      return cached || fetch(req);
    })());
    return;
  }

  // それ以外はキャッシュ優先
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const c = await caches.open(CACHE);
      c.put(req, res.clone());
    }
    return res;
  })());
});
