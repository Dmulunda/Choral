// Dashboard tab entry point: roster overview + a snapshot of the next
// upcoming service.
import { getEffectiveSupabase } from './departments.js';
import { renderDashboard } from './components/dashboardOverview.js';
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

  container.innerHTML = '';
  renderDashboard(container, { supabase });
}
