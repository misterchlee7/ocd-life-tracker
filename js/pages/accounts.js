import { state, uid } from '../core/state.js';
import { bootstrap, isMobile, whoPill, toast, positionMenu, confirmModal, amountModal, closeOnEscape, pageHeaderHTML, fmtMoney, fmtMoneyShort } from '../core/ui.js';
import { todayISO, shortDate, relativeDays } from '../core/dates.js';
import { balanceSeries, seriesDelta } from '../core/derive.js';
import {
  escapeHTML, escapeAttr, truncate,
  ACCOUNT_TYPES as TYPES, ACCOUNT_TYPE_LABELS as TYPE_LABELS,
  ACCOUNT_STATUS_LABELS as STATUS_LABELS,
} from '../core/text.js';

const page = document.getElementById('page');

const ui = {
  search: '',
  who: 'all',
  type: 'all',
  showClosed: false,
  sort: { key: 'institution', dir: 'asc' },
  openMenuId: null,
  chart: { scope: 'invest', accountId: null, range: '1y' },
};

// ---------- helpers ----------

function accounts(data) {
  return data.accounts || [];
}

function accountLabel(a) {
  return `${a.institution} — ${a.name}`;
}

// Latest snapshot by date, or null. Snapshots are kept ascending, but sort
// defensively in case of hand-edited data.
function latestSnapshot(a) {
  const snaps = a.snapshots || [];
  if (!snaps.length) return null;
  return [...snaps].sort((x, y) => x.date.localeCompare(y.date))[snaps.length - 1];
}

function filterAccounts(data) {
  const q = ui.search.trim().toLowerCase();
  return accounts(data).filter(a => {
    if (!ui.showClosed && a.status === 'closed') return false;
    if (ui.who !== 'all' && a.who !== ui.who) return false;
    if (ui.type !== 'all' && a.type !== ui.type) return false;
    if (q && !(`${a.institution} ${a.name} ${a.last4 || ''} ${a.notes || ''}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

function sortAccounts(list) {
  const { key, dir } = ui.sort;
  const mul = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    switch (key) {
      case 'name': return (a.name || '').localeCompare(b.name || '') * mul;
      case 'type': return (a.type || '').localeCompare(b.type || '') * mul;
      case 'apy': return ((a.apy ?? -1) - (b.apy ?? -1)) * mul;
      case 'balance': {
        const av = latestSnapshot(a)?.balance ?? -1;
        const bv = latestSnapshot(b)?.balance ?? -1;
        return (av - bv) * mul;
      }
      case 'opened_date': return ((a.opened_date || '') > (b.opened_date || '') ? 1 : -1) * mul;
      case 'institution':
      default: return (a.institution || '').localeCompare(b.institution || '') * mul
        || (a.name || '').localeCompare(b.name || '');
    }
  });
}

// ---------- render ----------

function render({ data, loading }) {
  if (!data) {
    page.innerHTML = loading
      ? `<div class="empty"><h3>Loading…</h3></div>`
      : `<div class="empty"><h3>Not connected</h3><p>Open settings (⚙) to configure your GitHub data repo.</p></div>`;
    return;
  }

  const all = accounts(data);
  const open = all.filter(a => a.status !== 'closed');
  const closed = all.filter(a => a.status === 'closed');

  const filtered = sortAccounts(filterAccounts(data));

  page.innerHTML = `
    ${pageHeaderHTML('Accounts', `${open.length} open`,
      `<button class="btn" id="btn-bulk-snap">Update balances</button>
       <button class="btn primary" id="btn-add">+ Add account</button>`)}
    ${summaryHTML({ open, closed })}
    ${chartPanelHTML(data)}
    ${filtersHTML()}
    ${filtered.length === 0
      ? `<div class="empty"><h3>No accounts</h3><p>Click + Add account to track your first one.</p></div>`
      : tableHTML(filtered)}
  `;

  wireInteractions(data);
}

function summaryHTML({ open, closed }) {
  const byWho = { chang: 0, kiju: 0, joint: 0 };
  open.forEach(a => { if (byWho[a.who] != null) byWho[a.who]++; });
  const whoSub = Object.entries(byWho).filter(([, n]) => n > 0)
    .map(([w, n]) => `${w === 'chang' ? 'C' : w === 'kiju' ? 'K' : 'J'}: ${n}`).join(' · ') || '—';

  const snapped = open.map(a => ({ a, snap: latestSnapshot(a) })).filter(x => x.snap);
  const total = snapped.reduce((s, x) => s + x.snap.balance, 0);
  const oldest = snapped.map(x => x.snap.date).sort()[0];
  const totalLabel = snapped.length ? fmtMoney(total) : '—';
  const totalSub = snapped.length
    ? `${snapped.length}/${open.length} accounts · oldest ${relativeDays(oldest)}`
    : 'no balance snapshots yet';

  const retirementTotal = snapped
    .filter(x => x.a.type === 'retirement' || x.a.type === 'hsa')
    .reduce((s, x) => s + x.snap.balance, 0);
  const nonRetirementTotal = total - retirementTotal;
  const breakdownSub = snapped.length
    ? `Retirement ${fmtMoney(retirementTotal)} · Non-retirement ${fmtMoney(nonRetirementTotal)}`
    : '';

  const best = open.filter(a => a.apy != null).sort((a, b) => b.apy - a.apy)[0];
  const bestLabel = best ? `${best.apy}%` : '—';
  const bestSub = best ? escapeHTML(accountLabel(best)) : 'no APY recorded';

  return `
    <div class="summary">
      <div class="card">
        <div class="label">Open accounts</div>
        <div class="value">${open.length}</div>
        <div class="sub">${whoSub}</div>
      </div>
      <div class="card">
        <div class="label">Snapshot total</div>
        <div class="value" style="font-size:1.1rem">${totalLabel}</div>
        <div class="sub">${totalSub}</div>
        ${breakdownSub ? `<div class="sub">${breakdownSub}</div>` : ''}
      </div>
      <div class="card">
        <div class="label">Best APY</div>
        <div class="value">${bestLabel}</div>
        <div class="sub">${bestSub}</div>
      </div>
      <div class="card">
        <div class="label">Closed</div>
        <div class="value">${closed.length}</div>
        <div class="sub">kept for reference</div>
      </div>
    </div>
  `;
}

// ---------- balance trend chart ----------
//
// One line for the selected scope (all investment / one type / one account),
// forward-filled between snapshots (dots = real snapshots). Growth here includes
// contributions — balance over time, not investment return (docs/decisions.md).

const INVEST_TYPES = ['brokerage', 'retirement', 'hsa'];
const CHART_SCOPES = [['invest', 'All investment'], ['brokerage', 'Brokerage'], ['retirement', 'Retirement'], ['hsa', 'HSA']];
const CHART_RANGES = [['3m', '3M'], ['6m', '6M'], ['ytd', 'YTD'], ['1y', '1Y'], ['all', 'All']];
const CHART_W = 860, CHART_H = 230;
const CHART_M = { l: 8, r: 8, t: 16, b: 22 };

// Set by chartPanelHTML for the current render; read by the hover wiring.
let chartGeom = null;

// Open investment accounts — drives chips, the single-account select, and
// whether the panel renders at all.
function investAccounts(data) {
  return accounts(data).filter(a => a.status !== 'closed' && INVEST_TYPES.includes(a.type));
}

// Series pool includes CLOSED accounts: their snapshot history is real — dropping
// it would retroactively rewrite past aggregate totals. Marking an account closed
// writes a $0 snapshot (see handleMenuAction), so a closed line falls to zero
// instead of carrying its last balance forward.
function chartScopeAccounts(data) {
  if (ui.chart.accountId) return accounts(data).filter(a => a.id === ui.chart.accountId);
  const pool = accounts(data).filter(a => INVEST_TYPES.includes(a.type));
  if (ui.chart.scope === 'invest') return pool;
  return pool.filter(a => a.type === ui.chart.scope);
}

function chartRangeStart(range, scoped) {
  const t = todayISO();
  if (range === 'ytd') return `${t.slice(0, 4)}-01-01`;
  if (range === 'all') {
    const first = scoped.flatMap(a => (a.snapshots || []).map(s => s.date)).sort()[0];
    return first || t;
  }
  const d = new Date(t + 'T00:00:00');
  if (range === '3m') d.setMonth(d.getMonth() - 3);
  else if (range === '6m') d.setMonth(d.getMonth() - 6);
  else d.setFullYear(d.getFullYear() - 1); // 1y
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const dayNum = (iso) => Date.parse(iso + 'T00:00:00') / 86400000;

function chartSVG(points) {
  const t0 = dayNum(points[0].date);
  const span = Math.max(dayNum(points[points.length - 1].date) - t0, 1);
  const xFor = (iso) => CHART_M.l + ((dayNum(iso) - t0) / span) * (CHART_W - CHART_M.l - CHART_M.r);

  let lo = Math.min(...points.map(p => p.value));
  let hi = Math.max(...points.map(p => p.value));
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const yFor = (v) => CHART_H - CHART_M.b - ((v - lo) / (hi - lo)) * (CHART_H - CHART_M.t - CHART_M.b);

  chartGeom = { points, xFor, yFor };

  // Recessive grid: 4 evenly spaced horizontal lines, labels above-left.
  const grid = [0, 1, 2, 3].map(i => {
    const v = lo + ((hi - lo) * i) / 3;
    const y = yFor(v);
    return `<line x1="${CHART_M.l}" y1="${y}" x2="${CHART_W - CHART_M.r}" y2="${y}" class="cg-grid"/>
      <text x="${CHART_M.l}" y="${y - 4}" class="cg-lbl">${fmtMoneyShort(v)}</text>`;
  }).join('');

  // X ticks: 4 dates interpolated across the window.
  const xticks = [0, 1 / 3, 2 / 3, 1].map(f => {
    const ms = (t0 + f * span) * 86400000;
    const d = new Date(ms);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const anchor = f === 0 ? 'start' : f === 1 ? 'end' : 'middle';
    return `<text x="${CHART_M.l + f * (CHART_W - CHART_M.l - CHART_M.r)}" y="${CHART_H - 6}" text-anchor="${anchor}" class="cg-lbl">${shortDate(iso)}</text>`;
  }).join('');

  const coords = points.map(p => `${xFor(p.date).toFixed(1)},${yFor(p.value).toFixed(1)}`);
  const linePath = 'M' + coords.join(' L');
  const baseline = CHART_H - CHART_M.b;
  const areaPath = `${linePath} L${xFor(points[points.length - 1].date).toFixed(1)},${baseline} L${xFor(points[0].date).toFixed(1)},${baseline} Z`;

  const dots = points.filter(p => p.real).map(p =>
    `<circle cx="${xFor(p.date).toFixed(1)}" cy="${yFor(p.value).toFixed(1)}" r="3" class="cg-dot"/>`).join('');

  return `
    <div class="chart-svg-wrap">
      <svg class="chart-svg" viewBox="0 0 ${CHART_W} ${CHART_H}" role="img" aria-label="Balance over time">
        ${grid}${xticks}
        <path d="${areaPath}" class="cg-area"/>
        <path d="${linePath}" class="cg-line"/>
        ${dots}
        <line class="cg-xhair" y1="${CHART_M.t}" y2="${baseline}" style="display:none"/>
        <circle class="cg-xhair-dot" r="4" style="display:none"/>
      </svg>
      <div class="chart-tooltip" style="display:none"></div>
    </div>
  `;
}

function chartPanelHTML(data) {
  const pool = investAccounts(data);
  if (!pool.length) { chartGeom = null; return ''; }
  if (ui.chart.accountId && !pool.some(a => a.id === ui.chart.accountId)) ui.chart.accountId = null;

  const scoped = chartScopeAccounts(data);
  const end = todayISO();
  const start = chartRangeStart(ui.chart.range, scoped);
  const points = balanceSeries(scoped, start, end);
  const delta = seriesDelta(points);
  chartGeom = null;

  const count = (t) => pool.filter(a => a.type === t).length;
  const scopeChips = CHART_SCOPES
    .filter(([val]) => val === 'invest' || count(val) > 0)
    .map(([val, label]) =>
      `<div class="chip ${!ui.chart.accountId && ui.chart.scope === val ? 'active' : ''}" data-cscope="${val}">${label}</div>`)
    .join('');
  const acctOptions = pool.map(a =>
    `<option value="${a.id}" ${ui.chart.accountId === a.id ? 'selected' : ''}>${escapeHTML(accountLabel(a))}</option>`).join('');
  const rangeChips = CHART_RANGES.map(([val, label]) =>
    `<div class="chip ${ui.chart.range === val ? 'active' : ''}" data-crange="${val}">${label}</div>`).join('');

  let readout = '';
  let body;
  if (points.length < 2) {
    body = `<div class="chart-empty">Not enough snapshots yet — add balance snapshots (row menu, or “Update balances” above) to see the trend.</div>`;
  } else {
    const cls = delta.delta > 0 ? 'pos' : delta.delta < 0 ? 'neg' : '';
    const sign = delta.delta > 0 ? '+' : delta.delta < 0 ? '−' : '';
    const pct = delta.pct != null ? ` (${sign}${Math.abs(delta.pct).toFixed(1)}%)` : '';
    readout = `
      <div class="chart-readout">
        <span class="chart-now">${fmtMoney(delta.end)}</span>
        <span class="chart-delta ${cls}">${sign}${fmtMoney(Math.abs(delta.delta))}${pct}</span>
        <span class="chart-range-note">since ${shortDate(points[0].date)}</span>
      </div>`;
    body = chartSVG(points);
  }

  return `
    <div class="chart-panel">
      <div class="chart-head">
        <span class="chart-title">Balance trend</span>
        <span class="chart-note">includes contributions — growth, not investment return</span>
      </div>
      <div class="chart-controls">
        <div class="chips">${scopeChips}</div>
        <select class="select" id="chart-acct">
          <option value="">Single account…</option>
          ${acctOptions}
        </select>
        <span class="chart-spacer"></span>
        <div class="chips">${rangeChips}</div>
      </div>
      ${readout}
      ${body}
      ${breakdownHTML(scoped, start, end)}
    </div>
  `;
}

function breakdownHTML(scoped, start, end) {
  if (scoped.length < 2) return '';
  const rows = scoped.map(a => {
    const pts = balanceSeries([a], start, end);
    const d = seriesDelta(pts);
    return { a, pts, d };
  }).sort((x, y) => (y.d?.end ?? latestSnapshot(y.a)?.balance ?? 0) - (x.d?.end ?? latestSnapshot(x.a)?.balance ?? 0));

  const cells = rows.map(({ a, pts, d }) => {
    if (!d) {
      const snap = latestSnapshot(a);
      return `<tr class="archived">
        <td><b>${escapeHTML(accountLabel(a))}</b></td>
        <td>${TYPE_LABELS[a.type] || a.type}</td>
        <td class="tight">${snap ? fmtMoney(snap.balance) : '—'}</td>
        <td class="tight">—</td><td class="tight">—</td>
        <td class="muted">${pts.length === 1 ? 'one snapshot in range' : 'no snapshots'}</td>
      </tr>`;
    }
    const cls = d.delta > 0 ? 'pos' : d.delta < 0 ? 'neg' : '';
    const sign = d.delta > 0 ? '+' : d.delta < 0 ? '−' : '';
    const closed = a.status === 'closed';
    return `<tr class="${closed ? 'archived' : ''}">
      <td><b>${escapeHTML(accountLabel(a))}</b>${closed ? ` <span class="pill tiny">${STATUS_LABELS.closed}</span>` : ''}</td>
      <td>${TYPE_LABELS[a.type] || a.type}</td>
      <td class="tight">${fmtMoney(d.end)}</td>
      <td class="tight chart-cell ${cls}">${sign}${fmtMoney(Math.abs(d.delta))}</td>
      <td class="tight chart-cell ${cls}">${d.pct != null ? sign + Math.abs(d.pct).toFixed(1) + '%' : '—'}</td>
      <td class="muted">from ${fmtMoney(d.start)} · ${shortDate(pts[0].date)}</td>
    </tr>`;
  }).join('');

  return `
    <div class="table-wrap chart-breakdown">
      <table>
        <thead><tr><th>Account</th><th>Type</th><th>Now</th><th>Δ</th><th>Δ%</th><th>Basis</th></tr></thead>
        <tbody>${cells}</tbody>
      </table>
    </div>
  `;
}

function wireChart(data) {
  page.querySelectorAll('[data-cscope]').forEach(ch => ch.addEventListener('click', () => {
    ui.chart.scope = ch.dataset.cscope;
    ui.chart.accountId = null;
    render(state.get());
  }));
  page.querySelectorAll('[data-crange]').forEach(ch => ch.addEventListener('click', () => {
    ui.chart.range = ch.dataset.crange;
    render(state.get());
  }));
  document.getElementById('chart-acct')?.addEventListener('change', (e) => {
    ui.chart.accountId = e.target.value || null;
    render(state.get());
  });
  wireChartHover();
}

function wireChartHover() {
  if (!chartGeom) return;
  const wrap = page.querySelector('.chart-svg-wrap');
  const svg = wrap?.querySelector('svg');
  if (!svg) return;
  const tip = wrap.querySelector('.chart-tooltip');
  const xhair = svg.querySelector('.cg-xhair');
  const hdot = svg.querySelector('.cg-xhair-dot');
  const { points, xFor, yFor } = chartGeom;

  svg.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * CHART_W;
    let best = null, bd = Infinity;
    for (const p of points) {
      const d = Math.abs(xFor(p.date) - sx);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return;
    const x = xFor(best.date), y = yFor(best.value);
    xhair.setAttribute('x1', x); xhair.setAttribute('x2', x); xhair.style.display = '';
    hdot.setAttribute('cx', x); hdot.setAttribute('cy', y); hdot.style.display = '';
    tip.innerHTML = `<b>${fmtMoney(best.value)}</b> · ${shortDate(best.date)}${best.real ? '' : ' <span class="muted">· carried</span>'}`;
    tip.style.display = '';
    const px = (x / CHART_W) * rect.width;
    const py = (y / CHART_H) * rect.height;
    tip.style.left = `${Math.min(Math.max(px, 60), rect.width - 60)}px`;
    tip.style.top = `${py}px`;
  });
  svg.addEventListener('mouseleave', () => {
    xhair.style.display = 'none';
    hdot.style.display = 'none';
    tip.style.display = 'none';
  });
}

function filtersHTML() {
  const chip = (val, label) =>
    `<div class="chip ${ui.who === val ? 'active' : ''}" data-w="${val}">${label}</div>`;
  return `
    <div class="filters">
      <label class="search">
        <input id="f-search" placeholder="Search accounts…" value="${escapeAttr(ui.search)}"/>
      </label>
      <div class="chips" id="f-who">
        ${chip('all', 'All')}${chip('chang', 'Chang')}${chip('kiju', 'Kiju')}${chip('joint', 'Joint')}
      </div>
      <select class="select" id="f-type">
        <option value="all">All types</option>
        ${TYPES.map(t => `<option value="${t}" ${ui.type === t ? 'selected' : ''}>${TYPE_LABELS[t]}</option>`).join('')}
      </select>
      <label class="chip ${ui.showClosed ? 'active' : ''}" style="cursor:pointer">
        <input type="checkbox" id="f-closed" ${ui.showClosed ? 'checked' : ''} style="display:none"> Show closed
      </label>
    </div>
  `;
}

function thSortable(key, label) {
  const active = ui.sort.key === key;
  const arrow = active ? (ui.sort.dir === 'asc' ? '▲' : '▼') : '▾';
  return `<th class="sortable ${active ? 'sorted' : ''}" data-sort="${key}">${label} <span class="sort-icon">${arrow}</span></th>`;
}

function tableHTML(list) {
  const bodyRows = list.map(a => accountRowHTML(a)).join('');
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${thSortable('institution', 'Institution')}
            ${thSortable('name', 'Account')}
            ${thSortable('type', 'Type')}
            <th>Who</th>
            <th>Last 4</th>
            ${thSortable('apy', 'APY')}
            ${thSortable('balance', 'Balance')}
            ${thSortable('opened_date', 'Opened')}
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

function accountRowHTML(a) {
  const closed = a.status === 'closed';
  const snap = latestSnapshot(a);
  const balanceDisplay = snap
    ? `<b>${fmtMoney(snap.balance)}</b> <span class="muted" style="font-size:11px">${relativeDays(snap.date)}</span>`
    : '—';
  return `
    <tr data-id="${a.id}" class="${closed ? 'archived' : ''}">
      <td><b>${escapeHTML(a.institution)}</b></td>
      <td>${escapeHTML(a.name)}${closed ? ` <span class="pill tiny">${STATUS_LABELS.closed}</span>` : ''}</td>
      <td class="status-cell" data-type-id="${a.id}">${TYPE_LABELS[a.type] || a.type || '—'}</td>
      <td>${whoPill(a.who)}</td>
      <td class="note-cell tight" data-last4-id="${a.id}">${escapeHTML(a.last4 || '—')}</td>
      <td class="note-cell tight" data-apy-id="${a.id}">${a.apy != null ? a.apy + '%' : '—'}</td>
      <td class="tight">${balanceDisplay}</td>
      <td class="tight">${a.opened_date ? shortDate(a.opened_date) : '—'}</td>
      <td class="note-cell" data-note-id="${a.id}" title="${escapeAttr(a.notes || '')}">${truncate(a.notes || '', 28)}</td>
      <td class="row-actions">
        <button class="del" data-del="${a.id}" title="Delete">✕</button>
        <button class="dots" data-menu="${a.id}">⋯</button>
        ${ui.openMenuId === a.id ? rowMenuHTML(a) : ''}
      </td>
    </tr>
  `;
}

function rowMenuHTML(a) {
  const closed = a.status === 'closed';
  return `
    <div class="menu" data-id="${a.id}">
      <div class="menu-item" data-act="edit"><div class="title">✏️ Edit</div></div>
      <div class="menu-item" data-act="snapshot"><div class="title">📸 Add balance snapshot</div></div>
      <div class="menu-sep"></div>
      <div class="menu-item" data-act="toggle-status"><div class="title">${closed ? '🔓 Reopen account' : '🔒 Mark closed'}</div></div>
      <div class="menu-item danger" data-act="delete"><div class="title">🗑️ Delete</div></div>
    </div>
  `;
}

// ---------- interactions ----------

function wireInteractions(data) {
  document.getElementById('f-search')?.addEventListener('input', (e) => {
    ui.search = e.target.value; render(state.get());
    document.getElementById('f-search').focus();
  });
  document.getElementById('f-who')?.addEventListener('click', (e) => {
    const w = e.target.closest('[data-w]')?.dataset.w;
    if (!w) return;
    ui.who = w; render(state.get());
  });
  document.getElementById('f-type')?.addEventListener('change', (e) => {
    ui.type = e.target.value; render(state.get());
  });
  document.getElementById('f-closed')?.addEventListener('change', (e) => {
    ui.showClosed = e.target.checked; render(state.get());
  });
  document.getElementById('btn-add')?.addEventListener('click', () => openForm());
  document.getElementById('btn-bulk-snap')?.addEventListener('click', openBulkSnapshotModal);
  wireChart(data);

  page.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (ui.sort.key === key) ui.sort.dir = ui.sort.dir === 'asc' ? 'desc' : 'asc';
      else ui.sort = { key, dir: 'asc' };
      render(state.get());
    });
  });

  page.querySelectorAll('button.del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDelete(btn.dataset.del);
    });
  });

  page.querySelectorAll('[data-menu]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      ui.openMenuId = ui.openMenuId === btn.dataset.menu ? null : btn.dataset.menu;
      render(state.get());
    });
  });

  page.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = item.closest('.menu')?.dataset.id;
      if (!id) return;
      handleMenuAction(id, item.dataset.act);
      ui.openMenuId = null;
    });
  });

  if (ui.openMenuId) {
    const openMenu = page.querySelector('.menu');
    const anchorBtn = page.querySelector(`[data-menu="${ui.openMenuId}"]`);
    if (openMenu && anchorBtn) positionMenu(openMenu, anchorBtn);

    document.addEventListener('click', () => {
      document.querySelectorAll('body > .menu').forEach(m => m.remove());
      ui.openMenuId = null;
      render(state.get());
    }, { once: true });
  }

  // Inline text edits (last4, notes)
  function noteEdit(selector, field) {
    page.querySelectorAll(selector).forEach(td => {
      td.addEventListener('click', () => {
        if (td.querySelector('input')) return;
        const id = Object.values(td.dataset)[0];
        const item = state.get().data?.accounts?.find(x => x.id === id);
        if (!item) return;
        const current = item[field] || '';
        td.innerHTML = '';
        const input = document.createElement('input');
        input.className = 'note-input';
        input.value = current;
        td.appendChild(input);
        input.focus(); input.select();
        function commit() {
          const val = input.value.trim();
          if (val !== current) {
            state.mutate(d => {
              const a = (d.accounts || []).find(x => x.id === id);
              if (a) a[field] = val;
            }, `edit ${field}: ${accountLabel(item)}`);
          } else { render(state.get()); }
        }
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur();
          if (e.key === 'Escape') { input.removeEventListener('blur', commit); render(state.get()); }
        });
      });
    });
  }

  noteEdit('td[data-last4-id]', 'last4');
  noteEdit('td[data-note-id]', 'notes');

  // APY inline edit — numeric; empty clears
  page.querySelectorAll('td[data-apy-id]').forEach(td => {
    td.addEventListener('click', () => {
      if (td.querySelector('input')) return;
      const id = td.dataset.apyId;
      const item = state.get().data?.accounts?.find(x => x.id === id);
      if (!item) return;
      const current = item.apy != null ? String(item.apy) : '';
      td.innerHTML = '';
      const input = document.createElement('input');
      input.className = 'note-input';
      input.type = 'number';
      input.step = '0.01';
      input.min = '0';
      input.setAttribute('inputmode', 'decimal');
      input.value = current;
      td.appendChild(input);
      input.focus(); input.select();
      function commit() {
        const raw = input.value.trim();
        if (raw === current) { render(state.get()); return; }
        const val = raw === '' ? null : parseFloat(raw);
        if (raw !== '' && isNaN(val)) { toast('Enter a valid APY', 'error'); render(state.get()); return; }
        state.mutate(d => {
          const a = (d.accounts || []).find(x => x.id === id);
          if (a) a.apy = val;
        }, `edit apy: ${accountLabel(item)} → ${val == null ? '—' : val + '%'}`);
      }
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { input.removeEventListener('blur', commit); render(state.get()); }
      });
    });
  });

  // Type inline select
  page.querySelectorAll('td.status-cell[data-type-id]').forEach(td => {
    td.addEventListener('click', () => {
      if (td.querySelector('select')) return;
      const id = td.dataset.typeId;
      const a = state.get().data?.accounts?.find(x => x.id === id);
      if (!a) return;
      td.innerHTML = '';
      const select = document.createElement('select');
      select.className = 'inline-select';
      TYPES.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t; opt.textContent = TYPE_LABELS[t];
        if (t === a.type) opt.selected = true;
        select.appendChild(opt);
      });
      td.appendChild(select);
      select.focus();
      select.addEventListener('change', () => {
        state.mutate(d => {
          const item = (d.accounts || []).find(x => x.id === id);
          if (item) item.type = select.value;
        }, `edit type: ${accountLabel(a)} → ${select.value}`);
      });
      select.addEventListener('blur', () => render(state.get()));
      select.addEventListener('keydown', (e) => { if (e.key === 'Escape') render(state.get()); });
    });
  });
}

function confirmDelete(id) {
  const a = state.get().data?.accounts?.find(x => x.id === id);
  if (!a) return;
  confirmModal({
    title: 'Delete account',
    message: `Delete "${accountLabel(a)}"? Snapshots go with it. Closed accounts can be kept for reference instead.`,
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      state.mutate(d => { d.accounts = (d.accounts || []).filter(x => x.id !== id); }, `delete account: ${accountLabel(a)}`);
      toast(`Deleted: ${accountLabel(a)}`, 'info');
      render(state.get());
    },
  });
}

function handleMenuAction(id, act) {
  const a = state.get().data?.accounts?.find(x => x.id === id);
  if (!a) return;
  switch (act) {
    case 'edit': openForm(a); break;
    case 'snapshot': openSnapshotModal(a); break;
    case 'toggle-status': {
      const next = a.status === 'closed' ? 'open' : 'closed';
      // Closing zeroes the balance trail so the trend chart (which keeps closed
      // accounts' history) doesn't carry a stale balance forward.
      const snap = latestSnapshot(a);
      const zeroSnap = next === 'closed' && snap && snap.balance !== 0;
      state.mutate(d => {
        const item = (d.accounts || []).find(x => x.id === id);
        if (!item) return;
        item.status = next;
        if (zeroSnap) applySnapshot(item, todayISO(), 0);
      }, `set status: ${accountLabel(a)} → ${next}`);
      toast(`${next === 'closed' ? 'Closed' : 'Reopened'}: ${accountLabel(a)}${zeroSnap ? ' · $0 snapshot added' : ''}`, 'info');
      render(state.get());
      break;
    }
    case 'delete': confirmDelete(id); break;
  }
}

// One snapshot per date: re-snapshotting today replaces today's entry.
// Mutation body shared by the single and bulk snapshot flows.
function applySnapshot(item, dateISO, amt) {
  if (!item.snapshots) item.snapshots = [];
  const existing = item.snapshots.find(s => s.date === dateISO);
  if (existing) existing.balance = amt;
  else item.snapshots.push({ date: dateISO, balance: amt });
  item.snapshots.sort((x, y) => x.date.localeCompare(y.date));
}

function openSnapshotModal(a) {
  const snap = latestSnapshot(a);
  amountModal({
    title: 'Balance snapshot',
    sub: `${accountLabel(a)}${snap ? ` — last: ${fmtMoney(snap.balance)} (${relativeDays(snap.date)})` : ''}`,
    defaultValue: snap?.balance ?? 0,
    confirmLabel: 'Save snapshot',
    onConfirm: (amt) => {
      const today = todayISO();
      state.mutate(d => {
        const item = (d.accounts || []).find(x => x.id === a.id);
        if (item) applySnapshot(item, today, amt);
      }, `snapshot: ${accountLabel(a)} ${fmtMoney(amt)}`);
      toast(`Snapshot saved: ${accountLabel(a)} ${fmtMoney(amt)}`, 'success');
    },
  });
}

// Bulk snapshot: one form, every open account, all fields optional.
// Blank = skip (no snapshot written for that account). Investment types first.
function openBulkSnapshotModal() {
  const data = state.get().data;
  if (!data) return;
  const open = accounts(data).filter(a => a.status !== 'closed');
  if (!open.length) { toast('No open accounts', 'error'); return; }

  const typeOrder = (t) => {
    const i = INVEST_TYPES.indexOf(t);
    return i !== -1 ? i : INVEST_TYPES.length + TYPES.indexOf(t);
  };
  const list = [...open].sort((a, b) =>
    typeOrder(a.type) - typeOrder(b.type) || accountLabel(a).localeCompare(accountLabel(b)));

  const rowsHTML = list.map(a => {
    const snap = latestSnapshot(a);
    const lastInfo = snap
      ? `last ${fmtMoney(snap.balance)} · ${relativeDays(snap.date)}`
      : 'no snapshots yet';
    return `
      <div class="bulk-snap-row">
        <div class="bulk-snap-info">
          <b>${escapeHTML(accountLabel(a))}</b>
          <span>${TYPE_LABELS[a.type] || a.type} · ${lastInfo}</span>
        </div>
        <input type="number" step="0.01" inputmode="decimal" data-snap-id="${a.id}"
          placeholder="${snap ? snap.balance : 'balance'}"/>
      </div>`;
  }).join('');

  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `
    <div class="modal modal-lg">
      <h2>Update balances</h2>
      <p class="bulk-snap-hint">Snapshots dated today. Leave a field blank to skip that account.</p>
      <div class="bulk-snap-list">${rowsHTML}</div>
      <div class="modal-actions">
        <button class="btn" id="bs-cancel">Cancel</button>
        <span style="flex:1"></span>
        <button class="btn primary" id="bs-save">Save snapshots</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  el.querySelector('#bs-cancel').onclick = () => el.remove();
  el.addEventListener('click', (e) => { if (e.target === el) el.remove(); });
  closeOnEscape(el);
  el.querySelector('input[data-snap-id]')?.focus();

  el.querySelector('#bs-save').onclick = () => {
    const entries = [];
    for (const input of el.querySelectorAll('input[data-snap-id]')) {
      const raw = input.value.trim();
      if (raw === '') continue;
      const amt = parseFloat(raw);
      if (isNaN(amt)) { toast('Enter valid amounts (or leave blank to skip)', 'error'); return; }
      entries.push({ id: input.dataset.snapId, amt });
    }
    if (!entries.length) { toast('All fields blank — nothing to save', 'error'); return; }

    const today = todayISO();
    const names = entries.map(e => accountLabel(open.find(a => a.id === e.id)));
    const label = names.length <= 2
      ? `bulk snapshot: ${names.join(', ')}`
      : `bulk snapshot: ${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
    state.mutate(d => {
      for (const { id, amt } of entries) {
        const item = (d.accounts || []).find(x => x.id === id);
        if (item) applySnapshot(item, today, amt);
      }
    }, label);
    el.remove();
    toast(`Saved ${entries.length} snapshot${entries.length > 1 ? 's' : ''}`, 'success');
  };
}

// ---------- form ----------

function openForm(existing) {
  const isEdit = !!existing;
  const a = existing || {
    id: uid(), institution: '', name: '', type: 'checking', who: 'joint',
    last4: '', apy: null, opened_date: '', status: 'open', notes: '',
  };

  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `
    <div class="modal modal-lg">
      <h2>${isEdit ? 'Edit account' : 'Add account'}</h2>
      <div class="form-grid">
        <label class="field"><span>Institution</span><input id="f-institution" value="${escapeAttr(a.institution)}" placeholder="PNC"/></label>
        <label class="field"><span>Account name</span><input id="f-name" value="${escapeAttr(a.name)}" placeholder="Joint Checking"/></label>
        <label class="field"><span>Type</span>
          <select id="f-type-sel">
            ${TYPES.map(t => `<option value="${t}" ${a.type === t ? 'selected' : ''}>${TYPE_LABELS[t]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Who</span>
          <select id="f-who-sel">
            <option value="chang" ${a.who === 'chang' ? 'selected' : ''}>Chang</option>
            <option value="kiju" ${a.who === 'kiju' ? 'selected' : ''}>Kiju</option>
            <option value="joint" ${a.who === 'joint' ? 'selected' : ''}>Joint</option>
          </select>
        </label>
        <label class="field"><span>Last 4 digits</span><input id="f-last4" value="${escapeAttr(a.last4 || '')}" placeholder="4821" maxlength="4" inputmode="numeric"/></label>
        <label class="field"><span>APY % (optional)</span><input id="f-apy" type="number" step="0.01" min="0" inputmode="decimal" value="${a.apy ?? ''}" placeholder="4.35"/></label>
        <label class="field"><span>Opened date</span><input id="f-opened" type="date" value="${a.opened_date || ''}"/></label>
        <label class="field full"><span>Notes</span><input id="f-notes" value="${escapeAttr(a.notes || '')}" placeholder="Direct deposit lands here"/></label>
      </div>
      <div class="modal-actions">
        <button class="btn" id="f-cancel">Cancel</button>
        <span style="flex:1"></span>
        <button class="btn primary" id="f-save">${isEdit ? 'Save' : 'Add'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  el.querySelector('#f-cancel').onclick = () => el.remove();
  el.addEventListener('click', (e) => { if (e.target === el) el.remove(); });
  closeOnEscape(el);
  el.querySelector('#f-save').onclick = () => {
    const institution = el.querySelector('#f-institution').value.trim();
    const name = el.querySelector('#f-name').value.trim();
    if (!institution) { toast('Institution is required', 'error'); return; }
    if (!name) { toast('Account name is required', 'error'); return; }
    const apyRaw = el.querySelector('#f-apy').value.trim();
    const patch = {
      institution,
      name,
      type: el.querySelector('#f-type-sel').value,
      who: el.querySelector('#f-who-sel').value,
      last4: el.querySelector('#f-last4').value.trim(),
      apy: apyRaw === '' ? null : parseFloat(apyRaw),
      opened_date: el.querySelector('#f-opened').value || null,
      notes: el.querySelector('#f-notes').value.trim(),
    };
    state.mutate(d => {
      if (!d.accounts) d.accounts = [];
      if (isEdit) {
        const idx = d.accounts.findIndex(x => x.id === a.id);
        if (idx >= 0) d.accounts[idx] = { ...d.accounts[idx], ...patch };
      } else {
        d.accounts.push({ ...a, ...patch });
      }
    }, isEdit ? `edit account: ${institution} — ${name}` : `add account: ${institution} — ${name}`);
    el.remove();
    toast(isEdit ? `Updated: ${institution} — ${name}` : `Added: ${institution} — ${name}`, 'success');
  };
}

// ---------- boot ----------

if (isMobile()) {
  import('./accounts-mobile.js').then(m => m.init());
} else {
  state.subscribe(render);
  bootstrap();
}
