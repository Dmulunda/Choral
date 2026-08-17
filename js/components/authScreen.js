// Login / sign-up card. On success, supabase.auth's session change fires
// and app.js's onAuthStateChange listener swaps the auth screen for the app.
import { t } from '../i18n.js';

export function renderAuthScreen(container, { supabase }) {
  let mode = 'login';

  container.innerHTML = `
    <div class="w-full max-w-md">
      <div class="flex justify-center mb-6">
        <img src="img/vpd-logo.png" alt="${t('app.brand')}" class="h-24 w-auto drop-shadow-md" />
      </div>

      <div class="bg-white rounded-xl shadow-xl overflow-hidden">
        <div class="h-1.5 bg-gradient-to-r from-[#0B1F3A] via-[#D4AF37] to-[#0B1F3A]"></div>

        <div class="p-6 sm:p-8">
          <h1 class="text-2xl font-bold text-center mb-1 text-[#0B1F3A]">${t('app.brand')}</h1>
          <p class="text-center text-slate-500 text-sm mb-6">${t('auth.subtitle')}</p>

          <div data-el="main-panel">
            <div class="flex mb-6 rounded-lg bg-slate-100 p-1">
              <button type="button" data-mode="login"
                      class="flex-1 py-1.5 rounded-md text-sm font-medium transition-colors">${t('auth.signIn')}</button>
              <button type="button" data-mode="signup"
                      class="flex-1 py-1.5 rounded-md text-sm font-medium transition-colors">${t('auth.signUp')}</button>
            </div>

            <form data-el="form" class="space-y-4">
              <div data-el="full-name-field" class="hidden">
                <label class="block text-sm font-medium text-slate-600 mb-1">${t('auth.fullName')}</label>
                <input type="text" name="full_name" class="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent" />
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-600 mb-1">${t('auth.email')}</label>
                <input type="email" name="email" required class="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent" />
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-600 mb-1">${t('auth.password')}</label>
                <input type="password" name="password" required minlength="6"
                       class="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent" />
              </div>

              <p data-el="status" class="text-sm"></p>

              <button type="submit" data-el="submit-btn"
                      class="w-full py-2 rounded-lg bg-[#0B1F3A] text-white font-medium hover:bg-[#0a1628] disabled:opacity-50 transition-colors">
                ${t('auth.signIn')}
              </button>

              <button type="button" data-action="show-forgot"
                      data-el="forgot-link"
                      class="w-full text-center text-sm text-slate-500 hover:text-[#0B1F3A]">
                ${t('auth.forgotPassword')}
              </button>
            </form>
          </div>

          <div data-el="forgot-panel" class="hidden space-y-4">
            <h2 class="text-lg font-semibold text-[#0B1F3A]">${t('auth.resetTitle')}</h2>
            <p class="text-sm text-slate-500">${t('auth.resetIntro')}</p>

            <form data-el="forgot-form" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-slate-600 mb-1">${t('auth.email')}</label>
                <input type="email" name="email" required class="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent" />
              </div>

              <p data-el="forgot-status" class="text-sm"></p>

              <button type="submit" data-el="forgot-submit-btn"
                      class="w-full py-2 rounded-lg bg-[#0B1F3A] text-white font-medium hover:bg-[#0a1628] disabled:opacity-50 transition-colors">
                ${t('auth.sendResetLink')}
              </button>
              <button type="button" data-action="show-main"
                      class="w-full text-center text-sm text-slate-500 hover:text-[#0B1F3A]">
                ${t('auth.backToSignIn')}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;

  const modeButtons = container.querySelectorAll('[data-mode]');
  const fullNameField = container.querySelector('[data-el="full-name-field"]');
  const form = container.querySelector('[data-el="form"]');
  const statusEl = container.querySelector('[data-el="status"]');
  const submitBtn = container.querySelector('[data-el="submit-btn"]');

  const mainPanel = container.querySelector('[data-el="main-panel"]');
  const forgotPanel = container.querySelector('[data-el="forgot-panel"]');
  const forgotForm = container.querySelector('[data-el="forgot-form"]');
  const forgotStatusEl = container.querySelector('[data-el="forgot-status"]');
  const forgotSubmitBtn = container.querySelector('[data-el="forgot-submit-btn"]');

  function setMode(next) {
    mode = next;
    modeButtons.forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('bg-white', active);
      btn.classList.toggle('shadow', active);
      btn.classList.toggle('text-[#0B1F3A]', active);
      btn.classList.toggle('text-slate-500', !active);
    });
    fullNameField.classList.toggle('hidden', mode !== 'signup');
    fullNameField.querySelector('input').required = mode === 'signup';
    submitBtn.textContent = mode === 'signup' ? t('auth.createAccount') : t('auth.signIn');
    container.querySelector('[data-el="forgot-link"]').classList.toggle('hidden', mode !== 'login');
    statusEl.textContent = '';
  }

  modeButtons.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
  setMode('login');

  container.querySelector('[data-action="show-forgot"]').addEventListener('click', () => {
    mainPanel.classList.add('hidden');
    forgotPanel.classList.remove('hidden');
    forgotStatusEl.textContent = '';
    forgotForm.reset();
  });

  container.querySelector('[data-action="show-main"]').addEventListener('click', () => {
    forgotPanel.classList.add('hidden');
    mainPanel.classList.remove('hidden');
  });

  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = forgotForm.elements.email.value.trim();

    forgotSubmitBtn.disabled = true;
    forgotStatusEl.className = 'text-sm text-slate-500';
    forgotStatusEl.textContent = t('auth.sendingReset');

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });

    forgotSubmitBtn.disabled = false;

    if (error) {
      forgotStatusEl.className = 'text-sm text-rose-600';
      forgotStatusEl.textContent = t('auth.resetFailed', { message: error.message });
      return;
    }

    forgotStatusEl.className = 'text-sm text-emerald-600';
    forgotStatusEl.textContent = t('auth.resetEmailSent');
  });

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
