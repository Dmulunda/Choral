// Tab navigation — swaps which panel is visible and highlights the active nav link.
import { supabase } from './supabaseClient.js';
import { initVersionCheck } from './versionCheck.js';
import { renderSchedulingTab } from './scheduling.js';
import { renderSongbookTab } from './songbook.js';
import { renderVoiceExercises } from './components/voiceExercises.js';
import { renderUniformSchedule } from './components/uniformSchedule.js';
import { renderAuthScreen } from './components/authScreen.js';
import { renderPasswordRecovery } from './components/passwordRecovery.js';
import { renderMembersTab } from './members.js';
import { renderDashboardTab } from './dashboard.js';
import { renderDeptDashboardTab, HEADCOUNT_DEPARTMENT_KEYS } from './deptDashboard.js';
import { renderHeadcountTallyTab } from './headcountTallyPage.js';
import { renderDeptProjectionTab, teardownProjectionIfActive } from './deptProjection.js';
import { renderDeptSchedulingTab } from './deptScheduling.js';
import { renderSuperAdminHomeTab, openGuestOnboardingHub, openDirectory } from './superAdminHome.js';
import { createUserManagerModal } from './components/userManager.js';
import { renderToolsTab } from './toolsPage.js';
import { renderTrainingTab } from './training.js';
import { renderServiceProgramTab } from './serviceProgram.js';
import { renderTaxTab } from './taxPage.js';
import { renderBudgetPageTab } from './budgetPage.js';
import { loadSchoolAdminStatus } from './schoolAdmin.js';
import { renderDepartmentApprovals } from './components/departmentApprovals.js';
import { createViewAsPickerModal } from './components/viewAsPicker.js';
import { createReportAbsenceModal } from './components/reportAbsenceModal.js';
import { createJoinDepartmentModal } from './components/joinDepartmentModal.js';
import { createInboxModal } from './components/inboxModal.js';
import { createRulesModal } from './components/rulesModal.js';
import { createHelpModal } from './components/helpModal.js';
import { createMonthlyReportModal } from './components/monthlyReportModal.js';
import { createAttendanceManagerModal } from './components/attendanceManager.js';
import { createAppSuggestionModal } from './components/appSuggestionModal.js';
import { createGuestOnboardingModal } from './components/guestOnboardingHub.js';
import { createMemberCaseModal } from './components/memberCaseManager.js';
import { renderPastorMeetingsTab } from './pastorMeetingsPage.js';
import { createPrayerRequestModal } from './components/prayerRequests.js';
import { createChangePasswordModal } from './components/changePasswordModal.js';
import { createMyProfileModal } from './components/myProfileModal.js';
import { createMyLettersModal, createDisciplinaryLettersAdminModal } from './components/disciplinaryLetters.js';
import { createNotificationSettingsModal } from './components/notificationSettingsModal.js';
import { checkSpecialProgramPopup } from './components/specialProgramPopup.js';
import { getLang, setLang, onLangChange, applyStaticTranslations, departmentLabel, departmentIcon, t, loadLabelOverrides } from './i18n.js';
import {
  loadMyDepartments, getMyDepartments, getActiveDepartment, setActiveDepartmentKey,
  getGlobalRole, isViewingAs, getViewAsTarget, startViewAs, stopViewAs, getEffectiveSupabase,
  hasGlobalReach, isActingAsStandardUser, setActingAsStandardUser, isHomeActive, HOME_KEY,
  isPreviewingAsMember, startPreviewAsMember, stopPreviewAsMember, hasAnyDeptLeadership,
} from './departments.js';
import { registerServiceWorker, setAppBadgeCount } from './pwa.js';
import { getTheme, setTheme, loadAppTheme } from './theme.js';
import { loadChurchBranding } from './churchBranding.js';
import { confirmLeaveIfProjecting } from './utils/projectionGuard.js';

registerServiceWorker();

const tabs = document.querySelectorAll('[data-tab-target]');
const panels = document.querySelectorAll('[data-tab-panel]');
const departmentSwitcherWrapEl = document.querySelector('#department-switcher-wrap');
const departmentSwitcherListEl = document.querySelector('#department-switcher-list');

const deptDashboardNameEl = document.querySelector('[data-el="dept-dashboard-name"]');
const deptSchedulingNameEl = document.querySelector('[data-el="dept-scheduling-name"]');
const comingSoonPanelEl = document.querySelector('#department-coming-soon');
const comingSoonDeptNameEl = comingSoonPanelEl.querySelector('[data-el="dept-name"]');
const comingSoonApprovalsEl = document.querySelector('#department-coming-soon-approvals');
const comingSoonApprovalsListEl = comingSoonApprovalsEl.querySelector('[data-el="approvals-list"]');
const noAccessPanelEl = document.querySelector('#no-department-access');
const inboxBtn = document.querySelector('#inbox-btn');
const inboxBadgeEl = document.querySelector('#inbox-badge');
const helpBtn = document.querySelector('#help-btn');
const sidebarToolsSelect = document.querySelector('#sidebar-tools-select');
const viewAsBtn = document.querySelector('#view-as-btn');
const viewAsBannerEl = document.querySelector('#view-as-banner');
const viewAsBannerTextEl = viewAsBannerEl.querySelector('[data-el="text"]');
const viewAsExitBtn = document.querySelector('#view-as-exit-btn');
const previewAsMemberBtn = document.querySelector('#preview-as-member-btn');
const signOutBtnDesktop = document.querySelector('#sign-out-btn-desktop');
const accountMenuBtn = document.querySelector('#account-menu-btn');
const accountMenuDialog = document.querySelector('#account-menu-dialog');
const quickAccessDialog = document.querySelector('#quick-access-dialog');
const quickAccessListEl = document.querySelector('[data-el="quick-access-list"]');
const notificationsBtn = document.querySelector('#notifications-btn');
const headerNewMemberBtn = document.querySelector('#header-new-member-btn');
const loginSplashEl = document.querySelector('#login-splash');

// Tabs whose content is fetched from Supabase on first visit rather than
// baked into the initial page load.
const lazyTabs = {
  dashboard: renderDashboardTab,
  scheduling: renderSchedulingTab,
  songbook: renderSongbookTab,
  'voice-exercises': () => renderVoiceExercises(document.querySelector('#voice-exercises-content')),
  uniform: () => {
    const active = getActiveDepartment();
    if (!active) return;
    renderUniformSchedule(document.querySelector('#uniform-content'), {
      supabase: getEffectiveSupabase(),
      departmentId: active.id,
      canAdminister: active.role === 'admin' || active.role === 'super_admin',
    });
  },
  members: renderMembersTab,
  'dept-dashboard': renderDeptDashboardTab,
  'dept-scheduling': renderDeptSchedulingTab,
  'dept-projection': renderDeptProjectionTab,
  'headcount-tally': renderHeadcountTallyTab,
  'super-home': renderSuperAdminHomeTab,
  tools: renderToolsTab,
  training: renderTrainingTab,
  'service-program': renderServiceProgramTab,
  tax: renderTaxTab,
  budget: renderBudgetPageTab,
  'pastor-meetings': renderPastorMeetingsTab,
};
let loadedTabs = new Set();
let currentTabName = null;

// activateTab() only toggles a panel's visibility -- it never unmounts
// or re-renders an already-loaded tab's DOM, so a tab whose data was
// changed from somewhere ELSE (e.g. a Headcount Tally submission
// changing what the Dashboard's headcount history table already
// rendered) stays stale until this is called for it, forcing the next
// visit to actually re-fetch instead of just un-hiding the old DOM.
export function invalidateTabCache(name) {
  loadedTabs.delete(name);
}

// Mirrors departments.js's ACTIVE_DEPT_STORAGE_KEY pattern -- lets a page
// refresh land back on the tab the user was actually viewing instead of
// always resetting to the department's default tab (see showApp() and
// applyActiveDepartment()'s no-active-department branch).
const TAB_STORAGE_KEY = 'choir-hub-last-tab';

function activateTab(name) {
  currentTabName = name;
  localStorage.setItem(TAB_STORAGE_KEY, name);

  panels.forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.tabPanel !== name);
  });

  // Queried fresh rather than using the closed-over `tabs` snapshot from
  // script load -- the Budget nav button (see updateBudgetNavVisibility())
  // is inserted dynamically, after that snapshot was taken, specifically
  // so it can be entirely absent for most viewers rather than just
  // CSS-hidden like every other conditional nav item in this file.
  document.querySelectorAll('[data-tab-target]').forEach((tab) => {
    const isActive = tab.dataset.tabTarget === name;
    tab.classList.toggle('bg-indigo-600', isActive);
    tab.classList.toggle('text-white', isActive);
    tab.classList.toggle('text-slate-300', !isActive);
  });

  if (lazyTabs[name] && !loadedTabs.has(name)) {
    loadedTabs.add(name);
    lazyTabs[name]();
  }
}

// Choir and every other department name the "same kind" of page
// differently (dashboard/dept-dashboard, scheduling/dept-scheduling) —
// this maps between them so switching departments lands you back on
// the same kind of page you were already on, instead of always
// resetting to Dashboard. Tabs with no equivalent on the other side
// (Songbook, Voice Exercises, Members) fall back to Dashboard.
const TAB_KIND_MAP = {
  dashboard: { choir: 'dashboard', other: 'dept-dashboard' },
  'dept-dashboard': { choir: 'dashboard', other: 'dept-dashboard' },
  scheduling: { choir: 'scheduling', other: 'dept-scheduling' },
  'dept-scheduling': { choir: 'scheduling', other: 'dept-scheduling' },
  uniform: { choir: 'uniform', other: 'uniform' },
};

function resolveLandingTab(previousTabName, active, isChoir) {
  const mapping = TAB_KIND_MAP[previousTabName];
  if (!mapping) return null;
  const target = isChoir ? mapping.choir : mapping.other;
  // Uniform only actually exists for Choir/Ushers, and Scheduling is
  // hidden for Finance and Church Program — landing on either
  // elsewhere would show a page with no way back to it via the nav.
  if (target === 'uniform' && !(isChoir || active.key === 'ushers')) return null;
  if (target === 'dept-scheduling' && (active.key === 'finance' || active.key === 'church_program')) return null;
  return target;
}

// Applies a visibility/state rule to every element sharing a given
// data-nav-group value. Most groups now live on a single sidebar
// element (mobile drawer and permanent desktop column are the same
// <aside>), but a few (role-switcher-*, view-as-wrap, current-user-*)
// also have a counterpart inside #account-menu-dialog — this keeps
// both in sync from one call instead of a line per surface.
function forEachNavGroup(name, fn) {
  document.querySelectorAll(`[data-nav-group="${name}"]`).forEach(fn);
}

// The Budget nav button (Finance/Budget module) deliberately isn't
// built-then-CSS-hidden like every other conditional nav item above --
// the spec calls for zero trace for anyone who isn't a department
// admin/secretary or Pastor, so it's only ever constructed and inserted
// into the DOM for hasAnyDeptLeadership() (departments.js), and removed
// again if that ever becomes false mid-session (Standard User Mode,
// View-As). Re-run on every applyActiveDepartment(), same as the
// 'global' nav group right above this call, since department
// leadership can change identity (not just visibility) across those
// mode switches.
const unconditionalNavGroupEl = document.querySelector('#unconditional-nav-group');
let budgetNavBtn = null;
function updateBudgetNavVisibility() {
  if (hasAnyDeptLeadership()) {
    if (!budgetNavBtn) {
      budgetNavBtn = document.createElement('button');
      budgetNavBtn.dataset.tabTarget = 'budget';
      budgetNavBtn.setAttribute('data-i18n', 'nav.budget');
      budgetNavBtn.className = 'w-full text-left px-3 py-2 rounded-lg font-medium transition-colors hover:bg-slate-800';
      budgetNavBtn.textContent = t('nav.budget');
      budgetNavBtn.addEventListener('click', () => {
        activateTab('budget');
        closeSidebar();
      });
      unconditionalNavGroupEl.appendChild(budgetNavBtn);
    }
  } else if (budgetNavBtn) {
    budgetNavBtn.remove();
    budgetNavBtn = null;
  }
}

// ---- Department switcher ----
// Only Choir has real screens today — other departments show a
// placeholder until their own phase ships. The switcher itself only
// ever lists departments the signed-in user actually has approved
// access to (or every department, for a super admin/viewer).
function populateDepartmentSwitcher() {
  const departments = getMyDepartments();
  departmentSwitcherWrapEl.classList.toggle('hidden', departments.length === 0);

  const active = getActiveDepartment();
  const activeKey = active ? active.key : null;

  departmentSwitcherListEl.innerHTML = departments.map((d) => `
    <button type="button" data-dept-key="${d.key}"
        class="w-full text-left px-2 py-1.5 rounded-lg text-[12.8px] font-medium transition-colors flex items-center gap-2.5 ${
          d.key === activeKey ? 'bg-[#2a2d3d] text-white' : 'text-slate-300 hover:bg-[#1e2130] hover:text-white'
        }">
      <span class="w-[18px] text-center shrink-0">${departmentIcon(d.key)}</span>
      <span class="truncate">${departmentLabel(d.key)}</span>
    </button>
  `).join('');
}

departmentSwitcherListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-dept-key]');
  if (btn) handleDepartmentSwitch(btn.dataset.deptKey);
});

function applyActiveDepartment() {
  const active = getActiveDepartment();
  // Captured before any activateTab() call below overwrites it — this
  // is genuinely "the tab we were on a moment ago," used to land back
  // on the same kind of page after a department switch.
  const previousTabName = currentTabName;

  // Unconditional, independent of which tab we're landing on — the
  // projection panel's own teardown (deptDashboard.js) only runs when
  // the dept-dashboard tab itself re-renders, which doesn't happen if
  // you're leaving Media & Tech from its Scheduling tab (TAB_KIND_MAP
  // lands you on the new department's Scheduling tab instead). Without
  // this, the "leave anyway?" guard could stay armed and fire on a
  // later switch away from a completely unrelated department.
  if (active?.key !== 'media_tech') teardownProjectionIfActive();

  // hasGlobalReach() (not the active department's role) drives this,
  // since active is intentionally null while on the Home console —
  // Home itself lives inside this same nav group.
  forEachNavGroup('global', (el) => el.classList.toggle('hidden', !hasGlobalReach()));
  updateBudgetNavVisibility();
  updateSidebarToolsSelect();

  if (!active) {
    if (isHomeActive()) {
      noAccessPanelEl.classList.add('hidden');
      forEachNavGroup('choir', (el) => el.classList.add('hidden'));
      forEachNavGroup('lightweight', (el) => el.classList.add('hidden'));
      forEachNavGroup('members-nav', (el) => el.classList.add('hidden'));
      comingSoonPanelEl.classList.add('hidden');
      loadedTabs.delete('super-home');
      loadedTabs.delete('tools');
      // Home and Tools are the only two tabs valid with no active
      // department (GLOBAL_ONLY_TARGETS) -- any other stored value here
      // is stale (e.g. a department-scoped tab from before switching to
      // Home) and correctly falls back to the default.
      activateTab(previousTabName === 'tools' ? 'tools' : 'super-home');
      return;
    }

    noAccessPanelEl.classList.remove('hidden');
    forEachNavGroup('choir', (el) => el.classList.add('hidden'));
    forEachNavGroup('lightweight', (el) => el.classList.add('hidden'));
    panels.forEach((panel) => panel.classList.add('hidden'));
    comingSoonPanelEl.classList.add('hidden');
    return;
  }

  noAccessPanelEl.classList.add('hidden');

  const isChoir = active.key === 'choir';
  // Every non-Choir department shares the same Dashboard/Scheduling nav
  // shape — "lightweight" departments (generic shift board) and
  // "custom" ones (Preaching, Media & Tech, Ecodem — each with its own
  // bespoke board component, picked by deptScheduling.js) alike, so
  // every department gets Scheduling except Finance and Church Program
  // (sql/065 — its content is all on Dashboard, there's no shift/duty
  // concept to schedule), which explicitly hide just that one tab below.
  const isDeptDashboardKind = active.kind === 'lightweight' || active.kind === 'custom';
  const hasNoScheduling = active.key === 'finance' || active.key === 'church_program';
  forEachNavGroup('choir', (el) => el.classList.toggle('hidden', !isChoir));
  forEachNavGroup('lightweight', (el) => el.classList.toggle('hidden', !isDeptDashboardKind));
  forEachNavGroup('members-nav', (el) => el.classList.toggle('hidden', !isChoir || !(active.role === 'admin' || active.role === 'super_admin')));
  forEachNavGroup('dept-scheduling-nav', (el) => el.classList.toggle('hidden', isDeptDashboardKind && hasNoScheduling));
  // Uniform: Choir always has its own button in choir-nav-group: this
  // one (in the shared lightweight nav) is only for Ushers.
  forEachNavGroup('uniform-nav', (el) => el.classList.toggle('hidden', !(isDeptDashboardKind && active.key === 'ushers')));
  // Projection: its own page, Media & Tech only.
  forEachNavGroup('dept-projection-nav', (el) => el.classList.toggle('hidden', !(isDeptDashboardKind && active.key === 'media_tech')));
  // Headcount Tally: Ushers/Welcoming & Socialisation/Ecodem, every
  // approved member (not just admin/secretary) -- counting people at
  // the door isn't an admin-only task.
  forEachNavGroup('headcount-tally-nav', (el) => el.classList.toggle('hidden', !(isDeptDashboardKind && HEADCOUNT_DEPARTMENT_KEYS.includes(active.key))));

  if (isChoir) {
    comingSoonPanelEl.classList.add('hidden');
    loadedTabs.delete('uniform');
    activateTab(resolveLandingTab(previousTabName, active, true) || 'dashboard');
  } else if (isDeptDashboardKind) {
    comingSoonPanelEl.classList.add('hidden');
    deptDashboardNameEl.textContent = departmentLabel(active.key);
    deptSchedulingNameEl.textContent = departmentLabel(active.key);
    loadedTabs.delete('uniform');
    // A different department may have been active last time these tab
    // names were used, so force a fresh render rather than trusting the
    // lazy-load cache.
    loadedTabs.delete('dept-dashboard');
    loadedTabs.delete('dept-scheduling');
    loadedTabs.delete('dept-projection');
    loadedTabs.delete('headcount-tally');
    activateTab(resolveLandingTab(previousTabName, active, false) || 'dept-dashboard');
  } else {
    // Unreachable today — every department kind ('choir', 'lightweight',
    // 'custom') is handled above; kept as a fallback in case a future
    // department kind ships without dedicated tooling yet.
    currentTabName = null;
    panels.forEach((panel) => panel.classList.add('hidden'));
    comingSoonDeptNameEl.textContent = departmentLabel(active.key);
    comingSoonPanelEl.classList.remove('hidden');

    const canAdminister = active.role === 'admin' || active.role === 'super_admin';
    comingSoonApprovalsEl.classList.toggle('hidden', !canAdminister);
    if (canAdminister) {
      renderDepartmentApprovals(comingSoonApprovalsListEl, {
        supabase,
        departmentId: active.id,
        adminUserId: currentUserId,
      });
    }
  }
}

// Was shared by both a mobile and desktop <select>; the sidebar is a
// single shared element between mobile drawer and desktop column, so
// now there's just one list. No value to revert on cancel the way a
// <select> needed -- nothing visually changes until this actually
// commits, so a cancelled switch just returns without touching state.
export async function handleDepartmentSwitch(nextKey) {
  const active = getActiveDepartment();
  const previousKey = active ? active.key : (isHomeActive() ? HOME_KEY : '');

  if (nextKey !== previousKey && !(await confirmLeaveIfProjecting())) return;

  setActiveDepartmentKey(nextKey);
  applyActiveDepartment();
  populateDepartmentSwitcher();
  updatePreviewAsMemberUI();
  closeSidebar();
}

// ---- Role Switcher: Super Admin Mode vs Standard User Mode ----
function updateRoleSwitcherUI() {
  forEachNavGroup('role-switcher-wrap', (el) => el.classList.toggle('hidden', !getGlobalRole() || isViewingAs()));

  const standard = isActingAsStandardUser();
  forEachNavGroup('role-switcher-admin-btn', (el) => {
    el.classList.toggle('bg-indigo-600', !standard);
    el.classList.toggle('text-white', !standard);
    el.classList.toggle('text-slate-400', standard);
  });
  forEachNavGroup('role-switcher-standard-btn', (el) => {
    el.classList.toggle('bg-indigo-600', standard);
    el.classList.toggle('text-white', standard);
    el.classList.toggle('text-slate-400', !standard);
  });
}

function refreshAfterRoleModeChange() {
  loadedTabs = new Set();
  populateDepartmentSwitcher();
  applyActiveDepartment();
  updateRoleSwitcherUI();
  updateViewAsUI();
  updatePreviewAsMemberUI();
  updateMemberActionsUI();
  refreshInboxBadge();
  closeSidebar();
}

forEachNavGroup('role-switcher-admin-btn', (el) => el.addEventListener('click', () => {
  setActingAsStandardUser(false);
  refreshAfterRoleModeChange();
}));

forEachNavGroup('role-switcher-standard-btn', (el) => el.addEventListener('click', () => {
  setActingAsStandardUser(true);
  refreshAfterRoleModeChange();
}));

// ---- Shared banner for View-As / Preview-as-Member ----
// The two are mutually exclusive in practice — View-As is Super-Admin-
// only and only available in Super Admin Mode; Preview-as-Member only
// applies to a literal department admin role, which only surfaces in
// Standard User Mode for a global-role holder (or all the time for a
// regular admin, who never sees View-As at all) — so one banner element
// serving both, keyed off whichever is actually active, is enough.
function updateIdentityBanner() {
  const viewAsTarget = getViewAsTarget();
  const previewing = isPreviewingAsMember();
  const showBanner = !!viewAsTarget || previewing;

  viewAsBannerEl.classList.toggle('hidden', !showBanner);
  viewAsBannerEl.classList.toggle('flex', showBanner);

  if (viewAsTarget) {
    viewAsBannerTextEl.textContent = t('viewAs.banner', { name: viewAsTarget.full_name });
  } else if (previewing) {
    viewAsBannerTextEl.textContent = t('previewAsMember.banner');
  }
}

// ---- Super Admin "View As" mode ----
// getGlobalRole() always reflects the real signed-in user, even while
// isViewingAs() is true, so the entry point itself never disappears
// because of the simulated role — only because view-as is already
// active, or Standard User Mode has stepped out of Super Admin reach.
function updateViewAsUI() {
  const canViewAs = getGlobalRole() === 'super_admin' && !isActingAsStandardUser();
  forEachNavGroup('view-as-wrap', (el) => el.classList.toggle('hidden', !canViewAs || isViewingAs()));
  updateIdentityBanner();
}

function refreshAfterViewAsChange() {
  // The effective Supabase client and the active department both change
  // underneath every tab, so cached tab content can't be trusted — force
  // every tab to re-fetch on next visit, same as a real user switch.
  loadedTabs = new Set();
  populateDepartmentSwitcher();
  applyActiveDepartment();
  updateViewAsUI();
  updatePreviewAsMemberUI();
  updateMemberActionsUI();
  refreshInboxBadge();
  closeSidebar();
}

function openViewAsPicker() {
  const modal = createViewAsPickerModal({
    supabase,
    currentUserId,
    onSelect: async (targetUserId, targetFullName) => {
      await startViewAs(targetUserId, targetFullName);
      refreshAfterViewAsChange();
    },
  });
  modal.open();
}

viewAsBtn.addEventListener('click', openViewAsPicker);

viewAsExitBtn.addEventListener('click', () => {
  if (isViewingAs()) stopViewAs();
  if (isPreviewingAsMember()) stopPreviewAsMember();
  refreshAfterViewAsChange();
});

// ---- Department Admin "Preview as Member" ----
// Only offered for a literal department_role of 'admin' — Department
// Secretary is deliberately excluded (announcements-only, no admin
// powers to preview away from), and a global role uses View-As instead.
function updatePreviewAsMemberUI() {
  const active = getActiveDepartment();
  const canPreview = !isPreviewingAsMember() && !isViewingAs() && active?.role === 'admin';
  forEachNavGroup('preview-as-member-wrap', (el) => el.classList.toggle('hidden', !canPreview));
  updateIdentityBanner();
}

function activatePreviewAsMember() {
  startPreviewAsMember();
  refreshAfterViewAsChange();
}

previewAsMemberBtn.addEventListener('click', activatePreviewAsMember);

// ---- Desktop account menu (avatar) ----
// Profile/Change Password/View As/Role mode/Sign out, all in one clear
// centered dialog (same pattern as every other modal in this app, not
// a small anchored dropdown) — reuses runSidebarTool()/
// openViewAsPicker() rather than duplicating what those already do;
// Role Switcher's rows are wired for free by the existing
// forEachNavGroup('role-switcher-admin-btn'/'-standard-btn', ...) calls
// elsewhere, since they share those same data-nav-group values.
function openAccountMenu() {
  accountMenuDialog.classList.remove('hidden');
  accountMenuDialog.classList.add('flex');
}

function closeAccountMenu() {
  accountMenuDialog.classList.add('hidden');
  accountMenuDialog.classList.remove('flex');
}

accountMenuBtn.addEventListener('click', openAccountMenu);
accountMenuDialog.querySelector('[data-action="close-account-menu"]').addEventListener('click', closeAccountMenu);
accountMenuDialog.addEventListener('click', (e) => { if (e.target === accountMenuDialog) closeAccountMenu(); });

accountMenuDialog.addEventListener('click', (e) => {
  const actionBtn = e.target.closest('[data-account-action]');
  if (actionBtn?.dataset.accountAction === 'my-profile') runSidebarTool('my-profile');
  else if (actionBtn?.dataset.accountAction === 'change-password') runSidebarTool('change-password');
  else if (actionBtn?.dataset.accountAction === 'view-as') openViewAsPicker();
  if (actionBtn) closeAccountMenu();
});

notificationsBtn.addEventListener('click', () => runSidebarTool('notifications'));

// ---- Quick Access dialog (mobile bottom bar's 3-line icon) ----
// VPD Academy and Service Program are unconditional (same as their
// sidebar nav entries); Budget only appears for department leadership
// (mirrors updateBudgetNavVisibility()'s "zero trace" rule -- built
// fresh each time this opens rather than once at load, same reason);
// Dashboard only appears while a department is actually active, since
// there's nothing to jump to on Home/Tools.
const QUICK_ACCESS_ITEMS_CLASS = 'w-full text-left px-3 py-2.5 rounded-lg font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-2.5';
function buildQuickAccessItems() {
  const active = getActiveDepartment();
  const items = [
    { icon: '🎓', label: t('nav.training'), tab: 'training' },
    { icon: '📖', label: t('nav.serviceProgram'), tab: 'service-program' },
  ];
  if (hasAnyDeptLeadership()) items.push({ icon: '💰', label: t('nav.budget'), tab: 'budget' });
  if (active) items.push({ icon: '📊', label: t('nav.dashboard'), tab: active.key === 'choir' ? 'dashboard' : 'dept-dashboard' });
  return items;
}

function openQuickAccess() {
  quickAccessListEl.innerHTML = buildQuickAccessItems().map((item) => `
    <button type="button" data-quick-access-tab="${item.tab}" class="${QUICK_ACCESS_ITEMS_CLASS}">
      <span class="text-lg">${item.icon}</span> <span>${item.label}</span>
    </button>
  `).join('');
  quickAccessDialog.classList.remove('hidden');
  quickAccessDialog.classList.add('flex');
}

function closeQuickAccess() {
  quickAccessDialog.classList.add('hidden');
  quickAccessDialog.classList.remove('flex');
}

quickAccessDialog.querySelector('[data-action="close-quick-access"]').addEventListener('click', closeQuickAccess);
quickAccessDialog.addEventListener('click', (e) => {
  if (e.target === quickAccessDialog) { closeQuickAccess(); return; }
  const tabBtn = e.target.closest('[data-quick-access-tab]');
  if (tabBtn) {
    activateTab(tabBtn.dataset.quickAccessTab);
    closeQuickAccess();
  }
});

headerNewMemberBtn.addEventListener('click', () => {
  activateTab('super-home');
  openGuestOnboardingHub();
});

// ---- Report Absence / Inbox ----
// Available to anyone with at least one department, independent of
// which one is currently active. Report Absence is hidden during
// View-As (its RPC call would just be blocked by the read-only
// wrapper — hiding it is clearer than showing a control that can't
// succeed); the Inbox (now in the top bar, not this sidebar group)
// stays visible so a Super Admin previewing another user's view sees
// what that user would see — resolved via getViewAsTarget() rather
// than the real currentUserId in both places below, same as every
// other identity-sensitive spot in this file.
const USHER_ATTENDANCE_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];
const SUGGESTION_GLOBAL_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];
// Same set superAdminHome.js gates its Guest Onboarding button on.
const PASTORAL_TEAM_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];

function updateMemberActionsUI() {
  const hasAccess = getMyDepartments().length > 0;
  inboxBtn.classList.toggle('hidden', !hasAccess);
  // Unlike Messages, Notifications never needed department access — it
  // only ever depended on not being mid-View-As (matches the option's
  // old condition in updateSidebarToolsSelect()).
  notificationsBtn.classList.toggle('hidden', isViewingAs());

  const canOpenGuestHub = PASTORAL_TEAM_ROLES.includes(getGlobalRole());
  headerNewMemberBtn.classList.toggle('hidden', !canOpenGuestHub);
  headerNewMemberBtn.classList.toggle('flex', canOpenGuestHub);
}

// ---- Sidebar tools dropdown ----
// Everything from Church Rules through Monthly Report lives in one
// select instead of a stack of separate buttons — rebuilt from scratch
// on every call since each option has its own visibility rule (some
// need department access, some an elevated role, some an active
// department), and there's no cheap way to diff that into individual
// per-option toggles worth the complexity. Picking an option runs its
// action immediately (see runSidebarTool()) and the select snaps back
// to the placeholder — a one-shot action menu, not a persisted choice.
function updateSidebarToolsSelect() {
  const hasAccess = getMyDepartments().length > 0;
  const active = getActiveDepartment();

  // Mirrors can_record_attendance() in sql/037 — a global role from the
  // pastoral team, or an approved admin/secretary in the Ushers
  // department specifically.
  const canRecordAttendance = USHER_ATTENDANCE_ROLES.includes(getGlobalRole())
    || getMyDepartments().some((d) => d.key === 'ushers' && (d.role === 'admin' || d.role === 'secretary'));

  // Mirrors can_submit_suggestions() in sql/040 — deliberately excludes
  // Super Viewer, since a global-role holder's synthesized department
  // rows carry the literal global_role string as `role`, which never
  // equals 'admin'/'secretary', so the department-admin half of this
  // check naturally only matches a real (non-global) department admin.
  const canSubmitSuggestion = SUGGESTION_GLOBAL_ROLES.includes(getGlobalRole())
    || getMyDepartments().some((d) => d.role === 'admin' || d.role === 'secretary');

  const options = [{ value: 'church-rules', label: t('sidebar.churchRules') }];
  if (!isViewingAs()) options.push({ value: 'change-password', label: t('sidebar.changePassword') });
  if (!isViewingAs()) options.push({ value: 'my-profile', label: t('sidebar.myProfile') });
  if (!isViewingAs()) options.push({ value: 'my-letters', label: t('sidebar.myLetters') });
  if (getGlobalRole() === 'pastor_admin' || getGlobalRole() === 'super_admin') {
    options.push({ value: 'disciplinary-letters', label: t('sidebar.disciplinaryLetters') });
  }
  options.push({ value: 'join-department', label: t('sidebar.joinDepartment') });
  options.push({ value: 'pastor-meeting', label: t('sidebar.pastorMeeting') });
  options.push({ value: 'prayer-request', label: t('sidebar.prayerRequest') });
  if (canRecordAttendance) options.push({ value: 'attendance', label: t('sidebar.attendance') });
  if (canSubmitSuggestion) options.push({ value: 'app-suggestion', label: t('sidebar.appSuggestion') });
  if (hasAccess) {
    if (!isViewingAs()) options.push({ value: 'report-absence', label: t('sidebar.reportAbsence') });
    if (active) {
      options.push({ value: 'department-rules', label: t('sidebar.departmentRules') });
      options.push({ value: 'monthly-report', label: t('sidebar.monthlyReport') });
      // Whoever currently holds a guest's/member's case can see it —
      // see sql/042 and sql/043's RLS — so any department admin gets
      // these, not just the pastoral team's oversight hubs.
      if (active.role === 'admin' || active.role === 'super_admin') {
        options.push({ value: 'guest-cases', label: t('sidebar.guestCases') });
        options.push({ value: 'member-cases', label: t('sidebar.memberCases') });
      }
    }
  }

  const buildOptionsHtml = (opts) => `<option value="">${t('sidebar.more')}</option>`
    + opts.map((o) => `<option value="${o.value}">${escapeHtmlText(o.label)}</option>`).join('');
  sidebarToolsSelect.innerHTML = buildOptionsHtml(options);
}

function escapeHtmlText(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// First letter of up to the first two words — "Jane Doe" -> "JD",
// "Jane" -> "J", an email address (no space) -> its first letter.
function getInitials(name) {
  if (!name) return '?';
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('');
  return initials.toUpperCase() || '?';
}

function handleToolsSelectChange(selectEl) {
  const value = selectEl.value;
  selectEl.value = '';
  if (value) runSidebarTool(value);
}

sidebarToolsSelect.addEventListener('change', () => handleToolsSelectChange(sidebarToolsSelect));

export function runSidebarTool(value) {
  const active = getActiveDepartment();
  const effectiveSupabase = getEffectiveSupabase();

  if (value === 'change-password') {
    createChangePasswordModal({ supabase: effectiveSupabase }).open();
  } else if (value === 'my-profile') {
    createMyProfileModal({ supabase: effectiveSupabase, userId: currentUserId }).open();
  } else if (value === 'my-letters') {
    createMyLettersModal({ supabase: effectiveSupabase, currentUserId }).open();
  } else if (value === 'disciplinary-letters') {
    createDisciplinaryLettersAdminModal({ supabase: effectiveSupabase, currentUserId }).open();
  } else if (value === 'notifications') {
    createNotificationSettingsModal({ supabase: effectiveSupabase, currentUserId }).open();
  } else if (value === 'church-rules') {
    createRulesModal({
      supabase: effectiveSupabase,
      scope: { type: 'church', canAdminister: hasGlobalReach() && getGlobalRole() === 'super_admin' },
      currentUserId,
      title: t('rules.churchTitle'),
    }).open();
  } else if (value === 'attendance') {
    createAttendanceManagerModal({ supabase: effectiveSupabase, currentUserId }).open();
  } else if (value === 'app-suggestion') {
    createAppSuggestionModal({ supabase: effectiveSupabase, currentUserId }).open();
  } else if (value === 'report-absence') {
    createReportAbsenceModal({ supabase: effectiveSupabase }).open();
  } else if (value === 'join-department') {
    createJoinDepartmentModal({ supabase: effectiveSupabase, currentUserId }).open();
  } else if (value === 'pastor-meeting') {
    // Replaces the old note-only popup entirely -- opens the real
    // scheduling page (js/pastorMeetingsPage.js) instead.
    activateTab('pastor-meetings');
  } else if (value === 'prayer-request') {
    createPrayerRequestModal({ supabase: effectiveSupabase, currentUserId }).open();
  } else if (value === 'department-rules' && active) {
    createRulesModal({
      supabase: effectiveSupabase,
      scope: { type: 'department', departmentId: active.id, departmentKey: active.key, canAdminister: active.role === 'admin' || active.role === 'super_admin' },
      currentUserId,
      title: t('rules.departmentTitle', { department: departmentLabel(active.key) }),
    }).open();
  } else if (value === 'monthly-report' && active) {
    createMonthlyReportModal({
      supabase: effectiveSupabase,
      departmentId: active.id,
      departmentKey: active.key,
      canEdit: active.role === 'admin' || active.role === 'super_admin',
      currentUserId,
      title: t('monthlyReport.titleFor', { department: departmentLabel(active.key) }),
    }).open();
  } else if (value === 'guest-cases' && active) {
    createGuestOnboardingModal({
      supabase: effectiveSupabase,
      currentUserId,
      scope: { type: 'department', departmentId: active.id },
    }).open();
  } else if (value === 'member-cases' && active) {
    createMemberCaseModal({
      supabase: effectiveSupabase,
      currentUserId,
      scope: { type: 'department', departmentId: active.id },
    }).open();
  }

  closeSidebar();
}

async function refreshInboxBadge() {
  const inboxUserId = getViewAsTarget()?.id || currentUserId;
  if (!inboxUserId) {
    inboxBadgeEl.classList.add('hidden');
    return;
  }

  const effectiveSupabase = getEffectiveSupabase();
  const [{ count: unreadMessages }, { count: unreadNotifications }] = await Promise.all([
    effectiveSupabase.from('direct_messages').select('id', { count: 'exact', head: true }).eq('recipient_id', inboxUserId).is('read_at', null),
    effectiveSupabase.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', inboxUserId).is('read_at', null),
  ]);

  const total = (unreadMessages || 0) + (unreadNotifications || 0);
  inboxBadgeEl.textContent = total > 9 ? '9+' : String(total);
  inboxBadgeEl.classList.toggle('hidden', total === 0);
  setAppBadgeCount(total);
}

inboxBtn.addEventListener('click', () => {
  const inboxUserId = getViewAsTarget()?.id || currentUserId;
  const modal = createInboxModal({ supabase: getEffectiveSupabase(), currentUserId: inboxUserId, onRead: refreshInboxBadge });
  modal.open();
  closeSidebar();
});

helpBtn.addEventListener('click', () => {
  const modal = createHelpModal({
    supabase: getEffectiveSupabase(),
    currentUserId,
    canAdminister: hasGlobalReach() && getGlobalRole() === 'super_admin',
  });
  modal.open();
  closeSidebar();
});

// ---- Language switcher (top bar) ----
document.documentElement.lang = getLang();
applyStaticTranslations();

const topbarLangSelect = document.querySelector('#topbar-lang-select');

function updateLangSelect() {
  topbarLangSelect.value = getLang();
}

topbarLangSelect.addEventListener('change', () => setLang(topbarLangSelect.value));
updateLangSelect();

// ---- Night mode (top bar) ----
const topbarThemeToggle = document.querySelector('#topbar-theme-toggle');
const topbarThemeIconSun = document.querySelector('#topbar-theme-icon-sun');
const topbarThemeIconMoon = document.querySelector('#topbar-theme-icon-moon');

function updateThemeIcon() {
  const isDark = getTheme() === 'dark';
  topbarThemeIconSun.classList.toggle('hidden', isDark);
  topbarThemeIconMoon.classList.toggle('hidden', !isDark);
}

topbarThemeToggle.addEventListener('click', () => {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  updateThemeIcon();
});
updateThemeIcon();

onLangChange(() => {
  document.documentElement.lang = getLang();
  applyStaticTranslations();
  updateLangSelect();
  renderAuthScreen(authScreenEl, { supabase });
  if (!passwordRecoveryEl.classList.contains('hidden')) {
    renderPasswordRecovery(passwordRecoveryEl, { supabase, onDone: () => supabase.auth.signOut() });
  }
  // The switcher's option labels and any "coming soon" department name
  // are built from t()/departmentLabel() at render time, not data-i18n.
  if (getMyDepartments().length > 0) {
    populateDepartmentSwitcher();
    applyActiveDepartment();
  } else {
    // applyActiveDepartment() (called above when there's at least one
    // department) already refreshes this — this covers the zero-
    // department case, where Church Rules is still on offer.
    updateSidebarToolsSelect();
  }
  updateRoleSwitcherUI();
  updateViewAsUI();
  updatePreviewAsMemberUI();
  // Dynamic tab content is generated with hardcoded strings, not
  // data-i18n attributes, so the visible tab needs a full re-render.
  if (currentTabName && lazyTabs[currentTabName]) lazyTabs[currentTabName]();
});

// Home and Tools both represent "no department active" now that the
// department switcher is a plain list rather than a <select> that used
// to fold a "Home" option into the same control (and, via its change
// handler, the same setActiveDepartmentKey(HOME_KEY) call). Clearing
// it here only re-renders the list's own highlighting
// (populateDepartmentSwitcher()) -- NOT the heavier
// applyActiveDepartment(), which has its own "no active department"
// branch that forces the tab back to super-home and would hijack a
// click on Tools into landing on Home instead.
const GLOBAL_ONLY_TARGETS = ['super-home', 'tools'];

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    if (GLOBAL_ONLY_TARGETS.includes(tab.dataset.tabTarget) && !isHomeActive()) {
      setActiveDepartmentKey(HOME_KEY);
      populateDepartmentSwitcher();
    }
    activateTab(tab.dataset.tabTarget);
    closeSidebar();
  });
});

// ---- Mobile sidebar drawer ----
const sidebar = document.querySelector('#sidebar');
const sidebarBackdrop = document.querySelector('#sidebar-backdrop');
const menuOpenBtn = document.querySelector('#menu-open-btn');
const menuCloseBtn = document.querySelector('#menu-close-btn');

function openSidebar() {
  sidebar.classList.remove('-translate-x-full');
  sidebarBackdrop.classList.remove('hidden');
}

function closeSidebar() {
  sidebar.classList.add('-translate-x-full');
  sidebarBackdrop.classList.add('hidden');
}

menuOpenBtn.addEventListener('click', openSidebar);
menuCloseBtn.addEventListener('click', closeSidebar);
sidebarBackdrop.addEventListener('click', closeSidebar);

// ---- Mobile bottom tab bar ----
// Home reuses the real data-tab-target button (see the `tabs` click
// handler above), so it already shares styling/gating/click-handling
// with the sidebar's own version. The other four need their own
// wiring here since each one's actual destination depends on role
// and/or the currently active department, not a fixed tab name.

// Directory: a global-reach role (Super Admin/Pastor Admin/Church
// Secretary/etc.) gets the real cross-department Directory (same one
// Tools' own Directory tile opens); everyone else gets the roster for
// whichever department they're currently viewing -- same modal
// deptDashboard.js's own "Manage Roster" button opens, just triggered
// from here too instead of requiring a trip to that tab first.
document.querySelector('[data-mobile-nav="directory"]')?.addEventListener('click', () => {
  if (hasGlobalReach()) {
    openDirectory();
    return;
  }
  const active = getActiveDepartment();
  if (!active) return;
  createUserManagerModal({
    supabase: getEffectiveSupabase(),
    scope: { type: 'department', departmentId: active.id, departmentKey: active.key },
    currentUserId,
    title: t('nav.members'),
  }).open();
});

// Schedule: jumps straight to whichever scheduling tab is correct for
// the active department (Choir's own vs. the shared dept-scheduling
// tab), reusing resolveLandingTab()'s existing Finance/Church Program
// exclusion (those two have no scheduling at all) rather than
// duplicating that check here.
document.querySelector('[data-mobile-nav="schedule"]')?.addEventListener('click', () => {
  const active = getActiveDepartment();
  if (!active) return;
  const isChoir = active.key === 'choir';
  activateTab(resolveLandingTab('scheduling', active, isChoir) || (isChoir ? 'dashboard' : 'dept-dashboard'));
  closeSidebar();
});

// Quick Access: opens quick-access-dialog (defined above, near the
// Account dialog it's modeled on) -- VPD Academy, Service Program,
// Budget (department leadership only), and the active department's
// Dashboard.
document.querySelector('[data-mobile-nav="quick-access"]')?.addEventListener('click', openQuickAccess);

// Settings: the Tools tab, for everyone -- not just global-reach roles
// (unlike the sidebar's own Tools nav entry, which stays admin-only;
// see toolsPage.js's "My Account" category for what an ordinary member
// finds here: profile, church rules, change password, etc.).
document.querySelector('[data-mobile-nav="settings"]')?.addEventListener('click', () => {
  if (!isHomeActive()) {
    setActiveDepartmentKey(HOME_KEY);
    populateDepartmentSwitcher();
  }
  activateTab('tools');
  closeSidebar();
});

// ---- Auth gating ----
const authScreenEl = document.querySelector('#auth-screen');
const appShellEl = document.querySelector('#app-shell');
const passwordRecoveryEl = document.querySelector('#password-recovery-screen');
const signOutBtn = document.querySelector('#sign-out-btn');

renderAuthScreen(authScreenEl, { supabase });

let currentUserId = null;
// True from the moment a PASSWORD_RECOVERY event arrives until the member
// either sets a new password or signs out. Guards against the initial
// getSession() check (which sees the same recovery session as a normal
// login) racing the recovery screen and bouncing them into the app.
let isRecovering = false;

function showPasswordRecovery() {
  isRecovering = true;
  authScreenEl.classList.add('hidden');
  appShellEl.classList.add('hidden');
  passwordRecoveryEl.classList.remove('hidden');
  renderPasswordRecovery(passwordRecoveryEl, {
    supabase,
    onDone: () => { isRecovering = false; supabase.auth.signOut(); },
  });
}

// ---- "Still there?" prompt ----
// A session can legitimately stay signed in indefinitely (that's the
// point of persistSession/autoRefreshToken in supabaseClient.js) — this
// is a periodic check-in, not a security timeout: once a week has
// passed since this *device* first signed in, ask whether to keep
// going here or sign out of every device. Tracked per-device via
// localStorage (mirrors i18n.js's pattern), independent of the actual
// Supabase token lifetime, since auto-refresh keeps renewing the token
// itself and would otherwise make "when did this device first sign in"
// impossible to recover from the session object alone.
const SESSION_STARTED_KEY = 'choir-hub-session-started-at';
const SESSION_CHECK_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function markSessionStart() {
  localStorage.setItem(SESSION_STARTED_KEY, String(Date.now()));
}

function checkSessionAge() {
  if (document.querySelector('#stay-connected-prompt')) return;

  const stored = localStorage.getItem(SESSION_STARTED_KEY);
  if (!stored) {
    // No baseline (e.g. this device signed in before this feature
    // existed) — start counting from today rather than never asking.
    markSessionStart();
    return;
  }
  if (Date.now() - Number(stored) >= SESSION_CHECK_AGE_MS) {
    showStayConnectedPrompt();
  }
}

function showStayConnectedPrompt() {
  const root = document.createElement('div');
  root.id = 'stay-connected-prompt';
  root.className = 'fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
      <h2 class="text-lg font-bold mb-2 text-[#0B1F3A]">${t('session.stayConnectedTitle')}</h2>
      <p class="text-sm text-slate-600 mb-6">${t('session.stayConnectedMessage')}</p>
      <div class="flex flex-col gap-2">
        <button type="button" data-action="stay" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('session.stayConnected')}
        </button>
        <button type="button" data-action="signout-all" class="px-4 py-2 rounded-lg text-rose-600 hover:bg-rose-50 font-medium">
          ${t('session.signOutEverywhere')}
        </button>
      </div>
    </div>
  `;
  // Deliberately no backdrop-click-to-dismiss — this needs an explicit
  // answer rather than being able to tap away from it by accident.
  document.body.appendChild(root);

  root.querySelector('[data-action="stay"]').addEventListener('click', () => {
    markSessionStart();
    root.remove();
  });

  root.querySelector('[data-action="signout-all"]').addEventListener('click', async () => {
    localStorage.removeItem(SESSION_STARTED_KEY);
    root.remove();
    await supabase.auth.signOut({ scope: 'global' });
  });
}

// Deep-link support for a shared link/QR code (?open=<tab>&dept=<key>)
// — the Headcount Tally tool's "Share Link" button encodes one of
// these so scanning it, once signed in, lands straight on the right
// department's tool instead of wherever normal landing logic would
// otherwise choose. Only consulted once per page load (the query
// string is stripped from the URL afterward) so a later refresh in
// the same tab doesn't keep re-applying it over whatever the user has
// since navigated to themselves.
async function applyDeepLinkFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const openTab = params.get('open');
  if (!openTab) return;

  const deptKey = params.get('dept');
  if (deptKey && getMyDepartments().some((d) => d.key === deptKey)) {
    await handleDepartmentSwitch(deptKey);
  }
  if (lazyTabs[openTab]) activateTab(openTab);

  history.replaceState(null, '', window.location.pathname + window.location.hash);
}

async function showApp(session, { isFreshSignIn = false } = {}) {
  if (isRecovering) return;

  passwordRecoveryEl.classList.add('hidden');
  authScreenEl.classList.add('hidden');
  appShellEl.classList.remove('hidden');

  // A different user signed in than last time — clear cached tab content
  // so scheduling/songbook re-fetch under the new identity.
  if (currentUserId !== session.user.id) {
    loadedTabs = new Set();
    currentUserId = session.user.id;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, removed_at')
    .eq('id', session.user.id)
    .single();

  // Someone a Super Admin removed from the church entirely (see
  // remove_user_from_church in sql/030) keeps their profiles row and
  // Supabase Auth account (avoids cascade-deleting content they authored),
  // but must be blocked from the app itself — this is the client-side
  // half of that gate.
  if (profile?.removed_at) {
    appShellEl.classList.add('hidden');
    window.alert(t('auth.accountRemoved'));
    await supabase.auth.signOut({ scope: 'global' });
    return;
  }

  const displayName = profile?.full_name || session.user.email;
  forEachNavGroup('current-user-name', (el) => { el.textContent = displayName; });
  forEachNavGroup('current-user-initials', (el) => { el.textContent = getInitials(displayName); });

  // Loaded before anything that renders a nav/department label, so
  // renames from menuCustomizer.js are in effect on first paint, not
  // just after a re-render.
  await loadLabelOverrides();
  await loadAppTheme();
  await loadChurchBranding();
  await loadMyDepartments(session.user.id);
  await loadSchoolAdminStatus(session.user.id);

  // A fresh sign-in (not a page-refresh session restore) always resets
  // a global-role holder to Super Admin Mode and their Home console —
  // "upon login" per the routing requirement, not "on every page load."
  // setActingAsStandardUser(false) also calls goHome() internally.
  if (isFreshSignIn && getGlobalRole()) setActingAsStandardUser(false);

  if (isFreshSignIn) markSessionStart(); else checkSessionAge();

  // Seed from the last tab this browser was actually viewing, but only on
  // a fresh page load (currentTabName still at its module-load default) --
  // a later showApp() call in the same session (e.g. after a token
  // refresh) must never clobber a tab the user has since navigated to.
  // resolveLandingTab()'s existing context guards (TAB_KIND_MAP, the
  // uniform/dept-scheduling exclusions) still apply to this value exactly
  // as they do to an in-session department switch, so a stored tab that's
  // invalid for the department being landed on here is never restored.
  if (currentTabName === null) currentTabName = localStorage.getItem(TAB_STORAGE_KEY);

  populateDepartmentSwitcher();
  applyActiveDepartment();
  await applyDeepLinkFromUrl();
  updateRoleSwitcherUI();
  updateViewAsUI();
  updatePreviewAsMemberUI();
  updateMemberActionsUI();
  refreshInboxBadge();
  checkSpecialProgramPopup(supabase);
}

// Shown right after a genuine sign-in (not a page reload restoring an
// existing session) — the real app renders underneath in the
// background so the wait doesn't add to actual load time, then the
// overlay fades away to reveal it. Only shown the very first time this
// browser ever signs in (tracked via HAS_WELCOMED_KEY); every sign-in
// after that skips straight to the app with no delay at all.
const SPLASH_MIN_DURATION_MS = 1100;
const HAS_WELCOMED_KEY = 'choir-hub-has-welcomed';

async function showSplashThenApp(session) {
  if (localStorage.getItem(HAS_WELCOMED_KEY)) {
    await showApp(session, { isFreshSignIn: true });
    return;
  }
  localStorage.setItem(HAS_WELCOMED_KEY, '1');

  loginSplashEl.classList.remove('hidden', 'opacity-0');
  loginSplashEl.classList.add('flex');

  await Promise.all([
    showApp(session, { isFreshSignIn: true }),
    new Promise((resolve) => setTimeout(resolve, SPLASH_MIN_DURATION_MS)),
  ]);

  loginSplashEl.classList.add('opacity-0');
  setTimeout(() => {
    loginSplashEl.classList.add('hidden');
    loginSplashEl.classList.remove('flex');
  }, 700);
}

function showAuth() {
  currentUserId = null;
  isRecovering = false;
  stopViewAs();
  localStorage.removeItem(SESSION_STARTED_KEY);
  document.querySelector('#stay-connected-prompt')?.remove();
  passwordRecoveryEl.classList.add('hidden');
  appShellEl.classList.add('hidden');
  authScreenEl.classList.remove('hidden');
  forEachNavGroup('members-nav', (el) => el.classList.add('hidden'));
  departmentSwitcherWrapEl.classList.add('hidden');
  forEachNavGroup('view-as-wrap', (el) => el.classList.add('hidden'));
  viewAsBannerEl.classList.add('hidden');
  forEachNavGroup('preview-as-member-wrap', (el) => el.classList.add('hidden'));
  forEachNavGroup('role-switcher-wrap', (el) => el.classList.add('hidden'));
  inboxBtn.classList.add('hidden');
  inboxBadgeEl.classList.add('hidden');
  sidebarToolsSelect.innerHTML = '<option value=""></option>';
  headerNewMemberBtn.classList.add('hidden');
  headerNewMemberBtn.classList.remove('flex');
  setAppBadgeCount(0);
}

supabase.auth.getSession().then(({ data: { session }, error }) => {
  if (error) console.error('Supabase session check failed:', error.message);
  if (session) showApp(session); else showAuth();
});

initVersionCheck();

// supabase-js fires this listener's very first callback at subscribe time
// on every page load (restoring an existing session or reporting none),
// and in this SDK setup that first firing can itself carry event
// 'SIGNED_IN' -- indistinguishable by event name alone from a real,
// interactive login. Treating that as isFreshSignIn (see showApp()) wrongly
// forced any global-role holder (Super Admin/Secretary) out of whatever
// department/tab they were on and back to Home on a plain refresh. A real
// login can only happen after the auth form is mounted and submitted,
// which is always after this first firing, so only firings after the
// first one are ever treated as a fresh sign-in.
let hasHandledInitialAuthEvent = false;

supabase.auth.onAuthStateChange((event, session) => {
  const isInitialFiring = !hasHandledInitialAuthEvent;
  hasHandledInitialAuthEvent = true;

  if (event === 'PASSWORD_RECOVERY') {
    showPasswordRecovery();
    return;
  }
  if (!session) {
    showAuth();
    return;
  }
  if (event === 'SIGNED_IN' && !isInitialFiring) {
    showSplashThenApp(session);
  } else {
    showApp(session);
  }
});

signOutBtn.addEventListener('click', () => supabase.auth.signOut());
signOutBtnDesktop.addEventListener('click', () => supabase.auth.signOut());
