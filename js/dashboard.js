// Dashboard tab entry point: department announcements, roster overview,
// and a snapshot of the next upcoming service.
import { getEffectiveSupabase, getActiveDepartment, canPostAnnouncements, isGlobalAnnouncer } from './departments.js';
import { renderDashboard } from './components/dashboardOverview.js';
import { renderAnnouncements } from './components/departmentAnnouncements.js';
import { createBudgetRequestModal } from './components/budgetRequests.js';
import { renderMyPreachingWidget } from './components/myPreachingWidget.js';
import { renderDateHeader } from './components/dateHeader.js';
import { openMeetingWindow, navigateMeetingWindow } from './components/videoMeeting.js';
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

  const dateHeaderEl = document.createElement('div');
  container.appendChild(dateHeaderEl);
  renderDateHeader(dateHeaderEl);

  const meetingBtn = document.createElement('button');
  meetingBtn.type = 'button';
  meetingBtn.className = 'mb-6 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700';
  meetingBtn.textContent = t('meeting.start');
  container.appendChild(meetingBtn);
  meetingBtn.addEventListener('click', async () => {
    const win = openMeetingWindow();
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
    navigateMeetingWindow(win, { roomName: `choir-app-dept-${active.id}`, displayName: profile?.full_name || '' });
  });

  const myPreachingEl = document.createElement('div');
  container.appendChild(myPreachingEl);
  renderMyPreachingWidget(myPreachingEl, { supabase, userId: user.id });

  const announcementsCard = document.createElement('div');
  announcementsCard.className = `${cardClass} mb-6`;
  container.appendChild(announcementsCard);
  renderAnnouncements(announcementsCard, {
    supabase,
    departmentId: active.id,
    canPost: canPostAnnouncements(active.role),
    isGlobalPoster: isGlobalAnnouncer(active.role),
    canManage: active.role === 'admin' || active.role === 'super_admin',
    currentUserId: user.id,
  });

  if (active.role === 'admin' || active.role === 'super_admin') {
    const budgetBtn = document.createElement('button');
    budgetBtn.type = 'button';
    budgetBtn.className = 'mb-6 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700';
    budgetBtn.textContent = t('finance.requestFunds');
    container.appendChild(budgetBtn);
    budgetBtn.addEventListener('click', () => {
      createBudgetRequestModal({ supabase, departmentId: active.id, currentUserId: user.id }).open();
    });
  }

  const dashboardEl = document.createElement('div');
  container.appendChild(dashboardEl);
  renderDashboard(dashboardEl, { supabase });
}
