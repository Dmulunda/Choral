// Headcount Tally tab entry point — the active department's own
// tap-to-count tool (js/components/headcountTally.js). Only ever
// reachable while a headcount-eligible department (Ushers/Welcoming &
// Socialisation/Ecodem — see js/deptDashboard.js's
// HEADCOUNT_DEPARTMENT_KEYS) is active; app.js only shows this tab's
// nav entry in that case, but this entry point re-checks itself
// too, since it's also reachable via a direct deep link
// (?open=headcount-tally&dept=...) that could land here before the
// department context is fully settled.
import { getEffectiveSupabase, getActiveDepartment } from './departments.js';
import { HEADCOUNT_DEPARTMENT_KEYS } from './deptDashboard.js';
import { renderHeadcountTally } from './components/headcountTally.js';
import { t } from './i18n.js';

export async function renderHeadcountTallyTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#headcount-tally-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const active = getActiveDepartment();
  if (!active || !HEADCOUNT_DEPARTMENT_KEYS.includes(active.key)) {
    container.innerHTML = `<p class="text-slate-500 bg-white rounded-xl shadow p-4 sm:p-6">${t('headcountTally.wrongDepartment')}</p>`;
    return;
  }

  renderHeadcountTally(container, { supabase, departmentId: active.id, departmentKey: active.key });
}
