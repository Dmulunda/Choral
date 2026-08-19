// Global User Directory tab entry point: every user across every
// department, in one table — visible only to Super Admin, Super
// Viewer, Pastor Admin, and Church Secretary (gated in app.js by
// getGlobalRole()). Not tied to the active department at all.
import { getEffectiveSupabase } from './departments.js';
import { renderUserManager } from './components/userManager.js';
import { t } from './i18n.js';

export async function renderDirectoryTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#directory-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  container.innerHTML = '';
  renderUserManager(container, { supabase, scope: { type: 'global' }, currentUserId: user.id });
}
