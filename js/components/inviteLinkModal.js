// Super Admin tool: shows the church's shareable invite link
// (?join=<slug>, resolved pre-auth by get_tenant_by_slug() — see
// sql/saas_platform/10_invite_links.sql) and a toggle for whether that
// link actually lets people sign themselves up, or just directs them to
// ask an admin. The toggle writes tenants.allow_self_signup directly —
// allowed through the same "tenant admin can update own tenant" policy
// logo_url uses; it isn't one of the columns protect_tenant_privileged_columns
// blocks, since (unlike status/plan_id/trial_ends_at) this one really is
// meant to be self-service.
import { t } from '../i18n.js';

export function createInviteLinkModal({ supabase, tenantId, tenantSlug }) {
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

  const bodyEl = root.querySelector('[data-el="body"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  const inviteUrl = `${window.location.origin}${window.location.pathname}?join=${encodeURIComponent(tenantSlug)}`;

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase.from('tenants').select('allow_self_signup').eq('id', tenantId).single();
    if (error) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('invite.failedToLoad', { message: error.message })}</p>`;
      return;
    }
    render(data.allow_self_signup);
  }

  function render(allowSelfSignup) {
    bodyEl.innerHTML = `
      <p class="text-sm text-slate-600 mb-2">${t('invite.linkIntro')}</p>
      <div class="flex gap-2 mb-4">
        <input type="text" readonly value="${escapeHtml(inviteUrl)}" data-el="invite-url-input"
               class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-600" />
        <button type="button" data-action="copy" class="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
          ${t('invite.copy')}
        </button>
      </div>
      <p data-el="copy-status" class="text-sm text-emerald-600 mb-4 hidden">${t('invite.copied')}</p>

      <label class="flex items-start gap-2 border-t border-slate-200 pt-4">
        <input type="checkbox" data-el="allow-toggle" ${allowSelfSignup ? 'checked' : ''} class="mt-1" />
        <span class="text-sm text-slate-700">
          <span class="font-medium">${t('invite.allowToggleLabel')}</span><br/>
          <span class="text-slate-500">${t('invite.allowToggleHint')}</span>
        </span>
      </label>
      <p data-el="toggle-status" class="text-sm mt-2"></p>
    `;

    bodyEl.querySelector('[data-action="copy"]').addEventListener('click', async () => {
      const input = bodyEl.querySelector('[data-el="invite-url-input"]');
      input.select();
      try {
        await navigator.clipboard.writeText(inviteUrl);
      } catch {
        document.execCommand('copy'); // clipboard API can be unavailable (e.g. non-HTTPS); execCommand still works on the selected input
      }
      bodyEl.querySelector('[data-el="copy-status"]').classList.remove('hidden');
    });

    bodyEl.querySelector('[data-el="allow-toggle"]').addEventListener('change', async (e) => {
      const toggleStatusEl = bodyEl.querySelector('[data-el="toggle-status"]');
      const { error } = await supabase.from('tenants').update({ allow_self_signup: e.target.checked }).eq('id', tenantId);
      if (error) {
        toggleStatusEl.className = 'text-sm mt-2 text-rose-600';
        toggleStatusEl.textContent = t('invite.toggleFailed', { message: error.message });
        e.target.checked = !e.target.checked;
        return;
      }
      toggleStatusEl.className = 'text-sm mt-2 text-emerald-600';
      toggleStatusEl.textContent = t('invite.toggleSaved');
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

  return { open };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
