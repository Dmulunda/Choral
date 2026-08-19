// Scheduling tab entry point: loads the current user's profile and
// routes to the singer calendar or the admin auto-planner.
import { getEffectiveSupabase, getActiveDepartment } from './departments.js';
import { renderAvailabilityCalendar } from './components/calendar.js';
import { renderAdminAutoPlanner } from './components/autoPlanner.js';
import { renderServiceRequestAdmin } from './components/serviceRequestAdmin.js';
import { renderServiceRequestSinger } from './components/serviceRequestSinger.js';
import { renderReplacementRequests } from './components/replacementRequests.js';
import { t } from './i18n.js';

export async function renderSchedulingTab() {
  const supabase = getEffectiveSupabase();
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
    .select('voice_parts')
    .eq('id', user.id)
    .single();

  if (profileError) {
    container.innerHTML = `<p class="text-rose-600 ${cardClass}">${t('scheduling.failedToLoadProfile', { message: profileError.message })}</p>`;
    return;
  }

  // Choir's admin/member split now comes from the active department
  // context (not a raw profiles.role lookup), so it correctly reflects
  // whoever's being simulated in View-As mode, not just the real
  // signed-in user.
  const activeDept = getActiveDepartment();
  const isChoirAdmin = activeDept?.role === 'admin' || activeDept?.role === 'super_admin';

  container.innerHTML = '';
  const requestsEl = document.createElement('div');
  const plannerEl = document.createElement('div');
  plannerEl.className = 'bg-white rounded-xl shadow p-4 sm:p-6';

  if (isChoirAdmin) {
    container.append(requestsEl, plannerEl);
    renderServiceRequestAdmin(requestsEl, { supabase, adminUserId: user.id });
    renderAdminAutoPlanner(plannerEl, { supabase, adminUserId: user.id });
  } else {
    const replacementEl = document.createElement('div');
    container.append(requestsEl, replacementEl, plannerEl);
    renderServiceRequestSinger(requestsEl, { supabase, userId: user.id });
    renderReplacementRequests(replacementEl, { supabase, userId: user.id, myVoiceParts: profile.voice_parts });
    renderAvailabilityCalendar(plannerEl, { supabase, userId: user.id });
  }
}
