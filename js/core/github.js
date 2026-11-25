// Minimal GitHub REST client for read/write of a single JSON file.
// We use /contents because it gives us both read and write with a sha-based
// optimistic concurrency check — which is exactly what we want for a single
// JSON file acting as a database.

import { getCreds, DEFAULTS } from './config.js';

const API = 'https://api.github.com';

function headers() {
  const { pat } = getCreds();
  return {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Authorization': `Bearer ${pat}`,
  };
}

function b64encode(str) {
  // handle unicode safely
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decode(str) {
  return decodeURIComponent(escape(atob(str)));
}

function contentsUrl(path) {
  const { owner, repo, branch } = getCreds();
  return `${API}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`;
}

// Turn a GitHub API failure into a message that tells the user what to DO,
// not just what status code came back.
function friendlyError(status, body, verb) {
  if (status === 401) {
    return 'GitHub rejected the token (401) — it has probably expired. Open Settings (⚙) and paste a fresh PAT.';
  }
  if (status === 403) {
    return 'GitHub says forbidden (403) — check the PAT still has Contents read & write on the data repo (or you hit a rate limit; wait a minute).';
  }
  if (status === 404) {
    return 'Repo or file not found (404) — check owner / repo / branch in Settings (⚙).';
  }
  if (status === 409 || (status === 422 && /sha/i.test(body))) {
    // Deliberately does NOT tell the user to hit Refresh: Refresh used to
    // overwrite the unsaved edits it was meant to rescue. state.save() now
    // retries conflicts on its own, so reaching this text means the retry
    // also failed — i.e. a genuine concurrent edit worth looking at.
    return 'Save conflict — the file changed in GitHub while you were editing, and an automatic merge was not possible. Your edits are still here and kept safe locally; use Settings (⚙) → Download backup before doing anything else.';
  }
  return `GitHub ${verb} failed: ${status} ${body}`;
}

// Returns { data, sha } or { data: null, sha: null } if the file doesn't exist.
export async function fetchFile(path) {
  const res = await fetch(contentsUrl(path), { headers: headers() });
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) throw new Error(friendlyError(res.status, await res.text(), 'GET'));
  const json = await res.json();
  const decoded = b64decode(json.content.replace(/\n/g, ''));
  return { data: JSON.parse(decoded), sha: json.sha };
}

export function fetchData()   { return fetchFile(DEFAULTS.dataPath); }
export function fetchPrices() { return fetchFile(DEFAULTS.pricesPath); }

// Writes `path` with the given sha (null if creating).
// Returns the new sha on success.
export async function putFile(path, data, sha, message) {
  const { branch } = getCreds();
  const body = {
    message: message || `update data.json — ${new Date().toISOString()}`,
    content: b64encode(JSON.stringify(data, null, 2)),
    branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(contentsUrl(path).split('?')[0], {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(friendlyError(res.status, text, 'PUT'));
    err.status = res.status;          // state.save() keys its conflict retry off this
    err.conflict = res.status === 409 || (res.status === 422 && /sha/i.test(text));
    throw err;
  }
  const json = await res.json();
  return json.content.sha;
}

export function putData(data, sha, message) {
  return putFile(DEFAULTS.dataPath, data, sha, message);
}
export function putPrices(prices, sha, message) {
  return putFile(DEFAULTS.pricesPath, prices, sha, message);
}

// Quick credentials/connectivity check. Returns { ok, message }.
export async function ping() {
  try {
    const { owner, repo } = getCreds();
    const res = await fetch(`${API}/repos/${owner}/${repo}`, { headers: headers() });
    if (res.status === 200) return { ok: true, message: 'connected' };
    if (res.status === 401) return { ok: false, message: 'bad PAT (401)' };
    if (res.status === 403) return { ok: false, message: 'forbidden — check PAT scopes (403)' };
    if (res.status === 404) return { ok: false, message: 'repo not found — check owner/repo name' };
    return { ok: false, message: `unexpected ${res.status}` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
