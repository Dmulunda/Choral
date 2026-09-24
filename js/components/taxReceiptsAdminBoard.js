// Finance admin's Tax Receipts board -- Tax Settings + donation
// spreadsheet import (both modals, see taxReceiptSettingsModal.js /
// taxDonationImport.js) plus a per-fiscal-year list of running totals
// with a Finalize action. Only reachable via budgetCentralBoard.js's
// oversight-only third tab (hasFinanceOversight()) -- matches how the
// Reimbursements inbox there is oversight-only too, since this is a
// church-wide financial/legal feature, not a per-department one.
import { t } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';
import { createTaxReceiptSettingsModal } from './taxReceiptSettingsModal.js';
import { createTaxDonationImportModal } from './taxDonationImport.js';

export function renderTaxReceiptsAdminBoard(container, { supabase, currentUserId }) {
  container.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <button type="button" data-action="settings" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('taxAdmin.settingsButton')}</button>
      <button type="button" data-action="import" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('taxAdmin.importButton')}</button>
    </div>
    <div data-el="years-list"><p class="text-sm text-slate-500">${t('common.loading')}</p></div>
  `;

  const yearsListEl = container.querySelector('[data-el="years-list"]');

  const settingsModal = createTaxReceiptSettingsModal({ supabase, currentUserId });
  const importModal = createTaxDonationImportModal({ supabase, currentUserId, onImported: loadYears });

  container.querySelector('[data-action="settings"]').addEventListener('click', () => settingsModal.open());
  container.querySelector('[data-action="import"]').addEventListener('click', () => importModal.open());

  loadYears();

  async function loadYears() {
    yearsListEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const [{ data: entries, error: entriesError }, { data: years, error: yearsError }] = await Promise.all([
      supabase.from('donation_entries').select('fiscal_year, amount, member_id'),
      supabase.from('tax_receipt_years').select('fiscal_year, status'),
    ]);

    if (entriesError || yearsError) {
      yearsListEl.innerHTML = `<p class="text-sm text-rose-600">${t('taxAdmin.loadFailed', { message: (entriesError || yearsError).message })}</p>`;
      return;
    }

    const statusByYear = new Map((years || []).map((y) => [y.fiscal_year, y.status]));
    const byYear = new Map();
    (entries || []).forEach((e) => {
      if (!byYear.has(e.fiscal_year)) byYear.set(e.fiscal_year, { total: 0, members: new Set(), unmatchedTotal: 0 });
      const entry = byYear.get(e.fiscal_year);
      if (e.member_id) { entry.total += Number(e.amount); entry.members.add(e.member_id); }
      else entry.unmatchedTotal += Number(e.amount);
    });
    // A year Finance already finalized but that has no donation_entries
    // rows anymore (shouldn't normally happen) still needs to show up.
    (years || []).forEach((y) => { if (!byYear.has(y.fiscal_year)) byYear.set(y.fiscal_year, { total: 0, members: new Set(), unmatchedTotal: 0 }); });

    if (byYear.size === 0) {
      yearsListEl.innerHTML = `<p class="text-sm text-slate-500">${t('taxAdmin.noData')}</p>`;
      return;
    }

    const fiscalYears = Array.from(byYear.keys()).sort((a, b) => b - a);
    yearsListEl.innerHTML = fiscalYears.map((year) => {
      const entry = byYear.get(year);
      const status = statusByYear.get(year) || 'open';
      return `
        <div class="border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3 mb-2">
          <div>
            <div class="font-semibold text-slate-800">${year}</div>
            <div class="text-sm text-slate-500">${t('taxAdmin.yearSummary', { total: formatAmount(entry.total), members: entry.members.size })}</div>
            ${entry.unmatchedTotal > 0 ? `<div class="text-xs text-amber-600 mt-0.5">${t('taxAdmin.unmatchedTotal', { amount: formatAmount(entry.unmatchedTotal) })}</div>` : ''}
          </div>
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded-full text-xs font-medium ${status === 'finalized' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
              ${status === 'finalized' ? t('taxAdmin.statusFinalized') : t('taxAdmin.statusOpen')}
            </span>
            <button type="button" data-action="finalize" data-year="${year}" class="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-900">
              ${status === 'finalized' ? t('taxAdmin.reFinalizeButton') : t('taxAdmin.finalizeButton')}
            </button>
          </div>
        </div>
      `;
    }).join('');

    yearsListEl.querySelectorAll('[data-action="finalize"]').forEach((btn) => {
      btn.addEventListener('click', () => finalizeYear(Number(btn.dataset.year)));
    });
  }

  async function finalizeYear(year) {
    if (!(await confirmDialog({
      message: t('taxAdmin.confirmFinalize', { year }),
      confirmLabel: t('taxAdmin.finalizeButton'),
      danger: false,
    }))) return;

    const { data, error } = await supabase.rpc('finalize_tax_receipt_year', { p_fiscal_year: year });

    if (error) {
      window.alert(t('taxAdmin.finalizeFailed', { message: error.message }));
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    const skipped = result?.skipped_members || [];
    let message = t('taxAdmin.finalizeSuccess', { count: result?.issued_count ?? 0 });
    if (skipped.length > 0) {
      message += '\n\n' + t('taxAdmin.finalizeSkipped', { names: skipped.map((m) => m.full_name).join(', ') });
    }
    window.alert(message);
    loadYears();
  }
}

function formatAmount(amount) {
  return '$' + Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
