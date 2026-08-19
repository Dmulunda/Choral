// Announcements feed for a department — part of the shared Dashboard
// module reused by every "lightweight" department (no bespoke tooling
// needed for a simple announcements board). Admins can post; everyone
// with department access can read.
import { t } from '../i18n.js';

export function renderAnnouncements(container, { supabase, departmentId, canAdminister }) {
  container.innerHTML = `
    <h2 class="text-lg font-semibold mb-4">${t('announcements.title')}</h2>
    ${canAdminister ? `
      <form data-el="form" class="space-y-2 mb-4 pb-4 border-b border-slate-200">
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

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = form.elements.title.value.trim();
      const body = form.elements.body.value.trim() || null;
      if (!title) return;

      const { data: { user } } = await supabase.auth.getUser();
      formStatusEl.className = 'text-sm text-slate-500';
      formStatusEl.textContent = t('common.saving');

      const { error } = await supabase
        .from('department_announcements')
        .insert({ department_id: departmentId, title, body, created_by: user.id });

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
