// Pure-logic tests for js/core/dates.js and js/core/derive.js.
// Run with: npm test  (node --test tests/)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  periodFor, nextOccurrence, daysBetween, occurrencesPerYear, todayISO,
} from '../js/core/dates.js';
import {
  yearProgress, statusForRow, cadenceAnchorMonth, rotation, getAttentionItems,
  dueMonthInfo, billStatusDisplay, snapshotAt, balanceSeries, seriesDelta,
} from '../js/core/derive.js';

// ---------- periodFor ----------

test('periodFor: monthly', () => {
  assert.equal(periodFor('2026-04-01', 'monthly'), '2026-04');
});

test('periodFor: quarterly boundaries', () => {
  assert.equal(periodFor('2026-01-01', 'quarterly'), '2026-Q1');
  assert.equal(periodFor('2026-03-31', 'quarterly'), '2026-Q1');
  assert.equal(periodFor('2026-04-01', 'quarterly'), '2026-Q2');
  assert.equal(periodFor('2026-12-31', 'quarterly'), '2026-Q4');
});

test('periodFor: halves and annual', () => {
  assert.equal(periodFor('2026-06-30', 'biannual'), '2026-H1');
  assert.equal(periodFor('2026-07-01', 'semi_annual'), '2026-H2');
  assert.equal(periodFor('2026-05-15', 'annual'), '2026');
});

// The period anchor rule: day-01 anchoring exists because day 31 in April
// would roll into May. Verify the rollover actually happens with a raw date —
// this documents WHY pages must pass -01.
test('periodFor: day-31 anchor in April rolls to May (why the -01 rule exists)', () => {
  assert.equal(periodFor('2026-04-31', 'monthly'), '2026-05'); // JS date rollover
  assert.equal(periodFor('2026-04-01', 'monthly'), '2026-04'); // the safe anchor
});

// ---------- nextOccurrence ----------

test('nextOccurrence: monthly, day later this month', () => {
  assert.equal(nextOccurrence(20, 'monthly', '2026-07-01'), '2026-07-20');
});

test('nextOccurrence: monthly, day already passed → next month', () => {
  assert.equal(nextOccurrence(5, 'monthly', '2026-07-10'), '2026-08-05');
});

test('nextOccurrence: day 31 clamps to short months instead of rolling over', () => {
  // April has 30 days — a day-31 bill must land on Apr 30, not May 1
  assert.equal(nextOccurrence(31, 'monthly', '2026-04-15'), '2026-04-30');
  // February non-leap
  assert.equal(nextOccurrence(31, 'monthly', '2026-02-01'), '2026-02-28');
  // February leap year
  assert.equal(nextOccurrence(31, 'monthly', '2028-02-01'), '2028-02-29');
});

test('nextOccurrence: year boundary', () => {
  assert.equal(nextOccurrence(5, 'monthly', '2026-12-20'), '2027-01-05');
});

test('nextOccurrence: quarterly without anchor assumes current month', () => {
  assert.equal(nextOccurrence(15, 'quarterly', '2026-02-01'), '2026-02-15');
});

test('nextOccurrence: quarterly with anchor aligns to the cadence phase', () => {
  // Cadence lands on Jan/Apr/Jul/Oct (anchor = January = month 0).
  // From Feb 1, the next occurrence is Apr 15 — not Feb or May.
  assert.equal(nextOccurrence(15, 'quarterly', '2026-02-01', 0), '2026-04-15');
  // From Apr 20 (already past Apr 15) → Jul 15
  assert.equal(nextOccurrence(15, 'quarterly', '2026-04-20', 0), '2026-07-15');
  // Anchor month in the future relative to current month
  assert.equal(nextOccurrence(15, 'quarterly', '2026-02-01', 2), '2026-03-15');
});

test('nextOccurrence: biannual anchor across year boundary', () => {
  // Cadence Jun/Dec (anchor = 5). From Nov 2026 → Dec 2026; from Dec 20 → Jun 2027.
  assert.equal(nextOccurrence(10, 'biannual', '2026-11-01', 5), '2026-12-10');
  assert.equal(nextOccurrence(10, 'biannual', '2026-12-20', 5), '2027-06-10');
});

test('nextOccurrence: occurrence on fromISO itself counts (not pushed to next cycle)', () => {
  assert.equal(nextOccurrence(15, 'monthly', '2026-07-15'), '2026-07-15');
});

test('nextOccurrence: anchorMonth ignored for monthly', () => {
  // step=1 — anchor must not shift a monthly bill
  assert.equal(nextOccurrence(15, 'monthly', '2026-02-01', 6), '2026-02-15');
});

test('nextOccurrence: phase-align overflows past December into next year', () => {
  // quarterly anchored Jan (cadence Jan/Apr/Jul/Oct), from Nov → Jan next year
  assert.equal(nextOccurrence(15, 'quarterly', '2026-11-01', 0), '2027-01-15');
});

test('nextOccurrence: phase-align + day clamp combined', () => {
  // quarterly anchored Feb, day 31 → lands Feb 28, not Mar 3
  assert.equal(nextOccurrence(31, 'quarterly', '2026-01-01', 1), '2026-02-28');
});

test('nextOccurrence: multi-year cadence steps whole years', () => {
  assert.equal(nextOccurrence(10, 'biennial', '2026-07-01'), '2026-07-10');
  // already passed this year → +2 years, same month
  assert.equal(nextOccurrence(10, 'biennial', '2026-07-15'), '2028-07-10');
});

test('nextOccurrence: one_time / variable / missing day → null', () => {
  assert.equal(nextOccurrence(10, 'one_time', '2026-07-01'), null);
  assert.equal(nextOccurrence(10, 'variable', '2026-07-01'), null);
  assert.equal(nextOccurrence(null, 'monthly', '2026-07-01'), null);
});

// ---------- daysBetween / occurrencesPerYear ----------

test('daysBetween: sign and DST safety', () => {
  assert.equal(daysBetween('2026-07-01', '2026-07-04'), 3);
  assert.equal(daysBetween('2026-07-04', '2026-07-01'), -3);
  // spans US DST transition (Mar 8 2026)
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
});

test('daysBetween: year boundary and leap day', () => {
  assert.equal(daysBetween('2027-12-31', '2028-01-01'), 1);
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2); // 2028 leap
  assert.equal(daysBetween('2027-02-28', '2027-03-01'), 1); // non-leap
});

test('occurrencesPerYear: known cadences', () => {
  assert.equal(occurrencesPerYear('monthly'), 12);
  assert.equal(occurrencesPerYear('quarterly'), 4);
  assert.equal(occurrencesPerYear('one_time'), null);
});

// ---------- derive: yearProgress ----------

test('yearProgress: counts paid periods in the year, capped at total', () => {
  const bill = { id: 'b1', frequency: 'quarterly' };
  const data = {
    payments: [
      { bill_id: 'b1', period: '2026-Q1', status: 'paid' },
      { bill_id: 'b1', period: '2026-Q2', status: 'paid' },
      { bill_id: 'b1', period: '2026-Q3', status: 'skipped' }, // not paid — excluded
      { bill_id: 'b1', period: '2025-Q4', status: 'paid' },    // wrong year — excluded
    ],
  };
  assert.deepEqual(yearProgress(data, bill, 2026), { filled: 2, total: 4 });
});

test('yearProgress: null for monthly/variable', () => {
  assert.equal(yearProgress({ payments: [] }, { id: 'x', frequency: 'monthly' }, 2026), null);
});

test('yearProgress: filled never exceeds total (duplicate period records)', () => {
  const bill = { id: 'b1', frequency: 'annual' };
  const data = {
    payments: [
      { bill_id: 'b1', period: '2026', status: 'paid' },
      { bill_id: 'b1', period: '2026', status: 'paid' }, // duplicate — must not overflow the bar
    ],
  };
  assert.deepEqual(yearProgress(data, bill, 2026), { filled: 1, total: 1 });
});

// ---------- derive: rotation ----------

test('rotation: null without last_used', () => {
  assert.equal(rotation({ cc: {} }), null);
  assert.equal(rotation({}), null);
});

test('rotation: fresh / warn / stale tiers at default 6-month target', () => {
  // warn kicks in at 87.5% of target (5.25 mo = ~157 days); stale at 6 mo (180 days)
  assert.equal(rotation({ cc: { last_used: isoDaysFromNow(-30) } }).level, 'fresh');
  assert.equal(rotation({ cc: { last_used: isoDaysFromNow(-165) } }).level, 'warn');
  assert.equal(rotation({ cc: { last_used: isoDaysFromNow(-190) } }).level, 'stale');
});

test('rotation: custom target rescales the tiers', () => {
  // 100 days ≈ 3.3 mo — stale against a 3-month target, fresh against 6
  assert.equal(rotation({ cc: { last_used: isoDaysFromNow(-100) } }, 3).level, 'stale');
  assert.equal(rotation({ cc: { last_used: isoDaysFromNow(-100) } }, 6).level, 'fresh');
});

// ---------- derive: statusForRow ----------

test('statusForRow: no record → unpaid', () => {
  const data = { payments: [] };
  const bill = { id: 'b1', frequency: 'monthly' };
  const r = statusForRow(data, bill, '2026-07');
  assert.equal(r.status, 'unpaid');
  assert.equal(r.period, '2026-07');
});

test('statusForRow: scheduled in the past auto-advances to needs_confirm', () => {
  const data = {
    payments: [{ bill_id: 'b1', period: '2026-07', status: 'scheduled', scheduled_date: '2000-01-01' }],
  };
  const bill = { id: 'b1', frequency: 'monthly' };
  assert.equal(statusForRow(data, bill, '2026-07').status, 'needs_confirm');
});

test('statusForRow: scheduled in the future stays scheduled', () => {
  const data = {
    payments: [{ bill_id: 'b1', period: '2026-07', status: 'scheduled', scheduled_date: '2099-01-01' }],
  };
  const bill = { id: 'b1', frequency: 'monthly' };
  assert.equal(statusForRow(data, bill, '2026-07').status, 'scheduled');
});

test('statusForRow: scheduled TODAY stays scheduled (strict < comparison)', () => {
  const data = {
    payments: [{ bill_id: 'b1', period: periodFor(`${todayISO().slice(0, 7)}-01`, 'monthly'), status: 'scheduled', scheduled_date: todayISO() }],
  };
  const bill = { id: 'b1', frequency: 'monthly' };
  assert.equal(statusForRow(data, bill, todayISO().slice(0, 7)).status, 'scheduled');
});

test('statusForRow: quarterly bill — any month in the quarter maps to the same record', () => {
  const data = {
    payments: [{ bill_id: 'b1', period: '2026-Q2', status: 'paid' }],
  };
  const bill = { id: 'b1', frequency: 'quarterly' };
  for (const m of ['2026-04', '2026-05', '2026-06']) {
    const r = statusForRow(data, bill, m);
    assert.equal(r.status, 'paid', `month ${m}`);
    assert.equal(r.period, '2026-Q2');
  }
  assert.equal(statusForRow(data, bill, '2026-07').status, 'unpaid'); // Q3 — fresh period
});

// ---------- derive: cadenceAnchorMonth ----------

test('cadenceAnchorMonth: derives month from latest payment', () => {
  const data = {
    payments: [
      { bill_id: 'b1', period: '2026-Q1', status: 'paid', scheduled_date: '2026-01-15' },
      { bill_id: 'b1', period: '2026-Q2', status: 'paid', scheduled_date: '2026-04-15' },
    ],
  };
  const bill = { id: 'b1', frequency: 'quarterly' };
  assert.equal(cadenceAnchorMonth(data, bill), 3); // April = month index 3
});

test('cadenceAnchorMonth: null for monthly or no payments', () => {
  assert.equal(cadenceAnchorMonth({ payments: [] }, { id: 'b1', frequency: 'quarterly' }), null);
  assert.equal(cadenceAnchorMonth({ payments: [] }, { id: 'b1', frequency: 'monthly' }), null);
});

test('cadenceAnchorMonth: prefers scheduled_date over paid_date on the same record', () => {
  const data = {
    payments: [{ bill_id: 'b1', period: '2026-Q3', status: 'paid', scheduled_date: '2026-08-05', paid_date: '2026-09-01' }],
  };
  assert.equal(cadenceAnchorMonth(data, { id: 'b1', frequency: 'quarterly' }), 7); // Aug, not Sep
});

test('cadenceAnchorMonth: skips dateless records to find the latest usable one', () => {
  const data = {
    payments: [
      { bill_id: 'b1', period: '2026-Q3', status: 'skipped' }, // newest but no dates
      { bill_id: 'b1', period: '2026-Q2', status: 'paid', paid_date: '2026-04-10' },
    ],
  };
  assert.equal(cadenceAnchorMonth(data, { id: 'b1', frequency: 'quarterly' }), 3); // April
  // all records dateless → null
  assert.equal(cadenceAnchorMonth(
    { payments: [{ bill_id: 'b1', period: '2026-Q1', status: 'skipped' }] },
    { id: 'b1', frequency: 'quarterly' },
  ), null);
});

// ---------- derive: dueMonthInfo ----------

test('dueMonthInfo: null for monthly / one_time / variable', () => {
  assert.equal(dueMonthInfo({ frequency: 'monthly' }, '2026-07'), null);
  assert.equal(dueMonthInfo({ frequency: 'one_time' }, '2026-07'), null);
  assert.equal(dueMonthInfo({ frequency: 'variable' }, '2026-07'), null);
});

test('dueMonthInfo: no anchor falls back to last month of calendar period', () => {
  // quarterly → Mar/Jun/Sep/Dec
  assert.deepEqual(dueMonthInfo({ frequency: 'quarterly' }, '2026-02'), { dueMonthIdx: 2, isDue: false });
  assert.deepEqual(dueMonthInfo({ frequency: 'quarterly' }, '2026-03'), { dueMonthIdx: 2, isDue: true });
  // biannual → Jun/Dec
  assert.deepEqual(dueMonthInfo({ frequency: 'biannual' }, '2026-04'), { dueMonthIdx: 5, isDue: false });
  assert.deepEqual(dueMonthInfo({ frequency: 'semi_annual' }, '2026-12'), { dueMonthIdx: 11, isDue: true });
  // annual → Dec
  assert.deepEqual(dueMonthInfo({ frequency: 'annual' }, '2026-05'), { dueMonthIdx: 11, isDue: false });
});

test('dueMonthInfo: anchor phase-aligns the due month within the period', () => {
  // quarterly anchored to July (idx 6) → cadence Jan/Apr/Jul/Oct
  assert.deepEqual(dueMonthInfo({ frequency: 'quarterly' }, '2026-05', 6), { dueMonthIdx: 3, isDue: true });  // Q2, due Apr — May past it
  assert.deepEqual(dueMonthInfo({ frequency: 'quarterly' }, '2026-08', 6), { dueMonthIdx: 6, isDue: true });  // Q3, due Jul
  assert.deepEqual(dueMonthInfo({ frequency: 'quarterly' }, '2026-09', 6), { dueMonthIdx: 6, isDue: true });
  // biannual anchored to Sep (idx 8) → cadence Mar/Sep
  assert.deepEqual(dueMonthInfo({ frequency: 'biannual' }, '2026-01', 8), { dueMonthIdx: 2, isDue: false }); // H1, due Mar
  assert.deepEqual(dueMonthInfo({ frequency: 'biannual' }, '2026-07', 8), { dueMonthIdx: 8, isDue: false }); // H2, due Sep
  assert.deepEqual(dueMonthInfo({ frequency: 'biannual' }, '2026-10', 8), { dueMonthIdx: 8, isDue: true });
});

test('dueMonthInfo: annual anchored to July — due from July through December', () => {
  assert.deepEqual(dueMonthInfo({ frequency: 'annual' }, '2026-03', 6), { dueMonthIdx: 6, isDue: false });
  assert.deepEqual(dueMonthInfo({ frequency: 'annual' }, '2026-07', 6), { dueMonthIdx: 6, isDue: true });
  assert.deepEqual(dueMonthInfo({ frequency: 'annual' }, '2026-11', 6), { dueMonthIdx: 6, isDue: true });
});

test('dueMonthInfo: bimonthly anchored to Feb → cadence Feb/Apr/Jun…', () => {
  assert.deepEqual(dueMonthInfo({ frequency: 'bimonthly' }, '2026-03', 1), { dueMonthIdx: 3, isDue: false }); // Mar off-month, next Apr
  assert.deepEqual(dueMonthInfo({ frequency: 'bimonthly' }, '2026-04', 1), { dueMonthIdx: 3, isDue: true });
  assert.deepEqual(dueMonthInfo({ frequency: 'bimonthly' }, '2026-01', 1), { dueMonthIdx: 1, isDue: false }); // Jan, due Feb
});

test('dueMonthInfo: multi-year cadences treated as annual (year-granular periods)', () => {
  assert.deepEqual(dueMonthInfo({ frequency: 'biennial' }, '2026-05', 7), { dueMonthIdx: 7, isDue: false });
  assert.deepEqual(dueMonthInfo({ frequency: 'triennial' }, '2026-05'), { dueMonthIdx: 11, isDue: false });
});

// ---------- derive: billStatusDisplay ----------

test('billStatusDisplay: non-unpaid statuses pass through unchanged', () => {
  const data = { payments: [] };
  const bill = { id: 'b1', frequency: 'quarterly' };
  assert.deepEqual(billStatusDisplay(data, bill, 'paid', '2026-02'), { key: 'paid', label: 'Paid' });
  assert.deepEqual(billStatusDisplay(data, bill, 'scheduled', '2026-02'), { key: 'scheduled', label: 'Scheduled' });
});

test('billStatusDisplay: monthly unpaid stays Unpaid', () => {
  const data = { payments: [] };
  const bill = { id: 'b1', frequency: 'monthly' };
  assert.deepEqual(billStatusDisplay(data, bill, 'unpaid', '2026-02'), { key: 'unpaid', label: 'Unpaid' });
});

test('billStatusDisplay: one_time / variable unpaid stays Unpaid (no due-month remap)', () => {
  const data = { payments: [] };
  assert.deepEqual(billStatusDisplay(data, { id: 'b1', frequency: 'one_time' }, 'unpaid', '2026-07'), { key: 'unpaid', label: 'Unpaid' });
  assert.deepEqual(billStatusDisplay(data, { id: 'b1', frequency: 'variable' }, 'unpaid', '2026-07'), { key: 'unpaid', label: 'Unpaid' });
});

test('billStatusDisplay: non-monthly unpaid before due month → "Not due · <Mon>"', () => {
  const data = { payments: [] }; // no history → calendar-period-end fallback (Mar for Q1)
  const bill = { id: 'b1', frequency: 'quarterly' };
  assert.deepEqual(billStatusDisplay(data, bill, 'unpaid', '2026-02'), { key: 'not_due', label: 'Not due · Mar' });
});

test('billStatusDisplay: non-monthly unpaid in/after due month → "Due"', () => {
  const data = { payments: [] };
  const bill = { id: 'b1', frequency: 'quarterly' };
  assert.deepEqual(billStatusDisplay(data, bill, 'unpaid', '2026-03'), { key: 'due', label: 'Due' });
});

test('billStatusDisplay: uses payment history to phase-align the due month', () => {
  // annual bill historically paid in July → anchored to July, not December
  const data = {
    payments: [{ bill_id: 'b1', period: '2025', status: 'paid', paid_date: '2025-07-14' }],
  };
  const bill = { id: 'b1', frequency: 'annual' };
  assert.deepEqual(billStatusDisplay(data, bill, 'unpaid', '2026-03'), { key: 'not_due', label: 'Not due · Jul' });
  assert.deepEqual(billStatusDisplay(data, bill, 'unpaid', '2026-08'), { key: 'due', label: 'Due' });
});

// ---------- derive: getAttentionItems (non_renewing subscriptions) ----------

// Local-date version — toISOString() is UTC and can be a day off near midnight
// in non-UTC timezones, which would flip boundary-sensitive assertions.
function isoDaysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptyData(subscriptions) {
  return {
    bills: [], payments: [], subscriptions, vesting: [], grants: [],
    perks: [], perk_claims: [], backlog: [], warranties: [], settings: {},
  };
}

test('attention: non_renewing sub past end date → zone 1 sub_ended with sub_id', () => {
  const data = emptyData([
    { id: 's1', name: 'Epidemic Sound', status: 'non_renewing', frequency: 'annual', next_renewal: isoDaysFromNow(-3) },
  ]);
  const items = getAttentionItems(data);
  const ended = items.find(i => i.kind === 'sub_ended');
  assert.ok(ended);
  assert.equal(ended.zone, 1);
  assert.equal(ended.sub_id, 's1');
});

test('attention: non_renewing sub ending within 30d → zone 2 sub_ending, no sub_renewal', () => {
  const data = emptyData([
    { id: 's1', name: 'Epidemic Sound', status: 'non_renewing', frequency: 'annual', next_renewal: isoDaysFromNow(24) },
  ]);
  const items = getAttentionItems(data);
  assert.ok(items.find(i => i.kind === 'sub_ending' && i.zone === 2));
  assert.equal(items.find(i => i.kind === 'sub_renewal'), undefined);
  assert.equal(items.find(i => i.kind === 'sub_ended'), undefined);
});

test('attention: non_renewing sub ending beyond 30d → no attention items', () => {
  const data = emptyData([
    { id: 's1', name: 'Epidemic Sound', status: 'non_renewing', frequency: 'annual', next_renewal: isoDaysFromNow(60) },
  ]);
  const items = getAttentionItems(data);
  assert.equal(items.filter(i => i.kind.startsWith('sub_')).length, 0);
});

test('attention: active non-monthly sub still produces sub_renewal', () => {
  const data = emptyData([
    { id: 's1', name: 'Adobe CC', status: 'active', frequency: 'annual', amount: 599, next_renewal: isoDaysFromNow(10) },
  ]);
  const items = getAttentionItems(data);
  assert.ok(items.find(i => i.kind === 'sub_renewal'));
});

test('attention: cancelled sub past end date produces nothing', () => {
  const data = emptyData([
    { id: 's1', name: 'Old Sub', status: 'cancelled', frequency: 'annual', next_renewal: isoDaysFromNow(-3) },
  ]);
  const items = getAttentionItems(data);
  assert.equal(items.filter(i => i.kind.startsWith('sub_')).length, 0);
});

// ---------- account balance series (accounts trend chart) ----------

const acct = (snaps) => ({ snapshots: snaps });

test('snapshotAt: most recent on or before date', () => {
  const a = acct([{ date: '2026-01-10', balance: 100 }, { date: '2026-03-05', balance: 120 }]);
  assert.equal(snapshotAt(a, '2026-02-01').balance, 100);
  assert.equal(snapshotAt(a, '2026-03-05').balance, 120);
  assert.equal(snapshotAt(a, '2026-01-09'), null);
  assert.equal(snapshotAt(acct([]), '2026-01-01'), null);
  assert.equal(snapshotAt({}, '2026-01-01'), null);
});

test('snapshotAt: tolerates unsorted snapshots', () => {
  const a = acct([{ date: '2026-03-05', balance: 120 }, { date: '2026-01-10', balance: 100 }]);
  assert.equal(snapshotAt(a, '2026-02-01').balance, 100);
});

test('balanceSeries: sums accounts, dots only on real snapshot dates', () => {
  const a = acct([{ date: '2026-01-10', balance: 100 }]);
  const b = acct([{ date: '2026-02-10', balance: 50 }]);
  const pts = balanceSeries([a, b], '2026-01-01', '2026-03-01');
  assert.deepEqual(pts.map(p => p.date), ['2026-01-10', '2026-02-10', '2026-03-01']);
  assert.deepEqual(pts.map(p => p.value), [100, 150, 150]);
  assert.deepEqual(pts.map(p => p.real), [true, true, false]);
});

test('balanceSeries: pre-window history forward-fills a synthetic start point', () => {
  const a = acct([{ date: '2025-11-01', balance: 80 }, { date: '2026-02-10', balance: 95 }]);
  const pts = balanceSeries([a], '2026-01-01', '2026-03-01');
  assert.deepEqual(pts.map(p => p.date), ['2026-01-01', '2026-02-10', '2026-03-01']);
  assert.deepEqual(pts.map(p => p.value), [80, 95, 95]);
  assert.equal(pts[0].real, false);
});

test('balanceSeries: no start point invented when history starts mid-window', () => {
  const a = acct([{ date: '2026-02-10', balance: 95 }]);
  const pts = balanceSeries([a], '2026-01-01', '2026-03-01');
  assert.equal(pts[0].date, '2026-02-10');
});

test('balanceSeries: account with later first snapshot contributes 0 before it', () => {
  const a = acct([{ date: '2026-01-10', balance: 100 }]);
  const b = acct([{ date: '2026-02-10', balance: 500 }]);
  const pts = balanceSeries([a, b], '2026-01-01', '2026-03-01');
  assert.equal(pts.find(p => p.date === '2026-01-10').value, 100); // b not yet visible
});

test('balanceSeries: snapshot exactly on window edges', () => {
  const a = acct([{ date: '2026-01-01', balance: 10 }, { date: '2026-03-01', balance: 20 }]);
  const pts = balanceSeries([a], '2026-01-01', '2026-03-01');
  assert.deepEqual(pts.map(p => [p.date, p.real]), [['2026-01-01', true], ['2026-03-01', true]]);
});

test('balanceSeries: empty inputs', () => {
  assert.deepEqual(balanceSeries([], '2026-01-01', '2026-03-01'), []);
  assert.deepEqual(balanceSeries([acct([]), {}], '2026-01-01', '2026-03-01'), []);
});

test('balanceSeries: only pre-window history still yields carried flat line', () => {
  const a = acct([{ date: '2025-06-01', balance: 70 }]);
  const pts = balanceSeries([a], '2026-01-01', '2026-03-01');
  assert.deepEqual(pts.map(p => [p.date, p.value, p.real]),
    [['2026-01-01', 70, false], ['2026-03-01', 70, false]]);
});

test('seriesDelta: delta and pct', () => {
  const d = seriesDelta([{ value: 100 }, { value: 150 }]);
  assert.equal(d.delta, 50);
  assert.equal(d.pct, 50);
  assert.equal(d.start, 100);
  assert.equal(d.end, 150);
});

test('seriesDelta: null for <2 points, null pct on zero base', () => {
  assert.equal(seriesDelta([]), null);
  assert.equal(seriesDelta([{ value: 5 }]), null);
  assert.equal(seriesDelta([{ value: 0 }, { value: 40 }]).pct, null);
});
