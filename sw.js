// sw.js — offline support for spritomic
// html = network-first w/ cache fallback, static assets = cache-first,
// supabase api calls never cached (auth/data can't go stale), supabase
// storage (art/sprites/backgrounds) = cache-first so offline reading
// actually works, not just the metadata

const CACHE_VERSION = 'v3';
// keeping the 'comiccore-' prefix here on purpose — changing it would get
// deleted as a stale cache on next activate and wipe everyone's offline art
const CACHE_NAME = `comiccore-${CACHE_VERSION}`;

// bare minimum app shell, big editor pages just cache themselves on first visit
const PRECACHE_URLS = [
  'manifest.json',
  'theme.css',
  'theme.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-192-maskable.png',
  'icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// app pings us w/ PURGE_STORAGE_PATH when an asset gets deleted (see
// purgeCachedAsset() in my-comics-mobile.html), otherwise we'd keep
// serving the stale cached image forever
self.addEventListener('message', (event) => {
  if (event.data?.type === 'PURGE_STORAGE_PATH' && event.data.path) {
    event.waitUntil(
      caches.open(CACHE_NAME).then(async (cache) => {
        const reqs = await cache.keys();
        await Promise.all(
          reqs
            .filter((req) => req.url.includes(event.data.path))
            .map((req) => cache.delete(req))
        );
      })
    );
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // only care about GET
  if (req.method !== 'GET') return;

  const isSupabase = url.hostname.endsWith('.supabase.co');

  if (isSupabase) {
    // never cache rest/auth/realtime, can't let those go stale and lie to the app
    const isLiveApi =
      url.pathname.includes('/rest/') ||
      url.pathname.includes('/auth/') ||
      url.pathname.includes('/realtime/');
    if (isLiveApi) return;

    // everything else on supabase is Storage (art, frames, sprites, etc) —
    // cache-first so comics are actually readable offline, not just listed
    event.respondWith(
      caches.match(req).then((cached) => {
        const networkFetch = fetch(req)
          .then((res) => {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // other origins (fonts etc) just pass through
  if (url.origin !== location.origin) return;

  const isHTML =
    req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('index.html'))
        )
    );
    return;
  }

  // static stuff: serve cached instantly, refresh in bg either way
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
