// Single source of truth for the loaded data.json in memory.
// Pages import { state } and subscribe with state.subscribe(fn).

import { STORAGE_KEYS, emptyData, hasCreds } from './config.js';
import { fetchData, putData } from './github.js';

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

function notify() {
  for (const fn of listeners) {
    try { fn(snapshot()); } catch (e) { console.error(e); }
  }
}

function snapshot() {
  return { data: _data, sha: _sha, dirty: _dirty, loading: _loading, error: _error, guest: _guest };
}

function cacheWrite() {
  if (_guest) return; // NEVER write demo data to localStorage
  try {
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(_data));
    if (_sha) localStorage.setItem(STORAGE_KEYS.sha, _sha);
  } catch (e) { console.warn('cache write failed', e); }
}

function cacheRead() {
  const raw = localStorage.getItem(STORAGE_KEYS.cache);
  const sha = localStorage.getItem(STORAGE_KEYS.sha);
  if (!raw) return null;
  try { return { data: JSON.parse(raw), sha }; } catch { return null; }
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
      const { data, sha } = await fetchData();
      if (data === null) {
        // file doesn't exist yet in the data repo — bootstrap with empty
        _data = emptyData();
        _sha = null;  // null sha means "create on first save"
      } else {
        _data = data;
        _sha = sha;
      }
      _dirty = false;
      _labels = [];
      cacheWrite();
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
    undoStack.push({ label: label || 'edit', snapshot: structuredClone(_data) });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    _labels.push(label || 'edit');
    fn(_data);
    _data.updated_at = new Date().toISOString();
    if (!_guest) {
      if (!_data.history) _data.history = [];
      _data.history.push({ ts: _data.updated_at, label: label || 'edit' });
      if (_data.history.length > 500) _data.history.splice(0, _data.history.length - 500);
      _dirty = true;
      cacheWrite(); // cacheWrite also guards on _guest, but belt-and-suspenders
    }
    notify();
  },

  undo() {
    const last = undoStack.pop();
    if (!last) return null;
    _data = last.snapshot; // snapshot pre-dates this mutation's history.push, so data.history reverts too
    if (_labels.length) _labels.pop(); // the undone mutation no longer belongs in the commit message
    _dirty = true;
    cacheWrite();
    notify();
    return last.label; // return label so UI can show what was undone
  },

  canUndo() { return undoStack.length > 0; },

  // Load hardcoded demo data into memory. Nothing is written to localStorage or GitHub.
  enterGuestMode(data) {
    _guest = true;
    _data = structuredClone(data); // defensive clone so demo-data.js object stays pristine
    _sha = null;
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
    } catch (e) {}
    await this.refresh(); // fetch fresh production data from GitHub
  },

  async save(message) {
    if (_guest) return { ok: true, noop: true }; // hard block — demo mode cannot save
    if (!_dirty) return { ok: true, noop: true };
    _loading = true; _error = null; notify();
    try {
      const newSha = await putData(_data, _sha, message || commitMessage());
      _sha = newSha;
      _dirty = false;
      undoStack.length = 0;
      _labels = [];
      cacheWrite();
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

// Convenience: short unique id
export function uid() {
  return Math.random().toString(36).slice(2, 10);
}
