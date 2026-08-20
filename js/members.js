// Members tab entry point: admin-only roster and role management.
import { getEffectiveSupabase, getActiveDepartment } from './departments.js';
import { createUserManagerModal } from './components/userManager.js';
import { renderDepartmentApprovals } from './components/departmentApprovals.js';
import { t } from './i18n.js';

export async function renderMembersTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#members-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  // Admin gating comes from the active department context (not a raw
  // profiles.role lookup), so it correctly reflects View-As simulation.
  const activeDepartment = getActiveDepartment();
  const canAdminister = activeDepartment?.role === 'admin' || activeDepartment?.role === 'super_admin';
  if (!canAdminister) {
    container.innerHTML = `<p class="text-slate-500">${t('members.notAuthorized')}</p>`;
    return;
  }

  container.innerHTML = '';

  if (activeDepartment) {
    const approvalsCard = document.createElement('div');
    approvalsCard.className = 'bg-white rounded-xl shadow p-4 sm:p-6 mb-6';
    approvalsCard.innerHTML = `<h2 class="text-lg font-semibold mb-4">${t('approvals.title')}</h2><div data-el="list"></div>`;
    container.appendChild(approvalsCard);
    renderDepartmentApprovals(approvalsCard.querySelector('[data-el="list"]'), {
      supabase,
      departmentId: activeDepartment.id,
      adminUserId: user.id,
    });
  }

  const usersBtn = document.createElement('button');
  usersBtn.type = 'button';
  usersBtn.className = 'px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700';
  usersBtn.textContent = t('nav.members');
  container.appendChild(usersBtn);
  usersBtn.addEventListener('click', () => {
    createUserManagerModal({
      supabase,
      scope: { type: 'department', departmentId: activeDepartment.id, departmentKey: activeDepartment.key },
      currentUserId: user.id,
      title: t('nav.members'),
    }).open();
  });
}
