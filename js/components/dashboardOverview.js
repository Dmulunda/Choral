// Dashboard content: the full roster grouped by voice part, plus every
// service scheduled this week (Monday through Sunday) — who's approved,
// who's actually programmed, and the song list, if one exists yet.
import { formatDateLocal } from '../utils/date.js';
import { t, voicePartLabel } from '../i18n.js';

const VOICE_PART_ORDER = ['Leader', 'Soprano', 'Alto', 'Tenor', 'Pianist', 'Bassist', 'Guitarist', 'Drummer'];

export function renderDashboard(container, { supabase }) {
  container.innerHTML = `
    <div class="grid lg:grid-cols-2 gap-6">
      <div class="bg-white rounded-xl shadow p-4 sm:p-6">
        <h2 class="text-lg font-semibold mb-4">${t('dashboard.roster')}</h2>
        <div data-el="roster" class="text-sm text-slate-500">${t('common.loading')}</div>
      </div>
      <div class="bg-white rounded-xl shadow p-4 sm:p-6">
        <h2 class="text-lg font-semibold mb-4">${t('dashboard.thisWeek')}</h2>
        <div data-el="week-services" class="text-sm text-slate-500 space-y-4">${t('common.loading')}</div>
      </div>
    </div>
  `;

  loadRoster(container.querySelector('[data-el="roster"]'), supabase);
  loadWeekServices(container.querySelector('[data-el="week-services"]'), supabase);
}

// Monday-through-Sunday range containing `date`. getDay() is 0=Sun..6=Sat,
// so Sunday needs to look back 6 days to reach that same week's Monday.
function getWeekRange(date) {
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday, sunday };
}

async function loadRoster(el, supabase) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, voice_parts')
    .order('full_name');

  if (error) {
    el.innerHTML = `<p class="text-rose-600">${t('dashboard.rosterFailed', { message: error.message })}</p>`;
    return;
  }

  if (data.length === 0) {
    el.innerHTML = `<p>${t('dashboard.noMembers')}</p>`;
    return;
  }

  // A member covering multiple parts (e.g. Alto + Soprano) is listed
  // under each part they cover.
  const byPart = new Map(VOICE_PART_ORDER.map((part) => [part, []]));
  const unassigned = [];
  data.forEach((member) => {
    const parts = (member.voice_parts || []).filter((part) => byPart.has(part));
    if (parts.length > 0) parts.forEach((part) => byPart.get(part).push(member));
    else unassigned.push(member);
  });

  const groups = VOICE_PART_ORDER
    .map((part) => [voicePartLabel(part), byPart.get(part)])
    .concat(unassigned.length > 0 ? [[t('dashboard.unassigned'), unassigned]] : [])
    .filter(([, members]) => members.length > 0);

  el.innerHTML = groups.map(([label, members]) => `
    <div class="mb-3 last:mb-0">
      <div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">${escapeHtml(label)} (${members.length})</div>
      <div class="flex flex-wrap gap-1.5">
        ${members.map((m) => `<span class="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-sm">${escapeHtml(m.full_name)}</span>`).join('')}
      </div>
    </div>
  `).join('');
}

async function loadWeekServices(el, supabase) {
  const { monday, sunday } = getWeekRange(new Date());
  const mondayStr = formatDateLocal(monday);
  const sundayStr = formatDateLocal(sunday);

  const { data: plans, error: plansError } = await supabase
    .from('service_plans')
    .select('id, date, title')
    .gte('date', mondayStr)
    .lte('date', sundayStr)
    .order('date', { ascending: true });

  if (plansError) {
    el.innerHTML = `<p class="text-rose-600">${t('dashboard.weekServicesFailed', { message: plansError.message })}</p>`;
    return;
  }

  if (plans.length === 0) {
    el.innerHTML = `<p>${t('dashboard.noServicesThisWeek')}</p>`;
    return;
  }

  const cards = await Promise.all(plans.map((plan) => buildServiceCardHtml(plan, supabase)));
  el.innerHTML = cards.join('');
}

async function buildServiceCardHtml(plan, supabase) {
  const [{ data: assigned }, { data: approvedRsvps }, { data: planSongs }] = await Promise.all([
    supabase.from('service_plan_singers').select('profiles ( full_name )').eq('service_plan_id', plan.id),
    supabase.from('service_rsvps').select('profiles ( full_name )').eq('service_plan_id', plan.id).eq('status', 'approved'),
    supabase.from('service_plan_songs').select('category, note, songs ( title )').eq('service_plan_id', plan.id).order('position'),
  ]);

  const assignedNames = (assigned || []).map((row) => row.profiles?.full_name).filter(Boolean);
  const availableNames = (approvedRsvps || []).map((row) => row.profiles?.full_name).filter(Boolean);
  const praiseSongs = (planSongs || []).filter((row) => row.category === 'praise' && row.songs).map((row) => ({ title: row.songs.title, note: row.note }));
  const worshipSongs = (planSongs || []).filter((row) => row.category === 'worship' && row.songs).map((row) => ({ title: row.songs.title, note: row.note }));

  return `
    <div class="border border-slate-200 rounded-lg p-3">
      <div class="mb-3">
        <div class="text-lg font-bold text-slate-800">${escapeHtml(plan.title || t('dashboard.untitledService'))}</div>
        <div class="text-sm text-slate-500">${escapeHtml(plan.date)}</div>
      </div>

      <div class="grid sm:grid-cols-2 gap-4 mb-3">
        ${renderNameGroup(t('dashboard.available'), availableNames, 'bg-emerald-50 text-emerald-700')}
        ${renderNameGroup(t('dashboard.programmed'), assignedNames, 'bg-indigo-50 text-indigo-700')}
      </div>

      <div class="grid sm:grid-cols-2 gap-4">
        ${renderSongGroup(t('requests.praiseSongs'), praiseSongs)}
        ${renderSongGroup(t('requests.worshipSongs'), worshipSongs)}
      </div>
    </div>
  `;
}

function renderSongGroup(label, songs) {
  return `
    <div>
      <div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">${escapeHtml(label)}</div>
      ${songs.length > 0
        ? `<ul class="list-disc list-inside text-sm text-slate-700 space-y-0.5">${songs.map(({ title, note }) => `
            <li>${escapeHtml(title)}${note ? `<span class="text-slate-400"> — ${escapeHtml(note)}</span>` : ''}</li>
          `).join('')}</ul>`
        : `<p class="text-sm text-slate-400">${t('dashboard.noSongsYet')}</p>`
      }
    </div>
  `;
}

function renderNameGroup(label, names, badgeClass) {
  return `
    <div>
      <div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">${escapeHtml(label)} (${names.length})</div>
      ${names.length > 0
        ? `<div class="flex flex-wrap gap-1.5">${names.map((name) => `<span class="px-2 py-1 rounded-lg ${badgeClass} text-sm">${escapeHtml(name)}</span>`).join('')}</div>`
        : `<p class="text-sm text-slate-400">${t('dashboard.noneYet')}</p>`
      }
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
