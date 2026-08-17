// Admin "Members" tab: view the full roster, promote/demote roles, edit
// voice parts inline, and launch the "Add Singer" account-creation modal.
import { createMemberCreatorModal } from './memberCreatorModal.js';
import { t, voicePartLabel, roleLabel } from '../i18n.js';

const VOICE_PARTS = ['Leader', 'Soprano', 'Alto', 'Tenor', 'Pianist', 'Bassist', 'Guitarist', 'Drummer'];

export function renderMemberManager(container, { supabase, currentUserId }) {
  let members = [];

  container.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <span data-el="status" class="text-sm text-slate-500"></span>
      <button type="button" data-action="add-singer"
              class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 whitespace-nowrap">
        ${t('members.addSinger')}
      </button>
    </div>
    <div data-el="view" class="bg-white rounded-xl shadow overflow-x-auto"></div>
  `;

  const statusEl = container.querySelector('[data-el="status"]');
  const viewEl = container.querySelector('[data-el="view"]');

  const modal = createMemberCreatorModal({ supabase, onCreated: loadMembers });
  container.querySelector('[data-action="add-singer"]').addEventListener('click', () => modal.open());

  loadMembers();

  async function loadMembers() {
    statusEl.textContent = t('members.loadingMembers');
    viewEl.innerHTML = '';

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, voice_parts, instrument_name, profile_emails ( email )')
      .order('full_name');

    if (error) {
      statusEl.textContent = '';
      viewEl.innerHTML = `<p class="p-4 text-rose-600">${t('members.failedToLoad', { message: error.message })}</p>`;
      return;
    }

    members = data;
    statusEl.textContent = '';
    renderTable();
  }

  function renderTable() {
    const table = document.createElement('table');
    table.className = 'w-full text-sm';
    table.innerHTML = `
      <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
        <tr>
          <th class="text-left px-4 py-2">${t('members.name')}</th>
          <th class="text-left px-4 py-2">${t('members.email')}</th>
          <th class="text-left px-4 py-2">${t('members.voicePart')}</th>
          <th class="text-left px-4 py-2">${t('members.role')}</th>
          <th class="text-left px-4 py-2">${t('members.actions')}</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100"></tbody>
    `;

    const tbody = table.querySelector('tbody');

    members.forEach((member) => {
      const row = document.createElement('tr');

      const nameCell = document.createElement('td');
      nameCell.className = 'px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap';
      nameCell.textContent = member.full_name;

      const emailCell = document.createElement('td');
      emailCell.className = 'px-4 py-2.5 text-slate-500 whitespace-nowrap';
      emailCell.textContent = member.profile_emails?.email || t('members.emailUnknown');

      const voicePartCell = document.createElement('td');
      voicePartCell.className = 'px-4 py-2.5';
      const voicePartSelect = document.createElement('select');
      voicePartSelect.multiple = true;
      voicePartSelect.size = Math.min(VOICE_PARTS.length, 5);
      voicePartSelect.className = 'border border-slate-300 rounded-lg px-2 py-1 text-sm';
      voicePartSelect.innerHTML = VOICE_PARTS.map((part) => `<option value="${part}">${voicePartLabel(part)}</option>`).join('');
      setSelectedVoiceParts(voicePartSelect, member.voice_parts);
      voicePartSelect.addEventListener('change', () => updateVoicePart(member, voicePartSelect));
      voicePartCell.appendChild(voicePartSelect);

      const roleCell = document.createElement('td');
      roleCell.className = 'px-4 py-2.5';
      const roleBadge = document.createElement('span');
      roleBadge.className = member.role === 'admin'
        ? 'px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700'
        : 'px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600';
      roleBadge.textContent = roleLabel(member.role);
      roleCell.appendChild(roleBadge);

      const actionsCell = document.createElement('td');
      actionsCell.className = 'px-4 py-2.5';
      actionsCell.innerHTML = '';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'text-sm font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap block mb-1';
      toggleBtn.textContent = member.role === 'admin' ? t('members.makeSinger') : t('members.makeAdmin');
      toggleBtn.addEventListener('click', () => toggleRole(member));
      actionsCell.appendChild(toggleBtn);

      if (member.profile_emails?.email) {
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'text-sm font-medium text-slate-500 hover:text-slate-700 whitespace-nowrap block mb-1';
        resetBtn.textContent = t('members.sendReset');
        resetBtn.addEventListener('click', () => sendPasswordReset(member, resetBtn));
        actionsCell.appendChild(resetBtn);
      }

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'text-sm font-medium text-rose-600 hover:text-rose-800 whitespace-nowrap block';
      removeBtn.textContent = t('members.remove');
      removeBtn.addEventListener('click', () => removeMember(member));
      actionsCell.appendChild(removeBtn);

      row.append(nameCell, emailCell, voicePartCell, roleCell, actionsCell);
      tbody.appendChild(row);
    });

    viewEl.innerHTML = '';
    viewEl.appendChild(table);
  }

  async function toggleRole(member) {
    const promoting = member.role !== 'admin';
    const isSelf = member.id === currentUserId;

    const confirmMessage = isSelf
      ? t('members.confirmDemoteSelf')
      : promoting
        ? t('members.confirmPromote', { name: member.full_name })
        : t('members.confirmDemote', { name: member.full_name });

    if (!window.confirm(confirmMessage)) return;

    const newRole = promoting ? 'admin' : 'singer';

    const { data, error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', member.id)
      .select();

    if (error) {
      window.alert(t('members.roleUpdateFailed', { message: error.message }));
      return;
    }
    if (!data || data.length === 0) {
      window.alert(t('members.roleUpdateBlocked'));
      return;
    }

    member.role = newRole;
    renderTable();
  }

  async function updateVoicePart(member, selectEl) {
    const newVoiceParts = Array.from(selectEl.selectedOptions).map((opt) => opt.value);

    const { data, error } = await supabase
      .from('profiles')
      .update({ voice_parts: newVoiceParts })
      .eq('id', member.id)
      .select();

    if (error) {
      window.alert(t('members.voicePartUpdateFailed', { message: error.message }));
      setSelectedVoiceParts(selectEl, member.voice_parts);
      return;
    }
    if (!data || data.length === 0) {
      window.alert(t('members.roleUpdateBlocked'));
      setSelectedVoiceParts(selectEl, member.voice_parts);
      return;
    }

    member.voice_parts = newVoiceParts;
  }

  async function removeMember(member) {
    if (!window.confirm(t('members.confirmRemove', { name: member.full_name }))) return;

    const { error } = await supabase.from('profiles').delete().eq('id', member.id);
    if (error) {
      window.alert(t('members.removeFailed', { message: error.message }));
      return;
    }

    members = members.filter((m) => m.id !== member.id);
    renderTable();
  }

  async function sendPasswordReset(member, button) {
    const email = member.profile_emails?.email;
    if (!email) return;

    button.disabled = true;
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    button.disabled = false;

    if (error) {
      window.alert(t('members.resetFailed', { message: error.message }));
      return;
    }
    window.alert(t('members.resetSent', { name: member.full_name }));
  }
}

function setSelectedVoiceParts(selectEl, voiceParts) {
  const selected = new Set(voiceParts || []);
  Array.from(selectEl.options).forEach((opt) => { opt.selected = selected.has(opt.value); });
}
