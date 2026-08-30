// "Today, then this week's schedule" dashboard widget for every
// non-Choir department — Choir's Dashboard has always shown its own
// week with today pulled out first (dashboardOverview.js); this gives
// every other department the same shape, using whichever board that
// department's Scheduling tab already uses. Finance has no scheduling
// at all, so it's simply never called for that department. Ushers also
// gets its uniform-of-the-day text (not the photo — that's on the
// Uniform tab) shown beside each date, same as Choir's own week card.
import { t, mediaTechRoleLabel, ecodemAgeGroupLabel } from '../i18n.js';
import { formatDateLocal, todayLocal } from '../utils/date.js';

export function renderNextUpcomingWidget(container, { supabase, departmentId, departmentKey }) {
  const RENDERERS = {
    preaching: loadPreaching,
    media_tech: loadMediaTech,
    ecodem: loadEcodem,
  };
  const load = RENDERERS[departmentKey] || loadShift;

  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <h2 class="text-lg font-semibold mb-4">${t('dashboard.today')}</h2>
      <div data-el="today-body" class="text-sm text-slate-500 space-y-3">${t('common.loading')}</div>
    </div>
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <h2 class="text-lg font-semibold mb-4">${t('dashboard.thisWeekSchedule')}</h2>
      <div data-el="week-body" class="text-sm text-slate-500 space-y-3">${t('common.loading')}</div>
    </div>
  `;
  const todayEl = container.querySelector('[data-el="today-body"]');
  const weekEl = container.querySelector('[data-el="week-body"]');
  load({ todayEl, weekEl }, { supabase, departmentId, departmentKey });
}

// Splits a week's rows into today's vs. the rest, then renders each
// half through the same per-row HTML builder every load* function
// already had — so today's entry shows first, in its own section, and
// the week section below no longer repeats it.
function renderTodayAndWeek(todayEl, weekEl, rows, buildHtml) {
  const todayStr = todayLocal();
  const todayRows = rows.filter((row) => row.date === todayStr);
  const restRows = rows.filter((row) => row.date !== todayStr);

  todayEl.innerHTML = todayRows.length > 0 ? buildHtml(todayRows) : noneTodayHtml();
  weekEl.innerHTML = restRows.length > 0 ? buildHtml(restRows) : noneElseHtml();
}

// Monday-through-Sunday range containing today, matching Choir's own
// week card (dashboardOverview.js) exactly.
function getWeekRange() {
  const date = new Date();
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: formatDateLocal(monday), end: formatDateLocal(sunday) };
}

export async function loadUniformByDate(supabase, departmentId, startStr, endStr) {
  const { data } = await supabase
    .from('department_uniforms')
    .select('date, description')
    .eq('department_id', departmentId)
    .gte('date', startStr)
    .lte('date', endStr);
  const map = new Map();
  (data || []).forEach((row) => { if (row.description) map.set(row.date, row.description); });
  return map;
}

export function uniformLineHtml(uniformMap, date) {
  const desc = uniformMap?.get(date);
  return desc ? `<div class="text-xs text-purple-700 mt-1">${t('uniform.label')}: ${escapeHtml(desc)}</div>` : '';
}

async function loadPreaching({ todayEl, weekEl }, { supabase }) {
  const { start, end } = getWeekRange();
  const { data, error } = await supabase
    .from('preaching_schedule')
    .select('date, sermon_theme, bible_verse, preacher_id, preacher_name, moderator:profiles!moderator_id ( full_name ), preacher:profiles!preacher_id ( full_name )')
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true });

  if (error) { todayEl.innerHTML = weekEl.innerHTML = errorHtml(error); return; }
  renderTodayAndWeek(todayEl, weekEl, data || [], buildPreachingHtml);
}

function buildPreachingHtml(rows) {
  return rows.map((row) => {
    const preacherName = row.preacher?.full_name || row.preacher_name;
    return `
      <div class="border border-slate-200 rounded-lg p-3">
        <div class="font-medium text-slate-800">${escapeHtml(row.sermon_theme || t('preaching.noSermonTheme'))} <span class="text-slate-400 font-normal">— ${escapeHtml(row.date)}</span></div>
        <div class="text-slate-600 mt-1 text-sm">
          ${t('preaching.moderator')}: ${row.moderator?.full_name ? escapeHtml(row.moderator.full_name) : '—'}
          &nbsp;·&nbsp; ${t('preaching.preacher')}: ${preacherName ? escapeHtml(preacherName) : '—'}
        </div>
        ${row.bible_verse ? `<div class="text-indigo-700 italic mt-1 text-sm">${escapeHtml(row.bible_verse)}</div>` : ''}
      </div>
    `;
  }).join('');
}

async function loadMediaTech({ todayEl, weekEl }, { supabase }) {
  const { start, end } = getWeekRange();
  const { data, error } = await supabase
    .from('media_tech_assignments')
    .select('date, role, assignee:profiles!user_id ( full_name )')
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true });

  if (error) { todayEl.innerHTML = weekEl.innerHTML = errorHtml(error); return; }
  renderTodayAndWeek(todayEl, weekEl, data || [], buildMediaTechHtml);
}

function buildMediaTechHtml(rows) {
  const byDate = new Map();
  rows.forEach((row) => {
    if (!byDate.has(row.date)) byDate.set(row.date, new Map());
    const roleMap = byDate.get(row.date);
    if (!roleMap.has(row.role)) roleMap.set(row.role, []);
    if (row.assignee?.full_name) roleMap.get(row.role).push(row.assignee.full_name);
  });

  return Array.from(byDate.entries()).map(([date, roleMap]) => `
    <div class="border border-slate-200 rounded-lg p-3">
      <div class="font-medium text-slate-800 mb-1">${escapeHtml(date)}</div>
      <div class="space-y-1 text-sm">
        ${Array.from(roleMap.entries()).map(([role, names]) => `
          <div><span class="text-slate-500">${mediaTechRoleLabel(role)}:</span> <span class="text-slate-800">${names.length > 0 ? names.map(escapeHtml).join(', ') : `<span class="text-slate-400">${t('deptScheduling.unassigned')}</span>`}</span></div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

async function loadEcodem({ todayEl, weekEl }, { supabase }) {
  const { start, end } = getWeekRange();
  const { data, error } = await supabase
    .from('ecodem_sessions')
    .select('date, age_group, topic, ecodem_session_workers ( worker:profiles!user_id ( full_name ) )')
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true });

  if (error) { todayEl.innerHTML = weekEl.innerHTML = errorHtml(error); return; }
  renderTodayAndWeek(todayEl, weekEl, data || [], buildEcodemHtml);
}

function buildEcodemHtml(rows) {
  const byDate = new Map();
  rows.forEach((session) => {
    if (!byDate.has(session.date)) byDate.set(session.date, []);
    byDate.get(session.date).push(session);
  });

  return Array.from(byDate.entries()).map(([date, sessions]) => `
    <div class="border border-slate-200 rounded-lg p-3">
      <div class="font-medium text-slate-800 mb-1">${escapeHtml(date)}</div>
      <div class="grid sm:grid-cols-3 gap-3 text-sm">
        ${sessions.map((session) => {
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
    </div>
  `).join('');
}

async function loadShift({ todayEl, weekEl }, { supabase, departmentId, departmentKey }) {
  const { start, end } = getWeekRange();
  const [{ data, error }, uniformMap] = await Promise.all([
    supabase
      .from('department_shifts')
      .select('date, title, notes, department_shift_assignments ( assignee:profiles!user_id ( full_name ) )')
      .eq('department_id', departmentId)
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true }),
    departmentKey === 'ushers' ? loadUniformByDate(supabase, departmentId, start, end) : Promise.resolve(null),
  ]);

  if (error) { todayEl.innerHTML = weekEl.innerHTML = errorHtml(error); return; }
  renderTodayAndWeek(todayEl, weekEl, data || [], (rows) => buildShiftHtml(rows, uniformMap));
}

function buildShiftHtml(rows, uniformMap) {
  return rows.map((row) => {
    const names = (row.department_shift_assignments || []).map((a) => a.assignee?.full_name).filter(Boolean);
    return `
      <div class="border border-slate-200 rounded-lg p-3">
        <div class="font-medium text-slate-800">${escapeHtml(row.title)} <span class="text-slate-400 font-normal">— ${escapeHtml(row.date)}</span></div>
        ${row.notes ? `<p class="text-slate-600 mt-1 text-sm">${escapeHtml(row.notes)}</p>` : ''}
        <div class="text-slate-500 mt-1 text-sm">${names.length > 0 ? names.map(escapeHtml).join(', ') : `<span class="text-slate-400">${t('deptScheduling.unassigned')}</span>`}</div>
        ${uniformLineHtml(uniformMap, row.date)}
      </div>
    `;
  }).join('');
}

function noneTodayHtml() {
  return `<p class="text-slate-400">${t('dashboard.nothingToday')}</p>`;
}

function noneElseHtml() {
  return `<p class="text-slate-400">${t('dashboard.nothingElseThisWeek')}</p>`;
}

function errorHtml(error) {
  return `<p class="text-rose-600">${t('dashboard.loadFailed', { message: error.message })}</p>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
