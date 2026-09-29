// Entry point for welcome.html — the public marketing/landing page,
// anonymous visitors only (no auth gate). Deliberately outside the
// normal app.js/index.html shell, same pattern as publicBooking.js.
// Pricing is fetched live from the plans table (anon-readable per
// 46_public_pricing_read.sql) so this page can never silently drift
// from what plansModal.js shows a signed-in Super Admin — one plan
// catalog, two places it's rendered.
import { supabase } from './supabaseClient.js';
import { buildLimitBullets, formatPlanPrice } from './utils/planPresentation.js';

document.querySelector('[data-el="year"]').textContent = new Date().getFullYear();

renderFeatures();
loadPricing();
wireContactForm();

// Specific to what's actually built (see sql/saas_platform/*.sql and
// js/components/*.js), not a generic "member management, event
// planning, reports" list every church-software site has -- each of
// these names the real mechanism, not a category label.
const FEATURES = [
  {
    title: '14 ministries, seeded on day one',
    desc: 'Choir, Ushers, Media & Tech, Sunday School, Preaching & Moderation, Security, Finance, Intercession, Evangelism, Welcoming & Socialisation, Cleaning, Interpreting, Social, and Grand Jeune & Couple — already there when a church signs up, not a blank slate to configure.',
  },
  {
    title: 'Scheduling that catches conflicts',
    desc: "Assigning someone who's already on another department's roster that day shows it right in the picker. Reporting an absence after being scheduled asks you to confirm, and notifies the department head automatically. Someone who's already said they can't make it can't be scheduled over it.",
  },
  {
    title: 'Church Extensions',
    desc: 'One denomination, several physical locations, each with its own address and admins — with a Global Super Admin, General Overseer, and General Secretary who have real access across every extension, not a read-only summary.',
  },
  {
    title: 'Tax Receipts',
    desc: 'Track donations through the year and issue official, numbered year-end tax receipts members can use when filing.',
  },
  {
    title: 'Pastor Meeting Booking',
    desc: 'A public link where anyone can book a meeting with a pastor against real availability the church sets — no back-and-forth over email.',
  },
  {
    title: 'Service Program',
    desc: "One roster for a given date, aggregated across every department — who's preaching, who's on slides, who's on the door — instead of checking five separate schedules.",
  },
  {
    title: 'Headcount Tally',
    desc: 'A tap counter for Sunday attendance, shareable by QR code so more than one person can count at once.',
  },
  {
    title: 'Budget & Finance',
    desc: 'Fund requests, reimbursements, and department-level budgets with review notes and PDF export.',
  },
  {
    title: 'Member ID cards & guest follow-up',
    desc: "Photo ID cards with department badges (and the extension's name, for a denomination with more than one). A guest follow-up hub that tracks a first-time visitor from check-in through assignment to a department.",
  },
];

function renderFeatures() {
  const grid = document.querySelector('[data-el="features-grid"]');
  grid.innerHTML = FEATURES.map(({ title, desc }) => `
    <div class="bg-white rounded-xl border border-slate-200 p-5">
      <p class="text-sm font-semibold text-[#0B1F3A] mb-1.5">${escapeHtml(title)}</p>
      <p class="text-sm text-slate-600 leading-relaxed">${escapeHtml(desc)}</p>
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
