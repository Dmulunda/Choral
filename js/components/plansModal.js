// Plans & pricing — real self-service billing via Stripe Checkout/Billing
// Portal (sql/saas_platform/15_stripe_billing.sql, supabase/functions/
// stripe-billing). tenants.plan_id/status are still locked against direct
// client writes (protect_tenant_privileged_columns in 09_tenant_logo.sql)
// — the stripe-webhook function is the only thing that ever actually
// changes them, via sync_tenant_stripe_subscription(), once Stripe
// confirms a checkout/cancellation. This modal only ever redirects out to
// Stripe's hosted pages and back; it never writes billing state itself.
import { t } from '../i18n.js';
import { BASE_FEATURE_KEYS, renderComparisonTable, formatPlanPrice, formatMonthlyEquivalent } from '../utils/planPresentation.js';
import { validatePromoCode, discountedPriceCents, promoErrorMessage, extractEdgeFunctionError } from '../utils/promoCode.js';

export function createPlansModal({ supabase, currentPlanId, tenantName, stripeCustomerId }) {
  let allPlans = [];
  let selectedInterval = 'monthly';
  let appliedPromo = null; // { code, discountPercent, appliesToPlanGroups } once a valid code is applied

  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4 overflow-y-auto';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-3xl p-6 my-8">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('plans.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div class="flex justify-center mb-4">
        <div class="inline-flex rounded-lg border border-slate-200 p-1">
          <button type="button" data-action="interval-monthly" class="px-3 py-1.5 rounded-md text-sm font-medium"></button>
          <button type="button" data-action="interval-yearly" class="px-3 py-1.5 rounded-md text-sm font-medium"></button>
        </div>
      </div>
      <div class="flex items-center justify-center gap-2 mb-4">
        <input type="text" data-el="promo-input" placeholder="${t('plans.promoPlaceholder')}" class="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-40" />
        <button type="button" data-action="apply-promo" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('plans.applyPromo')}</button>
      </div>
      <p data-el="promo-status" class="hidden text-sm text-center mb-3"></p>
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
  const promoInputEl = root.querySelector('[data-el="promo-input"]');
  const promoStatusEl = root.querySelector('[data-el="promo-status"]');
  const intervalMonthlyBtn = root.querySelector('[data-action="interval-monthly"]');
  const intervalYearlyBtn = root.querySelector('[data-action="interval-yearly"]');
  intervalMonthlyBtn.textContent = t('plans.billedMonthly');
  intervalYearlyBtn.textContent = t('plans.billedYearly');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="manage-billing"]')?.addEventListener('click', () => redirectTo('create_portal_session', {}));
  intervalMonthlyBtn.addEventListener('click', () => { selectedInterval = 'monthly'; render(); });
  intervalYearlyBtn.addEventListener('click', () => { selectedInterval = 'yearly'; render(); });
  root.querySelector('[data-action="apply-promo"]').addEventListener('click', applyPromo);

  async function applyPromo() {
    const code = promoInputEl.value.trim();
    if (!code) return;
    promoStatusEl.className = 'text-sm text-center mb-3 text-slate-500';
    promoStatusEl.textContent = t('common.loading');
    const result = await validatePromoCode(supabase, code);
    if (!result.valid) {
      appliedPromo = null;
      promoStatusEl.className = 'text-sm text-center mb-3 text-rose-600';
      promoStatusEl.textContent = promoErrorMessage(result.reason);
      render();
      return;
    }
    appliedPromo = { code: code.toUpperCase(), discountPercent: result.discountPercent, appliesToPlanGroups: result.appliesToPlanGroups };
    promoStatusEl.className = 'text-sm text-center mb-3 text-emerald-600';
    promoStatusEl.textContent = t('plans.promoApplied', { percent: result.discountPercent });
    render();
  }

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: plans, error } = await supabase
      .from('plans')
      .select(`
        id, key, name, price_cents, billing_interval, plan_group, stripe_price_id,
        max_extensions, max_super_admins_per_tenant, max_members, max_admins, max_global_admins, storage_gb,
        plan_features ( features ( key, name ) )
      `)
      .order('price_cents');

    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('plans.failedToLoad', { message: error.message })}</p>`;
      return;
    }

    allPlans = plans || [];
    // Default to whichever interval the tenant is actually on, so a
    // yearly subscriber doesn't land on a toggle showing their plan
    // as "not current" on the monthly view.
    const currentPlan = allPlans.find((p) => p.id === currentPlanId);
    selectedInterval = currentPlan?.billing_interval || 'monthly';
    render();
  }

  function render() {
    updateIntervalButtons();
    const plans = allPlans.filter((p) => p.billing_interval === selectedInterval);
    bodyEl.innerHTML = '';
    if (plans.length === 0) return;

    const priceCellsHtml = plans.map((plan) => {
      const promoEligible = appliedPromo && (!appliedPromo.appliesToPlanGroups || appliedPromo.appliesToPlanGroups.includes(plan.plan_group));
      const price = promoEligible
        ? `<span class="line-through text-slate-400 text-xs mr-1">${formatPlanPrice(plan.price_cents, plan.billing_interval)}</span>${formatPlanPrice(discountedPriceCents(plan.price_cents, appliedPromo.discountPercent), plan.billing_interval)}`
        : formatPlanPrice(plan.price_cents, plan.billing_interval);
      const monthlyEquivalent = plan.billing_interval === 'yearly' && plan.price_cents > 0
        ? `<div class="text-[11px] font-normal text-slate-500">${t('plans.monthlyEquivalent', { amount: formatMonthlyEquivalent(plan.price_cents) })}</div>`
        : '';
      return `<div class="font-bold text-slate-900">${price}</div>${monthlyEquivalent}`;
    });

    // Only checkout-able plans get a button -- any plan still missing a
    // real Stripe Price (not yet wired up) has no button, same as a
    // plan the tenant is already on.
    const actionCellsHtml = plans.map((plan) => (plan.id !== currentPlanId && plan.stripe_price_id
      ? `<button type="button" data-plan-key="${plan.key}" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('plans.upgrade')}</button>`
      : ''));

    bodyEl.innerHTML = `
      <div class="overflow-x-auto">
        ${renderComparisonTable({ plans, currentPlanId, priceCellsHtml, actionCellsHtml })}
      </div>
      <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-4 mb-1.5">${t('plans.featuresHeading')}</p>
      <ul class="text-sm text-slate-600 grid sm:grid-cols-2 gap-x-4 gap-y-1">
        ${BASE_FEATURE_KEYS.map((key) => `<li class="flex items-start gap-1.5"><span class="text-emerald-600">✓</span> ${t(key)}</li>`).join('')}
      </ul>
    `;

    bodyEl.querySelectorAll('[data-plan-key]').forEach((btn) => {
      btn.addEventListener('click', () => redirectTo('create_checkout_session', { plan_key: btn.dataset.planKey, promo_code: appliedPromo?.code }));
    });
  }

  function updateIntervalButtons() {
    const activeClass = 'bg-indigo-600 text-white';
    const inactiveClass = 'text-slate-600 hover:bg-slate-100';
    intervalMonthlyBtn.className = `px-3 py-1.5 rounded-md text-sm font-medium ${selectedInterval === 'monthly' ? activeClass : inactiveClass}`;
    intervalYearlyBtn.className = `px-3 py-1.5 rounded-md text-sm font-medium ${selectedInterval === 'yearly' ? activeClass : inactiveClass}`;
  }

  async function redirectTo(action, extraBody) {
    statusEl.className = 'text-sm text-slate-500 mt-3';
    statusEl.textContent = t('plans.redirecting');

    // Explicit, not inferred from headers -- a cross-origin fetch (this
    // GitHub Pages-hosted app calling the Supabase functions domain)
    // has its Origin/Referer headers reduced to origin-only by the
    // browser's default referrer policy, so the function can't recover
    // this app's subpath (e.g. /ChurchOs/app.html) from headers alone.
    const returnUrl = `${window.location.origin}${window.location.pathname}`;
    const { data: rawData, error } = await supabase.functions.invoke('stripe-billing', { body: { action, returnUrl, ...extraBody } });
    // See extractEdgeFunctionError()'s own comment -- `data` comes back
    // null on any non-2xx response (e.g. a rejected promo code), so the
    // real error/reason has to be unwrapped from error.context instead.
    const data = rawData || (error ? await extractEdgeFunctionError(error) : null);

    if (error || data?.error || !data?.url) {
      statusEl.className = 'text-sm text-rose-600 mt-3';
      // A promo-code rejection gets its own translated copy (the exact
      // wording the feature spec calls for) instead of the generic
      // "billing action failed" wrapper -- data.reason is only ever set
      // when extraBody.promo_code was sent and rejected server-side.
      statusEl.textContent = data?.reason ? promoErrorMessage(data.reason) : t('plans.billingActionFailed', { message: data?.error || error?.message || '' });
      return;
    }

    window.location.href = data.url;
  }

  function open() {
    appliedPromo = null;
    promoInputEl.value = '';
    promoStatusEl.className = 'hidden text-sm text-center mb-3';
    promoStatusEl.textContent = '';
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
