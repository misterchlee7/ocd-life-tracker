import { state, uid } from '../core/state.js';
import { bootstrap, whoPill, fmtMoney, fmtMoneyShort, toast, WHO_LABEL, positionMenu } from '../core/ui.js';
import { todayISO, shortDate, relativeDays, daysFromToday } from '../core/dates.js';

const page = document.getElementById('page');

const ui = {
  search: '',
  who: 'all',
  type: 'all',
  status: 'all',
  grant: 'all',
  showArchived: false,
  sort: { key: 'date', dir: 'asc' },
  openMenuId: null,
  selected: new Set(),
};

const GRANT_TYPES = ['rsu', 'espp'];
const GRANT_TYPE_LABELS = { rsu: 'RSU', espp: 'ESPP' };
const VEST_STATUSES = ['upcoming', 'vested', 'sold', 'pending_settlement'];
const VEST_STATUS_LABELS = {
  upcoming: 'Upcoming', vested: 'Vested', sold: 'Sold', pending_settlement: 'Pending settlement',
};

function grantLabel(g) {
  if (!g) return '—';
  const parts = [g.company, g.broker].filter(Boolean);
  return parts.length ? parts.join(' · ') : (g.label || '—');
}

function filterEvents(data) {
  const q = ui.search.trim().toLowerCase();
  return data.vesting.filter(v => {
    if (ui.who !== 'all' && v.who !== ui.who) return false;
    if (ui.type !== 'all' && v.type !== ui.type) return false;
    if (ui.status !== 'all' && v.status !== ui.status) return false;
    if (ui.grant !== 'all' && v.grant_id !== ui.grant) return false;
    if (q) {
      const g = data.grants.find(x => x.id === v.grant_id);
      const hay = `${g?.label || ''} ${g?.company || ''} ${g?.broker || ''} ${v.notes || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function sortEvents(events) {
  const { key, dir } = ui.sort;
  const mul = dir === 'asc' ? 1 : -1;
  return [...events].sort((a, b) => {
    switch (key) {
      case 'value': return ((a.gross_value || 0) - (b.gross_value || 0)) * mul;
      case 'shares': return ((a.shares || 0) - (b.shares || 0)) * mul;
      case 'date':
      default: return (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99') * mul;
    }
  });
}

function render({ data, loading }) {
  if (!data) {
    page.innerHTML = loading
      ? `<div class="empty"><h3>Loading…</h3></div>`
      : `<div class="empty"><h3>Not connected</h3><p>Open settings (⚙) to configure your GitHub data repo.</p></div>`;
    return;
  }

  const events = data.vesting;
  const upcoming = events.filter(v => v.status === 'upcoming' && v.date);
  const next90 = upcoming.filter(v => { const d = daysFromToday(v.date); return d >= 0 && d <= 90; });
  const next90Value = next90.reduce((a, v) => a + (v.gross_value || 0), 0);
  const totalUpcomingValue = upcoming.reduce((a, v) => a + (v.gross_value || 0), 0);
  const currentYear = String(new Date().getFullYear());
  const soldYTD = events
    .filter(v => v.status === 'sold' && v.sold_date?.startsWith(currentYear))
    .reduce((a, v) => a + (v.sold_amount || 0), 0);
  const nextEvent = [...upcoming].sort((a, b) => a.date.localeCompare(b.date))[0];

  page.innerHTML = `
    ${summaryHTML({ nextEvent, next90Value, totalUpcomingValue, soldYTD, upcomingCount: upcoming.length })}
    ${renderEvents(data)}
  `;

  wireInteractions(data);
}

function summaryHTML({ nextEvent, next90Value, totalUpcomingValue, soldYTD, upcomingCount }) {
  const nextLabel = nextEvent ? `${shortDate(nextEvent.date)} · ${fmtMoneyShort(nextEvent.gross_value)}` : '—';
  const nextSub = nextEvent ? relativeDays(nextEvent.date) : 'nothing upcoming';
  return `
    <div class="summary">
      <div class="card">
        <div class="label">Next event</div>
        <div class="value" style="font-size:1.05rem">${nextLabel}</div>
        <div class="sub">${nextSub}</div>
      </div>
      <div class="card">
        <div class="label">Vesting ≤ 90d</div>
        <div class="value">${fmtMoney(next90Value)}</div>
        <div class="sub">estimated gross</div>
      </div>
      <div class="card">
        <div class="label">Total upcoming</div>
        <div class="value">${fmtMoney(totalUpcomingValue)}</div>
        <div class="sub">${upcomingCount} events</div>
      </div>
      <div class="card">
        <div class="label">Sold YTD</div>
        <div class="value">${fmtMoney(soldYTD)}</div>
        <div class="sub">realized proceeds</div>
      </div>
    </div>
  `;
}

function massEditBarHTML() {
  if (ui.selected.size === 0) return '';
  return `
    <div class="mass-edit-bar">
      <span class="mass-count">${ui.selected.size} selected</span>
      <input id="me-company" class="mass-input" placeholder="Company…" />
      <input id="me-broker" class="mass-input" placeholder="Broker…" />
      <select id="me-type" class="mass-select">
        <option value="">— Type —</option>
        ${GRANT_TYPES.map(t => `<option value="${t}">${GRANT_TYPE_LABELS[t]}</option>`).join('')}
      </select>
      <select id="me-who" class="mass-select">
        <option value="">— Who —</option>
        <option value="chang">Chang</option>
        <option value="kiju">Kiju</option>
        <option value="joint">Joint</option>
      </select>
      <select id="me-status" class="mass-select">
        <option value="">— Status —</option>
        ${VEST_STATUSES.map(s => `<option value="${s}">${VEST_STATUS_LABELS[s]}</option>`).join('')}
      </select>
      <button class="btn primary" id="me-apply">Apply</button>
      <button class="btn" id="me-clear">✕ Deselect</button>
    </div>
  `;
}

function renderEvents(data) {
  const filtered = sortEvents(filterEvents(data));
  const chip = (val, label) => `<div class="chip ${ui.who === val ? 'active' : ''}" data-w="${val}">${label}</div>`;

  const filtersBar = `
    <div class="filters">
      <label class="search">
        <input id="f-search" placeholder="Search events…" value="${escapeAttr(ui.search)}"/>
      </label>
      <div class="chips" id="f-who">
        ${chip('all','All')}${chip('chang','Chang')}${chip('kiju','Kiju')}${chip('joint','Joint')}
      </div>
      <select class="select" id="f-type">
        <option value="all">All types</option>
        ${GRANT_TYPES.map(t => `<option value="${t}" ${ui.type === t ? 'selected' : ''}>${GRANT_TYPE_LABELS[t]}</option>`).join('')}
      </select>
      <select class="select" id="f-status">
        <option value="all">All statuses</option>
        ${VEST_STATUSES.map(s => `<option value="${s}" ${ui.status === s ? 'selected' : ''}>${VEST_STATUS_LABELS[s]}</option>`).join('')}
      </select>
      <select class="select" id="f-grant">
        <option value="all">All grants</option>
        ${data.grants.map(g => `<option value="${g.id}" ${ui.grant === g.id ? 'selected' : ''}>${escapeHTML(grantLabel(g))}</option>`).join('')}
      </select>
      <button class="btn" id="btn-grants">Grants…</button>
      <button class="btn primary" id="btn-add">+ Add event</button>
    </div>
  `;

  if (filtered.length === 0) {
    return filtersBar + `<div class="empty"><h3>No vesting events</h3><p>Click + Add event to log one.</p></div>`;
  }

  const today = todayISO();
  const showTodayDivider = ui.sort.key === 'date' && ui.sort.dir === 'asc';
  let dividerInserted = false;
  const dividerRow = () => {
    const d = new Date(today + 'T00:00:00');
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return `<tr class="today-divider"><td colspan="11"><span class="today-label">Today · ${label}</span></td></tr>`;
  };

  const bodyRows = filtered.map(v => {
    let prefix = '';
    if (showTodayDivider && !dividerInserted && v.date && v.date > today) {
      prefix = dividerRow();
      dividerInserted = true;
    }
    return prefix + eventRowHTML(data, v);
  }).join('');

  const tailDivider = showTodayDivider && !dividerInserted ? dividerRow() : '';

  const allIds = filtered.map(v => v.id);
  const allChecked = allIds.length > 0 && allIds.every(id => ui.selected.has(id));

  return filtersBar + massEditBarHTML() + `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:32px;text-align:center"><input type="checkbox" id="cb-all" ${allChecked ? 'checked' : ''} title="Select all"></th>
            ${thSortable('date', 'Date')}
            <th>Company</th>
            <th>Broker</th>
            <th>Type</th>
            <th>Who</th>
            ${thSortable('shares', 'Shares')}
            ${thSortable('value', 'Gross value')}
            <th>Status</th>
            <th>Proceeds</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${bodyRows}${tailDivider}</tbody>
      </table>
    </div>
  `;
}

function eventRowHTML(data, v) {
  const grant = data.grants.find(g => g.id === v.grant_id);
  const dateCell = v.date
    ? `${shortDate(v.date)} <span class="cell-amount-sub">${relativeDays(v.date)}</span>`
    : '—';
  const proceedsCell = v.sold_amount != null
    ? `${fmtMoney(v.sold_amount)}${v.sold_date ? ` <span class="cell-amount-sub">${shortDate(v.sold_date)}</span>` : ''}`
    : '—';
  return `
    <tr data-id="${v.id}" class="${ui.selected.has(v.id) ? 'row-selected' : ''}">
      <td style="text-align:center"><input type="checkbox" class="row-cb" data-id="${v.id}" ${ui.selected.has(v.id) ? 'checked' : ''}></td>
      <td>${dateCell}</td>
      <td class="note-cell" data-company-grant-id="${grant?.id || ''}" title="${escapeAttr(grant?.company || '')}">${escapeHTML(grant?.company || '—')}</td>
      <td class="note-cell" data-broker-grant-id="${grant?.id || ''}" title="${escapeAttr(grant?.broker || '')}">${escapeHTML(grant?.broker || '—')}</td>
      <td class="status-cell" data-type-event-id="${v.id}">${GRANT_TYPE_LABELS[v.type] || v.type}</td>
      <td class="status-cell" data-who-event-id="${v.id}">${whoPill(v.who)}</td>
      <td class="editable-cell" data-shares-event-id="${v.id}">${v.shares ?? '—'}</td>
      <td class="editable-cell" data-value-event-id="${v.id}">${fmtMoney(v.gross_value)}</td>
      <td>${vestStatusPill(v.status)}</td>
      <td>${proceedsCell}</td>
      <td class="row-actions">
        <button class="del" data-del="${v.id}" title="Delete">✕</button>
        <button class="dots" data-menu="${v.id}">⋯</button>
        ${ui.openMenuId === v.id ? eventMenuHTML(v) : ''}
      </td>
    </tr>
  `;
}

function vestStatusPill(s) {
  const cls = {
    upcoming: 's-scheduled', vested: 's-paid',
    sold: 's-skipped', pending_settlement: 's-needs_confirm',
  }[s] || 's-skipped';
  return `<span class="status ${cls}">${VEST_STATUS_LABELS[s] || s}</span>`;
}

function eventMenuHTML(v) {
  return `
    <div class="menu">
      <div class="menu-item" data-act="edit"><div class="title">✏️ Edit event</div></div>
      ${v.status !== 'vested' ? `<div class="menu-item" data-act="vest"><div class="title">✅ Mark vested</div></div>` : ''}
      ${v.status !== 'sold' ? `<div class="menu-item" data-act="sold"><div class="title">💰 Mark sold…</div></div>` : ''}
      <div class="menu-sep"></div>
      <div class="menu-item danger" data-act="delete"><div class="title">🗑️ Delete</div></div>
    </div>
  `;
}

function thSortable(key, label) {
  const active = ui.sort.key === key;
  const arrow = active ? (ui.sort.dir === 'asc' ? '▲' : '▼') : '▾';
  return `<th class="sortable ${active ? 'sorted' : ''}" data-sort="${key}">${label} <span class="sort-icon">${arrow}</span></th>`;
}

function wireInteractions(data) {
  document.getElementById('f-search')?.addEventListener('input', (e) => {
    ui.search = e.target.value; render(state.get());
    document.getElementById('f-search').focus();
  });
  document.getElementById('f-who')?.addEventListener('click', (e) => {
    const w = e.target.closest('[data-w]')?.dataset.w;
    if (!w) return;
    ui.who = w; render(state.get());
  });
  document.getElementById('f-type')?.addEventListener('change', (e) => { ui.type = e.target.value; render(state.get()); });
  document.getElementById('f-status')?.addEventListener('change', (e) => { ui.status = e.target.value; render(state.get()); });
  document.getElementById('f-grant')?.addEventListener('change', (e) => { ui.grant = e.target.value; render(state.get()); });
  document.getElementById('btn-add')?.addEventListener('click', () => openEventForm());
  document.getElementById('btn-grants')?.addEventListener('click', () => openGrantsModal());

  page.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (ui.sort.key === key) ui.sort.dir = ui.sort.dir === 'asc' ? 'desc' : 'asc';
      else ui.sort = { key, dir: 'asc' };
      render(state.get());
    });
  });

  // Checkboxes
  document.getElementById('cb-all')?.addEventListener('change', (e) => {
    page.querySelectorAll('.row-cb').forEach(cb => {
      const id = cb.dataset.id;
      if (e.target.checked) ui.selected.add(id); else ui.selected.delete(id);
    });
    render(state.get());
  });

  page.querySelectorAll('.row-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) ui.selected.add(cb.dataset.id); else ui.selected.delete(cb.dataset.id);
      render(state.get());
    });
  });

  // Mass edit bar
  document.getElementById('me-clear')?.addEventListener('click', () => {
    ui.selected.clear(); render(state.get());
  });

  document.getElementById('me-apply')?.addEventListener('click', () => {
    const company = document.getElementById('me-company').value.trim();
    const broker  = document.getElementById('me-broker').value.trim();
    const type    = document.getElementById('me-type').value;
    const who     = document.getElementById('me-who').value;
    const status  = document.getElementById('me-status').value;
    if (!company && !broker && !type && !who && !status) { toast('nothing to apply', 'info'); return; }

    const ids = [...ui.selected];
    state.mutate(d => {
      const grantIds = new Set();
      ids.forEach(id => {
        const ev = d.vesting.find(x => x.id === id);
        if (!ev) return;
        if (type)   ev.type   = type;
        if (who)    ev.who    = who;
        if (status) ev.status = status;
        if ((company || broker) && ev.grant_id) grantIds.add(ev.grant_id);
      });
      grantIds.forEach(grantId => {
        const g = d.grants.find(x => x.id === grantId);
        if (!g) return;
        if (company) g.company = company;
        if (broker)  g.broker  = broker;
      });
    }, `mass edit ${ids.length} events`);

    ui.selected.clear();
    toast(`updated ${ids.length} event${ids.length !== 1 ? 's' : ''}`, 'success');
  });

  page.querySelectorAll('button.del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      const v = state.get().data?.vesting.find(x => x.id === id);
      if (!v) return;
      if (!confirm('Delete this vesting event?')) return;
      state.mutate(d => { d.vesting = d.vesting.filter(x => x.id !== id); }, 'delete event');
      toast(`Deleted: ${v.date ? shortDate(v.date) : 'event'}`, 'info');
    });
  });

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
      const id = item.closest('tr')?.dataset.id;
      if (!id) return;
      handleEventAction(id, item.dataset.act);
      ui.openMenuId = null;
      render(state.get());
    });
  });

  if (ui.openMenuId) {
    document.addEventListener('click', () => {
      document.querySelectorAll('body > .menu').forEach(m => m.remove());
      ui.openMenuId = null;
      render(state.get());
    }, { once: true });
  }

  // ---------- Inline editing helpers ----------

  function inlineText(td, currentVal, placeholder, onSave) {
    if (td.querySelector('input')) return;
    td.innerHTML = '';
    const input = document.createElement('input');
    input.className = 'note-input';
    input.value = currentVal || '';
    input.placeholder = placeholder || '';
    td.appendChild(input);
    input.focus(); input.select();
    function commit() {
      const val = input.value.trim();
      if (val !== (currentVal || '')) onSave(val);
      else render(state.get());
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.removeEventListener('blur', commit); render(state.get()); }
    });
  }

  function inlineSelect(td, options, currentVal, onSave) {
    if (td.querySelector('select')) return;
    td.innerHTML = '';
    const select = document.createElement('select');
    select.className = 'inline-select';
    options.forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      if (val === currentVal) opt.selected = true;
      select.appendChild(opt);
    });
    td.appendChild(select);
    select.focus();
    select.addEventListener('change', () => onSave(select.value));
    select.addEventListener('blur', () => render(state.get()));
    select.addEventListener('keydown', (e) => { if (e.key === 'Escape') render(state.get()); });
  }

  function inlineNumber(td, currentVal, onSave) {
    if (td.querySelector('input')) return;
    td.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'number'; input.step = '0.01'; input.className = 'note-input';
    input.style.textAlign = 'right';
    input.value = currentVal ?? '';
    td.appendChild(input);
    input.focus(); input.select();
    function commit() {
      const val = input.value === '' ? null : Number(input.value);
      onSave(val);
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.removeEventListener('blur', commit); render(state.get()); }
    });
  }

  // Company (edits grant.company)
  page.querySelectorAll('td[data-company-grant-id]').forEach(td => {
    td.addEventListener('click', () => {
      const grantId = td.dataset.companyGrantId;
      if (!grantId) return;
      const g = state.get().data?.grants.find(x => x.id === grantId);
      if (!g) return;
      inlineText(td, g.company, 'e.g. Cisco', val => {
        state.mutate(d => { const gr = d.grants.find(x => x.id === grantId); if (gr) gr.company = val; }, 'edit company');
      });
    });
  });

  // Broker (edits grant.broker)
  page.querySelectorAll('td[data-broker-grant-id]').forEach(td => {
    td.addEventListener('click', () => {
      const grantId = td.dataset.brokerGrantId;
      if (!grantId) return;
      const g = state.get().data?.grants.find(x => x.id === grantId);
      if (!g) return;
      inlineText(td, g.broker, 'e.g. E*Trade', val => {
        state.mutate(d => { const gr = d.grants.find(x => x.id === grantId); if (gr) gr.broker = val; }, 'edit broker');
      });
    });
  });

  // Type
  page.querySelectorAll('td[data-type-event-id]').forEach(td => {
    td.addEventListener('click', () => {
      const id = td.dataset.typeEventId;
      const v = state.get().data?.vesting.find(x => x.id === id);
      if (!v) return;
      inlineSelect(td, GRANT_TYPES.map(t => [t, GRANT_TYPE_LABELS[t]]), v.type, val => {
        state.mutate(d => { const ev = d.vesting.find(x => x.id === id); if (ev) ev.type = val; }, 'edit type');
      });
    });
  });

  // Who
  page.querySelectorAll('td[data-who-event-id]').forEach(td => {
    td.addEventListener('click', () => {
      const id = td.dataset.whoEventId;
      const v = state.get().data?.vesting.find(x => x.id === id);
      if (!v) return;
      inlineSelect(td, [['chang','Chang'],['kiju','Kiju'],['joint','Joint']], v.who, val => {
        state.mutate(d => { const ev = d.vesting.find(x => x.id === id); if (ev) ev.who = val; }, 'edit who');
      });
    });
  });

  // Shares
  page.querySelectorAll('td[data-shares-event-id]').forEach(td => {
    td.addEventListener('click', () => {
      const id = td.dataset.sharesEventId;
      const v = state.get().data?.vesting.find(x => x.id === id);
      if (!v) return;
      inlineNumber(td, v.shares, val => {
        if (val !== v.shares) state.mutate(d => { const ev = d.vesting.find(x => x.id === id); if (ev) ev.shares = val; }, 'edit shares');
        else render(state.get());
      });
    });
  });

  // Gross value
  page.querySelectorAll('td[data-value-event-id]').forEach(td => {
    td.addEventListener('click', () => {
      const id = td.dataset.valueEventId;
      const v = state.get().data?.vesting.find(x => x.id === id);
      if (!v) return;
      inlineNumber(td, v.gross_value, val => {
        if (val !== v.gross_value) state.mutate(d => { const ev = d.vesting.find(x => x.id === id); if (ev) ev.gross_value = val; }, 'edit gross value');
        else render(state.get());
      });
    });
  });

  // Move open menu to body with position:fixed — avoids overflow-parent clipping
  if (ui.openMenuId) {
    const openMenu = page.querySelector('.menu');
    const anchorBtn = page.querySelector(`[data-menu="${ui.openMenuId}"]`);
    if (openMenu && anchorBtn) positionMenu(openMenu, anchorBtn);
  }
}

function handleEventAction(id, act) {
  const { data } = state.get();
  const v = data.vesting.find(x => x.id === id);
  if (!v) return;

  switch (act) {
    case 'edit': openEventForm(v); break;
    case 'vest':
      state.mutate(d => { const e = d.vesting.find(x => x.id === id); if (e) e.status = 'vested'; }, 'mark vested');
      toast(`Vested: ${v.date ? shortDate(v.date) : 'event'}`, 'success');
      break;
    case 'sold': {
      const amt = prompt('Sold amount (proceeds $)', v.gross_value ?? '');
      if (amt == null) return;
      const n = Number(amt);
      if (!isFinite(n)) return;
      state.mutate(d => {
        const e = d.vesting.find(x => x.id === id);
        if (e) { e.status = 'sold'; e.sold_amount = n; e.sold_date = todayISO(); }
      }, 'mark sold');
      toast(`Sold: ${v.date ? shortDate(v.date) : 'event'}`, 'success');
      break;
    }
    case 'delete':
      if (!confirm('Delete this vesting event?')) return;
      state.mutate(d => { d.vesting = d.vesting.filter(x => x.id !== id); }, 'delete event');
      toast(`Deleted: ${v.date ? shortDate(v.date) : 'event'}`, 'info');
      break;
  }
}

// ---------- Grants management modal ----------

function openGrantsModal() {
  const existing = document.getElementById('grants-modal');
  if (existing) existing.remove();

  function buildHTML() {
    const { data } = state.get();
    const grants = (data?.grants || []).filter(g => !g.archived);
    const archived = (data?.grants || []).filter(g => g.archived);
    const rows = grants.map(g => {
      const eventCount = data.vesting.filter(v => v.grant_id === g.id).length;
      return `
        <tr data-grant-id="${g.id}">
          <td><b>${escapeHTML(g.label)}</b></td>
          <td>${escapeHTML(g.company || '—')}</td>
          <td>${escapeHTML(g.broker || '—')}</td>
          <td>${GRANT_TYPE_LABELS[g.type] || g.type}</td>
          <td>${whoPill(g.who)}</td>
          <td class="muted">${eventCount} event${eventCount !== 1 ? 's' : ''}</td>
          <td class="row-actions">
            <button class="btn btn-sm" data-edit-grant="${g.id}">Edit</button>
            <button class="del" data-del-grant="${g.id}" title="Delete grant + events">✕</button>
          </td>
        </tr>
      `;
    }).join('');
    const archivedRows = archived.map(g => `
      <tr data-grant-id="${g.id}" style="opacity:0.45">
        <td><b>${escapeHTML(g.label)}</b> <span class="muted">(archived)</span></td>
        <td>${escapeHTML(g.company || '—')}</td>
        <td>${escapeHTML(g.broker || '—')}</td>
        <td>${GRANT_TYPE_LABELS[g.type] || g.type}</td>
        <td>${whoPill(g.who)}</td>
        <td></td>
        <td class="row-actions">
          <button class="btn btn-sm" data-edit-grant="${g.id}">Edit</button>
          <button class="del" data-del-grant="${g.id}" title="Delete">✕</button>
        </td>
      </tr>
    `).join('');

    return `
      <div class="modal modal-lg" id="grants-modal-inner">
        <h2>Manage grants</h2>
        <p class="modal-sub">Grants group your vesting events by company and broker account.</p>
        ${grants.length + archived.length === 0 ? `<div class="empty" style="margin:16px 0"><h3>No grants yet</h3></div>` : `
          <div class="table-wrap" style="margin-bottom:16px">
            <table>
              <thead><tr><th>Label</th><th>Company</th><th>Broker</th><th>Type</th><th>Who</th><th>Events</th><th></th></tr></thead>
              <tbody>${rows}${archivedRows}</tbody>
            </table>
          </div>
        `}
        <div class="modal-actions">
          <button class="btn" id="gm-close">Close</button>
          <span style="flex:1"></span>
          <button class="btn primary" id="gm-add">+ Add grant</button>
        </div>
      </div>
    `;
  }

  const backdrop = document.createElement('div');
  backdrop.id = 'grants-modal';
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = buildHTML();
  document.body.appendChild(backdrop);

  function rewire() {
    backdrop.querySelector('#gm-close')?.addEventListener('click', () => backdrop.remove());
    backdrop.querySelector('#gm-add')?.addEventListener('click', () => {
      openGrantForm(null, () => { backdrop.querySelector('#grants-modal-inner').outerHTML = buildHTML().match(/<div class="modal[^>]+>([\s\S]*)/)?.[0] || ''; rewire(); backdrop.innerHTML = buildHTML(); rewire(); });
    });
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

    backdrop.querySelectorAll('[data-edit-grant]').forEach(btn => {
      btn.addEventListener('click', () => {
        const gId = btn.dataset.editGrant;
        const g = state.get().data?.grants.find(x => x.id === gId);
        if (!g) return;
        openGrantForm(g, () => { backdrop.innerHTML = buildHTML(); rewire(); });
      });
    });

    backdrop.querySelectorAll('[data-del-grant]').forEach(btn => {
      btn.addEventListener('click', () => {
        const gId = btn.dataset.delGrant;
        const g = state.get().data?.grants.find(x => x.id === gId);
        if (!g || !confirm(`Delete grant "${g.label}" and all its vesting events?`)) return;
        state.mutate(d => {
          d.grants = d.grants.filter(x => x.id !== gId);
          d.vesting = d.vesting.filter(x => x.grant_id !== gId);
        }, 'delete grant');
        toast(`Deleted grant: ${g.label}`, 'info');
        backdrop.innerHTML = buildHTML();
        rewire();
      });
    });
  }

  rewire();
}

// ---------- Forms ----------

function openEventForm(existing) {
  const { data } = state.get();
  const isEdit = !!existing;
  const v = existing || {
    id: uid(), grant_id: data.grants[0]?.id || '', type: 'rsu', who: 'chang',
    date: todayISO(), shares: null, gross_value: 0, status: 'upcoming',
    sold_date: null, sold_amount: null, notes: '',
  };

  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `
    <div class="modal modal-lg">
      <h2>${isEdit ? 'Edit vesting event' : 'Add vesting event'}</h2>
      <div class="form-grid">
        <label class="field"><span>Grant</span>
          <select id="f-grant-in">
            ${data.grants.length === 0 ? '<option value="">(no grants — add one via Grants…)</option>' : ''}
            ${data.grants.map(g => `<option value="${g.id}" ${v.grant_id === g.id ? 'selected' : ''}>${escapeHTML(grantLabel(g) || g.label)}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Type</span>
          <select id="f-type-in">
            ${GRANT_TYPES.map(t => `<option value="${t}" ${v.type === t ? 'selected' : ''}>${GRANT_TYPE_LABELS[t]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Who</span>
          <select id="f-who-in">
            ${['chang','kiju','joint'].map(w => `<option value="${w}" ${v.who === w ? 'selected' : ''}>${WHO_LABEL[w]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Date</span><input id="f-date" type="date" value="${v.date || ''}"/></label>
        <label class="field"><span>Shares</span><input id="f-shares" type="number" step="1" value="${v.shares ?? ''}"/></label>
        <label class="field"><span>Gross value ($)</span><input id="f-value" type="number" step="0.01" value="${v.gross_value ?? 0}"/></label>
        <label class="field"><span>Status</span>
          <select id="f-status-in">
            ${VEST_STATUSES.map(s => `<option value="${s}" ${v.status === s ? 'selected' : ''}>${VEST_STATUS_LABELS[s]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Sold date</span><input id="f-sold-date" type="date" value="${v.sold_date || ''}"/></label>
        <label class="field"><span>Sold amount ($)</span><input id="f-sold-amt" type="number" step="0.01" value="${v.sold_amount ?? ''}"/></label>
        <label class="field full"><span>Notes</span><input id="f-notes" value="${escapeAttr(v.notes || '')}"/></label>
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
  el.querySelector('#f-save').onclick = () => {
    const patch = {
      grant_id: el.querySelector('#f-grant-in').value,
      type: el.querySelector('#f-type-in').value,
      who: el.querySelector('#f-who-in').value,
      date: el.querySelector('#f-date').value || null,
      shares: el.querySelector('#f-shares').value ? Number(el.querySelector('#f-shares').value) : null,
      gross_value: Number(el.querySelector('#f-value').value) || 0,
      status: el.querySelector('#f-status-in').value,
      sold_date: el.querySelector('#f-sold-date').value || null,
      sold_amount: el.querySelector('#f-sold-amt').value ? Number(el.querySelector('#f-sold-amt').value) : null,
      notes: el.querySelector('#f-notes').value.trim(),
    };
    if (!patch.grant_id) { alert('Pick a grant (or add one via Grants…)'); return; }
    state.mutate(d => {
      if (isEdit) {
        const idx = d.vesting.findIndex(x => x.id === v.id);
        if (idx >= 0) d.vesting[idx] = { ...d.vesting[idx], ...patch };
      } else {
        d.vesting.push({ ...v, ...patch });
      }
    }, isEdit ? 'edit event' : 'add event');
    el.remove();
    toast(isEdit ? `Updated: ${patch.date ? shortDate(patch.date) : 'event'}` : `Added: ${patch.date ? shortDate(patch.date) : 'event'}`, 'success');
  };
}

function openGrantForm(existing, onSaved) {
  const isEdit = !!existing;
  const g = existing || {
    id: uid(), label: '', company: '', broker: '', type: 'rsu', who: 'chang',
    grant_date: todayISO(), total_shares: null, schedule_note: '', archived: false, notes: '',
  };

  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `
    <div class="modal modal-lg">
      <h2>${isEdit ? 'Edit grant' : 'Add grant'}</h2>
      <div class="form-grid">
        <label class="field"><span>Label / ID</span><input id="f-label" value="${escapeAttr(g.label)}" placeholder="G-24-R-001"/></label>
        <label class="field"><span>Company</span><input id="f-company" value="${escapeAttr(g.company || '')}" placeholder="Cisco"/></label>
        <label class="field"><span>Broker / Account</span><input id="f-broker" value="${escapeAttr(g.broker || '')}" placeholder="E*Trade"/></label>
        <label class="field"><span>Type</span>
          <select id="f-type-in">
            ${GRANT_TYPES.map(t => `<option value="${t}" ${g.type === t ? 'selected' : ''}>${GRANT_TYPE_LABELS[t]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Who</span>
          <select id="f-who-in">
            ${['chang','kiju','joint'].map(w => `<option value="${w}" ${g.who === w ? 'selected' : ''}>${WHO_LABEL[w]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Grant date</span><input id="f-grant-date" type="date" value="${g.grant_date || ''}"/></label>
        <label class="field"><span>Total shares</span><input id="f-shares" type="number" step="1" value="${g.total_shares ?? ''}"/></label>
        <label class="field full"><span>Schedule note</span><input id="f-schedule" value="${escapeAttr(g.schedule_note || '')}" placeholder="4-yr, 1yr cliff, quarterly after"/></label>
        <label class="field full"><span>Notes</span><input id="f-notes" value="${escapeAttr(g.notes || '')}"/></label>
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
  el.querySelector('#f-save').onclick = () => {
    const patch = {
      label: el.querySelector('#f-label').value.trim(),
      company: el.querySelector('#f-company').value.trim(),
      broker: el.querySelector('#f-broker').value.trim(),
      type: el.querySelector('#f-type-in').value,
      who: el.querySelector('#f-who-in').value,
      grant_date: el.querySelector('#f-grant-date').value || null,
      total_shares: el.querySelector('#f-shares').value ? Number(el.querySelector('#f-shares').value) : null,
      schedule_note: el.querySelector('#f-schedule').value.trim(),
      notes: el.querySelector('#f-notes').value.trim(),
    };
    if (!patch.label) { alert('Label is required'); return; }
    state.mutate(d => {
      if (isEdit) {
        const idx = d.grants.findIndex(x => x.id === g.id);
        if (idx >= 0) d.grants[idx] = { ...d.grants[idx], ...patch };
      } else {
        d.grants.push({ ...g, ...patch });
      }
    }, isEdit ? 'edit grant' : 'add grant');
    el.remove();
    toast(isEdit ? `Updated grant: ${patch.label}` : `Added grant: ${patch.label}`, 'success');
    onSaved?.();
  };
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escapeHTML(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

state.subscribe(render);
bootstrap();
