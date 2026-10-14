// Platform Owner panel -- reached two ways: its own standalone page
// (tools-menu "Owner" entry) and as a tab inside Site Admin, for
// whoever holds both roles (see js/siteAdminPage.js). Visible only to
// accounts in public.platform_owner (see js/platformOwner.js, sql/083).
// Lets the owner manually set any tenant's plan without Stripe -- to
// comp a partner church for free, or to preview Basic/Pro/Premium on
// their own account by applying a plan to themselves the same way.
import { t } from './i18n.js';
import { supabase } from './supabaseClient.js';
import { getTenantId } from './tenant.js';
import { loadMyEntitlements } from './entitlements.js';
import { renderEntitlementGates } from './app.js';

const PLAN_KEYS = ['basic', 'pro', 'premium'];

// container defaults to the standalone page's own element -- Site
// Admin passes its own tab panel element explicitly instead.
export async function renderOwnerTab(container = document.querySelector('#owner-content')) {
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: tenants, error } = await supabase.rpc('owner_list_tenants');
  if (error) {
    container.innerHTML = `<p class="text-rose-600">${t('owner.loadFailed', { message: error.message })}</p>`;
    return;
  }

  const myTenantId = getTenantId?.() || null;

  container.innerHTML = `
    <div class="overflow-x-auto border border-slate-200 rounded-lg">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
          <tr>
            <th class="text-left px-3 py-2">${t('owner.colChurch')}</th>
            <th class="text-left px-3 py-2">${t('owner.colStatus')}</th>
            <th class="text-left px-3 py-2">${t('owner.colPlan')}</th>
            <th class="text-left px-3 py-2">${t('owner.colPaying')}</th>
            <th class="text-left px-3 py-2">${t('owner.colOverride')}</th>
            <th class="text-left px-3 py-2"></th>
          </tr>
        </thead>
        <tbody data-el="rows"></tbody>
      </table>
    </div>
  `;

  const rowsEl = container.querySelector('[data-el="rows"]');
  rowsEl.innerHTML = (tenants || []).map((tn) => {
    const isMine = tn.id === myTenantId;
    const isOverridden = tn.plan_override_source === 'owner';
    return `
      <tr class="border-t border-slate-100" data-tenant-id="${tn.id}">
        <td class="px-3 py-2">
          ${escapeHtml(tn.name)}
          ${isMine ? `<span class="ml-1 text-xs text-indigo-600">${t('owner.thisIsYourChurch')}</span>` : ''}
        </td>
        <td class="px-3 py-2 text-slate-500">${escapeHtml(tn.status || '')}</td>
        <td class="px-3 py-2">
          <select data-el="plan-select" class="border border-slate-300 rounded-lg px-2 py-1 text-xs">
            ${PLAN_KEYS.map((key) => `<option value="${key}" ${tn.plan_key === key ? 'selected' : ''}>${escapeHtml(key)}</option>`).join('')}
          </select>
        </td>
        <td class="px-3 py-2">${tn.is_paying ? `<span class="text-emerald-600">${t('owner.paying')}</span>` : `<span class="text-slate-400">${t('owner.notPaying')}</span>`}</td>
        <td class="px-3 py-2">${isOverridden ? `<span class="text-amber-600">${t('owner.overriddenByOwner')}</span>` : ''}</td>
        <td class="px-3 py-2 whitespace-nowrap">
          <button type="button" data-action="apply-plan" class="text-xs text-indigo-600 hover:text-indigo-700 font-medium mr-2">${t('owner.applyPlan')}</button>
          ${isOverridden ? `<button type="button" data-action="clear-override" class="text-xs text-slate-500 hover:text-slate-700">${t('owner.clearOverride')}</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  rowsEl.querySelectorAll('[data-tenant-id]').forEach((row) => {
    const tenantId = row.dataset.tenantId;
    row.querySelector('[data-action="apply-plan"]').addEventListener('click', async () => {
      const planKey = row.querySelector('[data-el="plan-select"]').value;
      const { error: applyError } = await supabase.rpc('owner_set_tenant_plan', { p_tenant_id: tenantId, p_plan_key: planKey });
      if (applyError) {
        window.alert(t('owner.applyFailed', { message: applyError.message }));
        return;
      }
      if (tenantId === myTenantId) {
        await loadMyEntitlements();
        renderEntitlementGates();
      }
      renderOwnerTab(container);
    });
    row.querySelector('[data-action="clear-override"]')?.addEventListener('click', async () => {
      const { error: clearError } = await supabase.rpc('owner_clear_tenant_override', { p_tenant_id: tenantId });
      if (clearError) {
        window.alert(t('owner.clearFailed', { message: clearError.message }));
        return;
      }
      renderOwnerTab(container);
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
