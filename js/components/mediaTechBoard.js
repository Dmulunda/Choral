// Media & Tech duty board: five named service roles (stream, sound,
// media inventory, camera, slides), assigned per service date. Each
// role gets its own multi-select so more than one person can cover a
// role if needed (e.g. a second camera operator).
import { t, mediaTechRoleLabel } from '../i18n.js';

const ROLES = ['stream_operator', 'sound_operator', 'media_inventory', 'camera_operator', 'slides_operator'];

export function renderMediaTechBoard(container, { supabase, departmentId, canAdminister }) {
  container.innerHTML = `
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

  if (form) {
    loadMemberOptions();
    form.elements.date.addEventListener('change', () => prefillFromDate(form.elements.date.value));
    form.addEventListener('submit', handleSubmit);
  }

  load();

  async function loadMemberOptions() {
    const { data } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( full_name )')
      .eq('department_id', departmentId)
      .eq('status', 'approved');

    const options = (data || [])
      .filter((m) => m.member)
      .map((m) => `<option value="${m.user_id}">${escapeHtml(m.member.full_name)}</option>`)
      .join('');

    ROLES.forEach((role) => {
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
      .select('role, user_id')
      .eq('date', dateStr);

    (data || []).forEach((row) => {
      const select = container.querySelector(`[data-role-select="${row.role}"]`);
      const option = select?.querySelector(`option[value="${row.user_id}"]`);
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

    const { error: deleteError } = await supabase.from('media_tech_assignments').delete().eq('date', date);
    if (deleteError) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('mediaTech.saveFailed', { message: deleteError.message });
      return;
    }

    const rows = ROLES.flatMap((role) => {
      const select = container.querySelector(`[data-role-select="${role}"]`);
      return Array.from(select.selectedOptions).map((opt) => ({
        date, role, user_id: opt.value, created_by: user.id,
      }));
    });

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from('media_tech_assignments').insert(rows);
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
      .select('date, role, assignee:profiles!user_id ( full_name )')
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
      if (row.assignee?.full_name) roleMap.get(row.role).push(row.assignee.full_name);
    });

    listEl.innerHTML = Array.from(byDate.entries()).map(([date, roleMap]) => `
      <div class="border border-slate-200 rounded-lg p-3">
        <div class="text-sm font-semibold text-slate-800 mb-2">${escapeHtml(date)}</div>
        <div class="grid sm:grid-cols-2 gap-2">
          ${ROLES.filter((role) => roleMap.has(role)).map((role) => `
            <div class="text-sm">
              <span class="text-slate-500">${mediaTechRoleLabel(role)}:</span>
              ${roleMap.get(role).length > 0
                ? `<span class="text-slate-800">${roleMap.get(role).map(escapeHtml).join(', ')}</span>`
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
