import { state } from '../core/state.js';
import { bootstrap, whoPill, fmtMoney, fmtMoneyShort } from '../core/ui.js';
import { todayISO, shortDate, relativeDays, daysFromToday, periodFor, nextOccurrence } from '../core/dates.js';
import { paymentFor, getAttentionItems } from '../core/derive.js';

const page = document.getElementById('page');

// ── Kind metadata: chip label + CSS class ────────────────────────────────────
const KIND_META = {
  needs_confirm:    { label: 'Bill',     cls: 'kind-bill' },
  trial_ending:     { label: 'Trial',    cls: 'kind-trial' },
  vesting_imminent: { label: 'Vest',     cls: 'kind-vest' },
  apr_zero:         { label: 'APR',      cls: 'kind-apr' },
  sub_renewal:      { label: 'Sub',      cls: 'kind-sub' },
  warranty_expiry:  { label: 'Warranty', cls: 'kind-warranty' },
  perk_expiring:    { label: 'Perk',     cls: 'kind-perk' },
  backlog_overdue:  { label: 'Task',     cls: 'kind-task' },
  backlog_snooze:   { label: 'Task',     cls: 'kind-task' },
  cc_rotation:      { label: 'CC',       cls: 'kind-cc' },
};

function monthlyEquivalent(sub) {
  const amt = sub.amount || 0;
  const f = sub.frequency;
  if (f === 'monthly') return amt;
  if (f === 'quarterly') return amt / 3;
  if (f === 'semi_annual' || f === 'biannual') return amt / 6;
  if (f === 'annual') return amt / 12;
  if (f === 'biennial') return amt / 24;
  return amt;
}

function escapeHTML(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function render({ data, loading }) {
  if (!data) {
    page.innerHTML = loading
      ? `<div class="empty"><h3>Loading…</h3></div>`
      : `<div class="empty"><h3>Not connected</h3><p>Open settings (⚙) to configure your GitHub data repo.</p></div>`;
    return;
  }

  const month = todayISO().slice(0, 7);
  const today = todayISO();

  // ── Summary numbers ──────────────────────────────────────────────────────
  const activeBills = data.bills.filter(b => !b.archived);
  let pendingMonth = 0;
  for (const b of activeBills) {
    const period = periodFor(`${month}-01`, b.frequency);
    const p = paymentFor(data, b.id, period);
    if (p && p.pending_amount > 0 && p.status !== 'paid' && p.status !== 'skipped') {
      pendingMonth += p.pending_amount;
    }
  }

  const activeSubs = data.subscriptions.filter(s => !s.archived && s.status !== 'cancelled');
  const monthlySubs = activeSubs.reduce((a, s) => a + monthlyEquivalent(s), 0);

  const perksAvailable = data.perks.filter(p => !p.archived).reduce((acc, p) => {
    const period = periodFor(`${month}-01`, p.frequency);
    const claim = data.perk_claims.find(c => c.perk_id === p.id && c.period === period);
    const status = claim?.status || 'available';
    return status === 'available' ? acc + (p.value || 0) : acc;
  }, 0);

  const upcomingVesting = data.vesting
    .filter(v => v.status === 'upcoming' && v.date && daysFromToday(v.date) >= 0 && daysFromToday(v.date) <= 60)
    .sort((a, b) => a.date.localeCompare(b.date));
  const upcomingVestingValue = upcomingVesting.reduce((a, v) => a + (v.gross_value || 0), 0);

  // ── Attention items ──────────────────────────────────────────────────────
  const allItems = getAttentionItems(data);
  const zone1 = allItems.filter(i => i.zone === 1);
  const zone2 = allItems.filter(i => i.zone === 2);

  // ── Bills due this week ──────────────────────────────────────────────────
  const d7 = new Date(today + 'T00:00:00');
  d7.setDate(d7.getDate() + 7);
  const cutoff = d7.toISOString().slice(0, 10);
  const billsDueThisWeek = [];
  for (const b of activeBills) {
    const nextDate = b.next_due_date || nextOccurrence(b.day, b.frequency);
    if (!nextDate || nextDate < today || nextDate > cutoff) continue;
    const period = periodFor(nextDate, b.frequency);
    const payment = paymentFor(data, b.id, period);
    billsDueThisWeek.push({ bill: b, nextDate, payment });
  }
  billsDueThisWeek.sort((a, b) => a.nextDate.localeCompare(b.nextDate));

  page.innerHTML = `
    ${summaryHTML({ pendingMonth, monthlySubs, perksAvailable, upcomingVestingValue, upcomingVesting })}
    ${attentionHubHTML(zone1, zone2)}
    <div class="dash-grid">
      ${vestingPanel({ upcomingVesting })}
      ${billsDueThisWeekPanel(billsDueThisWeek, data)}
    </div>
  `;
}

// ── Summary cards row ─────────────────────────────────────────────────────────
function summaryHTML({ pendingMonth, monthlySubs, perksAvailable, upcomingVestingValue, upcomingVesting }) {
  return `
    <div class="summary">
      <div class="card">
        <div class="label">Pending bills this month</div>
        <div class="value">${fmtMoney(pendingMonth)}</div>
        <div class="sub">scheduled / unpaid</div>
      </div>
      <div class="card">
        <div class="label">Subscriptions / mo</div>
        <div class="value">${fmtMoney(monthlySubs)}</div>
        <div class="sub">normalized</div>
      </div>
      <div class="card">
        <div class="label">Perks available</div>
        <div class="value">${fmtMoney(perksAvailable)}</div>
        <div class="sub">unclaimed this period</div>
      </div>
      <div class="card">
        <div class="label">Vesting value (60d)</div>
        <div class="value">${fmtMoney(upcomingVestingValue)}</div>
        <div class="sub">${upcomingVesting.length} event${upcomingVesting.length === 1 ? '' : 's'} upcoming</div>
      </div>
    </div>
  `;
}

// ── Attention hub ─────────────────────────────────────────────────────────────
function attentionHubHTML(zone1, zone2) {
  if (zone1.length === 0 && zone2.length === 0) {
    return `
      <div class="attention-hub">
        <div class="attention-all-clear">
          ✓ Nothing needs your attention right now.
        </div>
      </div>
    `;
  }
  return `
    <div class="attention-hub">
      ${attentionZoneHTML(1, 'Needs Action', zone1)}
      ${attentionZoneHTML(2, 'On Your Radar', zone2)}
    </div>
  `;
}

function attentionZoneHTML(zone, title, items) {
  if (items.length === 0) return '';
  const rows = items.map(item => attentionItemHTML(item)).join('');
  return `
    <div class="attention-zone zone-${zone}">
      <div class="attention-zone-title">
        ${zone === 1 ? '⚡' : '🕐'} ${title}
        <span class="attention-count">${items.length}</span>
      </div>
      ${rows}
    </div>
  `;
}

function attentionItemHTML(item) {
  const meta = KIND_META[item.kind] || { label: item.kind, cls: 'kind-other' };
  return `
    <div class="attention-item">
      <span class="attention-kind ${meta.cls}">${meta.label}</span>
      <div class="attention-item-body">
        <div class="attention-item-label">${escapeHTML(item.label)}</div>
        <div class="attention-item-detail">${escapeHTML(item.detail)}</div>
      </div>
      <a href="${item.link}" class="attention-item-link">View →</a>
    </div>
  `;
}

// ── Vesting panel ─────────────────────────────────────────────────────────────
function vestingPanel({ upcomingVesting }) {
  const vestRows = upcomingVesting.length
    ? upcomingVesting.slice(0, 6).map(v => `
        <div class="row-item">
          <div>Vest ${whoPill(v.who)} <span class="cell-amount-sub">${v.shares ? v.shares + ' sh' : ''}</span></div>
          <div>${fmtMoneyShort(v.gross_value)} <span class="cell-amount-sub">${shortDate(v.date)} (${relativeDays(v.date)})</span></div>
        </div>`).join('')
    : `<div class="row-item faint">No upcoming vesting in 60d</div>`;

  return `
    <div class="panel">
      <div class="panel-title">Upcoming vesting (60d)</div>
      ${vestRows}
    </div>
  `;
}

// ── Bills due this week panel ─────────────────────────────────────────────────
const STATUS_PILL = {
  paid:          ['var(--s-paid-bg)',  'var(--s-paid-fg)',  '✓ paid'],
  auto:          ['var(--s-auto-bg)',  'var(--s-auto-fg)',  'auto'],
  scheduled:     ['var(--s-sched-bg)', 'var(--s-sched-fg)', 'scheduled'],
  needs_confirm: ['var(--s-need-bg)',  'var(--s-need-fg)',  'confirm?'],
  skipped:       ['var(--s-skip-bg)',  'var(--s-skip-fg)',  'skipped'],
  unpaid:        ['var(--s-unpaid-bg)','var(--s-unpaid-fg)','unpaid'],
};

function statusPillHTML(status) {
  const [bg, fg, label] = STATUS_PILL[status] || STATUS_PILL.unpaid;
  return `<span style="background:${bg};color:${fg};font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap">${label}</span>`;
}

function billsDueThisWeekPanel(bills, data) {
  const header = `<div class="panel-title">Bills due this week</div>`;
  if (bills.length === 0) {
    return `<div class="panel">${header}<div class="row-item faint">No bills due in the next 7 days.</div></div>`;
  }
  const rows = bills.map(({ bill, nextDate, payment }) => {
    const status = payment?.status || 'unpaid';
    const amount = payment?.pending_amount ?? bill.amount;
    return `
      <div class="row-item">
        <div>
          <b>${escapeHTML(bill.brand)}</b>
          <span class="cell-amount-sub">${escapeHTML(bill.name)} · ${shortDate(nextDate)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          ${amount != null ? `<span style="font-variant-numeric:tabular-nums;font-size:13px">${fmtMoneyShort(amount)}</span>` : ''}
          ${statusPillHTML(status)}
        </div>
      </div>
    `;
  }).join('');

  return `<div class="panel">${header}${rows}</div>`;
}

state.subscribe(render);
bootstrap();
