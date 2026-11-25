// Single source of truth for the loaded data.json in memory.
// Pages import { state } and subscribe with state.subscribe(fn).
//
// TWO FILES, not one. data.json holds everything the user edits; stock-prices.json
// holds the ticker -> price map that the scheduled bot in the data repo rewrites
// every weekday. They used to share data.json, which meant every bot run invalidated
// the sha held by an open tab and the next Save died with a 409 mid-data-entry.
// Prices are merged into memory as `data.stock_prices` so every reader
// (derive.js, vesting.js) is unchanged, but that key is STRIPPED before data.json
// is written — see dataForSave().

import { STORAGE_KEYS, emptyData, emptyPrices, hasCreds } from './config.js';
import { fetchData, putData, fetchPrices, putPrices } from './github.js';

const listeners = new Set();
const undoStack = [];
const MAX_UNDO = 50;
// Human-readable labels of mutations since the last save — used to build a
// meaningful commit message (the data repo's git history is the version history).
// Separate from data.history (the persistent in-app activity log): this is
// transient, in-memory only, and cleared on save/refresh.
let _labels = [];

function commitMessage() {
  const unique = [...new Set(_labels)];
  if (!unique.length) return `update data.json — ${new Date().toISOString()}`;
  const parts = [];
  let len = 0;
  for (const label of unique) {
    if (parts.length && len + label.length > 90) {
      parts.push(`+${unique.length - parts.length} more`);
      break;
    }
    parts.push(label);
    len += label.length + 2;
  }
  return parts.join('; ');
}

let _data = null;
let _sha = null;
let _dirty = false;
let _loading = false;
let _error = null;
let _guest = false; // true while in demo/guest mode

let _prices = null;
let _pricesSha = null;
// JSON of the prices as last fetched/saved. Price dirtiness is DERIVED from this
// rather than kept as a flag, so undoing a price edit back to its original value
// correctly reports "nothing to save" instead of PUTting an identical file.
let _pricesClean = '{}';
// JSON of data.json (price key stripped) as last fetched/saved. Used only by
// saveData()'s identical-content conflict retry.
let _dataClean = null;

function pricesChanged() {
  return JSON.stringify(_prices || {}) !== _pricesClean;
}

function notify() {
  for (const fn of listeners) {
    try { fn(snapshot()); } catch (e) { console.error(e); }
  }
}

function snapshot() {
  return {
    data: _data,
    sha: _sha,
    // `dirty` means "something, in either file, needs saving" — the Save button
    // and the nav guard both key off it.
    dirty: _dirty || pricesChanged(),
    loading: _loading,
    error: _error,
    guest: _guest,
    prices: _prices,
  };
}

// Prices live in their own file but are exposed on data.stock_prices so that
// derive.js / vesting.js / the tests need no knowledge of the split.
function applyPrices() {
  if (_data) _data.stock_prices = _prices || {};
}

// data.json as it should be PERSISTED: without the price map, which belongs to
// stock-prices.json. Shallow copy is enough — only a top-level key is removed.
function dataForSave() {
  const out = { ..._data };
  delete out.stock_prices;
  return out;
}

function cacheWriteClean() {
  if (_guest) return; // NEVER write demo data to localStorage
  try {
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(dataForSave()));
    if (_sha) localStorage.setItem(STORAGE_KEYS.sha, _sha);
    localStorage.setItem(STORAGE_KEYS.prices, JSON.stringify(_prices || {}));
    if (_pricesSha) localStorage.setItem(STORAGE_KEYS.pricesSha, _pricesSha);
  } catch (e) { console.warn('cache write failed', e); }
}

function cacheRead() {
  const raw = localStorage.getItem(STORAGE_KEYS.cache);
  if (!raw) return null;
  try {
    return {
      data: JSON.parse(raw),
      sha: localStorage.getItem(STORAGE_KEYS.sha),
      prices: JSON.parse(localStorage.getItem(STORAGE_KEYS.prices) || '{}'),
      pricesSha: localStorage.getItem(STORAGE_KEYS.pricesSha),
    };
  } catch { return null; }
}

export const state = {
  subscribe(fn) {
    listeners.add(fn);
    fn(snapshot());
    return () => listeners.delete(fn);
  },

  get() { return snapshot(); },

  // Load from cache first (instant), then refresh from GitHub in the background.
  async init() {
    const cached = cacheRead();
    if (cached && cached.data) {
      _data = cached.data;
      _sha = cached.sha;
      _prices = cached.prices || {};
      _pricesSha = cached.pricesSha;
      _pricesClean = JSON.stringify(_prices);
      applyPrices();
      _dataClean = JSON.stringify(dataForSave());
      notify();
    }

    if (!hasCreds()) {
      // don't try to fetch — UI should prompt for settings
      return;
    }

    await this.refresh();
  },

  async refresh() {
    _loading = true; _error = null; notify();
    try {
      const [d, p] = await Promise.all([fetchData(), fetchPrices()]);

      if (d.data === null) {
        // file doesn't exist yet in the data repo — bootstrap with empty
        _data = emptyData();
        _sha = null;  // null sha means "create on first save"
      } else {
        _data = d.data;
        _sha = d.sha;
      }

      if (p.data === null) {
        // stock-prices.json not created yet: fall back to the legacy key inside
        // data.json so existing data still renders. Null sha => create on save.
        _prices = (d.data && d.data.stock_prices) ? { ...d.data.stock_prices } : emptyPrices();
        _pricesSha = null;
      } else {
        _prices = p.data;
        _pricesSha = p.sha;
      }
      _pricesClean = JSON.stringify(_prices);
      applyPrices();
      _dataClean = JSON.stringify(dataForSave());

      _dirty = false;
      _labels = [];
      cacheWriteClean();
    } catch (e) {
      _error = e.message;
      console.error(e);
    } finally {
      _loading = false;
      notify();
    }
  },

  // Apply a mutation function. The fn receives a draft (the current data).
  // Mutations are done in-place on a structured clone so we can snapshot for undo.
  mutate(fn, label) {
    if (!_data) throw new Error('state not loaded');
    undoStack.push({
      label: label || 'edit',
      snapshot: structuredClone(_data),
      prices: structuredClone(_prices || {}),
    });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    _labels.push(label || 'edit');
    fn(_data);
    _data.updated_at = new Date().toISOString();
    if (!_guest) {
      if (!_data.history) _data.history = [];
      _data.history.push({ ts: _data.updated_at, label: label || 'edit' });
      if (_data.history.length > 500) _data.history.splice(0, _data.history.length - 500);
      _dirty = true;
      cacheWriteClean();
    }
    notify();
  },

  // Edit the price map. Goes to stock-prices.json, NOT data.json. The history
  // entry still lands in data.json, per the "every mutation is logged" rule.
  mutatePrices(fn, label) {
    if (!_data) throw new Error('state not loaded');
    if (!_prices) _prices = emptyPrices();
    undoStack.push({
      label: label || 'edit price',
      snapshot: structuredClone(_data),
      prices: structuredClone(_prices),
    });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    _labels.push(label || 'edit price');
    fn(_prices);
    applyPrices();
    if (!_guest) {
      _data.updated_at = new Date().toISOString();
      if (!_data.history) _data.history = [];
      _data.history.push({ ts: _data.updated_at, label: label || 'edit price' });
      if (_data.history.length > 500) _data.history.splice(0, _data.history.length - 500);
      _dirty = true; // the history entry itself dirties data.json
      cacheWriteClean();
    }
    notify();
  },

  undo() {
    const last = undoStack.pop();
    if (!last) return null;
    _data = last.snapshot; // snapshot pre-dates this mutation's history.push, so data.history reverts too
    if (last.prices) _prices = last.prices;
    applyPrices();
    if (_labels.length) _labels.pop(); // the undone mutation no longer belongs in the commit message
    _dirty = true;
    cacheWriteClean();
    notify();
    return last.label; // return label so UI can show what was undone
  },

  canUndo() { return undoStack.length > 0; },

  // Load hardcoded demo data into memory. Nothing is written to localStorage or GitHub.
  enterGuestMode(data) {
    _guest = true;
    _data = structuredClone(data); // defensive clone so demo-data.js object stays pristine
    _sha = null;
    _prices = structuredClone(data.stock_prices || {});
    _pricesSha = null;
    _pricesClean = JSON.stringify(_prices);
    applyPrices();
    _dataClean = null;
    _dirty = false;
    _loading = false;
    _error = null;
    undoStack.length = 0;
    _labels = [];
    // intentionally no cacheWrite — demo data must never touch localStorage
    notify();
  },

  // Called when the user logs in from guest mode. Wipes everything and fetches real data.
  async exitGuestMode() {
    _guest = false;
    _data = null;
    _sha = null;
    _prices = null;
    _pricesSha = null;
    _pricesClean = '{}';
    _dataClean = null;
    _dirty = false;
    _loading = false;
    _error = null;
    undoStack.length = 0;
    _labels = [];
    // Explicitly purge the localStorage cache so there is zero chance of demo
    // data or stale prod data being shown after login.
    try {
      localStorage.removeItem(STORAGE_KEYS.cache);
      localStorage.removeItem(STORAGE_KEYS.sha);
      localStorage.removeItem(STORAGE_KEYS.prices);
      localStorage.removeItem(STORAGE_KEYS.pricesSha);
      sessionStorage.removeItem(STORAGE_KEYS.demo); // demo flag — stop auto-entering demo on nav
    } catch (e) {}
    await this.refresh(); // fetch fresh production data from GitHub
  },

  async save(message) {
    if (_guest) return { ok: true, noop: true }; // hard block — demo mode cannot save
    if (!_dirty && !pricesChanged()) return { ok: true, noop: true };
    _loading = true; _error = null; notify();
    try {
      const msg = message || commitMessage();

      // Prices first, and merged per-ticker on conflict: if the bot wrote a new
      // price while the user was editing another ticker, both survive.
      if (pricesChanged()) {
        _pricesSha = await savePrices(msg);
        _pricesClean = JSON.stringify(_prices || {});
      }

      if (_dirty) {
        const payload = dataForSave();
        _sha = await saveData(payload, msg);
        _dataClean = JSON.stringify(payload);
        _dirty = false;
      }

      undoStack.length = 0;
      _labels = [];
      cacheWriteClean();
      return { ok: true };
    } catch (e) {
      _error = e.message;
      return { ok: false, error: e.message };
    } finally {
      _loading = false;
      notify();
    }
  },
};

// Write stock-prices.json, merging on conflict. Per-ticker merge is unambiguous:
// start from whatever is on the server now, then re-apply the tickers this
// session actually changed.
async function savePrices(message) {
  try {
    return await putPrices(_prices, _pricesSha, message);
  } catch (e) {
    if (!e.conflict) throw e;
    const base = JSON.parse(_pricesClean);
    const remote = await fetchPrices();
    const merged = { ...(remote.data || {}) };
    for (const [ticker, price] of Object.entries(_prices || {})) {
      if (base[ticker] !== price) merged[ticker] = price; // ours changed — ours wins
    }
    for (const ticker of Object.keys(base)) {
      if (!(ticker in (_prices || {}))) delete merged[ticker]; // we removed it
    }
    _prices = merged;
    applyPrices();
    return await putPrices(_prices, remote.sha, message);
  }
}

// Write data.json. Retries ONLY the provably safe conflict: the sha moved but
// the content is byte-identical to what we started from (empty commit, force
// push, a no-op write from another tab). A real concurrent edit is NOT merged
// behind the user's back — it surfaces as an error, with the draft kept.
async function saveData(payload, message) {
  try {
    return await putData(payload, _sha, message);
  } catch (e) {
    if (!e.conflict) throw e;
    const remote = await fetchData();
    const remoteClean = { ...(remote.data || {}) };
    delete remoteClean.stock_prices;
    if (_dataClean !== null && JSON.stringify(remoteClean) === _dataClean) {
      return await putData(payload, remote.sha, message);
    }
    throw e;
  }
}

// Convenience: short unique id
export function uid() {
  return Math.random().toString(36).slice(2, 10);
}
