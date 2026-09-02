// Course detail for a student: modules (accordion) -> lessons, each
// locked until the previous lesson (in course order — module position,
// then lesson position) is completed. Selecting an unlocked lesson
// renders it via lessonPlayer.js below the list. Also: Drop Course
// (deletes the enrollment row — lesson_progress is left alone in case
// they're re-approved later) and a per-course Q&A panel (sql/071).
import { renderLessonPlayer } from './lessonPlayer.js';
import { confirmDialog } from './confirmDialog.js';
import { t } from '../i18n.js';

export function renderCoursePlayer(container, { supabase, course, currentUserId, onBack, onProgressChanged }) {
  let activeLessonId = null;

  load();

  async function load() {
    container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: modules, error: modulesError } = await supabase.from('course_modules').select('id, title, position').eq('course_id', course.id).order('position');
    if (modulesError) {
      container.innerHTML = `<p class="text-sm text-rose-600">${t('courses.loadFailed', { message: modulesError.message })}</p>`;
      return;
    }

    const moduleIds = (modules || []).map((m) => m.id);
    const { data: lessons } = moduleIds.length > 0
      ? await supabase.from('lessons').select('id, module_id, title, video_source, pdf_storage_path, position').in('module_id', moduleIds).order('position')
      : { data: [] };

    const lessonIds = (lessons || []).map((l) => l.id);
    const { data: progressRows } = lessonIds.length > 0
      ? await supabase.from('lesson_progress').select('lesson_id, completed').in('lesson_id', lessonIds)
      : { data: [] };
    const completedSet = new Set((progressRows || []).filter((p) => p.completed).map((p) => p.lesson_id));

    // Flattened in course order — module.position, then lesson.position
    // within it — is exactly the sequence completion gating follows.
    const orderedLessons = [];
    (modules || []).forEach((m) => {
      (lessons || []).filter((l) => l.module_id === m.id).forEach((l) => orderedLessons.push(l));
    });

    let previousCompleted = true;
    const lockByLessonId = new Map();
    orderedLessons.forEach((l) => {
      lockByLessonId.set(l.id, !previousCompleted);
      previousCompleted = completedSet.has(l.id);
    });

    render(modules || [], lessons || [], completedSet, lockByLessonId);
  }

  function render(modules, lessons, completedSet, lockByLessonId) {
    container.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <button type="button" data-action="back" class="text-sm text-indigo-600 hover:text-indigo-800">${t('courses.backToCatalog')}</button>
        <button type="button" data-action="drop" class="text-sm text-rose-600 hover:text-rose-800">${t('courses.dropCourse')}</button>
      </div>
      <h2 class="text-xl font-bold mb-1">${escapeHtml(course.title)}</h2>
      ${course.description ? `<p class="text-sm text-slate-500 mb-4">${escapeHtml(course.description)}</p>` : ''}
      <div data-el="modules" class="mb-6"></div>
      <div data-el="lesson-panel" class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6"></div>
      <div data-el="questions" class="bg-white rounded-xl shadow p-4 sm:p-6"></div>
    `;

    container.querySelector('[data-action="back"]').addEventListener('click', () => onBack?.());
    container.querySelector('[data-action="drop"]').addEventListener('click', dropCourse);
    renderQuestions(container.querySelector('[data-el="questions"]'));

    const modulesEl = container.querySelector('[data-el="modules"]');
    if (modules.length === 0) {
      modulesEl.innerHTML = `<p class="text-sm text-slate-500">${t('courses.noModules')}</p>`;
      return;
    }

    modules.forEach((m) => {
      const moduleLessons = lessons.filter((l) => l.module_id === m.id);
      const details = document.createElement('details');
      details.className = 'bg-white rounded-xl shadow mb-2';
      details.open = moduleLessons.some((l) => l.id === activeLessonId) || (!activeLessonId && modules[0].id === m.id);
      details.innerHTML = `
        <summary class="flex items-center justify-between p-3 cursor-pointer select-none font-medium text-slate-800">
          ${escapeHtml(m.title)}
        </summary>
        <div class="border-t border-slate-100 divide-y divide-slate-100"></div>
      `;
      const listEl = details.querySelector('div.divide-y');
      moduleLessons.forEach((l) => {
        const locked = lockByLessonId.get(l.id);
        const completed = completedSet.has(l.id);
        const row = document.createElement('button');
        row.type = 'button';
        row.disabled = locked;
        row.className = `w-full flex items-center justify-between px-4 py-2.5 text-left text-sm ${locked ? 'text-slate-400 cursor-not-allowed' : 'text-slate-700 hover:bg-slate-50'} ${l.id === activeLessonId ? 'bg-indigo-50' : ''}`;
        row.innerHTML = `
          <span>${escapeHtml(l.title)}</span>
          <span class="text-xs ${completed ? 'text-emerald-600' : 'text-slate-400'}">${completed ? '✓' : (locked ? t('courses.locked') : '')}</span>
        `;
        if (!locked) row.addEventListener('click', () => selectLesson(l));
        listEl.appendChild(row);
      });
      modulesEl.appendChild(details);
    });

    if (activeLessonId) {
      const lesson = lessons.find((l) => l.id === activeLessonId);
      if (lesson) selectLesson(lesson, true);
    }
  }

  function selectLesson(lesson, skipReload) {
    activeLessonId = lesson.id;
    const panel = container.querySelector('[data-el="lesson-panel"]');
    renderLessonPlayer(panel, {
      supabase,
      lesson,
      // Completing a lesson can unlock the next one, so the whole
      // module/lesson list (not just the lesson panel) needs a fresh
      // load — not merely bubbling up to the catalog's own callback.
      onCompleted: () => { onProgressChanged?.(); load(); },
    });
    if (!skipReload) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function dropCourse() {
    const confirmed = await confirmDialog({ message: t('courses.confirmDrop', { title: course.title }) });
    if (!confirmed) return;

    const { error } = await supabase.from('course_enrollments').delete().eq('user_id', currentUserId).eq('course_id', course.id);
    if (error) {
      window.alert(t('courses.dropFailed', { message: error.message }));
      return;
    }
    onBack?.();
  }

  async function renderQuestions(el) {
    el.innerHTML = `
      <h3 class="text-sm font-semibold text-slate-600 mb-2">${t('courses.questionsTitle')}</h3>
      <form data-el="ask-form" class="flex gap-2 mb-3">
        <input type="text" data-el="ask-input" placeholder="${t('courses.askPlaceholder')}" class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <button type="submit" class="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 whitespace-nowrap">${t('courses.ask')}</button>
      </form>
      <p data-el="ask-status" class="text-xs text-rose-600 mb-2"></p>
      <div data-el="question-list" class="space-y-2"></div>
    `;

    const askForm = el.querySelector('[data-el="ask-form"]');
    const askStatusEl = el.querySelector('[data-el="ask-status"]');
    askForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = el.querySelector('[data-el="ask-input"]');
      const questionText = input.value.trim();
      if (!questionText) return;

      const { error } = await supabase.from('course_questions').insert({ course_id: course.id, user_id: currentUserId, question_text: questionText });
      if (error) {
        askStatusEl.textContent = t('courses.askFailed', { message: error.message });
        return;
      }
      askStatusEl.textContent = '';
      input.value = '';
      loadQuestions();
    });

    await loadQuestions();

    async function loadQuestions() {
      const listEl = el.querySelector('[data-el="question-list"]');
      const { data, error } = await supabase
        .from('course_questions')
        .select('id, question_text, answer_text, created_at')
        .eq('course_id', course.id)
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false });

      if (error) {
        listEl.innerHTML = `<p class="text-sm text-rose-600">${t('courses.loadFailed', { message: error.message })}</p>`;
        return;
      }
      if (!data || data.length === 0) {
        listEl.innerHTML = `<p class="text-sm text-slate-500">${t('courses.noQuestions')}</p>`;
        return;
      }

      listEl.innerHTML = data.map((q) => `
        <div class="border border-slate-200 rounded-lg p-2.5 text-sm">
          <p class="text-slate-800">${escapeHtml(q.question_text)}</p>
          ${q.answer_text
            ? `<p class="text-slate-600 mt-1.5 pl-2 border-l-2 border-indigo-200"><span class="font-medium">${t('courses.answer')}:</span> ${escapeHtml(q.answer_text)}</p>`
            : `<p class="text-xs text-slate-400 mt-1">${t('courses.awaitingAnswer')}</p>`}
        </div>
      `).join('');
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
