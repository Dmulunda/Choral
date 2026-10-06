// Site Admin — a full page (not a popup), reached only via the
// tools-menu "Site Admin" entry, same pattern as js/pastorMeetingsPage.js.
// Three tabs: App Suggestions and Support Requests submitted by any
// signed-in member (via the list_*_for_site_admin() RPCs), and a
// simple add/remove-by-email console for who else holds the role.
//
// This is Main's own, single-tenant copy of SAAS's siteAdminPage.js --
// trimmed down to what actually applies here. Dropped entirely:
// Website Inquiries and Churches (both SAAS-marketing/multi-tenant
// concepts with no equivalent on a one-church install) and the
// Training Sandbox (practicing "being a different church" makes no
// sense when there's only ever one). Also dropped: the cross-system
// "connect to Main" panel SAAS's version has -- that panel exists so
// a SAAS-hosted Site Admin can ALSO reach into Main from one
// dashboard; it has no reason to exist here, since this page already
// IS Main.
//
// Replies (same shape as SAAS's sql/061): a Site Admin's status/
// admin_note edit is internal-only; `site_admin_reply` is the
// distinct, submitter-facing field, delivered via the notifications
// bell.
import { t } from './i18n.js';
import { confirmDialog } from './components/confirmDialog.js';
import { getEffectiveSupabase } from './departments.js';

const SUGGESTION_STATUSES = ['new', 'planned', 'done', 'declined'];
const REQUEST_STATUSES = ['new', 'answered', 'closed'];

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
    <div class="flex gap-2 mb-4 border-b border-slate-200 flex-wrap">
      <button type="button" data-tab="suggestions" class="px-3 py-2 text-sm font-medium border-b-2 border-indigo-600 text-indigo-600">${t('siteAdmin.tabSuggestions')}</button>
      <button type="button" data-tab="requests" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabRequests')}</button>
      <button type="button" data-tab="manage" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabManage')}</button>
    </div>

    <div data-panel="suggestions"></div>
    <div data-panel="requests" class="hidden"></div>
    <div data-panel="manage" class="hidden"></div>
  `;

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

  // ---- Suggestions / Requests ----

  async function loadSuggestions() {
    panels.suggestions.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase.rpc('list_app_suggestions_for_site_admin');
    if (error) {
      panels.suggestions.innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: error.message })}</p>`;
      return;
    }
    loaded.suggestions = true;
    if (!data.length) {
      panels.suggestions.innerHTML = `<p class="text-slate-400">${t('siteAdmin.noSuggestions')}</p>`;
      return;
    }
    panels.suggestions.innerHTML = `<div class="space-y-3">${data.map((row) => buildCard(row, SUGGESTION_STATUSES, 'suggestion')).join('')}</div>`;
    wireCards(panels.suggestions, 'app_suggestions', loadSuggestions);
  }

  async function loadRequests() {
    panels.requests.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase.rpc('list_support_requests_for_site_admin');
    if (error) {
      panels.requests.innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: error.message })}</p>`;
      return;
    }
    loaded.requests = true;
    if (!data.length) {
      panels.requests.innerHTML = `<p class="text-slate-400">${t('siteAdmin.noRequests')}</p>`;
      return;
    }
    panels.requests.innerHTML = `<div class="space-y-3">${data.map((row) => buildCard(row, REQUEST_STATUSES, 'request')).join('')}</div>`;
    wireCards(panels.requests, 'support_requests', loadRequests);
  }

  function buildCard(row, statuses, kind) {
    const topicBadge = kind === 'request'
      ? `<span class="inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 mr-2">${escapeHtml(t(`supportRequest.topic.${row.topic}`))}</span>`
      : '';
    return `
      <div class="border border-slate-200 rounded-lg p-4" data-row-id="${row.id}">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="text-xs text-slate-500">
            ${topicBadge}<span class="font-medium text-slate-700">${escapeHtml(row.full_name || '—')}</span>
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
      card.querySelector('[data-action="save"]').addEventListener('click', async () => {
        const statusEl = card.querySelector('[data-el="row-status"]');
        const status = card.querySelector('[data-el="status"]').value;
        const admin_note = card.querySelector('[data-el="admin-note"]').value.trim() || null;
        statusEl.className = 'text-xs text-slate-500';
        statusEl.textContent = t('common.saving');
        const { error } = await supabase.from(table).update({ status, admin_note, updated_at: new Date().toISOString() }).eq('id', id);
        statusEl.className = error ? 'text-xs text-rose-600' : 'text-xs text-emerald-600';
        statusEl.textContent = error ? t('siteAdmin.saveFailed', { message: error.message }) : t('siteAdmin.saved');
      });
      card.querySelector('[data-action="reply"]').addEventListener('click', async () => {
        const replyStatusEl = card.querySelector('[data-el="reply-status"]');
        const reply = card.querySelector('[data-el="reply"]').value.trim();
        if (!reply) return;
        replyStatusEl.className = 'text-xs text-slate-500';
        replyStatusEl.textContent = t('common.saving');
        const { error } = await supabase.from(table).update({ site_admin_reply: reply, replied_at: new Date().toISOString() }).eq('id', id);
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

  // ---- Manage Site Admins ----

  async function loadManage() {
    panels.manage.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const { data: admins, error } = await supabase.rpc('list_site_admins');
    if (error) {
      panels.manage.innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: error.message })}</p>`;
      return;
    }
    loaded.manage = true;

    panels.manage.innerHTML = `
      <div class="flex items-end gap-2 mb-4 flex-wrap">
        <div class="flex-1 min-w-[180px]">
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('siteAdmin.addByEmail')}</label>
          <input type="email" data-el="add-email" placeholder="${escapeHtml(t('siteAdmin.emailPlaceholder'))}"
                 class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <button type="button" data-action="add" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('siteAdmin.add')}</button>
      </div>
      <span data-el="add-status" class="block text-sm mb-3"></span>
      <p class="text-sm font-semibold text-slate-700 mb-2">${t('siteAdmin.currentAdmins')}</p>
      <div data-el="admin-list" class="divide-y border border-slate-200 rounded-lg"></div>
    `;
    renderAdminList(admins);

    const emailEl = panels.manage.querySelector('[data-el="add-email"]');
    const addStatusEl = panels.manage.querySelector('[data-el="add-status"]');
    panels.manage.querySelector('[data-action="add"]').addEventListener('click', async () => {
      const email = emailEl.value.trim();
      if (!email) return;
      addStatusEl.className = 'block text-sm text-slate-500 mb-3';
      addStatusEl.textContent = t('common.saving');
      const { error } = await supabase.rpc('grant_site_admin_by_email', { p_email: email });
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
    listEl.innerHTML = (admins || []).map((a) => `
      <div class="flex items-center justify-between px-3 py-2" data-admin-id="${a.user_id}">
        <div>
          <p class="text-sm font-medium text-slate-800">${escapeHtml(a.full_name || '—')}</p>
          <p class="text-xs text-slate-500">${t('siteAdmin.grantedOn', { date: new Date(a.granted_at).toLocaleDateString() })}</p>
        </div>
        <button type="button" data-action="remove" class="text-sm text-rose-600 hover:text-rose-700">${t('siteAdmin.remove')}</button>
      </div>
    `).join('');

    listEl.querySelectorAll('[data-action="remove"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('[data-admin-id]');
        const id = row.dataset.adminId;
        const name = row.querySelector('p').textContent;
        const ok = await confirmDialog({ message: t('siteAdmin.removeConfirm', { name }) });
        if (!ok) return;
        await supabase.rpc('revoke_site_admin', { p_user_id: id });
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

  switchTab('suggestions');
}
