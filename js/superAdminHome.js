// Super Admin Home tab entry point: where a global-role holder
// (Super Admin, Super Viewer, Pastor Admin, Church Secretary) lands
// first — clickable metrics, every pending membership request across
// every department (the actual fix for "Super Admin can't approve" —
// the RLS already allowed it, there was just no cross-department view
// to find them in), and pop-up buttons for the per-department report
// table and the full cross-department User Directory (same pattern as
// the budget-request/board pop-ups — nothing this heavy stays inline).
// Department views only load once explicitly picked from the
// switcher/nav.
import { getEffectiveSupabase, getGlobalRole } from './departments.js';
import { createUserManagerModal } from './components/userManager.js';
import { renderAllDepartmentApprovals } from './components/allDepartmentApprovals.js';
import { createGuestOnboardingModal } from './components/guestOnboardingHub.js';
import { createMemberCaseModal } from './components/memberCaseManager.js';
import { createMenuCustomizerModal } from './components/menuCustomizer.js';
import { createMessageModerationModal } from './components/messageModeration.js';
import { createLoginActivityModal } from './components/loginActivity.js';
import { createDepartmentModal } from './components/createDepartmentModal.js';
import { createPastorMeetingQueueModal } from './components/pastorMeetingRequests.js';
import { createPrayerRequestQueueModal } from './components/prayerRequests.js';
import { renderDateHeader } from './components/dateHeader.js';
import { t, departmentLabel } from './i18n.js';

const PASTORAL_TEAM_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];

let currentDirectoryModal = null;
let currentReportsModal = null;
let currentGuestHubModal = null;
let currentMemberCaseModal = null;
let currentMenuCustomizerModal = null;
let currentMessageModerationModal = null;
let currentLoginActivityModal = null;
let currentCreateDepartmentModal = null;
let currentPastorMeetingQueueModal = null;
let currentPrayerRequestQueueModal = null;

export async function renderSuperAdminHomeTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#super-home-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  container.innerHTML = `
    <div data-el="date-header"></div>
    <div data-el="metrics"></div>

    <div id="super-home-pending" class="bg-white rounded-xl shadow p-4 sm:p-6 mt-6">
      <h2 class="text-lg font-semibold mb-4">${t('superHome.pendingTitle')}</h2>
      <div data-el="pending"></div>
    </div>

    <div class="flex flex-wrap gap-3 mt-6">
      <button type="button" data-action="open-reports" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
        ${t('superHome.reportsTitle')}
      </button>
      <button type="button" data-action="open-directory" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
        ${t('directory.title')}
      </button>
      ${PASTORAL_TEAM_ROLES.includes(getGlobalRole()) ? `
        <button type="button" data-action="open-guest-hub" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('guestHub.title')}
        </button>
        <button type="button" data-action="open-member-cases" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('memberCase.title')}
        </button>
        <button type="button" data-action="open-pastor-meetings" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('pastorMeeting.queueTitle')}
        </button>
        <button type="button" data-action="open-prayer-requests" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('prayerRequest.queueTitle')}
        </button>
      ` : ''}
      ${getGlobalRole() === 'super_admin' ? `
        <button type="button" data-action="open-create-department" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('superHome.createDepartmentTitle')}
        </button>
        <button type="button" data-action="open-menu-customizer" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('menuCustomizer.title')}
        </button>
        <button type="button" data-action="open-message-moderation" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('messageModeration.title')}
        </button>
        <button type="button" data-action="open-login-activity" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('loginActivity.title')}
        </button>
      ` : ''}
    </div>
  `;

  renderDateHeader(container.querySelector('[data-el="date-header"]'));
  renderMetrics(container.querySelector('[data-el="metrics"]'), supabase);
  renderAllDepartmentApprovals(container.querySelector('[data-el="pending"]'), { supabase, adminUserId: user.id });

  // This tab re-renders on things unrelated to a real page navigation —
  // View-As entry/exit, language changes, department-switcher use that
  // lands back on Home — so the previous modal instances (and their
  // effective-client/scope, which may now be stale) are torn down
  // before fresh ones are built, instead of accumulating hidden orphans.
  currentReportsModal?.root.remove();
  currentDirectoryModal?.root.remove();
  currentGuestHubModal?.root.remove();
  currentMemberCaseModal?.root.remove();
  currentMenuCustomizerModal?.root.remove();
  currentMessageModerationModal?.root.remove();
  currentLoginActivityModal?.root.remove();
  currentCreateDepartmentModal?.root.remove();
  currentPastorMeetingQueueModal?.root.remove();
  currentPrayerRequestQueueModal?.root.remove();

  currentReportsModal = createDepartmentReportsModal({ supabase });
  currentDirectoryModal = createUserManagerModal({
    supabase,
    scope: { type: 'global' },
    currentUserId: user.id,
    title: t('directory.title'),
  });

  container.querySelector('[data-action="open-reports"]').addEventListener('click', () => currentReportsModal.open());
  container.querySelector('[data-action="open-directory"]').addEventListener('click', () => currentDirectoryModal.open());

  const guestHubBtn = container.querySelector('[data-action="open-guest-hub"]');
  if (guestHubBtn) {
    currentGuestHubModal = createGuestOnboardingModal({ supabase, currentUserId: user.id });
    guestHubBtn.addEventListener('click', () => currentGuestHubModal.open());
  }

  const memberCasesBtn = container.querySelector('[data-action="open-member-cases"]');
  if (memberCasesBtn) {
    currentMemberCaseModal = createMemberCaseModal({ supabase, currentUserId: user.id, scope: { type: 'pastoral' } });
    memberCasesBtn.addEventListener('click', () => currentMemberCaseModal.open());
  }

  const pastorMeetingsBtn = container.querySelector('[data-action="open-pastor-meetings"]');
  if (pastorMeetingsBtn) {
    currentPastorMeetingQueueModal = createPastorMeetingQueueModal({ supabase });
    pastorMeetingsBtn.addEventListener('click', () => currentPastorMeetingQueueModal.open());
  }

  const prayerRequestsBtn = container.querySelector('[data-action="open-prayer-requests"]');
  if (prayerRequestsBtn) {
    currentPrayerRequestQueueModal = createPrayerRequestQueueModal({ supabase });
    prayerRequestsBtn.addEventListener('click', () => currentPrayerRequestQueueModal.open());
  }

  const createDepartmentBtn = container.querySelector('[data-action="open-create-department"]');
  if (createDepartmentBtn) {
    currentCreateDepartmentModal = createDepartmentModal({
      supabase,
      currentUserId: user.id,
      onCreated: () => renderMetrics(container.querySelector('[data-el="metrics"]'), supabase),
    });
    createDepartmentBtn.addEventListener('click', () => currentCreateDepartmentModal.open());
  }

  const menuCustomizerBtn = container.querySelector('[data-action="open-menu-customizer"]');
  if (menuCustomizerBtn) {
    currentMenuCustomizerModal = createMenuCustomizerModal({ supabase, currentUserId: user.id });
    menuCustomizerBtn.addEventListener('click', () => currentMenuCustomizerModal.open());
  }

  const messageModerationBtn = container.querySelector('[data-action="open-message-moderation"]');
  if (messageModerationBtn) {
    currentMessageModerationModal = createMessageModerationModal({ supabase });
    messageModerationBtn.addEventListener('click', () => currentMessageModerationModal.open());
  }

  const loginActivityBtn = container.querySelector('[data-action="open-login-activity"]');
  if (loginActivityBtn) {
    currentLoginActivityModal = createLoginActivityModal({ supabase });
    loginActivityBtn.addEventListener('click', () => currentLoginActivityModal.open());
  }
}

async function renderMetrics(container, supabase) {
  container.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-4 gap-4">${[1, 2, 3, 4].map(() => metricCardHtml(null, '—', '')).join('')}</div>`;

  const [{ count: userCount }, { count: departmentCount }, { count: pendingCount }, { count: approvedCount }] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('departments').select('id', { count: 'exact', head: true }),
    supabase.from('department_memberships').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('department_memberships').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
  ]);

  container.innerHTML = `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      ${metricCardHtml('directory', userCount ?? '—', t('superHome.metricUsers'))}
      ${metricCardHtml(null, departmentCount ?? '—', t('superHome.metricDepartments'))}
      ${metricCardHtml('directory', approvedCount ?? '—', t('superHome.metricMemberships'))}
      ${metricCardHtml('pending', pendingCount ?? '—', t('superHome.metricPending'), pendingCount > 0)}
    </div>
  `;

  container.querySelectorAll('[data-action]').forEach((card) => {
    card.addEventListener('click', () => {
      if (card.dataset.action === 'directory') currentDirectoryModal?.open();
      else if (card.dataset.action === 'pending') document.querySelector('#super-home-pending')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function metricCardHtml(action, value, label, highlight = false) {
  const clickable = !!action;
  const tag = clickable ? 'button' : 'div';
  const typeAttr = clickable ? 'type="button"' : '';
  const actionAttr = clickable ? `data-action="${action}"` : '';
  const clickableClasses = clickable ? 'hover:shadow-md transition-shadow cursor-pointer' : '';
  return `
    <${tag} ${typeAttr} ${actionAttr}
        class="bg-white rounded-xl shadow p-4 sm:p-6 text-center w-full ${highlight ? 'ring-2 ring-amber-400' : ''} ${clickableClasses}">
      <div class="text-2xl sm:text-3xl font-bold text-[#0B1F3A]">${value}</div>
      <div class="text-xs sm:text-sm text-slate-500 mt-1">${label}</div>
    </${tag}>
  `;
}

function createDepartmentReportsModal({ supabase }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('superHome.reportsTitle')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    renderDepartmentReports(root.querySelector('[data-el="body"]'), supabase);
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open, root };
}

async function renderDepartmentReports(container, supabase) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

  const [{ data: departments, error: deptError }, { data: memberships, error: memError }] = await Promise.all([
    supabase.from('departments').select('id, key, name').order('name'),
    supabase.from('department_memberships').select('department_id, role, status, member:profiles!user_id ( full_name )'),
  ]);

  if (deptError || memError) {
    container.innerHTML = `<p class="text-sm text-rose-600">${t('superHome.reportsLoadFailed', { message: (deptError || memError).message })}</p>`;
    return;
  }

  const byDept = new Map();
  (departments || []).forEach((d) => byDept.set(d.id, { ...d, approved: 0, pending: 0, admins: [] }));
  (memberships || []).forEach((m) => {
    const entry = byDept.get(m.department_id);
    if (!entry) return;
    if (m.status === 'approved') {
      entry.approved += 1;
      if ((m.role === 'admin' || m.role === 'secretary') && m.member) entry.admins.push(m.member.full_name);
    } else if (m.status === 'pending') {
      entry.pending += 1;
    }
  });

  container.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
          <tr>
            <th class="text-left px-4 py-2">${t('superHome.reportsDepartment')}</th>
            <th class="text-left px-4 py-2">${t('superHome.reportsMembers')}</th>
            <th class="text-left px-4 py-2">${t('superHome.reportsPending')}</th>
            <th class="text-left px-4 py-2">${t('superHome.reportsAdmins')}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${Array.from(byDept.values()).map((d) => `
            <tr>
              <td class="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">${departmentLabel(d.key)}</td>
              <td class="px-4 py-2.5">${d.approved}</td>
              <td class="px-4 py-2.5 ${d.pending > 0 ? 'text-amber-600 font-medium' : ''}">${d.pending}</td>
              <td class="px-4 py-2.5 text-slate-600">${d.admins.length > 0 ? escapeHtml(d.admins.join(', ')) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
