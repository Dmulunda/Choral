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
import { renderPreachingTab } from './preachingSchedule.js';
import { renderMediaTechTab } from './mediaTechSchedule.js';
import { renderEcodemTab } from './ecodemSchedule.js';
import { renderSuperAdminHomeTab } from './superAdminHome.js';
import { renderDepartmentApprovals } from './components/departmentApprovals.js';
import { createViewAsPickerModal } from './components/viewAsPicker.js';
import { createReportAbsenceModal } from './components/reportAbsenceModal.js';
import { createInboxModal } from './components/inboxModal.js';
import { getLang, setLang, onLangChange, applyStaticTranslations, departmentLabel, t } from './i18n.js';
import {
  loadMyDepartments, getMyDepartments, getActiveDepartment, setActiveDepartmentKey,
  getGlobalRole, isViewingAs, getViewAsTarget, startViewAs, stopViewAs, getEffectiveSupabase,
  hasGlobalReach, isActingAsStandardUser, setActingAsStandardUser, isHomeActive, HOME_KEY,
  isPreviewingAsMember, startPreviewAsMember, stopPreviewAsMember,
} from './departments.js';

const tabs = document.querySelectorAll('[data-tab-target]');
const panels = document.querySelectorAll('[data-tab-panel]');
const membersNavBtn = document.querySelector('#members-nav-btn');
const choirNavGroupEl = document.querySelector('#choir-nav-group');
const lightweightNavGroupEl = document.querySelector('#lightweight-nav-group');
const departmentSwitcherWrapEl = document.querySelector('#department-switcher-wrap');
const departmentSwitcherEl = document.querySelector('#department-switcher');
const deptDashboardNameEl = document.querySelector('[data-el="dept-dashboard-name"]');
const deptSchedulingNameEl = document.querySelector('[data-el="dept-scheduling-name"]');
const comingSoonPanelEl = document.querySelector('#department-coming-soon');
const comingSoonDeptNameEl = comingSoonPanelEl.querySelector('[data-el="dept-name"]');
const comingSoonApprovalsEl = document.querySelector('#department-coming-soon-approvals');
const comingSoonApprovalsListEl = comingSoonApprovalsEl.querySelector('[data-el="approvals-list"]');
const noAccessPanelEl = document.querySelector('#no-department-access');
const globalNavGroupEl = document.querySelector('#global-nav-group');
const memberActionsWrapEl = document.querySelector('#member-actions-wrap');
const reportAbsenceBtn = document.querySelector('#report-absence-btn');
const inboxBtn = document.querySelector('#inbox-btn');
const inboxBadgeEl = document.querySelector('#inbox-badge');
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
  preaching: renderPreachingTab,
  'media-tech': renderMediaTechTab,
  ecodem: renderEcodemTab,
  'super-home': renderSuperAdminHomeTab,
};
let loadedTabs = new Set();
let currentTabName = null;

// Bespoke departments with exactly one view (no Dashboard/Scheduling
// split) — maps department key to its tab/panel name.
const SINGLE_VIEW_CUSTOM_TABS = {
  preaching: 'preaching',
  ecodem: 'ecodem',
  media_tech: 'media-tech',
};

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
  const isLightweight = active.kind === 'lightweight';
  choirNavGroupEl.classList.toggle('hidden', !isChoir);
  lightweightNavGroupEl.classList.toggle('hidden', !isLightweight);
  membersNavBtn.classList.toggle('hidden', !isChoir || !(active.role === 'admin' || active.role === 'super_admin'));

  const singleViewTab = SINGLE_VIEW_CUSTOM_TABS[active.key];

  if (isChoir) {
    comingSoonPanelEl.classList.add('hidden');
    activateTab('dashboard');
  } else if (isLightweight) {
    comingSoonPanelEl.classList.add('hidden');
    deptDashboardNameEl.textContent = departmentLabel(active.key);
    deptSchedulingNameEl.textContent = departmentLabel(active.key);
    // A different lightweight department may have been active last time
    // these tab names were used, so force a fresh render rather than
    // trusting the lazy-load cache.
    loadedTabs.delete('dept-dashboard');
    loadedTabs.delete('dept-scheduling');
    activateTab('dept-dashboard');
  } else if (singleViewTab) {
    // Bespoke single-view departments (Preaching & Moderation, Media &
    // Tech) — each has its own tab name/panel but no sub-nav, so a fresh
    // render is forced the same way as the lightweight tabs above.
    comingSoonPanelEl.classList.add('hidden');
    loadedTabs.delete(singleViewTab);
    activateTab(singleViewTab);
  } else {
    // "custom" departments without bespoke tooling yet (Ecodem) — its
    // own phase replaces this branch.
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
// succeed); the Inbox stays visible so a Super Admin previewing another
// user's view sees what that user would see — resolved via
// getViewAsTarget() rather than the real currentUserId in both places
// below, same as every other identity-sensitive spot in this file.
function updateMemberActionsUI() {
  const hasAccess = getMyDepartments().length > 0;
  memberActionsWrapEl.classList.toggle('hidden', !hasAccess);
  reportAbsenceBtn.classList.toggle('hidden', !hasAccess || isViewingAs());
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
}

reportAbsenceBtn.addEventListener('click', () => {
  const modal = createReportAbsenceModal({ supabase: getEffectiveSupabase() });
  modal.open();
  closeSidebar();
});

inboxBtn.addEventListener('click', () => {
  const inboxUserId = getViewAsTarget()?.id || currentUserId;
  const modal = createInboxModal({ supabase: getEffectiveSupabase(), currentUserId: inboxUserId, onRead: refreshInboxBadge });
  modal.open();
  closeSidebar();
});

// ---- Language switcher ----
document.documentElement.lang = getLang();
applyStaticTranslations();

const langButtons = document.querySelectorAll('[data-lang]');

function updateLangButtons() {
  const current = getLang();
  langButtons.forEach((btn) => {
    const active = btn.dataset.lang === current;
    btn.classList.toggle('bg-indigo-600', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('text-slate-400', !active);
  });
}

langButtons.forEach((btn) => btn.addEventListener('click', () => setLang(btn.dataset.lang)));
updateLangButtons();

onLangChange(() => {
  document.documentElement.lang = getLang();
  applyStaticTranslations();
  updateLangButtons();
  renderAuthScreen(authScreenEl, { supabase });
  if (!passwordRecoveryEl.classList.contains('hidden')) {
    renderPasswordRecovery(passwordRecoveryEl, { supabase, onDone: () => supabase.auth.signOut() });
  }
  // The switcher's option labels and any "coming soon" department name
  // are built from t()/departmentLabel() at render time, not data-i18n.
  if (getMyDepartments().length > 0) {
    populateDepartmentSwitcher();
    applyActiveDepartment();
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
    .select('full_name, role')
    .eq('id', session.user.id)
    .single();
  currentUserNameEl.textContent = profile?.full_name || session.user.email;

  await loadMyDepartments(session.user.id);

  // A fresh sign-in (not a page-refresh session restore) always resets
  // a global-role holder to Super Admin Mode and their Home console —
  // "upon login" per the routing requirement, not "on every page load."
  // setActingAsStandardUser(false) also calls goHome() internally.
  if (isFreshSignIn && getGlobalRole()) setActingAsStandardUser(false);

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
const SPLASH_MIN_DURATION_MS = 4000;

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
  passwordRecoveryEl.classList.add('hidden');
  appShellEl.classList.add('hidden');
  authScreenEl.classList.remove('hidden');
  membersNavBtn.classList.add('hidden');
  departmentSwitcherWrapEl.classList.add('hidden');
  viewAsWrapEl.classList.add('hidden');
  viewAsBannerEl.classList.add('hidden');
  previewAsMemberWrapEl.classList.add('hidden');
  roleSwitcherWrapEl.classList.add('hidden');
  memberActionsWrapEl.classList.add('hidden');
  inboxBadgeEl.classList.add('hidden');
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
