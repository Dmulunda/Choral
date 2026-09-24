// Member-facing Tax / Impôts tab content: a running per-year total of
// what they've given (always visible, even for the current open year),
// a prompt to set their Legal Name if it's still empty (required
// before any receipt can be issued for them -- see
// finalize_tax_receipt_year() in sql/saas_platform/31_tax_receipts_rpcs.sql),
// and -- for any year Finance has finalized -- their official receipt
// with a Download PDF button.
//
// PDF generation reuses memberIdCard.js's exact pattern: render the
// receipt as a styled on-page template, screenshot it with
// html2canvas, embed the PNG into a jsPDF doc, hand it to the same
// share-sheet-first / download-link-fallback delivery every other PDF
// export in this app already uses.
import { t } from '../i18n.js';
import { createMyProfileModal } from './myProfileModal.js';

const RECEIPT_WIDTH = 850;
const RECEIPT_HEIGHT = 1100;

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
  if (!window.html2canvas || !window.jspdf) { statusEl.textContent = t('taxMember.exportUnavailable'); return; }
  statusEl.textContent = t('common.loading');

  const settings = receipt.tenant_info_snapshot || {};
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed;left:-9999px;top:0;width:${RECEIPT_WIDTH}px;height:${RECEIPT_HEIGHT}px;background:#ffffff;padding:48px;box-sizing:border-box;font-family:Georgia,serif;color:#1e293b;`;
  wrap.innerHTML = `
    <div style="text-align:center;border-bottom:2px solid #1e293b;padding-bottom:16px;margin-bottom:24px;">
      <div style="font-size:20px;font-weight:700;">${escapeHtml(settings.legal_name || '')}</div>
      ${settings.address ? `<div style="font-size:12px;color:#475569;margin-top:4px;">${escapeHtml(settings.address)}</div>` : ''}
      ${settings.charity_registration_number ? `<div style="font-size:12px;color:#475569;margin-top:2px;">${escapeHtml(t('taxReceiptDoc.charityNumberLabel'))}: ${escapeHtml(settings.charity_registration_number)}</div>` : ''}
    </div>
    <div style="text-align:center;font-size:16px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:24px;">
      ${escapeHtml(t('taxReceiptDoc.title'))}
    </div>
    <table style="width:100%;font-size:14px;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#64748b;">${escapeHtml(t('taxReceiptDoc.receiptNumberLabel'))}</td><td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(receipt.receipt_number)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">${escapeHtml(t('taxReceiptDoc.issuedOnLabel'))}</td><td style="padding:6px 0;text-align:right;">${escapeHtml(new Date(receipt.issued_at).toLocaleDateString())}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">${escapeHtml(t('taxReceiptDoc.fiscalYearLabel'))}</td><td style="padding:6px 0;text-align:right;">${receipt.fiscal_year}</td></tr>
      <tr><td style="padding:14px 0 6px;color:#64748b;border-top:1px solid #e2e8f0;">${escapeHtml(t('taxReceiptDoc.donorNameLabel'))}</td><td style="padding:14px 0 6px;text-align:right;font-weight:600;border-top:1px solid #e2e8f0;">${escapeHtml(receipt.legal_name_snapshot)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">${escapeHtml(t('taxReceiptDoc.totalAmountLabel'))}</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:18px;">${formatAmount(receipt.total_amount)}</td></tr>
    </table>
    <p style="font-size:11px;color:#64748b;margin-top:32px;line-height:1.5;">${escapeHtml(t('taxReceiptDoc.disclaimer'))}</p>
    <div style="margin-top:56px;display:flex;justify-content:space-between;align-items:flex-end;">
      <div>
        ${settings.signature_data ? `<img src="${settings.signature_data}" style="height:60px;display:block;margin-bottom:4px;" />` : '<div style="height:60px;"></div>'}
        <div style="border-top:1px solid #1e293b;padding-top:4px;font-size:12px;">
          ${escapeHtml(settings.signing_authority_name || '')}${settings.signing_authority_title ? ` — ${escapeHtml(settings.signing_authority_title)}` : ''}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'px', format: [RECEIPT_WIDTH, RECEIPT_HEIGHT] });
    const canvas = await window.html2canvas(wrap, { backgroundColor: '#ffffff', scale: 2 });
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, RECEIPT_WIDTH, RECEIPT_HEIGHT);
    const blob = doc.output('blob');
    await shareOrDownload(new File([blob], `tax-receipt-${receipt.fiscal_year}.pdf`, { type: 'application/pdf' }), statusEl);
  } finally {
    wrap.remove();
  }
}

async function shareOrDownload(file, statusEl) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      statusEl.textContent = '';
      return;
    } catch (err) {
      if (err?.name === 'AbortError') { statusEl.textContent = ''; return; }
    }
  }
  const link = document.createElement('a');
  link.download = file.name;
  link.href = URL.createObjectURL(file);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  statusEl.textContent = '';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
