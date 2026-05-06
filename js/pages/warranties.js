import { state, uid } from '../core/state.js';
import { bootstrap, whoPill, toast } from '../core/ui.js';
import { todayISO, shortDate, relativeDays, daysFromToday } from '../core/dates.js';

const page = document.getElementById('page');

const ui = {
  search: '',
  who: 'all',
  category: 'all',
  showArchived: false,
  showExpired: true,
  sort: { key: 'expiry_date', dir: 'asc' },
  openMenuId: null,
};

const CATEGORIES = ['electronics', 'appliance', 'vehicle', 'furniture', 'tool', 'outdoor', 'clothing', 'other'];
const CAT_LABELS = {
  electronics: 'Electronics', appliance: 'Appliance', vehicle: 'Vehicle',
  furniture: 'Furniture', tool: 'Tool', outdoor: 'Outdoor',
  clothing: 'Clothing', other: 'Other',
};

// ---------- helpers ----------

function warranties(data) {
  return data.warranties || [];
}

function isExpired(w) {
  if (!w.expiry_date) return false;
  return daysFromToday(w.expiry_date) < 0;
}

function filterWarranties(data) {
  const q = ui.search.trim().toLowerCase();
  return warranties(data).filter(w => {
    if (!ui.showArchived && w.archived) return false;
    if (!ui.showExpired && isExpired(w)) return false;
    if (ui.who !== 'all' && w.who !== ui.who) return false;
    if (ui.category !== 'all' && w.category !== ui.category) return false;
    if (q && !(`${w.name} ${w.brand || ''} ${w.store || ''} ${w.serial || ''} ${w.notes || ''}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

function sortWarranties(list) {
  const { key, dir } = ui.sort;
  const mul = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    let av, bv;
    switch (key) {
      case 'name': return (a.name || '').localeCompare(b.name || '') * mul;
      case 'purchase_date': av = a.purchase_date || ''; bv = b.purchase_date || ''; return av.localeCompare(bv) * mul;
      case 'expiry_date':
      default: av = a.expiry_date || '9999-99-99'; bv = b.expiry_date || '9999-99-99'; return av.localeCompare(bv) * mul;
    }
  });
}

function expiryUrgency(w) {
  if (!w.expiry_date) return '';
  const days = daysFromToday(w.expiry_date);
  if (days < 0) return 'expired';
  if (days <= 30) return 'renewal-due';
  if (days <= 90) return 'renewal-soon';
  return '';
}

// ---------- render ----------

function render({ data, loading }) {
  if (!data) {
    page.innerHTML = loading
      ? `<div class="empty"><h3>Loading…</h3></div>`
      : `<div class="empty"><h3>Not connected</h3><p>Open settings (⚙) to configure your GitHub data repo.</p></div>`;
    return;
  }

  const all = warranties(data).filter(w => !w.archived);
  const today = todayISO();
  const active = all.filter(w => !w.expiry_date || w.expiry_date >= today);
  const expired = all.filter(w => w.expiry_date && w.expiry_date < today);
  const expiring90 = active.filter(w => {
    const d = daysFromToday(w.expiry_date);
    return d >= 0 && d <= 90;
  });
  const nextExpiry = [...active].filter(w => w.expiry_date).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))[0];

  const filtered = sortWarranties(filterWarranties(data));

  page.innerHTML = `
    ${summaryHTML({ activeCount: active.length, expiredCount: expired.length, expiring90Count: expiring90.length, nextExpiry })}
    ${filtersHTML(data)}
    ${filtered.length === 0
      ? `<div class="empty"><h3>No warranties</h3><p>Click + Add warranty to track your first one.</p></div>`
      : tableHTML(filtered)}
  `;

  wireInteractions(data);
}

function summaryHTML({ activeCount, expiredCount, expiring90Count, nextExpiry }) {
  const nextLabel = nextExpiry ? shortDate(nextExpiry.expiry_date) : '—';
  const nextSub = nextExpiry ? `${nextExpiry.name} · ${relativeDays(nextExpiry.expiry_date)}` : 'nothing upcoming';
  return `
    <div class="summary">
      <div class="card">
        <div class="label">Active warranties</div>
        <div class="value">${activeCount}</div>
        <div class="sub">not yet expired</div>
      </div>
      <div class="card">
        <div class="label">Expiring ≤ 90d</div>
        <div class="value ${expiring90Count ? 'warn' : ''}">${expiring90Count}</div>
        <div class="sub">act before they lapse</div>
      </div>
      <div class="card">
        <div class="label">Next expiry</div>
        <div class="value" style="font-size:1.1rem">${nextLabel}</div>
        <div class="sub">${nextSub}</div>
      </div>
      <div class="card">
        <div class="label">Expired</div>
        <div class="value ${expiredCount ? '' : ''}">${expiredCount}</div>
        <div class="sub">keep for reference</div>
      </div>
    </div>
  `;
}

function filtersHTML(data) {
  const chip = (val, label, field = 'who') =>
    `<div class="chip ${ui[field] === val ? 'active' : ''}" data-w="${val}">${label}</div>`;
  const cats = [...new Set(warranties(data).map(w => w.category).filter(Boolean))].sort();
  return `
    <div class="filters">
      <label class="search">
        <input id="f-search" placeholder="Search warranties…" value="${escapeAttr(ui.search)}"/>
      </label>
      <div class="chips" id="f-who">
        ${chip('all', 'All')}${chip('chang', 'Chang')}${chip('kiju', 'Kiju')}${chip('joint', 'Joint')}
      </div>
      <select class="select" id="f-category">
        <option value="all">All categories</option>
        ${CATEGORIES.map(c => `<option value="${c}" ${ui.category === c ? 'selected' : ''}>${CAT_LABELS[c]}</option>`).join('')}
      </select>
      <label class="chip ${ui.showExpired ? 'active' : ''}" style="cursor:pointer">
        <input type="checkbox" id="f-expired" ${ui.showExpired ? 'checked' : ''} style="display:none"> Show expired
      </label>
      <button class="btn primary" id="btn-add">+ Add warranty</button>
    </div>
  `;
}

function thSortable(key, label) {
  const active = ui.sort.key === key;
  const arrow = active ? (ui.sort.dir === 'asc' ? '▲' : '▼') : '▾';
  return `<th class="sortable ${active ? 'sorted' : ''}" data-sort="${key}">${label} <span class="sort-icon">${arrow}</span></th>`;
}

function tableHTML(list) {
  const bodyRows = list.map(w => warrantyRowHTML(w)).join('');
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${thSortable('name', 'Item')}
            <th>Brand</th>
            <th>Who</th>
            <th>Category</th>
            <th>Store</th>
            <th>Serial #</th>
            ${thSortable('purchase_date', 'Purchased')}
            ${thSortable('expiry_date', 'Expires')}
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

function expiryBadge(w) {
  if (!w.expiry_date) return '';
  const days = daysFromToday(w.expiry_date);
  if (days < 0) return `<span class="expiry-badge badge-expired">Expired</span>`;
  if (days <= 7)  return `<span class="expiry-badge badge-urgent">${days}d left</span>`;
  if (days <= 30) return `<span class="expiry-badge badge-warn">${days}d left</span>`;
  if (days <= 90) return `<span class="expiry-badge badge-soon">${days}d left</span>`;
  return '';
}

function warrantyRowHTML(w) {
  const urgency = expiryUrgency(w);
  const expired = urgency === 'expired';
  const days = w.expiry_date ? daysFromToday(w.expiry_date) : null;
  const rowUrgencyClass = days !== null && days <= 7 && days >= 0 ? 'warranty-urgent'
    : days !== null && days <= 30 && days >= 0 ? 'warranty-warn' : '';
  const expiryDisplay = w.expiry_date
    ? `<div class="expiry-cell">
        <span class="${urgency !== 'expired' ? urgency : 'renewal-due'}">${shortDate(w.expiry_date)}</span>
        ${expiryBadge(w)}
       </div>`
    : '—';
  return `
    <tr data-id="${w.id}" class="${w.archived ? 'archived' : ''} ${expired ? 'warranty-expired' : ''} ${rowUrgencyClass}">
      <td><b>${escapeHTML(w.name)}</b></td>
      <td class="note-cell" data-brand-id="${w.id}" title="${escapeAttr(w.brand || '')}">${truncate(w.brand || '', 20)}</td>
      <td>${whoPill(w.who)}</td>
      <td class="status-cell" data-cat-id="${w.id}">${CAT_LABELS[w.category] || w.category || '—'}</td>
      <td class="note-cell" data-store-id="${w.id}" title="${escapeAttr(w.store || '')}">${truncate(w.store || '', 20)}</td>
      <td class="note-cell" data-serial-id="${w.id}" title="${escapeAttr(w.serial || '')}">${truncate(w.serial || '', 16)}</td>
      <td>${w.purchase_date ? shortDate(w.purchase_date) : '—'}</td>
      <td>${expiryDisplay}</td>
      <td class="note-cell" data-note-id="${w.id}" title="${escapeAttr(w.notes || '')}">${truncate(w.notes || '', 28)}</td>
      <td class="row-actions">
        <button class="del" data-del="${w.id}" title="Delete">✕</button>
        <button class="dots" data-menu="${w.id}">⋯</button>
        ${ui.openMenuId === w.id ? rowMenuHTML(w) : ''}
      </td>
    </tr>
  `;
}

function rowMenuHTML(w) {
  return `
    <div class="menu">
      <div class="menu-item" data-act="edit"><div class="title">✏️ Edit</div></div>
      <div class="menu-sep"></div>
      <div class="menu-item" data-act="archive"><div class="title">🗄️ ${w.archived ? 'Unarchive' : 'Archive'}</div></div>
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
  document.getElementById('f-who')?.addEventListener('click', (e) => {
    const w = e.target.closest('[data-w]')?.dataset.w;
    if (!w) return;
    ui.who = w; render(state.get());
  });
  document.getElementById('f-category')?.addEventListener('change', (e) => {
    ui.category = e.target.value; render(state.get());
  });
  document.getElementById('f-expired')?.addEventListener('change', (e) => {
    ui.showExpired = e.target.checked; render(state.get());
  });
  document.getElementById('btn-add')?.addEventListener('click', () => openForm());

  page.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (ui.sort.key === key) ui.sort.dir = ui.sort.dir === 'asc' ? 'desc' : 'asc';
      else ui.sort = { key, dir: 'asc' };
      render(state.get());
    });
  });

  page.querySelectorAll('button.del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      const w = state.get().data?.warranties?.find(x => x.id === id);
      if (!w || !confirm(`Delete "${w.name}"?`)) return;
      state.mutate(d => { d.warranties = (d.warranties || []).filter(x => x.id !== id); }, `delete ${w.name}`);
      toast('deleted', 'info');
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
      handleMenuAction(id, item.dataset.act);
      ui.openMenuId = null;
    });
  });

  if (ui.openMenuId) {
    document.addEventListener('click', () => { ui.openMenuId = null; render(state.get()); }, { once: true });
  }

  page.querySelectorAll('.menu').forEach(menu => {
    if (menu.getBoundingClientRect().bottom > window.innerHeight - 8) menu.classList.add('menu-up');
  });

  // Inline edits
  function noteEdit(selector, field) {
    page.querySelectorAll(selector).forEach(td => {
      td.addEventListener('click', () => {
        if (td.querySelector('input')) return;
        const id = Object.values(td.dataset)[0];
        const item = state.get().data?.warranties?.find(x => x.id === id);
        if (!item) return;
        const current = item[field] || '';
        td.innerHTML = '';
        const input = document.createElement('input');
        input.className = 'note-input';
        input.value = current;
        td.appendChild(input);
        input.focus(); input.select();
        function commit() {
          const val = input.value.trim();
          if (val !== current) {
            state.mutate(d => {
              const w = (d.warranties || []).find(x => x.id === id);
              if (w) w[field] = val;
            }, `edit ${field}`);
          } else { render(state.get()); }
        }
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur();
          if (e.key === 'Escape') { input.removeEventListener('blur', commit); render(state.get()); }
        });
      });
    });
  }

  noteEdit('td[data-brand-id]', 'brand');
  noteEdit('td[data-store-id]', 'store');
  noteEdit('td[data-serial-id]', 'serial');
  noteEdit('td[data-note-id]', 'notes');

  // Category inline select
  page.querySelectorAll('td.status-cell[data-cat-id]').forEach(td => {
    td.addEventListener('click', () => {
      if (td.querySelector('select')) return;
      const id = td.dataset.catId;
      const w = state.get().data?.warranties?.find(x => x.id === id);
      if (!w) return;
      td.innerHTML = '';
      const select = document.createElement('select');
      select.className = 'inline-select';
      CATEGORIES.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = CAT_LABELS[c];
        if (c === w.category) opt.selected = true;
        select.appendChild(opt);
      });
      td.appendChild(select);
      select.focus();
      select.addEventListener('change', () => {
        state.mutate(d => {
          const item = (d.warranties || []).find(x => x.id === id);
          if (item) item.category = select.value;
        }, `edit category`);
      });
      select.addEventListener('blur', () => render(state.get()));
      select.addEventListener('keydown', (e) => { if (e.key === 'Escape') render(state.get()); });
    });
  });
}

function handleMenuAction(id, act) {
  const w = state.get().data?.warranties?.find(x => x.id === id);
  if (!w) return;
  switch (act) {
    case 'edit': openForm(w); break;
    case 'archive':
      state.mutate(d => {
        const item = (d.warranties || []).find(x => x.id === id);
        if (item) item.archived = !item.archived;
      }, `archive ${w.name}`);
      render(state.get());
      break;
    case 'delete':
      if (!confirm(`Delete "${w.name}"?`)) return;
      state.mutate(d => { d.warranties = (d.warranties || []).filter(x => x.id !== id); }, `delete ${w.name}`);
      toast('deleted', 'info');
      render(state.get());
      break;
  }
}

// ---------- form ----------

function openForm(existing) {
  const isEdit = !!existing;
  const w = existing || {
    id: uid(), name: '', brand: '', who: 'joint', category: 'electronics',
    store: '', serial: '', purchase_date: '', expiry_date: '', coverage: '',
    archived: false, notes: '',
  };

  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `
    <div class="modal modal-lg">
      <h2>${isEdit ? 'Edit warranty' : 'Add warranty'}</h2>
      <div class="form-grid">
        <label class="field full"><span>Item name</span><input id="f-name" value="${escapeAttr(w.name)}" placeholder="Samsung 65&quot; TV"/></label>
        <label class="field"><span>Store / Retailer</span><input id="f-store" value="${escapeAttr(w.store || '')}" placeholder="Best Buy"/></label>
        <label class="field"><span>Serial number</span><input id="f-serial" value="${escapeAttr(w.serial || '')}" placeholder="SN123456"/></label>
        <label class="field"><span>Purchase date</span><input id="f-purchase" type="date" value="${w.purchase_date || ''}"/></label>
        <label class="field"><span>Warranty expires</span><input id="f-expiry" type="date" value="${w.expiry_date || ''}"/></label>
        <label class="field full"><span>Coverage note</span><input id="f-coverage" value="${escapeAttr(w.coverage || '')}" placeholder="e.g. 2-year limited, parts &amp; labor"/></label>
        <label class="field full"><span>Notes</span><input id="f-notes" value="${escapeAttr(w.notes || '')}"/></label>
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
    const name = el.querySelector('#f-name').value.trim();
    if (!name) { alert('Item name is required'); return; }
    const patch = {
      name,
      store: el.querySelector('#f-store').value.trim(),
      serial: el.querySelector('#f-serial').value.trim(),
      purchase_date: el.querySelector('#f-purchase').value || null,
      expiry_date: el.querySelector('#f-expiry').value || null,
      coverage: el.querySelector('#f-coverage').value.trim(),
      notes: el.querySelector('#f-notes').value.trim(),
    };
    state.mutate(d => {
      if (!d.warranties) d.warranties = [];
      if (isEdit) {
        const idx = d.warranties.findIndex(x => x.id === w.id);
        if (idx >= 0) d.warranties[idx] = { ...d.warranties[idx], ...patch };
      } else {
        d.warranties.push({ ...w, ...patch });
      }
    }, isEdit ? `edit warranty ${name}` : `add warranty ${name}`);
    el.remove();
    toast(isEdit ? 'saved' : 'added', 'success');
  };
}

// ---------- utils ----------

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escapeHTML(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function truncate(s, max) {
  return s.length > max ? escapeHTML(s.slice(0, max)) + '…' : escapeHTML(s);
}

// ---------- boot ----------

state.subscribe(render);
bootstrap();
