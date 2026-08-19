// Self-service "Report Absence" — any signed-in member, in any
// department, can flag a date they'll be unavailable with an optional
// reason. The fan-out (to their departments' admins/secretaries plus
// every church-wide role) happens entirely inside the report_absence()
// RPC (sql/024), so this component just calls it and shows the result.
import { t } from '../i18n.js';

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
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('absence.date')}</label>
          <input type="date" name="date" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
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
  const formStatusEl = root.querySelector('[data-el="form-status"]');
  const saveBtn = root.querySelector('[data-el="save-btn"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  form.addEventListener('submit', handleSubmit);

  async function handleSubmit(e) {
    e.preventDefault();
    const date = form.elements.date.value;
    const reason = form.elements.reason.value.trim() || null;
    if (!date) return;

    saveBtn.disabled = true;
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { error } = await supabase.rpc('report_absence', { p_date: date, p_reason: reason });

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
