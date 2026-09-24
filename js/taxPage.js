// Tax / Impôts tab entry point — every signed-in member's running
// donation totals and, once Finance finalizes a year, their official
// receipt. Not tied to the active department switcher, same as
// training.js/serviceProgram.js, since this is about the member
// themselves, not any one department.
import { getEffectiveSupabase } from './departments.js';
import { renderTaxReceiptsMemberBoard } from './components/taxReceiptsMemberBoard.js';
import { t } from './i18n.js';

export async function renderTaxTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#tax-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  renderTaxReceiptsMemberBoard(container, { supabase, userId: user.id });
}
