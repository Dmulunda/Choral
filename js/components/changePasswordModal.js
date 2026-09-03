// Self-service "change my own password" — distinct from
// passwordRecovery.js (the forgot-password email-link flow) and
// resetPasswordModal.js (an admin resetting someone else's password).
// Requires the current password first: Supabase's updateUser() alone
// doesn't check it (a valid session can set any new password), so this
// re-authenticates with the current password before allowing the
// change, matching what was asked for.
import { t } from '../i18n.js';

export function createChangePasswordModal({ supabase }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('changePassword.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <form data-el="form" class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('changePassword.current')}</label>
          <input type="password" name="current" required autocomplete="current-password"
                 class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('changePassword.new')}</label>
          <input type="password" name="new" required minlength="6" autocomplete="new-password"
                 class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('changePassword.confirm')}</label>
          <input type="password" name="confirm" required minlength="6" autocomplete="new-password"
                 class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <p data-el="status" class="text-sm"></p>
        <button type="submit" data-el="submit-btn"
                class="w-full py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
          ${t('changePassword.action')}
        </button>
      </form>
    </div>
  `;
  document.body.appendChild(root);

  const form = root.querySelector('[data-el="form"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const submitBtn = root.querySelector('[data-el="submit-btn"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  form.addEventListener('submit', handleSubmit);

  function open() {
    form.reset();
    statusEl.textContent = '';
    root.classList.remove('hidden');
    root.classList.add('flex');
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const currentPassword = form.elements.current.value;
    const newPassword = form.elements.new.value;
    const confirmPassword = form.elements.confirm.value;

    if (newPassword !== confirmPassword) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('changePassword.mismatch');
      return;
    }

    submitBtn.disabled = true;
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.loading');

    const { data: { user } } = await supabase.auth.getUser();
    const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (verifyError) {
      submitBtn.disabled = false;
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('changePassword.currentWrong');
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    submitBtn.disabled = false;

    if (updateError) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('changePassword.failed', { message: updateError.message });
      return;
    }

    statusEl.className = 'text-sm text-emerald-600';
    statusEl.textContent = t('changePassword.success');
    form.reset();
  }

  return { open, root };
}
