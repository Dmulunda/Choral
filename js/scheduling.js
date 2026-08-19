// Scheduling tab entry point: loads the current user's profile and
// routes to the singer calendar or the admin auto-planner.
import { getEffectiveSupabase, getActiveDepartment, getViewAsTarget } from './departments.js';
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

  // supabase.auth.getUser() always resolves to the real signed-in
  // account, even through the View-As read-only wrapper (only
  // .from()/.rpc()/.storage are intercepted, not .auth) — so every
  // read scoped to "me" below has to resolve through the simulated
  // target instead, or View-As would show the admin's own (usually
  // empty) assignments/voice parts rather than the target's.
  const userId = getViewAsTarget()?.id || user.id;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('voice_parts')
    .eq('id', userId)
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
  const replacementEl = document.createElement('div');
  const plannerEl = document.createElement('div');
  plannerEl.className = 'bg-white rounded-xl shadow p-4 sm:p-6';

  if (isChoirAdmin) {
    // An admin can also be scheduled as a singer for a service, so they
    // need the same "request a replacement for myself" access as any
    // other member — it just sits alongside their admin tools instead
    // of replacing them.
    container.append(requestsEl, replacementEl, plannerEl);
    renderServiceRequestAdmin(requestsEl, { supabase, adminUserId: userId });
    renderReplacementRequests(replacementEl, { supabase, userId, myVoiceParts: profile.voice_parts });
    renderAdminAutoPlanner(plannerEl, { supabase, adminUserId: userId });
  } else {
    container.append(requestsEl, replacementEl, plannerEl);
    renderServiceRequestSinger(requestsEl, { supabase, userId });
    renderReplacementRequests(replacementEl, { supabase, userId, myVoiceParts: profile.voice_parts });
    renderAvailabilityCalendar(plannerEl, { supabase, userId });
  }
}
