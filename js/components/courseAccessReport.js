// School-Admin-only "Access & Progress" report — the one place that
// answers "who has access to VPD Academy, at what level, and how far
// have they gotten": the list of School Admins (who can create/manage
// courses, sql/044's is_school_admin flag — grantable from the User
// Directory, not here), plus every student's enrollment status per
// course and, on demand, their lesson-by-lesson progress and quiz
// scores. RLS already lets a School Admin read every user's
// course_enrollments/course_approvals/lesson_progress rows (sql/044/070),
// so this is a read-only report — no new policies needed.
import { t } from '../i18n.js';

export function renderCourseAccessReport(container, { supabase }) {
  let enrollments = [];
  let approvalsByKey = new Map();
  let totalLessonsByCourse = new Map();
  let completedCountByKey = new Map();
  let expandedKey = null;

  load();

  async function load() {
    container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const [
      { data: schoolAdmins, error: adminsError },
      { data: enrollmentRows, error: enrollError },
      { data: approvals, error: approvalsError },
      { data: lessons, error: lessonsError },
      { data: completedProgress, error: progressError },
    ] = await Promise.all([
      supabase.from('profiles').select('id, full_name').eq('is_school_admin', true).order('full_name'),
      supabase
        .from('course_enrollments')
        .select('id, user_id, course_id, status, student:profiles!user_id ( full_name ), course:courses!course_id ( title )')
        .order('requested_at'),
      supabase.from('course_approvals').select('user_id, course_id, status'),
      // course_id via the lesson's module — used to compute each
      // course's total lesson count for the progress percentage below.
      supabase.from('lessons').select('id, course_modules!module_id ( course_id )'),
      supabase.from('lesson_progress').select('user_id, lesson_id').eq('completed', true),
    ]);

    if (adminsError || enrollError || approvalsError || lessonsError || progressError) {
      container.innerHTML = `<p class="text-sm text-rose-600">${t('courses.loadFailed', { message: (adminsError || enrollError || approvalsError || lessonsError || progressError).message })}</p>`;
      return;
    }

    enrollments = (enrollmentRows || []).filter((row) => row.student && row.course)
      .sort((a, b) => a.student.full_name.localeCompare(b.student.full_name) || a.course.title.localeCompare(b.course.title));
    approvalsByKey = new Map((approvals || []).map((a) => [`${a.user_id}:${a.course_id}`, a.status]));

    const courseIdByLesson = new Map((lessons || []).map((l) => [l.id, l.course_modules?.course_id]));
    totalLessonsByCourse = new Map();
    (lessons || []).forEach((l) => {
      const courseId = courseIdByLesson.get(l.id);
      if (!courseId) return;
      totalLessonsByCourse.set(courseId, (totalLessonsByCourse.get(courseId) || 0) + 1);
    });

    completedCountByKey = new Map();
    (completedProgress || []).forEach((p) => {
      const courseId = courseIdByLesson.get(p.lesson_id);
      if (!courseId) return;
      const key = `${p.user_id}:${courseId}`;
      completedCountByKey.set(key, (completedCountByKey.get(key) || 0) + 1);
    });

    render(schoolAdmins || []);
  }

  function render(schoolAdmins) {
    container.innerHTML = `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
        <h2 class="text-lg font-semibold mb-1">${t('courses.schoolAdminsTitle')}</h2>
        <p class="text-xs text-slate-500 mb-3">${t('courses.schoolAdminsIntro')}</p>
        ${schoolAdmins.length === 0
          ? `<p class="text-sm text-slate-500">${t('courses.schoolAdminsNone')}</p>`
          : `<div class="flex flex-wrap gap-2">${schoolAdmins.map((a) => `<span class="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-sm font-medium">${escapeHtml(a.full_name)}</span>`).join('')}</div>`}
      </div>

      <div class="bg-white rounded-xl shadow p-4 sm:p-6">
        <h2 class="text-lg font-semibold mb-1">${t('courses.accessTitle')}</h2>
        <p class="text-xs text-slate-500 mb-3">${t('courses.accessIntro')}</p>
        <div data-el="table"></div>
      </div>
    `;

    renderTable();
  }

  function renderTable() {
    const tableEl = container.querySelector('[data-el="table"]');
    if (enrollments.length === 0) {
      tableEl.innerHTML = `<p class="text-sm text-slate-500">${t('courses.noEnrollments')}</p>`;
      return;
    }

    tableEl.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th class="text-left px-3 py-2">${t('courses.colStudent')}</th>
              <th class="text-left px-3 py-2">${t('courses.colCourse')}</th>
              <th class="text-left px-3 py-2">${t('courses.colEnrollment')}</th>
              <th class="text-left px-3 py-2">${t('courses.colProgress')}</th>
              <th class="text-left px-3 py-2">${t('courses.colCompletion')}</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${enrollments.map((row) => rowHtml(row)).join('')}
          </tbody>
        </table>
      </div>
    `;

    tableEl.querySelectorAll('[data-action="toggle-progress"]').forEach((btn) => {
      btn.addEventListener('click', () => toggleProgress(btn.dataset.key, btn.dataset.userId, btn.dataset.courseId));
    });
  }

  function rowHtml(row) {
    const key = `${row.user_id}:${row.course_id}`;
    const completionStatus = approvalsByKey.get(key);
    const isExpanded = expandedKey === key;

    return `
      <tr>
        <td class="px-3 py-2 font-medium text-slate-800">${escapeHtml(row.student.full_name)}</td>
        <td class="px-3 py-2">${escapeHtml(row.course.title)}</td>
        <td class="px-3 py-2">${enrollmentBadge(row.status)}</td>
        <td class="px-3 py-2">${row.status === 'approved' ? progressCell(key, row.course_id) : '—'}</td>
        <td class="px-3 py-2">${completionStatus ? completionBadge(completionStatus) : '—'}</td>
        <td class="px-3 py-2 text-right">
          ${row.status === 'approved' ? `
            <button type="button" data-action="toggle-progress" data-key="${key}" data-user-id="${row.user_id}" data-course-id="${row.course_id}"
                    class="text-xs font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap">
              ${isExpanded ? t('courses.hideProgress') : t('courses.viewProgress')}
            </button>
          ` : ''}
        </td>
      </tr>
      ${isExpanded ? `<tr><td colspan="5" class="px-3 pb-3"><div data-el="progress-detail">${t('common.loading')}</div></td></tr>` : ''}
    `;
  }

  async function toggleProgress(key, userId, courseId) {
    expandedKey = expandedKey === key ? null : key;
    renderTable();
    if (expandedKey !== key) return;

    const detailEl = container.querySelector('[data-el="progress-detail"]');

    const { data: modules } = await supabase.from('course_modules').select('id, title, position').eq('course_id', courseId).order('position');
    const moduleIds = (modules || []).map((m) => m.id);
    const { data: lessons } = moduleIds.length > 0
      ? await supabase.from('lessons').select('id, title, position, module_id').in('module_id', moduleIds).order('position')
      : { data: [] };
    const lessonIds = (lessons || []).map((l) => l.id);
    const { data: progress } = lessonIds.length > 0
      ? await supabase.from('lesson_progress').select('lesson_id, quiz_score, completed').eq('user_id', userId).in('lesson_id', lessonIds)
      : { data: [] };

    if (!detailEl) return; // user collapsed it again before this resolved

    const progressByLesson = new Map((progress || []).map((p) => [p.lesson_id, p]));
    const moduleById = new Map((modules || []).map((m) => [m.id, m]));
    // lessons.position resets to 0 within each module (see
    // courseBuilder.js's addLesson), so sorting lessons by their own
    // position alone would interleave modules — rank by each lesson's
    // module's position first (using modules' already-sorted index),
    // then by the lesson's own position within that module.
    const modulePositionById = new Map((modules || []).map((m, idx) => [m.id, idx]));
    const orderedLessons = [...(lessons || [])].sort((a, b) => {
      const moduleDiff = (modulePositionById.get(a.module_id) ?? 0) - (modulePositionById.get(b.module_id) ?? 0);
      return moduleDiff !== 0 ? moduleDiff : a.position - b.position;
    });

    const completedCount = orderedLessons.filter((l) => progressByLesson.get(l.id)?.completed).length;
    const firstIncomplete = orderedLessons.find((l) => !progressByLesson.get(l.id)?.completed);
    const currentModuleText = firstIncomplete
      ? t('courses.currentModule', { module: moduleById.get(firstIncomplete.module_id)?.title || '—' })
      : t('courses.allModulesDone');

    // Latest quiz score = the last lesson (in course order) with a
    // recorded score, not necessarily the current one — a student may
    // have taken a later lesson's quiz out of order, or none at all.
    const lessonsWithScore = orderedLessons.filter((l) => progressByLesson.get(l.id)?.quiz_score != null);
    const lastScored = lessonsWithScore[lessonsWithScore.length - 1];
    const scoreText = lastScored
      ? t('courses.lastQuizScore', { score: t('courses.scoreOutOf10', { score: progressByLesson.get(lastScored.id).quiz_score }) })
      : t('courses.noQuiz');

    detailEl.innerHTML = `
      <div class="bg-slate-50 rounded-lg p-3 text-sm text-slate-600 space-y-1">
        <div>${t('courses.progressSummary', { completed: completedCount, total: orderedLessons.length })}</div>
        <div>${currentModuleText}</div>
        <div>${scoreText}</div>
      </div>
    `;
  }

  function progressCell(key, courseId) {
    const total = totalLessonsByCourse.get(courseId) || 0;
    if (total === 0) return '—';

    const completed = completedCountByKey.get(key) || 0;
    const pct = Math.round((completed / total) * 100);
    const barColor = pct === 100 ? 'bg-emerald-500' : 'bg-indigo-500';

    return `
      <div class="flex items-center gap-2 min-w-[110px]">
        <div class="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
          <div class="h-full ${barColor}" style="width:${pct}%"></div>
        </div>
        <span class="text-xs font-medium text-slate-600 whitespace-nowrap">${pct}%</span>
      </div>
    `;
  }

  function enrollmentBadge(status) {
    const label = status === 'approved' ? t('courses.statusApproved')
      : status === 'pending' ? t('courses.enrollPending')
      : t('courses.enrollRejected');
    const cls = status === 'approved' ? 'bg-emerald-100 text-emerald-700'
      : status === 'pending' ? 'bg-amber-100 text-amber-700'
      : 'bg-rose-100 text-rose-700';
    return `<span class="px-2 py-0.5 rounded-full text-xs font-medium ${cls}">${label}</span>`;
  }

  function completionBadge(status) {
    const label = status === 'approved' ? t('courses.statusApproved')
      : status === 'pending' ? t('courses.statusPendingApproval')
      : t('courses.statusRejected');
    const cls = status === 'approved' ? 'bg-emerald-100 text-emerald-700'
      : status === 'pending' ? 'bg-amber-100 text-amber-700'
      : 'bg-rose-100 text-rose-700';
    return `<span class="px-2 py-0.5 rounded-full text-xs font-medium ${cls}">${label}</span>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
