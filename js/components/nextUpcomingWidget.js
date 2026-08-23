// "What's next" dashboard widget for every non-Choir department —
// Choir's Dashboard has always shown its upcoming service detail
// (dashboardOverview.js); this gives every other department the same
// at-a-glance view of their own next scheduled date, using whichever
// board that department's Scheduling tab already uses. Finance has no
// scheduling at all, so it's simply never called for that department.
import { t, mediaTechRoleLabel, ecodemAgeGroupLabel } from '../i18n.js';

export function renderNextUpcomingWidget(container, { supabase, departmentId, departmentKey }) {
  const RENDERERS = {
    preaching: loadPreaching,
    media_tech: loadMediaTech,
    ecodem: loadEcodem,
  };
  const load = RENDERERS[departmentKey] || loadShift;

  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <h2 class="text-lg font-semibold mb-4">${t('dashboard.whatsNext')}</h2>
      <div data-el="body" class="text-sm text-slate-500">${t('common.loading')}</div>
    </div>
  `;
  const bodyEl = container.querySelector('[data-el="body"]');
  load(bodyEl, { supabase, departmentId });
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function loadPreaching(el, { supabase }) {
  const { data, error } = await supabase
    .from('preaching_schedule')
    .select('date, sermon_theme, bible_verse, preacher_name, guest_name, moderator:profiles!moderator_id ( full_name )')
    .gte('date', todayStr())
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) { el.innerHTML = errorHtml(error); return; }
  if (!data) { el.innerHTML = noneHtml(); return; }

  el.innerHTML = `
    <div class="font-medium text-slate-800">${escapeHtml(data.sermon_theme || t('preaching.noSermonTheme'))} <span class="text-slate-400 font-normal">— ${escapeHtml(data.date)}</span></div>
    <div class="text-slate-600 mt-1">
      ${t('preaching.moderator')}: ${data.moderator?.full_name ? escapeHtml(data.moderator.full_name) : '—'}
      &nbsp;·&nbsp; ${t('preaching.preacher')}: ${data.preacher_name ? escapeHtml(data.preacher_name) : '—'}
    </div>
    ${data.bible_verse ? `<div class="text-indigo-700 italic mt-1">${escapeHtml(data.bible_verse)}</div>` : ''}
  `;
}

async function loadMediaTech(el, { supabase }) {
  const { data: nextDateRow } = await supabase
    .from('media_tech_assignments')
    .select('date')
    .gte('date', todayStr())
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!nextDateRow) { el.innerHTML = noneHtml(); return; }

  const { data, error } = await supabase
    .from('media_tech_assignments')
    .select('role, assignee:profiles!user_id ( full_name )')
    .eq('date', nextDateRow.date);

  if (error) { el.innerHTML = errorHtml(error); return; }

  const byRole = new Map();
  (data || []).forEach((row) => {
    if (!row.assignee?.full_name) return;
    if (!byRole.has(row.role)) byRole.set(row.role, []);
    byRole.get(row.role).push(row.assignee.full_name);
  });

  el.innerHTML = `
    <div class="font-medium text-slate-800 mb-2">${escapeHtml(nextDateRow.date)}</div>
    <div class="space-y-1">
      ${Array.from(byRole.entries()).map(([role, names]) => `
        <div><span class="text-slate-500">${mediaTechRoleLabel(role)}:</span> <span class="text-slate-800">${names.map(escapeHtml).join(', ')}</span></div>
      `).join('') || `<p class="text-slate-400">${t('deptScheduling.unassigned')}</p>`}
    </div>
  `;
}

async function loadEcodem(el, { supabase }) {
  const { data: nextDateRow } = await supabase
    .from('ecodem_sessions')
    .select('date')
    .gte('date', todayStr())
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!nextDateRow) { el.innerHTML = noneHtml(); return; }

  const { data, error } = await supabase
    .from('ecodem_sessions')
    .select('age_group, topic, ecodem_session_workers ( worker:profiles!user_id ( full_name ) )')
    .eq('date', nextDateRow.date);

  if (error) { el.innerHTML = errorHtml(error); return; }

  el.innerHTML = `
    <div class="font-medium text-slate-800 mb-2">${escapeHtml(nextDateRow.date)}</div>
    <div class="grid sm:grid-cols-3 gap-3">
      ${(data || []).map((session) => {
        const names = (session.ecodem_session_workers || []).map((w) => w.worker?.full_name).filter(Boolean);
        return `
          <div>
            <div class="font-medium text-slate-700">${ecodemAgeGroupLabel(session.age_group)}</div>
            <div class="text-slate-600">${session.topic ? escapeHtml(session.topic) : `<span class="text-slate-400">${t('ecodem.noTopic')}</span>`}</div>
            <div class="text-slate-500 mt-1">${names.length > 0 ? names.map(escapeHtml).join(', ') : `<span class="text-slate-400">${t('deptScheduling.unassigned')}</span>`}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function loadShift(el, { supabase, departmentId }) {
  const { data, error } = await supabase
    .from('department_shifts')
    .select('date, title, notes, department_shift_assignments ( assignee:profiles!user_id ( full_name ) )')
    .eq('department_id', departmentId)
    .gte('date', todayStr())
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) { el.innerHTML = errorHtml(error); return; }
  if (!data) { el.innerHTML = noneHtml(); return; }

  const names = (data.department_shift_assignments || []).map((a) => a.assignee?.full_name).filter(Boolean);
  el.innerHTML = `
    <div class="font-medium text-slate-800">${escapeHtml(data.title)} <span class="text-slate-400 font-normal">— ${escapeHtml(data.date)}</span></div>
    ${data.notes ? `<p class="text-slate-600 mt-1">${escapeHtml(data.notes)}</p>` : ''}
    <div class="text-slate-500 mt-1">${names.length > 0 ? names.map(escapeHtml).join(', ') : `<span class="text-slate-400">${t('deptScheduling.unassigned')}</span>`}</div>
  `;
}

function noneHtml() {
  return `<p class="text-slate-400">${t('dashboard.nothingUpcoming')}</p>`;
}

function errorHtml(error) {
  return `<p class="text-rose-600">${t('dashboard.loadFailed', { message: error.message })}</p>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
