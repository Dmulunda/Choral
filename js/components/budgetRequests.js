// Finance budget/financial requests: a department's admin or secretary
// submits one (renderBudgetRequestForm, mounted on every other
// lightweight department's dashboard); Finance's own admins — plus
// every church-wide role, via can_manage_finance() in sql/027 — review
// and approve/reject them from within Finance's own department page
// (renderBudgetRequestsInbox).
import { confirmDialog } from './confirmDialog.js';
import { t, departmentLabel } from '../i18n.js';

export function renderBudgetRequestForm(container, { supabase, departmentId, currentUserId }) {
  container.innerHTML = `
    <h2 class="text-lg font-semibold mb-4">${t('finance.requestTitle')}</h2>
    <form data-el="form" class="space-y-3 mb-6 pb-6 border-b border-slate-200">
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('finance.titleLabel')}</label>
        <input type="text" name="title" required placeholder="${t('finance.titlePlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('finance.amountLabel')}</label>
        <input type="number" name="amount" step="0.01" min="0"
               class="w-full border border-slate-300 rounded-lg px-3 py-2" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('finance.descriptionLabel')}</label>
        <textarea name="description" rows="3" placeholder="${t('finance.descriptionPlaceholder')}"
                  class="w-full border border-slate-300 rounded-lg px-3 py-2"></textarea>
      </div>
      <div class="flex items-center gap-3">
        <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('finance.submit')}
        </button>
        <span data-el="form-status" class="text-sm text-slate-500"></span>
      </div>
    </form>
    <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('finance.myRequests')}</h3>
    <div data-el="list" class="space-y-2"></div>
  `;

  const form = container.querySelector('[data-el="form"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const listEl = container.querySelector('[data-el="list"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = form.elements.title.value.trim();
    const amount = form.elements.amount.value ? Number(form.elements.amount.value) : null;
    const description = form.elements.description.value.trim() || null;
    if (!title) return;

    if (!(await confirmDialog({ message: t('finance.confirmSubmit'), confirmLabel: t('finance.submit'), danger: false }))) return;

    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { error } = await supabase.from('budget_requests').insert({
      requesting_department_id: departmentId,
      requested_by: currentUserId,
      title,
      amount,
      description,
    });

    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('finance.submitFailed', { message: error.message });
      return;
    }

    form.reset();
    formStatusEl.className = 'text-sm text-emerald-600';
    formStatusEl.textContent = t('finance.submitted');
    load();
  });

  load();

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('budget_requests')
      .select('id, title, amount, status, created_at')
      .eq('requesting_department_id', departmentId)
      .order('created_at', { ascending: false });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('finance.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('finance.noRequests')}</p>`;
      return;
    }

    listEl.innerHTML = data.map((r) => `
      <div class="flex items-center justify-between gap-3 border border-slate-200 rounded-lg p-3">
        <div>
          <div class="font-medium text-slate-800">${escapeHtml(r.title)}${r.amount ? ` — ${formatAmount(r.amount)}` : ''}</div>
          <div class="text-xs text-slate-400">${escapeHtml(r.created_at.slice(0, 10))}</div>
        </div>
        ${statusBadge(r.status)}
      </div>
    `).join('');
  }
}

export function renderBudgetRequestsInbox(container, { supabase, adminUserId }) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
  load();

  async function load() {
    const { data, error } = await supabase
      .from('budget_requests')
      .select('id, title, amount, description, status, created_at, requester:profiles!requested_by ( full_name ), departments ( key )')
      .order('created_at', { ascending: false });

    if (error) {
      container.innerHTML = `<p class="text-sm text-rose-600">${t('finance.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      container.innerHTML = `<p class="text-sm text-slate-500">${t('finance.noRequests')}</p>`;
      return;
    }

    container.innerHTML = data.map((r) => `
      <div class="border border-slate-200 rounded-lg p-3 mb-2" data-row="${r.id}">
        <div class="flex items-center justify-between gap-3">
          <div class="font-medium text-slate-800">${escapeHtml(r.title)}${r.amount ? ` — ${formatAmount(r.amount)}` : ''}</div>
          ${statusBadge(r.status)}
        </div>
        <div class="text-xs text-slate-500 mt-1">
          ${t('finance.requestedBy')}: ${escapeHtml(r.requester?.full_name || '')} · ${r.departments ? departmentLabel(r.departments.key) : ''} · ${escapeHtml(r.created_at.slice(0, 10))}
        </div>
        ${r.description ? `<p class="text-sm text-slate-600 mt-2 whitespace-pre-wrap">${escapeHtml(r.description)}</p>` : ''}
        ${r.status === 'pending' ? `
          <div class="flex gap-2 mt-3">
            <button type="button" data-action="approve" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">${t('approvals.approve')}</button>
            <button type="button" data-action="reject" class="px-3 py-1.5 rounded-lg bg-rose-100 text-rose-700 text-sm font-medium hover:bg-rose-200">${t('approvals.reject')}</button>
          </div>
        ` : ''}
      </div>
    `).join('');

    container.querySelectorAll('[data-row]').forEach((rowEl) => {
      const id = rowEl.dataset.row;
      rowEl.querySelector('[data-action="approve"]')?.addEventListener('click', () => respond(id, 'approved'));
      rowEl.querySelector('[data-action="reject"]')?.addEventListener('click', () => respond(id, 'rejected'));
    });
  }

  async function respond(id, status) {
    const confirmLabel = status === 'approved' ? t('approvals.approve') : t('approvals.reject');
    if (!(await confirmDialog({ message: t('finance.confirmRespond', { status: confirmLabel.toLowerCase() }), confirmLabel, danger: status === 'rejected' }))) return;

    const { error } = await supabase
      .from('budget_requests')
      .update({ status, resolved_at: new Date().toISOString(), resolved_by: adminUserId })
      .eq('id', id);

    if (error) {
      window.alert(t('finance.updateFailed', { message: error.message }));
      return;
    }
    load();
  }
}

function statusBadge(status) {
  const classes = {
    pending: 'bg-amber-100 text-amber-700',
    approved: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-rose-100 text-rose-700',
  };
  return `<span class="px-2 py-0.5 rounded-full text-xs font-medium ${classes[status] || 'bg-slate-100 text-slate-600'}">${t(`finance.status.${status}`)}</span>`;
}

function formatAmount(amount) {
  return '$' + Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
