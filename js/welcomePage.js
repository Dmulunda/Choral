// Entry point for welcome.html — the public marketing/landing page,
// anonymous visitors only (no auth gate). Deliberately outside the
// normal app.js/index.html shell, same pattern as publicBooking.js.
// Pricing is fetched live from the plans table (anon-readable per
// 46_public_pricing_read.sql) so this page can never silently drift
// from what plansModal.js shows a signed-in Super Admin — one plan
// catalog, two places it's rendered.
import { supabase } from './supabaseClient.js';
import { BASE_FEATURE_KEYS, buildLimitBullets, formatPlanPrice } from './utils/planPresentation.js';
import { t } from './i18n.js';

document.querySelector('[data-el="year"]').textContent = new Date().getFullYear();

renderFeatures();
loadPricing();
wireContactForm();

function renderFeatures() {
  const grid = document.querySelector('[data-el="features-grid"]');
  grid.innerHTML = BASE_FEATURE_KEYS.map((key) => `
    <div class="bg-white rounded-xl border border-slate-200 p-4">
      <p class="text-sm font-medium text-slate-700">${escapeHtml(t(key))}</p>
    </div>
  `).join('');
}

async function loadPricing() {
  const grid = document.querySelector('[data-el="pricing-grid"]');

  const { data: plans, error } = await supabase
    .from('plans')
    .select(`
      id, key, name, price_cents,
      max_extensions, max_super_admins_per_tenant, max_members, storage_gb,
      plan_features ( features ( key, name ) )
    `)
    .order('price_cents');

  if (error || !plans) {
    grid.innerHTML = `<p class="col-span-3 text-center text-rose-600">Couldn't load pricing right now — please try again shortly, or contact us below.</p>`;
    return;
  }

  grid.innerHTML = plans.map((plan) => {
    const hasCourses = plan.plan_features.some((pf) => pf.features.key === 'vpd_academy');
    const bullets = buildLimitBullets(plan, hasCourses);
    return `
      <div class="rounded-xl border-2 border-slate-200 p-6 flex flex-col">
        <h3 class="text-lg font-bold text-slate-800">${escapeHtml(plan.name)}</h3>
        <p class="text-3xl font-bold text-slate-900 mt-1 mb-4">${formatPlanPrice(plan.price_cents)}</p>
        <ul class="text-sm text-slate-600 space-y-1.5 mb-6 flex-1">
          ${bullets.map((b) => `<li class="flex items-start gap-1.5"><span class="text-emerald-600">✓</span> ${b}</li>`).join('')}
        </ul>
        <a href="index.html?mode=new-church" class="text-center px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          Get Started
        </a>
      </div>
    `;
  }).join('');
}

// No backend for the contact form -- opens the visitor's own email
// client, pre-addressed and pre-filled, straight to info@aliviatech.ca.
function wireContactForm() {
  const form = document.querySelector('[data-el="contact-form"]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const topic = form.elements.topic.value;
    const name = form.elements.name.value.trim();
    const email = form.elements.email.value.trim();
    const church = form.elements.church.value.trim();
    const message = form.elements.message.value.trim();

    const subject = `ChurchOS — ${topic}${church ? ` — ${church}` : ''}`;
    const body = [
      `Name: ${name}`,
      `Email: ${email}`,
      church ? `Church: ${church}` : null,
      '',
      message,
    ].filter((line) => line !== null).join('\n');

    window.location.href = `mailto:info@aliviatech.ca?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
