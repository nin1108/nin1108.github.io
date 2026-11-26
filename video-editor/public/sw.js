// オフライン対応用 Service Worker
// - ビルド時に生成される precache.json のファイルをインストール時にキャッシュ
// - ページ: ネットワーク優先 (失敗時キャッシュ)
// - 静的アセット: キャッシュ優先
// - Google Fonts: キャッシュ優先 + 裏で更新
const FONT_CACHE = 'mve-fonts-v1';
let APP_CACHE = 'mve-app';

async function manifest() {
  const res = await fetch('./precache.json', { cache: 'no-store' });
  return res.json();
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const m = await manifest();
        APP_CACHE = 'mve-app-' + m.version;
        const cache = await caches.open(APP_CACHE);
        await cache.addAll(['./', ...m.files.map((f) => './' + f)]);
      } catch (e) {
        // 開発環境 (precache.json なし) では何もしない
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const m = await manifest();
        APP_CACHE = 'mve-app-' + m.version;
      } catch (e) {
        /* */
      }
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('mve-app-') && k !== APP_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(FONT_CACHE);
        const hit = await cache.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })(),
    );
    return;
  }
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => {
        const hit = await caches.match('./', { ignoreSearch: true });
        if (hit) return hit;
        return new Response('オフラインです。一度オンラインで開くとオフラインでも使えるようになります。', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }),
    );
    return;
  }
  if (url.pathname.includes('/assets/') || /\.(png|svg|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) (await caches.open(APP_CACHE)).put(req, res.clone());
        return res;
      })(),
    );
  }
});
