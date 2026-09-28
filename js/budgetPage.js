// Budget tab entry point — the centralized Finance/Budget page. Only
// ever reachable by someone with hasAnyDeptLeadership() (see
// departments.js) — js/app.js doesn't even construct the nav
// button/tab otherwise, so this function itself never runs for a
// regular member. Not tied to the active department switcher, same as
// Service Program/Training.
import { getEffectiveSupabase } from './departments.js';
import { renderBudgetCentralBoard } from './components/budgetCentralBoard.js';
import { t } from './i18n.js';

export async function renderBudgetPageTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#budget-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  renderBudgetCentralBoard(container, { supabase, currentUserId: user.id });
}
