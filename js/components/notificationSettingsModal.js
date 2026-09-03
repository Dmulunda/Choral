// Self-service "turn on/off push notifications on this device" — one
// browser/device at a time (a phone and a laptop are separate
// subscriptions), matching how push actually works. See
// js/pushNotifications.js for the subscribe/unsubscribe mechanics.
import { t } from '../i18n.js';
import { isPushSupported, getPushStatus, enablePushNotifications, disablePushNotifications } from '../pushNotifications.js';

export function createNotificationSettingsModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('notifications.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p data-el="status-text" class="text-sm text-slate-600 mb-4"></p>
      <button type="button" data-action="toggle" class="w-full py-2 rounded-lg font-medium disabled:opacity-50"></button>
    </div>
  `;
  document.body.appendChild(root);

  const statusTextEl = root.querySelector('[data-el="status-text"]');
  const toggleBtn = root.querySelector('[data-action="toggle"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  toggleBtn.addEventListener('click', handleToggle);

  let status = 'unsupported';

  async function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    await refresh();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  async function refresh() {
    status = await getPushStatus();
    render();
  }

  function render() {
    if (status === 'unsupported') {
      statusTextEl.textContent = t('notifications.unsupported');
      toggleBtn.classList.add('hidden');
      return;
    }
    toggleBtn.classList.remove('hidden');
    toggleBtn.disabled = false;

    if (status === 'denied') {
      statusTextEl.textContent = t('notifications.denied');
      toggleBtn.classList.add('hidden');
    } else if (status === 'subscribed') {
      statusTextEl.textContent = t('notifications.onThisDevice');
      toggleBtn.textContent = t('notifications.turnOff');
      toggleBtn.className = 'w-full py-2 rounded-lg font-medium bg-slate-200 text-slate-700 hover:bg-slate-300';
    } else {
      statusTextEl.textContent = t('notifications.offThisDevice');
      toggleBtn.textContent = t('notifications.turnOn');
      toggleBtn.className = 'w-full py-2 rounded-lg font-medium bg-indigo-600 text-white hover:bg-indigo-700';
    }
  }

  async function handleToggle() {
    toggleBtn.disabled = true;
    try {
      if (status === 'subscribed') {
        await disablePushNotifications(supabase);
      } else {
        await enablePushNotifications(supabase, currentUserId);
      }
    } catch (err) {
      if (err.message === 'denied') {
        statusTextEl.textContent = t('notifications.permissionDenied');
      } else {
        statusTextEl.textContent = t('notifications.failed', { message: err.message });
      }
      toggleBtn.disabled = false;
      return;
    }
    await refresh();
  }

  return { open, root };
}
