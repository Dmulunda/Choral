// Tab navigation — swaps which panel is visible and highlights the active nav link.
import { supabase } from './supabaseClient.js';
import { renderSchedulingTab } from './scheduling.js';
import { renderSongbookTab } from './songbook.js';
import { renderVoiceExercises } from './components/voiceExercises.js';
import { renderAuthScreen } from './components/authScreen.js';
import { renderPasswordRecovery } from './components/passwordRecovery.js';
import { renderMembersTab } from './members.js';
import { renderDashboardTab } from './dashboard.js';
import { renderDeptDashboardTab } from './deptDashboard.js';
import { renderDeptSchedulingTab } from './deptScheduling.js';
import { renderSuperAdminHomeTab } from './superAdminHome.js';
import { renderDepartmentApprovals } from './components/departmentApprovals.js';
import { createViewAsPickerModal } from './components/viewAsPicker.js';
import { createReportAbsenceModal } from './components/reportAbsenceModal.js';
import { createInboxModal } from './components/inboxModal.js';
import { createRulesModal } from './components/rulesModal.js';
import { createMonthlyReportModal } from './components/monthlyReportModal.js';
import { createAttendanceManagerModal } from './components/attendanceManager.js';
import { createAppSuggestionModal } from './components/appSuggestionModal.js';
import { getLang, setLang, onLangChange, applyStaticTranslations, departmentLabel, t } from './i18n.js';
import {
  loadMyDepartments, getMyDepartments, getActiveDepartment, setActiveDepartmentKey,
  getGlobalRole, isViewingAs, getViewAsTarget, startViewAs, stopViewAs, getEffectiveSupabase,
  hasGlobalReach, isActingAsStandardUser, setActingAsStandardUser, isHomeActive, HOME_KEY,
  isPreviewingAsMember, startPreviewAsMember, stopPreviewAsMember,
} from './departments.js';
import { registerServiceWorker, setAppBadgeCount } from './pwa.js';
import { getTheme, setTheme } from './theme.js';

registerServiceWorker();

const tabs = document.querySelectorAll('[data-tab-target]');
const panels = document.querySelectorAll('[data-tab-panel]');
const membersNavBtn = document.querySelector('#members-nav-btn');
const choirNavGroupEl = document.querySelector('#choir-nav-group');
const lightweightNavGroupEl = document.querySelector('#lightweight-nav-group');
const departmentSwitcherWrapEl = document.querySelector('#department-switcher-wrap');
const departmentSwitcherEl = document.querySelector('#department-switcher');
const deptDashboardNameEl = document.querySelector('[data-el="dept-dashboard-name"]');
const deptSchedulingNameEl = document.querySelector('[data-el="dept-scheduling-name"]');
const deptSchedulingNavBtn = document.querySelector('#dept-scheduling-nav-btn');
const comingSoonPanelEl = document.querySelector('#department-coming-soon');
const comingSoonDeptNameEl = comingSoonPanelEl.querySelector('[data-el="dept-name"]');
const comingSoonApprovalsEl = document.querySelector('#department-coming-soon-approvals');
const comingSoonApprovalsListEl = comingSoonApprovalsEl.querySelector('[data-el="approvals-list"]');
const noAccessPanelEl = document.querySelector('#no-department-access');
const globalNavGroupEl = document.querySelector('#global-nav-group');
const inboxBtn = document.querySelector('#inbox-btn');
const inboxBadgeEl = document.querySelector('#inbox-badge');
const sidebarToolsSelect = document.querySelector('#sidebar-tools-select');
const viewAsWrapEl = document.querySelector('#view-as-wrap');
const viewAsBtn = document.querySelector('#view-as-btn');
const viewAsBannerEl = document.querySelector('#view-as-banner');
const viewAsBannerTextEl = viewAsBannerEl.querySelector('[data-el="text"]');
const viewAsExitBtn = document.querySelector('#view-as-exit-btn');
const previewAsMemberWrapEl = document.querySelector('#preview-as-member-wrap');
const previewAsMemberBtn = document.querySelector('#preview-as-member-btn');
const roleSwitcherWrapEl = document.querySelector('#role-switcher-wrap');
const roleSwitcherAdminBtn = document.querySelector('#role-switcher-admin-btn');
const roleSwitcherStandardBtn = document.querySelector('#role-switcher-standard-btn');
const loginSplashEl = document.querySelector('#login-splash');

// Tabs whose content is fetched from Supabase on first visit rather than
// baked into the initial page load.
const lazyTabs = {
  dashboard: renderDashboardTab,
  scheduling: renderSchedulingTab,
  songbook: renderSongbookTab,
  'voice-exercises': () => renderVoiceExercises(document.querySelector('#voice-exercises-content')),
  members: renderMembersTab,
  'dept-dashboard': renderDeptDashboardTab,
  'dept-scheduling': renderDeptSchedulingTab,
  'super-home': renderSuperAdminHomeTab,
};
let loadedTabs = new Set();
let currentTabName = null;

function activateTab(name) {
  currentTabName = name;

  panels.forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.tabPanel !== name);
  });

  tabs.forEach((tab) => {
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

// ---- Department switcher ----
// Only Choir has real screens today — other departments show a
// placeholder until their own phase ships. The switcher itself only
// ever lists departments the signed-in user actually has approved
// access to (or every department, for a super admin/viewer).
function populateDepartmentSwitcher() {
  const departments = getMyDepartments();
  const showHomeOption = hasGlobalReach();
  departmentSwitcherWrapEl.classList.toggle('hidden', departments.length === 0 && !showHomeOption);

  const homeOption = showHomeOption ? `<option value="${HOME_KEY}">${t('nav.home')}</option>` : '';
  departmentSwitcherEl.innerHTML = homeOption + departments
    .map((d) => `<option value="${d.key}">${departmentLabel(d.key)}</option>`)
    .join('');

  const active = getActiveDepartment();
  departmentSwitcherEl.value = active ? active.key : (isHomeActive() ? HOME_KEY : '');
}

function applyActiveDepartment() {
  const active = getActiveDepartment();

  // hasGlobalReach() (not the active department's role) drives this,
  // since active is intentionally null while on the Home console —
  // Home itself lives inside this same nav group.
  globalNavGroupEl.classList.toggle('hidden', !hasGlobalReach());
  updateSidebarToolsSelect();

  if (!active) {
    if (isHomeActive()) {
      noAccessPanelEl.classList.add('hidden');
      choirNavGroupEl.classList.add('hidden');
      lightweightNavGroupEl.classList.add('hidden');
      membersNavBtn.classList.add('hidden');
      comingSoonPanelEl.classList.add('hidden');
      loadedTabs.delete('super-home');
      activateTab('super-home');
      return;
    }

    noAccessPanelEl.classList.remove('hidden');
    choirNavGroupEl.classList.add('hidden');
    lightweightNavGroupEl.classList.add('hidden');
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
  // every department gets Scheduling except Finance, which explicitly
  // hides just that one tab below.
  const isDeptDashboardKind = active.kind === 'lightweight' || active.kind === 'custom';
  choirNavGroupEl.classList.toggle('hidden', !isChoir);
  lightweightNavGroupEl.classList.toggle('hidden', !isDeptDashboardKind);
  membersNavBtn.classList.toggle('hidden', !isChoir || !(active.role === 'admin' || active.role === 'super_admin'));
  // Finance keeps Dashboard but explicitly loses Scheduling — every
  // other department gets both.
  deptSchedulingNavBtn.classList.toggle('hidden', isDeptDashboardKind && active.key === 'finance');

  if (isChoir) {
    comingSoonPanelEl.classList.add('hidden');
    activateTab('dashboard');
  } else if (isDeptDashboardKind) {
    comingSoonPanelEl.classList.add('hidden');
    deptDashboardNameEl.textContent = departmentLabel(active.key);
    deptSchedulingNameEl.textContent = departmentLabel(active.key);
    // A different department may have been active last time these tab
    // names were used, so force a fresh render rather than trusting the
    // lazy-load cache.
    loadedTabs.delete('dept-dashboard');
    loadedTabs.delete('dept-scheduling');
    activateTab('dept-dashboard');
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

departmentSwitcherEl.addEventListener('change', () => {
  setActiveDepartmentKey(departmentSwitcherEl.value);
  applyActiveDepartment();
  updatePreviewAsMemberUI();
  closeSidebar();
});

// ---- Role Switcher: Super Admin Mode vs Standard User Mode ----
function updateRoleSwitcherUI() {
  roleSwitcherWrapEl.classList.toggle('hidden', !getGlobalRole() || isViewingAs());

  const standard = isActingAsStandardUser();
  roleSwitcherAdminBtn.classList.toggle('bg-indigo-600', !standard);
  roleSwitcherAdminBtn.classList.toggle('text-white', !standard);
  roleSwitcherAdminBtn.classList.toggle('text-slate-400', standard);
  roleSwitcherStandardBtn.classList.toggle('bg-indigo-600', standard);
  roleSwitcherStandardBtn.classList.toggle('text-white', standard);
  roleSwitcherStandardBtn.classList.toggle('text-slate-400', !standard);
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

roleSwitcherAdminBtn.addEventListener('click', () => {
  setActingAsStandardUser(false);
  refreshAfterRoleModeChange();
});

roleSwitcherStandardBtn.addEventListener('click', () => {
  setActingAsStandardUser(true);
  refreshAfterRoleModeChange();
});

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
  viewAsWrapEl.classList.toggle('hidden', !canViewAs || isViewingAs());
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

viewAsBtn.addEventListener('click', () => {
  const modal = createViewAsPickerModal({
    supabase,
    currentUserId,
    onSelect: async (targetUserId, targetFullName) => {
      await startViewAs(targetUserId, targetFullName);
      refreshAfterViewAsChange();
    },
  });
  modal.open();
});

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
  previewAsMemberWrapEl.classList.toggle('hidden', !canPreview);
  updateIdentityBanner();
}

previewAsMemberBtn.addEventListener('click', () => {
  startPreviewAsMember();
  refreshAfterViewAsChange();
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

function updateMemberActionsUI() {
  const hasAccess = getMyDepartments().length > 0;
  inboxBtn.classList.toggle('hidden', !hasAccess);
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
  if (canRecordAttendance) options.push({ value: 'attendance', label: t('sidebar.attendance') });
  if (canSubmitSuggestion) options.push({ value: 'app-suggestion', label: t('sidebar.appSuggestion') });
  if (hasAccess) {
    if (!isViewingAs()) options.push({ value: 'report-absence', label: t('sidebar.reportAbsence') });
    if (active) {
      options.push({ value: 'department-rules', label: t('sidebar.departmentRules') });
      options.push({ value: 'monthly-report', label: t('sidebar.monthlyReport') });
    }
  }

  sidebarToolsSelect.innerHTML = `<option value="">${t('sidebar.more')}</option>`
    + options.map((o) => `<option value="${o.value}">${escapeHtmlText(o.label)}</option>`).join('');
}

function escapeHtmlText(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

sidebarToolsSelect.addEventListener('change', () => {
  const value = sidebarToolsSelect.value;
  sidebarToolsSelect.value = '';
  if (value) runSidebarTool(value);
});

function runSidebarTool(value) {
  const active = getActiveDepartment();
  const effectiveSupabase = getEffectiveSupabase();

  if (value === 'church-rules') {
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

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
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

// ---- Auth gating ----
const authScreenEl = document.querySelector('#auth-screen');
const appShellEl = document.querySelector('#app-shell');
const passwordRecoveryEl = document.querySelector('#password-recovery-screen');
const currentUserNameEl = document.querySelector('#current-user-name');
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

  currentUserNameEl.textContent = profile?.full_name || session.user.email;

  await loadMyDepartments(session.user.id);

  // A fresh sign-in (not a page-refresh session restore) always resets
  // a global-role holder to Super Admin Mode and their Home console —
  // "upon login" per the routing requirement, not "on every page load."
  // setActingAsStandardUser(false) also calls goHome() internally.
  if (isFreshSignIn && getGlobalRole()) setActingAsStandardUser(false);

  if (isFreshSignIn) markSessionStart(); else checkSessionAge();

  populateDepartmentSwitcher();
  applyActiveDepartment();
  updateRoleSwitcherUI();
  updateViewAsUI();
  updatePreviewAsMemberUI();
  updateMemberActionsUI();
  refreshInboxBadge();
}

// Shown for a few seconds right after a genuine sign-in (not a page
// reload restoring an existing session) — the real app renders
// underneath in the background so the wait doesn't add to actual load
// time, then the overlay fades away to reveal it.
const SPLASH_MIN_DURATION_MS = 3000;

async function showSplashThenApp(session) {
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
  membersNavBtn.classList.add('hidden');
  departmentSwitcherWrapEl.classList.add('hidden');
  viewAsWrapEl.classList.add('hidden');
  viewAsBannerEl.classList.add('hidden');
  previewAsMemberWrapEl.classList.add('hidden');
  roleSwitcherWrapEl.classList.add('hidden');
  inboxBtn.classList.add('hidden');
  inboxBadgeEl.classList.add('hidden');
  sidebarToolsSelect.innerHTML = '<option value=""></option>';
  setAppBadgeCount(0);
}

supabase.auth.getSession().then(({ data: { session }, error }) => {
  if (error) console.error('Supabase session check failed:', error.message);
  if (session) showApp(session); else showAuth();
});

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    showPasswordRecovery();
    return;
  }
  if (!session) {
    showAuth();
    return;
  }
  if (event === 'SIGNED_IN') {
    showSplashThenApp(session);
  } else {
    showApp(session);
  }
});

signOutBtn.addEventListener('click', () => supabase.auth.signOut());
