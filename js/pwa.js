// PWA install support (manifest + this file's SW registration make the
// app eligible for "Add to Home Screen"/"Install") and the home-screen
// app-icon badge counter. Badging is the client-side-only Badging API
// (navigator.setAppBadge/clearAppBadge) — no server involved, unlike
// real push notifications, which need a backend (Edge Function + VAPID
// keys + subscription storage) this app doesn't have yet and was
// explicitly deferred to a later phase.

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch((err) => {
    console.error('Service worker registration failed:', err);
  });
}

export function setAppBadgeCount(count) {
  if (!('setAppBadge' in navigator)) return;
  if (count > 0) {
    navigator.setAppBadge(count).catch(() => {});
  } else {
    navigator.clearAppBadge?.().catch(() => {});
  }
}
