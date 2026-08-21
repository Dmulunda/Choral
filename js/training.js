// Training tab entry point. Phase 1: School Admins get the course
// builder; everyone else sees a placeholder until Phase 2 adds the
// student-facing catalog/player/progress dashboard.
import { getEffectiveSupabase } from './departments.js';
import { getIsSchoolAdmin } from './schoolAdmin.js';
import { renderCourseBuilder } from './components/courseBuilder.js';
import { t } from './i18n.js';

export async function renderTrainingTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#training-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  container.innerHTML = '';

  if (getIsSchoolAdmin()) {
    renderCourseBuilder(container, { supabase, currentUserId: user.id });
  } else {
    container.innerHTML = `<p class="text-slate-500 bg-white rounded-xl shadow p-4 sm:p-6">${t('courses.studentComingSoon')}</p>`;
  }
}
