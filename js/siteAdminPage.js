// Site Admin — a full page (not a popup), reached only via the
// tools-menu "Site Admin" entry, same pattern as js/pastorMeetingsPage.js.
// Six tabs, mirroring SAAS's own siteAdminPage.js in full: Website
// Inquiries (SAAS-only, pre-signup leads from the marketing page's
// contact form), App Suggestions and Support Requests submitted by
// anyone on either system (via the list_*_for_site_admin() RPCs,
// which bypass each row's own tenant_isolation the same way every
// other cross-tenant lookup in this app already does), Churches
// (SAAS-only, every tenant there), Training Sandbox (SAAS-only --
// see below), and a simple add/remove-by-email console for who else
// holds the role.
//
// Main has only one church, so Inquiries/Churches/Sandbox have no
// local equivalent at all -- those three tabs always operate against
// SAAS specifically (via a second Supabase client, the mirror image
// of SAAS's own "connect to Main" panel) rather than trying to fake a
// Main-side version that wouldn't mean anything. Suggestions/Requests/
// Manage merge both systems' data once connected, same as SAAS's page
// does for Main.
//
// Training Sandbox doesn't get its own in-page UI here at all --
// "being a different church" to practice in is itself a SAAS-only
// concept (sql/064's shared practice tenant, entered via
// acting_as_tenant_id), and actually USING it means being inside
// SAAS's own department/dashboard UI, which doesn't exist in this
// codebase and isn't worth duplicating just to host one feature. This
// tab is just a link to open SAAS directly, where the real feature
// already lives.
//
// Replies (same shape as SAAS's sql/061): a Site Admin's status/
// admin_note edit is internal-only; `site_admin_reply` is the
// distinct, submitter-facing field, delivered via the notifications
// bell for suggestions/requests, or by email for anonymous
// website_inquiries (site-admin-usage Edge Function's reply_to_inquiry
// action, since there's no account to notify).
import { t } from './i18n.js';
import { confirmDialog } from './components/confirmDialog.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { getEffectiveSupabase } from './departments.js';

const SUGGESTION_STATUSES = ['new', 'planned', 'done', 'declined'];
const REQUEST_STATUSES = ['new', 'answered', 'closed'];
const INQUIRY_STATUSES = ['new', 'contacted', 'closed'];
const INQUIRY_TOPIC_KEYS = { demo: 'welcome.topicDemo', general: 'welcome.topicGeneral', support: 'welcome.topicSupport' };

const SAAS_URL = 'https://towlqbxvhftzjfrtepsy.supabase.co';
const SAAS_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvd2xxYnh2aGZ0empmcnRlcHN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNzY2NjIsImV4cCI6MjEwNDY1MjY2Mn0.k3tlKMNNlpd-TGcd5hnyDfSzNcdmy8QLKiRYKkOEa-c';
// Real SAAS app shell -- the Training Sandbox tab links straight here,
// and this is also where a Site Admin signs in normally to use any of
// SAAS's own UI the embedded API connection above can't substitute for.
const SAAS_APP_URL = 'https://dmulunda.github.io/ChurchOs/app.html';

let saasClient = null;
function getSaasClient() {
  if (!saasClient) saasClient = createClient(SAAS_URL, SAAS_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  return saasClient;
}

// supabase-js's functions.invoke() only gives a generic "Edge Function
// returned a non-2xx status code" in error.message -- the real reason
// (the JSON body this function's own error responses carry) is on
// error.context, a raw Response object whose body hasn't been read yet.
async function extractFunctionErrorMessage(error) {
  if (!error) return 'Unknown error';
  try {
    const body = await error.context?.clone().json();
    if (body?.error) return body.error;
  } catch { /* context wasn't JSON (e.g. a network failure) -- fall through */ }
  return error.message || 'Unknown error';
}

function centsOrBytesToSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
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
      <button type="button" data-tab="inquiries" class="px-3 py-2 text-sm font-medium border-b-2 border-indigo-600 text-indigo-600">${t('siteAdmin.tabInquiries')}</button>
      <button type="button" data-tab="suggestions" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabSuggestions')}</button>
      <button type="button" data-tab="requests" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabRequests')}</button>
      <button type="button" data-tab="churches" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabChurches')}</button>
      <button type="button" data-tab="sandbox" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabSandbox')}</button>
      <button type="button" data-tab="manage" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabManage')}</button>
    </div>

    <div data-panel="inquiries"></div>
    <div data-panel="suggestions" class="hidden"></div>
    <div data-panel="requests" class="hidden"></div>
    <div data-panel="churches" class="hidden"></div>
    <div data-panel="sandbox" class="hidden"></div>
    <div data-panel="manage" class="hidden"></div>
  `;

  const saasConnectEl = container.querySelector('[data-el="saas-connect"]');
  const tabBtns = container.querySelectorAll('[data-tab]');
  const panels = {
    inquiries: container.querySelector('[data-panel="inquiries"]'),
    suggestions: container.querySelector('[data-panel="suggestions"]'),
    requests: container.querySelector('[data-panel="requests"]'),
    churches: container.querySelector('[data-panel="churches"]'),
    sandbox: container.querySelector('[data-panel="sandbox"]'),
    manage: container.querySelector('[data-panel="manage"]'),
  };
  const loaded = { inquiries: false, suggestions: false, requests: false, churches: false, sandbox: false, manage: false };

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
    if (tab === 'inquiries' && !loaded.inquiries) loadInquiries();
    if (tab === 'suggestions' && !loaded.suggestions) loadSuggestions();
    if (tab === 'requests' && !loaded.requests) loadRequests();
    if (tab === 'churches' && !loaded.churches) loadChurches();
    if (tab === 'sandbox' && !loaded.sandbox) loadSandbox();
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
        loaded.inquiries = false; loaded.suggestions = false; loaded.requests = false;
        loaded.churches = false; loaded.sandbox = false; loaded.manage = false;
        Object.keys(panels).forEach((tab) => { if (!panels[tab].classList.contains('hidden')) switchTab(tab); });
      });
    }
  }

  // Both tabs below have no Main-side equivalent at all -- they always
  // read SAAS specifically, and need a connected SAAS session to mean
  // anything, unlike Suggestions/Requests/Manage (which show Main's
  // own data either way, SAAS's on top once connected).
  async function requireSaasSession() {
    const client = getSaasClient();
    const { data: { session } } = await client.auth.getSession();
    return session ? client : null;
  }

  // ---- Website Inquiries (SAAS only) ----
  async function loadInquiries() {
    panels.inquiries.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const client = await requireSaasSession();
    if (!client) {
      panels.inquiries.innerHTML = `<p class="text-slate-400">${t('siteAdmin.connectSaasFirst')}</p>`;
      return;
    }
    const { data, error } = await client.rpc('list_website_inquiries_for_site_admin');
    if (error) {
      panels.inquiries.innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: error.message })}</p>`;
      return;
    }
    loaded.inquiries = true;
    if (!data.length) {
      panels.inquiries.innerHTML = `<p class="text-slate-400">${t('siteAdmin.noInquiries')}</p>`;
      return;
    }
    panels.inquiries.innerHTML = `<div class="space-y-3">${data.map((row) => buildInquiryCard(row)).join('')}</div>`;
    wireInquiryCards(client);
  }

  function buildInquiryCard(row) {
    const topicLabel = t(INQUIRY_TOPIC_KEYS[row.topic] || '') || row.topic;
    const topicBadge = `<span class="inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 mr-2">${escapeHtml(topicLabel)}</span>`;
    const contactBits = [row.email, row.phone, row.church_name].filter(Boolean).map(escapeHtml).join(' · ');
    return `
      <div class="border border-slate-200 rounded-lg p-4" data-row-id="${row.id}">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="text-xs text-slate-500">
            ${topicBadge}<span class="font-medium text-slate-700">${escapeHtml(row.name)}</span>
            ${contactBits ? ` · ${contactBits}` : ''}
            · ${new Date(row.created_at).toLocaleDateString()}
          </div>
        </div>
        ${row.message ? `<p class="text-sm text-slate-800 mb-3 whitespace-pre-wrap">${escapeHtml(row.message)}</p>` : ''}
        <div class="grid sm:grid-cols-[auto_1fr] gap-2 items-start mb-2">
          <select data-el="status" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            ${INQUIRY_STATUSES.map((s) => `<option value="${s}" ${s === row.status ? 'selected' : ''}>${escapeHtml(t(`siteAdmin.status.${s}`))}</option>`).join('')}
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

  function wireInquiryCards(client) {
    panels.inquiries.querySelectorAll('[data-row-id]').forEach((card) => {
      const id = card.dataset.rowId;
      card.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const statusEl = card.querySelector('[data-el="row-status"]');
        const status = card.querySelector('[data-el="status"]').value;
        const admin_note = card.querySelector('[data-el="admin-note"]').value.trim() || null;
        statusEl.className = 'text-xs text-slate-500';
        statusEl.textContent = t('common.saving');
        const { error } = await client.from('website_inquiries').update({ status, admin_note, updated_at: new Date().toISOString() }).eq('id', id);
        statusEl.className = error ? 'text-xs text-rose-600' : 'text-xs text-emerald-600';
        statusEl.textContent = error ? t('siteAdmin.saveFailed', { message: error.message }) : t('siteAdmin.saved');
      });
      card.querySelector('[data-action="reply"]').addEventListener('click', async () => {
        const replyStatusEl = card.querySelector('[data-el="reply-status"]');
        const reply = card.querySelector('[data-el="reply"]').value.trim();
        if (!reply) return;
        replyStatusEl.className = 'text-xs text-slate-500';
        replyStatusEl.textContent = t('common.saving');
        const { data, error } = await client.functions.invoke('site-admin-usage', {
          body: { action: 'reply_to_inquiry', inquiry_id: id, reply },
        });
        if (error || data?.error) {
          replyStatusEl.className = 'text-xs text-rose-600';
          replyStatusEl.textContent = t('siteAdmin.replyFailed', { message: data?.error || await extractFunctionErrorMessage(error) });
          return;
        }
        replyStatusEl.className = 'text-xs text-emerald-600';
        replyStatusEl.textContent = t('siteAdmin.replySent');
        loaded.inquiries = false;
        loadInquiries();
      });
    });
  }

  // ---- Churches (SAAS only) ----
  async function loadChurches() {
    panels.churches.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const client = await requireSaasSession();
    if (!client) {
      panels.churches.innerHTML = `<p class="text-slate-400">${t('siteAdmin.connectSaasFirst')}</p>`;
      return;
    }
    const [{ data: tenants, error }, usageResp] = await Promise.all([
      client.rpc('list_all_tenants_for_site_admin'),
      client.functions.invoke('site-admin-usage').catch(() => ({ data: null, error: null })),
    ]);
    if (error) {
      panels.churches.innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: error.message })}</p>`;
      return;
    }
    loaded.churches = true;
    const r2ByTenant = usageResp?.data?.byTenant || {};

    panels.churches.innerHTML = `
      <div class="overflow-x-auto border border-slate-200 rounded-lg mb-2">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th class="text-left px-3 py-2">${t('siteAdmin.colChurch')}</th>
              <th class="text-left px-3 py-2">${t('siteAdmin.colStatus')}</th>
              <th class="text-right px-3 py-2">${t('siteAdmin.colMembers')}</th>
              <th class="text-right px-3 py-2">${t('siteAdmin.colStorage')}</th>
              <th class="text-left px-3 py-2">${t('siteAdmin.colLastActive')}</th>
              <th class="text-left px-3 py-2"></th>
            </tr>
          </thead>
          <tbody data-el="rows"></tbody>
        </table>
      </div>
      <p class="text-xs text-slate-500">${t('siteAdmin.churchesCount', { count: (tenants || []).filter((t2) => !t2.deleted_at).length })}</p>
    `;
    const rowsEl = panels.churches.querySelector('[data-el="rows"]');
    rowsEl.innerHTML = (tenants || []).map((row) => {
      const totalBytes = Number(row.storage_bytes || 0) + Number(r2ByTenant[row.id] || 0);
      const isDeleted = !!row.deleted_at;
      return `
        <tr class="border-b border-slate-100 ${isDeleted ? 'bg-rose-50 opacity-70' : ''}" data-row-id="${row.id}">
          <td class="px-3 py-2 font-medium text-slate-800">${escapeHtml(row.name)}${isDeleted ? ` <span class="text-xs text-rose-600">(${t('siteAdmin.deleted')})</span>` : ''}</td>
          <td class="px-3 py-2">${escapeHtml(row.status)}</td>
          <td class="px-3 py-2 text-right">${row.member_count} / ${row.department_count}</td>
          <td class="px-3 py-2 text-right whitespace-nowrap">${centsOrBytesToSize(totalBytes)}</td>
          <td class="px-3 py-2 text-slate-500">${row.last_active_at ? new Date(row.last_active_at).toLocaleDateString() : '—'}</td>
          <td class="px-3 py-2 text-right">
            ${isDeleted
              ? `<button type="button" data-action="restore" class="text-xs text-indigo-600 hover:text-indigo-700 font-medium">${t('siteAdmin.restore')}</button>`
              : `<button type="button" data-action="delete" class="text-xs text-rose-600 hover:text-rose-700">${t('siteAdmin.delete')}</button>`}
          </td>
        </tr>
      `;
    }).join('');

    rowsEl.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('[data-row-id]');
        const id = row.dataset.rowId;
        const name = row.querySelector('td').textContent;
        const ok = await confirmDialog({ message: t('siteAdmin.deleteChurchConfirm', { name }), danger: true });
        if (!ok) return;
        await client.rpc('soft_delete_tenant', { p_tenant_id: id });
        loaded.churches = false;
        loadChurches();
      });
    });
    rowsEl.querySelectorAll('[data-action="restore"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-row-id]').dataset.rowId;
        await client.rpc('restore_tenant', { p_tenant_id: id });
        loaded.churches = false;
        loadChurches();
      });
    });
  }

  // ---- Training Sandbox (SAAS only -- see header comment) ----
  async function loadSandbox() {
    loaded.sandbox = true;
    panels.sandbox.innerHTML = `
      <p class="text-sm text-slate-600 mb-4">${t('siteAdmin.sandboxSaasIntro')}</p>
      <a href="${SAAS_APP_URL}" target="_blank" rel="noopener" class="inline-block px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('siteAdmin.openSaas')}</a>
    `;
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
