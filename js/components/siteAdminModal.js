// Site Admin console — platform-wide, not scoped to any tenant (see
// is_site_admin()/sql/049). Four tabs: Website Inquiries (anonymous,
// pre-signup leads from the marketing page's contact form, sql/053),
// App Suggestions and Support Requests submitted by anyone on any
// church on the platform (via the list_*_for_site_admin() RPCs, which
// bypass each row's own tenant_isolation the same way every other
// cross-tenant lookup in this app already does), and a simple
// add/remove-by-email console for who else holds the role.
import { t } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';

const SUGGESTION_STATUSES = ['new', 'planned', 'done', 'declined'];
const REQUEST_STATUSES = ['new', 'answered', 'closed'];
const INQUIRY_STATUSES = ['new', 'contacted', 'closed'];
const INQUIRY_TOPIC_KEYS = { demo: 'welcome.topicDemo', general: 'welcome.topicGeneral', support: 'welcome.topicSupport' };

export function createSiteAdminModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('siteAdmin.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>

      <div class="flex gap-2 mb-4 border-b border-slate-200 flex-wrap">
        <button type="button" data-tab="inquiries" class="px-3 py-2 text-sm font-medium border-b-2 border-indigo-600 text-indigo-600">${t('siteAdmin.tabInquiries')}</button>
        <button type="button" data-tab="suggestions" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabSuggestions')}</button>
        <button type="button" data-tab="requests" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabRequests')}</button>
        <button type="button" data-tab="manage" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('siteAdmin.tabManage')}</button>
      </div>

      <div data-panel="inquiries"></div>
      <div data-panel="suggestions" class="hidden"></div>
      <div data-panel="requests" class="hidden"></div>
      <div data-panel="manage" class="hidden"></div>
    </div>
  `;
  document.body.appendChild(root);

  const tabBtns = root.querySelectorAll('[data-tab]');
  const panels = {
    inquiries: root.querySelector('[data-panel="inquiries"]'),
    suggestions: root.querySelector('[data-panel="suggestions"]'),
    requests: root.querySelector('[data-panel="requests"]'),
    manage: root.querySelector('[data-panel="manage"]'),
  };
  const loaded = { inquiries: false, suggestions: false, requests: false, manage: false };

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

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
    if (tab === 'manage' && !loaded.manage) loadManage();
  }

  async function loadInquiries() {
    panels.inquiries.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase.rpc('list_website_inquiries_for_site_admin');
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
    wireCards(panels.inquiries, 'website_inquiries', loadInquiries);
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
        <div class="grid sm:grid-cols-[auto_1fr] gap-2 items-start">
          <select data-el="status" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            ${INQUIRY_STATUSES.map((s) => `<option value="${s}" ${s === row.status ? 'selected' : ''}>${escapeHtml(t(`siteAdmin.status.${s}`))}</option>`).join('')}
          </select>
          <textarea data-el="admin-note" rows="1" placeholder="${escapeHtml(t('siteAdmin.adminNotePlaceholder'))}"
                    class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">${escapeHtml(row.admin_note || '')}</textarea>
        </div>
        <div class="flex items-center gap-2 mt-2">
          <button type="button" data-action="save" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('siteAdmin.save')}</button>
          <span data-el="row-status" class="text-xs text-slate-500"></span>
        </div>
      </div>
    `;
  }

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
            · ${escapeHtml(row.tenant_name || '—')}
            · ${new Date(row.created_at).toLocaleDateString()}
          </div>
        </div>
        <p class="text-sm text-slate-800 mb-3 whitespace-pre-wrap">${escapeHtml(row.message)}</p>
        <div class="grid sm:grid-cols-[auto_1fr] gap-2 items-start">
          <select data-el="status" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            ${statuses.map((s) => `<option value="${s}" ${s === row.status ? 'selected' : ''}>${escapeHtml(t(`siteAdmin.status.${s}`))}</option>`).join('')}
          </select>
          <textarea data-el="admin-note" rows="1" placeholder="${escapeHtml(t('siteAdmin.adminNotePlaceholder'))}"
                    class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">${escapeHtml(row.admin_note || '')}</textarea>
        </div>
        <div class="flex items-center gap-2 mt-2">
          <button type="button" data-action="save" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('siteAdmin.save')}</button>
          <span data-el="row-status" class="text-xs text-slate-500"></span>
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
        if (error) {
          statusEl.className = 'text-xs text-rose-600';
          statusEl.textContent = t('siteAdmin.saveFailed', { message: error.message });
          return;
        }
        statusEl.className = 'text-xs text-emerald-600';
        statusEl.textContent = t('siteAdmin.saved');
      });
    });
  }

  async function loadManage() {
    panels.manage.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    const { data, error } = await supabase.rpc('list_site_admins');
    if (error) {
      panels.manage.innerHTML = `<p class="text-rose-600">${t('siteAdmin.loadFailed', { message: error.message })}</p>`;
      return;
    }
    loaded.manage = true;
    panels.manage.innerHTML = `
      <div class="flex items-end gap-2 mb-4">
        <div class="flex-1">
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
    renderAdminList(data);

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
    listEl.innerHTML = admins.map((a) => `
      <div class="flex items-center justify-between px-3 py-2" data-admin-id="${a.user_id}">
        <div>
          <p class="text-sm font-medium text-slate-800">${escapeHtml(a.full_name || '—')}</p>
          <p class="text-xs text-slate-500">${escapeHtml(a.tenant_name || '—')} · ${t('siteAdmin.grantedOn', { date: new Date(a.granted_at).toLocaleDateString() })}</p>
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

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    loaded.inquiries = false;
    loaded.suggestions = false;
    loaded.requests = false;
    loaded.manage = false;
    switchTab('inquiries');
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}
