// Admin "Add Singer" modal — creates a real Supabase Auth account for a new
// member via a throwaway client (so it doesn't touch the admin's own
// session — signUp() would otherwise sign the admin out and the new
// member in), then assigns their role/voice part with the admin's client.
import { createScopedClient } from '../supabaseClient.js';
import { t, voicePartLabel } from '../i18n.js';

const VOICE_PARTS = ['Leader', 'Soprano', 'Alto', 'Tenor', 'Pianist', 'Bassist', 'Guitarist', 'Drummer'];

export function createMemberCreatorModal({ supabase, onCreated }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xl font-bold">${t('memberCreator.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-xs text-slate-500 mb-4">${t('memberCreator.intro')}</p>

      <form data-el="form" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberCreator.fullName')}</label>
          <input type="text" name="full_name" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberCreator.email')}</label>
          <input type="email" name="email" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberCreator.password')}</label>
          <div class="flex gap-2">
            <input type="text" name="password" required minlength="6"
                   class="flex-1 border border-slate-300 rounded-lg px-3 py-2 font-mono" />
            <button type="button" data-action="generate-password"
                    class="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 whitespace-nowrap">
              ${t('memberCreator.generatePassword')}
            </button>
          </div>
        </div>
        <div class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberCreator.role')}</label>
            <select name="role" class="w-full border border-slate-300 rounded-lg px-3 py-2">
              <option value="singer">${t('role.singer')}</option>
              <option value="admin">${t('role.admin')}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberCreator.voicePart')}</label>
            <select name="voice_parts" multiple size="5" class="w-full border border-slate-300 rounded-lg px-3 py-2">
              ${VOICE_PARTS.map((part) => `<option value="${part}">${voicePartLabel(part)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberCreator.instrumentName')}</label>
          <input type="text" name="instrument_name" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>

        <p data-el="form-status" class="text-sm"></p>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" data-action="close" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">${t('common.cancel')}</button>
          <button type="submit" data-el="save-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('memberCreator.save')}
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(root);

  const form = root.querySelector('[data-el="form"]');
  const formStatusEl = root.querySelector('[data-el="form-status"]');
  const saveBtn = root.querySelector('[data-el="save-btn"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="generate-password"]').addEventListener('click', () => {
    form.elements.password.value = generateTempPassword();
  });
  form.addEventListener('submit', handleSubmit);

  async function handleSubmit(e) {
    e.preventDefault();

    const fullName = form.elements.full_name.value.trim();
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    const role = form.elements.role.value;
    const voiceParts = Array.from(form.elements.voice_parts.selectedOptions).map((opt) => opt.value);
    const instrumentName = form.elements.instrument_name.value.trim() || null;

    if (!fullName || !email || !password) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('memberCreator.missingFields');
      return;
    }
    if (password.length < 6) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('memberCreator.passwordTooShort');
      return;
    }

    saveBtn.disabled = true;
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('memberCreator.creating');

    const scopedClient = createScopedClient();
    const { data, error } = await scopedClient.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    // Supabase's anti-enumeration behavior: signing up with an email that's
    // already registered can return a fake user with no identities instead
    // of an error.
    const alreadyRegistered = !error && data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;

    if (error || alreadyRegistered) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = alreadyRegistered
        ? t('memberCreator.emailAlreadyRegistered')
        : t('memberCreator.failedToCreate', { message: error.message });
      saveBtn.disabled = false;
      return;
    }

    const newUserId = data.user.id;

    // The signup trigger always creates the profile as role 'singer' with
    // no voice parts — apply the admin's chosen values on top of that.
    if (role !== 'singer' || voiceParts.length > 0 || instrumentName) {
      const { error: assignError } = await supabase
        .from('profiles')
        .update({ role, voice_parts: voiceParts, instrument_name: instrumentName })
        .eq('id', newUserId);

      if (assignError) {
        formStatusEl.className = 'text-sm text-amber-600';
        formStatusEl.textContent = t('memberCreator.roleAssignFailed', { message: assignError.message });
        saveBtn.disabled = false;
        onCreated?.();
        return;
      }
    }

    saveBtn.disabled = false;
    formStatusEl.className = 'text-sm text-emerald-600';
    formStatusEl.textContent = t('memberCreator.success', { name: fullName, password });
    onCreated?.();
  }

  function generateTempPassword() {
    const bytes = new Uint8Array(9);
    window.crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12);
  }

  function open() {
    form.reset();
    formStatusEl.textContent = '';
    root.classList.remove('hidden');
    root.classList.add('flex');
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}
