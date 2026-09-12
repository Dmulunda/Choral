// Service Program tab entry point — cross-department roster for one
// service date. Not tied to the active department switcher, same as
// training.js, since every member should be able to see every
// department's roster, not just their own.
import { getEffectiveSupabase } from './departments.js';
import { renderServiceProgram } from './components/serviceProgramBoard.js';
import { t } from './i18n.js';

export async function renderServiceProgramTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#service-program-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  renderServiceProgram(container, { supabase, userId: user.id });
}
