// "Edit User" modal — full profile editing (name, phone, global access
// level) plus department transfer/attach: add the user to another
// department, change their role within a department they're already in,
// or remove them from one. Same createXModal({ ... }) => { open } shape
// as userCreatorModal.js/viewAsPicker.js, except open() here takes the
// target user so one modal instance can be reused across every row in
// the roster.
import { getMyDepartments, getGlobalRole } from '../departments.js';
import { confirmDialog } from './confirmDialog.js';
import { t, roleLabel } from '../i18n.js';

const DEPARTMENT_ROLES = ['member', 'secretary', 'admin'];
const ACCESS_LEVELS = ['super_admin', 'super_viewer', 'pastor_admin', 'church_secretary'];

export function createUserEditModal({ supabase, currentUserId, onSaved }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold" data-el="title"></h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>

      <form data-el="form" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('userEdit.fullName')}</label>
          <input type="text" name="full_name" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('userEdit.email')}</label>
            <input type="text" data-el="email" disabled class="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-slate-500" />
            <p class="text-xs text-slate-400 mt-1">${t('userEdit.emailReadOnlyHint')}</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('userEdit.phone')}</label>
            <input type="tel" name="phone" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
        </div>
        <div data-el="access-level-wrap" class="hidden">
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('userEdit.accessLevel')}</label>
          <select name="global_role" class="w-full border border-slate-300 rounded-lg px-3 py-2">
            <option value="">${t('userCreator.accessLevelNone')}</option>
            ${ACCESS_LEVELS.map((r) => `<option value="${r}">${roleLabel(r)}</option>`).join('')}
          </select>
        </div>

        <p data-el="form-status" class="text-sm"></p>

        <div class="flex justify-end gap-2 pt-2 border-b border-slate-200 pb-4">
          <button type="button" data-action="close" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">${t('common.cancel')}</button>
          <button type="submit" data-el="save-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('userEdit.save')}
          </button>
        </div>
      </form>

      <div class="pt-4">
        <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('userEdit.departmentsTitle')}</h3>
        <div data-el="memberships" class="space-y-2 mb-3"></div>
        <div class="flex items-center gap-2">
          <select data-el="add-dept-select" class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"></select>
          <button type="button" data-action="add-dept" class="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800">
            ${t('userEdit.addDepartment')}
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const titleEl = root.querySelector('[data-el="title"]');
  const form = root.querySelector('[data-el="form"]');
  const emailEl = root.querySelector('[data-el="email"]');
  const accessLevelWrapEl = root.querySelector('[data-el="access-level-wrap"]');
  const formStatusEl = root.querySelector('[data-el="form-status"]');
  const saveBtn = root.querySelector('[data-el="save-btn"]');
  const membershipsEl = root.querySelector('[data-el="memberships"]');
  const addDeptSelectEl = root.querySelector('[data-el="add-dept-select"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="add-dept"]').addEventListener('click', addDepartment);
  form.addEventListener('submit', handleSubmit);

  let targetUser = null;
  let allDepartments = [];
  let memberships = [];

  function canApprove(deptId) {
    const mine = getMyDepartments().find((d) => d.id === deptId);
    return mine?.role === 'admin' || mine?.role === 'super_admin' || mine?.role === 'pastor_admin';
  }

  async function loadDepartmentsAndMemberships() {
    const [{ data: departments }, { data: rows }] = await Promise.all([
      supabase.from('departments').select('id, key, name').order('name'),
      supabase
        .from('department_memberships')
        .select('id, role, status, department_id, departments ( id, key, name )')
        .eq('user_id', targetUser.id),
    ]);

    allDepartments = departments || [];
    memberships = (rows || []).filter((r) => r.departments);
    renderMemberships();
    renderAddDeptSelect();
  }

  function renderMemberships() {
    if (memberships.length === 0) {
      membershipsEl.innerHTML = '';
      return;
    }

    membershipsEl.innerHTML = memberships.map((m) => {
      const approvable = canApprove(m.department_id);
      return `
        <div class="flex items-center gap-2 border border-slate-200 rounded-lg p-2" data-membership-row="${m.id}">
          <span class="flex-1 text-sm">${escapeHtml(m.departments.name)}</span>
          ${m.status === 'pending' ? `<span class="text-xs font-medium text-amber-600">${t('users.pending')}</span>` : ''}
          <select data-el="role-select" class="border border-slate-300 rounded-lg px-2 py-1 text-sm" ${approvable ? '' : 'disabled'}>
            ${DEPARTMENT_ROLES.map((r) => `<option value="${r}" ${r === m.role ? 'selected' : ''}>${roleLabel(r)}</option>`).join('')}
          </select>
          <button type="button" data-action="remove-membership"
                  class="text-sm font-medium text-rose-600 hover:text-rose-800 disabled:opacity-40" ${approvable ? '' : 'disabled'}>
            ${t('userEdit.removeDepartment')}
          </button>
        </div>
      `;
    }).join('');

    membershipsEl.querySelectorAll('[data-membership-row]').forEach((row) => {
      const membershipId = row.dataset.membershipRow;
      const membership = memberships.find((m) => m.id === membershipId);
      row.querySelector('[data-el="role-select"]').addEventListener('change', (e) => updateRole(membership, e.target.value));
      row.querySelector('[data-action="remove-membership"]').addEventListener('click', () => removeMembership(membership));
    });
  }

  function renderAddDeptSelect() {
    const assignedIds = new Set(memberships.map((m) => m.department_id));
    const available = allDepartments.filter((d) => !assignedIds.has(d.id));
    addDeptSelectEl.innerHTML = available.length === 0
      ? `<option value="">${t('userEdit.selectDepartmentPlaceholder')}</option>`
      : available.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
  }

  async function updateRole(membership, newRole) {
    const { error } = await supabase.from('department_memberships').update({ role: newRole }).eq('id', membership.id);
    if (error) {
      window.alert(t('userEdit.roleUpdateFailed', { message: error.message }));
      renderMemberships();
      return;
    }
    membership.role = newRole;
  }

  async function removeMembership(membership) {
    const confirmed = await confirmDialog({
      message: t('userEdit.confirmRemoveDepartment', {
        name: targetUser.full_name,
        department: membership.departments.name,
      }),
    });
    if (!confirmed) return;

    const { error } = await supabase.from('department_memberships').delete().eq('id', membership.id);
    if (error) {
      window.alert(t('userEdit.removeDepartmentFailed', { message: error.message }));
      return;
    }
    memberships = memberships.filter((m) => m.id !== membership.id);
    renderMemberships();
    renderAddDeptSelect();
  }

  async function addDepartment() {
    const departmentId = addDeptSelectEl.value;
    if (!departmentId) return;

    const approved = canApprove(departmentId);
    const { data, error } = await supabase
      .from('department_memberships')
      .insert({
        user_id: targetUser.id,
        department_id: departmentId,
        role: 'member',
        status: approved ? 'approved' : 'pending',
        ...(approved ? { approved_at: new Date().toISOString(), approved_by: currentUserId } : {}),
      })
      .select('id, role, status, department_id, departments ( id, key, name )')
      .single();

    if (error) {
      window.alert(t('userEdit.addDepartmentFailed', { message: error.message }));
      return;
    }

    memberships.push(data);
    renderMemberships();
    renderAddDeptSelect();
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const fullName = form.elements.full_name.value.trim();
    const phone = form.elements.phone.value.trim() || null;
    const globalRole = form.elements.global_role ? (form.elements.global_role.value || null) : undefined;

    if (!fullName) return;

    saveBtn.disabled = true;
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('userEdit.saving');

    const update = { full_name: fullName, phone };
    if (globalRole !== undefined) update.global_role = globalRole;

    const { error } = await supabase.from('profiles').update(update).eq('id', targetUser.id);

    saveBtn.disabled = false;
    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('userEdit.saveFailed', { message: error.message });
      return;
    }

    formStatusEl.className = 'text-sm text-emerald-600';
    formStatusEl.textContent = t('userEdit.saved');
    onSaved?.();
  }

  function open(user) {
    targetUser = user;
    titleEl.textContent = t('userEdit.title', { name: user.full_name });
    form.elements.full_name.value = user.full_name || '';
    form.elements.phone.value = user.phone || '';
    emailEl.value = user.profile_emails?.email || t('users.emailUnknown');
    if (form.elements.global_role) form.elements.global_role.value = user.global_role || '';
    accessLevelWrapEl.classList.toggle('hidden', getGlobalRole() !== 'super_admin');
    formStatusEl.textContent = '';
    root.classList.remove('hidden');
    root.classList.add('flex');
    loadDepartmentsAndMemberships();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
