// Offerings tab entry point — the Church Offering Registration page.
// Only ever reachable by someone with hasFinanceOversight() (see
// departments.js) — js/app.js doesn't even construct the nav
// button/tab otherwise, mirrors can_manage_finance() server-side.
import { getEffectiveSupabase } from './departments.js';
import { renderOfferingsBoard } from './components/offeringsBoard.js';
import { t } from './i18n.js';

export async function renderOfferingsPageTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#offerings-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  renderOfferingsBoard(container, { supabase, currentUserId: user.id });
}
