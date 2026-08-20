// Dashboard tab entry point: department announcements, roster overview,
// and a snapshot of the next upcoming service.
import { getEffectiveSupabase, getActiveDepartment, canPostAnnouncements, isGlobalAnnouncer } from './departments.js';
import { renderDashboard } from './components/dashboardOverview.js';
import { renderAnnouncements } from './components/departmentAnnouncements.js';
import { createBudgetRequestModal } from './components/budgetRequests.js';
import { t } from './i18n.js';

export async function renderDashboardTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#dashboard-content');
  const cardClass = 'bg-white rounded-xl shadow p-4 sm:p-6';
  container.innerHTML = `<p class="text-slate-500 ${cardClass}">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500 ${cardClass}">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  const active = getActiveDepartment();

  container.innerHTML = '';

  const announcementsCard = document.createElement('div');
  announcementsCard.className = `${cardClass} mb-6`;
  container.appendChild(announcementsCard);
  renderAnnouncements(announcementsCard, {
    supabase,
    departmentId: active.id,
    canPost: canPostAnnouncements(active.role),
    isGlobalPoster: isGlobalAnnouncer(active.role),
  });

  const budgetBtn = document.createElement('button');
  budgetBtn.type = 'button';
  budgetBtn.className = 'mb-6 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700';
  budgetBtn.textContent = t('finance.requestFunds');
  container.appendChild(budgetBtn);
  budgetBtn.addEventListener('click', () => {
    createBudgetRequestModal({ supabase, departmentId: active.id, currentUserId: user.id }).open();
  });

  const dashboardEl = document.createElement('div');
  container.appendChild(dashboardEl);
  renderDashboard(dashboardEl, { supabase });
}
