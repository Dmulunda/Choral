// Login / sign-up card. On success, supabase.auth's session change fires
// and app.js's onAuthStateChange listener swaps the auth screen for the app.
import { t } from '../i18n.js';

export function renderAuthScreen(container, { supabase }) {
  let mode = 'login';

  container.innerHTML = `
    <div class="w-full max-w-md">
      <div class="bg-white rounded-xl shadow-xl p-6 sm:p-8">
        <h1 class="text-2xl font-bold text-center mb-1">${t('app.brand')}</h1>
        <p class="text-center text-slate-500 text-sm mb-6">${t('auth.subtitle')}</p>

        <div class="flex mb-6 rounded-lg bg-slate-100 p-1">
          <button type="button" data-mode="login"
                  class="flex-1 py-1.5 rounded-md text-sm font-medium transition-colors">${t('auth.signIn')}</button>
          <button type="button" data-mode="signup"
                  class="flex-1 py-1.5 rounded-md text-sm font-medium transition-colors">${t('auth.signUp')}</button>
        </div>

        <form data-el="form" class="space-y-4">
          <div data-el="full-name-field" class="hidden">
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('auth.fullName')}</label>
            <input type="text" name="full_name" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('auth.email')}</label>
            <input type="email" name="email" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('auth.password')}</label>
            <input type="password" name="password" required minlength="6"
                   class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>

          <p data-el="status" class="text-sm"></p>

          <button type="submit" data-el="submit-btn"
                  class="w-full py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('auth.signIn')}
          </button>
        </form>
      </div>
    </div>
  `;

  const modeButtons = container.querySelectorAll('[data-mode]');
  const fullNameField = container.querySelector('[data-el="full-name-field"]');
  const form = container.querySelector('[data-el="form"]');
  const statusEl = container.querySelector('[data-el="status"]');
  const submitBtn = container.querySelector('[data-el="submit-btn"]');

  function setMode(next) {
    mode = next;
    modeButtons.forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('bg-white', active);
      btn.classList.toggle('shadow', active);
      btn.classList.toggle('text-indigo-700', active);
      btn.classList.toggle('text-slate-500', !active);
    });
    fullNameField.classList.toggle('hidden', mode !== 'signup');
    fullNameField.querySelector('input').required = mode === 'signup';
    submitBtn.textContent = mode === 'signup' ? t('auth.createAccount') : t('auth.signIn');
    statusEl.textContent = '';
  }

  modeButtons.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
  setMode('login');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;

    submitBtn.disabled = true;
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = mode === 'signup' ? t('auth.creatingAccount') : t('auth.signingIn');

    if (mode === 'signup') {
      const fullName = form.elements.full_name.value.trim();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });

      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = error.message;
      } else if (!data.session) {
        statusEl.className = 'text-sm text-emerald-600';
        statusEl.textContent = t('auth.accountCreatedCheckEmail');
      }
      // If data.session exists, onAuthStateChange in app.js takes over.
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = error.message;
      }
    }

    submitBtn.disabled = false;
  });
}
