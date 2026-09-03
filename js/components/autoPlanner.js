// Admin Auto-Planner.
// Admin picks a date + required roster counts per voice part; we query
// who marked themselves available that date, auto-fill the roster from
// that pool, and let the admin override any slot before saving.
import { t, tn, voicePartLabel } from '../i18n.js';
import { notifyDepartment } from '../utils/notifyDepartment.js';

const VOICE_PARTS = ['Leader', 'Soprano', 'Alto', 'Tenor', 'Pianist', 'Bassist', 'Guitarist', 'Drummer'];

const DEFAULT_REQUIREMENTS = [
  { voice_part: 'Leader', count: 1 },
  { voice_part: 'Soprano', count: 2 },
  { voice_part: 'Alto', count: 2 },
  { voice_part: 'Tenor', count: 2 },
  { voice_part: 'Pianist', count: 1 },
  { voice_part: 'Bassist', count: 1 },
  { voice_part: 'Guitarist', count: 1 },
  { voice_part: 'Drummer', count: 1 },
];

// ---- Pure logic: safe to unit test without touching Supabase ----

// Combines two separate "I'm free that day" signals: the general
// availability calendar, and approvals on a titled service request for
// this same date (if one exists). Either counts as available.
export async function getAvailableSingersForDate(supabase, dateStr) {
  const [{ data: availRows, error: availError }, { data: plan, error: planError }] = await Promise.all([
    supabase
      .from('availability')
      .select('user_id, profiles ( id, full_name, voice_parts, instrument_name )')
      .eq('date', dateStr)
      .eq('status', 'available'),
    supabase.from('service_plans').select('id').eq('date', dateStr).maybeSingle(),
  ]);

  if (availError) throw availError;
  if (planError) throw planError;

  const pool = new Map();
  (availRows || []).forEach((row) => { if (row.profiles) pool.set(row.profiles.id, row.profiles); });

  if (plan) {
    const { data: rsvpRows, error: rsvpError } = await supabase
      .from('service_rsvps')
      .select('profiles ( id, full_name, voice_parts, instrument_name )')
      .eq('service_plan_id', plan.id)
      .eq('status', 'approved');
    if (rsvpError) throw rsvpError;
    (rsvpRows || []).forEach((row) => { if (row.profiles) pool.set(row.profiles.id, row.profiles); });
  }

  return { planId: plan?.id ?? null, singers: Array.from(pool.values()) };
}

// Fetches who's already saved as programmed for this date, if a roster
// was saved before — lets "Generate" mean "load the current roster and
// let me change it" rather than always starting from a blank slate.
export async function getExistingAssignments(supabase, planId) {
  if (!planId) return [];

  const { data, error } = await supabase
    .from('service_plan_singers')
    .select('voice_part, profiles ( id, full_name, instrument_name )')
    .eq('service_plan_id', planId);

  if (error) throw error;

  return (data || [])
    .filter((row) => row.profiles)
    .map((row) => ({ voice_part: row.voice_part, singer: row.profiles }));
}

// A singer covering multiple parts (e.g. a Leader who also sings Soprano
// as a backup) is added to every matching pool; the `used` set below still
// ensures they only fill one slot across the whole roster. Existing
// assignees are tried first so a saved roster loads as-is by default —
// admin can then override any slot to swap someone new in.
export function generateRoster(availableSingers, requirements, existingAssignments = []) {
  const byPart = new Map();
  for (const singer of availableSingers) {
    for (const part of singer.voice_parts || []) {
      if (!byPart.has(part)) byPart.set(part, []);
      byPart.get(part).push(singer);
    }
  }

  const existingByPart = new Map();
  for (const { voice_part, singer } of existingAssignments) {
    if (!existingByPart.has(voice_part)) existingByPart.set(voice_part, []);
    existingByPart.get(voice_part).push(singer);
  }

  const used = new Set();
  const roster = requirements.map(({ voice_part, count }) => {
    const existing = existingByPart.get(voice_part) || [];
    const existingIds = new Set(existing.map((s) => s.id));
    const pool = (byPart.get(voice_part) || []).filter((s) => !existingIds.has(s.id));
    const candidates = [...existing, ...pool].filter((s) => !used.has(s.id));

    const slots = [];
    for (let i = 0; i < count; i++) {
      const pick = candidates[i] || null;
      if (pick) used.add(pick.id);
      slots.push(pick ? pick.id : null);
    }
    return {
      voice_part,
      required: count,
      slots,
      shortage: Math.max(0, count - candidates.length),
    };
  });

  return roster;
}

// ---- UI ----

export function renderAdminAutoPlanner(container, { supabase, adminUserId }) {
  let availableSingers = [];
  let existingAssignments = []; // [{ voice_part, singer }] — the currently saved roster, if any
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
      const { planId, singers } = await getAvailableSingersForDate(supabase, dateStr);
      availableSingers = singers;
      existingAssignments = await getExistingAssignments(supabase, planId);
      roster = generateRoster(availableSingers, readRequirements(), existingAssignments);
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
      // The dropdown includes anyone currently assigned to this slot even
      // if they're no longer marked available, so admin can still see (and
      // change) who's programmed rather than have them silently vanish.
      const existingForPart = existingAssignments
        .filter((a) => a.voice_part === part.voice_part)
        .map((a) => a.singer);
      const pool = [
        ...existingForPart,
        ...availableSingers.filter((s) => (s.voice_parts || []).includes(part.voice_part)),
      ].filter((s, idx, arr) => arr.findIndex((other) => other.id === s.id) === idx);
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
      if (rows.length > 0) {
        const { data: choirDept } = await supabase.from('departments').select('id').eq('key', 'choir').single();
        if (choirDept) notifyDepartment(supabase, choirDept.id, t('notifications.newSchedule'), t('notifications.newScheduleBodyDate', { date: dateStr }));
      }
    } catch (error) {
      statusEl.textContent = t('planner.saveFailed', { message: error.message });
    } finally {
      saveBtn.disabled = false;
    }
  }
}
