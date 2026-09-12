// Help / training document viewer — one CURRENT PDF per language,
// uploaded by a Super Admin, viewable by any signed-in member. Old
// uploads are kept (flagged is_current = false, not deleted), same
// pattern as rulesModal.js.
import { t } from '../i18n.js';

const SIGNED_URL_TTL_SECONDS = 300;
const BUCKET = 'help-docs';
const LANGUAGES = ['en', 'fr'];
const LANGUAGE_LABELS = { en: 'English', fr: 'Français' };

export function createHelpModal({ supabase, currentUserId, canAdminister }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('help.title')}</h2>
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

    const { data, error } = await supabase
      .from('help_documents')
      .select('id, title, storage_path, file_name, uploaded_at, version, language, uploader:profiles!uploaded_by ( full_name )')
      .eq('is_current', true);

    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('help.failedToLoad', { message: error.message })}</p>`;
      return;
    }

    const byLanguage = {};
    for (const doc of data || []) byLanguage[doc.language] = doc;
    render(byLanguage);
  }

  function render(byLanguage) {
    bodyEl.innerHTML = '';

    const anyDoc = LANGUAGES.some((lang) => byLanguage[lang]);
    if (anyDoc) {
      for (const lang of LANGUAGES) {
        const doc = byLanguage[lang];
        if (!doc) continue;
        const info = document.createElement('div');
        info.className = 'bg-slate-50 rounded-lg p-4 mb-3';
        info.innerHTML = `
          <p class="font-medium text-slate-800 mb-1">${LANGUAGE_LABELS[lang]} — ${escapeHtml(doc.file_name)}</p>
          <p class="text-xs text-slate-500 mb-2">${t('help.uploadedInfo', { name: doc.uploader?.full_name || '—', date: new Date(doc.uploaded_at).toLocaleDateString() })}</p>
        `;
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'w-full px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700';
        openBtn.textContent = t('help.openDocument', { language: LANGUAGE_LABELS[lang] });
        openBtn.addEventListener('click', () => openDocument(doc, openBtn));
        info.appendChild(openBtn);
        bodyEl.appendChild(info);
      }
    } else {
      const empty = document.createElement('p');
      empty.className = 'text-sm text-slate-500 mb-4';
      empty.textContent = t('help.noDocument');
      bodyEl.appendChild(empty);
    }

    if (canAdminister) {
      const adminSection = document.createElement('div');
      adminSection.className = 'border-t border-slate-200 pt-4 mt-2';
      adminSection.innerHTML = `
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('help.uploadLabel')}</label>
        <select data-el="lang-select" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2">
          ${LANGUAGES.map((lang) => `<option value="${lang}">${LANGUAGE_LABELS[lang]}</option>`).join('')}
        </select>
        <input type="file" data-el="file-input" accept="application/pdf" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" />
        <p data-el="upload-status" class="text-sm mb-2"></p>
        <button type="button" data-action="upload" class="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
          ${t('help.uploadButton')}
        </button>
      `;
      bodyEl.appendChild(adminSection);

      const langSelect = adminSection.querySelector('[data-el="lang-select"]');
      const fileInput = adminSection.querySelector('[data-el="file-input"]');
      const uploadStatusEl = adminSection.querySelector('[data-el="upload-status"]');
      const uploadBtn = adminSection.querySelector('[data-action="upload"]');
      uploadBtn.addEventListener('click', () => {
        const lang = langSelect.value;
        uploadFile(byLanguage[lang] || null, lang, fileInput, uploadStatusEl, uploadBtn);
      });

      langSelect.addEventListener('change', () => {
        uploadBtn.textContent = t(byLanguage[langSelect.value] ? 'help.replaceButton' : 'help.uploadButton');
      });
    }
  }

  async function openDocument(doc, button) {
    button.disabled = true;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
    button.disabled = false;

    if (error || !data) {
      window.alert(t('help.openFailed', { message: error?.message || '' }));
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  async function uploadFile(existingDoc, language, fileInput, statusEl, button) {
    const file = fileInput.files?.[0];
    if (!file) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('help.noFileSelected');
      return;
    }
    if (file.type !== 'application/pdf') {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('help.pdfOnly');
      return;
    }

    button.disabled = true;
    statusEl.className = 'text-sm text-slate-500 mb-2';
    statusEl.textContent = t('help.uploading');

    if (existingDoc) {
      const { error: markOldError } = await supabase.from('help_documents').update({ is_current: false }).eq('id', existingDoc.id);
      if (markOldError) {
        button.disabled = false;
        statusEl.className = 'text-sm text-rose-600 mb-2';
        statusEl.textContent = t('help.uploadFailed', { message: markOldError.message });
        return;
      }
    }

    const path = `${language}-${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: 'application/pdf' });
    if (uploadError) {
      button.disabled = false;
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('help.uploadFailed', { message: uploadError.message });
      return;
    }

    const { error: insertError } = await supabase.from('help_documents').insert({
      title: t('help.title'),
      storage_path: path,
      file_name: file.name,
      uploaded_by: currentUserId,
      version: (existingDoc?.version || 0) + 1,
      is_current: true,
      language,
    });

    button.disabled = false;
    if (insertError) {
      statusEl.className = 'text-sm text-rose-600 mb-2';
      statusEl.textContent = t('help.uploadFailed', { message: insertError.message });
      return;
    }

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

  return { open };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
