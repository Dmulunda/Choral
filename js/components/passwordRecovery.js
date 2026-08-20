// Shown when the app is opened via a Supabase password-recovery link
// (app.js listens for the PASSWORD_RECOVERY auth event and renders this
// instead of the normal auth/app screens) so the member can set a new
// password before landing in the app.
import { t } from '../i18n.js';

export function renderPasswordRecovery(container, { supabase, onDone }) {
  container.innerHTML = `
    <div class="w-full max-w-md">
      <div class="flex justify-center mb-6">
        <img src="img/vpd-logo.png" alt="${t('app.brand')}" class="h-24 w-auto drop-shadow-md" />
      </div>

      <div class="bg-white rounded-xl shadow-xl overflow-hidden">
        <div class="h-1.5 bg-gradient-to-r from-[#0B1F3A] via-[#D4AF37] to-[#0B1F3A]"></div>

        <div class="p-6 sm:p-8">
          <h1 class="text-xl font-bold text-center mb-6 text-[#0B1F3A]">${t('auth.setNewPasswordTitle')}</h1>

          <form data-el="form" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-slate-600 mb-1">${t('auth.newPassword')}</label>
              <input type="password" name="password" required minlength="6" autocomplete="new-password"
                     class="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent" />
            </div>

            <p data-el="status" class="text-sm"></p>

            <button type="submit" data-el="submit-btn"
                    class="w-full py-2 rounded-lg bg-[#0B1F3A] text-white font-medium hover:bg-[#0a1628] disabled:opacity-50 transition-colors">
              ${t('auth.updatePassword')}
            </button>
          </form>
        </div>
      </div>
    </div>
  `;

  const form = container.querySelector('[data-el="form"]');
  const statusEl = container.querySelector('[data-el="status"]');
  const submitBtn = container.querySelector('[data-el="submit-btn"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = form.elements.password.value;

    submitBtn.disabled = true;
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('auth.updatingPassword');

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('auth.passwordUpdateFailed', { message: error.message });
      submitBtn.disabled = false;
      return;
    }

    statusEl.className = 'text-sm text-emerald-600';
    statusEl.textContent = t('auth.passwordUpdated');
    setTimeout(() => onDone?.(), 1200);
  });
}
