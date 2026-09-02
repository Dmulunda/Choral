// School-Admin-only migration tool (sql/071) — retroactively credits
// a student for lessons/modules they already completed on a different
// platform: marks them done, records a quiz mark where the lesson has
// a quiz, and grants the student approved access to the course so
// they can pick up from here. Opened from courseBuilder.js's course
// detail view. grant_lesson_credit()/grant_module_credit() are
// security definer and check is_school_admin() themselves.
import { t } from '../i18n.js';

export function createCourseCreditModal({ supabase }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xl font-bold">${t('courses.grantCreditTitle')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-xs text-slate-500 mb-4">${t('courses.grantCreditIntro')}</p>

      <div class="mb-4">
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('courses.searchStudent')}</label>
        <input type="text" data-el="student-search" placeholder="${t('courses.searchStudentPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <div data-el="student-results" class="border border-slate-200 rounded-lg mt-1 divide-y divide-slate-100 hidden"></div>
        <p data-el="selected-student" class="text-sm text-emerald-700 mt-1"></p>
      </div>

      <div data-el="modules"></div>

      <div class="flex items-center gap-3 mt-4 pt-4 border-t border-slate-200">
        <button type="button" data-action="grant" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
          ${t('courses.grantCredit')}
        </button>
        <span data-el="grant-status" class="text-sm text-slate-500"></span>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const searchInput = root.querySelector('[data-el="student-search"]');
  const resultsEl = root.querySelector('[data-el="student-results"]');
  const selectedEl = root.querySelector('[data-el="selected-student"]');
  const modulesEl = root.querySelector('[data-el="modules"]');
  const grantBtn = root.querySelector('[data-action="grant"]');
  const grantStatusEl = root.querySelector('[data-el="grant-status"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  grantBtn.addEventListener('click', grantCredit);

  let courseId = null;
  let selectedStudent = null;
  let searchTimeout = null;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(searchStudents, 200);
  });

  async function searchStudents() {
    const query = searchInput.value.trim();
    if (!query) { resultsEl.classList.add('hidden'); resultsEl.innerHTML = ''; return; }

    const { data } = await supabase.from('profiles').select('id, full_name').ilike('full_name', `%${query}%`).order('full_name').limit(8);
    const rows = data || [];
    if (rows.length === 0) { resultsEl.classList.add('hidden'); resultsEl.innerHTML = ''; return; }

    resultsEl.classList.remove('hidden');
    resultsEl.innerHTML = rows.map((r) => `<button type="button" data-student-id="${r.id}" class="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50">${escapeHtml(r.full_name)}</button>`).join('');
    resultsEl.querySelectorAll('[data-student-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedStudent = { id: btn.dataset.studentId, full_name: rows.find((r) => r.id === btn.dataset.studentId).full_name };
        selectedEl.textContent = t('courses.selectedStudent', { name: selectedStudent.full_name });
        resultsEl.classList.add('hidden');
        searchInput.value = '';
        // Reload with this student's existing progress marked, so
        // it's clear what they already have before granting more —
        // the same view doubles as an after-the-fact check of who a
        // credit landed on.
        loadModules();
      });
    });
  }

  async function open(course) {
    courseId = course.id;
    selectedStudent = null;
    selectedEl.textContent = '';
    searchInput.value = '';
    resultsEl.classList.add('hidden');
    grantStatusEl.textContent = '';
    root.classList.remove('hidden');
    root.classList.add('flex');
    await loadModules();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  async function loadModules() {
    modulesEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: modules } = await supabase.from('course_modules').select('id, title, position').eq('course_id', courseId).order('position');
    const moduleIds = (modules || []).map((m) => m.id);
    const { data: lessons } = moduleIds.length > 0
      ? await supabase.from('lessons').select('id, module_id, title, position').in('module_id', moduleIds).order('position')
      : { data: [] };
    const lessonIds = (lessons || []).map((l) => l.id);
    const { data: quizzes } = lessonIds.length > 0
      ? await supabase.from('quizzes').select('lesson_id, passing_score').in('lesson_id', lessonIds)
      : { data: [] };
    const quizByLessonId = new Map((quizzes || []).map((q) => [q.lesson_id, q]));

    // Only meaningful once a student is picked — shows what they
    // already have credit for, both as a sanity check before granting
    // more and as the answer to "who did I just credit" afterward.
    const { data: progress } = selectedStudent && lessonIds.length > 0
      ? await supabase.from('lesson_progress').select('lesson_id, quiz_score, completed').eq('user_id', selectedStudent.id).in('lesson_id', lessonIds)
      : { data: [] };
    const progressByLessonId = new Map((progress || []).map((p) => [p.lesson_id, p]));

    if (!modules || modules.length === 0) {
      modulesEl.innerHTML = `<p class="text-sm text-slate-500">${t('courses.noModules')}</p>`;
      return;
    }

    modulesEl.innerHTML = '';
    modules.forEach((m) => {
      const moduleLessons = (lessons || []).filter((l) => l.module_id === m.id);
      const section = document.createElement('div');
      section.className = 'border-t border-slate-100 pt-3 mt-3 first:border-0 first:pt-0 first:mt-0';
      section.innerHTML = `
        <label class="flex items-center gap-2 font-medium text-slate-800 text-sm mb-2">
          <input type="checkbox" data-action="toggle-module" />
          ${escapeHtml(m.title)}
        </label>
        <div data-el="lessons" class="pl-6 space-y-2"></div>
      `;

      const lessonsEl = section.querySelector('[data-el="lessons"]');
      moduleLessons.forEach((l) => {
        const quiz = quizByLessonId.get(l.id);
        const existing = progressByLessonId.get(l.id);
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2 text-sm';
        row.dataset.lessonId = l.id;
        row.innerHTML = `
          <label class="flex items-center gap-2 flex-1">
            <input type="checkbox" data-el="lesson-check" />
            ${escapeHtml(l.title)}
            ${existing?.completed ? `<span class="px-1.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">${existing.quiz_score != null ? t('courses.alreadyCreditedWithScore', { score: existing.quiz_score }) : t('courses.alreadyCredited')}</span>` : ''}
          </label>
          ${quiz ? `<input type="number" data-el="lesson-score" min="0" max="10" placeholder="${t('courses.markOutOf10')}" value="${existing?.quiz_score ?? quiz.passing_score}" class="w-20 border border-slate-300 rounded-lg px-2 py-1 text-xs" />` : ''}
        `;
        lessonsEl.appendChild(row);
      });

      section.querySelector('[data-action="toggle-module"]').addEventListener('change', (e) => {
        lessonsEl.querySelectorAll('[data-el="lesson-check"]').forEach((cb) => { cb.checked = e.target.checked; });
      });

      modulesEl.appendChild(section);
    });
  }

  async function grantCredit() {
    if (!selectedStudent) {
      grantStatusEl.className = 'text-sm text-rose-600';
      grantStatusEl.textContent = t('courses.grantMissingStudent');
      return;
    }

    const checkedRows = Array.from(modulesEl.querySelectorAll('[data-lesson-id]')).filter((row) => row.querySelector('[data-el="lesson-check"]').checked);
    if (checkedRows.length === 0) {
      grantStatusEl.className = 'text-sm text-rose-600';
      grantStatusEl.textContent = t('courses.grantMissingLessons');
      return;
    }

    grantBtn.disabled = true;
    grantStatusEl.className = 'text-sm text-slate-500';
    grantStatusEl.textContent = t('common.saving');

    for (const row of checkedRows) {
      const lessonId = row.dataset.lessonId;
      const scoreInput = row.querySelector('[data-el="lesson-score"]');
      const score = scoreInput ? Number(scoreInput.value) || 0 : null;

      const { error } = await supabase.rpc('grant_lesson_credit', { p_user_id: selectedStudent.id, p_lesson_id: lessonId, p_score: score });
      if (error) {
        grantBtn.disabled = false;
        grantStatusEl.className = 'text-sm text-rose-600';
        grantStatusEl.textContent = t('courses.grantFailed', { message: error.message });
        return;
      }
    }

    grantBtn.disabled = false;
    grantStatusEl.className = 'text-sm text-emerald-600';
    grantStatusEl.textContent = t('courses.grantDone', { count: checkedRows.length, name: selectedStudent.full_name });
    await loadModules();
  }

  return { open, root };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
