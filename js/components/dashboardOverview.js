// Dashboard content: the full roster grouped by voice part, plus a
// snapshot of the next upcoming service (who's approved, who's actually
// programmed, and its song list, if one exists yet).
import { formatDateLocal } from '../utils/date.js';
import { t, voicePartLabel } from '../i18n.js';

const VOICE_PART_ORDER = ['Leader', 'Soprano', 'Alto', 'Tenor', 'Instrumentalist'];

export function renderDashboard(container, { supabase }) {
  container.innerHTML = `
    <div class="grid lg:grid-cols-2 gap-6">
      <div class="bg-white rounded-xl shadow p-4 sm:p-6">
        <h2 class="text-lg font-semibold mb-4">${t('dashboard.roster')}</h2>
        <div data-el="roster" class="text-sm text-slate-500">${t('common.loading')}</div>
      </div>
      <div class="bg-white rounded-xl shadow p-4 sm:p-6">
        <h2 class="text-lg font-semibold mb-4">${t('dashboard.nextService')}</h2>
        <div data-el="next-service" class="text-sm text-slate-500">${t('common.loading')}</div>
      </div>
    </div>
  `;

  loadRoster(container.querySelector('[data-el="roster"]'), supabase);
  loadNextService(container.querySelector('[data-el="next-service"]'), supabase);
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

async function loadNextService(el, supabase) {
  const todayStr = formatDateLocal(new Date());

  const { data: plan, error: planError } = await supabase
    .from('service_plans')
    .select('id, date, title, song_ids')
    .gte('date', todayStr)
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (planError) {
    el.innerHTML = `<p class="text-rose-600">${t('dashboard.nextServiceFailed', { message: planError.message })}</p>`;
    return;
  }

  if (!plan) {
    el.innerHTML = `<p>${t('dashboard.noUpcomingService')}</p>`;
    return;
  }

  const hasSongs = Array.isArray(plan.song_ids) && plan.song_ids.length > 0;

  const [{ data: assigned }, { data: approvedRsvps }, { data: songs }] = await Promise.all([
    supabase.from('service_plan_singers').select('profiles ( full_name )').eq('service_plan_id', plan.id),
    supabase.from('service_rsvps').select('profiles ( full_name )').eq('service_plan_id', plan.id).eq('status', 'approved'),
    hasSongs ? supabase.from('songs').select('title').in('id', plan.song_ids) : Promise.resolve({ data: [] }),
  ]);

  const assignedNames = (assigned || []).map((row) => row.profiles?.full_name).filter(Boolean);
  const availableNames = (approvedRsvps || []).map((row) => row.profiles?.full_name).filter(Boolean);
  const songTitles = (songs || []).map((song) => song.title);

  el.innerHTML = `
    <div class="mb-4">
      <div class="text-xl font-bold text-slate-800">${escapeHtml(plan.title || t('dashboard.untitledService'))}</div>
      <div class="text-sm text-slate-500">${escapeHtml(plan.date)}</div>
    </div>

    <div class="grid sm:grid-cols-2 gap-4 mb-4">
      ${renderNameGroup(t('dashboard.available'), availableNames, 'bg-emerald-50 text-emerald-700')}
      ${renderNameGroup(t('dashboard.programmed'), assignedNames, 'bg-indigo-50 text-indigo-700')}
    </div>

    <div>
      <div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">${t('dashboard.songs')}</div>
      ${songTitles.length > 0
        ? `<ul class="list-disc list-inside text-sm text-slate-700 space-y-0.5">${songTitles.map((title) => `<li>${escapeHtml(title)}</li>`).join('')}</ul>`
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
