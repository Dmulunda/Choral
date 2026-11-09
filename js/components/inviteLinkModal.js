// Invite Members -- a shareable signup link + an on/off toggle for
// open self-signup. Parity port of sandbox2's js/components/
// inviteLinkModal.js, but Main has exactly one church (no slug to
// resolve): the link is just this app's own URL with ?join=1, which
// authScreen.js uses to auto-switch to the Sign Up tab (or explain
// why it's hidden, if the toggle below is off). Writes straight to
// signup_settings (a one-row table, same singleton pattern as
// pastor_meeting_settings) -- no RPC needed, same as every other
// single-toggle admin setting in this app.
import { t } from '../i18n.js';

export function createInviteLinkModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('invite.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  const bodyEl = root.querySelector('[data-el="body"]');
  const inviteUrl = `${window.location.origin}${window.location.pathname}?join=1`;

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase.from('signup_settings').select('allow_self_signup').eq('id', true).maybeSingle();
    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('invite.failedToLoad', { message: error.message })}</p>`;
      return;
    }
    render(data?.allow_self_signup ?? true);
  }

  function render(allowed) {
    bodyEl.innerHTML = `
      <p class="text-sm text-slate-500 mb-2">${t('invite.linkIntro')}</p>
      <div class="flex items-center gap-2 mb-4">
        <input type="text" readonly value="${escapeAttr(inviteUrl)}" data-el="link-input" class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-slate-50" />
        <button type="button" data-action="copy" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('invite.copy')}</button>
      </div>
      <label class="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" data-el="allow-toggle" ${allowed ? 'checked' : ''} class="rounded border-slate-300" />
        ${t('invite.allowToggleLabel')}
      </label>
      <p class="text-xs text-slate-400 mt-1">${t('invite.allowToggleHint')}</p>
      <p data-el="toggle-status" class="text-sm mt-2"></p>
    `;

    const statusEl = bodyEl.querySelector('[data-el="toggle-status"]');

    bodyEl.querySelector('[data-action="copy"]').addEventListener('click', async () => {
      const input = bodyEl.querySelector('[data-el="link-input"]');
      try {
        await navigator.clipboard.writeText(inviteUrl);
      } catch {
        input.focus();
        input.select();
        document.execCommand('copy');
      }
      statusEl.className = 'text-sm text-emerald-600 mt-2';
      statusEl.textContent = t('invite.copied');
    });

    bodyEl.querySelector('[data-el="allow-toggle"]').addEventListener('change', async (e) => {
      statusEl.className = 'text-sm text-slate-500 mt-2';
      statusEl.textContent = t('common.saving');
      const { error } = await supabase.from('signup_settings').upsert(
        { id: true, allow_self_signup: e.target.checked, updated_by: currentUserId },
        { onConflict: 'id' },
      );
      if (error) {
        statusEl.className = 'text-sm text-rose-600 mt-2';
        statusEl.textContent = t('invite.toggleFailed', { message: error.message });
        e.target.checked = !e.target.checked;
        return;
      }
      statusEl.className = 'text-sm text-emerald-600 mt-2';
      statusEl.textContent = t('invite.toggleSaved');
    });
  }

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    load();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open, root };
}

function escapeAttr(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML.replaceAll('"', '&quot;');
}
