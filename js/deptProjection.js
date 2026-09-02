// Media & Tech's dedicated Projection tab (sql/074-076) — split out of
// the shared dept-dashboard tab (which every lightweight/custom
// department uses, cluttered with approvals/announcements/budget
// requests) into its own nav entry, since Projection is what this
// department actually lives in during a live service and needed to be
// front-and-center instead of buried in a scroll. Only Media & Tech
// gets this tab at all (see applyActiveDepartment() in app.js), and
// within it every approved member can run the live panel — not just
// admins/secretaries (matching the old dept-dashboard placement).
import { getEffectiveSupabase, getActiveDepartment } from './departments.js';
import { renderProjectionControl } from './components/projectionControl.js';
import { registerProjectionLiveChecker, clearProjectionLiveChecker } from './utils/projectionGuard.js';
import { renderDateHeader } from './components/dateHeader.js';

let currentProjectionControl = null;

// Exported so app.js can call it directly on every department switch
// away from Media & Tech, regardless of which tab is being landed on
// — see the matching comment in app.js's applyActiveDepartment().
export function teardownProjectionIfActive() {
  currentProjectionControl?.destroy();
  currentProjectionControl = null;
  clearProjectionLiveChecker();
}

export async function renderDeptProjectionTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#dept-projection-content');
  const active = getActiveDepartment();
  if (!active) return;

  // Tab is torn down and rebuilt on every visit (app.js clears
  // 'dept-projection' from loadedTabs on every department switch) —
  // close the previous instance's Realtime channel first.
  teardownProjectionIfActive();

  const canAdminister = active.role === 'admin' || active.role === 'super_admin';
  const canManageDept = canAdminister || active.role === 'secretary';

  container.innerHTML = '';

  const dateHeaderEl = document.createElement('div');
  container.appendChild(dateHeaderEl);
  renderDateHeader(dateHeaderEl);

  const projectionEl = document.createElement('div');
  container.appendChild(projectionEl);
  currentProjectionControl = renderProjectionControl(projectionEl, { supabase, canManage: canManageDept });
  registerProjectionLiveChecker(() => currentProjectionControl.isLive());
}
