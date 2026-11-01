// Service worker: makes the whole app work offline.
//  - App files and data: network first (so updates show up), cache as fallback.
//  - Images: cache first (their file names change when the picture changes).
// Bump VERSION to throw away every old cache.
const VERSION = 'v9';
const SHELL_CACHE = `shell-${VERSION}`;
const IMAGE_CACHE = `images-${VERSION}`;
const NETWORK_TIMEOUT_MS = 3000;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/app.css',
  'css/card.css',
  'css/pack.css',
  'js/app.js',
  'js/dom.js',
  'js/i18n.js',
  'js/db.js',
  'js/speech.js',
  'js/store.js',
  'js/components.js',
  'js/chrome.js',
  'js/fx.js',
  'js/reveal.js',
  'js/offline.js',
  'js/gesture.js',
  'js/viewer.js',
  'js/cardparts.js',
  'js/worldmap.js',
  'js/compare.js',
  'js/magnifier.js',
  'js/globe.js',
  'js/views/binder.js',
  'js/views/globe.js',
  'js/views/quiz.js',
  'js/views/badges.js',
  'js/views/more.js',
  'js/views/credits.js',
  'lang/en.json',
  'lang/zh-TW.json',
  'data/animals.json',
  'data/groups.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'assets/world.svg',
  'assets/globe.json',
  'assets/child.svg',
];

const thumbOf = file => 'img/thumbs/' + file.split('/').pop().replace(/\.[^.]+$/, '') + '.webp';

async function cacheImages(urls) {
  const cache = await caches.open(IMAGE_CACHE);
  const have = new Set((await cache.keys()).map(r => new URL(r.url).pathname));
  const missing = urls.filter(u => !have.has(new URL(u, self.registration.scope).pathname));
  // A few at a time so a tablet on slow Wi-Fi isn't swamped.
  for (let i = 0; i < missing.length; i += 6) {
    await Promise.all(missing.slice(i, i + 6).map(u => cache.add(u).catch(() => {})));
  }
}

async function cacheAllImagesFromData() {
  const res = await fetch('data/animals.json', { cache: 'no-cache' });
  const cards = await res.json();
  const urls = cards.flatMap(c => [
    ...['photo', 'illustration'].map(k => c[k]?.file).filter(Boolean).flatMap(f => [f, thumbOf(f)]),
    ...(c.silhouette?.file ? [c.silhouette.file] : []),
    ...(c.range ? [c.range] : []),
  ]);
  await cacheImages(urls);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    await cacheAllImagesFromData().catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, IMAGE_CACHE]);
    for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

// The page sends the current image list after loading data, in case it changed.
self.addEventListener('message', event => {
  if (event.data?.type !== 'cache-images') return;
  event.waitUntil((async () => {
    await cacheImages(event.data.urls ?? []);
    event.source?.postMessage({ type: 'images-cached' });
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
    ]);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    // Look in every cache: range files are stored with the images.
    const cached = await caches.match(request, { ignoreSearch: true })
      ?? (request.mode === 'navigate' ? await cache.match('index.html') : undefined);
    if (cached) return cached;
    throw new Error('offline and not cached');
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const isImage = url.pathname.includes('/img/');
  event.respondWith(isImage ? cacheFirst(request) : networkFirst(request));
});
