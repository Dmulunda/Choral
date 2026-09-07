// Church-wide events feed — reuses whichever department(s) are flagged
// `is_public_calendar` (sql/081; today that's the existing self-service
// "Church Calendar" department) rather than a new events table. Shown
// on every department's Scheduling tab so general events (services,
// meetings, concerts) are visible without hunting for a separate
// calendar — plain read-only list, not a second grid, since this data
// is sparse (a handful of announcements), not dense day-by-day data
// the way availability is.
import { t } from '../i18n.js';
import { todayLocal } from '../utils/date.js';

const UPCOMING_LIMIT = 10;

export async function renderUpcomingChurchEvents(container, { supabase }) {
  function clear() {
    container.className = '';
    container.innerHTML = '';
  }

  container.className = 'bg-white rounded-xl shadow p-4 sm:p-6 mb-6';
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

  const { data: publicDepts, error: deptError } = await supabase
    .from('departments')
    .select('id')
    .eq('is_public_calendar', true);

  if (deptError || !publicDepts || publicDepts.length === 0) { clear(); return; }

  const { data: shifts, error } = await supabase
    .from('department_shifts')
    .select('date, title, notes')
    .in('department_id', publicDepts.map((d) => d.id))
    .gte('date', todayLocal())
    .order('date', { ascending: true })
    .limit(UPCOMING_LIMIT);

  if (error || !shifts || shifts.length === 0) { clear(); return; }

  container.innerHTML = `
    <h2 class="text-lg font-semibold mb-3">${t('churchEvents.title')}</h2>
    <ul class="space-y-2">
      ${shifts.map((s) => `
        <li class="flex items-baseline gap-3 text-sm">
          <span class="font-medium text-slate-700 whitespace-nowrap">${escapeHtml(s.date)}</span>
          <span class="text-slate-600">${escapeHtml(s.title)}</span>
          ${s.notes ? `<span class="text-slate-400">— ${escapeHtml(s.notes)}</span>` : ''}
        </li>
      `).join('')}
    </ul>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
