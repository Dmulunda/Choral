// Import historical Offering records (Excel/CSV, or a best-effort PDF
// parse) into the system that already runs today — same two-step
// upload/review shape as taxDonationImport.js (parse, editable preview
// table, confirmDialog() before committing), adapted for offering rows
// (name/date/amount/type/payment method) instead of plain donations.
//
// A row dated in the current (still-open) month is inserted exactly
// like a manual entry from offeringsBoard.js (report_period_id left
// null) -- it shows up in "This Month's Offerings" and gets swept into
// a PDF by the regular monthly cron, same as anything typed in by hand.
// A row dated in a past month gets its own closed report period
// (get_or_create_offering_period RPC, sql/059) so it doesn't pollute
// the current ledger, and this import then asks the offering-reports
// Edge Function to (re)generate that month's PDF on the spot --
// imported history still ends up with a real "bank statement" PDF,
// not just raw rows.
//
// Linking a row to a real member (same fuzzy match as taxDonationImport,
// js/utils/nameMatch.js) mirrors it into donation_entries via the
// existing offerings trigger (sql/057) -- so an imported historical
// offering counts toward that member's tax receipt exactly like one
// entered by hand.
import { t } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';
import { findBestMatch } from '../utils/nameMatch.js';

const OFFERING_TYPES = ['tithe', 'general', 'sacrifice', 'construction', 'other'];
const PAYMENT_METHODS = ['cash', 'transfer', 'check', 'other'];

const NAME_HEADERS = ['name', 'fullname', 'donorname', 'donor', 'nom', 'nomcomplet', 'donateur'];
const DATE_HEADERS = ['date', 'offeringdate', 'donationdate', 'datededon', 'dateoffrande'];
const AMOUNT_HEADERS = ['amount', 'montant', 'don', 'donation', 'offering', 'offrande'];
const TYPE_HEADERS = ['type', 'offeringtype', 'typedoffrande', 'category', 'categorie'];
const PAYMENT_HEADERS = ['paymentmethod', 'payment', 'method', 'modedepaiement', 'mode'];

const TYPE_ALIASES = {
  tithe: ['tithe', 'dime'],
  general: ['general', 'offrande', 'ordinaire', 'ordinary'],
  sacrifice: ['sacrifice'],
  construction: ['construction', 'batiment'],
};

const PAYMENT_ALIASES = {
  cash: ['cash', 'especes', 'comptant'],
  transfer: ['transfer', 'virement', 'wire', 'etransfer', 'interac'],
  check: ['check', 'cheque'],
};

function normalizeToken(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

function findHeaderKey(sampleRow, candidates) {
  const keys = Object.keys(sampleRow || {});
  return keys.find((k) => candidates.includes(normalizeToken(k))) || null;
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

// Matches a free-text value (spreadsheet cell or PDF-extracted word)
// against our fixed enum via small alias lists -- anything unrecognized
// falls back to the given default (type) or 'other' + the raw text
// kept for "please specify" (payment method).
function resolveType(raw) {
  const norm = normalizeToken(raw);
  if (!norm) return 'general';
  if (OFFERING_TYPES.includes(norm)) return norm;
  for (const [key, aliases] of Object.entries(TYPE_ALIASES)) {
    if (aliases.some((a) => norm.includes(a))) return key;
  }
  return 'general';
}

function resolvePaymentMethod(raw) {
  const norm = normalizeToken(raw);
  if (!norm) return { payment_method: 'cash', payment_method_other: null };
  if (PAYMENT_METHODS.includes(norm)) return { payment_method: norm, payment_method_other: null };
  for (const [key, aliases] of Object.entries(PAYMENT_ALIASES)) {
    if (aliases.some((a) => norm.includes(a))) return { payment_method: key, payment_method_other: null };
  }
  return { payment_method: 'other', payment_method_other: String(raw).trim() };
}

function monthKey(isoDate) {
  return isoDate.slice(0, 7); // YYYY-MM
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ---- PDF best-effort parsing (acknowledged up front as much less
// reliable than Excel/CSV -- every row it produces still goes through
// the same editable preview as a spreadsheet import, nothing is ever
// applied without review) ----
const PDFJS_VERSION = '3.11.174';
let pdfjsLibPromise = null;
function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
      return lib;
    });
  }
  return pdfjsLibPromise;
}

async function extractPdfLines(file) {
  const pdfjsLib = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const lines = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const byLineY = new Map();
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (!byLineY.has(y)) byLineY.set(y, []);
      byLineY.get(y).push(item);
    }
    const sortedYs = Array.from(byLineY.keys()).sort((a, b) => b - a);
    for (const y of sortedYs) {
      const text = byLineY.get(y)
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
    }
  }
  return lines;
}

const PDF_DATE_RE = /\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/;
const PDF_AMOUNT_RE = /\$?\s?(\d{1,3}(?:[ ,]\d{3})*(?:\.\d{2})?)\s*\$?/g;

function parsePdfLineToRow(line) {
  const dateMatch = line.match(PDF_DATE_RE);
  if (!dateMatch) return null;

  let withoutDate = line.slice(0, dateMatch.index) + line.slice(dateMatch.index + dateMatch[0].length);

  // Last number on the line (after the date is removed) is the amount --
  // in a statement-style row the running description comes first, the
  // figure comes last.
  const amountMatches = [...withoutDate.matchAll(PDF_AMOUNT_RE)].filter((m) => m[1].replace(/[ ,]/g, '').length > 0);
  if (amountMatches.length === 0) return null;
  const lastAmount = amountMatches[amountMatches.length - 1];
  const amount = toAmount(lastAmount[1]);
  if (amount === null) return null;

  const name = (withoutDate.slice(0, lastAmount.index) + withoutDate.slice(lastAmount.index + lastAmount[0].length))
    .replace(/[|•·,;:\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { raw_name: name, donation_date: toIsoDate(dateMatch[0]), amount, offering_type: 'general', payment_method: 'cash', payment_method_other: null };
}

export function createOfferingsImportModal({ supabase, currentUserId, onImported }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xl font-bold">${t('offeringsImport.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-xs text-slate-500 mb-1">${t('offeringsImport.intro')}</p>
      <p class="text-xs text-amber-600 mb-4">${t('offeringsImport.pdfWarning')}</p>

      <div data-el="upload-step">
        <input type="file" data-el="file-input" accept=".xlsx,.xls,.csv,.pdf" class="block w-full text-sm mb-2" />
        <p class="text-xs text-slate-500">${t('offeringsImport.columnsHint')}</p>
      </div>

      <div data-el="preview-step" class="hidden">
        <div class="overflow-x-auto border border-slate-200 rounded-lg mb-2">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th class="text-left px-3 py-2">${t('offeringsImport.colName')}</th>
                <th class="text-left px-3 py-2">${t('offeringsImport.colDate')}</th>
                <th class="text-left px-3 py-2">${t('offeringsImport.colAmount')}</th>
                <th class="text-left px-3 py-2">${t('offeringsImport.colType')}</th>
                <th class="text-left px-3 py-2">${t('offeringsImport.colPaymentMethod')}</th>
                <th class="text-left px-3 py-2">${t('offeringsImport.colMember')}</th>
                <th class="text-left px-3 py-2">${t('offeringsImport.colStatus')}</th>
              </tr>
            </thead>
            <tbody data-el="preview-body" class="divide-y divide-slate-100"></tbody>
          </table>
        </div>

        <p data-el="summary" class="text-sm text-slate-600 mb-4"></p>

        <div class="flex justify-end gap-2">
          <button type="button" data-action="reset" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            ${t('offeringsImport.chooseAnotherFile')}
          </button>
          <button type="button" data-el="import-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('offeringsImport.startImport')}
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
    const { data } = await supabase.from('profiles').select('id, full_name').order('full_name');
    profiles = data || [];
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (profiles.length === 0) await loadProfiles();

    const isPdf = /\.pdf$/i.test(file.name);
    let parsedRows;
    try {
      parsedRows = isPdf ? await parsePdf(file) : await parseSpreadsheet(file);
    } catch (err) {
      window.alert(t('offeringsImport.parseFailed', { message: err.message }));
      fileInput.value = '';
      return;
    }

    if (parsedRows.length === 0) {
      window.alert(isPdf ? t('offeringsImport.pdfNoRows') : t('offeringsImport.emptyFile'));
      fileInput.value = '';
      return;
    }

    rows = parsedRows.map((row, index) => {
      const suggested = row.raw_name ? findBestMatch(row.raw_name, profiles) : null;
      return {
        index,
        raw_name: row.raw_name,
        donation_date: row.donation_date,
        amount: row.amount,
        offering_type: row.offering_type,
        payment_method: row.payment_method,
        payment_method_other: row.payment_method_other,
        memberId: suggested ? suggested.id : null,
        suggestedScore: suggested ? suggested.score : null,
      };
    });

    renderPreview();
    uploadStepEl.classList.add('hidden');
    previewStepEl.classList.remove('hidden');
  }

  async function parseSpreadsheet(file) {
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = window.XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
    if (rawRows.length === 0) return [];

    const nameKey = findHeaderKey(rawRows[0], NAME_HEADERS);
    const dateKey = findHeaderKey(rawRows[0], DATE_HEADERS);
    const amountKey = findHeaderKey(rawRows[0], AMOUNT_HEADERS);
    const typeKey = findHeaderKey(rawRows[0], TYPE_HEADERS);
    const paymentKey = findHeaderKey(rawRows[0], PAYMENT_HEADERS);

    return rawRows.map((raw) => {
      const payment = paymentKey ? resolvePaymentMethod(raw[paymentKey]) : { payment_method: 'cash', payment_method_other: null };
      return {
        raw_name: nameKey ? String(raw[nameKey] || '').trim() : '',
        donation_date: dateKey ? toIsoDate(raw[dateKey]) : '',
        amount: amountKey ? toAmount(raw[amountKey]) : null,
        offering_type: typeKey ? resolveType(raw[typeKey]) : 'general',
        payment_method: payment.payment_method,
        payment_method_other: payment.payment_method_other,
      };
    });
  }

  async function parsePdf(file) {
    const lines = await extractPdfLines(file);
    return lines.map(parsePdfLineToRow).filter(Boolean);
  }

  function renderPreview() {
    previewBodyEl.innerHTML = rows.map((row) => {
      const warnings = [];
      if (!row.raw_name) warnings.push(t('offeringsImport.warnMissingName'));
      if (!row.donation_date) warnings.push(t('offeringsImport.warnMissingDate'));
      if (row.amount === null || row.amount <= 0) warnings.push(t('offeringsImport.warnMissingAmount'));
      if (!row.memberId) warnings.push(t('offeringsImport.warnNoMember'));

      const statusHtml = warnings.length > 0
        ? `<span class="text-amber-600">${escapeHtml(warnings.join('; '))}</span>`
        : row.suggestedScore !== null
          ? `<span class="text-emerald-600">${t('offeringsImport.statusSuggested', { score: row.suggestedScore })}</span>`
          : `<span class="text-emerald-600">${t('offeringsImport.statusOk')}</span>`;

      return `
        <tr data-row-index="${row.index}" class="${row.raw_name ? '' : 'bg-rose-50'}">
          <td class="px-2 py-1.5"><input type="text" data-field="raw_name" data-row="${row.index}" value="${escapeAttr(row.raw_name)}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5"><input type="date" data-field="donation_date" data-row="${row.index}" value="${row.donation_date}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5"><input type="number" step="0.01" min="0" data-field="amount" data-row="${row.index}" value="${row.amount ?? ''}" class="w-24 border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5">
            <select data-field="offering_type" data-row="${row.index}" class="w-full border border-slate-200 rounded px-2 py-1">
              ${OFFERING_TYPES.map((v) => `<option value="${v}" ${row.offering_type === v ? 'selected' : ''}>${escapeHtml(t(`offerings.type.${v}`))}</option>`).join('')}
            </select>
          </td>
          <td class="px-2 py-1.5">
            <select data-field="payment_method" data-row="${row.index}" class="w-full border border-slate-200 rounded px-2 py-1 mb-1">
              ${PAYMENT_METHODS.map((v) => `<option value="${v}" ${row.payment_method === v ? 'selected' : ''}>${escapeHtml(t(`offerings.paymentMethod.${v}`))}</option>`).join('')}
            </select>
            ${row.payment_method === 'other'
              ? `<input type="text" data-field="payment_method_other" data-row="${row.index}" value="${escapeAttr(row.payment_method_other || '')}" placeholder="${escapeAttr(t('offeringsImport.otherSpecifyPlaceholder'))}" class="w-full border border-slate-200 rounded px-2 py-1" />`
              : ''}
          </td>
          <td class="px-2 py-1.5">
            <select data-field="memberId" data-row="${row.index}" class="w-full border border-slate-200 rounded px-2 py-1">
              <option value="">${t('offeringsImport.noMember')}</option>
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

    if (field === 'memberId') { row.memberId = e.target.value || null; row.suggestedScore = null; renderPreview(); return; }
    if (field === 'amount') { row.amount = toAmount(e.target.value); return; }
    if (field === 'payment_method') {
      row.payment_method = e.target.value;
      if (row.payment_method !== 'other') row.payment_method_other = null;
      renderPreview();
      return;
    }
    row[field] = e.target.value;
  }

  function updateSummary() {
    const validRows = rows.filter((r) => r.raw_name && r.donation_date && r.amount > 0);
    const matchedCount = validRows.filter((r) => r.memberId).length;
    const unmatchedCount = validRows.length - matchedCount;
    const skippedCount = rows.length - validRows.length;

    summaryEl.textContent = t('offeringsImport.summary', { matched: matchedCount, unmatched: unmatchedCount, skipped: skippedCount });
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
      message: t('offeringsImport.confirmMessage', { matched: matchedCount, unmatched: unmatchedCount }),
      confirmLabel: t('offeringsImport.startImport'),
      danger: false,
    }))) return;

    importBtn.disabled = true;
    progressEl.innerHTML = '';

    // Rows in the still-open current month join the normal ledger
    // (report_period_id null, same as a manual entry). Rows in a past
    // month need their own closed period -- resolved once per distinct
    // month via get_or_create_offering_period, then reused for every
    // row that falls in it.
    const thisMonth = currentMonthKey();
    const periodIdByMonth = new Map();
    for (const row of validRows) {
      const key = monthKey(row.donation_date);
      if (key === thisMonth || periodIdByMonth.has(key)) continue;
      const { data: periodId, error } = await supabase.rpc('get_or_create_offering_period', { p_date: row.donation_date });
      if (error) {
        logLine(t('offeringsImport.batchFailed', { message: error.message }), 'error');
        importBtn.disabled = false;
        return;
      }
      periodIdByMonth.set(key, periodId);
    }

    const { error: insertError } = await supabase.from('offerings').insert(validRows.map((row) => {
      const key = monthKey(row.donation_date);
      return {
        donor_name: row.raw_name,
        offering_date: row.donation_date,
        amount_cents: Math.round(row.amount * 100),
        offering_type: row.offering_type,
        payment_method: row.payment_method,
        payment_method_other: row.payment_method_other,
        member_id: row.memberId,
        recorded_by: currentUserId,
        report_period_id: key === thisMonth ? null : periodIdByMonth.get(key),
      };
    }));

    if (insertError) {
      logLine(t('offeringsImport.batchFailed', { message: insertError.message }), 'error');
      importBtn.disabled = false;
      return;
    }

    logLine(t('offeringsImport.allDone', { count: validRows.length }), 'success');

    const pastPeriodIds = Array.from(periodIdByMonth.entries()).filter(([key]) => key !== thisMonth);
    if (pastPeriodIds.length > 0) {
      logLine(t('offeringsImport.generatingPdfs'));
      for (const [key, periodId] of pastPeriodIds) {
        const { error } = await supabase.functions.invoke('offering-reports', {
          body: { action: 'generate_for_period', period_id: periodId },
        });
        if (error) logLine(t('offeringsImport.pdfGenFailed', { period: key, message: error.message }), 'error');
      }
    }

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
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
