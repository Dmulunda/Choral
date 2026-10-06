// Projection theme manager -- pick/create a named text+background
// preset per category (Songs/Bible/Media) and set one as the default
// for this tenant, or just "use" one for the rest of this session
// without changing the stored default. Cloud-stored (projection_themes
// table) since these are tiny JSON rows, unlike the local-only Image/
// Video/Presentation media -- every operator on any computer for this
// tenant sees the same theme choices.
import { t } from '../i18n.js';

const CATEGORIES = ['songs', 'bible', 'media'];
const SAMPLE_TEXT = {
  songs: 'Amazing grace, how sweet the sound',
  bible: 'For God so loved the world…',
  media: 'Welcome',
};

export function createProjectionThemeModal({ supabase, onThemeChanged }) {
  let themesByCategory = { songs: [], bible: [], media: [] };

  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('projectionTheme.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="categories" class="space-y-6"></div>
    </div>
  `;
  document.body.appendChild(root);

  const categoriesEl = root.querySelector('[data-el="categories"]');

  function close() { root.classList.add('hidden'); }
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  function themeCardHtml(theme) {
    return `
      <div class="rounded-lg border ${theme.is_default ? 'border-indigo-400' : 'border-slate-200'} p-2">
        <div class="rounded h-16 flex items-center justify-center text-center text-xs mb-2 px-1 leading-snug" style="background:${escapeAttr(theme.background_value)};color:${escapeAttr(theme.text_color)};">
          ${escapeHtml(SAMPLE_TEXT[theme.category] || theme.name)}
        </div>
        <p class="text-xs font-medium text-slate-700 truncate mb-1">${escapeHtml(theme.name)}</p>
        <div class="flex items-center justify-between gap-1">
          <button type="button" data-action="use-theme" data-theme-id="${theme.id}" class="text-xs text-indigo-600 hover:underline">${t('projectionTheme.use')}</button>
          ${theme.is_default
            ? `<span class="text-xs font-semibold text-indigo-500">${t('projectionTheme.default')}</span>`
            : `<button type="button" data-action="set-default" data-theme-id="${theme.id}" class="text-xs text-slate-500 hover:underline">${t('projectionTheme.setDefault')}</button>`}
          ${theme.is_default ? '' : `<button type="button" data-action="delete-theme" data-theme-id="${theme.id}" class="text-xs text-rose-400 hover:text-rose-600">&times;</button>`}
        </div>
      </div>
    `;
  }

  function categorySectionHtml(category) {
    const themes = themesByCategory[category] || [];
    return `
      <div data-category-section="${category}">
        <h3 class="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">${t(`projectionTheme.category.${category}`)}</h3>
        <div class="grid sm:grid-cols-3 gap-3 mb-3" data-theme-list="${category}">
          ${themes.map(themeCardHtml).join('')}
        </div>
        <form data-el="new-theme-form" data-category="${category}" class="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
          <div>
            <label class="block text-xs text-slate-500 mb-1">${t('projectionTheme.name')}</label>
            <input type="text" name="name" required class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-32" />
          </div>
          <div>
            <label class="block text-xs text-slate-500 mb-1">${t('projectionTheme.textColor')}</label>
            <input type="color" name="text_color" value="#ffffff" class="w-10 h-8 border border-slate-300 rounded cursor-pointer" />
          </div>
          <div>
            <label class="block text-xs text-slate-500 mb-1">${t('projectionTheme.backgroundType')}</label>
            <select name="background_type" data-el="bg-type-select" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="color">${t('projectionTheme.backgroundColor')}</option>
              <option value="gradient">${t('projectionTheme.backgroundGradient')}</option>
            </select>
          </div>
          <div data-el="bg-color-field">
            <label class="block text-xs text-slate-500 mb-1">${t('projectionTheme.backgroundColor')}</label>
            <input type="color" name="background_color" value="#000000" class="w-10 h-8 border border-slate-300 rounded cursor-pointer" />
          </div>
          <div data-el="bg-gradient-field" class="hidden flex items-end gap-2">
            <div>
              <label class="block text-xs text-slate-500 mb-1">${t('projectionTheme.gradientFrom')}</label>
              <input type="color" name="gradient_from" value="#1e1b4b" class="w-10 h-8 border border-slate-300 rounded cursor-pointer" />
            </div>
            <div>
              <label class="block text-xs text-slate-500 mb-1">${t('projectionTheme.gradientTo')}</label>
              <input type="color" name="gradient_to" value="#78350f" class="w-10 h-8 border border-slate-300 rounded cursor-pointer" />
            </div>
          </div>
          <button type="submit" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('projectionTheme.add')}</button>
        </form>
      </div>
    `;
  }

  async function loadThemes() {
    const { data } = await supabase.from('projection_themes').select('*').order('created_at');
    themesByCategory = { songs: [], bible: [], media: [] };
    (data || []).forEach((theme) => { (themesByCategory[theme.category] || (themesByCategory[theme.category] = [])).push(theme); });
    render();
  }

  function render() {
    categoriesEl.innerHTML = CATEGORIES.map(categorySectionHtml).join('');

    categoriesEl.querySelectorAll('[data-action="use-theme"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const theme = findTheme(btn.dataset.themeId);
        if (theme) onThemeChanged?.(theme.category, theme);
      });
    });

    categoriesEl.querySelectorAll('[data-action="set-default"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const theme = findTheme(btn.dataset.themeId);
        if (!theme) return;
        await supabase.rpc('set_default_projection_theme', { p_theme_id: theme.id });
        await loadThemes();
        onThemeChanged?.(theme.category, theme);
      });
    });

    categoriesEl.querySelectorAll('[data-action="delete-theme"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm(t('projectionTheme.confirmDelete'))) return;
        await supabase.from('projection_themes').delete().eq('id', btn.dataset.themeId);
        await loadThemes();
      });
    });

    categoriesEl.querySelectorAll('[data-el="new-theme-form"]').forEach((form) => {
      const bgTypeSelect = form.querySelector('[data-el="bg-type-select"]');
      const colorField = form.querySelector('[data-el="bg-color-field"]');
      const gradientField = form.querySelector('[data-el="bg-gradient-field"]');
      bgTypeSelect.addEventListener('change', () => {
        const isGradient = bgTypeSelect.value === 'gradient';
        colorField.classList.toggle('hidden', isGradient);
        gradientField.classList.toggle('hidden', !isGradient);
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const category = form.dataset.category;
        const fd = new FormData(form);
        const name = String(fd.get('name') || '').trim();
        if (!name) return;
        const backgroundType = String(fd.get('background_type'));
        const backgroundValue = backgroundType === 'gradient'
          ? `linear-gradient(135deg,${fd.get('gradient_from')},${fd.get('gradient_to')})`
          : String(fd.get('background_color'));

        await supabase.from('projection_themes').insert({
          category,
          name,
          text_color: String(fd.get('text_color')),
          background_type: backgroundType,
          background_value: backgroundValue,
        });
        await loadThemes();
      });
    });
  }

  function findTheme(id) {
    for (const category of CATEGORIES) {
      const found = (themesByCategory[category] || []).find((th) => th.id === id);
      if (found) return found;
    }
    return null;
  }

  function open() {
    loadThemes();
    root.classList.remove('hidden');
  }

  // So the control panel can apply every category's default theme as
  // soon as it mounts, without the operator ever opening this modal.
  async function getDefaultThemes() {
    const { data } = await supabase.from('projection_themes').select('*').eq('is_default', true);
    const result = {};
    (data || []).forEach((theme) => { result[theme.category] = theme; });
    return result;
  }

  return { open, root, getDefaultThemes };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
