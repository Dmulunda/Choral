// Tab navigation — swaps which panel is visible and highlights the active nav link.
import { supabase } from './supabaseClient.js';
import { renderSchedulingTab } from './scheduling.js';
import { renderSongbookTab } from './songbook.js';
import { renderVoiceExercises } from './components/voiceExercises.js';
import { renderAuthScreen } from './components/authScreen.js';
import { renderMembersTab } from './members.js';
import { renderDashboardTab } from './dashboard.js';
import { getLang, setLang, onLangChange, applyStaticTranslations } from './i18n.js';

const tabs = document.querySelectorAll('[data-tab-target]');
const panels = document.querySelectorAll('[data-tab-panel]');
const membersNavBtn = document.querySelector('#members-nav-btn');

// Tabs whose content is fetched from Supabase on first visit rather than
// baked into the initial page load.
const lazyTabs = {
  dashboard: renderDashboardTab,
  scheduling: renderSchedulingTab,
  songbook: renderSongbookTab,
  'voice-exercises': () => renderVoiceExercises(document.querySelector('#voice-exercises-content')),
  members: renderMembersTab,
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
const currentUserNameEl = document.querySelector('#current-user-name');
const signOutBtn = document.querySelector('#sign-out-btn');

renderAuthScreen(authScreenEl, { supabase });

let currentUserId = null;

async function showApp(session) {
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
  membersNavBtn.classList.toggle('hidden', profile?.role !== 'admin');

  activateTab('dashboard');
}

function showAuth() {
  currentUserId = null;
  appShellEl.classList.add('hidden');
  authScreenEl.classList.remove('hidden');
  membersNavBtn.classList.add('hidden');
}

supabase.auth.getSession().then(({ data: { session }, error }) => {
  if (error) console.error('Supabase session check failed:', error.message);
  if (session) showApp(session); else showAuth();
});

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) showApp(session); else showAuth();
});

signOutBtn.addEventListener('click', () => supabase.auth.signOut());
