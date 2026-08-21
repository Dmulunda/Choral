// Role-Restricted App Suggestion Portal — visible only to elevated
// roles (global role holders, department admins/secretaries; the
// button itself is gated in app.js, and sql/040's RLS policy is the
// real enforcement either way). A submission fans out to exactly one
// person — whichever profile has is_primary_admin set — via a
// notification, not a general admin log.
import { t } from '../i18n.js';

export function createAppSuggestionModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('appSuggestion.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-sm text-slate-500 mb-4">${t('appSuggestion.intro')}</p>
      <textarea data-el="message" rows="5" placeholder="${t('appSuggestion.placeholder')}"
                class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3"></textarea>
      <div class="flex items-center gap-3">
        <button type="button" data-action="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('appSuggestion.submit')}
        </button>
        <span data-el="status" class="text-sm text-slate-500"></span>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const messageEl = root.querySelector('[data-el="message"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const submitBtn = root.querySelector('[data-action="submit"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  submitBtn.addEventListener('click', async () => {
    const message = messageEl.value.trim();
    if (!message) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('appSuggestion.emptyMessage');
      return;
    }

    submitBtn.disabled = true;
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.saving');

    const { error } = await supabase.from('app_suggestions').insert({ submitted_by: currentUserId, message });

    submitBtn.disabled = false;
    if (error) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('appSuggestion.submitFailed', { message: error.message });
      return;
    }

    messageEl.value = '';
    statusEl.className = 'text-sm text-emerald-600';
    statusEl.textContent = t('appSuggestion.submitted');
  });

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    messageEl.value = '';
    statusEl.textContent = '';
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}
