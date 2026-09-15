// Dashboard tab entry point for every non-Choir department (both
// "lightweight" ones and the bespoke-scheduling ones — Preaching,
// Media & Tech, Ecodem — which share this same Dashboard, just with a
// different board on their Scheduling tab): pending approvals (admins
// only) + the announcements feed. Reads which department is active
// from departments.js rather than taking a param, since it's invoked
// from app.js's generic lazyTabs table.
import { getEffectiveSupabase, getActiveDepartment, canPostAnnouncements, isGlobalAnnouncer } from './departments.js';
import { renderDepartmentApprovals } from './components/departmentApprovals.js';
import { renderAnnouncements } from './components/departmentAnnouncements.js';
import { createUserManagerModal } from './components/userManager.js';
import { createReimbursementRequestModal, createReimbursementInboxModal } from './components/reimbursementModal.js';
import { renderNextUpcomingWidget } from './components/nextUpcomingWidget.js';
import { renderMyPreachingWidget } from './components/myPreachingWidget.js';
import { renderChurchProgramBoard } from './components/churchProgramBoard.js';
import { createPrayerRequestQueueModal } from './components/prayerRequests.js';
import { renderHeadcountBoard } from './components/headcountBoard.js';
import { ensureAgreementsSigned } from './components/agreementSigningModal.js';
import { renderDateHeader } from './components/dateHeader.js';
import { renderMeetingControls } from './components/videoMeeting.js';
import { t, departmentLabel } from './i18n.js';

const HEADCOUNT_DEPARTMENT_KEYS = ['ushers', 'welcoming_socialisation', 'ecodem'];
// Matched by displayed label, not the raw departments.name column —
// these are admin-created departments (the Create Department tool
// generates the key from the name, so it's not guaranteed stable/
// predictable) and their label may since have been renamed via
// Customize Menu, which overrides departmentLabel() but doesn't touch
// the underlying name column. A meeting doesn't make sense for
// either: one's a read-only calendar, the other a community info
// board.
const NO_MEETING_DEPARTMENT_NAMES = ['VPD Community', 'Church Calendar'];

export async function renderDeptDashboardTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#dept-dashboard-content');
  const active = getActiveDepartment();
  if (!active) return;

  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user } } = await supabase.auth.getUser();
  await ensureAgreementsSigned({ supabase, userId: user.id, departmentId: active.id });

  const canAdminister = active.role === 'admin' || active.role === 'super_admin';
  // Broader than canAdminister — a department secretary manages
  // day-to-day things (prayer requests, headcounts) without needing
  // full admin rights.
  const canManageDept = canAdminister || active.role === 'secretary';

  container.innerHTML = '';

  const dateHeaderEl = document.createElement('div');
  container.appendChild(dateHeaderEl);
  renderDateHeader(dateHeaderEl);

  if (!NO_MEETING_DEPARTMENT_NAMES.includes(departmentLabel(active.key)) && !NO_MEETING_DEPARTMENT_NAMES.includes(active.name)) {
    renderMeetingControls(container, {
      supabase,
      active,
      canAdminister,
      getDisplayName: async () => (await supabase.from('profiles').select('full_name').eq('id', user.id).single()).data?.full_name || '',
      onLinkChanged: () => renderDeptDashboardTab(),
    });
  }

  // Preaching's own dashboard already lists the whole week including
  // their entry (below); everyone else's dashboard gets this instead,
  // since a preacher or moderator scheduled ad hoc often isn't a
  // Preaching member.
  if (active.key !== 'preaching') {
    const myPreachingEl = document.createElement('div');
    container.appendChild(myPreachingEl);
    renderMyPreachingWidget(myPreachingEl, { supabase, userId: user.id });
  }

  if (canAdminister) {
    const approvalsCard = document.createElement('div');
    approvalsCard.className = 'bg-white rounded-xl shadow p-4 sm:p-6 mb-6';
    approvalsCard.innerHTML = `<h2 class="text-lg font-semibold mb-4">${t('approvals.title')}</h2><div data-el="list"></div>`;
    container.appendChild(approvalsCard);
    renderDepartmentApprovals(approvalsCard.querySelector('[data-el="list"]'), {
      supabase,
      departmentId: active.id,
      adminUserId: user.id,
    });

    const usersBtn = document.createElement('button');
    usersBtn.type = 'button';
    usersBtn.className = 'mb-6 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700';
    usersBtn.textContent = t('nav.members');
    container.appendChild(usersBtn);
    usersBtn.addEventListener('click', () => {
      createUserManagerModal({
        supabase,
        scope: { type: 'department', departmentId: active.id, departmentKey: active.key },
        currentUserId: user.id,
        title: t('nav.members'),
      }).open();
    });
  }

  // Fund Request (submit + Finance's own review) and the per-department
  // budget board moved to the centralized Budget page (js/budgetPage.js)
  // -- reachable only by a department admin/secretary or Pastor, with no
  // nav trace at all for anyone else. Finance's Reimbursements inbox and
  // every department's own "My Budget" stay here, unchanged -- that
  // restructuring was specifically about Fund Request/Budget Report.
  if (active.key === 'finance') {
    if (canAdminister) {
      const reimbursementInboxBtn = document.createElement('button');
      reimbursementInboxBtn.type = 'button';
      reimbursementInboxBtn.className = 'mb-6 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700';
      reimbursementInboxBtn.textContent = t('reimbursement.inboxTitle');
      container.appendChild(reimbursementInboxBtn);
      reimbursementInboxBtn.addEventListener('click', () => {
        createReimbursementInboxModal({ supabase, adminUserId: user.id }).open();
      });
    }
  } else if (canManageDept) {
    const myBudgetBtn = document.createElement('button');
    myBudgetBtn.type = 'button';
    myBudgetBtn.className = 'mb-6 px-4 py-2 rounded-lg bg-slate-100 text-slate-700 font-medium hover:bg-slate-200';
    myBudgetBtn.textContent = t('reimbursement.myBudgetButton');
    container.appendChild(myBudgetBtn);
    myBudgetBtn.addEventListener('click', () => {
      createReimbursementRequestModal({ supabase, departmentId: active.id, currentUserId: user.id }).open();
    });
  }

  if (active.key === 'intercession' && canManageDept) {
    const prayerRequestsBtn = document.createElement('button');
    prayerRequestsBtn.type = 'button';
    prayerRequestsBtn.className = 'mb-6 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700';
    prayerRequestsBtn.textContent = t('prayerRequest.queueTitle');
    container.appendChild(prayerRequestsBtn);
    const prayerQueueModal = createPrayerRequestQueueModal({ supabase });
    prayerRequestsBtn.addEventListener('click', () => prayerQueueModal.open());
  }

  if (active.key === 'church_program') {
    const churchProgramEl = document.createElement('div');
    container.appendChild(churchProgramEl);
    renderChurchProgramBoard(churchProgramEl, { supabase, canAdminister, currentUserId: user.id });
  } else if (active.key !== 'finance') {
    const nextUpEl = document.createElement('div');
    container.appendChild(nextUpEl);
    renderNextUpcomingWidget(nextUpEl, { supabase, departmentId: active.id, departmentKey: active.key });
  }

  if (HEADCOUNT_DEPARTMENT_KEYS.includes(active.key) && canManageDept) {
    const headcountEl = document.createElement('div');
    container.appendChild(headcountEl);
    renderHeadcountBoard(headcountEl, { supabase, departmentId: active.id });
  }

  const announcementsCard = document.createElement('div');
  announcementsCard.className = 'bg-white rounded-xl shadow p-4 sm:p-6';
  container.appendChild(announcementsCard);
  renderAnnouncements(announcementsCard, {
    supabase,
    departmentId: active.id,
    canPost: canPostAnnouncements(active.role),
    isGlobalPoster: isGlobalAnnouncer(active.role),
    canManage: active.role === 'admin' || active.role === 'super_admin',
    currentUserId: user.id,
  });
}
