// Super-Admin-only tool to rename any nav label, sidebar quick-action
// item, or department name — English and French both, so the app
// stays properly bilingual. Writes to menu_labels (sql/045); t() in
// i18n.js checks that table before falling back to the built-in
// dictionary, so every existing screen picks up the rename with no
// code changes anywhere else.
//
// Deliberately scoped to a fixed, curated list of keys (below) rather
// than every string in the app — the hundreds of button labels, error
// messages, and placeholders elsewhere stay fixed in code; this is
// specifically the navigation surface: top nav, the sidebar dropdown,
// and department names.
import { t, getBuiltInLabel, setLabelOverride } from '../i18n.js';
import { DEPARTMENT_KEYS } from '../departments.js';

const NAV_KEYS = ['nav.dashboard', 'nav.scheduling', 'nav.songbook', 'nav.voiceExercises', 'nav.members', 'nav.home', 'nav.training'];
const SIDEBAR_KEYS = ['sidebar.churchRules', 'sidebar.attendance', 'sidebar.appSuggestion', 'sidebar.reportAbsence', 'sidebar.departmentRules', 'sidebar.monthlyReport', 'sidebar.guestCases', 'sidebar.memberCases'];
const DEPARTMENT_LABEL_KEYS = DEPARTMENT_KEYS.map((key) => `department.${key}`);

export function createMenuCustomizerModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('menuCustomizer.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-sm text-slate-500 mb-4">${t('menuCustomizer.intro')}</p>
      <div data-el="body"></div>
      <div class="flex items-center gap-3 mt-4 pt-4 border-t border-slate-200">
        <button type="button" data-action="save-all" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('menuCustomizer.saveAll')}
        </button>
        <span data-el="status" class="text-sm text-slate-500"></span>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');
  const statusEl = root.querySelector('[data-el="status"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="save-all"]').addEventListener('click', saveAll);

  let overridesByKey = new Map();
  let savedAnything = false;

  async function open() {
    savedAnything = false;
    root.classList.remove('hidden');
    root.classList.add('flex');
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    statusEl.textContent = '';

    const { data, error } = await supabase.from('menu_labels').select('key, label_en, label_fr');
    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('menuCustomizer.loadFailed', { message: error.message })}</p>`;
      return;
    }
    overridesByKey = new Map((data || []).map((r) => [r.key, r]));

    bodyEl.innerHTML = `
      ${renderSection(t('menuCustomizer.sectionNav'), NAV_KEYS)}
      ${renderSection(t('menuCustomizer.sectionSidebar'), SIDEBAR_KEYS)}
      ${renderSection(t('menuCustomizer.sectionDepartments'), DEPARTMENT_LABEL_KEYS)}
    `;

    bodyEl.querySelectorAll('[data-action="reset-row"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const builtIn = getBuiltInLabel(key);
        bodyEl.querySelector(`[data-el="en-${cssEscape(key)}"]`).value = builtIn.en;
        bodyEl.querySelector(`[data-el="fr-${cssEscape(key)}"]`).value = builtIn.fr;
      });
    });
  }

  function renderSection(title, keys) {
    return `
      <div class="mb-5">
        <h3 class="text-sm font-semibold text-slate-700 mb-2">${escapeHtml(title)}</h3>
        <div class="space-y-3">
          ${keys.map((key) => renderRow(key)).join('')}
        </div>
      </div>
    `;
  }

  function renderRow(key) {
    const builtIn = getBuiltInLabel(key);
    const existing = overridesByKey.get(key);
    const currentEn = existing?.label_en ?? builtIn.en;
    const currentFr = existing?.label_fr ?? builtIn.fr;
    return `
      <div class="grid sm:grid-cols-2 gap-2 border border-slate-200 rounded-lg p-3" data-row="${escapeAttr(key)}">
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">${t('menuCustomizer.english')}</label>
          <input type="text" data-el="en-${cssEscape(key)}" value="${escapeAttr(currentEn)}" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">${t('menuCustomizer.french')}</label>
          <div class="flex gap-2">
            <input type="text" data-el="fr-${cssEscape(key)}" value="${escapeAttr(currentFr)}" class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
            <button type="button" data-action="reset-row" data-key="${escapeAttr(key)}" class="text-xs text-slate-400 hover:text-slate-600 whitespace-nowrap">${t('menuCustomizer.resetRow')}</button>
          </div>
        </div>
      </div>
    `;
  }

  async function saveAll() {
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.saving');

    const allKeys = [...NAV_KEYS, ...SIDEBAR_KEYS, ...DEPARTMENT_LABEL_KEYS];
    const rows = allKeys.map((key) => ({
      key,
      label_en: bodyEl.querySelector(`[data-el="en-${cssEscape(key)}"]`).value.trim(),
      label_fr: bodyEl.querySelector(`[data-el="fr-${cssEscape(key)}"]`).value.trim(),
      updated_by: currentUserId,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase.from('menu_labels').upsert(rows, { onConflict: 'key' });
    if (error) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('menuCustomizer.saveFailed', { message: error.message });
      return;
    }

    rows.forEach((r) => setLabelOverride(r.key, r.label_en, r.label_fr));
    savedAnything = true;
    statusEl.className = 'text-sm text-emerald-600';
    statusEl.textContent = t('menuCustomizer.savedReload');
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
    // Every already-open nav/sidebar element was built with the
    // pre-rename text — simplest reliable way to refresh everything at
    // once rather than threading a refresh callback through every
    // module that renders a label.
    if (savedAnything) window.location.reload();
  }

  return { open, root };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}

function cssEscape(str) {
  return str.replace(/[^a-zA-Z0-9_-]/g, '_');
}
