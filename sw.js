// Minimal service worker — exists only so the browser treats this app
// as installable (Chrome/Android requires a registered SW with a fetch
// handler before it will offer "Add to Home Screen"). Deliberately does
// no caching: this app ships frequent updates, and a cache-first SW
// would risk serving stale JS/CSS after a deploy. Every request just
// passes straight through to the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
