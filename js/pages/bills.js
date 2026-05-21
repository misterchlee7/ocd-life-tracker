import { state, uid } from '../core/state.js';
import { bootstrap, isMobile, whoPill, fmtMoney, fmtMoneyShort, toast, WHO_LABEL, positionMenu } from '../core/ui.js';
import { periodFor, todayISO, shortDate, relativeDays, daysFromToday } from '../core/dates.js';
import { paymentFor, yearProgress, rotation, needsConfirm } from '../core/derive.js';

const page = document.getElementById('page');

// ---------- page-local UI state ----------

const ui = {
  month: todayISO().slice(0, 7),  // YYYY-MM
  search: '',
  who: 'all',
  type: 'all',
  status: 'all',
  showArchived: false,
  sort: { key: 'day', dir: 'asc' },
  openMenuId: null,
};

const STATUS_LABELS = {
  unpaid: 'Unpaid',
  scheduled: 'Scheduled',
  needs_confirm: 'Needs confirm',
  paid: 'Paid',
  auto: 'Auto',
  skipped: 'Skipped',
};
const BILL_TYPES = ['cc', 'loan', 'utility', 'insurance', 'fee', 'investment', 'gift', 'other'];
const BILL_TYPE_LABELS = {
  cc: 'CC', loan: 'Loan', utility: 'Utility', insurance: 'Insurance',
  fee: 'Fee', investment: 'Investment', gift: 'Gift', other: 'Other',
};
const FREQUENCIES = [
  'monthly', 'bimonthly', 'quarterly', 'biannual', 'semi_annual',
  'annual', 'biennial', 'triennial', 'quinquennial', 'one_time', 'variable',
];
const FREQ_LABELS = {
  monthly: 'Monthly', bimonthly: 'Bimonthly', quarterly: 'Quarterly',
  biannual: 'Biannual', semi_annual: 'Semi-annual', annual: 'Annual',
  biennial: 'Biennial', triennial: 'Triennial', quinquennial: '5-yearly',
  one_time: 'One-time', variable: 'Variable',
};

// ---------- helpers ----------

function periodForBill(bill, monthISO) {
  // Always use day 01 — bill.day can exceed the month length (e.g. day 31 in April)
  // which causes JS date rollover and maps April → May period incorrectly.
  return periodFor(`${monthISO}-01`, bill.frequency);
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function statusForRow(data, bill) {
  const period = periodForBill(bill, ui.month);
  const p = paymentFor(data, bill.id, period);
  if (!p) {
    // auto-detect: scheduled past due → needs_confirm (but we'd need a real record)
    return { status: 'unpaid', payment: null, period };
  }
  let status = p.status;
  // auto-advance scheduled → needs_confirm if past
  if (status === 'scheduled' && p.scheduled_date && p.scheduled_date < todayISO()) {
    status = 'needs_confirm';
  }
  return { status, payment: p, period };
}

function filterBills(data) {
  const q = ui.search.trim().toLowerCase();
  return data.bills.filter(b => {
    if (!ui.showArchived && b.archived) return false;
    if (ui.who !== 'all' && b.who !== ui.who) return false;
    if (ui.type !== 'all' && b.type !== ui.type) return false;
    if (ui.status !== 'all') {
      const { status } = statusForRow(data, b);
      if (status !== ui.status) return false;
    }
    if (q) {
      const hay = `${b.brand} ${b.name} ${b.notes || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function sortBills(bills, data) {
  const { key, dir } = ui.sort;
  const mult = dir === 'asc' ? 1 : -1;
  const getKey = (b) => {
    switch (key) {
      case 'day': return b.day ?? 99;
      case 'name': return `${b.brand} ${b.name}`.toLowerCase();
      case 'who': return b.who || '';
      case 'type': return b.type || '';
      case 'amount': return b.amount ?? (b.variable ? -1 : 0);
      case 'status': {
        const order = { paid: 0, scheduled: 1, needs_confirm: 2, unpaid: 3, auto: 4, skipped: 5 };
        return order[statusForRow(data, b).status] ?? 9;
      }
      case 'pending': return statusForRow(data, b).payment?.pending_amount ?? -1;
      case 'rewards': return b?.cc?.rewards_balance ?? -1;
      case 'lastused': return b?.cc?.last_used || '';
      default: return 0;
    }
  };
  return [...bills].sort((a, b) => {
    const av = getKey(a); const bv = getKey(b);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
    return String(av).localeCompare(String(bv)) * mult;
  });
}

// ---------- summary ----------

// Format a bill's rewards balance based on its unit.
function fmtRewards(bill) {
  const bal = bill.cc?.rewards_balance;
  if (bal == null) return null;
  const unit = bill.cc?.rewards_unit || 'dollars';
  return unit === 'points'
    ? `${Number(bal).toLocaleString()} pts`
    : fmtMoney(bal);
}

// Summary card value block for CC rewards — handles mixed dollar + point cards.
function rewardsCardValueHTML(dollars, dollarCards, points, pointCards) {
  const totalCards = dollarCards + pointCards;
  if (totalCards === 0) {
    return `<div class="value">—</div><div class="sub">&nbsp;</div>`;
  }
  const cardSub = `across ${totalCards} ${totalCards === 1 ? 'card' : 'cards'}`;
  if (dollars > 0 && points > 0) {
    // Mixed: show dollars as primary value, points as sub
    return `
      <div class="value">${fmtMoney(dollars)}</div>
      <div class="sub">+ ${Number(points).toLocaleString()} pts · ${cardSub}</div>
    `;
  }
  if (points > 0) {
    return `
      <div class="value rewards-pts">${Number(points).toLocaleString()} pts</div>
      <div class="sub">${cardSub}</div>
    `;
  }
  return `
    <div class="value">${fmtMoney(dollars)}</div>
    <div class="sub">${cardSub}</div>
  `;
}

function summaryHTML(data) {
  const filtered = data.bills.filter(b => !b.archived);
  let pendingMonth = 0, pendingByWho = { chang: 0, kiju: 0, joint: 0 };
  let paidMonth = 0, paidByWho = { chang: 0, kiju: 0, joint: 0 };
  let needsConfirmCount = 0, needsConfirmAmt = 0;
  let rewardsDollars = 0, rewardsDollarCards = 0;
  let rewardsPoints = 0, rewardsPointCards = 0;
  const typeCounts = {};

  for (const b of filtered) {
    const { status, payment } = statusForRow(data, b);
    if (payment && payment.pending_amount > 0 && status !== 'paid' && status !== 'skipped') {
      pendingMonth += payment.pending_amount;
      pendingByWho[b.who] = (pendingByWho[b.who] || 0) + payment.pending_amount;
    }
    // Use paid_date (not period status) to anchor to the viewed calendar month.
    // Without this, an annual bill paid in January would appear in "Paid this month"
    // for every subsequent month of the year since its period ('2026') stays 'paid'.
    if (status === 'paid' && payment?.paid_amount != null &&
        payment.paid_date?.slice(0, 7) === ui.month) {
      paidMonth += payment.paid_amount;
      paidByWho[b.who] = (paidByWho[b.who] || 0) + payment.paid_amount;
    }
    if (status === 'needs_confirm') {
      needsConfirmCount++;
      needsConfirmAmt += payment?.pending_amount || 0;
    }
    const rb = b?.cc?.rewards_balance || 0;
    if (rb > 0) {
      if ((b.cc?.rewards_unit || 'dollars') === 'points') { rewardsPoints += rb; rewardsPointCards++; }
      else { rewardsDollars += rb; rewardsDollarCards++; }
    }
    // type breakdown
    const t = b.type || 'other';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  const pendingWhoSub = [['chang', 'Chang'], ['kiju', 'Kiju'], ['joint', 'Joint']]
    .filter(([k]) => pendingByWho[k] > 0)
    .map(([k, l]) => `${l} ${fmtMoneyShort(pendingByWho[k])}`)
    .join(' · ');

  const paidWhoSub = [['chang', 'Chang'], ['kiju', 'Kiju'], ['joint', 'Joint']]
    .filter(([k]) => paidByWho[k] > 0)
    .map(([k, l]) => `${l} ${fmtMoneyShort(paidByWho[k])}`)
    .join(' · ');

  // Show how paid compares to pending — positive diff = paid more than scheduled (e.g. extra mortgage payment)
  const diff = paidMonth - pendingMonth;
  const diffSign = diff >= 0 ? '+' : '−';
  const diffAbs = Math.abs(diff);
  const paidSub = paidMonth > 0
    ? (paidWhoSub ? `${paidWhoSub}` : '&nbsp;')
    : 'nothing paid yet';
  const paidVsPending = paidMonth > 0 && pendingMonth > 0
    ? `<div class="sub" style="margin-top:2px;font-size:11px;opacity:0.75">${diffSign}${fmtMoneyShort(diffAbs)} vs pending</div>`
    : '';

  // Type breakdown — show counts for each type present, ordered by BILL_TYPES
  const typeBreakdown = BILL_TYPES
    .filter(t => typeCounts[t] > 0)
    .map(t => `${typeCounts[t]} ${BILL_TYPE_LABELS[t]}`)
    .join(' · ');
  const totalBills = filtered.length;

  return `
    <div class="summary summary-5">
      <div class="card clickable-card" data-breakdown="pending">
        <div class="label">Pending this month</div>
        <div class="value">${fmtMoney(pendingMonth)}</div>
        <div class="sub">${pendingWhoSub || '&nbsp;'}</div>
      </div>
      <div class="card clickable-card" data-breakdown="paid">
        <div class="label">Paid this month</div>
        <div class="value">${fmtMoney(paidMonth)}</div>
        <div class="sub">${paidSub}</div>
        ${paidVsPending}
      </div>
      <div class="card">
        <div class="label">Needs confirmation</div>
        <div class="value ${needsConfirmCount ? 'warn' : ''}">${needsConfirmCount} ${needsConfirmCount === 1 ? 'bill' : 'bills'}</div>
        <div class="sub">${needsConfirmCount ? `${fmtMoney(needsConfirmAmt)} past day — verify posted` : 'all caught up'}</div>
      </div>
      <div class="card">
        <div class="label">CC rewards available</div>
        ${rewardsCardValueHTML(rewardsDollars, rewardsDollarCards, rewardsPoints, rewardsPointCards)}
      </div>
      <div class="card">
        <div class="label">Bill breakdown</div>
        <div class="value">${totalBills}</div>
        <div class="sub">${typeBreakdown || '&nbsp;'}</div>
      </div>
    </div>
  `;
}

// ---------- filters bar ----------

function filtersHTML() {
  const chip = (val, label) => `<div class="chip ${ui.who === val ? 'active' : ''}" data-who="${val}">${label}</div>`;
  const typeOptions = ['all', ...BILL_TYPES].map(t =>
    `<option value="${t}" ${ui.type === t ? 'selected' : ''}>${t === 'all' ? 'All types' : BILL_TYPE_LABELS[t]}</option>`
  ).join('');
  const statusOptions = ['all', 'unpaid', 'scheduled', 'needs_confirm', 'paid', 'auto', 'skipped'].map(s =>
    `<option value="${s}" ${ui.status === s ? 'selected' : ''}>${s === 'all' ? 'All statuses' : STATUS_LABELS[s]}</option>`
  ).join('');

  return `
    <div class="filters">
      <label class="search">
        <input id="f-search" placeholder="Search bills…" value="${escapeAttr(ui.search)}" />
      </label>
      <div class="chips">
        ${chip('all', 'All')}
        ${chip('chang', 'Chang')}
        ${chip('kiju', 'Kiju')}
        ${chip('joint', 'Joint')}
      </div>
      <select class="select" id="f-type">${typeOptions}</select>
      <select class="select" id="f-status">${statusOptions}</select>
      <button class="btn primary" id="btn-add-bill">+ Add bill</button>
      <div class="month-nav">
        <button class="icon-btn" id="m-prev" title="Previous month">‹</button>
        <div class="month-label">${monthLabel(ui.month)}</div>
        <button class="icon-btn" id="m-next" title="Next month">›</button>
      </div>
    </div>
  `;
}

// ---------- table ----------

function thSortable(key, label, extra = '') {
  const active = ui.sort.key === key;
  const arrow = active ? (ui.sort.dir === 'asc' ? '▲' : '▼') : '▾';
  return `<th class="sortable ${active ? 'sorted' : ''} ${extra}" data-sort="${key}">${label} <span class="sort-icon">${arrow}</span></th>`;
}

function statusPill(status, payment, bill) {
  let label = STATUS_LABELS[status] || status;
  // show paid month only when the payment was recorded 2+ months away from the viewed month
  // (suppresses "Paid · May" for April bills legitimately logged a few days late)
  if (status === 'paid' && payment?.paid_date) {
    const pd = payment.paid_date;
    const [vy, vm] = ui.month.split('-').map(Number);
    const [py, pm] = pd.slice(0, 7).split('-').map(Number);
    const monthDiff = Math.abs((py - vy) * 12 + (pm - vm));
    if (monthDiff >= 2) {
      const m = new Date(pd + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' });
      label = `Paid · ${m}`;
    }
  }
  return `<span class="status clickable s-${status}" data-bill-id="${bill.id}" title="Click to update"><span class="dot"></span>${label}</span>`;
}

function amountCell(bill, year) {
  if (bill.variable && bill.amount == null) return `<td class="num muted" data-sort="0">variable</td>`;
  const main = bill.amount != null ? fmtMoney(bill.amount) : (bill.variable ? 'variable' : '—');
  let sub = `<div class="cell-amount-sub">${FREQ_LABELS[bill.frequency] || ''}</div>`;

  // year progress bar for non-monthly non-variable
  const yp = yearProgressFromBill(bill, year);
  if (yp) {
    const segs = [];
    for (let i = 0; i < yp.total; i++) {
      segs.push(`<span class="seg ${i < yp.filled ? 'filled' : ''}"></span>`);
    }
    sub = `<div class="cell-amount-sub">${FREQ_LABELS[bill.frequency] || ''} · ${yp.nextText || ''}</div>
           <div class="year-progress"><span class="lbl">${year} · ${yp.filled}/${yp.total}</span>${segs.join('')}</div>`;
  }
  const balanceLine = bill.balance_remaining != null
    ? `<div class="cell-amount-sub balance-remaining">Balance: ${fmtMoney(bill.balance_remaining)}</div>`
    : '';
  return `<td class="num" data-sort="${bill.amount ?? 0}">${main}${sub}${balanceLine}</td>`;
}

function yearProgressFromBill(bill, year) {
  // only show for frequencies that partition a calendar year
  const total = { quarterly: 4, biannual: 2, semi_annual: 2, annual: 1 }[bill.frequency];
  if (!total) return null;
  const { data } = state.get();
  const yp = yearProgress(data, bill, year);
  return yp;
}

function rotationCell(bill) {
  if (!bill.cc?.last_used) return `<td class="center muted tight" data-sort="">—</td>`;
  const r = rotation(bill, state.get().data?.settings?.rotation_target_months ?? 6);
  if (!r) return `<td class="center muted tight" data-sort="">—</td>`;
  const dateSortKey = bill.cc.last_used.replace(/-/g, '');
  const lvlLabel = r.level === 'fresh' ? 'Fresh' : r.level === 'warn' ? 'Warn' : 'Stale';
  return `<td class="center tight" data-sort="${dateSortKey}">
    <div class="rot-badge rot-${r.level}">${lvlLabel}</div>
    <div class="rot-sub">${shortDate(bill.cc.last_used)} · ${r.monthsAgo}mo</div>
  </td>`;
}

function dueBadge(bill) {
  if (!bill.due_date) return '';
  const days = daysFromToday(bill.due_date);
  let cls = '';
  if (days < 0) cls = 'overdue';
  else if (days <= 7) cls = 'soon';
  const label = days < 0
    ? `due ${shortDate(bill.due_date)} (overdue)`
    : `due ${shortDate(bill.due_date)}`;
  return `<span class="badge-due ${cls}" title="Due ${bill.due_date}">${label}</span>`;
}

function aprBadge(bill) {
  const apr = bill.cc?.apr_zero;
  if (!apr || !apr.months_left) return '';
  const warn = apr.months_left <= (state.get().data?.settings?.apr_warn_months ?? 2);
  const amt = apr.balance_remaining != null ? ' · ' + fmtMoneyShort(apr.balance_remaining) : '';
  const due = apr.expires_date ? ' · due ' + shortDate(apr.expires_date) : '';
  return `<span class="badge-apr ${warn ? 'warn' : ''}" title="0% APR expires ${apr.expires_date}">0% APR · ${apr.months_left}mo${amt}${due}</span>`;
}

function tableHTML(data) {
  const rows = sortBills(filterBills(data), data);
  const year = Number(ui.month.slice(0, 4));

  if (rows.length === 0) {
    const anyBills = data.bills.length > 0;
    return `<div class="empty">
      <h3>${anyBills ? 'No bills match the filters' : 'No bills yet'}</h3>
      <p>${anyBills ? 'Try clearing filters or changing the month.' : 'Click + Add bill to create your first one.'}</p>
    </div>`;
  }

  const today = todayISO();
  const showTodayDivider = ui.sort.key === 'day' && ui.sort.dir === 'asc' && ui.month === today.slice(0, 7);
  const todayDay = Number(today.slice(8, 10));
  let dividerInserted = false;
  const dividerRow = () => {
    const d = new Date(today + 'T00:00:00');
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return `<tr class="today-divider"><td colspan="9"><span class="today-label">Today · ${label}</span></td></tr>`;
  };

  const bodyRows = rows.map(b => {
    let prefix = '';
    if (showTodayDivider && !dividerInserted && (b.day ?? 99) > todayDay) {
      prefix = dividerRow();
      dividerInserted = true;
    }
    const { status, payment } = statusForRow(data, b);
    // Payment cell: shows paid_amount (green) when paid, pending_amount otherwise
    const paymentCell = (() => {
      if (status === 'paid' && payment?.paid_amount != null) {
        return `<td class="num center tight paid-amt" data-sort="${payment.paid_amount}">${fmtMoney(payment.paid_amount)}</td>`;
      }
      if (payment?.pending_amount != null) {
        return `<td class="num center tight" data-sort="${payment.pending_amount}">${fmtMoney(payment.pending_amount)}</td>`;
      }
      return `<td class="num center tight muted" data-sort="-1">—</td>`;
    })();
    const rewardsEditable = b.type === 'cc' || !!b.cc;
    const rewardsFmt = fmtRewards(b);
    const rewards = rewardsFmt
      ? `<td class="num center tight rewards${rewardsEditable ? ' editable-cell' : ''}" data-rewards-bill-id="${b.id}" data-sort="${b.cc.rewards_balance}">${rewardsFmt}</td>`
      : `<td class="num center tight rewards zero${rewardsEditable ? ' editable-cell' : ''}" data-rewards-bill-id="${b.id}" data-sort="0">—</td>`;
    const typePill = b.type ? `<span class="pill type tiny bill-type-inline">${BILL_TYPE_LABELS[b.type] || b.type}</span>` : '';
    const noteLine = b.notes
      ? `<div class="bill-note" data-note-bill-id="${b.id}" title="${escapeAttr(b.notes)}">${escape(b.notes)}</div>`
      : `<div class="bill-note" data-note-bill-id="${b.id}"></div>`;

    return `${prefix}<tr data-bill-id="${b.id}">
      <td class="tight" data-sort="${b.day ?? 99}"><span class="day">${b.day ?? '—'}</span></td>
      <td data-sort="${escapeAttr(b.brand + ' ' + b.name)}"><b>${escape(b.brand)}</b> — ${escape(b.name)} ${typePill}${aprBadge(b)}${dueBadge(b)}${noteLine}</td>
      <td class="tight" data-sort="${b.who || ''}">${whoPill(b.who)}</td>
      ${amountCell(b, year)}
      <td class="tight" data-sort="${status}">${statusPill(status, payment, b)}</td>
      ${paymentCell}
      ${rewards}
      ${rotationCell(b)}
      <td class="row-actions">
        <button class="del" data-del="${b.id}" title="Delete">✕</button>
        <button class="dots" data-bill-id="${b.id}" title="More">⋯</button>
      </td>
    </tr>`;
  }).join('');

  const tailDivider = showTodayDivider && !dividerInserted ? dividerRow() : '';

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${thSortable('day', 'Day', '')}
            ${thSortable('name', 'Bill')}
            ${thSortable('who', 'Who')}
            ${thSortable('amount', 'Amount', 'num')}
            ${thSortable('status', 'This month')}
            ${thSortable('pending', 'Payment', 'num center')}
            ${thSortable('rewards', 'Rewards', 'num center')}
            ${thSortable('lastused', 'Last used', 'center')}
            <th style="min-width: 78px;"></th>
          </tr>
        </thead>
        <tbody>${bodyRows}${tailDivider}</tbody>
      </table>
    </div>
  `;
}

// ---------- attention banner ----------

function attentionHTML(data) {
  const nc = needsConfirm(data);
  if (nc.length === 0) return '';
  const first = nc[0];
  const bill = data.bills.find(b => b.id === first.bill_id);
  if (!bill) return '';
  const more = nc.length > 1 ? ` · and ${nc.length - 1} more` : '';
  return `
    <div class="nag">
      ⚠️ <div><b>${escape(bill.brand)} — ${escape(bill.name)}</b> — scheduled ${fmtMoney(first.pending_amount)} on ${shortDate(first.scheduled_date)}. Payment day has passed — did it post?${more}</div>
      <div class="nag-actions">
        <button class="btn" data-confirm-payment-id="${first.id}">Confirm paid</button>
      </div>
    </div>
  `;
}

// ---------- main render ----------

function render(snap) {
  const { data, loading } = snap;
  if (!data) {
    page.innerHTML = loading
      ? `<div class="empty"><h3>Loading…</h3></div>`
      : `<div class="empty"><h3>Not connected</h3><p>Open settings (⚙) to configure.</p></div>`;
    return;
  }

  page.innerHTML =
    summaryHTML(data) +
    attentionHTML(data) +
    filtersHTML() +
    tableHTML(data);

  wireInteractions(data);
}

// ---------- wiring ----------

function wireInteractions(data) {
  // search
  const searchEl = document.getElementById('f-search');
  if (searchEl) {
    let t;
    searchEl.addEventListener('input', (e) => {
      clearTimeout(t);
      ui.search = e.target.value;
      // debounce re-render to keep typing smooth
      t = setTimeout(() => render(state.get()), 120);
    });
  }

  // who chips
  document.querySelectorAll('.chip[data-who]').forEach(el => {
    el.addEventListener('click', () => {
      ui.who = el.dataset.who;
      render(state.get());
    });
  });

  // type/status selects
  document.getElementById('f-type')?.addEventListener('change', e => {
    ui.type = e.target.value; render(state.get());
  });
  document.getElementById('f-status')?.addEventListener('change', e => {
    ui.status = e.target.value; render(state.get());
  });

  // month nav
  document.getElementById('m-prev')?.addEventListener('click', () => {
    ui.month = shiftMonth(ui.month, -1); render(state.get());
  });
  document.getElementById('m-next')?.addEventListener('click', () => {
    ui.month = shiftMonth(ui.month, 1); render(state.get());
  });

  // add bill
  document.getElementById('btn-add-bill')?.addEventListener('click', () => openBillForm(null));

  // sort headers
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (ui.sort.key === key) ui.sort.dir = ui.sort.dir === 'asc' ? 'desc' : 'asc';
      else { ui.sort.key = key; ui.sort.dir = 'asc'; }
      render(state.get());
    });
  });

  // summary card breakdown modals
  document.querySelectorAll('.clickable-card[data-breakdown]').forEach(card => {
    card.addEventListener('click', () => showBreakdownModal(data, card.dataset.breakdown));
  });

  // status click: cycle
  document.querySelectorAll('.status.clickable').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      cycleStatus(el.dataset.billId);
    });
  });

  // quick delete
  document.querySelectorAll('button.del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      const bill = state.get().data?.bills.find(b => b.id === id);
      if (!bill) return;
      if (!confirm(`Delete "${bill.brand} — ${bill.name}"?`)) return;
      state.mutate(d => {
        d.bills = d.bills.filter(x => x.id !== id);
        d.payments = d.payments.filter(x => x.bill_id !== id);
      }, `delete ${bill.name}`);
      toast(`Deleted: ${bill.brand} — ${bill.name}`, 'info');
    });
  });

  // row menu
  document.querySelectorAll('button.dots').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleRowMenu(btn.dataset.billId, btn);
    });
  });

  // attention banner confirm
  document.querySelectorAll('[data-confirm-payment-id]').forEach(btn => {
    btn.addEventListener('click', () => confirmPayment(btn.dataset.confirmPaymentId));
  });

  // inline note edit — div.bill-note is inside the Bill td cell
  document.querySelectorAll('div.bill-note[data-note-bill-id]').forEach(div => {
    div.addEventListener('click', (e) => {
      e.stopPropagation(); // don't bubble to row click handlers
      if (div.querySelector('input')) return; // already editing
      const billId = div.dataset.noteBillId;
      const bill = state.get().data?.bills.find(b => b.id === billId);
      if (!bill) return;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = bill.notes || '';
      input.className = 'note-input';
      input.placeholder = 'Add a note…';
      div.innerHTML = '';
      div.appendChild(input);
      input.focus();
      input.select();
      const commit = () => {
        const val = input.value.trim();
        if (val !== (bill.notes || '').trim()) {
          state.mutate(d => { const b = d.bills.find(x => x.id === billId); if (b) b.notes = val || ''; }, 'edit note');
        } else {
          render(state.get()); // just re-render to restore display
        }
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.removeEventListener('blur', commit); render(state.get()); }
      });
    });
  });

  // inline rewards edit
  document.querySelectorAll('td[data-rewards-bill-id].editable-cell').forEach(td => {
    td.addEventListener('click', () => {
      if (td.querySelector('input')) return;
      const billId = td.dataset.rewardsBillId;
      const bill = state.get().data?.bills.find(b => b.id === billId);
      if (!bill) return;

      const currentUnit = bill.cc?.rewards_unit || 'dollars';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = currentUnit === 'points' ? '1' : '0.01';
      input.value = bill.cc?.rewards_balance ?? '';
      input.className = 'note-input';
      input.placeholder = currentUnit === 'points' ? '0' : '0.00';
      input.style.width = '80px';

      const sel = document.createElement('select');
      sel.className = 'note-input';
      sel.style.width = '58px';
      sel.innerHTML = `
        <option value="dollars" ${currentUnit === 'dollars' ? 'selected' : ''}>$</option>
        <option value="points"  ${currentUnit === 'points'  ? 'selected' : ''}>pts</option>
      `;
      // Update step/placeholder when unit changes
      sel.addEventListener('change', () => {
        input.step = sel.value === 'points' ? '1' : '0.01';
        input.placeholder = sel.value === 'points' ? '0' : '0.00';
      });

      td.innerHTML = '';
      td.style.whiteSpace = 'nowrap';
      td.appendChild(input);
      td.appendChild(sel);
      input.focus();
      input.select();

      let cancelled = false;
      const commit = (e) => {
        // Only commit when focus leaves both elements in the cell
        if (td.contains(e.relatedTarget)) return;
        if (cancelled) return;
        const raw = input.value.trim();
        const val = raw === '' ? null : parseFloat(raw);
        const unit = sel.value;
        const curBal = bill.cc?.rewards_balance ?? null;
        const curUnit = bill.cc?.rewards_unit || 'dollars';
        if (val !== curBal || unit !== curUnit) {
          state.mutate(d => {
            const b = d.bills.find(x => x.id === billId);
            if (!b.cc) b.cc = {};
            b.cc.rewards_balance = val;
            b.cc.rewards_unit = unit;
          }, 'edit rewards');
        } else {
          render(state.get());
        }
      };
      const onKey = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        if (e.key === 'Escape') { cancelled = true; render(state.get()); }
      };
      input.addEventListener('blur', commit);
      sel.addEventListener('blur', commit);
      input.addEventListener('keydown', onKey);
      sel.addEventListener('keydown', onKey);
    });
  });

  // dismiss menus on outside click
  document.addEventListener('click', dismissMenus, { once: true });
}

function dismissMenus() {
  document.querySelectorAll('.menu').forEach(m => m.remove());
}

// ---------- row menu ----------

function toggleRowMenu(billId, anchor) {
  dismissMenus();
  const { data } = state.get();
  const bill = data.bills.find(b => b.id === billId);
  if (!bill) return;
  const { status, payment } = statusForRow(data, bill);
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = `
    <div class="menu-item" data-act="edit"><div class="title">✏️ Edit bill</div></div>
    <div class="menu-item" data-act="pending"><div class="title">💵 Set pending amount…</div><div class="desc">Scheduled for ${monthLabel(ui.month)}</div></div>
    <div class="menu-item" data-act="skip-payment"><div class="title">🚫 No payment this month</div><div class="desc">$0 — nothing due, marks as skipped</div></div>
    ${status === 'paid' ? `<div class="menu-item" data-act="edit-paid-amount"><div class="title">✏️ Edit paid amount</div><div class="desc">Correct the amount without resetting paid date</div></div>` : ''}
    ${payment ? `<div class="menu-item" data-act="mark-paid"><div class="title">✅ Mark paid</div></div>` : ''}
    <div class="menu-sep"></div>
    ${bill.cc ? `<div class="menu-item" data-act="mark-used"><div class="title">🔁 Mark card used today</div><div class="desc">Updates rotation tracker</div></div><div class="menu-sep"></div>` : ''}
    <div class="menu-item" data-act="archive"><div class="title">🗄️ ${bill.archived ? 'Unarchive' : 'Archive'} bill</div><div class="desc">${bill.archived ? 'Restore to the list' : 'Hides this bill, keeps payment history'}</div></div>
    <div class="menu-item danger" data-act="delete"><div class="title">🗑️ Delete bill</div><div class="desc">Permanently removes the bill and its payments</div></div>
    ${payment ? `<div class="menu-item danger" data-act="delete-payment"><div class="title">❌ Clear ${monthLabel(ui.month)} payment record</div></div>` : ''}
  `;
  positionMenu(menu, anchor); // appends to body with position:fixed — no overflow clipping

  menu.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => {
      const act = item.dataset.act;
      menu.remove();
      handleMenuAction(billId, act);
    });
  });

  // prevent immediate close from the outside-click handler
  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true });
  }, 0);
}

function handleMenuAction(billId, act) {
  const { data } = state.get();
  const bill = data.bills.find(b => b.id === billId);
  if (!bill) return;
  const period = periodForBill(bill, ui.month);

  switch (act) {
    case 'edit': openBillForm(bill); break;
    case 'pending': promptPendingAmount(bill, period); break;
    case 'skip-payment': skipPayment(bill, period); break;
    case 'mark-paid': markPaid(bill, period); break;
    case 'edit-paid-amount': {
      const existing = paymentFor(data, bill.id, period);
      if (!existing) return;
      amountModal({
        title: 'Edit paid amount',
        sub: `${bill.brand} — ${bill.name} · only the amount changes, paid date is preserved`,
        defaultValue: existing.paid_amount ?? existing.pending_amount ?? bill.amount ?? 0,
        confirmLabel: 'Update amount',
        onConfirm: (amt) => {
          state.mutate(d => {
            const p = d.payments.find(x => x.bill_id === bill.id && x.period === period);
            if (p) p.paid_amount = amt;
          }, `edit paid amount ${bill.brand} — ${bill.name}`);
          toast(`Updated: ${bill.brand} — ${bill.name}`, 'success');
        },
      });
      break;
    }
    case 'mark-used':
      state.mutate(d => {
        const b = d.bills.find(x => x.id === bill.id);
        if (!b.cc) b.cc = {};
        b.cc.last_used = todayISO();
      }, 'mark card used');
      toast(`${bill.brand} ${bill.name} marked used today`, 'success');
      break;
    case 'archive':
      state.mutate(d => {
        const b = d.bills.find(x => x.id === bill.id);
        b.archived = !b.archived;
      }, 'toggle archive');
      break;
    case 'delete':
      if (!confirm(`Delete ${bill.brand} — ${bill.name}? This also removes its payment history.`)) return;
      state.mutate(d => {
        d.bills = d.bills.filter(x => x.id !== bill.id);
        d.payments = d.payments.filter(p => p.bill_id !== bill.id);
      }, 'delete bill');
      break;
    case 'delete-payment':
      state.mutate(d => {
        d.payments = d.payments.filter(p => !(p.bill_id === bill.id && p.period === period));
      }, 'clear payment record');
      break;
  }
}

// ---------- status cycle ----------

function cycleStatus(billId) {
  const { data } = state.get();
  const bill = data.bills.find(b => b.id === billId);
  if (!bill) return;
  const period = periodForBill(bill, ui.month);
  const existing = paymentFor(data, bill.id, period);

  if (!existing) {
    // unpaid → scheduled: ask for amount
    promptPendingAmount(bill, period);
    return;
  }

  const curStatus = existing.scheduled_date && existing.scheduled_date < todayISO() && existing.status === 'scheduled'
    ? 'needs_confirm' : existing.status;

  if (curStatus === 'scheduled' || curStatus === 'needs_confirm') {
    // → paid
    markPaid(bill, period);
  } else if (curStatus === 'paid') {
    // → reset (clear record)
    if (confirm(`Reset ${bill.brand} ${bill.name} for ${monthLabel(ui.month)}? This deletes the payment record.`)) {
      state.mutate(d => {
        d.payments = d.payments.filter(p => p.id !== existing.id);
      }, 'reset payment');
    }
  }
}

// ---------- breakdown modal ----------

function showBreakdownModal(data, type) {
  const existing = document.getElementById('breakdown-modal-backdrop');
  if (existing) existing.remove();

  const filtered = data.bills.filter(b => !b.archived);
  let items = [];

  if (type === 'pending') {
    for (const b of filtered) {
      const { status, payment } = statusForRow(data, b);
      if (payment && payment.pending_amount > 0 && status !== 'paid' && status !== 'skipped') {
        items.push({ name: `${b.brand ? b.brand + ' ' : ''}${b.name}`, amount: payment.pending_amount, who: b.who });
      }
    }
    items.sort((a, b) => b.amount - a.amount);
  } else {
    for (const b of filtered) {
      const { status, payment } = statusForRow(data, b);
      if (status === 'paid' && payment?.paid_amount != null && payment.paid_date?.slice(0, 7) === ui.month) {
        items.push({ name: `${b.brand ? b.brand + ' ' : ''}${b.name}`, amount: payment.paid_amount, who: b.who });
      }
    }
    items.sort((a, b) => b.amount - a.amount);
  }

  const total = items.reduce((s, i) => s + i.amount, 0);
  const title = type === 'pending' ? 'Pending this month' : 'Paid this month';
  const monthLabel = new Date(ui.month + '-02').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const rows = items.length
    ? items.map(i => `
        <div class="breakdown-row">
          <span class="breakdown-name">${i.name}</span>
          <span class="breakdown-amount">${fmtMoney(i.amount)}</span>
        </div>`).join('')
    : `<div class="breakdown-empty">No bills to show.</div>`;

  const backdrop = document.createElement('div');
  backdrop.id = 'breakdown-modal-backdrop';
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="width:min(420px,92vw)">
      <h2>${title}</h2>
      <p class="modal-sub">${monthLabel}</p>
      <div class="breakdown-list">${rows}</div>
      <div class="breakdown-total">
        <span>Total</span>
        <span>${fmtMoney(total)}</span>
      </div>
      <div class="modal-actions" style="justify-content:flex-end">
        <button class="btn primary" id="breakdown-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#breakdown-close').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
}

// ---------- amount modal (replaces native prompt) ----------

function amountModal({ title, sub, defaultValue, confirmLabel, onConfirm }) {
  const existing = document.getElementById('amount-modal-backdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'amount-modal-backdrop';
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal amount-modal">
      <h2>${escape(title)}</h2>
      ${sub ? `<p class="modal-sub">${escape(sub)}</p>` : ''}
      <div class="amount-modal-input-wrap">
        <span class="amount-modal-prefix">$</span>
        <input id="amt-input" type="number" min="0" step="0.01" value="${defaultValue ?? 0}" />
      </div>
      <div class="modal-actions">
        <button class="btn" id="amt-cancel">Cancel</button>
        <button class="btn primary" id="amt-confirm">${confirmLabel || 'Confirm'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const input = backdrop.querySelector('#amt-input');
  input.focus();
  input.select();

  const confirmBtn = backdrop.querySelector('#amt-confirm');
  const updateLabel = () => {
    const v = parseFloat(input.value);
    if (!isNaN(v) && v === 0) {
      confirmBtn.textContent = 'No payment';
    } else {
      confirmBtn.textContent = confirmLabel || 'Confirm';
    }
  };
  input.addEventListener('input', updateLabel);
  updateLabel();

  const confirm = () => {
    const amt = parseFloat(input.value);
    if (isNaN(amt)) { toast('Enter a valid amount', 'error'); input.focus(); return; }
    backdrop.remove();
    onConfirm(amt);
  };
  const cancel = () => backdrop.remove();

  backdrop.querySelector('#amt-confirm').addEventListener('click', confirm);
  backdrop.querySelector('#amt-cancel').addEventListener('click', cancel);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) cancel(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') cancel();
  });
}

function promptPendingAmount(bill, period) {
  const existing = paymentFor(state.get().data, bill.id, period);
  const def = existing?.pending_amount ?? bill.amount ?? 0;

  amountModal({
    title: `${bill.brand} — ${bill.name}`,
    sub: `Scheduled payment · ${monthLabel(ui.month)}`,
    defaultValue: def,
    confirmLabel: 'Schedule',
    onConfirm: (amt) => {
      if (amt === 0) { skipPayment(bill, period); return; }
      const scheduledDate = `${ui.month}-${String(bill.day || 1).padStart(2, '0')}`;
      state.mutate(d => {
        const existingP = d.payments.find(p => p.bill_id === bill.id && p.period === period);
        if (existingP) {
          existingP.pending_amount = amt;
          existingP.scheduled_date = scheduledDate;
          if (existingP.status === 'unpaid') existingP.status = 'scheduled';
        } else {
          d.payments.push({
            id: uid(), bill_id: bill.id, period, status: 'scheduled',
            pending_amount: amt, paid_amount: null,
            scheduled_date: scheduledDate, paid_date: null, marker: '', notes: '',
          });
        }
      }, 'set pending amount');
    },
  });
}

function markPaid(bill, period) {
  const data = state.get().data;
  const existing = paymentFor(data, bill.id, period);
  const def = existing?.paid_amount ?? existing?.pending_amount ?? bill.amount ?? 0;

  amountModal({
    title: `${bill.brand} — ${bill.name}`,
    sub: `Confirm payment · ${monthLabel(ui.month)}`,
    defaultValue: def,
    confirmLabel: 'Mark paid',
    onConfirm: (amt) => {
      state.mutate(d => {
        let p = d.payments.find(pp => pp.bill_id === bill.id && pp.period === period);
        if (!p) {
          p = {
            id: uid(), bill_id: bill.id, period, status: 'paid',
            pending_amount: amt, paid_amount: amt,
            scheduled_date: `${ui.month}-${String(bill.day || 1).padStart(2, '0')}`,
            paid_date: todayISO(), marker: '', notes: '',
          };
          d.payments.push(p);
        } else {
          p.status = 'paid';
          p.paid_amount = amt;
          p.paid_date = todayISO();
        }
        // auto-decrement 0% APR counter if applicable
        const b = d.bills.find(x => x.id === bill.id);
        if (b?.cc?.apr_zero?.months_left > 0) b.cc.apr_zero.months_left -= 1;
        // update last_used for CC (only when amount > 0 — $0 payments aren't real usage)
        if (b?.cc && amt > 0) b.cc.last_used = todayISO();
      }, 'mark paid');
    },
  });
}

function skipPayment(bill, period) {
  state.mutate(d => {
    const existing = d.payments.find(p => p.bill_id === bill.id && p.period === period);
    if (existing) {
      existing.status = 'skipped';
      existing.pending_amount = 0;
      existing.paid_amount = 0;
      existing.paid_date = todayISO();
    } else {
      d.payments.push({
        id: uid(), bill_id: bill.id, period, status: 'skipped',
        pending_amount: 0, paid_amount: 0,
        scheduled_date: `${ui.month}-${String(bill.day || 1).padStart(2, '0')}`,
        paid_date: todayISO(), marker: '', notes: '',
      });
    }
  }, 'no payment');
  toast('marked — no payment this month', 'info');
}

function confirmPayment(paymentId) {
  const data = state.get().data;
  const p = data.payments.find(x => x.id === paymentId);
  if (!p) return;
  const bill = data.bills.find(b => b.id === p.bill_id);
  if (!bill) return;
  markPaid(bill, p.period);
}

// ---------- bill form modal ----------

function openBillForm(existing) {
  const isEdit = !!existing;
  const b = existing || {
    brand: '', name: '', who: 'chang', type: 'cc', frequency: 'monthly',
    day: 1, amount: null, variable: true, notes: '',
    cc: null,
  };
  const cc = b.cc || {};
  const apr = cc.apr_zero || {};

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal wide">
      <h2>${isEdit ? 'Edit bill' : 'Add bill'}</h2>
      <p class="modal-sub">All fields except brand + name are optional.</p>

      <div class="form-grid">
        <label class="field"><span>Brand</span>
          <input id="f-brand" value="${escapeAttr(b.brand)}" placeholder="Chase, PNC, Amex…" />
        </label>
        <label class="field"><span>Name</span>
          <input id="f-name" value="${escapeAttr(b.name)}" placeholder="Freedom Unlimited, Mortgage…" />
        </label>
        <label class="field"><span>Who</span>
          <select id="f-who">
            ${['chang', 'kiju', 'joint'].map(w => `<option value="${w}" ${b.who === w ? 'selected' : ''}>${WHO_LABEL[w]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Type</span>
          <select id="f-type-sel">
            ${BILL_TYPES.map(t => `<option value="${t}" ${b.type === t ? 'selected' : ''}>${BILL_TYPE_LABELS[t]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Frequency</span>
          <select id="f-freq">
            ${FREQUENCIES.map(f => `<option value="${f}" ${b.frequency === f ? 'selected' : ''}>${FREQ_LABELS[f]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Day of month (1–31)</span>
          <input id="f-day" type="number" min="1" max="31" value="${b.day ?? ''}" />
        </label>
        <label class="field"><span>Amount (leave blank for variable)</span>
          <input id="f-amount" type="number" step="0.01" value="${b.amount ?? ''}" />
        </label>
        <label class="field"><span>Total balance remaining (optional)</span>
          <input id="f-balance" type="number" step="0.01" value="${b.balance_remaining ?? ''}" />
        </label>
        <label class="field"><span>Due date (optional)</span>
          <input id="f-due-date" type="date" value="${b.due_date || ''}" />
        </label>
        <label class="field full"><span>Notes</span>
          <textarea id="f-notes">${escape(b.notes || '')}</textarea>
        </label>
      </div>

      <div class="form-section">
        <h4>CC-specific (optional — only for credit cards)</h4>
        <div class="form-grid">
          <label class="field"><span>Last used date</span>
            <input id="f-lastused" type="date" value="${cc.last_used || ''}" />
          </label>
          <label class="field"><span>Rewards balance</span>
            <div class="input-with-unit">
              <input id="f-rewards" type="number" min="0" step="0.01" value="${cc.rewards_balance ?? ''}" />
              <select id="f-rewards-unit">
                <option value="dollars" ${(cc.rewards_unit || 'dollars') === 'dollars' ? 'selected' : ''}>$ dollars</option>
                <option value="points"  ${cc.rewards_unit === 'points' ? 'selected' : ''}>pts points</option>
              </select>
            </div>
          </label>
        </div>
      </div>

      <div class="form-section">
        <h4>0% APR promo (optional)</h4>
        <div class="form-grid">
          <label class="field"><span>Expires</span>
            <input id="f-apr-date" type="date" value="${apr.expires_date || ''}" />
          </label>
          <label class="field"><span>Months left</span>
            <input id="f-apr-months" type="number" min="0" value="${apr.months_left ?? ''}" />
          </label>
          <label class="field"><span>Balance remaining</span>
            <input id="f-apr-bal" type="number" step="0.01" value="${apr.balance_remaining ?? ''}" />
          </label>
        </div>
      </div>

      <div class="modal-actions">
        <span class="spacer"></span>
        <button class="btn" id="f-cancel">Cancel</button>
        <button class="btn primary" id="f-save">${isEdit ? 'Save changes' : 'Add bill'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#f-cancel').onclick = () => backdrop.remove();
  backdrop.querySelector('#f-save').onclick = () => {
    const brand = backdrop.querySelector('#f-brand').value.trim();
    const name = backdrop.querySelector('#f-name').value.trim();
    if (!brand || !name) { toast('Brand and Name are required', 'error'); return; }

    const amountRaw = backdrop.querySelector('#f-amount').value;
    const balanceRaw = backdrop.querySelector('#f-balance').value;
    const dueDate = backdrop.querySelector('#f-due-date').value;
    const lastUsed = backdrop.querySelector('#f-lastused').value;
    const rewardsRaw = backdrop.querySelector('#f-rewards').value;
    const rewardsUnit = backdrop.querySelector('#f-rewards-unit').value;
    const aprDate = backdrop.querySelector('#f-apr-date').value;
    const aprMonthsRaw = backdrop.querySelector('#f-apr-months').value;
    const aprBalRaw = backdrop.querySelector('#f-apr-bal').value;

    const newBill = {
      id: existing?.id || uid(),
      brand, name,
      who: backdrop.querySelector('#f-who').value,
      type: backdrop.querySelector('#f-type-sel').value,
      frequency: backdrop.querySelector('#f-freq').value,
      day: parseInt(backdrop.querySelector('#f-day').value, 10) || null,
      amount: amountRaw === '' ? null : parseFloat(amountRaw),
      variable: amountRaw === '',
      balance_remaining: balanceRaw === '' ? null : parseFloat(balanceRaw),
      due_date: dueDate || null,
      notes: backdrop.querySelector('#f-notes').value,
      archived: existing?.archived || false,
    };

    const hasCC = lastUsed || rewardsRaw !== '' || aprDate || aprMonthsRaw !== '' || aprBalRaw !== '';
    if (hasCC || existing?.cc) {
      newBill.cc = {};
      if (lastUsed) newBill.cc.last_used = lastUsed;
      if (rewardsRaw !== '') {
        newBill.cc.rewards_balance = parseFloat(rewardsRaw);
        newBill.cc.rewards_unit = rewardsUnit;
      }
      if (aprDate || aprMonthsRaw !== '' || aprBalRaw !== '') {
        newBill.cc.apr_zero = {};
        if (aprDate) newBill.cc.apr_zero.expires_date = aprDate;
        if (aprMonthsRaw !== '') newBill.cc.apr_zero.months_left = parseInt(aprMonthsRaw, 10);
        if (aprBalRaw !== '') newBill.cc.apr_zero.balance_remaining = parseFloat(aprBalRaw);
      }
    }

    state.mutate(d => {
      if (isEdit) {
        const idx = d.bills.findIndex(x => x.id === existing.id);
        if (idx >= 0) d.bills[idx] = newBill;
      } else {
        d.bills.push(newBill);
      }
    }, isEdit ? 'edit bill' : 'add bill');

    backdrop.remove();
    toast(isEdit ? `Updated: ${brand} — ${name}` : `Added: ${brand} — ${name}`, 'success');
  };
}

// ---------- utilities ----------

function escape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ---------- boot ----------

if (isMobile()) {
  import('./bills-mobile.js').then(m => m.init());
} else {
  state.subscribe(render);
  bootstrap();
}
