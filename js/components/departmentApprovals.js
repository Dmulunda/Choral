// Pending department-membership approvals. Mounted wherever a department
// admin (or super admin) is looking at their department — Choir's
// Members tab, and the "coming soon" placeholder for every other
// department, since approving members doesn't require that
// department's full feature set to exist yet.
import { t } from '../i18n.js';

export function renderDepartmentApprovals(container, { supabase, departmentId, adminUserId }) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
  load();

  async function load() {
    const { data, error } = await supabase
      .from('department_memberships')
      .select('id, requested_at, applicant:profiles!user_id ( full_name )')
      .eq('department_id', departmentId)
      .eq('status', 'pending')
      .order('requested_at');

    if (error) {
      container.innerHTML = `<p class="text-sm text-rose-600">${t('approvals.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      container.innerHTML = `<p class="text-sm text-slate-500">${t('approvals.none')}</p>`;
      return;
    }

    container.innerHTML = `
      <div class="space-y-2">
        ${data.map((row) => `
          <div class="flex items-center justify-between gap-3 border border-slate-200 rounded-lg p-3">
            <span class="text-sm font-medium text-slate-800">${escapeHtml(row.applicant?.full_name || '')}</span>
            <div class="flex gap-2">
              <button type="button" data-action="approve" data-id="${row.id}"
                      class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">
                ${t('approvals.approve')}
              </button>
              <button type="button" data-action="reject" data-id="${row.id}"
                      class="px-3 py-1.5 rounded-lg bg-rose-100 text-rose-700 text-sm font-medium hover:bg-rose-200">
                ${t('approvals.reject')}
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('[data-action="approve"]').forEach((btn) => btn.addEventListener('click', () => respond(btn.dataset.id, 'approved')));
    container.querySelectorAll('[data-action="reject"]').forEach((btn) => btn.addEventListener('click', () => respond(btn.dataset.id, 'rejected')));
  }

  async function respond(membershipId, status) {
    const { error } = await supabase
      .from('department_memberships')
      .update({ status, approved_at: new Date().toISOString(), approved_by: adminUserId })
      .eq('id', membershipId);

    if (error) {
      window.alert(t('approvals.updateFailed', { message: error.message }));
      return;
    }
    load();
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
