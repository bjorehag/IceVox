// IceVox Web — service worker
// Purpose: PWA installability + offline app shell.
// Strategy: network-first for everything, falling back to cache when offline.
// Network-first (not cache-first) so deployed updates are picked up on the
// next load without cache-versioning gymnastics. WebRTC/PeerJS traffic is
// WebSocket/UDP and never touches the service worker.

const CACHE_NAME = 'icevox-web-v2';

const SHELL_FILES = [
  '.',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/audio.js',
  'js/connection.js',
  'js/video.js',
  'js/presets.js',
  'js/ice-config.js',
  'js/peerjs.min.js',
  'js/audio-worklet-processor.js',
  'manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle same-origin GETs (PeerJS signaling etc. passes straight through)
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Keep the cache fresh with whatever we successfully fetched
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: url.pathname.endsWith('/') || url.pathname.endsWith('index.html') }))
  );
});
