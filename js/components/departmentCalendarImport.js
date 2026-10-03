// PDF import for a department's calendar (departmentCalendarGrid.js) --
// same proven shape as offeringsImport.js (upload -> extracted lines ->
// editable preview -> confirm -> commit), stripped of every
// offering-specific concern (amount, payment method, member/guest
// matching). A PDF line only needs to yield a date; whatever text is
// left after the date is removed becomes the entry's title. Rows with
// no detectable date are dropped before they ever reach the preview --
// there's nothing meaningful to review without one.
import { t } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';

// Mirrors offeringsImport.js's loadPdfJs/extractPdfLines verbatim --
// same pinned version (3.x never shipped an ESM build), same
// Y-coordinate line reconstruction. Duplicated rather than imported
// since offeringsImport.js doesn't export these helpers.
const PDFJS_VERSION = '4.0.379';
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

function toIsoDate(raw) {
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
}

const PDF_DATE_RE = /\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/;

function parsePdfLineToEventRow(line) {
  const dateMatch = line.match(PDF_DATE_RE);
  if (!dateMatch) return null;

  const title = (line.slice(0, dateMatch.index) + line.slice(dateMatch.index + dateMatch[0].length))
    .replace(/[|•·,;:\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { date: toIsoDate(dateMatch[0]), title, notes: '' };
}

export function createDepartmentCalendarImportModal({ supabase, departmentId, currentUserId, onImported }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xl font-bold">${t('deptCalendarImport.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-xs text-slate-500 mb-1">${t('deptCalendarImport.intro')}</p>
      <p class="text-xs text-amber-600 mb-4">${t('deptCalendarImport.pdfWarning')}</p>

      <div data-el="upload-step">
        <input type="file" data-el="file-input" accept=".pdf" class="block w-full text-sm mb-2" />
      </div>

      <div data-el="preview-step" class="hidden">
        <div class="overflow-x-auto border border-slate-200 rounded-lg mb-2">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th class="text-left px-3 py-2">${t('deptCalendarImport.colDate')}</th>
                <th class="text-left px-3 py-2">${t('deptCalendarImport.colTitle')}</th>
                <th class="text-left px-3 py-2">${t('deptCalendarImport.colNotes')}</th>
                <th class="text-left px-3 py-2">${t('deptCalendarImport.colStatus')}</th>
              </tr>
            </thead>
            <tbody data-el="preview-body" class="divide-y divide-slate-100"></tbody>
          </table>
        </div>

        <p data-el="summary" class="text-sm text-slate-600 mb-4"></p>

        <div class="flex justify-end gap-2">
          <button type="button" data-action="reset" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            ${t('deptCalendarImport.chooseAnotherFile')}
          </button>
          <button type="button" data-el="import-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('deptCalendarImport.startImport')}
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

  let rows = [];

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="reset"]').addEventListener('click', resetToUpload);
  fileInput.addEventListener('change', handleFile);
  previewBodyEl.addEventListener('change', handleRowFieldChange);
  importBtn.addEventListener('click', runImport);

  // Same signature-match convention as offeringsImport.js's duplicate
  // detection, adapted to this table's shape: same department + date +
  // title already on file (or repeated earlier in this same batch) is
  // treated as a re-upload and skipped automatically.
  function eventSignature(date, title) {
    return `${date}|${String(title || '').trim().toLowerCase()}`;
  }

  async function markDuplicates(targetRows) {
    const validDates = targetRows.map((r) => r.date).filter(Boolean);
    if (validDates.length === 0) return;
    const minDate = validDates.reduce((a, b) => (b < a ? b : a));
    const maxDate = validDates.reduce((a, b) => (b > a ? b : a));

    const { data: existing, error } = await supabase
      .from('department_shifts')
      .select('date, title')
      .eq('department_id', departmentId)
      .gte('date', minDate).lte('date', maxDate);
    if (error) return;

    const seen = new Set((existing || []).map((r) => eventSignature(r.date, r.title)));
    for (const row of targetRows) {
      if (!row.date || !row.title) continue;
      const sig = eventSignature(row.date, row.title);
      row.isDuplicate = seen.has(sig);
      seen.add(sig);
    }
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    let parsedRows;
    try {
      const lines = await extractPdfLines(file);
      parsedRows = lines.map(parsePdfLineToEventRow).filter(Boolean);
    } catch (err) {
      window.alert(t('deptCalendarImport.parseFailed', { message: err.message }));
      fileInput.value = '';
      return;
    }

    if (parsedRows.length === 0) {
      window.alert(t('deptCalendarImport.pdfNoRows'));
      fileInput.value = '';
      return;
    }

    rows = parsedRows.map((row, index) => ({ index, date: row.date, title: row.title, notes: row.notes, isDuplicate: false }));

    await markDuplicates(rows);
    renderPreview();
    uploadStepEl.classList.add('hidden');
    previewStepEl.classList.remove('hidden');
  }

  function renderPreview() {
    previewBodyEl.innerHTML = rows.map((row) => {
      const warnings = [];
      if (!row.date) warnings.push(t('deptCalendarImport.warnMissingDate'));
      if (!row.title) warnings.push(t('deptCalendarImport.warnMissingTitle'));

      const statusHtml = row.isDuplicate
        ? `<span class="text-slate-500 font-medium">${t('deptCalendarImport.statusDuplicate')}</span>`
        : warnings.length > 0
          ? `<span class="text-amber-600">${escapeHtml(warnings.join('; '))}</span>`
          : `<span class="text-emerald-600">${t('deptCalendarImport.statusOk')}</span>`;

      return `
        <tr data-row-index="${row.index}" class="${row.isDuplicate ? 'bg-slate-100 opacity-60' : ''}">
          <td class="px-2 py-1.5"><input type="date" data-field="date" data-row="${row.index}" value="${row.date}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5"><input type="text" data-field="title" data-row="${row.index}" value="${escapeAttr(row.title)}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
          <td class="px-2 py-1.5"><input type="text" data-field="notes" data-row="${row.index}" value="${escapeAttr(row.notes)}" class="w-full border border-slate-200 rounded px-2 py-1" /></td>
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
    row[field] = e.target.value;
  }

  function importableRows() {
    return rows.filter((r) => r.date && r.title && !r.isDuplicate);
  }

  function updateSummary() {
    const validCount = importableRows().length;
    const duplicateCount = rows.filter((r) => r.isDuplicate).length;
    const skippedCount = rows.length - validCount - duplicateCount;

    summaryEl.textContent = t('deptCalendarImport.summary', { valid: validCount, skipped: skippedCount })
      + (duplicateCount > 0 ? ' ' + t('deptCalendarImport.summaryDuplicates', { count: duplicateCount }) : '');
    importBtn.disabled = validCount === 0;
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
    const validRows = importableRows();
    const duplicateCount = rows.filter((r) => r.isDuplicate).length;

    const confirmMsg = t('deptCalendarImport.confirmMessage', { count: validRows.length })
      + (duplicateCount > 0 ? ' ' + t('deptCalendarImport.confirmMessageDuplicates', { count: duplicateCount }) : '');
    if (!(await confirmDialog({ message: confirmMsg, confirmLabel: t('deptCalendarImport.startImport'), danger: false }))) return;

    importBtn.disabled = true;
    progressEl.innerHTML = '';

    const { error } = await supabase.from('department_shifts').insert(validRows.map((row) => ({
      department_id: departmentId,
      date: row.date,
      title: row.title,
      notes: row.notes || null,
      created_by: currentUserId,
    })));

    if (error) {
      logLine(t('deptCalendarImport.batchFailed', { message: error.message }), 'error');
      importBtn.disabled = false;
      return;
    }

    logLine(t('deptCalendarImport.allDone', { count: validRows.length }), 'success');
    if (duplicateCount > 0) logLine(t('deptCalendarImport.allDoneDuplicatesSkipped', { count: duplicateCount }), 'info');

    importBtn.disabled = false;
    onImported?.();
  }

  function open() {
    resetToUpload();
    root.classList.remove('hidden');
    root.classList.add('flex');
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
