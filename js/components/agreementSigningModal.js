// Worker onboarding gate: before a member sees a department's real
// content, they must have signed the current version of both the
// church-wide rules (rules_documents, department_id null) and that
// department's own rules, if either exists (sql/085's rules_signatures
// records who signed which document version, immutably). No skip/close
// button — this is the one place "worker status is only active once
// all required agreements are signed" is actually enforced, at the
// UI level (deptDashboard.js / dashboard.js call this before rendering
// anything else for the department).
//
// ensureAgreementsSigned() resolves immediately (no modal shown at
// all) when nothing is outstanding — the common case after someone's
// already signed everything current.
import { t } from '../i18n.js';
import { createSignaturePad } from './signaturePad.js';

const SIGNED_URL_TTL_SECONDS = 300;

export async function ensureAgreementsSigned({ supabase, userId, departmentId }) {
  const { data: docs, error: docsError } = await supabase
    .from('rules_documents')
    .select('id, title, file_name, storage_path, department_id')
    .eq('is_current', true)
    .or(`department_id.is.null,department_id.eq.${departmentId}`);

  if (docsError || !docs || docs.length === 0) return;

  const { data: signed } = await supabase
    .from('rules_signatures')
    .select('rules_document_id')
    .eq('member_id', userId)
    .in('rules_document_id', docs.map((d) => d.id));

  const signedIds = new Set((signed || []).map((s) => s.rules_document_id));
  const pending = docs.filter((d) => !signedIds.has(d.id));
  if (pending.length === 0) return;

  await showSigningModal({ supabase, userId, documents: pending });
}

function showSigningModal({ supabase, userId, documents }) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4';
    root.innerHTML = `
      <div class="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <h2 class="text-xl font-bold mb-1">${t('agreementSigning.title')}</h2>
        <p data-el="progress" class="text-sm text-slate-500 mb-4"></p>
        <div class="bg-slate-50 rounded-lg p-4 mb-4">
          <p data-el="doc-title" class="font-medium text-slate-800 mb-2"></p>
          <button type="button" data-action="view-document" class="text-sm text-indigo-600 hover:text-indigo-800 font-medium underline">
            ${t('agreementSigning.viewDocument')}
          </button>
        </div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('myProfile.signature')}</label>
        <p class="text-xs text-slate-400 mb-1">${t('agreementSigning.signatureHint')}</p>
        <canvas data-el="signature-pad" width="440" height="140" class="w-full border border-slate-300 rounded-lg bg-white touch-none" style="max-width:440px;height:140px;"></canvas>
        <div class="flex items-center justify-between mt-2">
          <button type="button" data-action="clear-signature" class="text-xs text-slate-500 hover:text-slate-700 underline">${t('myProfile.clearSignature')}</button>
          <p data-el="status" class="text-sm text-rose-600"></p>
        </div>
        <button type="button" data-action="sign" class="w-full mt-4 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
          ${t('agreementSigning.signAndContinue')}
        </button>
      </div>
    `;
    document.body.appendChild(root);

    const progressEl = root.querySelector('[data-el="progress"]');
    const docTitleEl = root.querySelector('[data-el="doc-title"]');
    const statusEl = root.querySelector('[data-el="status"]');
    const signBtn = root.querySelector('[data-action="sign"]');
    const signaturePad = createSignaturePad(root.querySelector('[data-el="signature-pad"]'));

    let index = 0;

    function renderCurrent() {
      const doc = documents[index];
      progressEl.textContent = t('agreementSigning.progress', { current: index + 1, total: documents.length });
      docTitleEl.textContent = doc.title || doc.file_name;
      statusEl.textContent = '';
      signaturePad.clear();
    }

    root.querySelector('[data-action="view-document"]').addEventListener('click', async () => {
      const doc = documents[index];
      const { data, error } = await supabase.storage.from('rules').createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
      if (error || !data) {
        statusEl.textContent = t('rules.openFailed', { message: error?.message || '' });
        return;
      }
      window.open(data.signedUrl, '_blank', 'noopener');
    });

    root.querySelector('[data-action="clear-signature"]').addEventListener('click', () => signaturePad.clear());

    signBtn.addEventListener('click', async () => {
      if (signaturePad.isEmpty()) {
        statusEl.textContent = t('agreementSigning.signatureRequired');
        return;
      }

      signBtn.disabled = true;
      const doc = documents[index];
      const { error } = await supabase.from('rules_signatures').insert({
        rules_document_id: doc.id,
        member_id: userId,
        signature_data: signaturePad.toDataUrl(),
      });
      signBtn.disabled = false;

      if (error) {
        statusEl.textContent = t('agreementSigning.signFailed', { message: error.message });
        return;
      }

      index += 1;
      if (index >= documents.length) {
        document.body.removeChild(root);
        resolve();
        return;
      }
      renderCurrent();
    });

    renderCurrent();
  });
}
