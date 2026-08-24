// Global "Pending Requests" list — every pending department_memberships
// row across every department, not just whichever one happens to be
// active. This is the real fix for "Super Admin can't approve pending
// requests": the RLS policy (can_approve_department_membership() in
// sql/021) already allowed it, but departmentApprovals.js only ever
// rendered inside one specific department's page, so a Super Admin had
// to switch into every department one at a time to find anything
// pending — easy to miss entirely, especially now that Super Admin
// Home is the default landing page instead of any one department.
// Backs the "Pending Requests" metric card on that same Home console.
import { confirmDialog } from './confirmDialog.js';
import { t, tn, departmentLabel } from '../i18n.js';

export function renderAllDepartmentApprovals(container, { supabase, adminUserId }) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
  load();

  async function load() {
    const { data, error } = await supabase
      .from('department_memberships')
      .select('id, requested_at, applicant:profiles!user_id ( full_name ), departments ( key, name )')
      .eq('status', 'pending')
      .order('requested_at');

    if (error) {
      container.innerHTML = `<p class="text-sm text-rose-600">${t('approvals.loadFailed', { message: error.message })}</p>`;
      return;
    }

    const rows = (data || []).filter((r) => r.departments);

    if (rows.length === 0) {
      container.innerHTML = `<p class="text-sm text-slate-500">${t('approvals.none')}</p>`;
      return;
    }

    container.innerHTML = `
      ${rows.length > 1 ? `
        <div class="flex justify-end mb-2">
          <button type="button" data-action="approve-all" class="text-xs font-medium text-emerald-700 hover:text-emerald-900 underline">
            ${tn('approvals.approveAll', rows.length)}
          </button>
        </div>
      ` : ''}
      <div class="space-y-2">
        ${rows.map((row) => `
          <div class="flex items-center justify-between gap-3 border border-slate-200 rounded-lg p-3">
            <div>
              <span class="text-sm font-medium text-slate-800">${escapeHtml(row.applicant?.full_name || '')}</span>
              <span class="text-xs text-slate-400 block">${departmentLabel(row.departments.key)}</span>
            </div>
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

    const byId = new Map(rows.map((row) => [row.id, row]));
    container.querySelectorAll('[data-action="approve"]').forEach((btn) => btn.addEventListener('click', () => respond(byId.get(btn.dataset.id), 'approved')));
    container.querySelectorAll('[data-action="reject"]').forEach((btn) => btn.addEventListener('click', () => respond(byId.get(btn.dataset.id), 'rejected')));
    container.querySelector('[data-action="approve-all"]')?.addEventListener('click', () => approveAll(rows));
  }

  async function approveAll(rows) {
    if (!(await confirmDialog({ message: tn('approvals.confirmApproveAll', rows.length), confirmLabel: t('approvals.approve') }))) return;

    const { error } = await supabase
      .from('department_memberships')
      .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: adminUserId })
      .in('id', rows.map((r) => r.id));

    if (error) {
      window.alert(t('approvals.updateFailed', { message: error.message }));
      return;
    }
    load();
  }

  async function respond(row, status) {
    const name = row.applicant?.full_name || '';
    const message = status === 'approved'
      ? t('approvals.confirmApprove', { name })
      : t('approvals.confirmReject', { name });
    const confirmLabel = status === 'approved' ? t('approvals.approve') : t('approvals.reject');
    if (!(await confirmDialog({ message, confirmLabel, danger: status === 'rejected' }))) return;

    const { error } = await supabase
      .from('department_memberships')
      .update({ status, approved_at: new Date().toISOString(), approved_by: adminUserId })
      .eq('id', row.id);

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
