// Roster/directory table shared by every department's "Users" section
// and the global User Directory. `scope` decides what's loaded and
// which columns make sense:
//   { type: 'department', departmentId, departmentKey } — that
//     department's approved members; department-role is inline-
//     editable (the page only renders this component when the viewer
//     already administers departmentId, so no extra per-row check is
//     needed); "Remove" removes them from *this* department only, not
//     their account.
//   { type: 'global' } — every user, across every department, with a
//     read-only "Departments" badge column (department transfers happen
//     through the Edit modal instead, since a row here can span
//     departments the viewer doesn't administer) and an editable global
//     Access Level column (Super Admin only).
import { createUserCreatorModal } from './userCreatorModal.js';
import { createUserEditModal } from './userEditModal.js';
import { isViewingAs } from '../departments.js';
import { t, voicePartLabel, roleLabel } from '../i18n.js';

const VOICE_PARTS = ['Leader', 'Soprano', 'Alto', 'Tenor', 'Pianist', 'Bassist', 'Guitarist', 'Drummer'];
const DEPARTMENT_ROLES = ['member', 'secretary', 'admin'];

export function renderUserManager(container, { supabase, scope, currentUserId }) {
  let rows = [];
  let searchQuery = '';
  let showEmail = true;
  let showPhone = true;

  const addUserBtn = isViewingAs() ? '' : `
    <button type="button" data-action="add-user"
            class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 whitespace-nowrap">
      ${t('users.addUser')}
    </button>`;

  container.innerHTML = `
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <input type="search" data-el="search" placeholder="${t('users.searchPlaceholder')}"
             class="flex-1 min-w-[200px] border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      ${addUserBtn}
    </div>
    <div class="flex flex-wrap items-center gap-4 mb-3 text-sm text-slate-500">
      <span>${t('users.columns')}</span>
      <label class="flex items-center gap-1.5"><input type="checkbox" data-el="toggle-email" checked /> ${t('users.showEmail')}</label>
      <label class="flex items-center gap-1.5"><input type="checkbox" data-el="toggle-phone" checked /> ${t('users.showPhone')}</label>
    </div>
    <span data-el="status" class="text-sm text-slate-500"></span>
    <div data-el="view" class="bg-white rounded-xl shadow overflow-x-auto"></div>
  `;

  const searchEl = container.querySelector('[data-el="search"]');
  const toggleEmailEl = container.querySelector('[data-el="toggle-email"]');
  const togglePhoneEl = container.querySelector('[data-el="toggle-phone"]');
  const statusEl = container.querySelector('[data-el="status"]');
  const viewEl = container.querySelector('[data-el="view"]');

  searchEl.addEventListener('input', () => { searchQuery = searchEl.value.trim().toLowerCase(); renderTable(); });
  toggleEmailEl.addEventListener('change', () => { showEmail = toggleEmailEl.checked; renderTable(); });
  togglePhoneEl.addEventListener('change', () => { showPhone = togglePhoneEl.checked; renderTable(); });

  const editModal = createUserEditModal({ supabase, currentUserId, onSaved: loadUsers });

  if (!isViewingAs()) {
    const creatorModal = createUserCreatorModal({ supabase, scope, currentUserId, onCreated: loadUsers });
    container.querySelector('[data-action="add-user"]').addEventListener('click', () => creatorModal.open());
  }

  loadUsers();

  async function loadUsers() {
    statusEl.textContent = t('users.loading');
    viewEl.innerHTML = '';

    if (scope.type === 'department') {
      const { data, error } = await supabase
        .from('department_memberships')
        .select('id, role, status, user_id, member:profiles!user_id ( id, full_name, phone, voice_parts, profile_emails ( email ) )')
        .eq('department_id', scope.departmentId)
        .eq('status', 'approved');

      if (error) {
        statusEl.textContent = '';
        viewEl.innerHTML = `<p class="p-4 text-rose-600">${t('users.failedToLoad', { message: error.message })}</p>`;
        return;
      }

      rows = (data || [])
        .filter((r) => r.member)
        .map((r) => ({
          id: r.member.id,
          full_name: r.member.full_name,
          phone: r.member.phone,
          email: r.member.profile_emails?.email,
          voice_parts: r.member.voice_parts,
          membershipId: r.id,
          deptRole: r.role,
        }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
    } else {
      const [{ data: profiles, error: profilesError }, { data: memberships, error: membershipsError }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, phone, global_role, profile_emails ( email )').order('full_name'),
        supabase.from('department_memberships').select('user_id, role, status, departments ( key, name )').eq('status', 'approved'),
      ]);

      if (profilesError || membershipsError) {
        statusEl.textContent = '';
        viewEl.innerHTML = `<p class="p-4 text-rose-600">${t('users.failedToLoad', { message: (profilesError || membershipsError).message })}</p>`;
        return;
      }

      const byUser = new Map();
      (memberships || []).forEach((m) => {
        if (!m.departments) return;
        if (!byUser.has(m.user_id)) byUser.set(m.user_id, []);
        byUser.get(m.user_id).push({ name: m.departments.name, role: m.role });
      });

      rows = (profiles || []).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        phone: p.phone,
        email: p.profile_emails?.email,
        globalRole: p.global_role,
        departments: byUser.get(p.id) || [],
      }));
    }

    statusEl.textContent = '';
    renderTable();
  }

  function renderTable() {
    const filtered = searchQuery
      ? rows.filter((r) => r.full_name.toLowerCase().includes(searchQuery) || (r.email || '').toLowerCase().includes(searchQuery))
      : rows;

    if (filtered.length === 0) {
      viewEl.innerHTML = `<p class="p-4 text-slate-500">${t('users.noUsers')}</p>`;
      return;
    }

    const isChoir = scope.type === 'department' && scope.departmentKey === 'choir';
    const isGlobal = scope.type === 'global';

    const table = document.createElement('table');
    table.className = 'w-full text-sm';
    table.innerHTML = `
      <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
        <tr>
          <th class="text-left px-4 py-2">${t('users.name')}</th>
          ${showEmail ? `<th class="text-left px-4 py-2">${t('users.email')}</th>` : ''}
          ${showPhone ? `<th class="text-left px-4 py-2">${t('users.phone')}</th>` : ''}
          ${isChoir ? `<th class="text-left px-4 py-2">${t('users.voicePart')}</th>` : ''}
          ${isGlobal ? `<th class="text-left px-4 py-2">${t('users.departments')}</th><th class="text-left px-4 py-2">${t('users.accessLevel')}</th>` : `<th class="text-left px-4 py-2">${t('users.role')}</th>`}
          <th class="text-left px-4 py-2">${t('users.actions')}</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100"></tbody>
    `;

    const tbody = table.querySelector('tbody');

    filtered.forEach((row) => {
      const tr = document.createElement('tr');

      const nameCell = document.createElement('td');
      nameCell.className = 'px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap';
      nameCell.textContent = row.full_name;
      tr.appendChild(nameCell);

      if (showEmail) {
        const emailCell = document.createElement('td');
        emailCell.className = 'px-4 py-2.5 text-slate-500 whitespace-nowrap';
        emailCell.textContent = row.email || t('users.emailUnknown');
        tr.appendChild(emailCell);
      }

      if (showPhone) {
        const phoneCell = document.createElement('td');
        phoneCell.className = 'px-4 py-2.5 text-slate-500 whitespace-nowrap';
        phoneCell.textContent = row.phone || t('users.phoneUnknown');
        tr.appendChild(phoneCell);
      }

      if (isChoir) {
        const voicePartCell = document.createElement('td');
        voicePartCell.className = 'px-4 py-2.5';
        const select = document.createElement('select');
        select.multiple = true;
        select.size = Math.min(VOICE_PARTS.length, 5);
        select.className = 'border border-slate-300 rounded-lg px-2 py-1 text-sm';
        select.innerHTML = VOICE_PARTS.map((part) => `<option value="${part}">${voicePartLabel(part)}</option>`).join('');
        const selected = new Set(row.voice_parts || []);
        Array.from(select.options).forEach((opt) => { opt.selected = selected.has(opt.value); });
        select.addEventListener('change', () => updateVoiceParts(row, select));
        voicePartCell.appendChild(select);
        tr.appendChild(voicePartCell);
      }

      if (isGlobal) {
        const deptsCell = document.createElement('td');
        deptsCell.className = 'px-4 py-2.5';
        deptsCell.innerHTML = row.departments.length === 0
          ? ''
          : row.departments.map((d) => `<span class="inline-block px-2 py-0.5 mb-1 mr-1 rounded-full text-xs bg-slate-100 text-slate-600">${escapeHtml(d.name)} (${roleLabel(d.role)})</span>`).join('');
        tr.appendChild(deptsCell);

        const accessCell = document.createElement('td');
        accessCell.className = 'px-4 py-2.5';
        accessCell.textContent = row.globalRole ? roleLabel(row.globalRole) : '—';
        tr.appendChild(accessCell);
      } else {
        const roleCell = document.createElement('td');
        roleCell.className = 'px-4 py-2.5';
        const select = document.createElement('select');
        select.className = 'border border-slate-300 rounded-lg px-2 py-1 text-sm';
        select.innerHTML = DEPARTMENT_ROLES.map((r) => `<option value="${r}" ${r === row.deptRole ? 'selected' : ''}>${roleLabel(r)}</option>`).join('');
        select.addEventListener('change', () => updateDeptRole(row, select));
        roleCell.appendChild(select);
        tr.appendChild(roleCell);
      }

      const actionsCell = document.createElement('td');
      actionsCell.className = 'px-4 py-2.5';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'text-sm font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap block mb-1';
      editBtn.textContent = t('users.edit');
      editBtn.addEventListener('click', () => editModal.open({
        id: row.id,
        full_name: row.full_name,
        phone: row.phone,
        profile_emails: { email: row.email },
        global_role: row.globalRole,
      }));
      actionsCell.appendChild(editBtn);

      if (row.email) {
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'text-sm font-medium text-slate-500 hover:text-slate-700 whitespace-nowrap block mb-1';
        resetBtn.textContent = t('users.sendReset');
        resetBtn.addEventListener('click', () => sendPasswordReset(row, resetBtn));
        actionsCell.appendChild(resetBtn);
      }

      if (scope.type === 'department') {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'text-sm font-medium text-rose-600 hover:text-rose-800 whitespace-nowrap block';
        removeBtn.textContent = t('users.remove');
        removeBtn.addEventListener('click', () => removeFromDepartment(row));
        actionsCell.appendChild(removeBtn);
      }

      tr.appendChild(actionsCell);
      tbody.appendChild(tr);
    });

    viewEl.innerHTML = '';
    viewEl.appendChild(table);
  }

  async function updateVoiceParts(row, selectEl) {
    const newVoiceParts = Array.from(selectEl.selectedOptions).map((opt) => opt.value);
    const { error } = await supabase.from('profiles').update({ voice_parts: newVoiceParts }).eq('id', row.id);
    if (error) {
      window.alert(t('users.roleUpdateFailed', { message: error.message }));
      loadUsers();
      return;
    }
    row.voice_parts = newVoiceParts;
  }

  async function updateDeptRole(row, selectEl) {
    const newRole = selectEl.value;
    const { error } = await supabase.from('department_memberships').update({ role: newRole }).eq('id', row.membershipId);
    if (error) {
      window.alert(t('users.roleUpdateFailed', { message: error.message }));
      loadUsers();
      return;
    }
    row.deptRole = newRole;
  }

  async function removeFromDepartment(row) {
    const departmentLabel = scope.departmentKey ? t(`department.${scope.departmentKey}`) : '';
    if (!window.confirm(t('users.confirmRemove', { name: row.full_name, department: departmentLabel }))) return;

    const { error } = await supabase.from('department_memberships').delete().eq('id', row.membershipId);
    if (error) {
      window.alert(t('users.removeFailed', { message: error.message }));
      return;
    }
    rows = rows.filter((r) => r.id !== row.id);
    renderTable();
  }

  async function sendPasswordReset(row, button) {
    button.disabled = true;
    const { error } = await supabase.auth.resetPasswordForEmail(row.email);
    button.disabled = false;

    if (error) {
      window.alert(t('users.resetFailed', { message: error.message }));
      return;
    }
    window.alert(t('users.resetSent', { name: row.full_name }));
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
