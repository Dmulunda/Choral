// Scheduling tab entry point for every non-Choir department. Most
// departments get the generic duty roster/shift board; the three with
// bespoke tooling (Preaching & Moderation, Media & Tech, Ecodem) get
// their own board component instead. Reads which department is active
// from departments.js rather than taking a param. Finance never reaches
// this — its Scheduling nav button is hidden in app.js, so it's already
// excluded from the availability calendar below along with everything
// else here.
import { getEffectiveSupabase, getActiveDepartment, getViewAsTarget } from './departments.js';
import { renderShiftBoard } from './components/departmentShiftBoard.js';
import { renderPreachingSchedule } from './components/preachingScheduleBoard.js';
import { renderMediaTechBoard } from './components/mediaTechBoard.js';
import { renderEcodemBoard } from './components/ecodemBoard.js';
import { renderAvailabilityCalendar } from './components/calendar.js';
import { renderDepartmentSwitchShortcut } from './components/departmentSwitchShortcut.js';
import { t } from './i18n.js';

const BESPOKE_BOARDS = {
  preaching: renderPreachingSchedule,
  media_tech: renderMediaTechBoard,
  ecodem: renderEcodemBoard,
};

export async function renderDeptSchedulingTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#dept-scheduling-content');
  const active = getActiveDepartment();
  if (!active) return;

  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user } } = await supabase.auth.getUser();
  const userId = getViewAsTarget()?.id || user?.id;

  const canAdminister = active.role === 'admin' || active.role === 'super_admin';
  container.innerHTML = `
    <div data-el="dept-switch"></div>
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <h2 class="text-lg font-semibold mb-4">${t('calendar.myAvailability')}</h2>
      <div data-el="availability"></div>
    </div>
    <div data-el="board"></div>
  `;

  renderDepartmentSwitchShortcut(container.querySelector('[data-el="dept-switch"]'), { activeKey: active.key });

  if (userId) {
    // availability is a personal, department-agnostic calendar (same
    // table Choir's has always used) — one place to mark yourself
    // unavailable that every department's admin can plan around.
    renderAvailabilityCalendar(container.querySelector('[data-el="availability"]'), { supabase, userId });
  }

  const renderBoard = BESPOKE_BOARDS[active.key] || renderShiftBoard;
  renderBoard(container.querySelector('[data-el="board"]'), { supabase, departmentId: active.id, canAdminister, userId });
}
