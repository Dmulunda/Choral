// "Your upcoming assignment" card — shown on a member's own dashboard
// (Choir's or their department's) regardless of Preaching department
// membership, since sql/061/sql/062 grant a scheduled preacher or
// moderator read/write access to their own preaching_schedule row
// specifically. Lets them add or edit the Bible verse themselves once
// they're scheduled, instead of waiting on the Preaching admin to type
// it in — same self-service-on-your-own-row trust model as every RSVP
// elsewhere in this app (the client only ever writes bible_verse here,
// never the scheduling fields). Renders nothing if they have no
// upcoming assignment.
import { t } from '../i18n.js';
import { todayLocal } from '../utils/date.js';

export async function renderMyPreachingWidget(container, { supabase, userId }) {
  const { data, error } = await supabase
    .from('preaching_schedule')
    .select('id, date, sermon_theme, bible_verse, preacher_id, moderator_id')
    .or(`preacher_id.eq.${userId},moderator_id.eq.${userId}`)
    .gte('date', todayLocal())
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    container.innerHTML = '';
    return;
  }

  const role = data.preacher_id === userId ? t('preaching.preacher') : t('preaching.moderator');

  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <h2 class="text-lg font-semibold mb-2">${t('preaching.yourUpcomingAssignment')}</h2>
      <div class="text-slate-800 font-medium">
        ${escapeHtml(data.sermon_theme || t('preaching.noSermonTheme'))}
        <span class="text-slate-400 font-normal">— ${escapeHtml(data.date)} · ${escapeHtml(role)}</span>
      </div>
      <div class="mt-3">
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('preaching.bibleVerse')}</label>
        <div class="flex flex-wrap gap-2">
          <input type="text" data-el="verse-input" value="${escapeAttr(data.bible_verse || '')}"
                 placeholder="${t('preaching.bibleVersePlaceholder')}"
                 class="flex-1 min-w-[160px] border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <button type="button" data-el="save-btn"
                  class="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 whitespace-nowrap">
            ${t('preaching.saveBibleVerse')}
          </button>
        </div>
        <p data-el="status" class="text-xs mt-1"></p>
      </div>
    </div>
  `;

  const input = container.querySelector('[data-el="verse-input"]');
  const saveBtn = container.querySelector('[data-el="save-btn"]');
  const statusEl = container.querySelector('[data-el="status"]');

  saveBtn.addEventListener('click', async () => {
    const bibleVerse = input.value.trim() || null;
    saveBtn.disabled = true;
    statusEl.className = 'text-xs mt-1 text-slate-500';
    statusEl.textContent = t('common.loading');

    const { error: saveError } = await supabase
      .from('preaching_schedule')
      .update({ bible_verse: bibleVerse })
      .eq('id', data.id);

    saveBtn.disabled = false;
    if (saveError) {
      statusEl.className = 'text-xs mt-1 text-rose-600';
      statusEl.textContent = t('preaching.bibleVerseSaveFailed', { message: saveError.message });
      return;
    }
    statusEl.className = 'text-xs mt-1 text-emerald-600';
    statusEl.textContent = t('preaching.bibleVerseSaved');
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
