// Super-Admin-only bulk "Import People" tool — reads a spreadsheet
// (.xlsx/.xls/.csv) via SheetJS (window.XLSX, loaded in index.html) and
// creates many people at once, split into two very different outcomes
// per row:
//   - Member rows get a real Supabase Auth account, exactly like
//     userCreatorModal.js's one-at-a-time flow (scopedClient.signUp()
//     so the admin's own session isn't touched), sharing ONE temp
//     password across the whole batch — everyone imported this way
//     logs in with it once and changes it themselves afterward.
//   - Visitor rows never get an account at all — they go straight into
//     guest_follow_ups, the same table the Guest Onboarding Hub already
//     manages, since a visitor has no login concept in this app.
// Auth signups are paced (SIGNUP_DELAY_MS) since Supabase throttles how
// fast new accounts can be created from one client; a large import
// takes a while by design rather than tripping that limit.
import { createScopedClient } from '../supabaseClient.js';
import { departmentLabel, t } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';

const SIGNUP_DELAY_MS = 400;
// Both English and French header names are recognized (this church runs
// bilingually) — normalizeHeader() strips accents before matching, so
// "Département"/"Téléphone" match their unaccented candidates below.
const NAME_HEADERS = ['name', 'fullname', 'nom', 'nomcomplet'];
const EMAIL_HEADERS = ['email', 'emailaddress', 'courriel', 'mail'];
const PHONE_HEADERS = ['phone', 'telephone', 'tel', 'phonenumber', 'numero', 'numerodetelephone'];
const TYPE_HEADERS = ['type', 'status', 'membertype', 'statut'];
const DEPARTMENT_HEADERS = ['department', 'dept', 'ministry', 'departement', 'ministere'];

function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');
}

function findHeaderKey(sampleRow, candidates) {
  const keys = Object.keys(sampleRow || {});
  return keys.find((k) => candidates.includes(normalizeHeader(k))) || null;
}

function resolveType(raw) {
  const normalized = String(raw || '').trim().toLowerCase();
  return normalized.includes('visit') || normalized.includes('guest') ? 'visitor' : 'member';
}

function slugifyName(fullName) {
  return String(fullName || 'member')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .join('.') || 'member';
}

function generatePlaceholderEmail(fullName, usedEmails) {
  const base = slugifyName(fullName);
  let candidate = `${base}@vpd.local`;
  let suffix = 2;
  while (usedEmails.has(candidate.toLowerCase())) {
    candidate = `${base}${suffix}@vpd.local`;
    suffix += 1;
  }
  return candidate;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPeopleImportModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xl font-bold">${t('peopleImport.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-xs text-slate-500 mb-4">${t('peopleImport.intro')}</p>

      <div data-el="upload-step">
        <input type="file" data-el="file-input" accept=".xlsx,.xls,.csv" class="block w-full text-sm mb-2" />
        <p class="text-xs text-slate-500">${t('peopleImport.columnsHint')}</p>
      </div>

      <div data-el="preview-step" class="hidden">
        <div class="mb-4">
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('peopleImport.tempPassword')}</label>
          <div class="flex gap-2 max-w-sm">
            <input type="text" data-el="temp-password" minlength="6"
                   class="flex-1 border border-slate-300 rounded-lg px-3 py-2 font-mono" />
            <button type="button" data-action="generate-password"
                    class="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 whitespace-nowrap">
              ${t('userCreator.generatePassword')}
            </button>
          </div>
          <p class="text-xs text-slate-500 mt-1">${t('peopleImport.tempPasswordHint')}</p>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-lg mb-2">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th class="text-left px-3 py-2">${t('peopleImport.colName')}</th>
                <th class="text-left px-3 py-2">${t('peopleImport.colType')}</th>
                <th class="text-left px-3 py-2">${t('peopleImport.colEmail')}</th>
                <th class="text-left px-3 py-2">${t('peopleImport.colPhone')}</th>
                <th class="text-left px-3 py-2">${t('peopleImport.colDepartment')}</th>
                <th class="text-left px-3 py-2">${t('peopleImport.colStatus')}</th>
              </tr>
            </thead>
            <tbody data-el="preview-body" class="divide-y divide-slate-100"></tbody>
          </table>
        </div>

        <p data-el="summary" class="text-sm text-slate-600 mb-4"></p>

        <div class="flex justify-end gap-2">
          <button type="button" data-action="reset" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            ${t('peopleImport.chooseAnotherFile')}
          </button>
          <button type="button" data-el="import-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('peopleImport.startImport')}
          </button>
        </div>
      </div>

      <div data-el="progress" class="mt-4 text-sm space-y-1"></div>
    </div>
  `;
  document.body.appendChild(root);

  const fileInput = root.querySelector('[data-el="file-input"]');
  const uploadStepEl = root.querySelector('[data-el="upload-step"]');
  const previewStepEl = root.querySelector('[data-el="preview-step"]');
  const tempPasswordEl = root.querySelector('[data-el="temp-password"]');
  const previewBodyEl = root.querySelector('[data-el="preview-body"]');
  const summaryEl = root.querySelector('[data-el="summary"]');
  const importBtn = root.querySelector('[data-el="import-btn"]');
  const progressEl = root.querySelector('[data-el="progress"]');

  let departments = [];
  let rows = [];

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="reset"]').addEventListener('click', resetToUpload);
  root.querySelector('[data-action="generate-password"]').addEventListener('click', () => {
    tempPasswordEl.value = generateTempPassword();
  });
  fileInput.addEventListener('change', handleFile);
  // 'change' only (fires on blur for text inputs, immediately for
  // selects) — not 'input', since renderPreview() below rebuilds every
  // cell's DOM node, which would drop focus after every keystroke.
  previewBodyEl.addEventListener('change', handleRowFieldChange);
  importBtn.addEventListener('click', runImport);

  async function loadDepartments() {
    const { data } = await supabase.from('departments').select('id, key, name').order('name');
    departments = data || [];
  }

  function matchDepartment(text) {
    const needle = String(text || '').trim().toLowerCase();
    if (!needle) return null;
    const found = departments.find((d) => (
      d.name.toLowerCase() === needle
      || d.key.toLowerCase() === needle
      || departmentLabel(d.key).toLowerCase() === needle
    ));
    return found ? found.id : null;
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    // open() kicks off loadDepartments() but doesn't wait for it — guard
    // here too so a very fast file pick can't race ahead of it and match
    // nothing.
    if (departments.length === 0) await loadDepartments();

    let rawRows;
    try {
      const buffer = await file.arrayBuffer();
      // XLSX's type:'array' means "array of 8-bit ints" — a raw
      // ArrayBuffer isn't one, only a typed array/plain array is, so
      // this must be wrapped or SheetJS silently misreads it.
      const workbook = window.XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      rawRows = window.XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
    } catch (err) {
      window.alert(t('peopleImport.parseFailed', { message: err.message }));
      fileInput.value = '';
      return;
    }

    if (rawRows.length === 0) {
      window.alert(t('peopleImport.emptyFile'));
      fileInput.value = '';
      return;
    }

    const nameKey = findHeaderKey(rawRows[0], NAME_HEADERS);
    const emailKey = findHeaderKey(rawRows[0], EMAIL_HEADERS);
    const phoneKey = findHeaderKey(rawRows[0], PHONE_HEADERS);
    const typeKey = findHeaderKey(rawRows[0], TYPE_HEADERS);
    const departmentKey = findHeaderKey(rawRows[0], DEPARTMENT_HEADERS);

    rows = rawRows.map((raw, index) => {
      const departmentText = departmentKey ? String(raw[departmentKey] || '').trim() : '';
      return {
        index,
        full_name: nameKey ? String(raw[nameKey] || '').trim() : '',
        email: emailKey ? String(raw[emailKey] || '').trim() : '',
        phone: phoneKey ? String(raw[phoneKey] || '').trim() : '',
        type: resolveType(typeKey ? raw[typeKey] : ''),
        departmentText,
        departmentId: matchDepartment(departmentText),
      };
    });

    renderPreview();
    uploadStepEl.classList.add('hidden');
    previewStepEl.classList.remove('hidden');
  }

  function renderPreview() {
    const usedEmails = new Map(); // lowercased email -> count, for duplicate detection

    rows.forEach((row) => {
      const email = row.email.trim().toLowerCase();
      if (email) usedEmails.set(email, (usedEmails.get(email) || 0) + 1);
    });

    previewBodyEl.innerHTML = rows.map((row) => {
      const warnings = [];
      if (!row.full_name) warnings.push(t('peopleImport.warnMissingName'));
      const emailLower = row.email.trim().toLowerCase();
      if (emailLower && usedEmails.get(emailLower) > 1) warnings.push(t('peopleImport.warnDuplicateEmail'));
      if (row.type === 'member' && !row.email) warnings.push(t('peopleImport.infoPlaceholderEmail'));
      if (row.departmentText && !row.departmentId) warnings.push(t('peopleImport.warnDepartmentNotMatched'));

      const statusHtml = warnings.length === 0
        ? `<span class="text-emerald-600">${t('peopleImport.statusOk')}</span>`
        : `<span class="text-amber-600">${escapeHtml(warnings.join('; '))}</span>`;

      return `
        <tr data-row-index="${row.index}" class="${row.full_name ? '' : 'bg-rose-50'}">
          <td class="px-2 py-1.5"><input type="text" data-field="full_name" data-row="${row.index}" value="${escapeHtml(row.full_name)}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5">
            <select data-field="type" data-row="${row.index}" class="w-full border border-slate-200 rounded px-2 py-1">
              <option value="member" ${row.type === 'member' ? 'selected' : ''}>${t('peopleImport.typeMember')}</option>
              <option value="visitor" ${row.type === 'visitor' ? 'selected' : ''}>${t('peopleImport.typeVisitor')}</option>
            </select>
          </td>
          <td class="px-2 py-1.5"><input type="email" data-field="email" data-row="${row.index}" value="${escapeHtml(row.email)}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5"><input type="text" data-field="phone" data-row="${row.index}" value="${escapeHtml(row.phone)}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5">
            <select data-field="department" data-row="${row.index}" class="w-full border border-slate-200 rounded px-2 py-1">
              <option value="">—</option>
              ${departments.map((d) => `<option value="${d.id}" ${row.departmentId === d.id ? 'selected' : ''}>${escapeHtml(departmentLabel(d.key))}</option>`).join('')}
            </select>
          </td>
          <td class="px-2 py-1.5 text-xs">${statusHtml}</td>
        </tr>
      `;
    }).join('');

    updateSummary();
  }

  function handleRowFieldChange(e) {
    const field = e.target.dataset.field;
    if (!field) return;
    const row = rows.find((r) => r.index === Number(e.target.dataset.row));
    if (!row) return;

    if (field === 'department') row.departmentId = e.target.value || null;
    else row[field] = e.target.value;

    renderPreview();
  }

  function updateSummary() {
    const validRows = rows.filter((r) => r.full_name);
    const memberCount = validRows.filter((r) => r.type === 'member').length;
    const visitorCount = validRows.filter((r) => r.type === 'visitor').length;
    const skippedCount = rows.length - validRows.length;

    summaryEl.textContent = t('peopleImport.summary', { members: memberCount, visitors: visitorCount, skipped: skippedCount });
    importBtn.disabled = validRows.length === 0;
  }

  function resetToUpload() {
    rows = [];
    fileInput.value = '';
    progressEl.innerHTML = '';
    previewStepEl.classList.add('hidden');
    uploadStepEl.classList.remove('hidden');
  }

  function logLine(text, tone = 'info') {
    const line = document.createElement('div');
    line.className = tone === 'error' ? 'text-rose-600' : tone === 'success' ? 'text-emerald-600' : 'text-slate-600';
    line.textContent = text;
    progressEl.appendChild(line);
    progressEl.scrollTop = progressEl.scrollHeight;
  }

  async function runImport() {
    const validRows = rows.filter((r) => r.full_name);
    const memberCount = validRows.filter((r) => r.type === 'member').length;
    const visitorCount = validRows.filter((r) => r.type === 'visitor').length;
    const password = tempPasswordEl.value;

    if (memberCount > 0 && password.length < 6) {
      window.alert(t('peopleImport.passwordTooShort'));
      return;
    }
    if (!(await confirmDialog({
      message: t('peopleImport.confirmMessage', { members: memberCount, visitors: visitorCount }),
      confirmLabel: t('peopleImport.startImport'),
      danger: false,
    }))) return;

    importBtn.disabled = true;
    progressEl.innerHTML = '';

    const scopedClient = createScopedClient();
    const usedEmails = new Set(validRows.filter((r) => r.email).map((r) => r.email.trim().toLowerCase()));

    for (const row of validRows) {
      if (row.type === 'visitor') {
        const { error } = await supabase.from('guest_follow_ups').insert({
          full_name: row.full_name,
          phone: row.phone || null,
          email: row.email || null,
          assigned_department_id: row.departmentId || null,
          source: 'import',
          created_by: currentUserId,
        });
        if (error) logLine(t('peopleImport.rowFailed', { name: row.full_name, message: error.message }), 'error');
        else logLine(t('peopleImport.visitorAdded', { name: row.full_name }), 'success');
        continue;
      }

      const email = row.email.trim() || generatePlaceholderEmail(row.full_name, usedEmails);
      usedEmails.add(email.toLowerCase());

      const { data, error } = await scopedClient.auth.signUp({
        email,
        password,
        options: { data: { full_name: row.full_name } },
      });
      const alreadyRegistered = !error && data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;

      if (error || alreadyRegistered) {
        logLine(t('peopleImport.rowFailed', {
          name: row.full_name,
          message: alreadyRegistered ? t('userCreator.emailAlreadyRegistered') : error.message,
        }), 'error');
        await sleep(SIGNUP_DELAY_MS);
        continue;
      }

      const newUserId = data.user.id;
      const { error: profileError } = await supabase.from('profiles').update({ phone: row.phone || null }).eq('id', newUserId);

      let membershipError = null;
      if (row.departmentId) {
        ({ error: membershipError } = await supabase.from('department_memberships').insert({
          user_id: newUserId,
          department_id: row.departmentId,
          role: 'member',
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: currentUserId,
        }));
      }

      if (profileError || membershipError) {
        logLine(t('peopleImport.memberCreatedWithWarning', { name: row.full_name, email, message: (profileError || membershipError).message }), 'error');
      } else {
        logLine(t('peopleImport.memberCreated', { name: row.full_name, email }), 'success');
      }

      await sleep(SIGNUP_DELAY_MS);
    }

    logLine(t('peopleImport.allDone', { password }), 'success');
    importBtn.disabled = false;
  }

  function generateTempPassword() {
    const bytes = new Uint8Array(9);
    window.crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12);
  }

  function open() {
    resetToUpload();
    tempPasswordEl.value = generateTempPassword();
    root.classList.remove('hidden');
    root.classList.add('flex');
    loadDepartments();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open, root };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
