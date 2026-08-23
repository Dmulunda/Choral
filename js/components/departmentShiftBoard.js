// Duty roster / shift scheduling board — part of the shared Scheduling
// module reused by every "lightweight" department. Admins create a
// dated shift and assign approved members to it; each assigned member
// then approves or declines it themselves (via myAssignmentsPanel.js),
// same accept/decline flow Choir's Service Requests has always had —
// including "I'll be working in another department instead" as a
// decline reason.
import { t } from '../i18n.js';
import { renderMyAssignmentsPanel } from './myAssignmentsPanel.js';
import { renderAssigneeBadge } from './assignmentStatusBadge.js';
import { todayLocal } from '../utils/date.js';
import { getGlobalRole } from '../departments.js';

export function renderShiftBoard(container, { supabase, departmentId, canAdminister, userId }) {
  // Super Admin keeps the ability to correct an already-past shift; every
  // other department admin is hard-blocked (sql/052's DB trigger enforces
  // the same rule), so the picker shouldn't even let them try.
  const dateMinAttr = getGlobalRole() === 'super_admin' ? '' : `min="${todayLocal()}"`;

  container.innerHTML = `
    <div data-el="my-assignments"></div>
    ${canAdminister ? `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">${t('deptScheduling.createShift')}</h2>
        <form data-el="form" class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.date')}</label>
            <input type="date" name="date" required ${dateMinAttr} class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('deptScheduling.shiftTitle')}</label>
            <input type="text" name="title" required placeholder="${t('deptScheduling.shiftTitlePlaceholder')}"
                   class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div class="sm:col-span-2">
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('deptScheduling.assignMembers')}</label>
            <select name="members" multiple size="5" data-el="members-select"
                    class="w-full border border-slate-300 rounded-lg px-3 py-2"></select>
          </div>
          <div class="sm:col-span-2">
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('deptScheduling.notes')}</label>
            <textarea name="notes" rows="2" class="w-full border border-slate-300 rounded-lg px-3 py-2"></textarea>
          </div>
          <div class="sm:col-span-2 flex items-center gap-3">
            <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
              ${t('deptScheduling.save')}
            </button>
            <span data-el="form-status" class="text-sm text-slate-500"></span>
          </div>
        </form>
      </div>
    ` : ''}
    <div class="bg-white rounded-xl shadow p-4 sm:p-6">
      <h2 class="text-lg font-semibold mb-4">${t('deptScheduling.upcoming')}</h2>
      <div data-el="list" class="space-y-3"></div>
    </div>
  `;

  const form = container.querySelector('[data-el="form"]');
  const membersSelect = container.querySelector('[data-el="members-select"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const listEl = container.querySelector('[data-el="list"]');

  if (userId) {
    renderMyAssignmentsPanel(container.querySelector('[data-el="my-assignments"]'), {
      departmentId,
      fetchMyAssignments: async () => {
        const { data, error } = await supabase
          .from('department_shift_assignments')
          .select('id, status, reason, working_department_id, shift:department_shifts ( date, title )')
          .eq('user_id', userId)
          .order('date', { foreignTable: 'department_shifts', ascending: true });
        if (error) return { error };
        return {
          data: (data || []).filter((r) => r.shift).map((r) => ({
            id: r.id,
            label: r.shift.title,
            date: r.shift.date,
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
        const { error } = await supabase.from('department_shift_assignments').update(update).eq('id', id);
        if (!error) load();
        return { error };
      },
    });
  }

  if (form) {
    loadMemberOptions();
    form.addEventListener('submit', handleSubmit);
  }

  load();

  async function loadMemberOptions() {
    const { data } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( full_name )')
      .eq('department_id', departmentId)
      .eq('status', 'approved');

    membersSelect.innerHTML = (data || [])
      .filter((m) => m.member)
      .map((m) => `<option value="${m.user_id}">${escapeHtml(m.member.full_name)}</option>`)
      .join('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const date = form.elements.date.value;
    const title = form.elements.title.value.trim();
    const notes = form.elements.notes.value.trim() || null;
    const memberIds = Array.from(membersSelect.selectedOptions).map((opt) => opt.value);

    if (!date || !title) return;

    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { data: { user } } = await supabase.auth.getUser();

    const { data: shift, error } = await supabase
      .from('department_shifts')
      .insert({ department_id: departmentId, date, title, notes, created_by: user.id })
      .select('id')
      .single();

    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('deptScheduling.saveFailed', { message: error.message });
      return;
    }

    if (memberIds.length > 0) {
      const rows = memberIds.map((user_id) => ({ shift_id: shift.id, user_id }));
      const { error: assignError } = await supabase.from('department_shift_assignments').insert(rows);
      if (assignError) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = t('deptScheduling.saveFailed', { message: assignError.message });
        return;
      }
    }

    form.reset();
    formStatusEl.textContent = '';
    load();
  }

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('department_shifts')
      .select('id, date, title, notes, department_shift_assignments ( status, reason, assignee:profiles!user_id ( full_name ), working_department:departments!working_department_id ( key ) )')
      .eq('department_id', departmentId)
      .order('date', { ascending: true });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('deptScheduling.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('deptScheduling.none')}</p>`;
      return;
    }

    listEl.innerHTML = data.map((shift) => {
      const assignments = (shift.department_shift_assignments || []).filter((a) => a.assignee?.full_name);
      return `
        <div class="border border-slate-200 rounded-lg p-3">
          <div class="flex items-baseline justify-between gap-3">
            <div class="font-medium text-slate-800">${escapeHtml(shift.title)}</div>
            <div class="text-sm text-slate-500">${escapeHtml(shift.date)}</div>
          </div>
          ${shift.notes ? `<p class="text-sm text-slate-600 mt-1">${escapeHtml(shift.notes)}</p>` : ''}
          <div class="flex flex-wrap gap-1.5 mt-2">
            ${assignments.length > 0
              ? assignments.map((a) => renderAssigneeBadge({
                  name: a.assignee.full_name,
                  status: a.status,
                  reason: a.reason,
                  workingDepartmentKey: a.working_department?.key,
                })).join('')
              : `<span class="text-sm text-slate-400">${t('deptScheduling.unassigned')}</span>`
            }
          </div>
        </div>
      `;
    }).join('');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
