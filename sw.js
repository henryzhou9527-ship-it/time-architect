/* Time Architect service worker.
   Static shell: stale-while-revalidate. API calls: network only (never cached).
   Bump CACHE_VERSION whenever shipped assets change. */

const CACHE_VERSION = 'ta-v2.0.0';
const SHELL = [
    './',
    './index.html',
    './css/time-architect.css',
    './js/app-config.js',
    './js/calendar-planner.js',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png',
    './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(cache => cache.addAll(SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return; // live data + SSE streams, never cached
    if (url.origin !== self.location.origin) return;

    event.respondWith((async () => {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
        const refresh = fetch(request).then(response => {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
        }).catch(() => null);

        if (cached) {
            refresh.catch(() => {});
            return cached;
        }
        const fresh = await refresh;
        if (fresh) return fresh;
        if (request.mode === 'navigate') {
            const shell = await cache.match('./index.html');
            if (shell) return shell;
        }
        return new Response('offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })());
});
