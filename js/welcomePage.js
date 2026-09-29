// Entry point for index.html — the public marketing/landing page,
// anonymous visitors only (no auth gate). Deliberately outside the
// normal app.js/app.html shell, same pattern as publicBooking.js.
// Pricing is fetched live from the plans table (anon-readable per
// 46_public_pricing_read.sql) so this page can never silently drift
// from what plansModal.js shows a signed-in Super Admin — one plan
// catalog, two places it's rendered.
import { supabase } from './supabaseClient.js';
import { buildLimitBullets, formatPlanPrice } from './utils/planPresentation.js';
import { getLang, setLang, onLangChange, loadLabelOverrides, applyStaticTranslations, departmentLabel, t } from './i18n.js';
import { DEPARTMENT_KEYS } from './departments.js';

document.querySelector('[data-el="year"]').textContent = new Date().getFullYear();
document.documentElement.lang = getLang();

const langSelect = document.querySelector('#welcome-lang-select');
langSelect.value = getLang();
langSelect.addEventListener('change', () => setLang(langSelect.value));
onLangChange(() => {
  langSelect.value = getLang();
  applyStaticTranslations();
  renderFeatures();
  loadPricing();
});

init();

async function init() {
  // Best-effort, same as publicBooking.js -- menu_labels has never been
  // read by an anonymous visitor before now; the built-in TRANSLATIONS
  // dictionary is a perfectly fine default if RLS or anything else
  // about that turns out unfriendly to the anon role.
  try {
    await loadLabelOverrides();
  } catch { /* fall through to built-in translations */ }
  applyStaticTranslations();

  renderFeatures();
  loadPricing();
  wireContactForm();
}

// Specific to what's actually built (see sql/saas_platform/*.sql and
// js/components/*.js), not a generic "member management, event
// planning, reports" list every church-software site has -- each
// title/desc names the real mechanism, not a category label. The
// "ministries" card pulls the live DEPARTMENT_KEYS + departmentLabel()
// the app itself uses (not a hand-copied list), so it can't drift out
// of sync with the real seeded department names, in either language.
function buildFeatures() {
  const deptList = DEPARTMENT_KEYS.map((key) => departmentLabel(key)).join(', ');
  return [
    { title: t('welcome.featureDeptsTitle'), desc: t('welcome.featureDeptsDesc', { list: deptList }) },
    { title: t('welcome.featureSchedulingTitle'), desc: t('welcome.featureSchedulingDesc') },
    { title: t('welcome.featureExtensionsTitle'), desc: t('welcome.featureExtensionsDesc') },
    { title: t('welcome.featureTaxTitle'), desc: t('welcome.featureTaxDesc') },
    { title: t('welcome.featureBookingTitle'), desc: t('welcome.featureBookingDesc') },
    { title: t('welcome.featureServiceProgramTitle'), desc: t('welcome.featureServiceProgramDesc') },
    { title: t('welcome.featureHeadcountTitle'), desc: t('welcome.featureHeadcountDesc') },
    { title: t('welcome.featureBudgetTitle'), desc: t('welcome.featureBudgetDesc') },
    { title: t('welcome.featureIdCardTitle'), desc: t('welcome.featureIdCardDesc') },
  ];
}

function renderFeatures() {
  const grid = document.querySelector('[data-el="features-grid"]');
  grid.innerHTML = buildFeatures().map(({ title, desc }) => `
    <div class="bg-white rounded-xl border border-slate-200 p-5">
      <p class="text-sm font-semibold text-[#0B1F3A] mb-1.5">${escapeHtml(title)}</p>
      <p class="text-sm text-slate-600 leading-relaxed">${escapeHtml(desc)}</p>
    </div>
  `).join('');
}

async function loadPricing() {
  const grid = document.querySelector('[data-el="pricing-grid"]');
  grid.innerHTML = `<p class="col-span-3 text-center text-slate-400">${escapeHtml(t('welcome.loadingPlans'))}</p>`;

  const { data: plans, error } = await supabase
    .from('plans')
    .select(`
      id, key, name, price_cents,
      max_extensions, max_super_admins_per_tenant, max_members, storage_gb,
      plan_features ( features ( key, name ) )
    `)
    .order('price_cents');

  if (error || !plans) {
    grid.innerHTML = `<p class="col-span-3 text-center text-rose-600">${escapeHtml(t('welcome.pricingFailed'))}</p>`;
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
        <a href="app.html?mode=new-church" class="text-center px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${escapeHtml(t('welcome.getStarted'))}
        </a>
      </div>
    `;
  }).join('');
}

const TOPIC_KEYS = { demo: 'welcome.topicDemo', general: 'welcome.topicGeneral', support: 'welcome.topicSupport' };

// No backend for the contact form -- opens the visitor's own email
// client, pre-addressed and pre-filled, straight to info@aliviatech.ca.
function wireContactForm() {
  const form = document.querySelector('[data-el="contact-form"]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const topic = t(TOPIC_KEYS[form.elements.topic.value] || TOPIC_KEYS.general);
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
