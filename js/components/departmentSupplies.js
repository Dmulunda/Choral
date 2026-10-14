// Cleaning's Supplies tab (sql/saas_platform/84) -- so volunteers can
// see what a task needs before they arrive, and leaders see what's
// running low. Grouped by an optional free-text task_label (e.g.
// "Bathroom", "Sanctuary") rather than tied to a specific scheduling
// row, keeping this simple. Only Cleaning gets this tab at all (see
// applyActiveDepartment() in app.js).
import { getEffectiveSupabase, getActiveDepartment } from '../departments.js';
import { t } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';

export async function renderDepartmentSuppliesTab() {
  const supabase = getEffectiveSupabase();
  const active = getActiveDepartment();
  const container = document.querySelector('#dept-supplies-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
  if (!active) return;

  const canManage = active.role === 'admin' || active.role === 'super_admin';
  const { data: { user } } = await supabase.auth.getUser();

  const { data: supplies, error } = await supabase
    .from('department_supplies')
    .select('*')
    .eq('department_id', active.id)
    .order('task_label', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });

  if (error) {
    container.innerHTML = `<p class="text-rose-600">${t('supplies.loadFailed', { message: error.message })}</p>`;
    return;
  }

  const groups = new Map();
  (supplies || []).forEach((s) => {
    const key = s.task_label || t('supplies.ungrouped');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  });

  container.innerHTML = `
    ${canManage ? `<button type="button" data-action="add-supply" class="mb-4 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('supplies.add')}</button>` : ''}
    <div data-el="groups" class="space-y-6"></div>
  `;

  const groupsEl = container.querySelector('[data-el="groups"]');
  if (groups.size === 0) {
    groupsEl.innerHTML = `<p class="text-sm text-slate-400">${t('supplies.none')}</p>`;
  } else {
    groupsEl.innerHTML = Array.from(groups.entries()).map(([label, items]) => `
      <div>
        <h3 class="text-sm font-semibold text-slate-700 mb-2">${escapeHtml(label)}</h3>
        <div class="border border-slate-200 rounded-lg divide-y divide-slate-100">
          ${items.map((s) => renderRow(s, canManage)).join('')}
        </div>
      </div>
    `).join('');
  }

  groupsEl.querySelectorAll('[data-supply-id]').forEach((row) => {
    const id = row.dataset.supplyId;
    const supply = (supplies || []).find((s) => s.id === id);
    row.querySelector('[data-action="decrement"]')?.addEventListener('click', () => adjustQuantity(supply, -1));
    row.querySelector('[data-action="increment"]')?.addEventListener('click', () => adjustQuantity(supply, 1));
    row.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({ message: t('supplies.confirmDelete', { name: supply.name }), danger: true });
      if (!ok) return;
      await supabase.from('department_supplies').delete().eq('id', id);
      renderDepartmentSuppliesTab();
    });
  });

  async function adjustQuantity(supply, delta) {
    const next = Math.max(0, Number(supply.quantity_on_hand) + delta);
    await supabase.from('department_supplies').update({ quantity_on_hand: next, updated_by: user.id, updated_at: new Date().toISOString() }).eq('id', supply.id);
    renderDepartmentSuppliesTab();
  }

  container.querySelector('[data-action="add-supply"]')?.addEventListener('click', () => {
    openAddForm();
  });

  function openAddForm() {
    const formHtml = `
      <div data-el="add-form" class="mb-4 border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-2">
        <input type="text" data-el="name" placeholder="${t('supplies.namePlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        <input type="text" data-el="task-label" placeholder="${t('supplies.taskLabelPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        <div class="flex gap-2">
          <input type="number" data-el="quantity" placeholder="${t('supplies.quantityPlaceholder')}" min="0" class="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
          <input type="text" data-el="unit" placeholder="${t('supplies.unitPlaceholder')}" class="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <input type="number" data-el="threshold" placeholder="${t('supplies.thresholdPlaceholder')}" min="0" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        <div class="flex gap-2">
          <button type="button" data-action="save" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('supplies.save')}</button>
          <button type="button" data-action="cancel" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('common.cancel')}</button>
        </div>
      </div>
    `;
    container.querySelector('[data-action="add-supply"]').insertAdjacentHTML('afterend', formHtml);
    const formEl = container.querySelector('[data-el="add-form"]');
    formEl.querySelector('[data-action="cancel"]').addEventListener('click', () => formEl.remove());
    formEl.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const name = formEl.querySelector('[data-el="name"]').value.trim();
      if (!name) return;
      await supabase.from('department_supplies').insert({
        department_id: active.id,
        name,
        task_label: formEl.querySelector('[data-el="task-label"]').value.trim() || null,
        quantity_on_hand: Number(formEl.querySelector('[data-el="quantity"]').value) || 0,
        unit: formEl.querySelector('[data-el="unit"]').value.trim() || null,
        low_stock_threshold: Number(formEl.querySelector('[data-el="threshold"]').value) || 0,
        updated_by: user.id,
      });
      renderDepartmentSuppliesTab();
    });
  }
}

function renderRow(s, canManage) {
  const isLow = Number(s.quantity_on_hand) <= Number(s.low_stock_threshold);
  return `
    <div class="flex items-center justify-between gap-3 px-3 py-2" data-supply-id="${s.id}">
      <div class="flex-1">
        <p class="text-sm font-medium text-slate-700">${escapeHtml(s.name)}</p>
        <p class="text-xs text-slate-400">${escapeHtml(s.unit || '')}</p>
      </div>
      <div class="flex items-center gap-2">
        ${canManage ? `<button type="button" data-action="decrement" class="w-6 h-6 rounded bg-slate-100 text-slate-600 hover:bg-slate-200">−</button>` : ''}
        <span class="text-sm font-semibold ${isLow ? 'text-rose-600' : 'text-slate-700'} w-10 text-center">${s.quantity_on_hand}</span>
        ${canManage ? `<button type="button" data-action="increment" class="w-6 h-6 rounded bg-slate-100 text-slate-600 hover:bg-slate-200">+</button>` : ''}
        ${isLow ? `<span class="text-xs font-medium text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">${t('supplies.lowStock')}</span>` : ''}
        ${canManage ? `<button type="button" data-action="delete" class="text-xs text-rose-600 hover:text-rose-700 ml-2">${t('supplies.delete')}</button>` : ''}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
