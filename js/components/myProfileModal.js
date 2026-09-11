// Self-service "My Profile" — upload/replace your own photo, set your
// address/sex/parish/birth country+city, and draw your own signature
// (sql/083, sql/084) for the Member ID Card (memberIdCard.js).
// Deliberately does NOT include member_title ("Fonction" on the card,
// e.g. "Pasteur Principal") — that's an official designation set by an
// admin (userEditModal.js), not something a member self-declares. Same
// createXModal({...}) => { open } shape as changePasswordModal.js,
// reached from the same sidebar Tools menu.
import { t } from '../i18n.js';
import { renderMemberIdCard } from './memberIdCard.js';
import { createSignaturePad } from './signaturePad.js';

export function createMyProfileModal({ supabase, userId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('myProfile.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>

      <form data-el="form" class="space-y-3 mb-6">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.photo')}</label>
          <input type="file" accept="image/*" data-el="photo-input" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.address')}</label>
          <input type="text" name="address" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberCard.sex')}</label>
            <select name="sex" class="w-full border border-slate-300 rounded-lg px-3 py-2">
              <option value="">—</option>
              <option value="M">${t('memberCard.male')}</option>
              <option value="F">${t('memberCard.female')}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('memberCard.parish')}</label>
            <input type="text" name="parish" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.birthCountry')}</label>
            <input type="text" name="birth_country" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.birthCity')}</label>
            <input type="text" name="birth_city" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.signature')}</label>
          <p class="text-xs text-slate-400 mb-1">${t('myProfile.signatureHint')}</p>
          <canvas data-el="signature-pad" width="360" height="120" class="w-full border border-slate-300 rounded-lg bg-white touch-none" style="max-width:360px;height:120px;"></canvas>
          <button type="button" data-action="clear-signature" class="mt-1 text-xs text-slate-500 hover:text-slate-700 underline">${t('myProfile.clearSignature')}</button>
        </div>
        <div class="flex items-center gap-3">
          <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('myProfile.save')}</button>
          <span data-el="form-status" class="text-sm text-slate-500"></span>
        </div>
      </form>

      <div class="border-t border-slate-200 pt-4">
        <h3 class="text-sm font-semibold text-slate-600 mb-3">${t('myProfile.idCardTitle')}</h3>
        <div data-el="card-container"></div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const form = root.querySelector('[data-el="form"]');
  const formStatusEl = root.querySelector('[data-el="form-status"]');
  const cardContainer = root.querySelector('[data-el="card-container"]');
  const signaturePad = createSignaturePad(root.querySelector('[data-el="signature-pad"]'));

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="clear-signature"]').addEventListener('click', () => signaturePad.clear());
  form.addEventListener('submit', handleSubmit);

  async function open() {
    formStatusEl.textContent = '';
    form.reset();
    root.classList.remove('hidden');
    root.classList.add('flex');

    const { data: profile } = await supabase.from('profiles').select('address, sex, parish, birth_country, birth_city, signature_data').eq('id', userId).single();
    form.elements.address.value = profile?.address || '';
    form.elements.sex.value = profile?.sex || '';
    form.elements.parish.value = profile?.parish || '';
    form.elements.birth_country.value = profile?.birth_country || '';
    form.elements.birth_city.value = profile?.birth_city || '';
    signaturePad.clear();
    signaturePad.loadFromDataUrl(profile?.signature_data);

    renderMemberIdCard(cardContainer, { supabase, userId });
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const update = {
      address: form.elements.address.value.trim() || null,
      sex: form.elements.sex.value || null,
      parish: form.elements.parish.value.trim() || null,
      birth_country: form.elements.birth_country.value.trim() || null,
      birth_city: form.elements.birth_city.value.trim() || null,
      signature_data: signaturePad.isEmpty() ? null : signaturePad.toDataUrl(),
    };

    const file = form.querySelector('[data-el="photo-input"]')?.files?.[0];
    if (file) {
      const path = `${userId}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from('member-photos').upload(path, file);
      if (uploadError) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = t('myProfile.saveFailed', { message: uploadError.message });
        return;
      }
      update.photo_path = path;
    }

    const { error } = await supabase.from('profiles').update(update).eq('id', userId);
    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('myProfile.saveFailed', { message: error.message });
      return;
    }

    formStatusEl.className = 'text-sm text-emerald-600';
    formStatusEl.textContent = t('myProfile.saved');
    form.querySelector('[data-el="photo-input"]').value = '';
    renderMemberIdCard(cardContainer, { supabase, userId });
  }

  return { open, root };
}
