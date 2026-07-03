// Pure mutation commands for bill payments — the single source of truth for
// what "schedule / pay / skip a bill" means to the data. Both the desktop and
// mobile bills modules call these inside state.mutate(); neither may re-implement
// the rules (APR decrement, last_used gating, record shape) on its own.
//
// Every function takes the mutable draft `d` (the data object passed to the
// state.mutate callback) as its first argument. No DOM, no state imports beyond uid.

import { todayISO } from './dates.js';
import { uid } from './state.js';

function findPayment(d, billId, period) {
  return d.payments.find(p => p.bill_id === billId && p.period === period);
}

function scheduledDateFor(monthISO, bill) {
  return `${monthISO}-${String(bill.day || 1).padStart(2, '0')}`;
}

// Set/replace the pending amount for a period. Creates a scheduled record,
// or updates the existing one (unpaid → scheduled).
export function schedulePending(d, bill, period, amt, monthISO) {
  const existing = findPayment(d, bill.id, period);
  const scheduled_date = scheduledDateFor(monthISO, bill);
  if (existing) {
    existing.pending_amount = amt;
    existing.scheduled_date = scheduled_date;
    if (existing.status === 'unpaid') existing.status = 'scheduled';
  } else {
    d.payments.push({
      id: uid(), bill_id: bill.id, period, status: 'scheduled',
      pending_amount: amt, paid_amount: null,
      scheduled_date, paid_date: null, marker: '', notes: '',
    });
  }
}

// Mark a period paid. Also decrements the 0% APR counter.
// Does NOT touch CC last_used — that tracks purchases, not payments. Only the
// explicit "Mark card used today" action (markCardUsed below) updates it.
export function recordPaid(d, bill, period, amt, monthISO) {
  let p = findPayment(d, bill.id, period);
  if (!p) {
    p = {
      id: uid(), bill_id: bill.id, period, status: 'paid',
      pending_amount: amt, paid_amount: amt,
      scheduled_date: scheduledDateFor(monthISO, bill),
      paid_date: todayISO(), marker: '', notes: '',
    };
    d.payments.push(p);
  } else {
    p.status = 'paid';
    p.paid_amount = amt;
    p.paid_date = todayISO();
  }
  const b = d.bills.find(x => x.id === bill.id);
  if (b?.cc?.apr_zero?.months_left > 0) b.cc.apr_zero.months_left -= 1;
}

// "No payment this month" — $0 skipped record. last_used is NOT touched.
export function recordSkip(d, bill, period, monthISO) {
  const existing = findPayment(d, bill.id, period);
  if (existing) {
    existing.status = 'skipped';
    existing.pending_amount = 0;
    existing.paid_amount = 0;
    existing.paid_date = todayISO();
  } else {
    d.payments.push({
      id: uid(), bill_id: bill.id, period, status: 'skipped',
      pending_amount: 0, paid_amount: 0,
      scheduled_date: scheduledDateFor(monthISO, bill),
      paid_date: todayISO(), marker: '', notes: '',
    });
  }
}

// Correct the paid amount only — paid_date, status and everything else untouched.
export function setPaidAmount(d, billId, period, amt) {
  const p = findPayment(d, billId, period);
  if (p) p.paid_amount = amt;
}

// Rotation tracker: card used today.
export function markCardUsed(d, billId) {
  const b = d.bills.find(x => x.id === billId);
  if (!b) return;
  if (!b.cc) b.cc = {};
  b.cc.last_used = todayISO();
}

// Remove the payment record for a period entirely (reset to unpaid).
export function clearPayment(d, billId, period) {
  d.payments = d.payments.filter(p => !(p.bill_id === billId && p.period === period));
}
