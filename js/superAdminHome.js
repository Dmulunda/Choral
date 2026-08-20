// Super Admin Home tab entry point: where a global-role holder
// (Super Admin, Super Viewer, Pastor Admin, Church Secretary) lands
// first — clickable metrics, every pending membership request across
// every department (the actual fix for "Super Admin can't approve" —
// the RLS already allowed it, there was just no cross-department view
// to find them in), a per-department report table, and the full
// cross-department User Directory. Department views only load once
// explicitly picked from the switcher/nav.
import { getEffectiveSupabase } from './departments.js';
import { renderUserManager } from './components/userManager.js';
import { renderAllDepartmentApprovals } from './components/allDepartmentApprovals.js';
import { t, departmentLabel } from './i18n.js';

export async function renderSuperAdminHomeTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#super-home-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  container.innerHTML = `
    <div data-el="metrics"></div>

    <div id="super-home-pending" class="bg-white rounded-xl shadow p-4 sm:p-6 mt-6">
      <h2 class="text-lg font-semibold mb-4">${t('superHome.pendingTitle')}</h2>
      <div data-el="pending"></div>
    </div>

    <div id="super-home-reports" class="bg-white rounded-xl shadow p-4 sm:p-6 mt-6">
      <h2 class="text-lg font-semibold mb-4">${t('superHome.reportsTitle')}</h2>
      <div data-el="reports"></div>
    </div>

    <div id="super-home-directory" class="mt-6">
      <h2 class="text-lg font-semibold mb-4">${t('directory.title')}</h2>
      <div data-el="directory"></div>
    </div>
  `;

  renderMetrics(container.querySelector('[data-el="metrics"]'), supabase);
  renderAllDepartmentApprovals(container.querySelector('[data-el="pending"]'), { supabase, adminUserId: user.id });
  renderDepartmentReports(container.querySelector('[data-el="reports"]'), supabase);
  renderUserManager(container.querySelector('[data-el="directory"]'), { supabase, scope: { type: 'global' }, currentUserId: user.id });
}

async function renderMetrics(container, supabase) {
  container.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-4 gap-4">${[1, 2, 3, 4].map(() => metricCardHtml(null, '—', '')).join('')}</div>`;

  const [{ count: userCount }, { count: departmentCount }, { count: pendingCount }, { count: approvedCount }] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('departments').select('id', { count: 'exact', head: true }),
    supabase.from('department_memberships').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('department_memberships').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
  ]);

  container.innerHTML = `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      ${metricCardHtml('super-home-directory', userCount ?? '—', t('superHome.metricUsers'))}
      ${metricCardHtml(null, departmentCount ?? '—', t('superHome.metricDepartments'))}
      ${metricCardHtml('super-home-directory', approvedCount ?? '—', t('superHome.metricMemberships'))}
      ${metricCardHtml('super-home-pending', pendingCount ?? '—', t('superHome.metricPending'), pendingCount > 0)}
    </div>
  `;

  container.querySelectorAll('[data-scroll-target]').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelector(`#${card.dataset.scrollTarget}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function metricCardHtml(scrollTargetId, value, label, highlight = false) {
  const clickable = !!scrollTargetId;
  const tag = clickable ? 'button' : 'div';
  const typeAttr = clickable ? 'type="button"' : '';
  const targetAttr = clickable ? `data-scroll-target="${scrollTargetId}"` : '';
  const clickableClasses = clickable ? 'hover:shadow-md transition-shadow cursor-pointer' : '';
  return `
    <${tag} ${typeAttr} ${targetAttr}
        class="bg-white rounded-xl shadow p-4 sm:p-6 text-center w-full ${highlight ? 'ring-2 ring-amber-400' : ''} ${clickableClasses}">
      <div class="text-2xl sm:text-3xl font-bold text-[#0B1F3A]">${value}</div>
      <div class="text-xs sm:text-sm text-slate-500 mt-1">${label}</div>
    </${tag}>
  `;
}

async function renderDepartmentReports(container, supabase) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

  const [{ data: departments, error: deptError }, { data: memberships, error: memError }] = await Promise.all([
    supabase.from('departments').select('id, key, name').order('name'),
    supabase.from('department_memberships').select('department_id, role, status, member:profiles!user_id ( full_name )'),
  ]);

  if (deptError || memError) {
    container.innerHTML = `<p class="text-sm text-rose-600">${t('superHome.reportsLoadFailed', { message: (deptError || memError).message })}</p>`;
    return;
  }

  const byDept = new Map();
  (departments || []).forEach((d) => byDept.set(d.id, { ...d, approved: 0, pending: 0, admins: [] }));
  (memberships || []).forEach((m) => {
    const entry = byDept.get(m.department_id);
    if (!entry) return;
    if (m.status === 'approved') {
      entry.approved += 1;
      if ((m.role === 'admin' || m.role === 'secretary') && m.member) entry.admins.push(m.member.full_name);
    } else if (m.status === 'pending') {
      entry.pending += 1;
    }
  });

  container.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
          <tr>
            <th class="text-left px-4 py-2">${t('superHome.reportsDepartment')}</th>
            <th class="text-left px-4 py-2">${t('superHome.reportsMembers')}</th>
            <th class="text-left px-4 py-2">${t('superHome.reportsPending')}</th>
            <th class="text-left px-4 py-2">${t('superHome.reportsAdmins')}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${Array.from(byDept.values()).map((d) => `
            <tr>
              <td class="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">${departmentLabel(d.key)}</td>
              <td class="px-4 py-2.5">${d.approved}</td>
              <td class="px-4 py-2.5 ${d.pending > 0 ? 'text-amber-600 font-medium' : ''}">${d.pending}</td>
              <td class="px-4 py-2.5 text-slate-600">${d.admins.length > 0 ? escapeHtml(d.admins.join(', ')) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
