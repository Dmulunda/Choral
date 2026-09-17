// Church logo + address — Super Admin only. Mirrors sandbox2's
// tenantLogoModal.js, but this app has only one church, not many
// tenants: writes to church_branding (a singleton row, id = true) with
// upsert instead of a tenant-scoped update, and the storage path has no
// per-tenant subfolder (church-logo bucket, fixed logo.<ext> at root).
// Returned shape includes `root` (not just `open`) because
// superAdminHome.js tears down every modal on each re-render via
// `currentXModal?.root.remove()` — matches menuCustomizer.js's contract.
import { t } from '../i18n.js';
import { loadChurchBranding } from '../churchBranding.js';

const BUCKET = 'church-logo';
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

export function createChurchLogoModal({ supabase, currentUserId, onSaved }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('logo.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase.from('church_branding').select('logo_url, address').eq('id', true).maybeSingle();
    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('logo.failedToLoad', { message: error.message })}</p>`;
      return;
    }
    render(data?.logo_url || null, data?.address || '');
  }

  function render(logoUrl, address) {
    bodyEl.innerHTML = '';

    if (logoUrl) {
      const preview = document.createElement('img');
      preview.src = logoUrl;
      preview.alt = '';
      preview.className = 'w-20 h-20 rounded-lg object-cover mb-4 border border-slate-200';
      bodyEl.appendChild(preview);
    } else {
      const empty = document.createElement('p');
      empty.className = 'text-sm text-slate-500 mb-4';
      empty.textContent = t('logo.noLogo');
      bodyEl.appendChild(empty);
    }

    const section = document.createElement('div');
    section.innerHTML = `
      <label class="block text-sm font-medium text-slate-600 mb-1">${t(logoUrl ? 'logo.replaceLabel' : 'logo.uploadLabel')}</label>
      <input type="file" data-el="file-input" accept="image/png,image/jpeg,image/svg+xml,image/webp" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" />
      <p class="text-xs text-slate-400 mb-2">${t('logo.hint')}</p>
      <p data-el="upload-status" class="text-sm mb-2"></p>
      <button type="button" data-action="upload" class="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
        ${t(logoUrl ? 'logo.replaceButton' : 'logo.uploadButton')}
      </button>
    `;
    bodyEl.appendChild(section);

    const fileInput = section.querySelector('[data-el="file-input"]');
    const statusEl = section.querySelector('[data-el="upload-status"]');
    const uploadBtn = section.querySelector('[data-action="upload"]');
    uploadBtn.addEventListener('click', () => uploadFile(fileInput, statusEl, uploadBtn));

    const addressSection = document.createElement('div');
    addressSection.className = 'mt-6 pt-6 border-t border-slate-200';
    addressSection.innerHTML = `
      <label class="block text-sm font-medium text-slate-600 mb-1">${t('logo.addressLabel')}</label>
      <textarea data-el="address-input" rows="2" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" placeholder="${t('logo.addressPlaceholder')}">${escapeHtml(address)}</textarea>
      <p data-el="address-status" class="text-sm mb-2"></p>
      <button type="button" data-action="save-address" class="w-full px-4 py-2 rounded-lg bg-slate-700 text-white font-medium hover:bg-slate-800 disabled:opacity-50">
        ${t('logo.saveAddressButton')}
      </button>
    `;
    bodyEl.appendChild(addressSection);

    const addressInput = addressSection.querySelector('[data-el="address-input"]');
    const addressStatusEl = addressSection.querySelector('[data-el="address-status"]');
    const saveAddressBtn = addressSection.querySelector('[data-action="save-address"]');
    saveAddressBtn.addEventListener('click', () => saveAddress(addressInput, addressStatusEl, saveAddressBtn));
  }

  async function saveAddress(input, statusEl, button) {
    const address = input.value.trim() || null;

    button.disabled = true;
    statusEl.className = 'text-sm text-slate-500 mb-2';
    statusEl.textContent = t('common.saving');

    const { error } = await supabase.from('church_branding').upsert(
      { id: true, address, updated_by: currentUserId, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    );
    button.disabled = false;
    if (error) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('logo.addressSaveFailed', { message: error.message });
      return;
    }

    statusEl.className = 'text-sm text-emerald-600 mb-2';
    statusEl.textContent = t('logo.addressSaved');
    await loadChurchBranding();
    onSaved?.();
  }

  async function uploadFile(fileInput, statusEl, button) {
    const file = fileInput.files?.[0];
    if (!file) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('logo.noFileSelected');
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('logo.invalidType');
      return;
    }
    if (file.size > MAX_BYTES) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('logo.tooLarge');
      return;
    }

    button.disabled = true;
    statusEl.className = 'text-sm text-slate-500 mb-2';
    statusEl.textContent = t('logo.uploading');

    const ext = file.name.split('.').pop() || 'png';
    // Fixed filename, no subfolder (single church, unlike sandbox2's
    // {tenant_id}/logo.<ext>) — upsert just replaces the object in place.
    const path = `logo.${ext}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: true,
    });
    if (uploadError) {
      button.disabled = false;
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('logo.uploadFailed', { message: uploadError.message });
      return;
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    // Cache-bust: the bucket is public and the filename is stable
    // (logo.png stays logo.png on replace), so without this every
    // browser that already cached the old image keeps showing it.
    const cacheBustedUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { error: updateError } = await supabase.from('church_branding').upsert(
      { id: true, logo_url: cacheBustedUrl, updated_by: currentUserId, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    );
    button.disabled = false;
    if (updateError) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('logo.uploadFailed', { message: updateError.message });
      return;
    }

    await loadChurchBranding();
    onSaved?.(cacheBustedUrl);
    load();
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

  return { open, root };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
