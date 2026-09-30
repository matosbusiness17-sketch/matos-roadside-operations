/**
 * Matos Systems Roadside Worker Service Worker
 * Version: matos-worker-pwa-v1
 *
 * Scoped strictly to /worker/ navigation fallback.
 * Strictly adheres to zero-offline-mutation and zero-operational-caching policy:
 * - Pre-caches ONLY static offline fallback page and icon.
 * - Does NOT cache authenticated worker HTML, assignments, or operational API data.
 * - Does NOT intercept POST, Server Actions, Supabase, or Realtime requests.
 * - Returns cached /offline.html ONLY when network fails on GET navigation.
 */

const CACHE_NAME = 'matos-worker-pwa-v1';
const PRECACHE_ASSETS = [
  '/offline.html',
  '/worker-icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key.startsWith('matos-worker-pwa-') && key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Only handle HTML navigation requests (e.g. document navigation to /worker)
  if (event.request.mode !== 'navigate') {
    return;
  }

  const url = new URL(event.request.url);

  // Strictly worker surface navigation
  if (!url.pathname.startsWith('/worker')) {
    return;
  }

  // Network-first navigation:
  // Try network first. If network fails (offline), provide generic static fallback.
  // CRITICAL: Successful responses are NEVER stored in Cache Storage to protect authenticated operational data.
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      const fallback = await cache.match('/offline.html');
      return (
        fallback ||
        new Response('Service Unavailable (Offline)', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        })
      );
    })
  );
});
