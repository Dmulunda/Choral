// Flyers tab -- gallery of saved flyers, a template picker for new
// ones, and the actual editor (js/components/flyerEditor.js) shown
// inline once a template (or an existing flyer) is opened. Same
// unconditional nav placement and canManage gating shape as
// js/eventsPage.js (department admin of some department, or Super
// Admin, via can_manage_flyers() on the DB side -- this page's own
// show/hide of buttons is a convenience, not the real gate).
import { getEffectiveSupabase, getGlobalRole } from './departments.js';
import { renderFlyerEditor, loadFlyerDraft, clearFlyerDraft } from './components/flyerEditor.js';
import { FLYER_TEMPLATES, FLYER_SIZES } from './flyerTemplates.js';
import { confirmDialog } from './components/confirmDialog.js';
import { t } from './i18n.js';

// Set by eventsPage.js's own "Create Flyer" button right before it
// switches to this tab -- renderFlyersTab() checks this once, at the
// very end, and jumps straight into a prefilled editor instead of the
// usual list view when it's set. A plain module-level handoff rather
// than a prop, since tabs are independent, lazily-rendered modules
// with no shared parent component to pass this through.
let pendingEventPrefill = null;
export function openFlyerForEvent(prefill) {
  pendingEventPrefill = prefill;
}

export async function renderFlyersTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#flyers-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  const isSuperAdmin = getGlobalRole() === 'super_admin';
  const { data: myAdminDepts } = await supabase.from('department_memberships').select('department_id').eq('user_id', user.id).eq('role', 'admin').eq('status', 'approved');
  const canManage = isSuperAdmin || (myAdminDepts || []).length > 0;
  const tenantId = null; // Main is single-tenant -- no tenant_id column on flyers here
  const { data: branding } = await supabase.from('church_branding').select('logo_url').eq('id', true).maybeSingle();
  const logoUrl = branding?.logo_url || null;

  container.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <p class="text-sm text-slate-500">${t('flyers.intro')}</p>
      ${canManage ? `<button type="button" data-action="new-flyer" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 whitespace-nowrap">${t('flyers.newFlyer')}</button>` : ''}
    </div>
    <div data-el="draft-banner" class="hidden mb-4"></div>
    <div data-el="template-picker" class="hidden mb-4"></div>
    <div data-el="list-area"></div>
    <div data-el="editor-area"></div>
  `;

  const draftBannerEl = container.querySelector('[data-el="draft-banner"]');
  const templatePickerEl = container.querySelector('[data-el="template-picker"]');
  const listAreaEl = container.querySelector('[data-el="list-area"]');
  const editorAreaEl = container.querySelector('[data-el="editor-area"]');

  // A draft left behind by a reload (versionCheck.js's own auto-update
  // now holds off while the editor is open, but a plain F5 or the OS
  // killing a backgrounded tab on mobile still get here) -- offer to
  // pick the in-progress edit back up instead of silently discarding it.
  function renderDraftBanner(draft) {
    const ageMinutes = Math.max(1, Math.round((Date.now() - draft.savedAt) / 60000));
    draftBannerEl.classList.remove('hidden');
    draftBannerEl.innerHTML = `
      <div class="flex items-center justify-between gap-3 border border-amber-200 bg-amber-50 rounded-lg px-4 py-2.5 flex-wrap">
        <p class="text-sm text-amber-800">${t('flyers.draftFound', { minutes: ageMinutes })}</p>
        <div class="flex items-center gap-2 shrink-0">
          <button type="button" data-action="resume-draft" class="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700">${t('flyers.draftResume')}</button>
          <button type="button" data-action="discard-draft" class="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-700 text-xs font-medium hover:bg-amber-100">${t('flyers.draftDiscard')}</button>
        </div>
      </div>
    `;
    draftBannerEl.querySelector('[data-action="resume-draft"]').addEventListener('click', () => {
      draftBannerEl.classList.add('hidden');
      draftBannerEl.innerHTML = '';
      listAreaEl.classList.add('hidden');
      openEditor({ flyerId: draft.flyerId, resumeDraft: draft });
    });
    draftBannerEl.querySelector('[data-action="discard-draft"]').addEventListener('click', () => {
      clearFlyerDraft();
      draftBannerEl.classList.add('hidden');
      draftBannerEl.innerHTML = '';
    });
  }

  container.querySelector('[data-action="new-flyer"]')?.addEventListener('click', () => {
    listAreaEl.classList.add('hidden');
    renderTemplatePicker();
  });

  function renderTemplatePicker() {
    templatePickerEl.classList.remove('hidden');
    templatePickerEl.innerHTML = `
      <div class="border border-slate-200 rounded-lg p-4 bg-slate-50">
        <div class="flex items-center justify-between mb-3">
          <p class="text-sm font-semibold text-slate-700">${t('flyers.pickTemplate')}</p>
          <button type="button" data-action="cancel-picker" class="text-xs text-slate-500 hover:text-slate-700">${t('common.cancel')}</button>
        </div>
        <label class="block text-xs font-medium text-slate-600 mb-1">${t('flyers.pickSize')}</label>
        <select data-el="size-select" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm mb-3">
          ${Object.entries(FLYER_SIZES).map(([key, s]) => `<option value="${key}">${t(s.labelKey)}</option>`).join('')}
        </select>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          ${FLYER_TEMPLATES.map((tpl) => `
            <button type="button" data-template-key="${tpl.key}" class="border border-slate-200 rounded-lg overflow-hidden hover:border-indigo-400 text-left">
              <div style="background:${tpl.background}; height: 90px;"></div>
              <p class="text-xs font-medium text-slate-700 px-2 py-1.5">${t(tpl.labelKey)}</p>
            </button>
          `).join('')}
        </div>
      </div>
    `;
    templatePickerEl.querySelector('[data-action="cancel-picker"]').addEventListener('click', () => {
      templatePickerEl.classList.add('hidden');
      listAreaEl.classList.remove('hidden');
    });
    templatePickerEl.querySelectorAll('[data-template-key]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tpl = FLYER_TEMPLATES.find((x) => x.key === btn.dataset.templateKey);
        const sizeKey = templatePickerEl.querySelector('[data-el="size-select"]').value;
        templatePickerEl.classList.add('hidden');
        templatePickerEl.innerHTML = '';
        openEditor({ template: tpl, sizeKey, logoUrl });
      });
    });
  }

  function openEditor(opts) {
    editorAreaEl.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    renderFlyerEditor(editorAreaEl, {
      supabase, tenantId, currentUserId: user.id, canManage,
      logoUrl: null,
      ...opts,
      onBack: () => { editorAreaEl.innerHTML = ''; listAreaEl.classList.remove('hidden'); loadList(); },
      onSaved: () => { loadList(); },
    });
  }

  async function loadList() {
    listAreaEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const { data: flyers, error } = await supabase.from('flyers').select('*').order('updated_at', { ascending: false });
    if (error) {
      listAreaEl.innerHTML = `<p class="text-sm text-rose-600">${t('flyers.loadFailed', { message: error.message })}</p>`;
      return;
    }
    if ((flyers || []).length === 0) {
      listAreaEl.innerHTML = `<p class="text-sm text-slate-400">${t('flyers.none')}</p>`;
      return;
    }
    listAreaEl.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4"></div>`;
    const gridEl = listAreaEl.querySelector('div');
    gridEl.innerHTML = flyers.map((f) => {
      const thumbUrl = f.thumbnail_path ? supabase.storage.from('flyers').getPublicUrl(f.thumbnail_path).data.publicUrl : null;
      return `
        <div class="border border-slate-200 rounded-lg overflow-hidden" data-flyer-id="${f.id}">
          <button type="button" data-action="open" class="block w-full aspect-square bg-slate-100 flex items-center justify-center overflow-hidden">
            ${thumbUrl ? `<img src="${escapeAttr(thumbUrl)}" alt="" class="w-full h-full object-contain" />` : `<span class="text-xs text-slate-400">${t('flyers.noPreview')}</span>`}
          </button>
          <div class="p-2">
            <p class="text-xs font-medium text-slate-700 truncate">${escapeHtml(f.title)}</p>
            <div class="flex items-center gap-2 mt-1">
              ${canManage ? `<button type="button" data-action="duplicate" class="text-[11px] text-indigo-600 hover:text-indigo-700">${t('flyers.duplicate')}</button>` : ''}
              ${canManage ? `<button type="button" data-action="delete" class="text-[11px] text-rose-600 hover:text-rose-700">${t('flyers.delete')}</button>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    gridEl.querySelectorAll('[data-flyer-id]').forEach((card) => {
      const id = card.dataset.flyerId;
      const flyer = flyers.find((f) => f.id === id);
      card.querySelector('[data-action="open"]').addEventListener('click', () => {
        listAreaEl.classList.add('hidden');
        openEditor({ flyerId: id });
      });
      card.querySelector('[data-action="duplicate"]')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newId = crypto.randomUUID();
        const payload = {
          id: newId,
          title: t('flyers.copyOf', { title: flyer.title }),
          category: flyer.category,
          canvas_json: flyer.canvas_json,
          canvas_width: flyer.canvas_width,
          canvas_height: flyer.canvas_height,
          thumbnail_path: flyer.thumbnail_path,
          event_id: null,
          created_by: user.id,
        };
        if (tenantId) payload.tenant_id = tenantId;
        await supabase.from('flyers').insert(payload);
        loadList();
      });
      card.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog({ message: t('flyers.confirmDelete', { title: flyer.title }), danger: true });
        if (!ok) return;
        await supabase.from('flyers').delete().eq('id', id);
        loadList();
      });
    });
  }

  if (pendingEventPrefill) {
    // A fresh, explicit action always wins over a stale draft from a
    // previous, unrelated edit session.
    clearFlyerDraft();
    const prefill = pendingEventPrefill;
    pendingEventPrefill = null;
    const tpl = FLYER_TEMPLATES.find((x) => x.category === prefill.category) || FLYER_TEMPLATES[0];
    listAreaEl.classList.add('hidden');
    openEditor({ template: tpl, sizeKey: 'instagram_square', logoUrl, eventPrefill: prefill });
  } else {
    loadList();
    const draft = loadFlyerDraft();
    if (draft) renderDraftBanner(draft);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
