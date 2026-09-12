// Plans & pricing — read-only for now, since no billing integration
// exists yet (see sql/saas_platform/README.md "Known gaps"). Shows the
// catalog, highlights the tenant's current plan, and offers a "Request
// upgrade" action that just opens a pre-filled email — actually changing
// tenants.plan_id is deliberately locked to outside the app (see
// protect_tenant_privileged_columns in 09_tenant_logo.sql), so this can't
// pretend to be real self-service checkout without being misleading.
import { t } from '../i18n.js';

const SUPPORT_EMAIL = 'support@example.com'; // TODO: replace once billing/support contact is decided

export function createPlansModal({ supabase, currentPlanId, tenantName }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4 overflow-y-auto';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-3xl p-6 my-8">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('plans.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: plans, error } = await supabase
      .from('plans')
      .select('id, key, name, price_cents, billing_interval, plan_features ( features ( key, name ) )')
      .order('price_cents');

    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('plans.failedToLoad', { message: error.message })}</p>`;
      return;
    }

    render(plans || []);
  }

  function render(plans) {
    bodyEl.innerHTML = '';

    const grid = document.createElement('div');
    grid.className = 'grid sm:grid-cols-3 gap-4';

    for (const plan of plans) {
      const isCurrent = plan.id === currentPlanId;
      const card = document.createElement('div');
      card.className = `rounded-xl border-2 p-5 flex flex-col ${isCurrent ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`;

      const price = plan.price_cents === 0
        ? t('plans.free')
        : `$${(plan.price_cents / 100).toFixed(0)}${t('plans.perMonth')}`;

      const features = plan.plan_features.map((pf) => pf.features);

      card.innerHTML = `
        ${isCurrent ? `<p class="text-xs font-semibold text-indigo-600 mb-1">${t('plans.currentPlan')}</p>` : ''}
        <h3 class="text-lg font-bold text-slate-800">${escapeHtml(plan.name)}</h3>
        <p class="text-2xl font-bold text-slate-900 mb-3">${price}</p>
        <ul class="text-sm text-slate-600 space-y-1.5 mb-4 flex-1">
          ${features.length
            ? features.map((f) => `<li class="flex items-start gap-1.5"><span class="text-emerald-600">✓</span> ${escapeHtml(f.name)}</li>`).join('')
            : `<li class="text-slate-400">${t('plans.basicFeaturesOnly')}</li>`}
        </ul>
      `;

      if (!isCurrent) {
        const btn = document.createElement('a');
        btn.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t('plans.requestSubject', { plan: plan.name, tenant: tenantName || '' }))}`;
        btn.className = 'block text-center px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700';
        btn.textContent = t('plans.requestUpgrade');
        card.appendChild(btn);
      }

      grid.appendChild(card);
    }

    bodyEl.appendChild(grid);

    const note = document.createElement('p');
    note.className = 'text-xs text-slate-400 mt-4';
    note.textContent = t('plans.manualNote');
    bodyEl.appendChild(note);
  }

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    load();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
