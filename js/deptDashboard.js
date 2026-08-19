// Dashboard tab entry point for "lightweight" departments (Social,
// Intercession, Cleaning, Interpreting, Ushers, Security, Evangelism):
// pending approvals (admins only) + the announcements feed. Reads which
// department is active from departments.js rather than taking a param,
// since it's invoked from app.js's generic lazyTabs table.
import { getEffectiveSupabase, getActiveDepartment } from './departments.js';
import { renderDepartmentApprovals } from './components/departmentApprovals.js';
import { renderAnnouncements } from './components/departmentAnnouncements.js';
import { renderUserManager } from './components/userManager.js';
import { t } from './i18n.js';

export async function renderDeptDashboardTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#dept-dashboard-content');
  const active = getActiveDepartment();
  if (!active) return;

  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user } } = await supabase.auth.getUser();
  const canAdminister = active.role === 'admin' || active.role === 'super_admin';

  container.innerHTML = '';

  if (canAdminister) {
    const approvalsCard = document.createElement('div');
    approvalsCard.className = 'bg-white rounded-xl shadow p-4 sm:p-6 mb-6';
    approvalsCard.innerHTML = `<h2 class="text-lg font-semibold mb-4">${t('approvals.title')}</h2><div data-el="list"></div>`;
    container.appendChild(approvalsCard);
    renderDepartmentApprovals(approvalsCard.querySelector('[data-el="list"]'), {
      supabase,
      departmentId: active.id,
      adminUserId: user.id,
    });

    const userManagerCard = document.createElement('div');
    userManagerCard.className = 'bg-white rounded-xl shadow p-4 sm:p-6 mb-6';
    userManagerCard.innerHTML = `<h2 class="text-lg font-semibold mb-4">${t('nav.members')}</h2><div data-el="user-manager"></div>`;
    container.appendChild(userManagerCard);
    renderUserManager(userManagerCard.querySelector('[data-el="user-manager"]'), {
      supabase,
      scope: { type: 'department', departmentId: active.id, departmentKey: active.key },
      currentUserId: user.id,
    });
  }

  const announcementsCard = document.createElement('div');
  announcementsCard.className = 'bg-white rounded-xl shadow p-4 sm:p-6';
  container.appendChild(announcementsCard);
  renderAnnouncements(announcementsCard, { supabase, departmentId: active.id, canAdminister });
}
