// Super-Admin-only Usage Dashboard -- Main's own single-church version
// of SAAS's Site Admin Usage Dashboard. No church picker (Main has
// exactly one church, itself) and no plan/renewal/extensions cards
// (Main has no Stripe/plans concept) -- just login activity and a
// per-department breakdown (sql/094_usage_dashboard.sql).
//
// Charts via Chart.js, loaded on demand (same lazy-import pattern as
// pdfjs-dist elsewhere in this app). Follows the data-viz skill's form
// rules: single-series charts get one sequential hue and no legend,
// since the chart's own title already names the series. Deliberately
// EMERALD, not this app's own usual indigo -- both Main and SAAS
// otherwise share identical indigo-600 styling everywhere, and an
// admin who has both systems open needs a color cue, not just a page
// title, to tell which Usage Dashboard they're looking at (SAAS's own
// copy, js/siteAdminPage.js, stays indigo).
import { t } from '../i18n.js';

let chartJsPromise = null;
function loadChartJs() {
  if (!chartJsPromise) chartJsPromise = import('https://cdn.jsdelivr.net/npm/chart.js@4/auto/+esm').then((m) => m.default);
  return chartJsPromise;
}

const USAGE_CHART_EMERALD = '#059669';

export function createUsageDashboardModal({ supabase }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4 overflow-y-auto';
  root.innerHTML = `
    <div data-el="card" class="bg-white rounded-xl shadow-xl w-full max-w-4xl my-8 p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold text-emerald-900">${t('usageDashboard.title')}</h2>
        <div class="flex items-center gap-3">
          <button type="button" data-action="fullscreen" class="text-slate-400 hover:text-slate-600 text-lg leading-none" title="${t('usageDashboard.fullscreen')}">⛶</button>
          <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>
      </div>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  const cardEl = root.querySelector('[data-el="card"]');
  const bodyEl = root.querySelector('[data-el="body"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  // Native Fullscreen API on the card itself (not the dimmed overlay)
  // -- the browser handles Esc-to-exit and chrome-hiding for free.
  // Classes swap on fullscreenchange (not just at click time) so
  // pressing Esc to leave fullscreen also reverts the layout, not just
  // the browser's own fullscreen state.
  const fullscreenBtn = root.querySelector('[data-action="fullscreen"]');
  fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement === cardEl) document.exitFullscreen();
    else cardEl.requestFullscreen?.();
  });
  document.addEventListener('fullscreenchange', () => {
    const isFs = document.fullscreenElement === cardEl;
    cardEl.classList.toggle('max-w-4xl', !isFs);
    cardEl.classList.toggle('rounded-xl', !isFs);
    cardEl.classList.toggle('my-8', !isFs);
    cardEl.classList.toggle('max-w-none', isFs);
    cardEl.classList.toggle('h-full', isFs);
    cardEl.classList.toggle('overflow-y-auto', isFs);
    fullscreenBtn.title = isFs ? t('usageDashboard.exitFullscreen') : t('usageDashboard.fullscreen');
  });

  function usageMeterHtml(label, count, limit) {
    const pct = limit ? Math.min(100, Math.round((count / limit) * 100)) : null;
    const nearLimit = pct != null && pct >= 90;
    return `
      <div>
        <div class="flex items-center justify-between text-xs text-slate-500 mb-1">
          <span>${label}</span>
          <span class="${nearLimit ? 'text-amber-700 font-semibold' : ''}">${count}${limit != null ? ` / ${limit}` : ''}</span>
        </div>
        <div class="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div class="h-full rounded-full ${nearLimit ? 'bg-amber-500' : 'bg-emerald-600'}" style="width:${pct ?? 100}%"></div>
        </div>
      </div>
    `;
  }

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const [{ data: trend, error: trendError }, { data: depts, error: deptsError }] = await Promise.all([
      supabase.rpc('get_login_trend'),
      supabase.rpc('list_department_usage'),
    ]);
    if (trendError || deptsError) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('usageDashboard.loadFailed', { message: (trendError || deptsError).message })}</p>`;
      return;
    }
    const departments = depts || [];
    const totalActiveMembers = departments.reduce((sum, d) => sum + Number(d.active_member_count), 0);
    const totalShifts = departments.reduce((sum, d) => sum + Number(d.shift_count), 0);
    const logins7d = (trend || []).filter((r) => (Date.now() - new Date(r.day).getTime()) <= 7 * 24 * 60 * 60 * 1000).reduce((sum, r) => sum + Number(r.logins), 0);

    bodyEl.innerHTML = `
      <div class="grid sm:grid-cols-3 gap-3 mb-4">
        <div class="border border-slate-200 rounded-lg px-3 py-2">${usageMeterHtml(t('usageDashboard.totalActiveMembers'), totalActiveMembers, null)}</div>
        <div class="border border-slate-200 rounded-lg px-3 py-2">${usageMeterHtml(t('usageDashboard.totalShifts'), totalShifts, null)}</div>
        <div class="border border-slate-200 rounded-lg px-3 py-2">${usageMeterHtml(t('usageDashboard.logins7d'), logins7d, null)}</div>
      </div>
      <div class="grid lg:grid-cols-2 gap-4 mb-4">
        <div class="border border-slate-200 rounded-lg p-3">
          <p class="text-sm font-semibold text-slate-700 mb-2">${t('usageDashboard.loginTrend')}</p>
          <canvas data-el="login-chart" height="160"></canvas>
        </div>
        <div class="border border-slate-200 rounded-lg p-3">
          <p class="text-sm font-semibold text-slate-700 mb-2">${t('usageDashboard.membersByDept')}</p>
          ${departments.length ? '<canvas data-el="dept-chart" height="160"></canvas>' : `<p class="text-sm text-slate-400">${t('usageDashboard.noDepartments')}</p>`}
        </div>
      </div>
      ${departments.length ? `
        <div class="mb-2">
          <label class="text-sm font-medium text-slate-600 mr-2">${t('usageDashboard.selectDepartment')}</label>
          <select data-el="dept-select" class="border border-slate-300 rounded-lg px-3 py-1.5 text-sm">
            <option value="">${t('usageDashboard.selectDepartmentPlaceholder')}</option>
            ${departments.map((d) => `<option value="${d.department_id}">${escapeHtml(d.department_name)}</option>`).join('')}
          </select>
        </div>
        <div data-el="dept-detail"></div>
      ` : ''}
    `;

    await renderLoginTrendChart(bodyEl.querySelector('[data-el="login-chart"]'), trend || []);

    if (departments.length) {
      const deptDetailEl = bodyEl.querySelector('[data-el="dept-detail"]');
      const deptSelectEl = bodyEl.querySelector('[data-el="dept-select"]');
      const selectDept = (deptId) => {
        deptSelectEl.value = deptId;
        renderDepartmentUsage(deptDetailEl, departments.find((d) => d.department_id === deptId));
      };
      await renderDeptMembersChart(bodyEl.querySelector('[data-el="dept-chart"]'), departments, selectDept);
      deptSelectEl.addEventListener('change', (e) => renderDepartmentUsage(deptDetailEl, departments.find((d) => d.department_id === e.target.value)));
    }
  }

  function renderDepartmentUsage(container, dept) {
    if (!dept) { container.innerHTML = ''; return; }
    container.innerHTML = `
      <div class="border border-emerald-200 bg-emerald-50 rounded-lg p-4">
        <p class="text-sm font-semibold text-emerald-900 mb-2">${escapeHtml(dept.department_name)}</p>
        <div class="grid sm:grid-cols-3 gap-3">
          <div><p class="text-xs text-slate-500">${t('usageDashboard.activeMembers')}</p><p class="text-xl font-bold text-slate-800">${dept.active_member_count}</p></div>
          <div><p class="text-xs text-slate-500">${t('usageDashboard.shiftsScheduled')}</p><p class="text-xl font-bold text-slate-800">${dept.shift_count}</p></div>
          <div><p class="text-xs text-slate-500">${t('usageDashboard.upcomingShifts')}</p><p class="text-xl font-bold text-slate-800">${dept.upcoming_shift_count}</p></div>
        </div>
        <p class="text-xs text-slate-400 mt-3">${t('usageDashboard.attendanceNote')}</p>
      </div>
    `;
  }

  async function renderLoginTrendChart(canvas, trendRows) {
    if (!canvas) return;
    const Chart = await loadChartJs();
    const byDay = new Map((trendRows || []).map((r) => [r.day, Number(r.logins)]));
    const labels = [];
    const counts = [];
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      labels.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
      counts.push(byDay.get(key) || 0);
    }
    new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: [{ data: counts, borderColor: USAGE_CHART_EMERALD, backgroundColor: 'rgba(5,150,105,0.1)', fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 }] },
      options: {
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  }

  async function renderDeptMembersChart(canvas, departments, onSelectDept) {
    if (!canvas) return;
    const Chart = await loadChartJs();
    new Chart(canvas, {
      type: 'bar',
      data: { labels: departments.map((d) => d.department_name), datasets: [{ data: departments.map((d) => d.active_member_count), backgroundColor: USAGE_CHART_EMERALD, borderRadius: 4 }] },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const dept = departments[elements[0].index];
          if (dept) onSelectDept(dept.department_id);
        },
        onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
      },
    });
  }

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    load();
  }

  function close() {
    if (document.fullscreenElement === cardEl) document.exitFullscreen();
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
