// Minimal service worker — exists only so the browser treats this app
// as installable (Chrome/Android requires a registered SW with a fetch
// handler before it will offer "Add to Home Screen"). Deliberately does
// no caching: this app ships frequent updates, and a cache-first SW
// would risk serving stale JS/CSS after a deploy. Every request just
// passes straight through to the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  // Only take over same-origin requests. Calling respondWith() on a
  // cross-origin request (e.g. the direct-to-R2 video PUT) routes it
  // through this SW's own fetch() instead of the page's XHR, which
  // silently breaks XHR upload-progress events on the page — leaving
  // it stuck at a static percentage with no visible cause. Letting the
  // browser handle cross-origin requests natively (no respondWith at
  // all) keeps this SW installable-only, as intended, without that
  // side effect.
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request));
});

// Web Push — see js/pushNotifications.js (subscribe) and
// supabase/functions/send-push (send). Independent of the no-caching
// policy above; this just displays whatever the push payload says.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* non-JSON payload — show with defaults */ }

  event.waitUntil(self.registration.showNotification(data.title || 'VPD Church', {
    body: data.body || '',
    icon: 'img/icons/icon-192.png',
    badge: 'img/icons/icon-192.png',
    data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
