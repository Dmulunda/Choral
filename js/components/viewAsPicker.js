// Super Admin "View As" target picker — a searchable list of every
// member (excluding the super admin themself) that hands the chosen
// user's id/name back to the caller, which wires it into
// departments.js's startViewAs(). Modeled on memberCreatorModal.js's
// create-and-return-{open} pattern.
import { t } from '../i18n.js';

export function createViewAsPickerModal({ supabase, currentUserId, onSelect }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
      <div class="flex items-center justify-between p-6 pb-2">
        <h2 class="text-xl font-bold">${t('viewAs.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-xs text-slate-500 px-6 mb-3">${t('viewAs.intro')}</p>
      <div class="px-6 mb-3">
        <input type="search" data-el="search" placeholder="${t('viewAs.searchPlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2" />
      </div>
      <div data-el="list" class="flex-1 overflow-y-auto px-6 pb-6 space-y-1"></div>
    </div>
  `;
  document.body.appendChild(root);

  const searchEl = root.querySelector('[data-el="search"]');
  const listEl = root.querySelector('[data-el="list"]');
  let members = [];

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  searchEl.addEventListener('input', () => renderList());

  async function loadMembers() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('viewAs.loading')}</p>`;

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, profile_emails ( email )')
      .order('full_name');

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('viewAs.loadFailed', { message: error.message })}</p>`;
      return;
    }

    members = (data || []).filter((m) => m.id !== currentUserId);
    renderList();
  }

  function renderList() {
    const query = searchEl.value.trim().toLowerCase();
    const filtered = query
      ? members.filter((m) => {
          const email = m.profile_emails?.email || '';
          return m.full_name.toLowerCase().includes(query) || email.toLowerCase().includes(query);
        })
      : members;

    if (filtered.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('viewAs.noResults')}</p>`;
      return;
    }

    listEl.innerHTML = filtered
      .map((m) => `
        <button type="button" data-id="${m.id}" data-name="${m.full_name.replace(/"/g, '&quot;')}"
                class="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 flex items-center justify-between gap-2">
          <span class="min-w-0">
            <span class="block font-medium truncate">${m.full_name}</span>
            ${m.profile_emails?.email ? `<span class="block text-xs text-slate-500 truncate">${m.profile_emails.email}</span>` : ''}
          </span>
          <span class="text-xs font-medium text-indigo-600 shrink-0">${t('viewAs.select')}</span>
        </button>
      `)
      .join('');

    listEl.querySelectorAll('[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        onSelect(btn.dataset.id, btn.dataset.name);
        close();
      });
    });
  }

  function open() {
    searchEl.value = '';
    root.classList.remove('hidden');
    root.classList.add('flex');
    loadMembers();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}
