// Media & Tech's Equipment tab (sql/saas_platform/84) -- inventory of
// cameras/mics/cables/projectors etc: storage location, condition, and
// a simple check-out/check-in flow for who currently has what and when
// it's due back. Only Media & Tech gets this tab (see
// applyActiveDepartment() in app.js).
import { getEffectiveSupabase, getActiveDepartment } from '../departments.js';
import { t } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';

const CONDITIONS = ['working', 'needs_repair', 'missing'];
const CONDITION_CLASSES = {
  working: 'bg-emerald-50 text-emerald-700',
  needs_repair: 'bg-amber-50 text-amber-700',
  missing: 'bg-rose-50 text-rose-700',
};

export async function renderEquipmentInventoryTab() {
  const supabase = getEffectiveSupabase();
  const active = getActiveDepartment();
  const container = document.querySelector('#dept-equipment-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
  if (!active) return;

  const canManage = active.role === 'admin' || active.role === 'super_admin';
  const { data: { user } } = await supabase.auth.getUser();

  const { data: items, error } = await supabase
    .from('equipment_items')
    .select('*, borrower:profiles!borrowed_by ( full_name )')
    .eq('department_id', active.id)
    .order('name');

  if (error) {
    container.innerHTML = `<p class="text-rose-600">${t('equipment.loadFailed', { message: error.message })}</p>`;
    return;
  }

  container.innerHTML = `
    ${canManage ? `<button type="button" data-action="add-item" class="mb-4 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('equipment.add')}</button>` : ''}
    <div data-el="list" class="space-y-2"></div>
  `;

  const listEl = container.querySelector('[data-el="list"]');
  if ((items || []).length === 0) {
    listEl.innerHTML = `<p class="text-sm text-slate-400">${t('equipment.none')}</p>`;
  } else {
    const today = new Date().toISOString().slice(0, 10);
    listEl.innerHTML = items.map((item) => {
      const isOverdue = item.borrowed_by && item.due_back_at && item.due_back_at < today;
      return `
        <div class="border border-slate-200 rounded-lg p-3" data-item-id="${item.id}">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-medium text-slate-700">${escapeHtml(item.name)} ${item.category ? `<span class="text-xs text-slate-400">(${escapeHtml(item.category)})</span>` : ''}</p>
              <p class="text-xs text-slate-500">${item.storage_location ? escapeHtml(item.storage_location) : ''}</p>
            </div>
            <span class="text-xs font-medium px-2 py-0.5 rounded-full ${CONDITION_CLASSES[item.condition] || ''}">${t(`equipment.condition.${item.condition}`)}</span>
          </div>
          ${item.borrowed_by ? `
            <p class="text-xs mt-1 ${isOverdue ? 'text-rose-600 font-medium' : 'text-slate-500'}">
              ${t('equipment.borrowedBy', { name: item.borrower?.full_name || '?' })}
              ${item.due_back_at ? ' — ' + t('equipment.dueBack', { date: item.due_back_at }) : ''}
              ${isOverdue ? ` (${t('equipment.overdue')})` : ''}
            </p>
          ` : ''}
          ${canManage ? `
            <div class="flex items-center gap-2 mt-2">
              <select data-el="condition" class="border border-slate-300 rounded-lg px-2 py-1 text-xs">
                ${CONDITIONS.map((c) => `<option value="${c}" ${item.condition === c ? 'selected' : ''}>${t(`equipment.condition.${c}`)}</option>`).join('')}
              </select>
              ${item.borrowed_by
                ? `<button type="button" data-action="check-in" class="text-xs text-indigo-600 hover:text-indigo-700">${t('equipment.checkIn')}</button>`
                : `<button type="button" data-action="check-out" class="text-xs text-indigo-600 hover:text-indigo-700">${t('equipment.checkOut')}</button>`}
              <button type="button" data-action="delete" class="text-xs text-rose-600 hover:text-rose-700 ml-auto">${t('equipment.delete')}</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  listEl.querySelectorAll('[data-item-id]').forEach((card) => {
    const id = card.dataset.itemId;
    const item = items.find((i) => i.id === id);
    card.querySelector('[data-el="condition"]')?.addEventListener('change', async (e) => {
      await supabase.from('equipment_items').update({ condition: e.target.value, updated_at: new Date().toISOString() }).eq('id', id);
    });
    card.querySelector('[data-action="check-out"]')?.addEventListener('click', async () => {
      const dueBack = window.prompt(t('equipment.dueBackPrompt'));
      await supabase.from('equipment_items').update({
        borrowed_by: user.id, borrowed_at: new Date().toISOString(),
        due_back_at: dueBack || null, updated_at: new Date().toISOString(),
      }).eq('id', id);
      renderEquipmentInventoryTab();
    });
    card.querySelector('[data-action="check-in"]')?.addEventListener('click', async () => {
      await supabase.from('equipment_items').update({
        borrowed_by: null, borrowed_at: null, due_back_at: null, updated_at: new Date().toISOString(),
      }).eq('id', id);
      renderEquipmentInventoryTab();
    });
    card.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({ message: t('equipment.confirmDelete', { name: item.name }), danger: true });
      if (!ok) return;
      await supabase.from('equipment_items').delete().eq('id', id);
      renderEquipmentInventoryTab();
    });
  });

  container.querySelector('[data-action="add-item"]')?.addEventListener('click', () => {
    const formHtml = `
      <div data-el="add-form" class="mb-4 border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-2">
        <input type="text" data-el="name" placeholder="${t('equipment.namePlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        <input type="text" data-el="category" placeholder="${t('equipment.categoryPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        <input type="text" data-el="location" placeholder="${t('equipment.locationPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        <div class="flex gap-2">
          <button type="button" data-action="save" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('equipment.save')}</button>
          <button type="button" data-action="cancel" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('common.cancel')}</button>
        </div>
      </div>
    `;
    container.querySelector('[data-action="add-item"]').insertAdjacentHTML('afterend', formHtml);
    const formEl = container.querySelector('[data-el="add-form"]');
    formEl.querySelector('[data-action="cancel"]').addEventListener('click', () => formEl.remove());
    formEl.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const name = formEl.querySelector('[data-el="name"]').value.trim();
      if (!name) return;
      await supabase.from('equipment_items').insert({
        department_id: active.id,
        name,
        category: formEl.querySelector('[data-el="category"]').value.trim() || null,
        storage_location: formEl.querySelector('[data-el="location"]').value.trim() || null,
      });
      renderEquipmentInventoryTab();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
