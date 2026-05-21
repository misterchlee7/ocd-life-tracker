import { state } from '../core/state.js';
import { bootstrap, showBottomSheet, toast } from '../core/ui.js';
import { todayISO, shortDate, relativeDays, daysFromToday } from '../core/dates.js';

const page = document.getElementById('page');

const ui = { filter: 'open' };

const CATEGORIES = ['buy', 'do', 'contact', 'misc'];
const CAT_LABELS = { buy: 'Buy', do: 'Do', contact: 'Contact', misc: 'Misc' };
const CAT_ICONS  = { buy: '🛒', do: '✅', contact: '📞', misc: '📌' };
const STATUS_LABELS = { open: 'Open', in_progress: 'In progress', done: 'Done', snoozed: 'Snoozed', dropped: 'Dropped' };

function itemCategory(t) {
  return CATEGORIES.includes(t.category) ? t.category : 'misc';
}

function isDone(t) { return t.status === 'done' || t.status === 'dropped'; }

function filteredItems(data) {
  const items = data.backlog.filter(t => {
    if (ui.filter === 'open') return !isDone(t);
    if (ui.filter === 'done') return isDone(t);
    return true;
  });
  return items;
}

function escapeHTML(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- HTML builders ----------

function summaryStripHTML(data) {
  const open = data.backlog.filter(t => t.status === 'open' || t.status === 'in_progress');
  const overdue = open.filter(t => t.due_date && daysFromToday(t.due_date) < 0);
  const dueSoon = open.filter(t => { const d = daysFromToday(t.due_date); return t.due_date && d >= 0 && d <= 7; });
  const snoozedDue = data.backlog.filter(t => t.status === 'snoozed' && t.snoozed_until && daysFromToday(t.snoozed_until) <= 0);

  return `
    <div class="m-summary-strip">
      <div class="m-summary-card">
        <div class="label">Open</div>
        <div class="value">${open.length}</div>
      </div>
      <div class="m-summary-card">
        <div class="label">Overdue</div>
        <div class="value ${overdue.length ? 'warn' : ''}">${overdue.length}</div>
      </div>
      <div class="m-summary-card">
        <div class="label">Due ≤ 7d</div>
        <div class="value">${dueSoon.length}</div>
      </div>
      ${snoozedDue.length ? `
        <div class="m-summary-card">
          <div class="label">Snooze expired</div>
          <div class="value warn">${snoozedDue.length}</div>
        </div>` : ''}
    </div>
  `;
}

function filterBarHTML() {
  const chip = (val, label) =>
    `<button class="m-chip ${ui.filter === val ? 'active' : ''}" data-filter="${val}">${label}</button>`;
  return `
    <div class="m-filter-bar">
      ${chip('open', 'Open')}
      ${chip('done', 'Done')}
      ${chip('all', 'All')}
    </div>
  `;
}

function statusPillHTML(status) {
  const cls = { open: 's-unpaid', in_progress: 's-scheduled', done: 's-paid', snoozed: 's-skipped', dropped: 's-skipped' }[status] || 's-unpaid';
  return `<span class="status ${cls}">${STATUS_LABELS[status] || status}</span>`;
}

function taskCardHTML(task) {
  const done = isDone(task);
  const due = task.due_date;
  const dueDays = due ? daysFromToday(due) : null;
  const dueCls = dueDays != null && dueDays < 0 ? 'warn' : '';
  const dueText = due
    ? `<span class="${dueCls}" style="font-size:11px">${shortDate(due)} ${relativeDays(due)}</span>`
    : '';
  const tags = (task.tags || []).map(tag => `<span class="pill type tiny">${escapeHTML(tag)}</span>`).join(' ');

  return `
    <div class="m-card ${done ? 'backlog-done' : ''}" data-id="${task.id}" style="${done ? 'opacity:0.6' : ''}">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <input type="checkbox" data-check="${task.id}" ${done ? 'checked' : ''} style="margin-top:3px;flex-shrink:0;width:18px;height:18px;cursor:pointer">
        <div style="flex:1;min-width:0">
          <div class="m-card-name" style="${done ? 'text-decoration:line-through;color:var(--text-muted)' : ''}">${escapeHTML(task.title)}</div>
          ${task.notes ? `<div class="m-card-name-sub">${escapeHTML(task.notes)}</div>` : ''}
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px">
            ${statusPillHTML(task.status)}
            ${dueText}
            ${tags}
          </div>
        </div>
        <button class="m-dots-btn" data-dots="${task.id}">⋯</button>
      </div>
    </div>
  `;
}

// ---------- render ----------

function render({ data, loading }) {
  if (!data) {
    page.innerHTML = loading
      ? `<div class="m-empty"><div class="m-empty-icon">⏳</div><div class="m-empty-msg">Loading…</div></div>`
      : `<div class="m-empty"><div class="m-empty-icon">🔌</div><div class="m-empty-msg">Not connected</div></div>`;
    return;
  }

  const snoozedDue = data.backlog.filter(t => t.status === 'snoozed' && t.snoozed_until && daysFromToday(t.snoozed_until) <= 0);
  const snoozeBanner = snoozedDue.length
    ? `<div class="nag" style="margin-bottom:10px">⏰ <b>${snoozedDue.length} snoozed task${snoozedDue.length !== 1 ? 's' : ''} ready to resurface</b> — ${escapeHTML(snoozedDue[0].title)}</div>`
    : '';

  const items = filteredItems(data);
  const byCat = CATEGORIES.map(cat => ({
    cat,
    items: items.filter(t => itemCategory(t) === cat),
  })).filter(g => g.items.length > 0);

  const listHTML = items.length === 0
    ? `<div class="m-empty"><div class="m-empty-icon">✅</div><div class="m-empty-msg">All clear!</div><div class="m-empty-sub">Nothing here right now.</div></div>`
    : byCat.map(({ cat, items: catItems }) => `
        <div class="m-section-hdr">${CAT_ICONS[cat]} ${CAT_LABELS[cat]}</div>
        <div class="m-list">${catItems.map(t => taskCardHTML(t)).join('')}</div>
      `).join('');

  page.innerHTML = summaryStripHTML(data) + snoozeBanner + filterBarHTML() + listHTML;
  wireInteractions(data);
}

// ---------- interactions ----------

function wireInteractions(data) {
  page.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      ui.filter = btn.dataset.filter;
      render(state.get());
    });
  });

  page.querySelectorAll('[data-check]').forEach(chk => {
    chk.addEventListener('change', () => {
      const id = chk.dataset.check;
      state.mutate(d => {
        const t = d.backlog.find(x => x.id === id);
        if (!t) return;
        if (chk.checked) { t.status = 'done'; t.done_date = todayISO(); }
        else { t.status = 'open'; t.done_date = null; }
      }, 'toggle task');
      if (chk.checked) toast('Done ✓', 'success');
    });
  });

  page.querySelectorAll('[data-dots]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTaskSheet(btn.dataset.dots);
    });
  });
}

function openTaskSheet(taskId) {
  const { data } = state.get();
  const task = data.backlog.find(t => t.id === taskId);
  if (!task) return;

  showBottomSheet({
    title: task.title,
    items: [
      task.status !== 'in_progress' && !isDone(task) ? {
        icon: '▶️', label: 'Start (in progress)',
        action: () => {
          state.mutate(d => { const t = d.backlog.find(x => x.id === taskId); if (t) t.status = 'in_progress'; }, 'start task');
        },
      } : null,
      task.status !== 'done' ? {
        icon: '✅', label: 'Mark done',
        action: () => {
          state.mutate(d => {
            const t = d.backlog.find(x => x.id === taskId);
            if (t) { t.status = 'done'; t.done_date = todayISO(); }
          }, 'done task');
          toast(`Done: ${task.title}`, 'success');
        },
      } : null,
      {
        icon: '⏰', label: 'Snooze 1 week',
        action: () => {
          const until = addDays(todayISO(), 7);
          state.mutate(d => {
            const t = d.backlog.find(x => x.id === taskId);
            if (t) { t.status = 'snoozed'; t.snoozed_until = until; }
          }, 'snooze task');
          toast(`Snoozed: ${task.title}`, 'info');
        },
      },
      task.status !== 'open' ? {
        icon: '↺', label: 'Reopen',
        action: () => {
          state.mutate(d => {
            const t = d.backlog.find(x => x.id === taskId);
            if (t) { t.status = 'open'; t.done_date = null; t.snoozed_until = null; }
          }, 'reopen task');
        },
      } : null,
      {
        icon: '🚫', label: 'Drop', danger: true,
        action: () => {
          state.mutate(d => { const t = d.backlog.find(x => x.id === taskId); if (t) t.status = 'dropped'; }, 'drop task');
        },
      },
    ].filter(Boolean),
  });
}

// ---------- boot ----------

export function init() {
  state.subscribe(render);
  bootstrap();
}
