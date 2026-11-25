// Static config. User-specific values (GitHub owner, repo, PAT) live in localStorage.

export const STORAGE_KEYS = {
  pat: 'otl.pat',
  owner: 'otl.owner',
  repo: 'otl.repo',
  branch: 'otl.branch',
  cache: 'otl.cache',     // cached data.json contents
  sha: 'otl.sha',         // sha of the cached contents
  prices: 'otl.prices',   // cached stock-prices.json contents
  pricesSha: 'otl.prices_sha',
  draft: 'otl.draft',     // unsaved edits preserved across a refresh/reload
                          // { data, baseSha, ts, labels } — see state.js
  demo: 'otl.demo',       // sessionStorage ONLY — '1' while in demo mode, so tab
                          // navigation re-enters demo instead of re-showing the
                          // landing screen. Never stored in localStorage.
};

export const DEFAULTS = {
  branch: 'main',
  dataPath: 'data.json',
  // Stock prices live in their OWN file so the scheduled price bot in the data
  // repo never writes data.json — a shared file meant every bot run staled an
  // open tab's sha and the next Save died with a 409. See docs/data-schema.md.
  pricesPath: 'stock-prices.json',
};

// Shape of a brand-new data.json when the file doesn't exist in the data repo yet.
export function emptyData() {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    settings: {
      paycheck: {
        frequency: 'biweekly',
        day_of_week: 'friday',
        next_date: null,
        amount_estimate: 0,
      },
      rotation_target_months: 6,
      apr_warn_months: 2,
    },
    bills: [],
    payments: [],
    perks: [],
    perk_claims: [],
    subscriptions: [],
    grants: [],
    vesting: [],
    backlog: [],
    history: [],
  };
}

export function getCreds() {
  return {
    pat: localStorage.getItem(STORAGE_KEYS.pat) || '',
    owner: localStorage.getItem(STORAGE_KEYS.owner) || '',
    repo: localStorage.getItem(STORAGE_KEYS.repo) || '',
    branch: localStorage.getItem(STORAGE_KEYS.branch) || DEFAULTS.branch,
  };
}

export function setCreds({ pat, owner, repo, branch }) {
  if (pat != null) localStorage.setItem(STORAGE_KEYS.pat, pat);
  if (owner != null) localStorage.setItem(STORAGE_KEYS.owner, owner);
  if (repo != null) localStorage.setItem(STORAGE_KEYS.repo, repo);
  if (branch != null) localStorage.setItem(STORAGE_KEYS.branch, branch);
}

// Shape of a brand-new stock-prices.json: a flat ticker -> price map.
export function emptyPrices() {
  return {};
}

export function hasCreds() {
  const c = getCreds();
  return !!(c.pat && c.owner && c.repo);
}
