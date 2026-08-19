// Songbook tab entry point: loads the current user's role (to decide
// whether the "Add Song" admin controls are shown) and renders the library.
import { getEffectiveSupabase, getActiveDepartment } from './departments.js';
import { renderSongLibrary } from './components/songLibrary.js';
import { t } from './i18n.js';

export async function renderSongbookTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#songbook-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('songbook.pleaseSignIn')}</p>`;
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('voice_parts')
    .eq('id', user.id)
    .single();

  if (profileError) {
    container.innerHTML = `<p class="text-rose-600">${t('songbook.failedToLoadProfile', { message: profileError.message })}</p>`;
    return;
  }

  // Admin gating comes from the active department context, not a raw
  // profiles.role lookup, so it correctly reflects View-As simulation.
  const activeDept = getActiveDepartment();
  const isAdmin = activeDept?.role === 'admin' || activeDept?.role === 'super_admin';

  renderSongLibrary(container, {
    supabase,
    isAdmin,
    viewerVoiceParts: profile.voice_parts,
  });
}
