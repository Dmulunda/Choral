// Church Program department board (sql/065) — every member has
// access automatically, so this is meant to be the first thing most
// people see. Lists upcoming church-wide programs (ordinary and
// "special"), with an add form + flyer upload for the department's
// own admins. A special program also triggers a pop-up elsewhere
// (specialProgramPopup.js, wired from app.js) independent of whether
// someone ever opens this tab.
import { confirmDialog } from './confirmDialog.js';
import { t } from '../i18n.js';
import { todayLocal } from '../utils/date.js';

const FLYER_BUCKET = 'church-program-flyers';

export function renderChurchProgramBoard(container, { supabase, canAdminister, currentUserId }) {
  container.innerHTML = `
    ${canAdminister ? `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">${t('churchProgram.addTitle')}</h2>
        <form data-el="form" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('churchProgram.programTitle')}</label>
            <input type="text" name="title" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('churchProgram.description')}</label>
            <textarea name="description" rows="2" class="w-full border border-slate-300 rounded-lg px-3 py-2"></textarea>
          </div>
          <div class="grid sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.date')}</label>
              <input type="date" name="date" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
            </div>
            <div class="flex items-end pb-2">
              <label class="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" name="is_special" />
                ${t('churchProgram.isSpecial')}
              </label>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('churchProgram.flyer')}</label>
            <input type="file" name="flyer" accept="image/*" class="w-full text-sm" />
          </div>
          <div class="flex items-center gap-3">
            <button type="submit" data-el="submit-btn"
                    class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
              ${t('churchProgram.save')}
            </button>
            <span data-el="form-status" class="text-sm text-slate-500"></span>
          </div>
        </form>
      </div>
    ` : ''}
    <div class="bg-white rounded-xl shadow p-4 sm:p-6">
      <h2 class="text-lg font-semibold mb-4">${t('churchProgram.upcomingTitle')}</h2>
      <div data-el="list" class="space-y-3"></div>
    </div>
  `;

  const form = container.querySelector('[data-el="form"]');
  const listEl = container.querySelector('[data-el="list"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const submitBtn = container.querySelector('[data-el="submit-btn"]');

  form?.addEventListener('submit', handleSubmit);

  loadPrograms();

  async function handleSubmit(e) {
    e.preventDefault();
    const title = form.elements.title.value.trim();
    const description = form.elements.description.value.trim() || null;
    const date = form.elements.date.value;
    const isSpecial = form.elements.is_special.checked;
    const flyerFile = form.elements.flyer.files[0] || null;

    if (!title || !date) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('churchProgram.missingFields');
      return;
    }

    submitBtn.disabled = true;
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    try {
      let flyerPath = null;
      if (flyerFile) {
        flyerPath = `${crypto.randomUUID()}-${flyerFile.name}`;
        const { error: uploadError } = await supabase.storage.from(FLYER_BUCKET).upload(flyerPath, flyerFile);
        if (uploadError) throw uploadError;
      }

      const { error: insertError } = await supabase.from('church_programs').insert({
        title,
        description,
        date,
        is_special: isSpecial,
        flyer_storage_path: flyerPath,
        created_by: currentUserId,
      });
      if (insertError) throw insertError;

      formStatusEl.className = 'text-sm text-emerald-600';
      formStatusEl.textContent = t('churchProgram.saved');
      form.reset();
      loadPrograms();
    } catch (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('churchProgram.saveFailed', { message: error.message });
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function loadPrograms() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('church_programs')
      .select('id, title, description, date, is_special, flyer_storage_path')
      .gte('date', todayLocal())
      .order('date', { ascending: true });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('churchProgram.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (!data || data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('churchProgram.none')}</p>`;
      return;
    }

    listEl.innerHTML = '';
    for (const program of data) {
      listEl.appendChild(await buildCard(program));
    }
  }

  async function buildCard(program) {
    let flyerUrl = null;
    if (program.flyer_storage_path) {
      const { data: signed } = await supabase.storage.from(FLYER_BUCKET).createSignedUrl(program.flyer_storage_path, 3600);
      flyerUrl = signed?.signedUrl || null;
    }

    const card = document.createElement('div');
    card.className = 'border border-slate-200 rounded-lg p-3';
    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="font-semibold text-slate-800">
            ${escapeHtml(program.title)}
            ${program.is_special ? `<span class="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">${t('churchProgram.specialBadge')}</span>` : ''}
          </div>
          <div class="text-sm text-slate-500">${escapeHtml(program.date)}</div>
        </div>
        ${canAdminister ? `<button type="button" data-action="delete" class="text-xs font-medium text-rose-600 hover:text-rose-800 whitespace-nowrap">${t('churchProgram.delete')}</button>` : ''}
      </div>
      ${program.description ? `<p class="text-sm text-slate-600 mt-2">${escapeHtml(program.description)}</p>` : ''}
      ${flyerUrl ? `<img src="${flyerUrl}" alt="${escapeAttr(program.title)}" class="mt-2 rounded-lg max-h-48 object-contain" />` : ''}
    `;

    card.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteProgram(program));
    return card;
  }

  async function deleteProgram(program) {
    if (!(await confirmDialog({ message: t('churchProgram.confirmDelete', { title: program.title }) }))) return;

    const { error } = await supabase.from('church_programs').delete().eq('id', program.id);
    if (error) {
      window.alert(t('churchProgram.deleteFailed', { message: error.message }));
      return;
    }
    loadPrograms();
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
