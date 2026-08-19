// Simple notifications inbox — lists everything addressed to the
// signed-in user (currently just absence reports fanned out by
// report_absence(), sql/024) and marks them read on open. Phase 5 adds
// a nav icon with an unread badge and folds direct messages into the
// same idea; this is the minimal viewer that makes the fan-out from
// Phase 4 actually visible to its recipients.
import { t } from '../i18n.js';

export function createNotificationsModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
      <div class="flex items-center justify-between p-6 pb-2">
        <h2 class="text-xl font-bold">${t('notifications.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="list" class="flex-1 overflow-y-auto px-6 pb-6 space-y-2"></div>
    </div>
  `;
  document.body.appendChild(root);

  const listEl = root.querySelector('[data-el="list"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('notifications')
      .select('id, title, body, created_at, read_at')
      .eq('recipient_id', currentUserId)
      .order('created_at', { ascending: false });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('notifications.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('notifications.none')}</p>`;
      return;
    }

    listEl.innerHTML = data.map((n) => `
      <div class="border rounded-lg p-3 ${n.read_at ? 'border-slate-200' : 'border-indigo-300 bg-indigo-50'}">
        <div class="font-medium text-slate-800">${escapeHtml(n.title)}</div>
        ${n.body ? `<p class="text-sm text-slate-600 mt-1 whitespace-pre-wrap">${escapeHtml(n.body)}</p>` : ''}
        <div class="text-xs text-slate-400 mt-2">${escapeHtml(n.created_at.slice(0, 10))}</div>
      </div>
    `).join('');

    const unreadIds = data.filter((n) => !n.read_at).map((n) => n.id);
    if (unreadIds.length > 0) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', unreadIds);
    }
  }

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    load();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
