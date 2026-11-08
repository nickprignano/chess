// Service worker: keeps a copy of every app file so the installed app works offline.
// VERSION and FILES are written by `node tools/sw-version.mjs`; a test fails if they're stale.

const VERSION = 'a58d3f713f32';
const FILES = [
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/icon.svg',
  '/',
  'manifest.webmanifest',
  'src/audio.js',
  'src/board.js',
  'src/chesscom.js',
  'src/engine.js',
  'src/game.js',
  'src/main.js',
  'src/opponent.js',
  'src/pieces.js',
  'src/rating.js',
  'src/twin.js',
  'styles.css',
  'vendor/chess.mjs',
];
// The shared theme, pinned to a commit so it never changes. Kept if it loads, skipped if not.
const EXTRA = [
  'https://cdn.jsdelivr.net/gh/nickprignano/prignano-theme@4c2effc3829269e40ad663baf130a6b899a402bb/theme.css',
  'https://cdn.jsdelivr.net/gh/nickprignano/prignano-theme@4c2effc3829269e40ad663baf130a6b899a402bb/index.js',
];
const CACHE = `chess-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // cache: 'reload' skips the browser's HTTP cache, so a new version never keeps old files.
      await cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' })));
      await Promise.allSettled(EXTRA.map((url) => cache.add(url)));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// The page posts this when the player taps Update.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Every page address is the one app page, cached as "/".
      const cached = request.mode === 'navigate'
        ? await cache.match('/')
        : await cache.match(request, { ignoreSearch: new URL(request.url).origin === location.origin });
      if (cached) return cached;
      const response = await fetch(request);
      // The engine isn't kept at install; keep it the first time it's fetched.
      if (response.ok && new URL(request.url).pathname.startsWith('/vendor/stockfish/')) await cache.put(request, response.clone());
      return response;
    })(),
  );
});
