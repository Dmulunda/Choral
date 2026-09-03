// Self-service "Report Absence" — any signed-in member, in any
// department, can flag any set of dates (consecutive or not — e.g. 4
// separate Sundays) they'll be unavailable, with an optional reason.
// Pick a date, click Add, repeat; each picked date shows as a
// removable chip. The report_absence() RPC (sql/055) loops the whole
// list internally — so Monthly Reports still count each day correctly
// and every date still gets its own conflict sync — but this only
// needs one form submission regardless of how many dates are picked.
import { confirmDialog } from './confirmDialog.js';
import { t } from '../i18n.js';
import { todayLocal } from '../utils/date.js';

export function createReportAbsenceModal({ supabase, onReported }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xl font-bold">${t('absence.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-xs text-slate-500 mb-4">${t('absence.intro')}</p>
      <form data-el="form" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('absence.dates')}</label>
          <div class="flex gap-2">
            <input type="date" data-el="date-picker" min="${todayLocal()}" class="flex-1 border border-slate-300 rounded-lg px-3 py-2" />
            <button type="button" data-action="add-date" class="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 whitespace-nowrap">
              ${t('absence.addDate')}
            </button>
          </div>
          <p class="text-xs text-slate-400 mt-1">${t('absence.datesHint')}</p>
          <div data-el="date-chips" class="flex flex-wrap gap-1.5 mt-2"></div>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('absence.reason')}</label>
          <textarea name="reason" rows="3" class="w-full border border-slate-300 rounded-lg px-3 py-2"></textarea>
        </div>
        <p data-el="form-status" class="text-sm"></p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" data-action="close" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">${t('common.cancel')}</button>
          <button type="submit" data-el="save-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('absence.submit')}
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(root);

  const form = root.querySelector('[data-el="form"]');
  const datePicker = root.querySelector('[data-el="date-picker"]');
  const chipsEl = root.querySelector('[data-el="date-chips"]');
  const formStatusEl = root.querySelector('[data-el="form-status"]');
  const saveBtn = root.querySelector('[data-el="save-btn"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  form.addEventListener('submit', handleSubmit);
  root.querySelector('[data-action="add-date"]').addEventListener('click', addDate);

  let dates = [];

  function addDate() {
    const value = datePicker.value;
    if (!value) return;
    if (!dates.includes(value)) {
      dates = [...dates, value].sort();
      renderChips();
    }
    datePicker.value = '';
    formStatusEl.textContent = '';
  }

  function removeDate(value) {
    dates = dates.filter((d) => d !== value);
    renderChips();
  }

  function renderChips() {
    chipsEl.innerHTML = dates.map((d) => `
      <span class="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-sm" data-chip="${d}">
        ${d}
        <button type="button" data-action="remove-date" data-date="${d}" class="text-indigo-400 hover:text-indigo-700 leading-none text-base">&times;</button>
      </span>
    `).join('');
    chipsEl.querySelectorAll('[data-action="remove-date"]').forEach((btn) => {
      btn.addEventListener('click', () => removeDate(btn.dataset.date));
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const reason = form.elements.reason.value.trim() || null;

    if (dates.length === 0) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('absence.noDatesPicked');
      return;
    }

    const confirmMessage = dates.length === 1
      ? t('absence.confirmSubmit', { date: dates[0] })
      : t('absence.confirmSubmitMulti', { count: dates.length, dates: dates.join(', ') });
    if (!(await confirmDialog({ message: confirmMessage, confirmLabel: t('absence.submit'), danger: false }))) return;

    saveBtn.disabled = true;
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { error } = await supabase.rpc('report_absence', { p_dates: dates, p_reason: reason });

    saveBtn.disabled = false;
    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('absence.submitFailed', { message: error.message });
      return;
    }

    formStatusEl.className = 'text-sm text-emerald-600';
    formStatusEl.textContent = t('absence.submitted');
    onReported?.();

    // Best-effort — the report itself already succeeded above. The
    // edge function derives which departments to notify (and builds
    // the message) from the caller's own identity server-side, so this
    // can't be used to notify anyone about anything other than the
    // reporter's own absence.
    supabase.functions.invoke('send-push', { body: { kind: 'absence_report', dates } }).catch(() => {});
  }

  function open(prefillDate) {
    form.reset();
    dates = prefillDate ? [prefillDate] : [];
    renderChips();
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
