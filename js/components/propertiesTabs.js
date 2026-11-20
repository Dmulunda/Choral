// AD-style "Properties" tabs -- one row of tabs, one panel visible at a
// time, so a detail view never needs a long scroll (modeled on the
// Active Directory user Properties dialog: General / Address /
// Account / ...).
//
// renderPropertiesTabs(container, tabs, { initial })
//   tabs: [{ id, label, content }] where content is an HTML string or
//         a DOM node. Empty tabs should be left out by the caller.
// Returns { select(id), panel(id) } so callers can wire events inside a
// panel (e.g. an "add note" button) after rendering.

export function renderPropertiesTabs(container, tabs, { initial } = {}) {
  const uid = `ptabs-${Math.random().toString(36).slice(2, 8)}`;
  container.innerHTML = `
    <div class="border border-slate-200 rounded-xl overflow-hidden bg-white">
      <div role="tablist" class="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 px-2 pt-2"></div>
      <div data-el="panels"></div>
    </div>
  `;
  const tablist = container.querySelector('[role="tablist"]');
  const panelsEl = container.querySelector('[data-el="panels"]');
  const buttons = [];
  const panels = {};

  tabs.forEach((tab, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.id = `${uid}-tab-${tab.id}`;
    btn.setAttribute('aria-controls', `${uid}-panel-${tab.id}`);
    btn.textContent = tab.label;
    btn.addEventListener('click', () => select(tab.id));
    btn.addEventListener('keydown', (e) => {
      let next = -1;
      if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      if (next < 0) return;
      e.preventDefault();
      select(tabs[next].id);
      buttons[next].focus();
    });
    tablist.appendChild(btn);
    buttons.push(btn);

    const panel = document.createElement('div');
    panel.setAttribute('role', 'tabpanel');
    panel.id = `${uid}-panel-${tab.id}`;
    panel.setAttribute('aria-labelledby', btn.id);
    panel.className = 'p-4 text-sm min-h-[14rem]';
    if (typeof tab.content === 'string') panel.innerHTML = tab.content;
    else if (tab.content) panel.appendChild(tab.content);
    panelsEl.appendChild(panel);
    panels[tab.id] = panel;
  });

  function select(id) {
    tabs.forEach((tab, i) => {
      const on = tab.id === id;
      const btn = buttons[i];
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
      btn.className = '-mb-px rounded-t-lg border px-3 py-1.5 text-sm font-medium transition-colors ' +
        (on
          ? 'border-slate-200 border-b-white bg-white text-slate-900'
          : 'border-transparent text-slate-500 hover:bg-white/70 hover:text-slate-900');
      panels[tab.id].hidden = !on;
    });
  }

  select(initial && panels[initial] ? initial : tabs[0]?.id);
  return { select, panel: (id) => panels[id] };
}

// Label / value rows used inside a tab (like the AD "First name: [ ]" grid).
export function propertyRows(rows, escapeHtml) {
  const visible = rows.filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (visible.length === 0) return '';
  return `
    <dl class="divide-y divide-slate-100 border border-slate-200 rounded-lg">
      ${visible.map(([label, value]) => `
        <div class="grid grid-cols-[9rem_1fr] gap-3 px-3 py-2">
          <dt class="text-slate-500">${escapeHtml(label)}</dt>
          <dd class="text-slate-800 font-medium break-words">${escapeHtml(value)}</dd>
        </div>
      `).join('')}
    </dl>
  `;
}
