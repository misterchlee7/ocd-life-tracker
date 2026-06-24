// bills-mobile.js — Card-based mobile view for the bills page.
// Handles status updates and quick pay actions via bottom sheet.
// Desktop table render stays in bills.js — this module is loaded only when isMobile() is true.

import { state, uid } from '../core/state.js';
import { bootstrap, showBottomSheet, whoPill, fmtMoney, toast } from '../core/ui.js';
import { periodFor, todayISO, shortDate } from '../core/dates.js';
import { paymentFor } from '../core/derive.js';

const page = document.getElementById('page');

// Page-local UI state
const ui = {
  month: todayISO().slice(0, 7), // YYYY-MM
  filter: 'all',                  // 'all' | 'unpaid' | 'scheduled' | 'needs_confirm' | 'paid' | 'skipped'
};

const STATUS_LABELS = {
  unpaid: 'Unpaid', scheduled: 'Scheduled', needs_confirm: 'Needs confirm',
  paid: 'Paid', auto: 'Auto', skipped: 'Skipped',
};

const BILL_TYPE_LABELS = {
  cc: 'CC', loan: 'Loan', utility: 'Utility', insurance: 'Insurance',
  fee: 'Fee', investment: 'Investment', gift: 'Gift', other: 'Other',
};

const FREQ_LABELS = {
  monthly: 'Monthly', bimonthly: 'Bimonthly', quarterly: 'Quarterly',
  biannual: 'Biannual', semi_annual: 'Semi-annual', annual: 'Annual',
  biennial: 'Biennial', triennial: 'Triennial', quinquennial: '5-yearly',
  one_time: 'One-time', variable: 'Variable',
};

// ---------- helpers ----------

function periodForBill(bill) {
  // Always pass -01 as day — bill.day can exceed month length, causing JS date rollover.
  return periodFor(`${ui.month}-01`, bill.frequency);
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
  const period = periodForBill(bill);
  const p = paymentFor(data, bill.id, period);
  if (!p) return { status: 'unpaid', payment: null, period };
  let status = p.status;
  if (status === 'scheduled' && p.scheduled_date && p.scheduled_date < todayISO()) {
    status = 'needs_confirm';
  }
  return { status, payment: p, period };
}

function filteredBills(data) {
  const active = data.bills.filter(b => !b.archived);
  if (ui.filter === 'all') return active;
  return active.filter(b => statusForRow(data, b).status === ui.filter);
}

function escape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- summary strip ----------

function summaryStripHTML(data) {
  const active = data.bills.filter(b => !b.archived);
  let pending = 0, paid = 0, needsConfirm = 0;

  for (const b of active) {
    const { status, payment } = statusForRow(data, b);
    if (payment?.pending_amount > 0 && status !== 'paid' && status !== 'skipped') {
      pending += payment.pending_amount;
    }
    if (status === 'paid' && payment?.paid_amount != null &&
        payment.paid_date?.slice(0, 7) === ui.month) {
      paid += payment.paid_amount;
    }
    if (status === 'needs_confirm') needsConfirm++;
  }

  return `
    <div class="m-summary-strip">
      <div class="m-summary-card">
        <div class="label">Pending</div>
        <div class="value">${fmtMoney(pending)}</div>
        <div class="sub">unpaid + scheduled</div>
      </div>
      <div class="m-summary-card">
        <div class="label">Paid</div>
        <div class="value">${fmtMoney(paid)}</div>
        <div class="sub">this month</div>
      </div>
      <div class="m-summary-card">
        <div class="label">Confirm</div>
        <div class="value ${needsConfirm ? 'warn' : ''}">${needsConfirm} ${needsConfirm === 1 ? 'bill' : 'bills'}</div>
        <div class="sub">${needsConfirm ? 'needs review' : 'all clear'}</div>
      </div>
    </div>
  `;
}

// ---------- filter chips ----------

function filterBarHTML(data) {
  const active = data.bills.filter(b => !b.archived);
  const count = (key) => active.filter(b => statusForRow(data, b).status === key).length;

  const chips = [
    { key: 'all',          label: 'All',     n: active.length },
    { key: 'needs_confirm',label: 'Confirm', n: count('needs_confirm') },
    { key: 'unpaid',       label: 'Unpaid',  n: count('unpaid') },
    { key: 'scheduled',    label: 'Sched.',  n: count('scheduled') },
    { key: 'paid',         label: 'Paid',    n: count('paid') },
    { key: 'skipped',      label: 'Skipped', n: count('skipped') },
  ].filter(c => c.key === 'all' || c.n > 0);

  const html = chips.map(c => {
    const badge = c.key !== 'all' && c.n > 0 ? ` <span class="m-chip-count">${c.n}</span>` : '';
    return `<button class="m-chip ${ui.filter === c.key ? 'active' : ''}" data-filter="${c.key}">${c.label}${badge}</button>`;
  }).join('');

  return `<div class="m-filter-bar">${html}</div>`;
}

// ---------- month nav ----------

function monthNavHTML() {
  return `
    <div class="m-month-nav">
      <button id="m-prev">‹</button>
      <div class="m-month-label">${monthLabel(ui.month)}</div>
      <button id="m-next">›</button>
    </div>
  `;
}

// ---------- bill card ----------

function billCardHTML(bill, data) {
  const { status, payment } = statusForRow(data, bill);
  const typePill = bill.type
    ? `<span class="pill type tiny">${BILL_TYPE_LABELS[bill.type] || bill.type}</span>`
    : '';
  const freq = FREQ_LABELS[bill.frequency] || bill.frequency;

  // Amount shown in card header — green when paid
  const amtDisplay = (() => {
    if (status === 'paid' && payment?.paid_amount != null)
      return { text: fmtMoney(payment.paid_amount), paid: true };
    if (payment?.pending_amount != null)
      return { text: fmtMoney(payment.pending_amount), paid: false };
    if (bill.amount != null)
      return { text: fmtMoney(bill.amount), paid: false };
    return { text: 'variable', paid: false };
  })();

  // Primary action button — the one-tap happy path for each status
  const actionBtn = (() => {
    switch (status) {
      case 'unpaid':
        return `<button class="m-action-btn primary" data-action="schedule" data-bill-id="${bill.id}">Schedule</button>`;
      case 'scheduled':
        return `<button class="m-action-btn primary" data-action="mark-paid" data-bill-id="${bill.id}">Mark paid</button>`;
      case 'needs_confirm':
        return `<button class="m-action-btn warn" data-action="mark-paid" data-bill-id="${bill.id}">Confirm paid</button>`;
      case 'paid':
        return `<button class="m-action-btn success" data-action="mark-paid" data-bill-id="${bill.id}">Paid ✓</button>`;
      case 'skipped':
        return `<button class="m-action-btn muted" data-action="schedule" data-bill-id="${bill.id}">Reschedule</button>`;
      default:
        return '';
    }
  })();

  return `
    <div class="m-card" data-bill-id="${bill.id}">
      <div class="m-card-header">
        <div style="min-width:0;flex:1">
          <div class="m-card-name">${escape(bill.brand)} — ${escape(bill.name)}</div>
          <div class="m-card-name-sub">${freq}${bill.day ? ` · Day ${bill.day}` : ''}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:10px">
          <div class="m-card-amount${amtDisplay.paid ? ' paid' : ''}">${amtDisplay.text}</div>
          ${bill.balance_remaining != null
            ? `<div class="m-card-amount-sub">Bal: ${fmtMoney(bill.balance_remaining)}</div>`
            : ''}
        </div>
      </div>
      <div class="m-card-footer">
        <div class="m-card-left">
          ${whoPill(bill.who)}
          ${typePill}
          <span class="status s-${status}"><span class="dot"></span>${STATUS_LABELS[status] || status}</span>
        </div>
        <div class="m-card-right">
          ${actionBtn}
          <button class="m-dots-btn" data-bill-id="${bill.id}" aria-label="More options">⋯</button>
        </div>
      </div>
    </div>
  `;
}

// ---------- render ----------

function render(snap) {
  const { data, loading } = snap;
  if (!data) {
    page.innerHTML = loading
      ? `<div class="empty"><h3>Loading…</h3></div>`
      : `<div class="empty"><h3>Not connected</h3><p>Open settings (⚙) to configure.</p></div>`;
    return;
  }

  const bills = filteredBills(data).sort((a, b) => (a.day ?? 99) - (b.day ?? 99));

  const listHTML = bills.length === 0
    ? `<div class="m-empty">
         <div class="m-empty-icon">✓</div>
         <div class="m-empty-msg">No bills here</div>
         <div class="m-empty-sub">Try a different filter or month</div>
       </div>`
    : `<div class="m-list">${bills.map(b => billCardHTML(b, data)).join('')}</div>`;

  page.innerHTML =
    monthNavHTML() +
    summaryStripHTML(data) +
    filterBarHTML(data) +
    listHTML;

  wireInteractions(data);
}

// ---------- wiring ----------

function wireInteractions(data) {
  // month nav
  document.getElementById('m-prev')?.addEventListener('click', () => {
    ui.month = shiftMonth(ui.month, -1);
    render(state.get());
  });
  document.getElementById('m-next')?.addEventListener('click', () => {
    ui.month = shiftMonth(ui.month, 1);
    render(state.get());
  });

  // filter chips
  document.querySelectorAll('.m-chip[data-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      ui.filter = chip.dataset.filter;
      render(state.get());
    });
  });

  // primary action buttons on cards
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const bill = state.get().data?.bills.find(b => b.id === btn.dataset.billId);
      if (!bill) return;
      const period = periodForBill(bill);
      if (btn.dataset.action === 'schedule') promptPendingAmount(bill, period);
      else if (btn.dataset.action === 'mark-paid') markPaid(bill, period);
    });
  });

  // dots → bottom sheet
  document.querySelectorAll('.m-dots-btn[data-bill-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openBillSheet(btn.dataset.billId);
    });
  });
}

// ---------- bill bottom sheet ----------

function openBillSheet(billId) {
  const { data } = state.get();
  const bill = data.bills.find(b => b.id === billId);
  if (!bill) return;
  const { status, payment } = statusForRow(data, bill);
  const period = periodForBill(bill);

  const items = [
    {
      icon: '💵',
      label: 'Set pending amount',
      description: `Schedule for ${monthLabel(ui.month)}`,
      action: () => promptPendingAmount(bill, period),
    },
    {
      icon: '✅',
      label: 'Mark paid',
      description: 'Confirm payment and enter amount',
      action: () => markPaid(bill, period),
    },
    {
      icon: '🚫',
      label: 'No payment this month',
      description: '$0 — marks as skipped',
      action: () => skipPayment(bill, period),
    },
    ...(status === 'paid' ? [{
      icon: '✏️',
      label: 'Edit paid amount',
      description: 'Adjust amount without resetting paid date',
      action: () => {
        amountModal({
          title: 'Edit paid amount',
          sub: `${bill.brand} — ${bill.name}`,
          defaultValue: payment?.paid_amount ?? payment?.pending_amount ?? bill.amount ?? 0,
          confirmLabel: 'Update',
          onConfirm: (amt) => {
            state.mutate(d => {
              const p = d.payments.find(x => x.bill_id === bill.id && x.period === period);
              if (p) p.paid_amount = amt;
            }, `edit paid amount: ${bill.brand} — ${bill.name} → $${amt}`);
            toast(`Updated: ${bill.brand} — ${bill.name}`, 'success');
          },
        });
      },
    }] : []),
    ...(bill.cc ? [{
      icon: '🔁',
      label: 'Mark card used today',
      description: 'Updates rotation tracker',
      action: () => {
        state.mutate(d => {
          const b = d.bills.find(x => x.id === bill.id);
          if (!b.cc) b.cc = {};
          b.cc.last_used = todayISO();
        }, `mark card used: ${bill.brand} ${bill.name}`);
        toast(`${bill.brand} marked used today`, 'success');
      },
    }] : []),
    ...(payment ? [{
      icon: '❌',
      label: `Clear ${monthLabel(ui.month)} payment`,
      danger: true,
      action: () => {
        state.mutate(d => {
          d.payments = d.payments.filter(
            p => !(p.bill_id === bill.id && p.period === period)
          );
        }, `clear payment: ${bill.brand} — ${bill.name}`);
        toast(`Payment cleared: ${bill.brand} — ${bill.name}`, 'info');
      },
    }] : []),
  ];

  showBottomSheet({ title: `${bill.brand} — ${bill.name}`, items });
}

// ---------- amount modal ----------

function amountModal({ title, sub, defaultValue, confirmLabel, onConfirm }) {
  document.getElementById('amount-modal-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'amount-modal-backdrop';
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal amount-modal">
      <h2>${escape(title)}</h2>
      ${sub ? `<p class="modal-sub">${escape(sub)}</p>` : ''}
      <div class="amount-modal-input-wrap">
        <span class="amount-modal-prefix">$</span>
        <input id="amt-input" type="number" min="0" step="0.01"
               value="${defaultValue ?? 0}" inputmode="decimal" />
      </div>
      <div class="modal-actions">
        <button class="btn" id="amt-cancel">Cancel</button>
        <button class="btn primary" id="amt-confirm">${confirmLabel || 'Confirm'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const input = backdrop.querySelector('#amt-input');
  const confirmBtn = backdrop.querySelector('#amt-confirm');
  input.focus();
  input.select();

  const updateLabel = () => {
    const v = parseFloat(input.value);
    confirmBtn.textContent = (!isNaN(v) && v === 0) ? 'No payment' : (confirmLabel || 'Confirm');
  };
  input.addEventListener('input', updateLabel);
  updateLabel();

  const doConfirm = () => {
    const amt = parseFloat(input.value);
    if (isNaN(amt)) { toast('Enter a valid amount', 'error'); input.focus(); return; }
    backdrop.remove();
    onConfirm(amt);
  };
  const doCancel = () => backdrop.remove();

  confirmBtn.addEventListener('click', doConfirm);
  backdrop.querySelector('#amt-cancel').addEventListener('click', doCancel);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) doCancel(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doConfirm(); }
    if (e.key === 'Escape') doCancel();
  });
}

// ---------- payment actions ----------

function promptPendingAmount(bill, period) {
  const existing = paymentFor(state.get().data, bill.id, period);
  const def = existing?.pending_amount ?? bill.amount ?? 0;
  amountModal({
    title: `${bill.brand} — ${bill.name}`,
    sub: `Schedule payment · ${monthLabel(ui.month)}`,
    defaultValue: def,
    confirmLabel: 'Schedule',
    onConfirm: (amt) => {
      if (amt === 0) { skipPayment(bill, period); return; }
      const scheduledDate = `${ui.month}-${String(bill.day || 1).padStart(2, '0')}`;
      state.mutate(d => {
        const p = d.payments.find(x => x.bill_id === bill.id && x.period === period);
        if (p) {
          p.pending_amount = amt;
          p.scheduled_date = scheduledDate;
          if (p.status === 'unpaid') p.status = 'scheduled';
        } else {
          d.payments.push({
            id: uid(), bill_id: bill.id, period, status: 'scheduled',
            pending_amount: amt, paid_amount: null,
            scheduled_date: scheduledDate, paid_date: null, marker: '', notes: '',
          });
        }
      }, `schedule: ${bill.brand} — ${bill.name} $${amt}`);
      toast(`Scheduled: ${bill.brand} — ${bill.name}`, 'success');
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
        // auto-decrement 0% APR counter
        const b = d.bills.find(x => x.id === bill.id);
        if (b?.cc?.apr_zero?.months_left > 0) b.cc.apr_zero.months_left -= 1;
      }, `mark paid: ${bill.brand} — ${bill.name} $${amt}`);
      toast(`Paid: ${bill.brand} — ${bill.name}`, 'success');
    },
  });
}

function skipPayment(bill, period) {
  state.mutate(d => {
    const p = d.payments.find(x => x.bill_id === bill.id && x.period === period);
    if (p) {
      p.status = 'skipped';
      p.pending_amount = 0;
      p.paid_amount = 0;
      p.paid_date = todayISO();
    } else {
      d.payments.push({
        id: uid(), bill_id: bill.id, period, status: 'skipped',
        pending_amount: 0, paid_amount: 0,
        scheduled_date: `${ui.month}-${String(bill.day || 1).padStart(2, '0')}`,
        paid_date: todayISO(), marker: '', notes: '',
      });
    }
  }, `no payment: ${bill.brand} — ${bill.name}`);
  toast('Marked — no payment this month', 'info');
}

// ---------- boot ----------

export function init() {
  state.subscribe(render);
  bootstrap();
}
