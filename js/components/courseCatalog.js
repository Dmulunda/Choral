// Published-course catalog for students — each card shows the
// signed-in member's own status (not started / in progress / pending
// approval / approved), computed from lesson_progress +
// course_approvals. Selecting a course swaps in coursePlayer.js.
import { renderCoursePlayer } from './coursePlayer.js';
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

    const { data: approvals } = await supabase.from('course_approvals').select('course_id, status').eq('user_id', currentUserId);
    const approvalByCourseId = new Map((approvals || []).map((a) => [a.course_id, a.status]));

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
      const approvalStatus = approvalByCourseId.get(course.id);
      const statusLabel = approvalStatus === 'approved' ? t('courses.statusApproved')
        : approvalStatus === 'pending' ? t('courses.statusPendingApproval')
        : approvalStatus === 'rejected' ? t('courses.statusRejected')
        : startedCourseIds.has(course.id) ? t('courses.statusInProgress')
        : t('courses.statusNotStarted');
      const statusClass = approvalStatus === 'approved' ? 'bg-emerald-100 text-emerald-700'
        : approvalStatus === 'pending' ? 'bg-amber-100 text-amber-700'
        : approvalStatus === 'rejected' ? 'bg-rose-100 text-rose-700'
        : 'bg-slate-100 text-slate-500';

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'text-left bg-white rounded-xl shadow p-4 sm:p-6 hover:shadow-md transition-shadow';
      card.innerHTML = `
        <div class="flex items-start justify-between gap-2 mb-2">
          <span class="font-semibold text-slate-800">${escapeHtml(course.title)}</span>
          <span class="text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${statusClass}">${statusLabel}</span>
        </div>
        ${course.description ? `<p class="text-sm text-slate-500">${escapeHtml(course.description)}</p>` : ''}
      `;
      card.addEventListener('click', () => openCourse(course));
      gridEl.appendChild(card);
    });
  }

  function openCourse(course) {
    renderCoursePlayer(container, {
      supabase,
      course,
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
