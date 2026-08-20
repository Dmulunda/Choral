// Scheduling tab entry point for every non-Choir department. Most
// departments get the generic duty roster/shift board; the three with
// bespoke tooling (Preaching & Moderation, Media & Tech, Ecodem) get
// their own board component instead. Reads which department is active
// from departments.js rather than taking a param. Finance never reaches
// this — its Scheduling nav button is hidden in app.js.
import { getEffectiveSupabase, getActiveDepartment } from './departments.js';
import { renderShiftBoard } from './components/departmentShiftBoard.js';
import { renderPreachingSchedule } from './components/preachingScheduleBoard.js';
import { renderMediaTechBoard } from './components/mediaTechBoard.js';
import { renderEcodemBoard } from './components/ecodemBoard.js';
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

  const canAdminister = active.role === 'admin' || active.role === 'super_admin';
  container.innerHTML = '';
  const renderBoard = BESPOKE_BOARDS[active.key] || renderShiftBoard;
  renderBoard(container, { supabase, departmentId: active.id, canAdminister });
}
