// Web Push subscribe/unsubscribe — works once the app is added to the
// home screen (Android: any recent Chrome; iOS: Safari 16.4+, but only
// once actually installed, not just opened in a tab). No app store
// involved; see supabase/functions/send-push for the sending side.
//
// This public key isn't a secret (it's meant to travel to every
// client) — it just has to match VAPID_PUBLIC_KEY on the send-push
// edge function. Generated once with `npx web-push generate-vapid-keys`.
const VAPID_PUBLIC_KEY = 'BDnwC7T9Uwknrxbka-1fdFE_-zGwYa-ruJK33zdJNmRrg3DFOywAcjI5qwD8B8JJqJE71-752PdGN8hupkXebcI';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getPushStatus() {
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? 'subscribed' : 'unsubscribed';
}

export async function enablePushNotifications(supabase, userId) {
  if (!isPushSupported()) throw new Error('unsupported');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('denied');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const subJson = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: subJson.endpoint,
    p256dh: subJson.keys.p256dh,
    auth: subJson.keys.auth,
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function disablePushNotifications(supabase) {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}
