import { state } from '../core/state.js';
import { bootstrap, whoPill, fmtMoneyShort } from '../core/ui.js';
import { shortDate, relativeDays } from '../core/dates.js';
import { escapeHTML, ACCOUNT_TYPE_LABELS as TYPE_LABELS } from '../core/text.js';

const page = document.getElementById('page');

function accounts(data) { return data.accounts || []; }

function latestSnapshot(a) {
  const snaps = a.snapshots || [];
  if (!snaps.length) return null;
  return [...snaps].sort((x, y) => x.date.localeCompare(y.date))[snaps.length - 1];
}

// ---------- HTML builders ----------

function summaryStripHTML(open) {
  const snapped = open.map(a => ({ a, snap: latestSnapshot(a) })).filter(x => x.snap);
  const total = snapped.reduce((s, x) => s + x.snap.balance, 0);
  const retirementTotal = snapped
    .filter(x => x.a.type === 'retirement' || x.a.type === 'hsa')
    .reduce((s, x) => s + x.snap.balance, 0);
  const nonRetirementTotal = total - retirementTotal;
  const best = open.filter(a => a.apy != null).sort((a, b) => b.apy - a.apy)[0];

  return `
    <div class="m-summary-strip">
      <div class="m-summary-card">
        <div class="label">Open</div>
        <div class="value">${open.length}</div>
      </div>
      <div class="m-summary-card">
        <div class="label">Snapshot total</div>
        <div class="value" style="font-size:13px">${snapped.length ? fmtMoneyShort(total) : '—'}</div>
        <div class="sub">${snapped.length ? `${snapped.length}/${open.length} accounts` : 'none yet'}</div>
        ${snapped.length ? `<div class="sub">Ret ${fmtMoneyShort(retirementTotal)} · Non-ret ${fmtMoneyShort(nonRetirementTotal)}</div>` : ''}
      </div>
      <div class="m-summary-card">
        <div class="label">Best APY</div>
        <div class="value">${best ? best.apy + '%' : '—'}</div>
        <div class="sub">${best ? escapeHTML(best.institution) : '—'}</div>
      </div>
    </div>
  `;
}

function accountCardHTML(a) {
  const closed = a.status === 'closed';
  const snap = latestSnapshot(a);
  const balance = snap
    ? `${fmtMoneyShort(snap.balance)} <span style="color:var(--text-muted);font-size:11px">${relativeDays(snap.date)}</span>`
    : '';

  return `
    <div class="m-card" data-id="${a.id}" style="${closed ? 'opacity:0.55' : ''}">
      <div class="m-card-header">
        <div>
          <div class="m-card-name">${escapeHTML(a.institution)} — ${escapeHTML(a.name)}</div>
          <div class="m-card-name-sub">
            ${TYPE_LABELS[a.type] || a.type || '—'}${a.last4 ? ' · ···' + escapeHTML(a.last4) : ''}${a.apy != null ? ' · ' + a.apy + '% APY' : ''}
          </div>
        </div>
        <div style="text-align:right">
          ${balance ? `<div class="m-card-amount">${balance}</div>` : ''}
        </div>
      </div>
      <div class="m-card-footer">
        <div class="m-card-left">
          ${whoPill(a.who)}
          ${closed ? `<span class="pill tiny">Closed</span>` : ''}
        </div>
        <div class="m-card-right">
          ${a.opened_date ? `<span style="font-size:11px;color:var(--text-muted)">Opened ${shortDate(a.opened_date)}</span>` : ''}
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

  const all = accounts(data);
  const byName = (a, b) => (a.institution || '').localeCompare(b.institution || '')
    || (a.name || '').localeCompare(b.name || '');
  const open = all.filter(a => a.status !== 'closed').sort(byName);
  const closed = all.filter(a => a.status === 'closed').sort(byName);

  const openHTML = open.length
    ? `<div class="m-list">${open.map(a => accountCardHTML(a)).join('')}</div>`
    : `<div class="m-empty" style="margin-bottom:10px"><div class="m-empty-icon">🏦</div><div class="m-empty-msg">No accounts yet</div><div class="m-empty-sub">Add accounts on desktop</div></div>`;

  const closedHTML = closed.length
    ? `<div class="m-section-hdr">Closed (${closed.length})</div><div class="m-list">${closed.map(a => accountCardHTML(a)).join('')}</div>`
    : '';

  page.innerHTML = summaryStripHTML(open) + openHTML + closedHTML;
}

// ---------- boot ----------

export function init() {
  state.subscribe(render);
  bootstrap();
}
