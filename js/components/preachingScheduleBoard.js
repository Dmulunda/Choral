// Preaching & Moderation monthly schedule: Moderator (a registered app
// user), Preacher (free text — guests usually have no account), and the
// Sermon Theme, one row per service date. Each row can expand to show
// that Sunday's Choir song program — visible here specifically because
// sql/017_preaching_schedule.sql grants the scheduled moderator read
// access to it, even without Choir department membership. The
// moderator can approve or decline being scheduled (sql/049), same as
// every other department now — a moderator slot is the only assignment
// here that maps to an actual app user.
import { t } from '../i18n.js';
import { renderMyAssignmentsPanel } from './myAssignmentsPanel.js';
import { renderAssigneeBadge } from './assignmentStatusBadge.js';
import { todayLocal } from '../utils/date.js';
import { getGlobalRole } from '../departments.js';

export function renderPreachingSchedule(container, { supabase, departmentId, canAdminister, userId }) {
  // Super Admin keeps the ability to correct an already-past entry;
  // every other department admin is hard-blocked (sql/052's DB trigger
  // enforces the same rule), so the picker shouldn't even let them try.
  const dateMinAttr = getGlobalRole() === 'super_admin' ? '' : `min="${todayLocal()}"`;

  container.innerHTML = `
    <div data-el="my-assignments"></div>
    ${canAdminister ? `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">${t('preaching.title')}</h2>
        <form data-el="form" class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.date')}</label>
            <input type="date" name="date" required ${dateMinAttr} class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('preaching.moderator')}</label>
            <select name="moderator" data-el="moderator-select" class="w-full border border-slate-300 rounded-lg px-3 py-2">
              <option value="">${t('preaching.moderatorNone')}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('preaching.preacher')}</label>
            <input type="text" name="preacher_name" placeholder="${t('preaching.preacherPlaceholder')}"
                   class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('preaching.guest')}</label>
            <input type="text" name="guest_name" placeholder="${t('preaching.guestPlaceholder')}"
                   class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('preaching.sermonTheme')}</label>
            <input type="text" name="sermon_theme" placeholder="${t('preaching.sermonThemePlaceholder')}"
                   class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div class="sm:col-span-2">
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('preaching.bibleVerse')}</label>
            <input type="text" name="bible_verse" placeholder="${t('preaching.bibleVersePlaceholder')}"
                   class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div class="sm:col-span-2 flex items-center gap-3">
            <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
              ${t('preaching.save')}
            </button>
            <span data-el="form-status" class="text-sm text-slate-500"></span>
          </div>
        </form>
      </div>
    ` : ''}
    <div class="bg-white rounded-xl shadow p-4 sm:p-6">
      <h2 class="text-lg font-semibold mb-4">${t('preaching.upcoming')}</h2>
      <div data-el="list" class="space-y-3"></div>
    </div>
  `;

  const form = container.querySelector('[data-el="form"]');
  const moderatorSelect = container.querySelector('[data-el="moderator-select"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const listEl = container.querySelector('[data-el="list"]');

  if (userId) {
    renderMyAssignmentsPanel(container.querySelector('[data-el="my-assignments"]'), {
      departmentId,
      fetchMyAssignments: async () => {
        const { data, error } = await supabase
          .from('preaching_schedule')
          .select('id, date, moderator_status, moderator_reason, moderator_working_department_id')
          .eq('moderator_id', userId)
          .order('date', { ascending: true });
        if (error) return { error };
        return {
          data: (data || []).map((r) => ({
            id: r.id,
            label: t('preaching.moderator'),
            date: r.date,
            status: r.moderator_status,
            reason: r.moderator_reason,
            workingDepartmentId: r.moderator_working_department_id,
          })),
        };
      },
      updateAssignment: async (id, patch) => {
        const update = {};
        if ('status' in patch) { update.moderator_status = patch.status; update.moderator_responded_at = new Date().toISOString(); }
        if ('reason' in patch) update.moderator_reason = patch.reason;
        if ('workingDepartmentId' in patch) update.moderator_working_department_id = patch.workingDepartmentId;
        const { error } = await supabase.from('preaching_schedule').update(update).eq('id', id);
        if (!error) load();
        return { error };
      },
    });
  }

  if (form) {
    loadModeratorOptions();
    // Picking a date that already has an entry pre-fills it, so
    // submitting again updates it in place instead of erroring.
    form.elements.date.addEventListener('change', () => prefillFromDate(form.elements.date.value));
    form.addEventListener('submit', handleSubmit);
  }

  load();

  async function loadModeratorOptions() {
    const { data } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( full_name )')
      .eq('department_id', departmentId)
      .eq('status', 'approved');

    const options = (data || [])
      .filter((m) => m.member)
      .map((m) => `<option value="${m.user_id}">${escapeHtml(m.member.full_name)}</option>`)
      .join('');
    moderatorSelect.innerHTML = `<option value="">${t('preaching.moderatorNone')}</option>` + options;
  }

  async function prefillFromDate(dateStr) {
    if (!dateStr) return;

    const { data: existing } = await supabase
      .from('preaching_schedule')
      .select('moderator_id, preacher_name, guest_name, sermon_theme, bible_verse')
      .eq('date', dateStr)
      .maybeSingle();

    form.elements.moderator.value = existing?.moderator_id || '';
    form.elements.preacher_name.value = existing?.preacher_name || '';
    form.elements.guest_name.value = existing?.guest_name || '';
    form.elements.sermon_theme.value = existing?.sermon_theme || '';
    form.elements.bible_verse.value = existing?.bible_verse || '';
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const date = form.elements.date.value;
    if (!date) return;

    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { data: { user } } = await supabase.auth.getUser();
    const newModeratorId = form.elements.moderator.value || null;

    const { data: existingRow } = await supabase
      .from('preaching_schedule')
      .select('moderator_id')
      .eq('date', date)
      .maybeSingle();
    // A new or changed moderator starts fresh at "pending" — carrying
    // over the previous moderator's approve/decline status would
    // misattribute it to whoever is scheduled now.
    const moderatorChanged = (existingRow?.moderator_id || null) !== newModeratorId;

    const { error } = await supabase.from('preaching_schedule').upsert({
      date,
      moderator_id: newModeratorId,
      ...(moderatorChanged ? { moderator_status: 'pending', moderator_reason: null, moderator_working_department_id: null } : {}),
      preacher_name: form.elements.preacher_name.value.trim() || null,
      guest_name: form.elements.guest_name.value.trim() || null,
      sermon_theme: form.elements.sermon_theme.value.trim() || null,
      bible_verse: form.elements.bible_verse.value.trim() || null,
      created_by: user.id,
    }, { onConflict: 'date' });

    if (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('preaching.saveFailed', { message: error.message });
      return;
    }

    form.reset();
    formStatusEl.textContent = '';
    load();
  }

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('preaching_schedule')
      .select('id, date, preacher_name, guest_name, sermon_theme, bible_verse, moderator_status, moderator_reason, moderator:profiles!moderator_id ( full_name ), working_department:departments!moderator_working_department_id ( key )')
      .order('date', { ascending: true });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('preaching.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('preaching.none')}</p>`;
      return;
    }

    listEl.innerHTML = '';
    data.forEach((row) => listEl.appendChild(renderRow(row)));
  }

  function renderRow(row) {
    const el = document.createElement('div');
    el.className = 'border border-slate-200 rounded-lg p-3';
    el.innerHTML = `
      <div class="flex items-baseline justify-between gap-3">
        <div class="font-medium text-slate-800">${row.sermon_theme ? escapeHtml(row.sermon_theme) : `<span class="text-slate-400">${t('preaching.noSermonTheme')}</span>`}</div>
        <div class="text-sm text-slate-500">${escapeHtml(row.date)}</div>
      </div>
      <div class="text-sm text-slate-600 mt-1">
        ${t('preaching.moderator')}: ${row.moderator?.full_name
          ? renderAssigneeBadge({ name: row.moderator.full_name, status: row.moderator_status, reason: row.moderator_reason, workingDepartmentKey: row.working_department?.key })
          : `<span class="text-slate-400">${t('preaching.noModerator')}</span>`}
        &nbsp;·&nbsp;
        ${t('preaching.preacher')}: ${row.preacher_name ? escapeHtml(row.preacher_name) : `<span class="text-slate-400">${t('preaching.noPreacher')}</span>`}
        &nbsp;·&nbsp;
        ${t('preaching.guest')}: ${row.guest_name ? escapeHtml(row.guest_name) : `<span class="text-slate-400">${t('preaching.noGuest')}</span>`}
      </div>
      ${row.bible_verse ? `<div class="text-sm text-indigo-700 mt-1 italic">${t('preaching.bibleVerse')}: ${escapeHtml(row.bible_verse)}</div>` : ''}
      <details class="mt-2">
        <summary class="text-xs font-medium text-slate-500 cursor-pointer">${t('preaching.songProgram')}</summary>
        <div data-el="song-program" class="mt-2 text-sm"></div>
      </details>
    `;

    el.querySelector('details').addEventListener('toggle', function onToggle(e) {
      if (!e.target.open) return;
      e.target.removeEventListener('toggle', onToggle);
      loadSongProgram(row.date, el.querySelector('[data-el="song-program"]'));
    });

    return el;
  }

  async function loadSongProgram(date, el) {
    el.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

    const { data: plan } = await supabase
      .from('service_plans')
      .select('id, title')
      .eq('date', date)
      .maybeSingle();

    if (!plan) {
      el.innerHTML = `<p class="text-slate-400">${t('preaching.noSongProgram')}</p>`;
      return;
    }

    const { data: planSongs } = await supabase
      .from('service_plan_songs')
      .select('category, songs ( title )')
      .eq('service_plan_id', plan.id)
      .order('position');

    const praise = (planSongs || []).filter((r) => r.category === 'praise' && r.songs).map((r) => r.songs.title);
    const worship = (planSongs || []).filter((r) => r.category === 'worship' && r.songs).map((r) => r.songs.title);

    if (praise.length === 0 && worship.length === 0) {
      el.innerHTML = `<p class="text-slate-400">${t('preaching.noSongProgram')}</p>`;
      return;
    }

    el.innerHTML = `
      <div class="grid sm:grid-cols-2 gap-3">
        <div>
          <div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">${t('requests.praiseSongs')}</div>
          ${praise.length > 0
            ? `<ul class="list-disc list-inside text-slate-700">${praise.map((title) => `<li>${escapeHtml(title)}</li>`).join('')}</ul>`
            : `<p class="text-slate-400">${t('dashboard.noSongsYet')}</p>`
          }
        </div>
        <div>
          <div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">${t('requests.worshipSongs')}</div>
          ${worship.length > 0
            ? `<ul class="list-disc list-inside text-slate-700">${worship.map((title) => `<li>${escapeHtml(title)}</li>`).join('')}</ul>`
            : `<p class="text-slate-400">${t('dashboard.noSongsYet')}</p>`
          }
        </div>
      </div>
    `;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
