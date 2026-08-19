// Members tab entry point: admin-only roster and role management.
import { supabase } from './supabaseClient.js';
import { renderMemberManager } from './components/memberManager.js';
import { renderDepartmentApprovals } from './components/departmentApprovals.js';
import { getActiveDepartment } from './departments.js';
import { t } from './i18n.js';

export async function renderMembersTab() {
  const container = document.querySelector('#members-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError) {
    container.innerHTML = `<p class="text-rose-600">${t('scheduling.failedToLoadProfile', { message: profileError.message })}</p>`;
    return;
  }

  if (profile.role !== 'admin') {
    container.innerHTML = `<p class="text-slate-500">${t('members.notAuthorized')}</p>`;
    return;
  }

  container.innerHTML = '';

  const activeDepartment = getActiveDepartment();
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

  const memberManagerEl = document.createElement('div');
  container.appendChild(memberManagerEl);
  renderMemberManager(memberManagerEl, { supabase, currentUserId: user.id });
}
