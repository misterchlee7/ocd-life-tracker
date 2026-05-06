// Date + frequency helpers. All dates are ISO YYYY-MM-DD strings.

export const FREQUENCIES = [
  'monthly', 'bimonthly', 'quarterly', 'biannual', 'semi_annual',
  'annual', 'biennial', 'triennial', 'quinquennial', 'one_time', 'variable',
];

// Number of occurrences per calendar year for a given frequency.
// Used for progress bars ("1/2 done for 2026").
export function occurrencesPerYear(freq) {
  switch (freq) {
    case 'monthly': return 12;
    case 'bimonthly': return 6;
    case 'quarterly': return 4;
    case 'biannual':
    case 'semi_annual': return 2;
    case 'annual': return 1;
    case 'biennial': return 0.5;
    case 'triennial': return 1 / 3;
    case 'quinquennial': return 1 / 5;
    case 'one_time':
    case 'variable':
    default: return null;
  }
}

// Period string for a given date + frequency. Matches the format in docs/data-schema.md.
export function periodFor(date, freq) {
  const d = (date instanceof Date) ? date : new Date(date + 'T00:00:00');
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-indexed
  switch (freq) {
    case 'monthly':
    case 'bimonthly':
      return `${y}-${String(m + 1).padStart(2, '0')}`;
    case 'quarterly':
      return `${y}-Q${Math.floor(m / 3) + 1}`;
    case 'biannual':
    case 'semi_annual':
      return `${y}-H${m < 6 ? 1 : 2}`;
    case 'annual':
    case 'biennial':
    case 'triennial':
    case 'quinquennial':
      return String(y);
    default:
      return `${y}-${String(m + 1).padStart(2, '0')}`;
  }
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Days between two ISO dates. Negative if `to` is in the past.
export function daysBetween(fromISO, toISO) {
  const from = new Date(fromISO + 'T00:00:00');
  const to = new Date(toISO + 'T00:00:00');
  return Math.round((to - from) / 86400000);
}

export function daysFromToday(toISO) {
  return daysBetween(todayISO(), toISO);
}

// "5 days ago" / "in 3 days" / "today"
export function relativeDays(toISO) {
  const n = daysFromToday(toISO);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 0) return `in ${n} days`;
  return `${-n} days ago`;
}

// Short display format: "Apr 3" or "Apr 3, 2027" if different year
export function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = d.getDate();
  const year = d.getFullYear();
  const curYear = new Date().getFullYear();
  return year === curYear ? `${month} ${day}` : `${month} ${day}, ${year}`;
}

// Compute the next occurrence date for a recurring bill.
// day = day-of-month (1-31). Returns ISO YYYY-MM-DD for the next upcoming occurrence,
// anchored at `day`, cadenced by `freq`, relative to `fromISO` (default: today).
// Returns null for one_time/variable.
export function nextOccurrence(day, freq, fromISO) {
  if (freq === 'one_time' || freq === 'variable' || !day) return null;
  const today = fromISO ? new Date(fromISO + 'T00:00:00') : new Date();
  today.setHours(0, 0, 0, 0);

  const step = { monthly: 1, bimonthly: 2, quarterly: 3, biannual: 6, semi_annual: 6, annual: 12 }[freq];
  if (step != null) {
    // find the next month boundary
    let d = new Date(today.getFullYear(), today.getMonth(), day);
    if (d < today) d = new Date(today.getFullYear(), today.getMonth() + step, day);
    return toISO(d);
  }
  // multi-year cadences: use year step
  const yearStep = { biennial: 2, triennial: 3, quinquennial: 5 }[freq];
  if (yearStep) {
    let d = new Date(today.getFullYear(), today.getMonth(), day);
    if (d < today) d = new Date(today.getFullYear() + yearStep, today.getMonth(), day);
    return toISO(d);
  }
  return null;
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
