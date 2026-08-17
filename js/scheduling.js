// Scheduling tab entry point: loads the current user's profile and
// routes to the singer calendar or the admin auto-planner.
import { supabase } from './supabaseClient.js';
import { renderAvailabilityCalendar } from './components/calendar.js';
import { renderAdminAutoPlanner } from './components/autoPlanner.js';
import { renderServiceRequestAdmin } from './components/serviceRequestAdmin.js';
import { renderServiceRequestSinger } from './components/serviceRequestSinger.js';
import { t } from './i18n.js';

export async function renderSchedulingTab() {
  const container = document.querySelector('#scheduling-content');
  const cardClass = 'bg-white rounded-xl shadow p-4 sm:p-6';
  container.innerHTML = `<p class="text-slate-500 ${cardClass}">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500 ${cardClass}">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError) {
    container.innerHTML = `<p class="text-rose-600 ${cardClass}">${t('scheduling.failedToLoadProfile', { message: profileError.message })}</p>`;
    return;
  }

  container.innerHTML = '';
  const requestsEl = document.createElement('div');
  const plannerEl = document.createElement('div');
  plannerEl.className = 'bg-white rounded-xl shadow p-4 sm:p-6';
  container.append(requestsEl, plannerEl);

  if (profile.role === 'admin') {
    renderServiceRequestAdmin(requestsEl, { supabase, adminUserId: user.id });
    renderAdminAutoPlanner(plannerEl, { supabase, adminUserId: user.id });
  } else {
    renderServiceRequestSinger(requestsEl, { supabase, userId: user.id });
    renderAvailabilityCalendar(plannerEl, { supabase, userId: user.id });
  }
}
