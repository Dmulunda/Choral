// Member-facing Tax / Impôts tab content: a running per-year total of
// what they've given (always visible, even for the current open year),
// a prompt to set their Legal Name if it's still empty (required
// before any receipt can be issued for them -- see
// finalize_tax_receipt_year() in sql/saas_platform/31_tax_receipts_rpcs.sql),
// and -- for any year Finance has finalized -- their official receipt
// with a Download PDF button.
//
// PDF building (html2canvas + jsPDF against a styled on-page template)
// lives in js/utils/taxReceiptPdf.js -- shared with
// taxReceiptsAdminBoard.js, which builds the identical PDF for a Guest
// Donor (no app account) and emails it instead of downloading it.
import { t } from '../i18n.js';
import { createMyProfileModal } from './myProfileModal.js';
import { receiptPdfAvailable, buildReceiptPdfBlob, shareOrDownloadPdf } from '../utils/taxReceiptPdf.js';

export async function renderTaxReceiptsMemberBoard(container, { supabase, userId }) {
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const [{ data: profile, error: profileError }, { data: entries, error: entriesError }, { data: years }, { data: receipts }] = await Promise.all([
    supabase.from('profiles').select('legal_name').eq('id', userId).single(),
    supabase.from('donation_entries').select('fiscal_year, amount').eq('member_id', userId),
    supabase.from('tax_receipt_years').select('fiscal_year, status'),
    supabase.from('tax_receipts').select('fiscal_year, receipt_number, total_amount, legal_name_snapshot, tenant_info_snapshot, issued_at').eq('member_id', userId),
  ]);

  if (profileError || entriesError) {
    container.innerHTML = `<p class="text-sm text-rose-600">${t('taxMember.loadFailed', { message: (profileError || entriesError).message })}</p>`;
    return;
  }

  const statusByYear = new Map((years || []).map((y) => [y.fiscal_year, y.status]));
  const receiptByYear = new Map((receipts || []).map((r) => [r.fiscal_year, r]));
  const totalByYear = new Map();
  (entries || []).forEach((e) => {
    totalByYear.set(e.fiscal_year, (totalByYear.get(e.fiscal_year) || 0) + Number(e.amount));
  });

  const fiscalYears = Array.from(new Set([...totalByYear.keys(), ...receiptByYear.keys()])).sort((a, b) => b - a);

  container.innerHTML = `
    ${!profile?.legal_name ? `
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 flex items-center justify-between gap-3 flex-wrap">
        <p class="text-sm text-amber-800">${t('taxMember.legalNameMissing')}</p>
        <button type="button" data-action="set-legal-name" class="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 whitespace-nowrap">
          ${t('taxMember.setLegalName')}
        </button>
      </div>
    ` : ''}
    ${fiscalYears.length === 0
      ? `<p class="text-slate-500 bg-white rounded-xl shadow p-4 sm:p-6">${t('taxMember.none')}</p>`
      : `<div data-el="years"></div>`}
  `;

  container.querySelector('[data-action="set-legal-name"]')?.addEventListener('click', () => {
    createMyProfileModal({ supabase, userId }).open();
  });

  const yearsEl = container.querySelector('[data-el="years"]');
  if (!yearsEl) return;

  yearsEl.innerHTML = fiscalYears.map((year) => {
    const total = totalByYear.get(year) || 0;
    const status = statusByYear.get(year) || 'open';
    const receipt = receiptByYear.get(year);
    return `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-3">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div class="text-lg font-semibold text-slate-800">${year}</div>
            <div class="text-sm text-slate-500">${t('taxMember.totalGiven', { amount: formatAmount(total) })}</div>
          </div>
          ${receipt ? `
            <div class="text-right">
              <div class="text-xs text-slate-400">${t('taxMember.receiptNumber', { number: receipt.receipt_number })}</div>
              <button type="button" data-action="download" data-year="${year}" class="mt-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
                ${t('taxMember.downloadPdf')}
              </button>
            </div>
          ` : `
            <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
              ${status === 'finalized' ? t('taxMember.noReceiptThisYear') : t('taxMember.notFinalizedYet')}
            </span>
          `}
        </div>
        ${receipt ? `<div data-el="receipt-status-${year}" class="text-xs text-slate-400 mt-2"></div>` : ''}
      </div>
    `;
  }).join('');

  yearsEl.querySelectorAll('[data-action="download"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const year = Number(btn.dataset.year);
      const receipt = receiptByYear.get(year);
      const statusEl = yearsEl.querySelector(`[data-el="receipt-status-${year}"]`);
      downloadReceiptPdf(receipt, statusEl);
    });
  });
}

function formatAmount(amount) {
  return '$' + Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function downloadReceiptPdf(receipt, statusEl) {
  if (!receiptPdfAvailable()) { statusEl.textContent = t('taxMember.exportUnavailable'); return; }
  statusEl.textContent = t('common.loading');
  const blob = await buildReceiptPdfBlob(receipt);
  await shareOrDownloadPdf(new File([blob], `tax-receipt-${receipt.fiscal_year}.pdf`, { type: 'application/pdf' }), statusEl);
}
