// Projection theme manager -- pick/create a named text+background+size
// preset per category (Songs/Bible/Media) and set one as the default
// for this tenant, or just "use" one for the rest of this session
// without changing the stored default. Cloud-stored (projection_themes
// table) since these are tiny rows, unlike the local-only Image/Video/
// Presentation media -- every operator on any computer for this
// tenant sees the same theme choices.
import { t } from '../i18n.js';
import { getTenantId } from '../tenant.js';

const CATEGORIES = ['songs', 'bible', 'media'];
const BUCKET = 'projection-theme-backgrounds';

// Every theme's editor shows the same 4 sample lines it'll actually
// be used for (songs are capped at 4 lines/slide -- see
// js/utils/songSlides.js), live-resized as the font-size slider moves
// and auto-shrunk if 4 lines at the chosen size wouldn't fit -- the
// exact same fit algorithm js/projectorPage.js's showText() runs for
// real, so what's previewed here is what a real 4-line slide will do.
const SAMPLE_LINES = {
  songs: ['Amazing grace,', 'how sweet the sound,', 'that saved a wretch', 'like me.'],
  bible: ['For God so loved the world', 'that he gave his only Son,', 'that whoever believes in him', 'should not perish.'],
  media: ['Welcome', 'to', 'the', 'service'],
};

export function createProjectionThemeModal({ supabase, onThemeChanged }) {
  let themesByCategory = { songs: [], bible: [], media: [] };

  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('projectionTheme.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="categories" class="space-y-8"></div>
    </div>
  `;
  document.body.appendChild(root);

  const categoriesEl = root.querySelector('[data-el="categories"]');

  function close() { root.classList.add('hidden'); }
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  function themeCardHtml(theme) {
    const bgStyle = theme.background_type === 'image'
      ? `background-image:url("${escapeAttr(theme.background_value)}");background-size:cover;background-position:center;`
      : `background:${escapeAttr(theme.background_value)};`;
    return `
      <div class="rounded-lg border ${theme.is_default ? 'border-indigo-400' : 'border-slate-200'} p-2">
        <div class="rounded h-16 flex items-center justify-center text-center text-xs mb-2 px-1 leading-snug" style="${bgStyle}color:${escapeAttr(theme.text_color)};">
          ${escapeHtml(theme.name)}
        </div>
        <div class="flex items-center justify-between gap-1">
          <button type="button" data-action="use-theme" data-theme-id="${theme.id}" class="text-xs text-indigo-600 hover:underline">${t('projectionTheme.use')}</button>
          <button type="button" data-action="edit-theme" data-theme-id="${theme.id}" class="text-xs text-slate-500 hover:underline">${t('projectionTheme.edit')}</button>
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
        <form data-el="theme-form" data-category="${category}" data-editing-id="" class="border-t border-slate-100 pt-3">
          <p data-el="form-heading" class="text-xs font-semibold text-slate-500 mb-2">${t('projectionTheme.newTheme')}</p>
          <div class="grid sm:grid-cols-[1fr_1fr] gap-4">
            <div class="space-y-3">
              <div class="flex flex-wrap items-end gap-3">
                <div>
                  <label class="block text-xs text-slate-500 mb-1">${t('projectionTheme.name')}</label>
                  <input type="text" name="name" required class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-32" />
                </div>
                <div>
                  <label class="block text-xs text-slate-500 mb-1">${t('projectionTheme.textColor')}</label>
                  <input type="color" name="text_color" value="#ffffff" class="w-10 h-8 border border-slate-300 rounded cursor-pointer" />
                </div>
              </div>
              <div>
                <label class="block text-xs text-slate-500 mb-1">${t('projectionTheme.textSize')}</label>
                <div class="flex items-center gap-2">
                  <input type="range" name="font_scale" min="50" max="600" step="10" value="100" class="w-40" />
                  <span data-el="font-scale-value" class="text-xs text-slate-500 w-12">100%</span>
                </div>
              </div>
              <div>
                <label class="block text-xs text-slate-500 mb-1">${t('projectionTheme.backgroundType')}</label>
                <select name="background_type" data-el="bg-type-select" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                  <option value="color">${t('projectionTheme.backgroundColor')}</option>
                  <option value="gradient">${t('projectionTheme.backgroundGradient')}</option>
                  <option value="image">${t('projectionTheme.backgroundImage')}</option>
                </select>
              </div>
              <div data-el="bg-color-field">
                <label class="block text-xs text-slate-500 mb-1">${t('projectionTheme.backgroundColor')}</label>
                <input type="color" name="background_color" value="#000000" class="w-10 h-8 border border-slate-300 rounded cursor-pointer" />
              </div>
              <div data-el="bg-gradient-field" class="hidden items-end gap-2">
                <div>
                  <label class="block text-xs text-slate-500 mb-1">${t('projectionTheme.gradientFrom')}</label>
                  <input type="color" name="gradient_from" value="#1e1b4b" class="w-10 h-8 border border-slate-300 rounded cursor-pointer" />
                </div>
                <div>
                  <label class="block text-xs text-slate-500 mb-1">${t('projectionTheme.gradientTo')}</label>
                  <input type="color" name="gradient_to" value="#78350f" class="w-10 h-8 border border-slate-300 rounded cursor-pointer" />
                </div>
              </div>
              <div data-el="bg-image-field" class="hidden">
                <label class="block text-xs text-slate-500 mb-1">${t('projectionTheme.chooseImage')}</label>
                <input type="file" accept="image/png,image/jpeg,image/webp" name="background_image" class="text-xs" />
              </div>
              <div class="flex items-center gap-2 pt-1">
                <button type="submit" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('projectionTheme.add')}</button>
                <button type="button" data-action="cancel-edit" class="hidden px-3 py-1.5 rounded-lg text-slate-500 text-sm hover:underline">${t('common.cancel')}</button>
              </div>
            </div>
            <div data-el="theme-preview" class="relative rounded-lg overflow-hidden bg-black aspect-video flex items-center justify-center">
              <div data-el="theme-preview-lines" class="relative z-10 text-center px-4 leading-snug"></div>
            </div>
          </div>
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

  function resetForm(form) {
    form.dataset.editingId = '';
    form.querySelector('[data-el="form-heading"]').textContent = t('projectionTheme.newTheme');
    form.querySelector('[name="name"]').value = '';
    form.querySelector('[name="text_color"]').value = '#ffffff';
    form.querySelector('[name="font_scale"]').value = '100';
    form.querySelector('[data-el="font-scale-value"]').textContent = '100%';
    form.querySelector('[name="background_type"]').value = 'color';
    form.querySelector('[name="background_color"]').value = '#000000';
    form.querySelector('[name="gradient_from"]').value = '#1e1b4b';
    form.querySelector('[name="gradient_to"]').value = '#78350f';
    form.querySelector('[name="background_image"]').value = '';
    delete form.dataset.previewImageUrl;
    form.querySelector('[data-action="cancel-edit"]').classList.add('hidden');
    form.querySelector('button[type="submit"]').textContent = t('projectionTheme.add');
    toggleBackgroundFields(form);
    renderFormPreview(form);
  }

  function populateFormForEdit(form, theme) {
    form.dataset.editingId = theme.id;
    form.querySelector('[data-el="form-heading"]').textContent = t('projectionTheme.editingTheme', { name: theme.name });
    form.querySelector('[name="name"]').value = theme.name;
    form.querySelector('[name="text_color"]').value = theme.text_color;
    form.querySelector('[name="font_scale"]').value = String(Math.round((theme.font_scale || 1) * 100));
    form.querySelector('[data-el="font-scale-value"]').textContent = `${Math.round((theme.font_scale || 1) * 100)}%`;
    form.querySelector('[name="background_type"]').value = theme.background_type;
    if (theme.background_type === 'gradient') {
      const match = /linear-gradient\([^,]+,\s*([^,]+),\s*([^)]+)\)/.exec(theme.background_value);
      form.querySelector('[name="gradient_from"]').value = match?.[1]?.trim() || '#1e1b4b';
      form.querySelector('[name="gradient_to"]').value = match?.[2]?.trim() || '#78350f';
    } else if (theme.background_type === 'color') {
      form.querySelector('[name="background_color"]').value = theme.background_value;
    } else {
      form.dataset.previewImageUrl = theme.background_value;
    }
    form.querySelector('[name="background_image"]').value = '';
    form.querySelector('[data-action="cancel-edit"]').classList.remove('hidden');
    form.querySelector('button[type="submit"]').textContent = t('projectionTheme.saveChanges');
    toggleBackgroundFields(form);
    renderFormPreview(form);
  }

  function toggleBackgroundFields(form) {
    const type = form.querySelector('[name="background_type"]').value;
    form.querySelector('[data-el="bg-color-field"]').classList.toggle('hidden', type !== 'color');
    form.querySelector('[data-el="bg-gradient-field"]').classList.toggle('hidden', type !== 'gradient');
    form.querySelector('[data-el="bg-gradient-field"]').classList.toggle('flex', type === 'gradient');
    form.querySelector('[data-el="bg-image-field"]').classList.toggle('hidden', type !== 'image');
  }

  // Mirrors js/projectorPage.js's showText()/fitLinesToContainer()
  // exactly, just scaled to this preview box's own width instead of
  // the real viewport -- so a theme that needs auto-shrinking for its
  // 4 sample lines previews that shrinking here too, not only live.
  function renderFormPreview(form) {
    const category = form.dataset.category;
    const previewBox = form.querySelector('[data-el="theme-preview"]');
    const previewLines = form.querySelector('[data-el="theme-preview-lines"]');
    const scale = Number(form.querySelector('[name="font_scale"]').value) / 100;
    const textColor = form.querySelector('[name="text_color"]').value;
    const bgType = form.querySelector('[name="background_type"]').value;

    previewLines.style.color = textColor;
    previewLines.innerHTML = (SAMPLE_LINES[category] || []).map((line) => `<p class="m-0">${escapeHtml(line)}</p>`).join('');

    if (bgType === 'gradient') {
      const from = form.querySelector('[name="gradient_from"]').value;
      const to = form.querySelector('[name="gradient_to"]').value;
      previewBox.style.backgroundImage = '';
      previewBox.style.background = `linear-gradient(135deg,${from},${to})`;
    } else if (bgType === 'image') {
      const url = form.dataset.previewImageUrl || '';
      previewBox.style.background = '#000';
      previewBox.style.backgroundImage = url ? `url("${url}")` : '';
      previewBox.style.backgroundSize = 'cover';
      previewBox.style.backgroundPosition = 'center';
    } else {
      previewBox.style.backgroundImage = '';
      previewBox.style.background = form.querySelector('[name="background_color"]').value;
    }

    const boxWidth = previewBox.getBoundingClientRect().width || 300;
    let fontPx = scale * 4 * (boxWidth / 100);
    previewLines.style.fontSize = `${fontPx}px`;
    let guard = 0;
    while (previewLines.scrollHeight > previewBox.clientHeight && fontPx > 4 && guard < 40) {
      fontPx *= 0.95;
      previewLines.style.fontSize = `${fontPx}px`;
      guard += 1;
    }
  }

  function render() {
    categoriesEl.innerHTML = CATEGORIES.map(categorySectionHtml).join('');

    categoriesEl.querySelectorAll('[data-action="use-theme"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const theme = findTheme(btn.dataset.themeId);
        if (theme) onThemeChanged?.(theme.category, theme);
      });
    });

    categoriesEl.querySelectorAll('[data-action="edit-theme"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const theme = findTheme(btn.dataset.themeId);
        if (!theme) return;
        const form = categoriesEl.querySelector(`[data-category-section="${theme.category}"] [data-el="theme-form"]`);
        populateFormForEdit(form, theme);
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

    categoriesEl.querySelectorAll('[data-el="theme-form"]').forEach((form) => {
      renderFormPreview(form);

      form.querySelector('[data-action="cancel-edit"]').addEventListener('click', () => resetForm(form));

      ['font_scale', 'text_color', 'background_color', 'gradient_from', 'gradient_to'].forEach((name) => {
        form.querySelector(`[name="${name}"]`).addEventListener('input', () => {
          if (name === 'font_scale') {
            form.querySelector('[data-el="font-scale-value"]').textContent = `${form.querySelector('[name="font_scale"]').value}%`;
          }
          renderFormPreview(form);
        });
      });

      form.querySelector('[data-el="bg-type-select"]').addEventListener('change', () => {
        toggleBackgroundFields(form);
        renderFormPreview(form);
      });

      form.querySelector('[name="background_image"]').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        form.dataset.previewImageUrl = URL.createObjectURL(file);
        renderFormPreview(form);
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveTheme(form);
      });
    });
  }

  async function saveTheme(form) {
    const category = form.dataset.category;
    const editingId = form.dataset.editingId || null;
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    if (!name) return;
    const backgroundType = String(fd.get('background_type'));
    const fontScale = Number(fd.get('font_scale')) / 100;
    const textColor = String(fd.get('text_color'));
    const imageFile = fd.get('background_image');
    const hasNewImageFile = imageFile instanceof File && imageFile.size > 0;

    if (backgroundType === 'image' && !hasNewImageFile && !form.dataset.previewImageUrl) {
      window.alert(t('projectionTheme.imageRequired'));
      return;
    }

    let backgroundValue;
    if (backgroundType === 'gradient') {
      backgroundValue = `linear-gradient(135deg,${fd.get('gradient_from')},${fd.get('gradient_to')})`;
    } else if (backgroundType === 'color') {
      backgroundValue = String(fd.get('background_color'));
    } else {
      // 'image' -- keep whatever's already stored unless a new file was
      // picked (editing a theme without touching its image shouldn't
      // require re-uploading it); the guard above already ensured one
      // of the two is available.
      backgroundValue = hasNewImageFile ? null : form.dataset.previewImageUrl;
    }

    const payload = { category, name, text_color: textColor, font_scale: fontScale, background_type: backgroundType };
    if (backgroundValue !== null) payload.background_value = backgroundValue;

    let themeId = editingId;
    if (editingId) {
      await supabase.from('projection_themes').update(payload).eq('id', editingId);
    } else {
      if (backgroundType === 'image' && backgroundValue === null) payload.background_value = '#000000'; // placeholder until the upload below fills it in
      const { data, error } = await supabase.from('projection_themes').insert(payload).select('id').single();
      if (error) return;
      themeId = data.id;
    }

    if (backgroundType === 'image' && hasNewImageFile) {
      const tenantId = getTenantId();
      const ext = imageFile.name.split('.').pop() || 'jpg';
      const path = `${tenantId}/${themeId}.${ext}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, imageFile, { contentType: imageFile.type, upsert: true });
      if (!uploadError) {
        const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
        const cacheBustedUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;
        await supabase.from('projection_themes').update({ background_value: cacheBustedUrl }).eq('id', themeId);
      }
    }

    await loadThemes();
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
