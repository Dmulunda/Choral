// Guest / Visitor Connection System — a follow-up queue for the
// pastoral team (Super Admin / Pastor Admin / Church Secretary; see
// is_pastoral_team() in sql/038) covering two kinds of "unassigned"
// people: anonymous guest visitors logged during attendance check-in
// (attendanceManager.js), and signed-up members with zero approved
// department memberships (computed live here, not stored until acted
// on). Both share the same NEW_GUEST -> CONTACTED ->
// ASSIGNED_TO_DEPARTMENT status.
import { confirmDialog } from './confirmDialog.js';
import { t, departmentLabel } from '../i18n.js';

const STATUSES = ['new_guest', 'contacted', 'assigned_to_department'];

export function createGuestOnboardingModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('guestHub.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  let departments = [];

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const [{ data: depts }, { data: leads, error: leadsError }, { data: profiles, error: profilesError }, { data: memberships }] = await Promise.all([
      supabase.from('departments').select('id, key, name').order('name'),
      supabase.from('guest_follow_ups').select('id, full_name, phone, email, city, referral_source, referred_by_name, age_range, prayer_request, wants_pastor_meeting, home_church, user_id, status, assigned_department_id, notes, source, created_at').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, created_at, global_role, profile_emails ( email )').is('removed_at', null).order('created_at', { ascending: false }),
      supabase.from('department_memberships').select('user_id'),
    ]);

    if (leadsError || profilesError) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('guestHub.loadFailed', { message: (leadsError || profilesError).message })}</p>`;
      return;
    }

    departments = depts || [];
    const assignedUserIds = new Set((memberships || []).map((m) => m.user_id));
    const leadUserIds = new Set((leads || []).filter((l) => l.user_id).map((l) => l.user_id));

    // Unassigned real accounts that don't have a lead row yet — shown
    // as a virtual "new_guest" row; a lead row is only actually created
    // once the pastoral team changes its status (see updateStatus()).
    // Global-role holders are excluded — they often have zero literal
    // department_memberships by design (their access is church-wide),
    // so they'd otherwise show up here as false "unassigned" leads.
    const unassignedProfiles = (profiles || [])
      .filter((p) => !p.global_role && !assignedUserIds.has(p.id) && !leadUserIds.has(p.id))
      .map((p) => ({
        id: null,
        full_name: p.full_name,
        email: p.profile_emails?.email || null,
        phone: null,
        user_id: p.id,
        status: 'new_guest',
        assigned_department_id: null,
        source: 'signup',
      }));

    const rows = [...(leads || []), ...unassignedProfiles];

    if (rows.length === 0) {
      bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('guestHub.none')}</p>`;
      return;
    }

    const table = document.createElement('table');
    table.className = 'w-full text-sm';
    table.innerHTML = `
      <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
        <tr>
          <th class="text-left px-4 py-2">${t('guestHub.name')}</th>
          <th class="text-left px-4 py-2">${t('guestHub.source')}</th>
          <th class="text-left px-4 py-2">${t('guestHub.status')}</th>
          <th class="text-left px-4 py-2">${t('guestHub.assignDepartment')}</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100"></tbody>
    `;
    const tbody = table.querySelector('tbody');

    rows.forEach((row) => {
      const tr = document.createElement('tr');
      const hasDetails = row.phone || row.email || row.city || row.referral_source
        || row.referred_by_name || row.age_range || row.prayer_request || row.wants_pastor_meeting || row.home_church;

      const nameCell = document.createElement('td');
      nameCell.className = 'px-4 py-2.5 font-medium whitespace-nowrap';
      if (hasDetails) {
        const nameBtn = document.createElement('button');
        nameBtn.type = 'button';
        nameBtn.className = 'text-slate-800 hover:text-indigo-600 hover:underline';
        nameBtn.textContent = row.full_name;
        nameBtn.addEventListener('click', () => detailsRow.classList.toggle('hidden'));
        nameCell.appendChild(nameBtn);
      } else {
        nameCell.className += ' text-slate-800';
        nameCell.textContent = row.full_name;
      }
      tr.appendChild(nameCell);

      const sourceCell = document.createElement('td');
      sourceCell.className = 'px-4 py-2.5 text-slate-500';
      sourceCell.textContent = t(`guestHub.source.${row.source || 'manual'}`);
      tr.appendChild(sourceCell);

      const statusCell = document.createElement('td');
      statusCell.className = 'px-4 py-2.5';
      const statusSelect = document.createElement('select');
      statusSelect.className = 'border border-slate-300 rounded-lg px-2 py-1 text-sm';
      statusSelect.innerHTML = STATUSES.map((s) => `<option value="${s}" ${s === row.status ? 'selected' : ''}>${t(`guestHub.status.${s}`)}</option>`).join('');
      statusSelect.addEventListener('change', () => updateStatus(row, { status: statusSelect.value }));
      statusCell.appendChild(statusSelect);
      tr.appendChild(statusCell);

      const deptCell = document.createElement('td');
      deptCell.className = 'px-4 py-2.5';
      const deptSelect = document.createElement('select');
      deptSelect.className = 'border border-slate-300 rounded-lg px-2 py-1 text-sm';
      deptSelect.innerHTML = `<option value="">${t('guestHub.noDepartment')}</option>` +
        departments.map((d) => `<option value="${d.id}" ${d.id === row.assigned_department_id ? 'selected' : ''}>${departmentLabel(d.key)}</option>`).join('');
      deptSelect.addEventListener('change', () => updateStatus(row, {
        assigned_department_id: deptSelect.value || null,
        status: deptSelect.value ? 'assigned_to_department' : row.status,
      }));
      deptCell.appendChild(deptSelect);
      tr.appendChild(deptCell);

      tbody.appendChild(tr);

      let detailsRow;
      if (hasDetails) {
        detailsRow = document.createElement('tr');
        detailsRow.className = 'hidden bg-slate-50';
        const detailsCell = document.createElement('td');
        detailsCell.colSpan = 4;
        detailsCell.className = 'px-4 py-3 text-sm text-slate-600';
        const fields = [
          [t('guestHub.detail.phone'), row.phone],
          [t('guestHub.detail.email'), row.email],
          [t('guestHub.detail.city'), row.city],
          [t('guestHub.detail.referral'), row.referral_source ? t(`attendance.referral.${row.referral_source}`) : null],
          [t('guestHub.detail.referredBy'), row.referred_by_name],
          [t('guestHub.detail.ageRange'), row.age_range ? t(`attendance.ageRange.${row.age_range}`) : null],
          [t('guestHub.detail.prayerRequest'), row.prayer_request],
          [t('guestHub.detail.wantsPastorMeeting'), row.wants_pastor_meeting ? t('common.yes') : null],
          [t('guestHub.detail.homeChurch'), row.home_church],
        ].filter(([, value]) => value);
        detailsCell.innerHTML = fields.map(([label, value]) => `<div><span class="font-medium text-slate-700">${escapeHtml(label)}:</span> ${escapeHtml(value)}</div>`).join('');
        detailsRow.appendChild(detailsCell);
        tbody.appendChild(detailsRow);
      }
    });

    bodyEl.innerHTML = '';
    bodyEl.appendChild(table);
  }

  // A row for an unassigned real account (row.id === null) doesn't have
  // a guest_follow_ups row yet — create it now, on first status change,
  // rather than eagerly for every unassigned account nobody's looked at.
  async function updateStatus(row, changes) {
    let leadId = row.id;

    if (!leadId) {
      const { data, error } = await supabase.from('guest_follow_ups').insert({
        full_name: row.full_name,
        email: row.email,
        user_id: row.user_id,
        source: row.source,
        created_by: currentUserId,
        status: changes.status || row.status,
        assigned_department_id: changes.assigned_department_id ?? null,
      }).select('id').single();

      if (error) {
        window.alert(t('guestHub.updateFailed', { message: error.message }));
        return;
      }
      leadId = data.id;
    } else {
      const { error } = await supabase.from('guest_follow_ups')
        .update({ ...changes, updated_at: new Date().toISOString() })
        .eq('id', leadId);

      if (error) {
        window.alert(t('guestHub.updateFailed', { message: error.message }));
        return;
      }
    }

    // A real account being assigned to a department also gets an actual
    // (pending) membership row here — a guest with no account has
    // nothing to assign beyond the note on the lead itself.
    if (row.user_id && changes.assigned_department_id) {
      const confirmed = await confirmDialog({
        message: t('guestHub.confirmAssign', { name: row.full_name, department: departmentLabel(departments.find((d) => d.id === changes.assigned_department_id)?.key) }),
        confirmLabel: t('guestHub.assign'),
        danger: false,
      });
      if (confirmed) {
        await supabase.from('department_memberships').insert({
          user_id: row.user_id,
          department_id: changes.assigned_department_id,
          role: 'member',
          status: 'pending',
        });
      }
    }

    load();
  }

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    load();
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
