import { bootstrap } from '../core/ui.js';
import { state } from '../core/state.js';
import { escapeHTML } from '../core/text.js';

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
}

function dateLabel(d) {
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (d === today)     return 'Today';
  if (d === yesterday) return 'Yesterday';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function render({ data }) {
  const page = document.getElementById('page');
  if (!data) { page.innerHTML = ''; return; }

  const entries = [...(data.history || [])].reverse(); // newest first

  if (entries.length === 0) {
    page.innerHTML = `
      <div class="history-header">
        <h1>Activity History</h1>
      </div>
      <div class="history-empty">No activity recorded yet. Changes you make will appear here.</div>
    `;
    return;
  }

  // Group by calendar date
  const groups = new Map();
  for (const e of entries) {
    const date = new Date(e.ts).toISOString().slice(0, 10);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(e);
  }

  const groupsHTML = [...groups.entries()].map(([date, rows]) => `
    <div class="history-group">
      <div class="history-date">${dateLabel(date)}</div>
      ${rows.map(e => `
        <div class="history-entry">
          <span class="history-time">${fmtTime(e.ts)}</span>
          <span class="history-label">${escapeHTML(e.label)}</span>
        </div>
      `).join('')}
    </div>
  `).join('');

  const cap = entries.length === 500 ? ' (capped at 500)' : '';
  page.innerHTML = `
    <div class="history-header">
      <h1>Activity History</h1>
      <div class="history-header-sub">${entries.length} entries${cap}</div>
    </div>
    <div class="history-list">${groupsHTML}</div>
  `;
}

// Subscribe before bootstrap (matches every other page) — bootstrap() shows the
// landing screen and returns early when there are no creds, but "Try Demo" calls
// state.enterGuestMode() directly afterward. Subscribing first means this page
// still picks up that guest-mode data instead of never rendering.
state.subscribe(render);
bootstrap();
