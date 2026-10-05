// Headcount tab entry point — the active department's own tap-to-
// count tool (js/components/headcountTally.js), a combined-attendance
// card summed across all 3 headcount-eligible departments
// (renderCombinedHeadcountCard), and -- admin/secretary only -- the
// exact-total override form + progression + history
// (js/components/headcountBoard.js). This is the merged "Record
// Headcount" + "Headcount Tally" page: those used to be two separate
// surfaces (this tab, open to any approved member; headcountBoard.js
// embedded admin-only inside the Dept Dashboard tab) -- now one page,
// each section still gated the same way it always was.
//
// Only ever reachable while a headcount-eligible department (Ushers/
// Welcoming & Socialisation/Ecodem — see js/deptDashboard.js's
// HEADCOUNT_DEPARTMENT_KEYS) is active; app.js only shows this tab's
// nav entry in that case, but this entry point re-checks itself
// too, since it's also reachable via a direct deep link
// (?open=headcount-tally&dept=...) that could land here before the
// department context is fully settled.
import { getEffectiveSupabase, getActiveDepartment } from './departments.js';
import { HEADCOUNT_DEPARTMENT_KEYS } from './deptDashboard.js';
import { renderHeadcountTally } from './components/headcountTally.js';
import { renderHeadcountBoard, renderCombinedHeadcountCard } from './components/headcountBoard.js';
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

  // Same gate deptDashboard.js uses for the same sections -- a
  // department secretary manages day-to-day headcounts without
  // needing full admin rights.
  const canAdminister = active.role === 'admin' || active.role === 'super_admin';
  const canManageDept = canAdminister || active.role === 'secretary';

  container.innerHTML = `
    <div data-el="tally" class="mb-4"></div>
    <div data-el="combined" class="mb-4"></div>
    ${canManageDept ? '<div data-el="board"></div>' : ''}
  `;

  renderHeadcountTally(container.querySelector('[data-el="tally"]'), { supabase, departmentId: active.id, departmentKey: active.key });
  renderCombinedHeadcountCard(container.querySelector('[data-el="combined"]'), { supabase });
  if (canManageDept) {
    renderHeadcountBoard(container.querySelector('[data-el="board"]'), { supabase, departmentId: active.id });
  }
}
