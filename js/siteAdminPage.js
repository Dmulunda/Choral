// Site Admin — a full page (not a popup), reached only via the
// tools-menu "Site Admin" entry, same pattern as js/pastorMeetingsPage.js.
// Three tabs: App Suggestions and Support Requests submitted by any
// signed-in member (via the list_*_for_site_admin() RPCs, which bypass
// each row's own tenant_isolation the same way every other cross-tenant
// lookup in this app already does), and a simple add/remove-by-email
// console for who else holds the role.
//
// This started as Main's own, single-tenant copy of SAAS's
// siteAdminPage.js -- trimmed down to what actually applies here.
// Dropped entirely: Website Inquiries and Churches (both SAAS-
// marketing/multi-tenant concepts with no equivalent on a one-church
// install) and the Training Sandbox (practicing "being a different
// church" makes no sense when there's only ever one).
//
// Suggestions/Requests/Manage DO pull in SAAS too, via a second
// Supabase client -- the mirror image of SAAS's own "connect to Main"
// panel: some Site Admins only have a home account on Main, and this
// lets them also help triage SAAS's suggestions/requests from here,
// one login, two data sources, each row tagged by which system it
// came from.
//
// Replies (same shape as SAAS's sql/061): a Site Admin's status/
// admin_note edit is internal-only; `site_admin_reply` is the
// distinct, submitter-facing field, delivered via the notifications
// bell.
import { t } from './i18n.js';
import { confirmDialog } from './components/confirmDialog.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { getEffectiveSupabase } from './departments.js';

const SUGGESTION_STATUSES = ['new', 'planned', 'done', 'declined'];
const REQUEST_STATUSES = ['new', 'answered', 'closed'];

const SAAS_URL = 'https://towlqbxvhftzjfrtepsy.supabase.co';
const SAAS_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvd2xxYnh2aGZ0empmcnRlcHN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNzY2NjIsImV4cCI6MjEwNDY1MjY2Mn0.k3tlKMNNlpd-TGcd5hnyDfSzNcdmy8QLKiRYKkOEa-c';

let saasClient = null;
function getSaasClient() {
  if (!saasClient) saasClient = createClient(SAAS_URL, SAAS_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  return saasClient;
}

export async function renderSiteAdminTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#site-admin-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  container.innerHTML = `
    <div data-el="saas-connect" class="flex items-center gap-2 mb-4 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"></div>

    <div class="flex gap-2 mb-4 border-b border-slate-200 flex-wrap">
      <button type="button" data-tab="suggestions" class="px-3 py-2 text-sm font-medium border-b-2 border-indigo-600 text-indigo-600">${t('siteAdmin.tabSuggestions')}</button>
      <button type="button" data-tab="requests" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabRequests')}</button>
      <button type="button" data-tab="manage" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabManage')}</button>
    </div>

    <div data-panel="suggestions"></div>
    <div data-panel="requests" class="hidden"></div>
    <div data-panel="manage" class="hidden"></div>
  `;

  const saasConnectEl = container.querySelector('[data-el="saas-connect"]');
  const tabBtns = container.querySelectorAll('[data-tab]');
  const panels = {
    suggestions: container.querySelector('[data-panel="suggestions"]'),
    requests: container.querySelector('[data-panel="requests"]'),
    manage: container.querySelector('[data-panel="manage"]'),
  };
  const loaded = { suggestions: false, requests: false, manage: false };

  tabBtns.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  function switchTab(tab) {
    tabBtns.forEach((btn) => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('border-indigo-600', active);
      btn.classList.toggle('text-indigo-600', active);
      btn.classList.toggle('border-transparent', !active);
      btn.classList.toggle('text-slate-500', !active);
    });
    Object.entries(panels).forEach(([key, el]) => el.classList.toggle('hidden', key !== tab));
    if (tab === 'suggestions' && !loaded.suggestions) loadSuggestions();
    if (tab === 'requests' && !loaded.requests) loadRequests();
    if (tab === 'manage' && !loaded.manage) loadManage();
  }

  // ---- SAAS connection (one login, two data sources) ----
  async function renderSaasConnect() {
    const client = getSaasClient();
    const { data: { session } } = await client.auth.getSession();
    if (session) {
      saasConnectEl.innerHTML = `
        <span class="text-emerald-600">●</span>
        <span>${t('siteAdmin.saasConnected')}</span>
        <button type="button" data-action="saas-disconnect" class="ml-auto text-indigo-600 hover:text-indigo-700 font-medium">${t('siteAdmin.saasDisconnect')}</button>
      `;
      saasConnectEl.querySelector('[data-action="saas-disconnect"]').addEventListener('click', async () => {
        await client.auth.signOut();
        renderSaasConnect();
      });
    } else {
      saasConnectEl.innerHTML = `
        <span class="text-slate-400">●</span>
        <span>${t('siteAdmin.saasNotConnected')}</span>
        <input type="email" data-el="saas-email" placeholder="${t('siteAdmin.saasEmailPlaceholder')}" class="ml-auto border border-slate-300 rounded px-2 py-1 text-sm w-40" />
        <input type="password" data-el="saas-password" placeholder="${t('siteAdmin.saasPasswordPlaceholder')}" class="border border-slate-300 rounded px-2 py-1 text-sm w-32" />
        <button type="button" data-action="saas-connect" class="text-indigo-600 hover:text-indigo-700 font-medium">${t('siteAdmin.saasConnect')}</button>
        <span data-el="saas-connect-status" class="text-rose-600"></span>
      `;
      saasConnectEl.querySelector('[data-action="saas-connect"]').addEventListener('click', async () => {
        const email = saasConnectEl.querySelector('[data-el="saas-email"]').value.trim();
        const password = saasConnectEl.querySelector('[data-el="saas-password"]').value;
        const statusEl = saasConnectEl.querySelector('[data-el="saas-connect-status"]');
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) { statusEl.textContent = error.message; return; }
        await renderSaasConnect();
        loaded.suggestions = false; loaded.requests = false; loaded.manage = false;
        Object.keys(panels).forEach((tab) => { if (!panels[tab].classList.contains('hidden')) switchTab(tab); });
      });
    }
  }

  // ---- Suggestions / Requests (merged Main + SAAS) ----
  async function fetchFromBothSystems(rpcName) {
    const mainPromise = supabase.rpc(rpcName).then(({ data, error }) => ({
      data: (data || []).map((row) => ({ ...row, _system: 'Main', _client: supabase })), error,
    }));
    const promises = [mainPromise];

    const sc = getSaasClient();
    const { data: { session } } = await sc.auth.getSession();
    if (session) {
      promises.push(sc.rpc(rpcName).then(({ data, error }) => ({
        data: (data || []).map((row) => ({ ...row, _system: 'SAAS', _client: sc })), error,
      })));
    }

    const results = await Promise.all(promises);
    const firstError = results.find((r) => r.error)?.error;
    const rows = results.flatMap((r) => r.data || []);
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { rows, error: firstError };
  }

  async function loadSuggestions() {
    panels.suggestions.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const { rows, error } = await fetchFromBothSystems('list_app_suggestions_for_site_admin');
    if (error) {
      panels.suggestions.innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: error.message })}</p>`;
      return;
    }
    loaded.suggestions = true;
    if (!rows.length) {
      panels.suggestions.innerHTML = `<p class="text-slate-400">${t('siteAdmin.noSuggestions')}</p>`;
      return;
    }
    panels.suggestions.innerHTML = `<div class="space-y-3">${rows.map((row) => buildCard(row, SUGGESTION_STATUSES, 'suggestion')).join('')}</div>`;
    wireCards(panels.suggestions, 'app_suggestions', loadSuggestions);
  }

  async function loadRequests() {
    panels.requests.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const { rows, error } = await fetchFromBothSystems('list_support_requests_for_site_admin');
    if (error) {
      panels.requests.innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: error.message })}</p>`;
      return;
    }
    loaded.requests = true;
    if (!rows.length) {
      panels.requests.innerHTML = `<p class="text-slate-400">${t('siteAdmin.noRequests')}</p>`;
      return;
    }
    panels.requests.innerHTML = `<div class="space-y-3">${rows.map((row) => buildCard(row, REQUEST_STATUSES, 'request')).join('')}</div>`;
    wireCards(panels.requests, 'support_requests', loadRequests);
  }

  function buildCard(row, statuses, kind) {
    const topicBadge = kind === 'request'
      ? `<span class="inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 mr-2">${escapeHtml(t(`supportRequest.topic.${row.topic}`))}</span>`
      : '';
    const systemBadge = `<span class="inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded ${row._system === 'SAAS' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'} mr-2">${row._system}</span>`;
    return `
      <div class="border border-slate-200 rounded-lg p-4" data-row-id="${row.id}" data-system="${row._system}">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="text-xs text-slate-500">
            ${systemBadge}${topicBadge}<span class="font-medium text-slate-700">${escapeHtml(row.full_name || '—')}</span>
            ${row.tenant_name ? ` · ${escapeHtml(row.tenant_name)}` : ''}
            · ${new Date(row.created_at).toLocaleDateString()}
          </div>
        </div>
        <p class="text-sm text-slate-800 mb-3 whitespace-pre-wrap">${escapeHtml(row.message)}</p>
        <div class="grid sm:grid-cols-[auto_1fr] gap-2 items-start mb-2">
          <select data-el="status" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            ${statuses.map((s) => `<option value="${s}" ${s === row.status ? 'selected' : ''}>${escapeHtml(t(`siteAdmin.status.${s}`))}</option>`).join('')}
          </select>
          <textarea data-el="admin-note" rows="1" placeholder="${escapeHtml(t('siteAdmin.adminNotePlaceholder'))}"
                    class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">${escapeHtml(row.admin_note || '')}</textarea>
        </div>
        <div class="flex items-center gap-2 mb-2">
          <button type="button" data-action="save" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('siteAdmin.save')}</button>
          <span data-el="row-status" class="text-xs text-slate-500"></span>
        </div>
        ${buildReplyBlock(row)}
      </div>
    `;
  }

  function buildReplyBlock(row) {
    return `
      <div class="border-t border-slate-100 pt-2 mt-1">
        ${row.site_admin_reply ? `<p class="text-xs text-slate-500 mb-1">${t('siteAdmin.alreadyReplied', { date: new Date(row.replied_at).toLocaleDateString() })}</p>` : ''}
        <textarea data-el="reply" rows="2" placeholder="${escapeHtml(t('siteAdmin.replyPlaceholder'))}"
                  class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mb-1">${escapeHtml(row.site_admin_reply || '')}</textarea>
        <div class="flex items-center gap-2">
          <button type="button" data-action="reply" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">${t('siteAdmin.sendReply')}</button>
          <span data-el="reply-status" class="text-xs text-slate-500"></span>
        </div>
      </div>
    `;
  }

  function wireCards(panelEl, table, reload) {
    panelEl.querySelectorAll('[data-row-id]').forEach((card) => {
      const id = card.dataset.rowId;
      const client = card.dataset.system === 'SAAS' ? getSaasClient() : supabase;
      card.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const statusEl = card.querySelector('[data-el="row-status"]');
        const status = card.querySelector('[data-el="status"]').value;
        const admin_note = card.querySelector('[data-el="admin-note"]').value.trim() || null;
        statusEl.className = 'text-xs text-slate-500';
        statusEl.textContent = t('common.saving');
        const { error } = await client.from(table).update({ status, admin_note, updated_at: new Date().toISOString() }).eq('id', id);
        statusEl.className = error ? 'text-xs text-rose-600' : 'text-xs text-emerald-600';
        statusEl.textContent = error ? t('siteAdmin.saveFailed', { message: error.message }) : t('siteAdmin.saved');
      });
      card.querySelector('[data-action="reply"]').addEventListener('click', async () => {
        const replyStatusEl = card.querySelector('[data-el="reply-status"]');
        const reply = card.querySelector('[data-el="reply"]').value.trim();
        if (!reply) return;
        replyStatusEl.className = 'text-xs text-slate-500';
        replyStatusEl.textContent = t('common.saving');
        const { error } = await client.from(table).update({ site_admin_reply: reply, replied_at: new Date().toISOString() }).eq('id', id);
        if (error) {
          replyStatusEl.className = 'text-xs text-rose-600';
          replyStatusEl.textContent = t('siteAdmin.replyFailed', { message: error.message });
          return;
        }
        replyStatusEl.className = 'text-xs text-emerald-600';
        replyStatusEl.textContent = t('siteAdmin.replySent');
        reload();
      });
    });
  }

  // ---- Manage Site Admins (Main + SAAS) ----
  async function loadManage() {
    panels.manage.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const { data: mainAdmins, error } = await supabase.rpc('list_site_admins');
    if (error) {
      panels.manage.innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: error.message })}</p>`;
      return;
    }
    loaded.manage = true;

    const sc = getSaasClient();
    const { data: { session } } = await sc.auth.getSession();
    let saasAdmins = [];
    if (session) {
      const { data } = await sc.rpc('list_site_admins');
      saasAdmins = data || [];
    }

    panels.manage.innerHTML = `
      <div class="flex items-end gap-2 mb-4 flex-wrap">
        <div class="flex-1 min-w-[180px]">
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('siteAdmin.addByEmail')}</label>
          <input type="email" data-el="add-email" placeholder="${escapeHtml(t('siteAdmin.emailPlaceholder'))}"
                 class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('siteAdmin.system')}</label>
          <select data-el="add-system" class="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="Main">Main</option>
            ${session ? '<option value="SAAS">SAAS</option>' : ''}
          </select>
        </div>
        <button type="button" data-action="add" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('siteAdmin.add')}</button>
      </div>
      <span data-el="add-status" class="block text-sm mb-3"></span>
      <p class="text-sm font-semibold text-slate-700 mb-2">${t('siteAdmin.currentAdmins')}</p>
      <div data-el="admin-list" class="divide-y border border-slate-200 rounded-lg"></div>
    `;
    renderAdminList([
      ...mainAdmins.map((a) => ({ ...a, _system: 'Main' })),
      ...saasAdmins.map((a) => ({ ...a, _system: 'SAAS' })),
    ]);

    const emailEl = panels.manage.querySelector('[data-el="add-email"]');
    const systemEl = panels.manage.querySelector('[data-el="add-system"]');
    const addStatusEl = panels.manage.querySelector('[data-el="add-status"]');
    panels.manage.querySelector('[data-action="add"]').addEventListener('click', async () => {
      const email = emailEl.value.trim();
      if (!email) return;
      const client = systemEl.value === 'SAAS' ? getSaasClient() : supabase;
      addStatusEl.className = 'block text-sm text-slate-500 mb-3';
      addStatusEl.textContent = t('common.saving');
      const { error } = await client.rpc('grant_site_admin_by_email', { p_email: email });
      if (error) {
        addStatusEl.className = 'block text-sm text-rose-600 mb-3';
        addStatusEl.textContent = t('siteAdmin.addFailed', { message: error.message });
        return;
      }
      emailEl.value = '';
      addStatusEl.textContent = '';
      loaded.manage = false;
      loadManage();
    });
  }

  function renderAdminList(admins) {
    const listEl = panels.manage.querySelector('[data-el="admin-list"]');
    listEl.innerHTML = admins.map((a) => `
      <div class="flex items-center justify-between px-3 py-2" data-admin-id="${a.user_id}" data-system="${a._system}">
        <div>
          <p class="text-sm font-medium text-slate-800">
            ${escapeHtml(a.full_name || '—')}
            <span class="text-[11px] font-semibold px-1.5 py-0.5 rounded ${a._system === 'SAAS' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'}">${a._system}</span>
          </p>
          <p class="text-xs text-slate-500">${escapeHtml(a.tenant_name || '—')} · ${t('siteAdmin.grantedOn', { date: new Date(a.granted_at).toLocaleDateString() })}</p>
        </div>
        <button type="button" data-action="remove" class="text-sm text-rose-600 hover:text-rose-700">${t('siteAdmin.remove')}</button>
      </div>
    `).join('');

    listEl.querySelectorAll('[data-action="remove"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('[data-admin-id]');
        const id = row.dataset.adminId;
        const client = row.dataset.system === 'SAAS' ? getSaasClient() : supabase;
        const name = row.querySelector('p').textContent;
        const ok = await confirmDialog({ message: t('siteAdmin.removeConfirm', { name }) });
        if (!ok) return;
        await client.rpc('revoke_site_admin', { p_user_id: id });
        loaded.manage = false;
        loadManage();
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  renderSaasConnect();
  switchTab('suggestions');
}
