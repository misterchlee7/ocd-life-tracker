import { state } from '../core/state.js';
import { bootstrap, whoPill, toast } from '../core/ui.js';
import { todayISO, shortDate, relativeDays, daysFromToday } from '../core/dates.js';

const page = document.getElementById('page');

const CAT_LABELS = {
  electronics: 'Electronics', appliance: 'Appliance', vehicle: 'Vehicle',
  furniture: 'Furniture', tool: 'Tool', outdoor: 'Outdoor',
  clothing: 'Clothing', other: 'Other',
};

function warranties(data) { return data.warranties || []; }

function isExpired(w) {
  return w.expiry_date && daysFromToday(w.expiry_date) < 0;
}

function expiryUrgency(w) {
  if (!w.expiry_date) return '';
  const days = daysFromToday(w.expiry_date);
  if (days < 0) return 'expired';
  if (days <= 7)  return 'urgent';
  if (days <= 30) return 'warn';
  if (days <= 90) return 'soon';
  return '';
}

function escapeHTML(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- HTML builders ----------

function summaryStripHTML(data) {
  const all = warranties(data).filter(w => !w.archived);
  const today = todayISO();
  const active = all.filter(w => !w.expiry_date || w.expiry_date >= today);
  const expiring90 = active.filter(w => { const d = daysFromToday(w.expiry_date); return d != null && d >= 0 && d <= 90; });
  const nextExpiry = [...active].filter(w => w.expiry_date).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))[0];

  return `
    <div class="m-summary-strip">
      <div class="m-summary-card">
        <div class="label">Active</div>
        <div class="value">${active.length}</div>
      </div>
      <div class="m-summary-card">
        <div class="label">Expiring ≤ 90d</div>
        <div class="value ${expiring90.length ? 'warn' : ''}">${expiring90.length}</div>
      </div>
      <div class="m-summary-card">
        <div class="label">Next expiry</div>
        <div class="value" style="font-size:13px">${nextExpiry ? shortDate(nextExpiry.expiry_date) : '—'}</div>
        <div class="sub">${nextExpiry ? escapeHTML(nextExpiry.name) : 'nothing soon'}</div>
      </div>
    </div>
  `;
}

function expiryBadgeHTML(w) {
  if (!w.expiry_date) return '';
  const days = daysFromToday(w.expiry_date);
  if (days < 0) return `<span class="expiry-badge badge-expired">Expired</span>`;
  if (days <= 7)  return `<span class="expiry-badge badge-urgent">${days}d left</span>`;
  if (days <= 30) return `<span class="expiry-badge badge-warn">${days}d left</span>`;
  if (days <= 90) return `<span class="expiry-badge badge-soon">${days}d left</span>`;
  return '';
}

function warrantyCardHTML(w) {
  const urgency = expiryUrgency(w);
  const expired = urgency === 'expired';
  const expiryText = w.expiry_date
    ? `${shortDate(w.expiry_date)} <span style="color:var(--text-muted);font-size:11px">${relativeDays(w.expiry_date)}</span>`
    : '—';

  const borderColor = {
    urgent: 'var(--s-unpaid-fg)',
    warn: 'var(--s-need-fg)',
    soon: '#c89f00',
    expired: 'var(--border)',
  }[urgency] || 'var(--border)';

  return `
    <div class="m-card" data-id="${w.id}" style="${expired ? 'opacity:0.55' : ''};border-color:${borderColor}">
      <div class="m-card-header">
        <div>
          <div class="m-card-name">${escapeHTML(w.name)}</div>
          <div class="m-card-name-sub">
            ${w.brand ? escapeHTML(w.brand) + ' · ' : ''}${CAT_LABELS[w.category] || w.category || '—'}
          </div>
        </div>
        <div style="text-align:right">
          ${expiryBadgeHTML(w)}
        </div>
      </div>
      <div class="m-card-footer">
        <div class="m-card-left">
          ${whoPill(w.who)}
          <span style="font-size:12px;color:var(--text-muted)">${expiryText}</span>
        </div>
        <div class="m-card-right">
          ${w.purchase_date ? `<span style="font-size:11px;color:var(--text-muted)">Bought ${shortDate(w.purchase_date)}</span>` : ''}
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

  const today = todayISO();
  const list = (warranties(data))
    .filter(w => !w.archived)
    .sort((a, b) => {
      // Active first sorted by expiry asc, then expired by expiry desc
      const aExp = a.expiry_date || '9999-99-99';
      const bExp = b.expiry_date || '9999-99-99';
      const aActive = !a.expiry_date || a.expiry_date >= today;
      const bActive = !b.expiry_date || b.expiry_date >= today;
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      return aExp.localeCompare(bExp);
    });

  const active = list.filter(w => !w.expiry_date || w.expiry_date >= today);
  const expired = list.filter(w => w.expiry_date && w.expiry_date < today);

  const activeHTML = active.length
    ? `<div class="m-list">${active.map(w => warrantyCardHTML(w)).join('')}</div>`
    : `<div class="m-empty" style="margin-bottom:10px"><div class="m-empty-icon">🛡️</div><div class="m-empty-msg">No active warranties</div></div>`;

  const expiredHTML = expired.length
    ? `<div class="m-section-hdr">Expired (${expired.length})</div><div class="m-list">${expired.map(w => warrantyCardHTML(w)).join('')}</div>`
    : '';

  page.innerHTML = summaryStripHTML(data) + activeHTML + expiredHTML;
}

// ---------- boot ----------

export function init() {
  state.subscribe(render);
  bootstrap();
}
