// Church Offering Registration — record individual offerings (name,
// date, amount, type) and see the current quarter's running ledger.
// Finance-only (can_manage_finance(), sql/054) end to end: the RLS
// insert/select policies are the real gate, this UI just mirrors it.
// Every 3 months the open period is automatically closed into a PDF
// and a new one starts (sql/055, server-side cron) — this page always
// shows whichever period is still open, plus a read-only history of
// past (closed) periods and their PDFs once generated.
import { t } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';
import { getGlobalRole } from '../departments.js';

const OFFERING_TYPES = ['tithe', 'general', 'sacrifice', 'construction', 'other'];

function centsToDollarsStr(cents) {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function renderOfferingsBoard(container, { supabase, currentUserId }) {
  const isSuperAdmin = getGlobalRole() === 'super_admin';

  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <h2 class="text-lg font-semibold mb-4">${t('offerings.recordTitle')}</h2>
      <form data-el="form" class="grid sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('offerings.donorName')}</label>
          <input type="text" name="donor_name" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('offerings.date')}</label>
          <input type="date" name="offering_date" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('offerings.amount')}</label>
          <input type="number" name="amount" min="0.01" step="0.01" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('offerings.type')}</label>
          <select name="offering_type" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            ${OFFERING_TYPES.map((v) => `<option value="${v}">${escapeHtml(t(`offerings.type.${v}`))}</option>`).join('')}
          </select>
        </div>
        <div class="sm:col-span-2 flex items-center gap-3">
          <button type="submit" data-el="submit-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('offerings.record')}
          </button>
          <span data-el="form-status" class="text-sm text-slate-500"></span>
        </div>
      </form>
    </div>

    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 class="text-lg font-semibold">${t('offerings.currentPeriodTitle')}</h2>
        <span data-el="period-total" class="text-sm font-semibold text-slate-700"></span>
      </div>
      <div data-el="list"></div>
    </div>

    <div class="bg-white rounded-xl shadow p-4 sm:p-6">
      <h2 class="text-lg font-semibold mb-4">${t('offerings.reportsTitle')}</h2>
      <p class="text-sm text-slate-500 mb-4">${t('offerings.reportsIntro')}</p>
      <div data-el="reports-list"></div>
    </div>
  `;

  const form = container.querySelector('[data-el="form"]');
  const submitBtn = form.querySelector('[data-el="submit-btn"]');
  const formStatusEl = form.querySelector('[data-el="form-status"]');
  const listEl = container.querySelector('[data-el="list"]');
  const periodTotalEl = container.querySelector('[data-el="period-total"]');
  const reportsListEl = container.querySelector('[data-el="reports-list"]');

  form.elements.offering_date.valueAsDate = new Date();
  form.addEventListener('submit', handleSubmit);

  loadCurrentPeriod();
  loadReportHistory();

  async function handleSubmit(e) {
    e.preventDefault();
    const donor_name = form.elements.donor_name.value.trim();
    const offering_date = form.elements.offering_date.value;
    const amountDollars = parseFloat(form.elements.amount.value);
    const offering_type = form.elements.offering_type.value;

    if (!donor_name || !offering_date || !(amountDollars > 0)) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('offerings.missingFields');
      return;
    }

    submitBtn.disabled = true;
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { error } = await supabase.from('offerings').insert({
      donor_name,
      offering_date,
      amount_cents: Math.round(amountDollars * 100),
      offering_type,
      recorded_by: currentUserId,
    });

    submitBtn.disabled = false;
    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('offerings.saveFailed', { message: error.message });
      return;
    }

    formStatusEl.className = 'text-sm text-emerald-600';
    formStatusEl.textContent = t('offerings.saved');
    form.reset();
    form.elements.offering_date.valueAsDate = new Date();
    loadCurrentPeriod();
  }

  // "Current period" = every offering not yet rolled into a closed
  // quarterly report (report_period_id is null) -- sql/055's cron
  // tags them once it closes the quarter, at which point they drop
  // off this list and the next entry starts a fresh one.
  async function loadCurrentPeriod() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase
      .from('offerings')
      .select('id, donor_name, offering_date, amount_cents, offering_type, recorded_by, recorder:profiles!recorded_by ( full_name )')
      .is('report_period_id', null)
      .order('offering_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('offerings.loadFailed', { message: error.message })}</p>`;
      periodTotalEl.textContent = '';
      return;
    }

    const total = (data || []).reduce((sum, row) => sum + row.amount_cents, 0);
    periodTotalEl.textContent = t('offerings.periodTotal', { amount: centsToDollarsStr(total) });

    if (!data || data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-400">${t('offerings.none')}</p>`;
      return;
    }

    listEl.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-slate-500 border-b border-slate-200">
              <th class="py-2 pr-3">${t('offerings.date')}</th>
              <th class="py-2 pr-3">${t('offerings.donorName')}</th>
              <th class="py-2 pr-3">${t('offerings.type')}</th>
              <th class="py-2 pr-3 text-right">${t('offerings.amount')}</th>
              <th class="py-2 pr-3">${t('offerings.recordedBy')}</th>
              <th class="py-2"></th>
            </tr>
          </thead>
          <tbody data-el="rows"></tbody>
        </table>
      </div>
    `;
    const rowsEl = listEl.querySelector('[data-el="rows"]');
    rowsEl.innerHTML = data.map((row) => {
      const canEdit = row.recorded_by === currentUserId || isSuperAdmin;
      return `
        <tr class="border-b border-slate-100" data-row-id="${row.id}">
          <td class="py-2 pr-3 whitespace-nowrap">${escapeHtml(row.offering_date)}</td>
          <td class="py-2 pr-3">${escapeHtml(row.donor_name)}</td>
          <td class="py-2 pr-3">${escapeHtml(t(`offerings.type.${row.offering_type}`))}</td>
          <td class="py-2 pr-3 text-right whitespace-nowrap">$${centsToDollarsStr(row.amount_cents)}</td>
          <td class="py-2 pr-3 text-slate-500">${escapeHtml(row.recorder?.full_name || '—')}</td>
          <td class="py-2 text-right">${canEdit ? `<button type="button" data-action="delete" class="text-xs text-rose-600 hover:text-rose-700">${t('offerings.delete')}</button>` : ''}</td>
        </tr>
      `;
    }).join('');

    rowsEl.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('[data-row-id]');
        const id = row.dataset.rowId;
        const name = row.querySelector('td:nth-child(2)').textContent;
        const ok = await confirmDialog({ message: t('offerings.deleteConfirm', { name }) });
        if (!ok) return;
        await supabase.from('offerings').delete().eq('id', id);
        loadCurrentPeriod();
      });
    });
  }

  async function loadReportHistory() {
    reportsListEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase
      .from('offering_report_periods')
      .select('id, period_start, period_end, status, pdf_storage_path, generated_at')
      .order('period_start', { ascending: false });

    if (error) {
      reportsListEl.innerHTML = `<p class="text-sm text-rose-600">${t('offerings.loadFailed', { message: error.message })}</p>`;
      return;
    }
    if (!data || data.length === 0) {
      reportsListEl.innerHTML = `<p class="text-sm text-slate-400">${t('offerings.noReports')}</p>`;
      return;
    }

    reportsListEl.innerHTML = data.map((row) => `
      <div class="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 text-sm">
        <span>${escapeHtml(row.period_start)} — ${escapeHtml(row.period_end)}</span>
        <span>${row.pdf_storage_path
          ? `<a href="#" data-period-id="${escapeAttr(row.id)}" class="text-indigo-600 hover:text-indigo-700 font-medium" data-action="download">${t('offerings.downloadPdf')}</a>`
          : `<span class="text-slate-400">${t('offerings.pdfPending')}</span>`}</span>
      </div>
    `).join('');

    // PDFs live in Cloudflare R2 (offering-reports Edge Function), not
    // Supabase Storage -- the function re-checks can_manage_finance()
    // itself server-side before handing back a short-lived signed URL,
    // same "never trust the client" pattern as course-video-r2.
    reportsListEl.querySelectorAll('[data-action="download"]').forEach((link) => {
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        const periodId = link.dataset.periodId;
        const { data, error } = await supabase.functions.invoke('offering-reports', {
          body: { action: 'download_url', period_id: periodId },
        });
        if (error || !data?.url) {
          window.alert(t('offerings.downloadFailed', { message: error?.message || 'Unknown error' }));
          return;
        }
        window.open(data.url, '_blank');
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replaceAll('"', '&quot;');
  }
}
