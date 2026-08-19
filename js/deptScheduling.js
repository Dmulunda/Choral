// Scheduling tab entry point for "lightweight" departments — duty
// rosters/shifts and an event list, shared across every department
// without bespoke tooling. Reads which department is active from
// departments.js rather than taking a param.
import { supabase } from './supabaseClient.js';
import { getActiveDepartment } from './departments.js';
import { renderShiftBoard } from './components/departmentShiftBoard.js';
import { t } from './i18n.js';

export async function renderDeptSchedulingTab() {
  const container = document.querySelector('#dept-scheduling-content');
  const active = getActiveDepartment();
  if (!active) return;

  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const canAdminister = active.role === 'admin' || active.role === 'super_admin';
  container.innerHTML = '';
  renderShiftBoard(container, { supabase, departmentId: active.id, canAdminister });
}
