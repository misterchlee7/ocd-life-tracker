// Computed views over the raw data. Pages should call these rather than
// re-implementing the same filters/joins.
//
// Kept intentionally sparse for now — will grow as pages are implemented.

import { periodFor, nextOccurrence, todayISO, daysFromToday } from './dates.js';

// All PaymentRecords for a given bill, sorted newest-first.
export function paymentsFor(data, billId) {
  return data.payments
    .filter(p => p.bill_id === billId)
    .sort((a, b) => (b.period || '').localeCompare(a.period || ''));
}

// The PaymentRecord for a specific bill + period, or null.
export function paymentFor(data, billId, period) {
  return data.payments.find(p => p.bill_id === billId && p.period === period) || null;
}

// All PerkClaims for a given perk.
export function claimsFor(data, perkId) {
  return data.perk_claims
    .filter(c => c.perk_id === perkId)
    .sort((a, b) => (b.period || '').localeCompare(a.period || ''));
}

// Count of filled segments for a non-monthly bill in the given calendar year.
// Returns { filled, total } where total = occurrences/year.
export function yearProgress(data, bill, year) {
  const total = { quarterly: 4, biannual: 2, semi_annual: 2, annual: 1, bimonthly: 6 }[bill.frequency];
  if (!total) return null;
  const prefix = String(year);
  const filled = data.payments.filter(p =>
    p.bill_id === bill.id &&
    p.status === 'paid' &&
    (p.period || '').startsWith(prefix)
  ).length;
  return { filled: Math.min(filled, total), total };
}

// Rotation freshness for a CC. Returns { level, monthsAgo } or null if no last_used.
// level = 'fresh' | 'warn' | 'stale'
export function rotation(bill, rotationTargetMonths = 6) {
  const d = bill?.cc?.last_used;
  if (!d) return null;
  const daysAgo = -daysFromToday(d);
  const monthsAgo = daysAgo / 30;
  let level = 'fresh';
  if (monthsAgo >= rotationTargetMonths) level = 'stale';
  else if (monthsAgo >= rotationTargetMonths * 0.875) level = 'warn';
  return { level, monthsAgo: Math.round(monthsAgo * 10) / 10 };
}

// Bills needing confirmation right now (scheduled + payment day has passed).
export function needsConfirm(data) {
  const today = todayISO();
  return data.payments.filter(p => {
    if (p.status === 'needs_confirm') return true;
    if (p.status === 'scheduled' && p.scheduled_date && p.scheduled_date < today) return true;
    return false;
  });
}

// Effective status of a bill for the viewed month (YYYY-MM).
// Applies the scheduled → needs_confirm auto-advance when the payment day passed.
// Returns { status, payment, period }.
export function statusForRow(data, bill, monthISO) {
  // Always anchor at day 01 — bill.day can exceed the month length (period anchor rule)
  const period = periodFor(`${monthISO}-01`, bill.frequency);
  const p = paymentFor(data, bill.id, period);
  if (!p) return { status: 'unpaid', payment: null, period };
  let status = p.status;
  if (status === 'scheduled' && p.scheduled_date && p.scheduled_date < todayISO()) {
    status = 'needs_confirm';
  }
  return { status, payment: p, period };
}

// Month index (0–11) that a non-monthly bill's cadence lands on, derived from
// its most recent payment record. Returns null when unknown (no payments yet)
// or irrelevant (monthly bills). Used to phase-align nextOccurrence().
export function cadenceAnchorMonth(data, bill) {
  if (!bill.frequency || bill.frequency === 'monthly') return null;
  const latest = paymentsFor(data, bill.id).find(p => p.scheduled_date || p.paid_date);
  const dateISO = latest?.scheduled_date || latest?.paid_date;
  if (!dateISO) return null;
  return Number(dateISO.slice(5, 7)) - 1;
}

// Comprehensive attention items for the Dashboard hub.
// Returns an array of { zone (1|2), kind, label, detail, link }.
//   Zone 1 = Needs Action (urgent, red)
//   Zone 2 = On Your Radar (time-sensitive, amber)
export function getAttentionItems(data) {
  const today = todayISO();
  const items = [];

  // ── Zone 1: Needs Action ──────────────────────────────────────────────────

  // Bills needing payment confirmation
  for (const p of needsConfirm(data)) {
    const bill = data.bills.find(b => b.id === p.bill_id);
    if (!bill || bill.archived) continue;
    const amt = p.pending_amount ? ` · $${Number(p.pending_amount).toLocaleString()}` : '';
    items.push({
      zone: 1,
      kind: 'needs_confirm',
      label: `${bill.brand} — ${bill.name}`,
      detail: `Payment passed${amt} · confirm it posted`,
      link: 'bills.html',
    });
  }

  // Imminent vesting events (≤3 days away)
  for (const v of (data.vesting || [])) {
    if (v.status !== 'upcoming' || !v.date) continue;
    const days = daysFromToday(v.date);
    if (days >= 0 && days <= 3) {
      const grant = (data.grants || []).find(g => g.id === v.grant_id);
      const company = grant?.company || grant?.label || 'Vest';
      const when = days === 0 ? 'today' : `in ${days}d`;
      const shares = v.shares ? ` · ${v.shares} shares` : '';
      items.push({
        zone: 1,
        kind: 'vesting_imminent',
        label: `${company} — vesting ${when}`,
        detail: `${v.type?.toUpperCase() || 'RSU'}${shares}`,
        link: 'vesting.html',
      });
    }
  }

  // Subscription trials ending within 7 days
  for (const s of (data.subscriptions || [])) {
    if (s.archived || s.status !== 'trial' || !s.trial_ends) continue;
    const days = daysFromToday(s.trial_ends);
    if (days >= 0 && days <= 7) {
      const when = days === 0 ? 'today' : `in ${days}d`;
      const amt = s.amount ? ` → $${s.amount}/${s.frequency}` : '';
      items.push({
        zone: 1,
        kind: 'trial_ending',
        label: s.name,
        detail: `Trial ends ${when}${amt}`,
        link: 'subscriptions.html',
      });
    }
  }

  // Non-renewing subscriptions whose end date has passed — confirm as cancelled
  for (const s of (data.subscriptions || [])) {
    if (s.archived || s.status !== 'non_renewing' || !s.next_renewal) continue;
    const days = daysFromToday(s.next_renewal);
    if (days < 0) {
      const ago = days === -1 ? 'yesterday' : `${-days}d ago`;
      items.push({
        zone: 1,
        kind: 'sub_ended',
        label: s.name,
        detail: `Ended ${ago} · confirm cancelled`,
        link: 'subscriptions.html',
        sub_id: s.id,
      });
    }
  }

  // ── Zone 2: On Your Radar ─────────────────────────────────────────────────

  // 0% APR warnings
  const aprWarnMonths = data.settings?.apr_warn_months ?? 2;
  for (const b of (data.bills || [])) {
    if (b.archived) continue;
    const apr = b?.cc?.apr_zero;
    if (apr && apr.months_left != null && apr.months_left <= aprWarnMonths) {
      const bal = apr.balance_remaining != null ? ` · $${Number(apr.balance_remaining).toLocaleString()} remaining` : '';
      items.push({
        zone: 2,
        kind: 'apr_zero',
        label: `${b.brand} — ${b.name}`,
        detail: `0% APR expires in ${apr.months_left} mo${bal}`,
        link: 'bills.html',
      });
    }
  }

  // Non-monthly subscriptions renewing within 30 days
  for (const s of (data.subscriptions || [])) {
    if (s.archived || s.status === 'cancelled' || s.status === 'non_renewing' || s.frequency === 'monthly') continue;
    if (!s.next_renewal) continue;
    const days = daysFromToday(s.next_renewal);
    if (days >= 0 && days <= 30) {
      const when = days === 0 ? 'today' : `in ${days}d`;
      const amt = s.amount ? ` · $${s.amount}` : '';
      items.push({
        zone: 2,
        kind: 'sub_renewal',
        label: s.name,
        detail: `Renews ${when}${amt}`,
        link: 'subscriptions.html',
      });
    }
  }

  // Non-renewing subscriptions ending within 30 days (any frequency)
  for (const s of (data.subscriptions || [])) {
    if (s.archived || s.status !== 'non_renewing' || !s.next_renewal) continue;
    const days = daysFromToday(s.next_renewal);
    if (days >= 0 && days <= 30) {
      const when = days === 0 ? 'today' : `in ${days}d`;
      items.push({
        zone: 2,
        kind: 'sub_ending',
        label: s.name,
        detail: `Access ends ${when} · won't renew`,
        link: 'subscriptions.html',
      });
    }
  }

  // Warranties expiring within 30 days (not yet expired)
  for (const w of (data.warranties || [])) {
    if (w.archived || !w.expiry_date) continue;
    const days = daysFromToday(w.expiry_date);
    if (days >= 0 && days <= 30) {
      const when = days === 0 ? 'today' : `in ${days}d`;
      items.push({
        zone: 2,
        kind: 'warranty_expiry',
        label: w.name,
        detail: `Warranty expires ${when}`,
        link: 'warranties.html',
      });
    }
  }

  // Perks with available status expiring within 5 days (all frequencies)
  for (const p of (data.perks || [])) {
    if (p.archived || !p.reset_day) continue;
    const anchor = `${today.slice(0, 7)}-${String(p.reset_day).padStart(2, '0')}`;
    const period = periodFor(anchor, p.frequency);
    const claim = (data.perk_claims || []).find(c => c.perk_id === p.id && c.period === period);
    if ((claim?.status || 'available') !== 'available') continue;
    // nextOccurrence gives the next reset date for any frequency
    const nextReset = nextOccurrence(p.reset_day, p.frequency);
    if (!nextReset) continue;
    const daysToReset = daysFromToday(nextReset);
    if (daysToReset <= 5) {
      const when = daysToReset === 0 ? 'today' : `in ${daysToReset}d`;
      items.push({
        zone: 2,
        kind: 'perk_expiring',
        label: `${p.card} — ${p.name}`,
        detail: `Unclaimed · resets ${when} · $${p.value}`,
        link: 'perks.html',
      });
    }
  }

  // Overdue backlog tasks (open/in_progress with past due_date)
  for (const t of (data.backlog || [])) {
    if (t.status !== 'open' && t.status !== 'in_progress') continue;
    if (!t.due_date) continue;
    const days = daysFromToday(t.due_date);
    if (days < 0) {
      items.push({
        zone: 2,
        kind: 'backlog_overdue',
        label: t.title,
        detail: `Due ${t.due_date} · ${-days}d overdue`,
        link: 'backlog.html',
      });
    }
  }

  // Snooze-expired backlog items
  for (const t of (data.backlog || [])) {
    if (t.status !== 'snoozed') continue;
    if (t.snoozed_until && t.snoozed_until <= today) {
      items.push({
        zone: 2,
        kind: 'backlog_snooze',
        label: t.title,
        detail: `Snooze expired · was snoozed until ${t.snoozed_until}`,
        link: 'backlog.html',
      });
    }
  }

  // Stale / warn CC cards (rotation target)
  const rotationTarget = data.settings?.rotation_target_months ?? 6;
  for (const b of (data.bills || [])) {
    if (b.archived || b.type !== 'cc' || !b.cc?.last_used) continue;
    const rot = rotation(b, rotationTarget);
    if (!rot || rot.level !== 'stale') continue;
    items.push({
      zone: 2,
      kind: 'cc_rotation',
      label: `${b.brand} — ${b.name}`,
      detail: `Last used ${rot.monthsAgo} mo ago · ${rot.level} (target: every ${rotationTarget} mo)`,
      link: 'bills.html',
    });
  }

  return items;
}
