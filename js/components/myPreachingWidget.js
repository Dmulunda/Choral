// "You're preaching soon" card — shown on a member's own dashboard
// (Choir's or their department's) regardless of Preaching department
// membership, since sql/061 grants a scheduled preacher read access to
// their own preaching_schedule row specifically so they can see (and
// share) their assigned Bible verse without needing to join Preaching.
// Renders nothing if they have no upcoming preaching date.
import { t } from '../i18n.js';
import { todayLocal } from '../utils/date.js';

export async function renderMyPreachingWidget(container, { supabase, userId }) {
  const { data, error } = await supabase
    .from('preaching_schedule')
    .select('date, sermon_theme, bible_verse')
    .eq('preacher_id', userId)
    .gte('date', todayLocal())
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <h2 class="text-lg font-semibold mb-2">${t('preaching.yourUpcoming')}</h2>
      <div class="text-slate-800 font-medium">${escapeHtml(data.sermon_theme || t('preaching.noSermonTheme'))} <span class="text-slate-400 font-normal">— ${escapeHtml(data.date)}</span></div>
      ${data.bible_verse ? `<div class="text-indigo-700 italic mt-1">${escapeHtml(data.bible_verse)}</div>` : ''}
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
