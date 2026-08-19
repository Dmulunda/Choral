// Super Admin Home tab entry point: where a global-role holder
// (Super Admin, Super Viewer, Pastor Admin, Church Secretary) lands
// first — high-level metrics plus the full cross-department User
// Directory, not tied to any specific department. Department views
// only load once they explicitly pick one from the switcher/nav.
import { getEffectiveSupabase } from './departments.js';
import { renderUserManager } from './components/userManager.js';
import { t } from './i18n.js';

export async function renderSuperAdminHomeTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#super-home-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  container.innerHTML = '';

  const metricsEl = document.createElement('div');
  container.appendChild(metricsEl);
  renderMetrics(metricsEl, supabase);

  const directoryEl = document.createElement('div');
  directoryEl.className = 'mt-6';
  directoryEl.innerHTML = `<h2 class="text-lg font-semibold mb-4">${t('directory.title')}</h2>`;
  const userManagerEl = document.createElement('div');
  directoryEl.appendChild(userManagerEl);
  container.appendChild(directoryEl);
  renderUserManager(userManagerEl, { supabase, scope: { type: 'global' }, currentUserId: user.id });
}

async function renderMetrics(container, supabase) {
  container.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-4 gap-4">${[1, 2, 3, 4].map(() => metricCardHtml('—', '')).join('')}</div>`;

  const [{ count: userCount }, { count: departmentCount }, { count: pendingCount }, { count: approvedCount }] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('departments').select('id', { count: 'exact', head: true }),
    supabase.from('department_memberships').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('department_memberships').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
  ]);

  container.innerHTML = `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      ${metricCardHtml(userCount ?? '—', t('superHome.metricUsers'))}
      ${metricCardHtml(departmentCount ?? '—', t('superHome.metricDepartments'))}
      ${metricCardHtml(approvedCount ?? '—', t('superHome.metricMemberships'))}
      ${metricCardHtml(pendingCount ?? '—', t('superHome.metricPending'), pendingCount > 0)}
    </div>
  `;
}

function metricCardHtml(value, label, highlight = false) {
  return `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 text-center ${highlight ? 'ring-2 ring-amber-400' : ''}">
      <div class="text-2xl sm:text-3xl font-bold text-[#0B1F3A]">${value}</div>
      <div class="text-xs sm:text-sm text-slate-500 mt-1">${label}</div>
    </div>
  `;
}
