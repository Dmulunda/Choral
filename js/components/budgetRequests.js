// Finance budget/financial requests, open to any approved member of a
// department (not admin-only — see the insert policy in sql/028), for
// a specific budget month. Both the submit form and Finance's review
// board are pop-up modals (same createXModal({ ... }) => { open } shape
// as every other modal in this app) — a button on the dashboard opens
// them, so they don't take up permanent space when not in use.
// createBudgetRequestModal is mounted on every department's dashboard;
// createBudgetRequestsInboxModal is Finance's own — admins only (plus
// every church-wide role, via can_manage_finance() in sql/027).
import { confirmDialog } from './confirmDialog.js';
import { t, departmentLabel } from '../i18n.js';

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function createBudgetRequestModal({ supabase, departmentId, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('finance.requestFunds')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    renderFormBody(root.querySelector('[data-el="body"]'), { supabase, departmentId, currentUserId });
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}

export function createBudgetRequestsInboxModal({ supabase, adminUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('finance.inboxTitle')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    renderInboxBody(root.querySelector('[data-el="body"]'), { supabase, adminUserId });
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}

function renderFormBody(container, { supabase, departmentId, currentUserId }) {
  container.innerHTML = `
    <form data-el="form" class="space-y-3 mb-6 pb-6 border-b border-slate-200">
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('finance.titleLabel')}</label>
        <input type="text" name="title" required placeholder="${t('finance.titlePlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('finance.monthLabel')}</label>
        <input type="month" name="request_month" required value="${currentMonthValue()}"
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
    const requestMonth = form.elements.request_month.value;
    const amount = form.elements.amount.value ? Number(form.elements.amount.value) : null;
    const description = form.elements.description.value.trim() || null;
    if (!title || !requestMonth) return;

    if (!(await confirmDialog({ message: t('finance.confirmSubmit'), confirmLabel: t('finance.submit'), danger: false }))) return;

    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { error } = await supabase.from('budget_requests').insert({
      requesting_department_id: departmentId,
      requested_by: currentUserId,
      title,
      request_month: `${requestMonth}-01`,
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
      .select('id, title, amount, request_month, status, created_at')
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
          <div class="text-xs text-slate-400">${formatMonth(r.request_month)} · ${escapeHtml(r.created_at.slice(0, 10))}</div>
        </div>
        ${statusBadge(r.status)}
      </div>
    `).join('');
  }
}

function renderInboxBody(container, { supabase, adminUserId }) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
  load();

  async function load() {
    const { data, error } = await supabase
      .from('budget_requests')
      .select('id, title, amount, description, request_month, status, created_at, requester:profiles!requested_by ( full_name ), departments ( key )')
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
          ${t('finance.requestedBy')}: ${escapeHtml(r.requester?.full_name || '')} · ${r.departments ? departmentLabel(r.departments.key) : ''} · ${formatMonth(r.request_month)} · ${escapeHtml(r.created_at.slice(0, 10))}
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

function formatMonth(dateStr) {
  if (!dateStr) return '';
  const [year, month] = dateStr.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
