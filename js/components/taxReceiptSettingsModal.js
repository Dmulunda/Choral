// Finance-only settings for official year-end tax receipts: the
// church's legal name/address/charitable registration number, the
// authorized signer's name/title, and their signature -- everything
// finalize_tax_receipt_year() (sql/saas_platform/31_tax_receipts_rpcs.sql)
// snapshots into tax_receipts.tenant_info_snapshot at issue time, so a
// receipt never silently changes later even if these settings are
// edited afterward. Same singleton shape as church_branding
// (.eq('id', true).maybeSingle() load, .upsert({id: true, ...}, {onConflict:'id'})
// save) -- see churchLogoModal.js for the identical pattern applied to
// a different table.
import { t } from '../i18n.js';
import { createSignaturePad } from './signaturePad.js';

export function createTaxReceiptSettingsModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('taxSettings.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-sm text-slate-500 mb-4">${t('taxSettings.intro')}</p>

      <form data-el="form" class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('taxSettings.legalName')}</label>
          <input type="text" name="legal_name" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('taxSettings.address')}</label>
          <textarea name="address" rows="2" class="w-full border border-slate-300 rounded-lg px-3 py-2"></textarea>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('taxSettings.charityNumber')}</label>
          <input type="text" name="charity_registration_number" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('taxSettings.signerName')}</label>
            <input type="text" name="signing_authority_name" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('taxSettings.signerTitle')}</label>
            <input type="text" name="signing_authority_title" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('taxSettings.signature')}</label>
          <canvas data-el="signature-pad" width="360" height="120" class="w-full border border-slate-300 rounded-lg bg-white touch-none" style="max-width:360px;height:120px;"></canvas>
          <button type="button" data-action="clear-signature" class="mt-1 text-xs text-slate-500 hover:text-slate-700 underline">${t('myProfile.clearSignature')}</button>
        </div>
        <div class="flex items-center gap-3 pt-2">
          <button type="submit" data-el="submit-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('taxSettings.save')}
          </button>
          <span data-el="form-status" class="text-sm text-slate-500"></span>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(root);

  const form = root.querySelector('[data-el="form"]');
  const formStatusEl = root.querySelector('[data-el="form-status"]');
  const submitBtn = root.querySelector('[data-el="submit-btn"]');
  const signaturePad = createSignaturePad(root.querySelector('[data-el="signature-pad"]'));

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="clear-signature"]').addEventListener('click', () => signaturePad.clear());
  form.addEventListener('submit', handleSubmit);

  async function open() {
    formStatusEl.textContent = '';
    form.reset();
    signaturePad.clear();
    root.classList.remove('hidden');
    root.classList.add('flex');

    const { data, error } = await supabase.from('tax_receipt_settings')
      .select('legal_name, address, charity_registration_number, signing_authority_name, signing_authority_title, signature_data')
      .eq('id', true)
      .maybeSingle();
    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('taxSettings.loadFailed', { message: error.message });
      return;
    }
    if (data) {
      form.elements.legal_name.value = data.legal_name || '';
      form.elements.address.value = data.address || '';
      form.elements.charity_registration_number.value = data.charity_registration_number || '';
      form.elements.signing_authority_name.value = data.signing_authority_name || '';
      form.elements.signing_authority_title.value = data.signing_authority_title || '';
      signaturePad.loadFromDataUrl(data.signature_data);
    }
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    submitBtn.disabled = true;
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const row = {
      id: true,
      legal_name: form.elements.legal_name.value.trim(),
      address: form.elements.address.value.trim() || null,
      charity_registration_number: form.elements.charity_registration_number.value.trim() || null,
      signing_authority_name: form.elements.signing_authority_name.value.trim() || null,
      signing_authority_title: form.elements.signing_authority_title.value.trim() || null,
      signature_data: signaturePad.isEmpty() ? null : signaturePad.toDataUrl(),
      updated_by: currentUserId,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('tax_receipt_settings').upsert(row, { onConflict: 'id' });

    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('taxSettings.saveFailed', { message: error.message });
    } else {
      formStatusEl.className = 'text-sm text-emerald-600';
      formStatusEl.textContent = t('taxSettings.saved');
    }
    submitBtn.disabled = false;
  }

  return { open, root };
}
