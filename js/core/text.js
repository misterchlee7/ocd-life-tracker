// Shared HTML escaping + display-label constants.
// Every page used to define its own copies of these — keep them here so
// desktop and mobile modules can never drift apart.

// ---------- escaping ----------

export function escapeHTML(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function truncate(s, max) {
  return s.length > max ? escapeHTML(s.slice(0, max)) + '…' : escapeHTML(s);
}

// ---------- frequencies (all domains) ----------

export const FREQ_LABELS = {
  monthly: 'Monthly', bimonthly: 'Bimonthly', quarterly: 'Quarterly',
  biannual: 'Biannual', semi_annual: 'Semi-annual', annual: 'Annual',
  biennial: 'Biennial', triennial: 'Triennial', quinquennial: '5-yearly',
  one_time: 'One-time', variable: 'Variable',
};

// ---------- bills ----------

export const BILL_STATUS_LABELS = {
  unpaid: 'Unpaid',
  scheduled: 'Scheduled',
  needs_confirm: 'Needs confirm',
  paid: 'Paid',
  auto: 'Auto',
  skipped: 'Skipped',
};

export const BILL_TYPES = ['cc', 'loan', 'utility', 'insurance', 'fee', 'investment', 'gift', 'other'];
export const BILL_TYPE_LABELS = {
  cc: 'CC', loan: 'Loan', utility: 'Utility', insurance: 'Insurance',
  fee: 'Fee', investment: 'Investment', gift: 'Gift', other: 'Other',
};

// ---------- perks ----------

export const PERK_STATUS_LABELS = {
  available: 'Available',
  claimed: 'Claimed',
  skipped: 'Skipped',
  expired: 'Expired',
};

// ---------- subscriptions ----------

export const SUB_CATEGORIES = ['streaming', 'music', 'software', 'fitness', 'news', 'storage', 'gaming', 'shopping', 'cc_annual_fee', 'other'];
export const SUB_CAT_LABELS = {
  streaming: 'Streaming', music: 'Music', software: 'Software', fitness: 'Fitness',
  news: 'News', storage: 'Storage', gaming: 'Gaming', shopping: 'Shopping',
  cc_annual_fee: 'CC Annual Fee', other: 'Other',
};
export const SUB_STATUSES = ['active', 'trial', 'paused', 'non_renewing', 'cancelled'];
export const SUB_STATUS_LABELS = { active: 'Active', trial: 'Trial', paused: 'Paused', non_renewing: 'Non-renewing', cancelled: 'Cancelled' };

// ---------- vesting ----------

export const GRANT_TYPES = ['rsu', 'espp'];
export const GRANT_TYPE_LABELS = { rsu: 'RSU', espp: 'ESPP' };
export const VEST_STATUSES = ['upcoming', 'vested', 'sold', 'pending_settlement'];
export const VEST_STATUS_LABELS = {
  upcoming: 'Upcoming', vested: 'Vested', sold: 'Sold', pending_settlement: 'Pending settlement',
};

// ---------- backlog ----------

export const BACKLOG_CATEGORIES = ['buy', 'do', 'contact', 'misc'];
export const BACKLOG_CAT_LABELS = { buy: 'Buy', do: 'Do', contact: 'Contact', misc: 'Misc' };
export const BACKLOG_CAT_ICONS  = { buy: '🛒', do: '✅', contact: '📞', misc: '📌' };
export const BACKLOG_STATUSES = ['open', 'in_progress', 'done', 'snoozed', 'dropped'];
export const BACKLOG_STATUS_LABELS = {
  open: 'Open', in_progress: 'In progress', done: 'Done', snoozed: 'Snoozed', dropped: 'Dropped',
};

// ---------- warranties ----------

export const WARRANTY_CATEGORIES = ['electronics', 'appliance', 'vehicle', 'furniture', 'tool', 'outdoor', 'clothing', 'other'];
export const WARRANTY_CAT_LABELS = {
  electronics: 'Electronics', appliance: 'Appliance', vehicle: 'Vehicle',
  furniture: 'Furniture', tool: 'Tool', outdoor: 'Outdoor',
  clothing: 'Clothing', other: 'Other',
};
