// Admin Auto-Planner.
// Admin picks a date + required roster counts per voice part; we query
// who marked themselves available that date, auto-fill the roster from
// that pool, and let the admin override any slot before saving.
import { t, tn, voicePartLabel } from '../i18n.js';

const VOICE_PARTS = ['Leader', 'Soprano', 'Alto', 'Tenor', 'Instrumentalist'];

const DEFAULT_REQUIREMENTS = [
  { voice_part: 'Leader', count: 1 },
  { voice_part: 'Soprano', count: 2 },
  { voice_part: 'Alto', count: 2 },
  { voice_part: 'Tenor', count: 2 },
  { voice_part: 'Instrumentalist', count: 1 },
];

// ---- Pure logic: safe to unit test without touching Supabase ----

export async function getAvailableSingersForDate(supabase, dateStr) {
  const { data, error } = await supabase
    .from('availability')
    .select('user_id, profiles ( id, full_name, voice_parts, instrument_name )')
    .eq('date', dateStr)
    .eq('status', 'available');

  if (error) throw error;

  return data
    .map((row) => row.profiles)
    .filter(Boolean);
}

// A singer covering multiple parts (e.g. a Leader who also sings Soprano
// as a backup) is added to every matching pool; the `used` set below still
// ensures they only fill one slot across the whole roster.
export function generateRoster(availableSingers, requirements) {
  const byPart = new Map();
  for (const singer of availableSingers) {
    for (const part of singer.voice_parts || []) {
      if (!byPart.has(part)) byPart.set(part, []);
      byPart.get(part).push(singer);
    }
  }

  const used = new Set();
  const roster = requirements.map(({ voice_part, count }) => {
    const pool = (byPart.get(voice_part) || []).filter((s) => !used.has(s.id));
    const slots = [];
    for (let i = 0; i < count; i++) {
      const pick = pool[i] || null;
      if (pick) used.add(pick.id);
      slots.push(pick ? pick.id : null);
    }
    return {
      voice_part,
      required: count,
      slots,
      shortage: Math.max(0, count - pool.length),
    };
  });

  return roster;
}

// ---- UI ----

export function renderAdminAutoPlanner(container, { supabase, adminUserId }) {
  let availableSingers = [];
  let roster = []; // [{ voice_part, required, slots: [singerId|null, ...], shortage }]

  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-wrap items-end gap-4">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('planner.serviceDate')}</label>
          <input type="date" data-el="date-input"
                 class="border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <button type="button" data-action="generate"
                class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
          ${t('planner.generateRoster')}
        </button>
        <span data-el="status" class="text-sm text-slate-500"></span>
      </div>

      <div>
        <h3 class="text-sm font-semibold text-slate-600 mb-2">${t('planner.requirements')}</h3>
        <div data-el="requirements" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3"></div>
      </div>

      <div data-el="results" class="hidden">
        <h3 class="text-sm font-semibold text-slate-600 mb-2">${t('planner.proposedRoster')} <span class="font-normal text-slate-400">${t('planner.overrideAnySlot')}</span></h3>
        <div data-el="results-body" class="space-y-4"></div>
        <button type="button" data-action="save"
                class="mt-4 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50">
          ${t('planner.saveRoster')}
        </button>
      </div>
    </div>
  `;

  const dateInput = container.querySelector('[data-el="date-input"]');
  const statusEl = container.querySelector('[data-el="status"]');
  const requirementsEl = container.querySelector('[data-el="requirements"]');
  const resultsEl = container.querySelector('[data-el="results"]');
  const resultsBodyEl = container.querySelector('[data-el="results-body"]');
  const generateBtn = container.querySelector('[data-action="generate"]');
  const saveBtn = container.querySelector('[data-action="save"]');

  dateInput.valueAsDate = new Date();

  renderRequirementInputs();
  generateBtn.addEventListener('click', handleGenerate);
  saveBtn.addEventListener('click', handleSave);

  function renderRequirementInputs() {
    requirementsEl.innerHTML = DEFAULT_REQUIREMENTS.map(({ voice_part, count }) => `
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">${voicePartLabel(voice_part)}</label>
        <input type="number" min="0" value="${count}" data-requirement="${voice_part}"
               class="w-full border border-slate-300 rounded-lg px-2 py-1.5" />
      </div>
    `).join('');
  }

  function readRequirements() {
    return VOICE_PARTS
      .map((voice_part) => ({
        voice_part,
        count: Number(requirementsEl.querySelector(`[data-requirement="${voice_part}"]`).value) || 0,
      }))
      .filter((r) => r.count > 0);
  }

  async function handleGenerate() {
    const dateStr = dateInput.value;
    if (!dateStr) {
      statusEl.textContent = t('planner.pickDateFirst');
      return;
    }

    generateBtn.disabled = true;
    statusEl.textContent = t('planner.loadingAvailableSingers');

    try {
      availableSingers = await getAvailableSingersForDate(supabase, dateStr);
      roster = generateRoster(availableSingers, readRequirements());
      renderResults();
      statusEl.textContent = tn('planner.singersAvailable', availableSingers.length, { date: dateStr });
    } catch (error) {
      statusEl.textContent = t('planner.failedToGenerate', { message: error.message });
    } finally {
      generateBtn.disabled = false;
    }
  }

  function singerLabel(singer) {
    return singer.instrument_name ? `${singer.full_name} (${singer.instrument_name})` : singer.full_name;
  }

  function renderResults() {
    resultsEl.classList.remove('hidden');

    resultsBodyEl.innerHTML = roster.map((part, partIdx) => {
      const pool = availableSingers.filter((s) => (s.voice_parts || []).includes(part.voice_part));
      const shortageWarning = part.shortage > 0
        ? `<span class="text-rose-600 text-xs font-medium ml-2">${t('planner.shortBy', { count: part.shortage })}</span>`
        : '';

      const slotSelects = part.slots.map((singerId, slotIdx) => `
        <select data-part-idx="${partIdx}" data-slot-idx="${slotIdx}"
                class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="">${t('planner.unassigned')}</option>
          ${pool.map((singer) => `
            <option value="${singer.id}" ${singer.id === singerId ? 'selected' : ''}>
              ${singerLabel(singer)}
            </option>
          `).join('')}
        </select>
      `).join('');

      return `
        <div class="border border-slate-200 rounded-lg p-3">
          <div class="text-sm font-semibold text-slate-700 mb-2">
            ${voicePartLabel(part.voice_part)} <span class="text-slate-400 font-normal">${t('planner.needed', { count: part.required })}</span>${shortageWarning}
          </div>
          <div class="flex flex-wrap gap-2">${slotSelects}</div>
        </div>
      `;
    }).join('');

    resultsBodyEl.querySelectorAll('select').forEach((select) => {
      select.addEventListener('change', (e) => {
        const partIdx = Number(e.target.dataset.partIdx);
        const slotIdx = Number(e.target.dataset.slotIdx);
        roster[partIdx].slots[slotIdx] = e.target.value || null;
      });
    });
  }

  async function handleSave() {
    const dateStr = dateInput.value;
    saveBtn.disabled = true;
    statusEl.textContent = t('common.saving');

    try {
      const { data: existingPlan, error: findError } = await supabase
        .from('service_plans')
        .select('id')
        .eq('date', dateStr)
        .maybeSingle();
      if (findError) throw findError;

      let planId = existingPlan?.id;
      if (!planId) {
        const { data: newPlan, error: insertError } = await supabase
          .from('service_plans')
          .insert({ date: dateStr, choir_leader_id: adminUserId, status: 'draft' })
          .select('id')
          .single();
        if (insertError) throw insertError;
        planId = newPlan.id;
      }

      const { error: deleteError } = await supabase
        .from('service_plan_singers')
        .delete()
        .eq('service_plan_id', planId);
      if (deleteError) throw deleteError;

      const rows = roster.flatMap((part) =>
        part.slots
          .filter(Boolean)
          .map((singerId) => ({ service_plan_id: planId, singer_id: singerId, voice_part: part.voice_part }))
      );

      if (rows.length > 0) {
        const { error: insertRowsError } = await supabase.from('service_plan_singers').insert(rows);
        if (insertRowsError) throw insertRowsError;
      }

      statusEl.textContent = tn('planner.rosterSaved', rows.length, { date: dateStr });
    } catch (error) {
      statusEl.textContent = t('planner.saveFailed', { message: error.message });
    } finally {
      saveBtn.disabled = false;
    }
  }
}
