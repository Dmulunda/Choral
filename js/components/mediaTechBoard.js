// Media & Tech duty board: five named service roles (stream, sound,
// media inventory, camera, slides), assigned per service date. Each
// role gets its own multi-select so more than one person can cover a
// role if needed (e.g. a second camera operator). Each assignee then
// approves or declines their own slot (sql/049), same as every other
// department now.
import { t, mediaTechRoleLabel } from '../i18n.js';
import { renderMyAssignmentsPanel } from './myAssignmentsPanel.js';
import { renderAssigneeBadge } from './assignmentStatusBadge.js';

const ROLES = ['stream_operator', 'sound_operator', 'media_inventory', 'camera_operator', 'slides_operator'];

export function renderMediaTechBoard(container, { supabase, departmentId, canAdminister, userId }) {
  container.innerHTML = `
    <div data-el="my-assignments"></div>
    ${canAdminister ? `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">${t('mediaTech.assignForDate')}</h2>
        <form data-el="form" class="space-y-4">
          <div class="max-w-xs">
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.date')}</label>
            <input type="date" name="date" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            ${ROLES.map((role) => `
              <div>
                <label class="block text-sm font-medium text-slate-600 mb-1">${mediaTechRoleLabel(role)}</label>
                <select multiple size="4" data-role-select="${role}"
                        class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"></select>
              </div>
            `).join('')}
          </div>
          <div class="flex items-center gap-3">
            <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
              ${t('mediaTech.save')}
            </button>
            <span data-el="form-status" class="text-sm text-slate-500"></span>
          </div>
        </form>
      </div>
    ` : ''}
    <div class="bg-white rounded-xl shadow p-4 sm:p-6">
      <h2 class="text-lg font-semibold mb-4">${t('mediaTech.upcoming')}</h2>
      <div data-el="list" class="space-y-3"></div>
    </div>
  `;

  const form = container.querySelector('[data-el="form"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const listEl = container.querySelector('[data-el="list"]');

  if (userId) {
    renderMyAssignmentsPanel(container.querySelector('[data-el="my-assignments"]'), {
      departmentId,
      fetchMyAssignments: async () => {
        const { data, error } = await supabase
          .from('media_tech_assignments')
          .select('id, date, role, status, reason, working_department_id')
          .eq('user_id', userId)
          .order('date', { ascending: true });
        if (error) return { error };
        return {
          data: (data || []).map((r) => ({
            id: r.id,
            label: mediaTechRoleLabel(r.role),
            date: r.date,
            status: r.status,
            reason: r.reason,
            workingDepartmentId: r.working_department_id,
          })),
        };
      },
      updateAssignment: async (id, patch) => {
        const update = {};
        if ('status' in patch) { update.status = patch.status; update.responded_at = new Date().toISOString(); }
        if ('reason' in patch) update.reason = patch.reason;
        if ('workingDepartmentId' in patch) update.working_department_id = patch.workingDepartmentId;
        const { error } = await supabase.from('media_tech_assignments').update(update).eq('id', id);
        if (!error) load();
        return { error };
      },
    });
  }

  if (form) {
    loadMemberOptions();
    form.elements.date.addEventListener('change', () => prefillFromDate(form.elements.date.value));
    form.addEventListener('submit', handleSubmit);
  }

  load();

  async function loadMemberOptions() {
    const { data } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( full_name, media_tech_skills )')
      .eq('department_id', departmentId)
      .eq('status', 'approved');

    const members = (data || []).filter((m) => m.member);

    // Not every Media & Tech member can run every role — each role's
    // select only offers people whose skills (set in the Users tab,
    // sql/050) actually include it, mirroring how Choir only assigns
    // singers to their own voice part.
    ROLES.forEach((role) => {
      const options = members
        .filter((m) => (m.member.media_tech_skills || []).includes(role))
        .map((m) => `<option value="${m.user_id}">${escapeHtml(m.member.full_name)}</option>`)
        .join('');
      container.querySelector(`[data-role-select="${role}"]`).innerHTML = options;
    });
  }

  async function prefillFromDate(dateStr) {
    ROLES.forEach((role) => {
      const select = container.querySelector(`[data-role-select="${role}"]`);
      Array.from(select.options).forEach((opt) => { opt.selected = false; });
    });
    if (!dateStr) return;

    const { data } = await supabase
      .from('media_tech_assignments')
      .select('role, user_id, assignee:profiles!user_id ( full_name )')
      .eq('date', dateStr);

    (data || []).forEach((row) => {
      const select = container.querySelector(`[data-role-select="${row.role}"]`);
      if (!select) return;
      let option = select.querySelector(`option[value="${row.user_id}"]`);
      if (!option && row.assignee?.full_name) {
        // Already assigned here but no longer listed as skilled for
        // this role (their skills changed since) — keep them visible
        // and selected so resaving this form doesn't silently drop
        // them; an admin has to deliberately deselect them instead.
        option = document.createElement('option');
        option.value = row.user_id;
        option.textContent = row.assignee.full_name;
        select.appendChild(option);
      }
      if (option) option.selected = true;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const date = form.elements.date.value;
    if (!date) return;

    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { data: { user } } = await supabase.auth.getUser();

    const desired = ROLES.flatMap((role) => {
      const select = container.querySelector(`[data-role-select="${role}"]`);
      return Array.from(select.selectedOptions).map((opt) => ({ role, user_id: opt.value }));
    });
    const desiredKeys = new Set(desired.map((d) => `${d.role}:${d.user_id}`));

    const { data: existing, error: existingError } = await supabase
      .from('media_tech_assignments')
      .select('id, role, user_id')
      .eq('date', date);
    if (existingError) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('mediaTech.saveFailed', { message: existingError.message });
      return;
    }

    // Diff against what's already there rather than delete-everything-
    // then-reinsert — an assignment someone already approved or
    // declined must keep that status if it's still in the desired set;
    // only rows that actually change need to move.
    const existingKeys = new Set((existing || []).map((r) => `${r.role}:${r.user_id}`));
    const toDeleteIds = (existing || []).filter((r) => !desiredKeys.has(`${r.role}:${r.user_id}`)).map((r) => r.id);
    const toInsert = desired.filter((d) => !existingKeys.has(`${d.role}:${d.user_id}`)).map((d) => ({ ...d, date, created_by: user.id }));

    if (toDeleteIds.length > 0) {
      const { error: deleteError } = await supabase.from('media_tech_assignments').delete().in('id', toDeleteIds);
      if (deleteError) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = t('mediaTech.saveFailed', { message: deleteError.message });
        return;
      }
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await supabase.from('media_tech_assignments').insert(toInsert);
      if (insertError) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = t('mediaTech.saveFailed', { message: insertError.message });
        return;
      }
    }

    formStatusEl.textContent = '';
    load();
  }

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('media_tech_assignments')
      .select('date, role, status, reason, assignee:profiles!user_id ( full_name ), working_department:departments!working_department_id ( key )')
      .order('date', { ascending: true });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('mediaTech.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('mediaTech.none')}</p>`;
      return;
    }

    const byDate = new Map();
    data.forEach((row) => {
      if (!byDate.has(row.date)) byDate.set(row.date, new Map());
      const roleMap = byDate.get(row.date);
      if (!roleMap.has(row.role)) roleMap.set(row.role, []);
      if (row.assignee?.full_name) roleMap.get(row.role).push(row);
    });

    listEl.innerHTML = Array.from(byDate.entries()).map(([date, roleMap]) => `
      <div class="border border-slate-200 rounded-lg p-3">
        <div class="text-sm font-semibold text-slate-800 mb-2">${escapeHtml(date)}</div>
        <div class="grid sm:grid-cols-2 gap-2">
          ${ROLES.filter((role) => roleMap.has(role)).map((role) => `
            <div class="text-sm">
              <span class="text-slate-500">${mediaTechRoleLabel(role)}:</span>
              ${roleMap.get(role).length > 0
                ? roleMap.get(role).map((row) => renderAssigneeBadge({
                    name: row.assignee.full_name,
                    status: row.status,
                    reason: row.reason,
                    workingDepartmentKey: row.working_department?.key,
                  })).join(' ')
                : `<span class="text-slate-400">${t('deptScheduling.unassigned')}</span>`
              }
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
