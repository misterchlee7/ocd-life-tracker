import { state } from '../core/state.js';
import { bootstrap, showBottomSheet, fmtMoney, fmtMoneyShort, toast } from '../core/ui.js';
import { todayISO, shortDate, relativeDays, daysFromToday } from '../core/dates.js';
import { escapeHTML, VEST_STATUS_LABELS as FULL_LABELS } from '../core/text.js';

const page = document.getElementById('page');

const ui = { filter: 'all' };

// Mobile cards are tight — shorten "Pending settlement"
const VEST_STATUS_LABELS = { ...FULL_LABELS, pending_settlement: 'Pending' };

function grantLabel(g) {
  if (!g) return '—';
  const parts = [g.company, g.broker].filter(Boolean);
  return parts.length ? parts.join(' · ') : (g.label || '—');
}

function filteredEvents(data) {
  const events = [...data.vesting].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (ui.filter === 'all') return events;
  return events.filter(v => v.status === ui.filter);
}

// ---------- HTML builders ----------

function summaryStripHTML(data) {
  const events = data.vesting;
  const upcoming = events.filter(v => v.status === 'upcoming' && v.date);
  const next90 = upcoming.filter(v => { const d = daysFromToday(v.date); return d != null && d >= 0 && d <= 90; });
  const next90Value = next90.reduce((a, v) => a + (v.gross_value || 0), 0);
  const totalUpcomingValue = upcoming.reduce((a, v) => a + (v.gross_value || 0), 0);
  const currentYear = String(new Date().getFullYear());
  const soldYTD = events
    .filter(v => v.status === 'sold' && v.sold_date?.startsWith(currentYear))
    .reduce((a, v) => a + (v.sold_amount || 0), 0);
  const nextEvent = [...upcoming].sort((a, b) => a.date.localeCompare(b.date))[0];

  return `
    <div class="m-summary-strip">
      <div class="m-summary-card">
        <div class="label">Next event</div>
        <div class="value" style="font-size:13px">${nextEvent ? shortDate(nextEvent.date) : '—'}</div>
        <div class="sub">${nextEvent ? relativeDays(nextEvent.date) : 'nothing upcoming'}</div>
      </div>
      <div class="m-summary-card">
        <div class="label">≤ 90d value</div>
        <div class="value">${fmtMoney(next90Value)}</div>
        <div class="sub">est. gross</div>
      </div>
      <div class="m-summary-card">
        <div class="label">Total upcoming</div>
        <div class="value">${fmtMoney(totalUpcomingValue)}</div>
        <div class="sub">${upcoming.length} events</div>
      </div>
      <div class="m-summary-card">
        <div class="label">Sold YTD</div>
        <div class="value">${fmtMoney(soldYTD)}</div>
      </div>
    </div>
  `;
}

function filterBarHTML() {
  const chip = (val, label) =>
    `<button class="m-chip ${ui.filter === val ? 'active' : ''}" data-filter="${val}">${label}</button>`;
  return `
    <div class="m-filter-bar">
      ${chip('all', 'All')}
      ${chip('upcoming', 'Upcoming')}
      ${chip('vested', 'Vested')}
      ${chip('sold', 'Sold')}
    </div>
  `;
}

function vestStatusBadge(status) {
  const cls = {
    upcoming: 's-scheduled', vested: 's-paid',
    sold: 's-skipped', pending_settlement: 's-needs_confirm',
  }[status] || 's-skipped';
  return `<span class="status ${cls}">${VEST_STATUS_LABELS[status] || status}</span>`;
}

function vestingCardHTML(event, data) {
  const grant = data.grants.find(g => g.id === event.grant_id);
  const isPast = event.date && event.date < todayISO();
  const isUpcoming = event.date && event.date >= todayISO();

  const dateText = event.date
    ? `${shortDate(event.date)} <span style="color:var(--text-muted);font-size:11px">${relativeDays(event.date)}</span>`
    : '—';
  const proceedsText = event.sold_amount != null
    ? `${fmtMoney(event.sold_amount)}${event.sold_date ? ` · ${shortDate(event.sold_date)}` : ''}`
    : '';

  const actionBtn = event.status === 'upcoming'
    ? `<button class="m-action-btn primary" data-action="vest" data-id="${event.id}">Mark vested</button>`
    : event.status === 'vested'
    ? `<button class="m-action-btn warn" data-action="sold" data-id="${event.id}">Mark sold…</button>`
    : '';

  return `
    <div class="m-card" data-id="${event.id}">
      <div class="m-card-header">
        <div>
          <div class="m-card-name">${escapeHTML(grantLabel(grant))}</div>
          <div class="m-card-name-sub" style="font-size:12px">${dateText}</div>
        </div>
        <div style="text-align:right">
          <div class="m-card-amount">${fmtMoney(event.gross_value)}</div>
          ${event.shares ? `<div class="m-card-amount-sub">${event.shares} shares</div>` : ''}
        </div>
      </div>
      <div class="m-card-footer">
        <div class="m-card-left">
          ${vestStatusBadge(event.status)}
          ${event.type ? `<span class="pill type tiny">${event.type.toUpperCase()}</span>` : ''}
          ${proceedsText ? `<span style="font-size:11px;color:var(--s-paid-fg)">${proceedsText}</span>` : ''}
        </div>
        <div class="m-card-right">
          ${actionBtn}
          <button class="m-dots-btn" data-dots="${event.id}">⋯</button>
        </div>
      </div>
    </div>
  `;
}

// ---------- render ----------

function render({ data, loading }) {
  if (!data) {
    page.innerHTML = loading
      ? `<div class="m-empty"><div class="m-empty-icon">⏳</div><div class="m-empty-msg">Loading…</div></div>`
      : `<div class="m-empty"><div class="m-empty-icon">🔌</div><div class="m-empty-msg">Not connected</div></div>`;
    return;
  }

  const events = filteredEvents(data);
  const today = todayISO();

  // Group into upcoming/past
  const future = events.filter(v => !v.date || v.date >= today);
  const past = events.filter(v => v.date && v.date < today && v.status !== 'upcoming');
  const todayLine = events.some(v => v.date === today)
    ? '' : '';

  let listHTML = '';
  if (future.length) {
    listHTML += `<div class="m-list">${future.map(v => vestingCardHTML(v, data)).join('')}</div>`;
  }
  if (past.length) {
    listHTML += `<div class="m-section-hdr">Past</div><div class="m-list">${past.map(v => vestingCardHTML(v, data)).join('')}</div>`;
  }
  if (!listHTML) {
    listHTML = `<div class="m-empty"><div class="m-empty-icon">📈</div><div class="m-empty-msg">No vesting events</div></div>`;
  }

  page.innerHTML = summaryStripHTML(data) + filterBarHTML() + listHTML;
  wireInteractions(data);
}

// ---------- interactions ----------

function wireInteractions(data) {
  page.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      ui.filter = btn.dataset.filter;
      render(state.get());
    });
  });

  page.querySelectorAll('[data-action="vest"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      markVested(btn.dataset.id);
    });
  });

  page.querySelectorAll('[data-action="sold"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSoldModal(btn.dataset.id);
    });
  });

  page.querySelectorAll('[data-dots]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEventSheet(btn.dataset.dots);
    });
  });
}

function markVested(eventId) {
  const { data } = state.get();
  const v = data.vesting.find(x => x.id === eventId);
  if (!v) return;
  state.mutate(d => { const e = d.vesting.find(x => x.id === eventId); if (e) e.status = 'vested'; }, `mark vested: ${v.date ? shortDate(v.date) : 'event'}${v.shares ? ` (${v.shares} shares)` : ''}`);
  toast(`Vested: ${v.date ? shortDate(v.date) : 'event'}`, 'success');
}

function openSoldModal(eventId) {
  const { data } = state.get();
  const v = data.vesting.find(x => x.id === eventId);
  if (!v) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:340px">
      <h2 style="font-size:16px;margin-bottom:4px">Mark sold</h2>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">${v.date ? shortDate(v.date) : 'event'}</p>
      <label class="field" style="display:flex;flex-direction:column;gap:4px;margin-bottom:16px">
        <span style="font-size:12px;font-weight:600;color:var(--text-muted)">Proceeds ($)</span>
        <input id="sold-amt" type="number" inputmode="decimal" step="0.01" value="${v.gross_value ?? ''}"
          style="padding:10px 12px;border:1px solid var(--border-strong);border-radius:8px;font-size:16px;font:inherit"/>
      </label>
      <div style="display:flex;gap:8px">
        <button class="btn" id="sold-cancel" style="flex:1">Cancel</button>
        <button class="btn primary" id="sold-confirm" style="flex:2">Mark sold</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#sold-amt').focus();

  backdrop.querySelector('#sold-cancel').onclick = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#sold-confirm').onclick = () => {
    const n = Number(backdrop.querySelector('#sold-amt').value);
    if (!isFinite(n)) { backdrop.remove(); return; }
    state.mutate(d => {
      const e = d.vesting.find(x => x.id === eventId);
      if (e) { e.status = 'sold'; e.sold_amount = n; e.sold_date = todayISO(); }
    }, `mark sold: ${v.date ? shortDate(v.date) : 'event'} $${n}`);
    backdrop.remove();
    toast(`Sold: ${v.date ? shortDate(v.date) : 'event'}`, 'success');
  };
}

function openEventSheet(eventId) {
  const { data } = state.get();
  const v = data.vesting.find(x => x.id === eventId);
  if (!v) return;

  showBottomSheet({
    title: v.date ? shortDate(v.date) : 'Vesting event',
    items: [
      v.status !== 'vested' ? {
        icon: '✅', label: 'Mark vested',
        action: () => markVested(eventId),
      } : null,
      v.status !== 'sold' ? {
        icon: '💰', label: 'Mark sold…',
        action: () => openSoldModal(eventId),
      } : null,
    ].filter(Boolean),
  });
}

// ---------- boot ----------

export function init() {
  state.subscribe(render);
  bootstrap();
}
