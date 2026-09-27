// Plans & pricing — real self-service billing via Stripe Checkout/Billing
// Portal (sql/saas_platform/15_stripe_billing.sql, supabase/functions/
// stripe-billing). tenants.plan_id/status are still locked against direct
// client writes (protect_tenant_privileged_columns in 09_tenant_logo.sql)
// — the stripe-webhook function is the only thing that ever actually
// changes them, via sync_tenant_stripe_subscription(), once Stripe
// confirms a checkout/cancellation. This modal only ever redirects out to
// Stripe's hosted pages and back; it never writes billing state itself.
import { t } from '../i18n.js';

// Core functionality included in every tier -- not gated per plan, so
// not stored in plan_features (that table is only for things a plan
// can turn on/off, like vpd_academy).
const BASE_FEATURE_KEYS = [
  'plans.featureChoirManagement',
  'plans.featureMemberManagement',
  'plans.featureDepartmentManagement',
  'plans.featureProgramsEvents',
  'plans.featureFinancialManagement',
  'plans.featurePastoralScheduling',
  'plans.featureAttendanceTracking',
  'plans.featureTeamScheduling',
];

export function createPlansModal({ supabase, currentPlanId, tenantName, stripeCustomerId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4 overflow-y-auto';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-3xl p-6 my-8">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('plans.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
      <p data-el="status" class="text-sm text-slate-500 mt-3"></p>
      ${stripeCustomerId ? `
        <div class="border-t border-slate-200 mt-4 pt-4">
          <button type="button" data-action="manage-billing" class="text-sm text-indigo-600 hover:text-indigo-800 font-medium">${t('plans.manageBilling')}</button>
        </div>
      ` : ''}
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');
  const statusEl = root.querySelector('[data-el="status"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="manage-billing"]')?.addEventListener('click', () => redirectTo('create_portal_session', {}));

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: plans, error } = await supabase
      .from('plans')
      .select(`
        id, key, name, price_cents, billing_interval, stripe_price_id,
        max_extensions, max_super_admins_per_tenant, max_members, storage_gb,
        plan_features ( features ( key, name ) )
      `)
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
        // toFixed(0) previously rounded 59.99/99.99/199.99 to whole
        // dollars ($60/$100/$200) -- keep the exact cents, comma as the
        // decimal separator per how these prices were given (59,99).
        : `$${(plan.price_cents / 100).toFixed(2).replace('.', ',')}${t('plans.perMonth')}`;

      // 'vpd_academy' gets its own dedicated bullet below (bundled with
      // the storage figure it implies) instead of appearing twice --
      // any OTHER feature ever added to plan_features still shows here.
      const features = plan.plan_features.map((pf) => pf.features).filter((f) => f.key !== 'vpd_academy');
      const hasCourses = plan.plan_features.some((pf) => pf.features.key === 'vpd_academy');

      const limitBullets = buildLimitBullets(plan, hasCourses);
      // Base functionality every tier includes -- Max/Premium's own copy
      // literally reads "Everything in Pro/Max, plus:", so this list is
      // identical on all three cards, not gated per plan.
      const bulletList = (items) => items.map((b) => `<li class="flex items-start gap-1.5"><span class="text-emerald-600">✓</span> ${b}</li>`).join('');

      card.innerHTML = `
        ${isCurrent ? `<p class="text-xs font-semibold text-indigo-600 mb-1">${t('plans.currentPlan')}</p>` : ''}
        <h3 class="text-lg font-bold text-slate-800">${escapeHtml(plan.name)}</h3>
        <p class="text-2xl font-bold text-slate-900 mb-3">${price}</p>
        <div class="flex-1 mb-4">
          <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">${t('plans.accessHeading')}</p>
          <ul class="text-sm text-slate-600 space-y-1.5 mb-3">
            ${bulletList(limitBullets)}
            ${bulletList(features.map((f) => escapeHtml(f.name)))}
          </ul>
          <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">${t('plans.featuresHeading')}</p>
          <ul class="text-sm text-slate-600 space-y-1.5">
            ${bulletList(BASE_FEATURE_KEYS.map((key) => t(key)))}
          </ul>
        </div>
      `;

      // Only checkout-able plans get a button -- Basic has no
      // stripe_price_id (it's the "no active subscription" state, not a
      // real Stripe object), so switching to it happens by canceling an
      // existing subscription via Manage Billing, not by clicking here.
      if (!isCurrent && plan.stripe_price_id) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700';
        btn.textContent = t('plans.upgrade');
        btn.addEventListener('click', () => redirectTo('create_checkout_session', { plan_key: plan.key }));
        card.appendChild(btn);
      }

      grid.appendChild(card);
    }

    bodyEl.appendChild(grid);
  }

  async function redirectTo(action, extraBody) {
    statusEl.className = 'text-sm text-slate-500 mt-3';
    statusEl.textContent = t('plans.redirecting');

    const { data, error } = await supabase.functions.invoke('stripe-billing', { body: { action, ...extraBody } });

    if (error || data?.error || !data?.url) {
      statusEl.className = 'text-sm text-rose-600 mt-3';
      statusEl.textContent = t('plans.billingActionFailed', { message: data?.error || error?.message || '' });
      return;
    }

    window.location.href = data.url;
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

function buildLimitBullets(plan, hasCourses) {
  const bullets = [];

  if (plan.max_extensions === 0) {
    bullets.push(t('plans.limitNoExtensions'));
  } else if (plan.max_extensions === null) {
    bullets.push(t('plans.limitExtensionsUnlimited'));
  } else {
    bullets.push(t('plans.limitExtensionsUpTo', { count: plan.max_extensions }));
  }

  bullets.push(plan.max_super_admins_per_tenant === null
    ? t('plans.limitSuperAdminsUnlimited')
    : t('plans.limitSuperAdmins', { count: plan.max_super_admins_per_tenant }));

  bullets.push(plan.max_members === null
    ? t('plans.limitMembersUnlimited')
    : t('plans.limitMembers', { count: plan.max_members }));

  bullets.push(t('plans.limitProjection'));

  bullets.push(hasCourses ? t('plans.limitCoursesIncluded') : t('plans.limitCoursesNotIncluded'));

  if (hasCourses) {
    bullets.push(plan.storage_gb === null ? t('plans.limitStorageUnlimited') : t('plans.limitStorage', { count: plan.storage_gb }));
  }

  return bullets;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
