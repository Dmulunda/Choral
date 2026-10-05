// Plan picker shown right after a brand-new church signs up
// (authScreen.js) -- same 3-card grid and Monthly/Yearly toggle as
// plansModal.js (the existing in-app "Plans & Pricing", reused via
// the same js/utils/planPresentation.js helpers so the two can never
// describe a plan differently), but simplified for a first-time
// choice: no "current plan" badge, no Manage Billing section, every
// plan gets a button. Picking one redirects to the exact same
// stripe-billing create_checkout_session the in-app Upgrade button
// uses -- the Edge Function aligns the free trial to the tenant's own
// trial_ends_at either way, so there's nothing signup-specific to
// special-case here.
//
// Not a hard gate: Stripe Checkout itself is always cancellable, and
// this modal has its own "skip for now" out, so a brand-new signup is
// never stuck here if something goes wrong on Stripe's end -- onSkip
// just closes the modal and lets authScreen.js carry on into the app
// exactly like today's cardless trial.
import { t } from '../i18n.js';
import { BASE_FEATURE_KEYS, buildLimitBullets, formatPlanPrice, formatMonthlyEquivalent } from '../utils/planPresentation.js';

export function createPlanPickerModal({ supabase, onSkip }) {
  let allPlans = [];
  let selectedInterval = 'monthly';

  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4 overflow-y-auto';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-3xl p-6 my-8">
      <h2 class="text-xl font-bold text-center">${t('planPicker.title')}</h2>
      <p class="text-sm text-slate-500 text-center mt-1 mb-4">${t('planPicker.intro')}</p>
      <div class="flex justify-center mb-4">
        <div class="inline-flex rounded-lg border border-slate-200 p-1">
          <button type="button" data-action="interval-monthly" class="px-3 py-1.5 rounded-md text-sm font-medium"></button>
          <button type="button" data-action="interval-yearly" class="px-3 py-1.5 rounded-md text-sm font-medium"></button>
        </div>
      </div>
      <div data-el="body"></div>
      <p data-el="status" class="text-sm text-slate-500 mt-3"></p>
      <div class="text-center mt-4 pt-4 border-t border-slate-200">
        <button type="button" data-action="skip" class="text-sm text-slate-500 hover:text-slate-700 underline">${t('planPicker.skipForNow')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const intervalMonthlyBtn = root.querySelector('[data-action="interval-monthly"]');
  const intervalYearlyBtn = root.querySelector('[data-action="interval-yearly"]');
  intervalMonthlyBtn.textContent = t('plans.billedMonthly');
  intervalYearlyBtn.textContent = t('plans.billedYearly');
  intervalMonthlyBtn.addEventListener('click', () => { selectedInterval = 'monthly'; render(); });
  intervalYearlyBtn.addEventListener('click', () => { selectedInterval = 'yearly'; render(); });
  root.querySelector('[data-action="skip"]').addEventListener('click', () => { close(); onSkip?.(); });

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: plans, error } = await supabase
      .from('plans')
      .select(`
        id, key, name, price_cents, billing_interval, plan_group, stripe_price_id,
        max_extensions, max_super_admins_per_tenant, max_members, storage_gb,
        plan_features ( features ( key, name ) )
      `)
      .order('price_cents');

    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('plans.failedToLoad', { message: error.message })}</p>`;
      return;
    }

    allPlans = plans || [];
    render();
  }

  function render() {
    updateIntervalButtons();
    const plans = allPlans.filter((p) => p.billing_interval === selectedInterval);
    bodyEl.innerHTML = '';

    const grid = document.createElement('div');
    grid.className = 'grid sm:grid-cols-3 gap-4';

    for (const plan of plans) {
      const card = document.createElement('div');
      card.className = 'rounded-xl border-2 border-slate-200 p-5 flex flex-col';

      const price = formatPlanPrice(plan.price_cents, plan.billing_interval);
      const monthlyEquivalent = plan.billing_interval === 'yearly' && plan.price_cents > 0
        ? `<p class="text-xs text-slate-500 -mt-2 mb-3">${t('plans.monthlyEquivalent', { amount: formatMonthlyEquivalent(plan.price_cents) })}</p>`
        : '';

      const features = plan.plan_features.map((pf) => pf.features).filter((f) => f.key !== 'vpd_academy');
      const hasCourses = plan.plan_features.some((pf) => pf.features.key === 'vpd_academy');
      const limitBullets = buildLimitBullets(plan, hasCourses);
      const bulletList = (items) => items.map((b) => `<li class="flex items-start gap-1.5"><span class="text-emerald-600">✓</span> ${b}</li>`).join('');

      card.innerHTML = `
        <h3 class="text-lg font-bold text-slate-800">${escapeHtml(plan.name)}</h3>
        <p class="text-2xl font-bold text-slate-900 ${monthlyEquivalent ? 'mb-0' : 'mb-3'}">${price}</p>
        ${monthlyEquivalent}
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

      if (plan.stripe_price_id) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700';
        btn.textContent = t('planPicker.selectPlan');
        btn.addEventListener('click', () => startCheckout(plan.key));
        card.appendChild(btn);
      }

      grid.appendChild(card);
    }

    bodyEl.appendChild(grid);
  }

  function updateIntervalButtons() {
    const activeClass = 'bg-indigo-600 text-white';
    const inactiveClass = 'text-slate-600 hover:bg-slate-100';
    intervalMonthlyBtn.className = `px-3 py-1.5 rounded-md text-sm font-medium ${selectedInterval === 'monthly' ? activeClass : inactiveClass}`;
    intervalYearlyBtn.className = `px-3 py-1.5 rounded-md text-sm font-medium ${selectedInterval === 'yearly' ? activeClass : inactiveClass}`;
  }

  async function startCheckout(planKey) {
    statusEl.className = 'text-sm text-slate-500 mt-3';
    statusEl.textContent = t('plans.redirecting');

    const returnUrl = `${window.location.origin}${window.location.pathname}`;
    const { data, error } = await supabase.functions.invoke('stripe-billing', {
      body: { action: 'create_checkout_session', plan_key: planKey, returnUrl },
    });

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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
