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
import { renderDepartmentApprovals } from './components/departmentApprovals.js';
import { getLang, setLang, onLangChange, applyStaticTranslations, departmentLabel } from './i18n.js';
import { loadMyDepartments, getMyDepartments, getActiveDepartment, setActiveDepartmentKey } from './departments.js';

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
};
let loadedTabs = new Set();
let currentTabName = null;

// Bespoke departments with exactly one view (no Dashboard/Scheduling
// split) — maps department key to its tab/panel name.
const SINGLE_VIEW_CUSTOM_TABS = {
  preaching: 'preaching',
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
  departmentSwitcherWrapEl.classList.toggle('hidden', departments.length === 0);

  departmentSwitcherEl.innerHTML = departments
    .map((d) => `<option value="${d.key}">${departmentLabel(d.key)}</option>`)
    .join('');

  const active = getActiveDepartment();
  if (active) departmentSwitcherEl.value = active.key;
}

function applyActiveDepartment() {
  const active = getActiveDepartment();

  noAccessPanelEl.classList.toggle('hidden', !!active);
  if (!active) {
    choirNavGroupEl.classList.add('hidden');
    lightweightNavGroupEl.classList.add('hidden');
    panels.forEach((panel) => panel.classList.add('hidden'));
    comingSoonPanelEl.classList.add('hidden');
    return;
  }

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

async function showApp(session) {
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
  populateDepartmentSwitcher();
  applyActiveDepartment();
}

function showAuth() {
  currentUserId = null;
  isRecovering = false;
  passwordRecoveryEl.classList.add('hidden');
  appShellEl.classList.add('hidden');
  authScreenEl.classList.remove('hidden');
  membersNavBtn.classList.add('hidden');
  departmentSwitcherWrapEl.classList.add('hidden');
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
  if (session) showApp(session); else showAuth();
});

signOutBtn.addEventListener('click', () => supabase.auth.signOut());
