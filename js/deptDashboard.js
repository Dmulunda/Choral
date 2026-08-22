// Dashboard tab entry point for every non-Choir department (both
// "lightweight" ones and the bespoke-scheduling ones — Preaching,
// Media & Tech, Ecodem — which share this same Dashboard, just with a
// different board on their Scheduling tab): pending approvals (admins
// only) + the announcements feed. Reads which department is active
// from departments.js rather than taking a param, since it's invoked
// from app.js's generic lazyTabs table.
import { getEffectiveSupabase, getActiveDepartment, canPostAnnouncements, isGlobalAnnouncer } from './departments.js';
import { renderDepartmentApprovals } from './components/departmentApprovals.js';
import { renderAnnouncements } from './components/departmentAnnouncements.js';
import { createUserManagerModal } from './components/userManager.js';
import { createBudgetRequestModal, createBudgetRequestsInboxModal } from './components/budgetRequests.js';
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

    const usersBtn = document.createElement('button');
    usersBtn.type = 'button';
    usersBtn.className = 'mb-6 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700';
    usersBtn.textContent = t('nav.members');
    container.appendChild(usersBtn);
    usersBtn.addEventListener('click', () => {
      createUserManagerModal({
        supabase,
        scope: { type: 'department', departmentId: active.id, departmentKey: active.key },
        currentUserId: user.id,
        title: t('nav.members'),
      }).open();
    });
  }

  // Finance sees the incoming requests from every other department
  // instead of a form to submit its own; both are admin-only (sql/029's
  // insert policy is back to can_write_department()).
  if (active.key === 'finance') {
    if (canAdminister) {
      const inboxBtn = document.createElement('button');
      inboxBtn.type = 'button';
      inboxBtn.className = 'mb-6 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700';
      inboxBtn.textContent = t('finance.inboxTitle');
      container.appendChild(inboxBtn);
      inboxBtn.addEventListener('click', () => {
        createBudgetRequestsInboxModal({ supabase, adminUserId: user.id }).open();
      });
    }
  } else if (canAdminister) {
    const budgetBtn = document.createElement('button');
    budgetBtn.type = 'button';
    budgetBtn.className = 'mb-6 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700';
    budgetBtn.textContent = t('finance.requestFunds');
    container.appendChild(budgetBtn);
    budgetBtn.addEventListener('click', () => {
      createBudgetRequestModal({ supabase, departmentId: active.id, currentUserId: user.id }).open();
    });
  }

  const announcementsCard = document.createElement('div');
  announcementsCard.className = 'bg-white rounded-xl shadow p-4 sm:p-6';
  container.appendChild(announcementsCard);
  renderAnnouncements(announcementsCard, {
    supabase,
    departmentId: active.id,
    canPost: canPostAnnouncements(active.role),
    isGlobalPoster: isGlobalAnnouncer(active.role),
    canManage: active.role === 'admin' || active.role === 'super_admin',
    currentUserId: user.id,
  });
}
