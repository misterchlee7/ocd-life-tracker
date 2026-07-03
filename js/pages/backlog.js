import { state, uid } from '../core/state.js';
import { bootstrap, isMobile, toast, confirmModal, closeOnEscape } from '../core/ui.js';
import { todayISO, shortDate, relativeDays, daysFromToday } from '../core/dates.js';
import {
  escapeHTML, escapeAttr,
  BACKLOG_CATEGORIES as CATEGORIES, BACKLOG_CAT_LABELS as CAT_LABELS, BACKLOG_CAT_ICONS as CAT_ICONS,
  BACKLOG_STATUSES as STATUSES, BACKLOG_STATUS_LABELS as STATUS_LABELS,
} from '../core/text.js';

const page = document.getElementById('page');

const ui = {
  search: '',
  showDone: false,
  openMenuId: null,
};

// Items without a category default to 'misc'
function itemCategory(t) { return CATEGORIES.includes(t.category) ? t.category : 'misc'; }

function isDone(t) { return t.status === 'done' || t.status === 'dropped'; }

function filterItems(data, cat) {
  const q = ui.search.trim().toLowerCase();
  return data.backlog.filter(t => {
    if (itemCategory(t) !== cat) return false;
    if (!ui.showDone && isDone(t)) return false;
    if (q && !(`${t.title} ${t.notes || ''} ${(t.tags || []).join(' ')}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

// ---------- render ----------

function render({ data, loading }) {
  if (!data) {
    page.innerHTML = loading
      ? `<div class="empty"><h3>Loading…</h3></div>`
      : `<div class="empty"><h3>Not connected</h3><p>Open settings (⚙) to configure your GitHub data repo.</p></div>`;
    return;
  }

  const openItems = data.backlog.filter(t => t.status === 'open' || t.status === 'in_progress');
  const overdue   = openItems.filter(t => t.due_date && daysFromToday(t.due_date) < 0);
  const dueSoon   = openItems.filter(t => { const d = daysFromToday(t.due_date); return t.due_date && d >= 0 && d <= 7; });
  const snoozedDue = data.backlog.filter(t => t.status === 'snoozed' && t.snoozed_until && daysFromToday(t.snoozed_until) <= 0);

  page.innerHTML = `
    ${summaryHTML({ open: openItems.length, overdue, dueSoon, snoozedDue })}
    ${snoozedDue.length ? snoozeBannerHTML(snoozedDue) : ''}
    ${filtersHTML()}
    <div class="backlog-grid">
      ${CATEGORIES.map(cat => categorySectionHTML(data, cat)).join('')}
    </div>
  `;

  wireInteractions(data);
}

function summaryHTML({ open, overdue, dueSoon, snoozedDue }) {
  return `
    <div class="summary">
      <div class="card">
        <div class="label">Open tasks</div>
        <div class="value">${open}</div>
        <div class="sub">open + in progress</div>
      </div>
      <div class="card">
        <div class="label">Overdue</div>
        <div class="value ${overdue.length ? 'warn' : ''}">${overdue.length}</div>
        <div class="sub">${overdue.length ? 'past due date' : 'all on track'}</div>
      </div>
      <div class="card">
        <div class="label">Due ≤ 7d</div>
        <div class="value">${dueSoon.length}</div>
        <div class="sub">upcoming week</div>
      </div>
      <div class="card">
        <div class="label">Snooze expired</div>
        <div class="value ${snoozedDue.length ? 'warn' : ''}">${snoozedDue.length}</div>
        <div class="sub">ready to resurface</div>
      </div>
    </div>
  `;
}

function snoozeBannerHTML(items) {
  const first = items[0];
  return `
    <div class="nag">
      ⏰ <b>${items.length} snoozed task${items.length === 1 ? '' : 's'} ready to resurface.</b>
      ${escapeHTML(first.title)}${items.length > 1 ? ` · +${items.length - 1} more` : ''}
    </div>
  `;
}

function filtersHTML() {
  return `
    <div class="filters">
      <label class="search">
        <input id="f-search" placeholder="Search tasks…" value="${escapeAttr(ui.search)}"/>
      </label>
      <label class="chip ${ui.showDone ? 'active' : ''}" style="cursor:pointer">
        <input type="checkbox" id="f-show-done" ${ui.showDone ? 'checked' : ''} style="display:none"> Show done/dropped
      </label>
    </div>
  `;
}

function categorySectionHTML(data, cat) {
  const items = filterItems(data, cat);
  const totalInCat = data.backlog.filter(t => itemCategory(t) === cat && !isDone(t)).length;
  return `
    <div class="backlog-section" data-cat="${cat}">
      <div class="backlog-section-hdr">
        <span class="backlog-section-icon">${CAT_ICONS[cat]}</span>
        <span class="backlog-section-title">${CAT_LABELS[cat]}</span>
        ${totalInCat > 0 ? `<span class="backlog-count">${totalInCat}</span>` : ''}
        <span style="flex:1"></span>
        <button class="btn primary backlog-add-btn" data-add-cat="${cat}">+ Add</button>
      </div>
      ${items.length === 0
        ? `<div class="backlog-empty">Nothing here</div>`
        : `<div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style="width:24px"></th>
                  <th style="width:28px"></th>
                  <th>Task</th>
                  <th>Tags</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody data-tbody-cat="${cat}">
                ${items.map(t => rowHTML(t)).join('')}
              </tbody>
            </table>
           </div>`
      }
    </div>
  `;
}

function rowHTML(t) {
  const done = isDone(t);
  const due = t.due_date;
  const dueDays = due ? daysFromToday(due) : null;
  const dueCls = dueDays != null && dueDays < 0 ? 'warn' : '';
  const dueCell = due
    ? `${shortDate(due)} <span class="cell-amount-sub ${dueCls}">${relativeDays(due)}</span>`
    : '—';
  const tags = (t.tags || []).map(tag => `<span class="tag">${escapeHTML(tag)}</span>`).join(' ');
  return `
    <tr data-id="${t.id}" draggable="true" class="${done ? 'backlog-done' : ''}">
      <td class="drag-handle" title="Drag to reorder">⠿</td>
      <td style="text-align:center"><input type="checkbox" data-check="${t.id}" ${done ? 'checked' : ''}></td>
      <td style="${done ? 'text-decoration:line-through;color:var(--text-muted)' : ''}">
        <b>${escapeHTML(t.title)}</b>
        ${t.notes ? `<div class="cell-amount-sub">${escapeHTML(t.notes)}</div>` : ''}
      </td>
      <td>${tags || '—'}</td>
      <td>${dueCell}</td>
      <td>${statusPill(t.status)}</td>
      <td class="row-actions">
        <button class="del" data-del="${t.id}" title="Delete">✕</button>
        <button class="dots" data-menu="${t.id}">⋯</button>
        ${ui.openMenuId === t.id ? menuHTML(t) : ''}
      </td>
    </tr>
  `;
}

function statusPill(s) {
  const cls = {
    open: 's-unpaid', in_progress: 's-scheduled',
    done: 's-paid', snoozed: 's-skipped', dropped: 's-skipped',
  }[s] || 's-unpaid';
  return `<span class="status ${cls}">${STATUS_LABELS[s] || s}</span>`;
}

function menuHTML(t) {
  return `
    <div class="menu" data-id="${t.id}">
      <div class="menu-item" data-act="edit"><div class="title">✏️ Edit</div></div>
      ${t.status !== 'in_progress' ? `<div class="menu-item" data-act="start"><div class="title">▶️ Start (in progress)</div></div>` : ''}
      ${t.status !== 'done' ? `<div class="menu-item" data-act="done"><div class="title">✅ Mark done</div></div>` : ''}
      <div class="menu-item" data-act="snooze"><div class="title">⏰ Snooze…</div></div>
      ${t.status !== 'open' ? `<div class="menu-item" data-act="reopen"><div class="title">↺ Reopen</div></div>` : ''}
      <div class="menu-sep"></div>
      <div class="menu-item" data-act="drop"><div class="title">🚫 Drop</div></div>
      <div class="menu-item danger" data-act="delete"><div class="title">🗑️ Delete</div></div>
    </div>
  `;
}

// ---------- interactions ----------

function wireInteractions(data) {
  document.getElementById('f-search')?.addEventListener('input', (e) => {
    ui.search = e.target.value; render(state.get());
    document.getElementById('f-search').focus();
  });
  document.getElementById('f-show-done')?.addEventListener('change', (e) => {
    ui.showDone = e.target.checked; render(state.get());
  });

  // Per-category add buttons
  page.querySelectorAll('[data-add-cat]').forEach(btn => {
    btn.addEventListener('click', () => openTaskForm(null, btn.dataset.addCat));
  });

  // Done checkboxes
  page.querySelectorAll('[data-check]').forEach(chk => {
    chk.addEventListener('change', () => {
      const task = state.get().data?.backlog.find(x => x.id === chk.dataset.check);
      state.mutate(d => {
        const t = d.backlog.find(x => x.id === chk.dataset.check);
        if (!t) return;
        if (chk.checked) { t.status = 'done'; t.done_date = todayISO(); }
        else { t.status = 'open'; t.done_date = null; }
      }, chk.checked ? `done task: ${task?.title}` : `reopen task: ${task?.title}`);
    });
  });

  // Delete buttons
  page.querySelectorAll('button.del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      const t = state.get().data?.backlog.find(x => x.id === id);
      if (!t) return;
      confirmModal({
        title: 'Delete task',
        message: `Delete "${t.title}"?`,
        confirmLabel: 'Delete',
        danger: true,
        onConfirm: () => {
          state.mutate(d => { d.backlog = d.backlog.filter(x => x.id !== id); }, `delete ${t.title}`);
          toast(`Deleted: ${t.title}`, 'info');
        },
      });
    });
  });

  // 3-dot menus
  page.querySelectorAll('[data-menu]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      ui.openMenuId = ui.openMenuId === btn.dataset.menu ? null : btn.dataset.menu;
      render(state.get());
    });
  });
  page.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = item.closest('.menu')?.dataset.id;
      if (!id) return;
      handleMenuAction(id, item.dataset.act);
      ui.openMenuId = null;
      render(state.get());
    });
  });
  if (ui.openMenuId) {
    document.addEventListener('click', () => { ui.openMenuId = null; render(state.get()); }, { once: true });
  }

  // Flip overflow menus
  page.querySelectorAll('.menu').forEach(menu => {
    if (menu.getBoundingClientRect().bottom > window.innerHeight - 8) menu.classList.add('menu-up');
  });

  // ---------- drag-to-reorder within each category tbody ----------
  let dragSrcId = null;

  page.querySelectorAll('tr[draggable]').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragSrcId = row.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragSrcId);
      requestAnimationFrame(() => row.classList.add('dragging'));
    });

    row.addEventListener('dragover', e => {
      e.preventDefault();
      if (row.dataset.id === dragSrcId) return;
      // Only allow within same tbody (same category)
      const srcRow = page.querySelector(`tr[data-id="${dragSrcId}"]`);
      if (!srcRow || srcRow.closest('tbody') !== row.closest('tbody')) return;
      e.dataTransfer.dropEffect = 'move';
      const { top, height } = row.getBoundingClientRect();
      if (e.clientY < top + height / 2) {
        row.classList.add('drag-over-before');
        row.classList.remove('drag-over-after');
      } else {
        row.classList.add('drag-over-after');
        row.classList.remove('drag-over-before');
      }
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over-before', 'drag-over-after');
    });

    row.addEventListener('drop', e => {
      e.preventDefault();
      const tgtId = row.dataset.id;
      if (!dragSrcId || tgtId === dragSrcId) return;
      const srcRow = page.querySelector(`tr[data-id="${dragSrcId}"]`);
      if (!srcRow || srcRow.closest('tbody') !== row.closest('tbody')) return;

      const before = row.classList.contains('drag-over-before');
      row.classList.remove('drag-over-before', 'drag-over-after');

      state.mutate(d => {
        const srcIdx = d.backlog.findIndex(x => x.id === dragSrcId);
        if (srcIdx === -1) return;
        const [item] = d.backlog.splice(srcIdx, 1);
        const tgtIdx = d.backlog.findIndex(x => x.id === tgtId);
        if (tgtIdx === -1) { d.backlog.push(item); return; }
        d.backlog.splice(before ? tgtIdx : tgtIdx + 1, 0, item);
      }, 'reorder tasks');
    });

    row.addEventListener('dragend', () => {
      page.querySelectorAll('tr').forEach(r => r.classList.remove('dragging', 'drag-over-before', 'drag-over-after'));
      dragSrcId = null;
    });
  });
}

// ---------- menu actions ----------

function handleMenuAction(id, act) {
  const t = state.get().data?.backlog.find(x => x.id === id);
  if (!t) return;

  switch (act) {
    case 'edit': openTaskForm(t); break;
    case 'start':
      state.mutate(d => { const x = d.backlog.find(y => y.id === id); if (x) x.status = 'in_progress'; }, `start task: ${t.title}`);
      break;
    case 'done':
      state.mutate(d => {
        const x = d.backlog.find(y => y.id === id);
        if (x) { x.status = 'done'; x.done_date = todayISO(); }
      }, `done task: ${t.title}`);
      toast(`Done: ${t.title}`, 'success');
      break;
    case 'snooze': {
      const until = prompt('Snooze until (YYYY-MM-DD)', addDays(todayISO(), 7));
      if (!until) return;
      state.mutate(d => {
        const x = d.backlog.find(y => y.id === id);
        if (x) { x.status = 'snoozed'; x.snoozed_until = until; }
      }, `snooze task: ${t.title} until ${until}`);
      toast(`Snoozed: ${t.title}`, 'info');
      break;
    }
    case 'reopen':
      state.mutate(d => {
        const x = d.backlog.find(y => y.id === id);
        if (x) { x.status = 'open'; x.done_date = null; x.snoozed_until = null; }
      }, `reopen task: ${t.title}`);
      break;
    case 'drop':
      state.mutate(d => { const x = d.backlog.find(y => y.id === id); if (x) x.status = 'dropped'; }, `drop task: ${t.title}`);
      break;
    case 'delete':
      confirmModal({
        title: 'Delete task',
        message: `Delete "${t.title}"?`,
        confirmLabel: 'Delete',
        danger: true,
        onConfirm: () => {
          state.mutate(d => { d.backlog = d.backlog.filter(x => x.id !== id); }, `delete task: ${t.title}`);
          toast(`Deleted: ${t.title}`, 'info');
        },
      });
      break;
  }
}

// ---------- form ----------

function openTaskForm(existing, defaultCat = 'do') {
  const isEdit = !!existing;
  const t = existing || {
    id: uid(), title: '', category: defaultCat, tags: [],
    due_date: null, status: 'open', snoozed_until: null, done_date: null,
    related: { bill_id: null, perk_id: null, subscription_id: null }, notes: '',
  };
  const currentCat = itemCategory(t);

  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `
    <div class="modal modal-lg">
      <h2>${isEdit ? 'Edit task' : 'Add task'}</h2>
      <div class="form-grid">
        <label class="field full"><span>Title</span><input id="f-title" value="${escapeAttr(t.title)}" placeholder="What needs to happen?"/></label>
        <label class="field"><span>Category</span>
          <select id="f-cat-in">
            ${CATEGORIES.map(c => `<option value="${c}" ${currentCat === c ? 'selected' : ''}>${CAT_LABELS[c]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Status</span>
          <select id="f-status-in">
            ${STATUSES.map(s => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Due date</span><input id="f-due" type="date" value="${t.due_date || ''}"/></label>
        <label class="field full"><span>Tags (comma-separated)</span><input id="f-tags" value="${escapeAttr((t.tags || []).join(', '))}" placeholder="house, insurance"/></label>
        <label class="field full"><span>Notes</span><input id="f-notes" value="${escapeAttr(t.notes || '')}"/></label>
      </div>
      <div class="modal-actions">
        <button class="btn" id="f-cancel">Cancel</button>
        <span style="flex:1"></span>
        <button class="btn primary" id="f-save">${isEdit ? 'Save' : 'Add'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  el.querySelector('#f-cancel').onclick = () => el.remove();
  el.addEventListener('click', (e) => { if (e.target === el) el.remove(); });
  closeOnEscape(el);
  el.querySelector('#f-save').onclick = () => {
    const tagsStr = el.querySelector('#f-tags').value.trim();
    const patch = {
      title:    el.querySelector('#f-title').value.trim(),
      category: el.querySelector('#f-cat-in').value,
      status:   el.querySelector('#f-status-in').value,
      due_date: el.querySelector('#f-due').value || null,
      tags:     tagsStr ? tagsStr.split(',').map(s => s.trim()).filter(Boolean) : [],
      notes:    el.querySelector('#f-notes').value.trim(),
    };
    if (!patch.title) { toast('Title is required', 'error'); return; }
    state.mutate(d => {
      if (isEdit) {
        const idx = d.backlog.findIndex(x => x.id === t.id);
        if (idx >= 0) d.backlog[idx] = { ...d.backlog[idx], ...patch };
      } else {
        d.backlog.push({ ...t, ...patch });
      }
    }, isEdit ? `edit task: ${patch.title}` : `add task: ${patch.title}`);
    el.remove();
    toast(isEdit ? `Updated: ${patch.title}` : `Added: ${patch.title}`, 'success');
  };
}

// ---------- utils ----------

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
if (isMobile()) {
  import('./backlog-mobile.js').then(m => m.init());
} else {
  state.subscribe(render);
  bootstrap();
}
