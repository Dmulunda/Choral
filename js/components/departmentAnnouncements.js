// Announcements feed for a department — read by anyone with access to
// that department; posting is gated by `canPost` (department
// admin/secretary, or a church-wide role). A `canPost` poster who also
// holds a church-wide role (`isGlobalPoster`) gets a "Post to" checklist
// above the compose form and can target several departments — or every
// department — at once; the row is simply duplicated once per selected
// department, reusing the existing single-department schema rather than
// adding a join table.
import { confirmDialog } from './confirmDialog.js';
import { t, departmentLabel } from '../i18n.js';

export function renderAnnouncements(container, { supabase, departmentId, canPost, isGlobalPoster }) {
  container.innerHTML = `
    <h2 class="text-lg font-semibold mb-4">${t('announcements.title')}</h2>
    ${canPost ? `
      <form data-el="form" class="space-y-2 mb-4 pb-4 border-b border-slate-200">
        ${isGlobalPoster ? `
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('announcements.postTo')}</label>
            <div data-el="targets" class="flex flex-wrap gap-3 mb-2 text-sm text-slate-600"></div>
          </div>
        ` : ''}
        <input type="text" name="title" required placeholder="${t('announcements.titlePlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        <textarea name="body" rows="3" placeholder="${t('announcements.bodyPlaceholder')}"
                  class="w-full border border-slate-300 rounded-lg px-3 py-2"></textarea>
        <div class="flex items-center gap-3">
          <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
            ${t('announcements.post')}
          </button>
          <span data-el="form-status" class="text-sm text-slate-500"></span>
        </div>
      </form>
    ` : ''}
    <div data-el="list" class="space-y-3"></div>
  `;

  const listEl = container.querySelector('[data-el="list"]');
  const form = container.querySelector('[data-el="form"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const targetsEl = container.querySelector('[data-el="targets"]');

  if (targetsEl) loadTargets();

  async function loadTargets() {
    const { data } = await supabase.from('departments').select('id, key, name').order('name');
    const departments = data || [];

    targetsEl.innerHTML = `
      <label class="flex items-center gap-1.5 font-medium">
        <input type="checkbox" data-el="all-departments" /> ${t('announcements.allDepartments')}
      </label>
      ${departments.map((d) => `
        <label class="flex items-center gap-1.5">
          <input type="checkbox" data-el="dept-target" value="${d.id}" ${d.id === departmentId ? 'checked' : ''} />
          ${departmentLabel(d.key)}
        </label>
      `).join('')}
    `;

    const allCheckbox = targetsEl.querySelector('[data-el="all-departments"]');
    const deptCheckboxes = targetsEl.querySelectorAll('[data-el="dept-target"]');
    allCheckbox.addEventListener('change', () => {
      deptCheckboxes.forEach((cb) => { cb.disabled = allCheckbox.checked; });
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = form.elements.title.value.trim();
      const body = form.elements.body.value.trim() || null;
      if (!title) return;

      if (!(await confirmDialog({ message: t('announcements.confirmPost'), confirmLabel: t('announcements.post'), danger: false }))) return;

      const { data: { user } } = await supabase.auth.getUser();

      let targetDeptIds;
      if (targetsEl) {
        const allChecked = targetsEl.querySelector('[data-el="all-departments"]').checked;
        if (allChecked) {
          const { data: allDepts } = await supabase.from('departments').select('id');
          targetDeptIds = (allDepts || []).map((d) => d.id);
        } else {
          targetDeptIds = Array.from(targetsEl.querySelectorAll('[data-el="dept-target"]:checked')).map((cb) => cb.value);
        }
      } else {
        targetDeptIds = [departmentId];
      }

      if (targetDeptIds.length === 0) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = t('announcements.noTargets');
        return;
      }

      formStatusEl.className = 'text-sm text-slate-500';
      formStatusEl.textContent = t('common.saving');

      const rows = targetDeptIds.map((id) => ({ department_id: id, title, body, created_by: user.id }));
      const { error } = await supabase.from('department_announcements').insert(rows);

      if (error) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = t('announcements.postFailed', { message: error.message });
        return;
      }

      form.reset();
      formStatusEl.textContent = '';
      load();
    });
  }

  load();

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('department_announcements')
      .select('id, title, body, created_at, author:profiles!created_by ( full_name )')
      .eq('department_id', departmentId)
      .order('created_at', { ascending: false });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('announcements.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('announcements.none')}</p>`;
      return;
    }

    listEl.innerHTML = data.map((a) => `
      <div class="border border-slate-200 rounded-lg p-3">
        <div class="font-medium text-slate-800">${escapeHtml(a.title)}</div>
        ${a.body ? `<p class="text-sm text-slate-600 mt-1 whitespace-pre-wrap">${escapeHtml(a.body)}</p>` : ''}
        <div class="text-xs text-slate-400 mt-2">${escapeHtml(a.author?.full_name || '')} · ${escapeHtml(a.created_at.slice(0, 10))}</div>
      </div>
    `).join('');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
