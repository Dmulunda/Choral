// Self-service "Report Absence" — any signed-in member, in any
// department, can flag one day or a whole date range (even spanning
// months) they'll be unavailable, with an optional reason. The
// report_absence() RPC (sql/052) loops one day at a time internally —
// so Monthly Reports still count each day correctly and every date
// still gets its own conflict sync — but this only needs one form
// submission regardless of how many days are covered.
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
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('absence.startDate')}</label>
            <input type="date" name="start_date" required min="${todayLocal()}" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('absence.endDate')}</label>
            <input type="date" name="end_date" min="${todayLocal()}" placeholder="${t('absence.endDateOptional')}" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
        </div>
        <p class="text-xs text-slate-400 -mt-2">${t('absence.endDateHint')}</p>
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
  const formStatusEl = root.querySelector('[data-el="form-status"]');
  const saveBtn = root.querySelector('[data-el="save-btn"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  form.addEventListener('submit', handleSubmit);

  // The end date can't be before whatever start date was just picked.
  form.elements.start_date.addEventListener('change', () => {
    form.elements.end_date.min = form.elements.start_date.value || todayLocal();
  });

  async function handleSubmit(e) {
    e.preventDefault();
    const startDate = form.elements.start_date.value;
    const endDate = form.elements.end_date.value || startDate;
    const reason = form.elements.reason.value.trim() || null;
    if (!startDate) return;

    if (endDate < startDate) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('absence.endBeforeStart');
      return;
    }

    const confirmMessage = endDate === startDate
      ? t('absence.confirmSubmit', { date: startDate })
      : t('absence.confirmSubmitRange', { start: startDate, end: endDate });
    if (!(await confirmDialog({ message: confirmMessage, confirmLabel: t('absence.submit'), danger: false }))) return;

    saveBtn.disabled = true;
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { error } = await supabase.rpc('report_absence', { p_start_date: startDate, p_end_date: endDate, p_reason: reason });

    saveBtn.disabled = false;
    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('absence.submitFailed', { message: error.message });
      return;
    }

    formStatusEl.className = 'text-sm text-emerald-600';
    formStatusEl.textContent = t('absence.submitted');
    onReported?.();
  }

  function open() {
    form.reset();
    form.elements.end_date.min = todayLocal();
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
