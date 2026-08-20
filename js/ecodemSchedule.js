// Ecodem (Children's Ministry) tab entry point: pending approvals
// (admins only) + the age-group session board.
import { getEffectiveSupabase, getActiveDepartment, canPostAnnouncements, isGlobalAnnouncer } from './departments.js';
import { renderDepartmentApprovals } from './components/departmentApprovals.js';
import { renderAnnouncements } from './components/departmentAnnouncements.js';
import { renderEcodemBoard } from './components/ecodemBoard.js';
import { renderUserManager } from './components/userManager.js';
import { renderBudgetRequestForm } from './components/budgetRequests.js';
import { t } from './i18n.js';

export async function renderEcodemTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#ecodem-content');
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

  const budgetCard = document.createElement('div');
  budgetCard.className = 'bg-white rounded-xl shadow p-4 sm:p-6 mb-6';
  container.appendChild(budgetCard);
  renderBudgetRequestForm(budgetCard, { supabase, departmentId: active.id, currentUserId: user.id });

  const boardEl = document.createElement('div');
  container.appendChild(boardEl);
  renderEcodemBoard(boardEl, { supabase, departmentId: active.id, canAdminister });
}
