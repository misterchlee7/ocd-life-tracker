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

function contentsUrl() {
  const { owner, repo, branch } = getCreds();
  return `${API}/repos/${owner}/${repo}/contents/${DEFAULTS.dataPath}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`;
}

// Returns { data, sha } or { data: null, sha: null } if the file doesn't exist.
export async function fetchData() {
  const res = await fetch(contentsUrl(), { headers: headers() });
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const decoded = b64decode(json.content.replace(/\n/g, ''));
  return { data: JSON.parse(decoded), sha: json.sha };
}

// Writes data.json with the given sha (null if creating).
// Returns the new sha on success.
export async function putData(data, sha, message) {
  const { branch } = getCreds();
  const body = {
    message: message || `update data.json — ${new Date().toISOString()}`,
    content: b64encode(JSON.stringify(data, null, 2)),
    branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(contentsUrl().split('?')[0], {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub PUT failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.content.sha;
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
