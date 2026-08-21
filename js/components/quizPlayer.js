// Quiz-taking UI for one lesson — fetches questions via
// get_quiz_questions_for_student() (never sees correct_answer),
// submits via submit_quiz_attempt() (grades server-side), and shows
// per-question right/wrong without revealing what the correct answer
// was for anything missed. Unlimited retakes.
import { t } from '../i18n.js';

export function renderQuizPlayer(container, { supabase, lessonId, onPassed }) {
  load();

  async function load() {
    container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: questions, error } = await supabase.rpc('get_quiz_questions_for_student', { p_lesson_id: lessonId });
    if (error) {
      container.innerHTML = `<p class="text-sm text-rose-600">${t('courses.quizLoadFailed', { message: error.message })}</p>`;
      return;
    }

    renderForm(questions || []);
  }

  function renderForm(questions) {
    container.innerHTML = `
      <form data-el="quiz-form" class="space-y-4">
        ${questions.map((q, i) => renderQuestion(q, i)).join('')}
        <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('courses.submitQuiz')}
        </button>
      </form>
      <div data-el="result" class="mt-4"></div>
    `;

    container.querySelector('[data-el="quiz-form"]').addEventListener('submit', (e) => {
      e.preventDefault();
      submit(questions);
    });
  }

  function renderQuestion(q, index) {
    const num = index + 1;
    if (q.type === 'multiple_choice') {
      return `
        <div class="border border-slate-200 rounded-lg p-3" data-question="${q.id}">
          <p class="text-sm font-medium text-slate-700 mb-2">${num}. ${escapeHtml(q.question_text)}</p>
          ${(q.options || []).map((opt, i) => `
            <label class="flex items-center gap-2 text-sm text-slate-600 mb-1">
              <input type="radio" name="q-${q.id}" value="${escapeAttr(opt)}" required /> ${escapeHtml(opt)}
            </label>
          `).join('')}
        </div>
      `;
    }
    return `
      <div class="border border-slate-200 rounded-lg p-3" data-question="${q.id}">
        <p class="text-sm font-medium text-slate-700 mb-2">${num}. ${escapeHtml(q.question_text)}</p>
        <label class="flex items-center gap-2 text-sm text-slate-600 mb-1">
          <input type="radio" name="q-${q.id}" value="true" required /> ${t('courses.true')}
        </label>
        <label class="flex items-center gap-2 text-sm text-slate-600">
          <input type="radio" name="q-${q.id}" value="false" required /> ${t('courses.false')}
        </label>
      </div>
    `;
  }

  async function submit(questions) {
    const answers = questions.map((q) => {
      const selected = container.querySelector(`input[name="q-${q.id}"]:checked`);
      return { question_id: q.id, answer: selected?.value || null };
    });

    const { data, error } = await supabase.rpc('submit_quiz_attempt', { p_lesson_id: lessonId, p_answers: answers });
    const resultEl = container.querySelector('[data-el="result"]');

    if (error) {
      resultEl.innerHTML = `<p class="text-sm text-rose-600">${t('courses.quizSubmitFailed', { message: error.message })}</p>`;
      return;
    }

    const resultsByQuestion = new Map((data.results || []).map((r) => [r.question_id, r.correct]));
    container.querySelectorAll('[data-question]').forEach((qEl) => {
      const correct = resultsByQuestion.get(qEl.dataset.question);
      qEl.classList.add(correct ? 'border-emerald-300' : 'border-rose-300');
    });

    resultEl.innerHTML = `
      <div class="p-3 rounded-lg ${data.passed ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}">
        <p class="font-semibold">${data.passed ? t('courses.quizPassed') : t('courses.quizFailed')}</p>
        <p class="text-sm">${t('courses.quizScore', { score: data.score, total: data.total })}</p>
      </div>
      ${!data.passed ? `<button type="button" data-action="retry" class="mt-3 px-4 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800">${t('courses.tryAgain')}</button>` : ''}
    `;

    if (data.passed) {
      onPassed?.();
    } else {
      resultEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
