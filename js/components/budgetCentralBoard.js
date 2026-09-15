// Finance/Budget — centralized page (js/budgetPage.js is the tab entry
// point). Two tabs: Fund Request and Budget Report, both filterable by
// month and department. Which of two audiences a viewer gets is decided
// once, client-side, purely to pick which UI to show — the real
// boundary is RLS (can_manage_finance() vs can_read_department()),
// already enforced identically regardless of what this file renders:
//   - Finance oversight (hasFinanceOversight(), departments.js): every
//     department's requests/spending, both filters live, a
//     pending-count badge on the Fund Request tab.
//   - Ordinary department admin/secretary: their own department's
//     request form + history, and their own department's spending only
//     (department filter hidden -- there's only ever one answer).
// Nobody else ever reaches this file at all -- js/app.js only
// constructs the nav button/tab for hasAnyDeptLeadership().
import { t, departmentLabel } from '../i18n.js';
import { hasFinanceOversight, getMyDepartments } from '../departments.js';
import { renderMyFundRequests, renderFundRequestsInbox } from './budgetRequests.js';
import { renderBudgetBoard } from './budgetBoard.js';

export async function renderBudgetCentralBoard(container, { supabase, currentUserId }) {
  const oversight = hasFinanceOversight();
  // A Pastor/Church Secretary/Super Admin gets oversight without being a
  // Finance department member at all -- they're an auditor here, not a
  // manager, so no "own budget" to run. A Finance admin/secretary is
  // both: full cross-department audit AND a real department that spends
  // its own money, so they additionally get the same manage-my-budget
  // section every other department's admin/secretary gets.
  const financeDept = getMyDepartments().find((d) => d.key === 'finance' && (d.role === 'admin' || d.role === 'secretary'));

  // The department(s) this viewer is actually scoped to -- for the
  // report/request views below, and for the oversight department filter's
  // options (every department) vs. a scoped admin's fixed single department.
  let scopedDepartments = [];
  if (oversight) {
    const { data } = await supabase.from('departments').select('id, key, name').order('name');
    scopedDepartments = data || [];
  } else {
    scopedDepartments = getMyDepartments().filter((d) => d.role === 'admin' || d.role === 'secretary');
  }

  if (scopedDepartments.length === 0) {
    // Shouldn't normally happen -- hasAnyDeptLeadership() is what gates
    // reaching this page at all -- but a role change mid-session (View-As,
    // Standard User Mode toggle) could land here with nothing to show.
    container.innerHTML = `<p class="text-sm text-slate-500">${t('budgetPage.noAccess')}</p>`;
    return;
  }

  container.innerHTML = `
    <div class="flex gap-2 mb-4">
      <button type="button" data-action="tab-requests" class="px-4 py-2 rounded-lg text-sm font-medium">
        ${t('budgetPage.fundRequestTab')}
        <span data-el="pending-badge" class="hidden ml-1.5 px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-xs font-bold"></span>
      </button>
      <button type="button" data-action="tab-report" class="px-4 py-2 rounded-lg text-sm font-medium">${t('budgetPage.budgetReportTab')}</button>
    </div>
    <div data-el="body"></div>
  `;

  const bodyEl = container.querySelector('[data-el="body"]');
  const tabRequestsBtn = container.querySelector('[data-action="tab-requests"]');
  const tabReportBtn = container.querySelector('[data-action="tab-report"]');
  const badgeEl = container.querySelector('[data-el="pending-badge"]');

  function setTabStyle(btn, active) {
    btn.classList.toggle('bg-indigo-600', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('text-slate-600', !active);
    btn.classList.toggle('hover:bg-slate-100', !active);
  }

  function activate(tab) {
    setTabStyle(tabRequestsBtn, tab === 'requests');
    setTabStyle(tabReportBtn, tab === 'report');
    if (tab === 'requests') renderRequestsTab();
    else renderReportTab();
  }

  tabRequestsBtn.addEventListener('click', () => activate('requests'));
  tabReportBtn.addEventListener('click', () => activate('report'));
  activate('requests');

  function renderRequestsTab() {
    if (oversight) {
      renderFundRequestsInbox(bodyEl, {
        supabase,
        adminUserId: currentUserId,
        departments: scopedDepartments,
        onPendingCountChange: (count) => {
          badgeEl.textContent = String(count);
          badgeEl.classList.toggle('hidden', count === 0);
        },
      });
    } else {
      // Only ever their own department -- scopedDepartments has exactly
      // one entry in this branch (see the fallback message above for the
      // zero case).
      renderMyFundRequests(bodyEl, { supabase, departmentId: scopedDepartments[0].id, currentUserId });
    }
  }

  function renderReportTab() {
    renderBudgetReport(bodyEl, { supabase, oversight, departments: scopedDepartments, currentUserId, financeDept });
  }
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(monthValue) {
  const [year, month] = monthValue.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

async function renderBudgetReport(container, { supabase, oversight, departments, currentUserId, financeDept }) {
  // Aggregate totals below are read-only by design (spec: "totals per
  // department per month, not a line-by-line transaction feed") -- but
  // someone still has to be able to log an expense in the first place.
  // Reuses the same card-list + detail-modal (New Expense/Export PDF/
  // status) this app already had nested per-department:
  //   - a plain department's own admin/secretary manages their own
  //     department, budgets always approval-gated (allowManualCreate: false).
  //   - a Finance admin/secretary manages Finance's own budget the same
  //     way it always worked -- direct creation (allowManualCreate: true).
  //   - a Pastor/Church Secretary/Super Admin with no Finance membership
  //     is an auditor here, not a manager -- no manage section at all.
  const manageDepartmentId = !oversight ? departments[0].id : (financeDept ? financeDept.id : null);
  const allowManualCreate = !!financeDept;

  container.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <input type="month" data-el="month-filter" value="${currentMonthValue()}" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
      ${oversight ? `
        <select data-el="department-filter" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="">${t('finance.allDepartments')}</option>
          ${departments.map((d) => `<option value="${d.id}">${escapeHtml(departmentLabel(d.key))}</option>`).join('')}
        </select>
      ` : ''}
    </div>
    <div data-el="report"><p class="text-sm text-slate-500">${t('common.loading')}</p></div>
    ${manageDepartmentId ? `
      <div class="mt-6 pt-6 border-t border-slate-200">
        <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('budgetPage.manageBudgets')}</h3>
        <div data-el="manage"></div>
      </div>
    ` : ''}
  `;

  const reportEl = container.querySelector('[data-el="report"]');
  const monthFilterEl = container.querySelector('[data-el="month-filter"]');
  const deptFilterEl = container.querySelector('[data-el="department-filter"]');

  monthFilterEl.addEventListener('change', load);
  deptFilterEl?.addEventListener('change', load);

  if (manageDepartmentId) {
    renderBudgetBoard(container.querySelector('[data-el="manage"]'), {
      supabase, departmentId: manageDepartmentId, currentUserId, canManage: true, allowManualCreate,
    });
  }

  load();

  async function load() {
    reportEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { start, end } = monthRange(monthFilterEl.value || currentMonthValue());

    let query = supabase
      .from('budget_transactions')
      .select('amount, created_at, budgets!inner ( department_id, departments!inner ( key, name ) )')
      .gte('created_at', start)
      .lt('created_at', end);
    if (deptFilterEl?.value) query = query.eq('budgets.department_id', deptFilterEl.value);

    const { data, error } = await query;

    if (error) {
      reportEl.innerHTML = `<p class="text-sm text-rose-600">${t('budgetPage.reportLoadFailed', { message: error.message })}</p>`;
      return;
    }

    // Not a transaction feed -- only a department (never an individual)
    // can hold a fund request, so the department is the right unit of
    // aggregation here; totals per department for the selected month.
    const totals = new Map();
    (data || []).forEach((tx) => {
      const dept = tx.budgets.departments;
      const key = dept.key;
      if (!totals.has(key)) totals.set(key, { name: dept.name, total: 0, count: 0 });
      const entry = totals.get(key);
      entry.total += Number(tx.amount);
      entry.count += 1;
    });

    if (totals.size === 0) {
      reportEl.innerHTML = `<p class="text-sm text-slate-500">${t('budgetPage.noSpending')}</p>`;
      return;
    }

    const rows = Array.from(totals.entries()).sort((a, b) => b[1].total - a[1].total);
    reportEl.innerHTML = `
      <div class="space-y-2">
        ${rows.map(([key, entry]) => `
          <div class="flex items-center justify-between border border-slate-200 rounded-lg p-3">
            <div class="font-medium text-slate-800">${escapeHtml(departmentLabel(key) || entry.name)}</div>
            <div class="text-right">
              <div class="font-semibold">${formatAmount(entry.total)}</div>
              <div class="text-xs text-slate-400">${t('budget.transactionCount', { count: entry.count })}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }
}

function formatAmount(amount) {
  return '$' + Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
