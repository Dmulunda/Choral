// Published-course catalog for students. A course not yet approved
// for enrollment (sql/070) shows a Request Access button instead of
// its content — RLS blocks the actual lesson/quiz/video content
// either way, this just keeps the UI from offering a button that
// would fail. A rejected request can be sent again (sql/073's
// request_course_enrollment() resets the existing row rather than
// inserting a duplicate — course_enrollments is unique on
// (user_id, course_id), so a raw second insert would just error).
// Once enrolled, each card shows the signed-in member's own status
// (not started / in progress / pending approval / approved), computed
// from lesson_progress + course_approvals. Selecting a course swaps in
// coursePlayer.js.
import { renderCoursePlayer } from './coursePlayer.js';
import { openCertificate } from './certificate.js';
import { t } from '../i18n.js';

export function renderCourseCatalog(container, { supabase, currentUserId }) {
  load();

  async function load() {
    container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: courses, error } = await supabase.from('courses').select('id, title, description').eq('published', true).order('title');
    if (error) {
      container.innerHTML = `<p class="text-sm text-rose-600">${t('courses.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if ((courses || []).length === 0) {
      container.innerHTML = `<p class="text-sm text-slate-500 bg-white rounded-xl shadow p-4 sm:p-6">${t('courses.catalogEmpty')}</p>`;
      return;
    }

    const [{ data: approvals }, { data: profile }, { data: enrollments }] = await Promise.all([
      supabase.from('course_approvals').select('course_id, status, approved_at').eq('user_id', currentUserId),
      supabase.from('profiles').select('full_name').eq('id', currentUserId).single(),
      supabase.from('course_enrollments').select('course_id, status').eq('user_id', currentUserId),
    ]);
    const approvalByCourseId = new Map((approvals || []).map((a) => [a.course_id, a]));
    const enrollmentByCourseId = new Map((enrollments || []).map((e) => [e.course_id, e]));

    // Enough to label "Not Started" vs "In Progress" — three flat
    // queries joined client-side rather than a deep nested PostgREST
    // embed, since lesson_progress has no direct course_id of its own.
    const { data: anyProgress } = await supabase.from('lesson_progress').select('lesson_id').eq('user_id', currentUserId);
    const progressedLessonIds = (anyProgress || []).map((p) => p.lesson_id);
    const { data: progressedLessons } = progressedLessonIds.length > 0
      ? await supabase.from('lessons').select('id, module_id').in('id', progressedLessonIds)
      : { data: [] };
    const progressedModuleIds = [...new Set((progressedLessons || []).map((l) => l.module_id))];
    const { data: progressedModules } = progressedModuleIds.length > 0
      ? await supabase.from('course_modules').select('id, course_id').in('id', progressedModuleIds)
      : { data: [] };
    const startedCourseIds = new Set((progressedModules || []).map((m) => m.course_id));

    container.innerHTML = `<div data-el="grid" class="grid sm:grid-cols-2 gap-4"></div>`;
    const gridEl = container.querySelector('[data-el="grid"]');

    courses.forEach((course) => {
      const enrollment = enrollmentByCourseId.get(course.id);
      const isEnrolled = enrollment?.status === 'approved';

      const card = document.createElement('div');
      card.className = 'text-left bg-white rounded-xl shadow p-4 sm:p-6 hover:shadow-md transition-shadow';

      if (!isEnrolled) {
        card.appendChild(buildEnrollmentCard(course, enrollment));
      } else {
        card.appendChild(buildCourseCard(course));
      }
      gridEl.appendChild(card);
    });

    function buildEnrollmentCard(course, enrollment) {
      const status = enrollment?.status;
      const statusLabel = status === 'pending' ? t('courses.enrollPending')
        : status === 'rejected' ? t('courses.enrollRejected')
        : t('courses.enrollNotRequested');
      const statusClass = status === 'pending' ? 'bg-amber-100 text-amber-700'
        : status === 'rejected' ? 'bg-rose-100 text-rose-700'
        : 'bg-slate-100 text-slate-500';

      const el = document.createElement('div');
      el.innerHTML = `
        <div class="flex items-start justify-between gap-2 mb-2">
          <span class="font-semibold text-slate-800">${escapeHtml(course.title)}</span>
          <span class="text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${statusClass}">${statusLabel}</span>
        </div>
        ${course.description ? `<p class="text-sm text-slate-500">${escapeHtml(course.description)}</p>` : ''}
        ${status !== 'pending' ? `
          <button type="button" data-action="request" class="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800">
            ${t('courses.requestAccess')}
          </button>
          <p data-el="request-status" class="text-xs mt-1"></p>
        ` : ''}
      `;
      el.querySelector('[data-action="request"]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        // request_course_enrollment() rather than a raw insert — a
        // rejected course already has a row (unique on user_id,
        // course_id), so re-requesting has to reset that row, not
        // insert a second one.
        const { error } = await supabase.rpc('request_course_enrollment', { p_course_id: course.id });
        if (error) {
          btn.disabled = false;
          el.querySelector('[data-el="request-status"]').className = 'text-xs mt-1 text-rose-600';
          el.querySelector('[data-el="request-status"]').textContent = t('courses.requestFailed', { message: error.message });
          return;
        }
        load();
      });
      return el;
    }

    function buildCourseCard(course) {
      const approval = approvalByCourseId.get(course.id);
      const approvalStatus = approval?.status;
      const statusLabel = approvalStatus === 'approved' ? t('courses.statusApproved')
        : approvalStatus === 'pending' ? t('courses.statusPendingApproval')
        : approvalStatus === 'rejected' ? t('courses.statusRejected')
        : startedCourseIds.has(course.id) ? t('courses.statusInProgress')
        : t('courses.statusNotStarted');
      const statusClass = approvalStatus === 'approved' ? 'bg-emerald-100 text-emerald-700'
        : approvalStatus === 'pending' ? 'bg-amber-100 text-amber-700'
        : approvalStatus === 'rejected' ? 'bg-rose-100 text-rose-700'
        : 'bg-slate-100 text-slate-500';

      const el = document.createElement('div');
      el.innerHTML = `
        <button type="button" data-action="open" class="w-full text-left">
          <div class="flex items-start justify-between gap-2 mb-2">
            <span class="font-semibold text-slate-800">${escapeHtml(course.title)}</span>
            <span class="text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${statusClass}">${statusLabel}</span>
          </div>
          ${course.description ? `<p class="text-sm text-slate-500">${escapeHtml(course.description)}</p>` : ''}
        </button>
        ${approvalStatus === 'approved' ? `
          <button type="button" data-action="certificate" class="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800">
            ${t('courses.viewCertificate')}
          </button>
        ` : ''}
      `;
      el.querySelector('[data-action="open"]').addEventListener('click', () => openCourse(course));
      el.querySelector('[data-action="certificate"]')?.addEventListener('click', () => {
        openCertificate({ studentName: profile?.full_name || '', courseTitle: course.title, approvedAt: approval.approved_at });
      });
      return el;
    }
  }

  function openCourse(course) {
    renderCoursePlayer(container, {
      supabase,
      course,
      currentUserId,
      onBack: load,
      onProgressChanged: () => {},
    });
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
