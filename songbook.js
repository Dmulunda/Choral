// Songbook tab entry point: loads the current user's role (to decide
// whether the "Add Song" admin controls are shown) and renders the library.
import { supabase } from './supabaseClient.js';
import { renderSongLibrary } from './components/songLibrary.js';
import { t } from './i18n.js';

export async function renderSongbookTab() {
  const container = document.querySelector('#songbook-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('songbook.pleaseSignIn')}</p>`;
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, voice_parts')
    .eq('id', user.id)
    .single();

  if (profileError) {
    container.innerHTML = `<p class="text-rose-600">${t('songbook.failedToLoadProfile', { message: profileError.message })}</p>`;
    return;
  }

  renderSongLibrary(container, {
    supabase,
    isAdmin: profile.role === 'admin',
    viewerVoiceParts: profile.voice_parts,
  });
}
