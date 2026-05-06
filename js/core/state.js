// Single source of truth for the loaded data.json in memory.
// Pages import { state } and subscribe with state.subscribe(fn).

import { STORAGE_KEYS, emptyData, hasCreds } from './config.js';
import { fetchData, putData } from './github.js';

const listeners = new Set();
const undoStack = [];
const MAX_UNDO = 50;

let _data = null;
let _sha = null;
let _dirty = false;
let _loading = false;
let _error = null;

function notify() {
  for (const fn of listeners) {
    try { fn(snapshot()); } catch (e) { console.error(e); }
  }
}

function snapshot() {
  return { data: _data, sha: _sha, dirty: _dirty, loading: _loading, error: _error };
}

function cacheWrite() {
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
    fn(_data);
    _data.updated_at = new Date().toISOString();
    _dirty = true;
    cacheWrite();
    notify();
  },

  undo() {
    const last = undoStack.pop();
    if (!last) return null;
    _data = last.snapshot;
    _dirty = true;
    cacheWrite();
    notify();
    return last.label; // return label so UI can show what was undone
  },

  canUndo() { return undoStack.length > 0; },

  async save(message) {
    if (!_dirty) return { ok: true, noop: true };
    _loading = true; _error = null; notify();
    try {
      const newSha = await putData(_data, _sha, message);
      _sha = newSha;
      _dirty = false;
      undoStack.length = 0;
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
