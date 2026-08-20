// Media & Tech tab entry point: pending approvals (admins only) + the
// duty-role assignment board.
import { getEffectiveSupabase, getActiveDepartment, canPostAnnouncements, isGlobalAnnouncer } from './departments.js';
import { renderDepartmentApprovals } from './components/departmentApprovals.js';
import { renderAnnouncements } from './components/departmentAnnouncements.js';
import { renderMediaTechBoard } from './components/mediaTechBoard.js';
import { renderUserManager } from './components/userManager.js';
import { createBudgetRequestModal } from './components/budgetRequests.js';
import { t } from './i18n.js';

export async function renderMediaTechTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#media-tech-content');
  const active = getActiveDepartment();
  if (!active) return;

  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user } } = await supabase.auth.getUser();
  const canAdminister = active.role === 'admin' || active.role === 'super_admin';

  container.innerHTML = '';

  const announcementsCard = document.createElement('div');
  announcementsCard.className = 'bg-white rounded-xl shadow p-4 sm:p-6 mb-6';
  container.appendChild(announcementsCard);
  renderAnnouncements(announcementsCard, {
    supabase,
    departmentId: active.id,
    canPost: canPostAnnouncements(active.role),
    isGlobalPoster: isGlobalAnnouncer(active.role),
  });

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

  const budgetBtn = document.createElement('button');
  budgetBtn.type = 'button';
  budgetBtn.className = 'mb-6 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700';
  budgetBtn.textContent = t('finance.requestFunds');
  container.appendChild(budgetBtn);
  budgetBtn.addEventListener('click', () => {
    createBudgetRequestModal({ supabase, departmentId: active.id, currentUserId: user.id }).open();
  });

  const boardEl = document.createElement('div');
  container.appendChild(boardEl);
  renderMediaTechBoard(boardEl, { supabase, departmentId: active.id, canAdminister });
}
