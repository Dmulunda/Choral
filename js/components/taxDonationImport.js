// Finance-only donation spreadsheet import for Tax Receipts —
// structurally the same two-step upload/review shape as
// peopleImportModal.js (parse with window.XLSX, editable preview
// table, confirmDialog() before committing), adapted for
// name/date/amount rows that get fuzzy-matched against member
// profiles (js/utils/nameMatch.js, an 80%-similarity suggestion —
// never applied automatically, every row still needs an explicit
// admin confirm/correct before anything is written). A row Finance
// leaves as "No member" is still recorded (kept for the record) but
// will never count toward anyone's total or receipt.
import { t } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';
import { findBestMatch } from '../utils/nameMatch.js';

const NAME_HEADERS = ['name', 'fullname', 'donor', 'nom', 'nomcomplet', 'donateur'];
const DATE_HEADERS = ['date', 'donationdate', 'datededon'];
const AMOUNT_HEADERS = ['amount', 'montant', 'don', 'donation'];

function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

function findHeaderKey(sampleRow, candidates) {
  const keys = Object.keys(sampleRow || {});
  return keys.find((k) => candidates.includes(normalizeHeader(k))) || null;
}

function toIsoDate(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
}

function toAmount(raw) {
  const cleaned = String(raw ?? '').replace(/[^0-9.-]/g, '');
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function createTaxDonationImportModal({ supabase, currentUserId, onImported }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xl font-bold">${t('taxImport.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-xs text-slate-500 mb-4">${t('taxImport.intro')}</p>

      <div data-el="upload-step">
        <input type="file" data-el="file-input" accept=".xlsx,.xls,.csv" class="block w-full text-sm mb-2" />
        <p class="text-xs text-slate-500">${t('taxImport.columnsHint')}</p>
      </div>

      <div data-el="preview-step" class="hidden">
        <div class="overflow-x-auto border border-slate-200 rounded-lg mb-2">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th class="text-left px-3 py-2">${t('taxImport.colName')}</th>
                <th class="text-left px-3 py-2">${t('taxImport.colDate')}</th>
                <th class="text-left px-3 py-2">${t('taxImport.colAmount')}</th>
                <th class="text-left px-3 py-2">${t('taxImport.colMember')}</th>
                <th class="text-left px-3 py-2">${t('taxImport.colStatus')}</th>
              </tr>
            </thead>
            <tbody data-el="preview-body" class="divide-y divide-slate-100"></tbody>
          </table>
        </div>

        <p data-el="summary" class="text-sm text-slate-600 mb-4"></p>

        <div class="flex justify-end gap-2">
          <button type="button" data-action="reset" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            ${t('taxImport.chooseAnotherFile')}
          </button>
          <button type="button" data-el="import-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('taxImport.startImport')}
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
  const previewBodyEl = root.querySelector('[data-el="preview-body"]');
  const summaryEl = root.querySelector('[data-el="summary"]');
  const importBtn = root.querySelector('[data-el="import-btn"]');
  const progressEl = root.querySelector('[data-el="progress"]');

  let profiles = [];
  let rows = [];

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="reset"]').addEventListener('click', resetToUpload);
  fileInput.addEventListener('change', handleFile);
  previewBodyEl.addEventListener('change', handleRowFieldChange);
  importBtn.addEventListener('click', runImport);

  async function loadProfiles() {
    const { data } = await supabase.from('profiles').select('id, full_name').is('removed_at', null).order('full_name');
    profiles = data || [];
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (profiles.length === 0) await loadProfiles();

    let rawRows;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = window.XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      rawRows = window.XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
    } catch (err) {
      window.alert(t('taxImport.parseFailed', { message: err.message }));
      fileInput.value = '';
      return;
    }

    if (rawRows.length === 0) {
      window.alert(t('taxImport.emptyFile'));
      fileInput.value = '';
      return;
    }

    const nameKey = findHeaderKey(rawRows[0], NAME_HEADERS);
    const dateKey = findHeaderKey(rawRows[0], DATE_HEADERS);
    const amountKey = findHeaderKey(rawRows[0], AMOUNT_HEADERS);

    rows = rawRows.map((raw, index) => {
      const rawName = nameKey ? String(raw[nameKey] || '').trim() : '';
      const suggested = rawName ? findBestMatch(rawName, profiles) : null;
      return {
        index,
        raw_name: rawName,
        donation_date: dateKey ? toIsoDate(raw[dateKey]) : '',
        amount: amountKey ? toAmount(raw[amountKey]) : null,
        memberId: suggested ? suggested.id : null,
        suggestedScore: suggested ? suggested.score : null,
      };
    });

    renderPreview();
    uploadStepEl.classList.add('hidden');
    previewStepEl.classList.remove('hidden');
  }

  function renderPreview() {
    previewBodyEl.innerHTML = rows.map((row) => {
      const warnings = [];
      if (!row.raw_name) warnings.push(t('taxImport.warnMissingName'));
      if (!row.donation_date) warnings.push(t('taxImport.warnMissingDate'));
      if (row.amount === null || row.amount <= 0) warnings.push(t('taxImport.warnMissingAmount'));
      if (!row.memberId) warnings.push(t('taxImport.warnNoMember'));

      const statusHtml = warnings.length > 0
        ? `<span class="text-amber-600">${escapeHtml(warnings.join('; '))}</span>`
        : row.suggestedScore !== null
          ? `<span class="text-emerald-600">${t('taxImport.statusSuggested', { score: row.suggestedScore })}</span>`
          : `<span class="text-emerald-600">${t('taxImport.statusOk')}</span>`;

      return `
        <tr data-row-index="${row.index}" class="${row.raw_name ? '' : 'bg-rose-50'}">
          <td class="px-2 py-1.5"><input type="text" data-field="raw_name" data-row="${row.index}" value="${escapeHtml(row.raw_name)}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5"><input type="date" data-field="donation_date" data-row="${row.index}" value="${row.donation_date}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5"><input type="number" step="0.01" min="0" data-field="amount" data-row="${row.index}" value="${row.amount ?? ''}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5">
            <select data-field="memberId" data-row="${row.index}" class="w-full border border-slate-200 rounded px-2 py-1">
              <option value="">${t('taxImport.noMember')}</option>
              ${profiles.map((p) => `<option value="${p.id}" ${row.memberId === p.id ? 'selected' : ''}>${escapeHtml(p.full_name)}</option>`).join('')}
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

    if (field === 'memberId') { row.memberId = e.target.value || null; row.suggestedScore = null; }
    else if (field === 'amount') row.amount = toAmount(e.target.value);
    else row[field] = e.target.value;

    renderPreview();
  }

  function updateSummary() {
    const validRows = rows.filter((r) => r.raw_name && r.donation_date && r.amount > 0);
    const matchedCount = validRows.filter((r) => r.memberId).length;
    const unmatchedCount = validRows.length - matchedCount;
    const skippedCount = rows.length - validRows.length;

    summaryEl.textContent = t('taxImport.summary', { matched: matchedCount, unmatched: unmatchedCount, skipped: skippedCount });
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
    const validRows = rows.filter((r) => r.raw_name && r.donation_date && r.amount > 0);
    const matchedCount = validRows.filter((r) => r.memberId).length;
    const unmatchedCount = validRows.length - matchedCount;

    if (!(await confirmDialog({
      message: t('taxImport.confirmMessage', { matched: matchedCount, unmatched: unmatchedCount }),
      confirmLabel: t('taxImport.startImport'),
      danger: false,
    }))) return;

    importBtn.disabled = true;
    progressEl.innerHTML = '';

    const { data: batch, error: batchError } = await supabase.from('donation_import_batches').insert({
      uploaded_by: currentUserId,
      filename: fileInput.files[0]?.name || null,
      row_count: validRows.length,
      matched_count: matchedCount,
      unmatched_count: unmatchedCount,
    }).select('id').single();

    if (batchError) {
      logLine(t('taxImport.batchFailed', { message: batchError.message }), 'error');
      importBtn.disabled = false;
      return;
    }

    const { error: entriesError } = await supabase.from('donation_entries').insert(validRows.map((row) => ({
      batch_id: batch.id,
      member_id: row.memberId,
      raw_name: row.raw_name,
      donation_date: row.donation_date,
      amount: row.amount,
      created_by: currentUserId,
    })));

    if (entriesError) {
      logLine(t('taxImport.entriesFailed', { message: entriesError.message }), 'error');
      importBtn.disabled = false;
      return;
    }

    logLine(t('taxImport.allDone', { count: validRows.length }), 'success');
    importBtn.disabled = false;
    onImported?.();
  }

  function open() {
    resetToUpload();
    root.classList.remove('hidden');
    root.classList.add('flex');
    loadProfiles();
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
