// Leader (School Admin) verification queue — every course_approvals
// row with status 'pending', expandable to show that student's
// per-lesson quiz scores before granting sign-off. Approve/Reject call
// review_course_approval() (security definer, is_school_admin()-gated
// again server-side). A short history of already-decided approvals
// sits below for reference.
import { confirmDialog } from './confirmDialog.js';
import { t } from '../i18n.js';

export function renderCourseApprovalQueue(container, { supabase }) {
  load();

  async function load() {
    container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const [{ data: pending, error: pendingError }, { data: decided }] = await Promise.all([
      supabase.from('course_approvals').select('id, user_id, course_id, created_at, student:profiles!user_id ( full_name ), course:courses!course_id ( title )').eq('status', 'pending').order('created_at'),
      supabase.from('course_approvals').select('id, user_id, course_id, status, approved_at, student:profiles!user_id ( full_name ), course:courses!course_id ( title )').neq('status', 'pending').order('approved_at', { ascending: false }).limit(20),
    ]);

    if (pendingError) {
      container.innerHTML = `<p class="text-sm text-rose-600">${t('courses.loadFailed', { message: pendingError.message })}</p>`;
      return;
    }

    container.innerHTML = `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">${t('courses.pendingApprovals')}</h2>
        <div data-el="pending"></div>
      </div>
      <div class="bg-white rounded-xl shadow p-4 sm:p-6">
        <h2 class="text-lg font-semibold mb-4">${t('courses.recentDecisions')}</h2>
        <div data-el="decided"></div>
      </div>
    `;

    renderPending(container.querySelector('[data-el="pending"]'), pending || []);
    renderDecided(container.querySelector('[data-el="decided"]'), decided || []);
  }

  function renderPending(el, rows) {
    if (rows.length === 0) {
      el.innerHTML = `<p class="text-sm text-slate-500">${t('courses.noPendingApprovals')}</p>`;
      return;
    }

    el.innerHTML = '';
    rows.forEach((row) => {
      const card = document.createElement('div');
      card.className = 'border border-slate-200 rounded-lg p-3 mb-2';
      card.innerHTML = `
        <button type="button" data-action="toggle" class="w-full flex items-center justify-between text-left">
          <span>
            <span class="font-medium text-slate-800">${escapeHtml(row.student?.full_name || '—')}</span>
            <span class="text-sm text-slate-500"> — ${escapeHtml(row.course?.title || '—')}</span>
          </span>
          <span class="text-xs text-slate-400">${escapeHtml((row.created_at || '').slice(0, 10))}</span>
        </button>
        <div data-el="detail" class="hidden mt-3 pt-3 border-t border-slate-100">
          <p class="text-sm text-slate-500">${t('common.loading')}</p>
        </div>
      `;

      const detailEl = card.querySelector('[data-el="detail"]');
      let loaded = false;
      card.querySelector('[data-action="toggle"]').addEventListener('click', async () => {
        detailEl.classList.toggle('hidden');
        if (!loaded && !detailEl.classList.contains('hidden')) {
          loaded = true;
          await renderScores(detailEl, row);
        }
      });

      el.appendChild(card);
    });
  }

  async function renderScores(el, row) {
    const { data: modules } = await supabase.from('course_modules').select('id, title, position').eq('course_id', row.course_id).order('position');
    const moduleIds = (modules || []).map((m) => m.id);
    const { data: lessons } = moduleIds.length > 0
      ? await supabase.from('lessons').select('id, title, position, module_id').in('module_id', moduleIds).order('position')
      : { data: [] };
    const lessonIds = (lessons || []).map((l) => l.id);
    const { data: progress } = lessonIds.length > 0
      ? await supabase.from('lesson_progress').select('lesson_id, quiz_score, quiz_attempts, completed').eq('user_id', row.user_id).in('lesson_id', lessonIds)
      : { data: [] };
    const progressByLesson = new Map((progress || []).map((p) => [p.lesson_id, p]));

    el.innerHTML = `
      <div data-el="lesson-scores" class="mb-3"></div>
      <div class="flex items-center gap-3">
        <button type="button" data-action="approve" class="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">${t('courses.approve')}</button>
        <button type="button" data-action="reject" class="px-4 py-2 rounded-lg text-rose-600 text-sm font-medium hover:bg-rose-50">${t('courses.reject')}</button>
        <span data-el="status" class="text-sm text-slate-500"></span>
      </div>
    `;

    const scoresEl = el.querySelector('[data-el="lesson-scores"]');
    (lessons || []).forEach((l) => {
      const p = progressByLesson.get(l.id);
      const scoreText = p?.quiz_score != null ? t('courses.scoreOutOf10', { score: p.quiz_score }) : t('courses.noQuiz');
      const lessonRow = document.createElement('div');
      lessonRow.className = 'flex items-center justify-between text-sm py-1';
      lessonRow.innerHTML = `
        <span class="text-slate-600">${escapeHtml(l.title)}</span>
        <span class="flex items-center gap-2">
          <span class="${p?.completed ? 'text-emerald-600' : 'text-slate-400'}">${p?.completed ? '✓ ' : ''}${escapeHtml(scoreText)}</span>
          ${p ? `<button type="button" class="text-xs font-medium text-rose-600 hover:text-rose-800">${t('moderation.resetProgress')}</button>` : ''}
        </span>
      `;
      if (p) {
        lessonRow.querySelector('button').addEventListener('click', async () => {
          const confirmed = await confirmDialog({ message: t('moderation.confirmResetProgress', { name: row.student?.full_name || '', title: l.title }) });
          if (!confirmed) return;
          const { error } = await supabase.from('lesson_progress').delete().eq('user_id', row.user_id).eq('lesson_id', l.id);
          if (error) {
            window.alert(t('moderation.deleteFailed', { message: error.message }));
            return;
          }
          renderScores(el, row);
        });
      }
      scoresEl.appendChild(lessonRow);
    });

    el.querySelector('[data-action="approve"]').addEventListener('click', () => decide(row, 'approved', el));
    el.querySelector('[data-action="reject"]').addEventListener('click', () => decide(row, 'rejected', el));
  }

  async function decide(row, status, el) {
    const confirmed = await confirmDialog({
      message: t(status === 'approved' ? 'courses.confirmApprove' : 'courses.confirmReject', { name: row.student?.full_name || '', course: row.course?.title || '' }),
      confirmLabel: t(status === 'approved' ? 'courses.approve' : 'courses.reject'),
      danger: status === 'rejected',
    });
    if (!confirmed) return;

    const { error } = await supabase.rpc('review_course_approval', { p_approval_id: row.id, p_status: status });
    const statusEl = el.querySelector('[data-el="status"]');
    if (error) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('courses.saveFailed', { message: error.message });
      return;
    }
    load();
  }

  function renderDecided(el, rows) {
    if (rows.length === 0) {
      el.innerHTML = `<p class="text-sm text-slate-500">${t('courses.noDecisions')}</p>`;
      return;
    }
    el.innerHTML = rows.map((row) => `
      <div class="flex items-center justify-between text-sm py-1.5 border-b border-slate-100 last:border-0">
        <span>
          <span class="font-medium text-slate-700">${escapeHtml(row.student?.full_name || '—')}</span>
          <span class="text-slate-500"> — ${escapeHtml(row.course?.title || '—')}</span>
        </span>
        <span class="text-xs px-2 py-0.5 rounded-full ${row.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">
          ${row.status === 'approved' ? t('courses.statusApproved') : t('courses.statusRejected')}
        </span>
      </div>
    `).join('');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
