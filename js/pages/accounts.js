import { state, uid } from '../core/state.js';
import { bootstrap, isMobile, whoPill, toast, positionMenu, confirmModal, amountModal, closeOnEscape, pageHeaderHTML, fmtMoney } from '../core/ui.js';
import { todayISO, shortDate, relativeDays } from '../core/dates.js';
import {
  escapeHTML, escapeAttr, truncate,
  ACCOUNT_TYPES as TYPES, ACCOUNT_TYPE_LABELS as TYPE_LABELS,
  ACCOUNT_STATUS_LABELS as STATUS_LABELS,
} from '../core/text.js';

const page = document.getElementById('page');

const ui = {
  search: '',
  who: 'all',
  type: 'all',
  showClosed: false,
  sort: { key: 'institution', dir: 'asc' },
  openMenuId: null,
};

// ---------- helpers ----------

function accounts(data) {
  return data.accounts || [];
}

function accountLabel(a) {
  return `${a.institution} — ${a.name}`;
}

// Latest snapshot by date, or null. Snapshots are kept ascending, but sort
// defensively in case of hand-edited data.
function latestSnapshot(a) {
  const snaps = a.snapshots || [];
  if (!snaps.length) return null;
  return [...snaps].sort((x, y) => x.date.localeCompare(y.date))[snaps.length - 1];
}

function filterAccounts(data) {
  const q = ui.search.trim().toLowerCase();
  return accounts(data).filter(a => {
    if (!ui.showClosed && a.status === 'closed') return false;
    if (ui.who !== 'all' && a.who !== ui.who) return false;
    if (ui.type !== 'all' && a.type !== ui.type) return false;
    if (q && !(`${a.institution} ${a.name} ${a.last4 || ''} ${a.notes || ''}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

function sortAccounts(list) {
  const { key, dir } = ui.sort;
  const mul = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    switch (key) {
      case 'name': return (a.name || '').localeCompare(b.name || '') * mul;
      case 'type': return (a.type || '').localeCompare(b.type || '') * mul;
      case 'apy': return ((a.apy ?? -1) - (b.apy ?? -1)) * mul;
      case 'balance': {
        const av = latestSnapshot(a)?.balance ?? -1;
        const bv = latestSnapshot(b)?.balance ?? -1;
        return (av - bv) * mul;
      }
      case 'opened_date': return ((a.opened_date || '') > (b.opened_date || '') ? 1 : -1) * mul;
      case 'institution':
      default: return (a.institution || '').localeCompare(b.institution || '') * mul
        || (a.name || '').localeCompare(b.name || '');
    }
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

  const all = accounts(data);
  const open = all.filter(a => a.status !== 'closed');
  const closed = all.filter(a => a.status === 'closed');

  const filtered = sortAccounts(filterAccounts(data));

  page.innerHTML = `
    ${pageHeaderHTML('Accounts', `${open.length} open`,
      `<button class="btn primary" id="btn-add">+ Add account</button>`)}
    ${summaryHTML({ open, closed })}
    ${filtersHTML()}
    ${filtered.length === 0
      ? `<div class="empty"><h3>No accounts</h3><p>Click + Add account to track your first one.</p></div>`
      : tableHTML(filtered)}
  `;

  wireInteractions(data);
}

function summaryHTML({ open, closed }) {
  const byWho = { chang: 0, kiju: 0, joint: 0 };
  open.forEach(a => { if (byWho[a.who] != null) byWho[a.who]++; });
  const whoSub = Object.entries(byWho).filter(([, n]) => n > 0)
    .map(([w, n]) => `${w === 'chang' ? 'C' : w === 'kiju' ? 'K' : 'J'}: ${n}`).join(' · ') || '—';

  const snapped = open.map(a => ({ a, snap: latestSnapshot(a) })).filter(x => x.snap);
  const total = snapped.reduce((s, x) => s + x.snap.balance, 0);
  const oldest = snapped.map(x => x.snap.date).sort()[0];
  const totalLabel = snapped.length ? fmtMoney(total) : '—';
  const totalSub = snapped.length
    ? `${snapped.length}/${open.length} accounts · oldest ${relativeDays(oldest)}`
    : 'no balance snapshots yet';

  const retirementTotal = snapped
    .filter(x => x.a.type === 'retirement' || x.a.type === 'hsa')
    .reduce((s, x) => s + x.snap.balance, 0);
  const nonRetirementTotal = total - retirementTotal;
  const breakdownSub = snapped.length
    ? `Retirement ${fmtMoney(retirementTotal)} · Non-retirement ${fmtMoney(nonRetirementTotal)}`
    : '';

  const best = open.filter(a => a.apy != null).sort((a, b) => b.apy - a.apy)[0];
  const bestLabel = best ? `${best.apy}%` : '—';
  const bestSub = best ? escapeHTML(accountLabel(best)) : 'no APY recorded';

  return `
    <div class="summary">
      <div class="card">
        <div class="label">Open accounts</div>
        <div class="value">${open.length}</div>
        <div class="sub">${whoSub}</div>
      </div>
      <div class="card">
        <div class="label">Snapshot total</div>
        <div class="value" style="font-size:1.1rem">${totalLabel}</div>
        <div class="sub">${totalSub}</div>
        ${breakdownSub ? `<div class="sub">${breakdownSub}</div>` : ''}
      </div>
      <div class="card">
        <div class="label">Best APY</div>
        <div class="value">${bestLabel}</div>
        <div class="sub">${bestSub}</div>
      </div>
      <div class="card">
        <div class="label">Closed</div>
        <div class="value">${closed.length}</div>
        <div class="sub">kept for reference</div>
      </div>
    </div>
  `;
}

function filtersHTML() {
  const chip = (val, label) =>
    `<div class="chip ${ui.who === val ? 'active' : ''}" data-w="${val}">${label}</div>`;
  return `
    <div class="filters">
      <label class="search">
        <input id="f-search" placeholder="Search accounts…" value="${escapeAttr(ui.search)}"/>
      </label>
      <div class="chips" id="f-who">
        ${chip('all', 'All')}${chip('chang', 'Chang')}${chip('kiju', 'Kiju')}${chip('joint', 'Joint')}
      </div>
      <select class="select" id="f-type">
        <option value="all">All types</option>
        ${TYPES.map(t => `<option value="${t}" ${ui.type === t ? 'selected' : ''}>${TYPE_LABELS[t]}</option>`).join('')}
      </select>
      <label class="chip ${ui.showClosed ? 'active' : ''}" style="cursor:pointer">
        <input type="checkbox" id="f-closed" ${ui.showClosed ? 'checked' : ''} style="display:none"> Show closed
      </label>
    </div>
  `;
}

function thSortable(key, label) {
  const active = ui.sort.key === key;
  const arrow = active ? (ui.sort.dir === 'asc' ? '▲' : '▼') : '▾';
  return `<th class="sortable ${active ? 'sorted' : ''}" data-sort="${key}">${label} <span class="sort-icon">${arrow}</span></th>`;
}

function tableHTML(list) {
  const bodyRows = list.map(a => accountRowHTML(a)).join('');
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${thSortable('institution', 'Institution')}
            ${thSortable('name', 'Account')}
            ${thSortable('type', 'Type')}
            <th>Who</th>
            <th>Last 4</th>
            ${thSortable('apy', 'APY')}
            ${thSortable('balance', 'Balance')}
            ${thSortable('opened_date', 'Opened')}
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

function accountRowHTML(a) {
  const closed = a.status === 'closed';
  const snap = latestSnapshot(a);
  const balanceDisplay = snap
    ? `<b>${fmtMoney(snap.balance)}</b> <span class="muted" style="font-size:11px">${relativeDays(snap.date)}</span>`
    : '—';
  return `
    <tr data-id="${a.id}" class="${closed ? 'archived' : ''}">
      <td><b>${escapeHTML(a.institution)}</b></td>
      <td>${escapeHTML(a.name)}${closed ? ` <span class="pill tiny">${STATUS_LABELS.closed}</span>` : ''}</td>
      <td class="status-cell" data-type-id="${a.id}">${TYPE_LABELS[a.type] || a.type || '—'}</td>
      <td>${whoPill(a.who)}</td>
      <td class="note-cell tight" data-last4-id="${a.id}">${escapeHTML(a.last4 || '—')}</td>
      <td class="note-cell tight" data-apy-id="${a.id}">${a.apy != null ? a.apy + '%' : '—'}</td>
      <td class="tight">${balanceDisplay}</td>
      <td class="tight">${a.opened_date ? shortDate(a.opened_date) : '—'}</td>
      <td class="note-cell" data-note-id="${a.id}" title="${escapeAttr(a.notes || '')}">${truncate(a.notes || '', 28)}</td>
      <td class="row-actions">
        <button class="del" data-del="${a.id}" title="Delete">✕</button>
        <button class="dots" data-menu="${a.id}">⋯</button>
        ${ui.openMenuId === a.id ? rowMenuHTML(a) : ''}
      </td>
    </tr>
  `;
}

function rowMenuHTML(a) {
  const closed = a.status === 'closed';
  return `
    <div class="menu" data-id="${a.id}">
      <div class="menu-item" data-act="edit"><div class="title">✏️ Edit</div></div>
      <div class="menu-item" data-act="snapshot"><div class="title">📸 Add balance snapshot</div></div>
      <div class="menu-sep"></div>
      <div class="menu-item" data-act="toggle-status"><div class="title">${closed ? '🔓 Reopen account' : '🔒 Mark closed'}</div></div>
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
  document.getElementById('f-type')?.addEventListener('change', (e) => {
    ui.type = e.target.value; render(state.get());
  });
  document.getElementById('f-closed')?.addEventListener('change', (e) => {
    ui.showClosed = e.target.checked; render(state.get());
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
      confirmDelete(btn.dataset.del);
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
      const id = item.closest('.menu')?.dataset.id;
      if (!id) return;
      handleMenuAction(id, item.dataset.act);
      ui.openMenuId = null;
    });
  });

  if (ui.openMenuId) {
    const openMenu = page.querySelector('.menu');
    const anchorBtn = page.querySelector(`[data-menu="${ui.openMenuId}"]`);
    if (openMenu && anchorBtn) positionMenu(openMenu, anchorBtn);

    document.addEventListener('click', () => {
      document.querySelectorAll('body > .menu').forEach(m => m.remove());
      ui.openMenuId = null;
      render(state.get());
    }, { once: true });
  }

  // Inline text edits (last4, notes)
  function noteEdit(selector, field) {
    page.querySelectorAll(selector).forEach(td => {
      td.addEventListener('click', () => {
        if (td.querySelector('input')) return;
        const id = Object.values(td.dataset)[0];
        const item = state.get().data?.accounts?.find(x => x.id === id);
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
              const a = (d.accounts || []).find(x => x.id === id);
              if (a) a[field] = val;
            }, `edit ${field}: ${accountLabel(item)}`);
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

  noteEdit('td[data-last4-id]', 'last4');
  noteEdit('td[data-note-id]', 'notes');

  // APY inline edit — numeric; empty clears
  page.querySelectorAll('td[data-apy-id]').forEach(td => {
    td.addEventListener('click', () => {
      if (td.querySelector('input')) return;
      const id = td.dataset.apyId;
      const item = state.get().data?.accounts?.find(x => x.id === id);
      if (!item) return;
      const current = item.apy != null ? String(item.apy) : '';
      td.innerHTML = '';
      const input = document.createElement('input');
      input.className = 'note-input';
      input.type = 'number';
      input.step = '0.01';
      input.min = '0';
      input.setAttribute('inputmode', 'decimal');
      input.value = current;
      td.appendChild(input);
      input.focus(); input.select();
      function commit() {
        const raw = input.value.trim();
        if (raw === current) { render(state.get()); return; }
        const val = raw === '' ? null : parseFloat(raw);
        if (raw !== '' && isNaN(val)) { toast('Enter a valid APY', 'error'); render(state.get()); return; }
        state.mutate(d => {
          const a = (d.accounts || []).find(x => x.id === id);
          if (a) a.apy = val;
        }, `edit apy: ${accountLabel(item)} → ${val == null ? '—' : val + '%'}`);
      }
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { input.removeEventListener('blur', commit); render(state.get()); }
      });
    });
  });

  // Type inline select
  page.querySelectorAll('td.status-cell[data-type-id]').forEach(td => {
    td.addEventListener('click', () => {
      if (td.querySelector('select')) return;
      const id = td.dataset.typeId;
      const a = state.get().data?.accounts?.find(x => x.id === id);
      if (!a) return;
      td.innerHTML = '';
      const select = document.createElement('select');
      select.className = 'inline-select';
      TYPES.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t; opt.textContent = TYPE_LABELS[t];
        if (t === a.type) opt.selected = true;
        select.appendChild(opt);
      });
      td.appendChild(select);
      select.focus();
      select.addEventListener('change', () => {
        state.mutate(d => {
          const item = (d.accounts || []).find(x => x.id === id);
          if (item) item.type = select.value;
        }, `edit type: ${accountLabel(a)} → ${select.value}`);
      });
      select.addEventListener('blur', () => render(state.get()));
      select.addEventListener('keydown', (e) => { if (e.key === 'Escape') render(state.get()); });
    });
  });
}

function confirmDelete(id) {
  const a = state.get().data?.accounts?.find(x => x.id === id);
  if (!a) return;
  confirmModal({
    title: 'Delete account',
    message: `Delete "${accountLabel(a)}"? Snapshots go with it. Closed accounts can be kept for reference instead.`,
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      state.mutate(d => { d.accounts = (d.accounts || []).filter(x => x.id !== id); }, `delete account: ${accountLabel(a)}`);
      toast(`Deleted: ${accountLabel(a)}`, 'info');
      render(state.get());
    },
  });
}

function handleMenuAction(id, act) {
  const a = state.get().data?.accounts?.find(x => x.id === id);
  if (!a) return;
  switch (act) {
    case 'edit': openForm(a); break;
    case 'snapshot': openSnapshotModal(a); break;
    case 'toggle-status': {
      const next = a.status === 'closed' ? 'open' : 'closed';
      state.mutate(d => {
        const item = (d.accounts || []).find(x => x.id === id);
        if (item) item.status = next;
      }, `set status: ${accountLabel(a)} → ${next}`);
      toast(`${next === 'closed' ? 'Closed' : 'Reopened'}: ${accountLabel(a)}`, 'info');
      render(state.get());
      break;
    }
    case 'delete': confirmDelete(id); break;
  }
}

// One snapshot per date: re-snapshotting today replaces today's entry.
function openSnapshotModal(a) {
  const snap = latestSnapshot(a);
  amountModal({
    title: 'Balance snapshot',
    sub: `${accountLabel(a)}${snap ? ` — last: ${fmtMoney(snap.balance)} (${relativeDays(snap.date)})` : ''}`,
    defaultValue: snap?.balance ?? 0,
    confirmLabel: 'Save snapshot',
    onConfirm: (amt) => {
      const today = todayISO();
      state.mutate(d => {
        const item = (d.accounts || []).find(x => x.id === a.id);
        if (!item) return;
        if (!item.snapshots) item.snapshots = [];
        const existing = item.snapshots.find(s => s.date === today);
        if (existing) existing.balance = amt;
        else item.snapshots.push({ date: today, balance: amt });
        item.snapshots.sort((x, y) => x.date.localeCompare(y.date));
      }, `snapshot: ${accountLabel(a)} ${fmtMoney(amt)}`);
      toast(`Snapshot saved: ${accountLabel(a)} ${fmtMoney(amt)}`, 'success');
    },
  });
}

// ---------- form ----------

function openForm(existing) {
  const isEdit = !!existing;
  const a = existing || {
    id: uid(), institution: '', name: '', type: 'checking', who: 'joint',
    last4: '', apy: null, opened_date: '', status: 'open', notes: '',
  };

  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `
    <div class="modal modal-lg">
      <h2>${isEdit ? 'Edit account' : 'Add account'}</h2>
      <div class="form-grid">
        <label class="field"><span>Institution</span><input id="f-institution" value="${escapeAttr(a.institution)}" placeholder="PNC"/></label>
        <label class="field"><span>Account name</span><input id="f-name" value="${escapeAttr(a.name)}" placeholder="Joint Checking"/></label>
        <label class="field"><span>Type</span>
          <select id="f-type-sel">
            ${TYPES.map(t => `<option value="${t}" ${a.type === t ? 'selected' : ''}>${TYPE_LABELS[t]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Who</span>
          <select id="f-who-sel">
            <option value="chang" ${a.who === 'chang' ? 'selected' : ''}>Chang</option>
            <option value="kiju" ${a.who === 'kiju' ? 'selected' : ''}>Kiju</option>
            <option value="joint" ${a.who === 'joint' ? 'selected' : ''}>Joint</option>
          </select>
        </label>
        <label class="field"><span>Last 4 digits</span><input id="f-last4" value="${escapeAttr(a.last4 || '')}" placeholder="4821" maxlength="4" inputmode="numeric"/></label>
        <label class="field"><span>APY % (optional)</span><input id="f-apy" type="number" step="0.01" min="0" inputmode="decimal" value="${a.apy ?? ''}" placeholder="4.35"/></label>
        <label class="field"><span>Opened date</span><input id="f-opened" type="date" value="${a.opened_date || ''}"/></label>
        <label class="field full"><span>Notes</span><input id="f-notes" value="${escapeAttr(a.notes || '')}" placeholder="Direct deposit lands here"/></label>
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
    const institution = el.querySelector('#f-institution').value.trim();
    const name = el.querySelector('#f-name').value.trim();
    if (!institution) { toast('Institution is required', 'error'); return; }
    if (!name) { toast('Account name is required', 'error'); return; }
    const apyRaw = el.querySelector('#f-apy').value.trim();
    const patch = {
      institution,
      name,
      type: el.querySelector('#f-type-sel').value,
      who: el.querySelector('#f-who-sel').value,
      last4: el.querySelector('#f-last4').value.trim(),
      apy: apyRaw === '' ? null : parseFloat(apyRaw),
      opened_date: el.querySelector('#f-opened').value || null,
      notes: el.querySelector('#f-notes').value.trim(),
    };
    state.mutate(d => {
      if (!d.accounts) d.accounts = [];
      if (isEdit) {
        const idx = d.accounts.findIndex(x => x.id === a.id);
        if (idx >= 0) d.accounts[idx] = { ...d.accounts[idx], ...patch };
      } else {
        d.accounts.push({ ...a, ...patch });
      }
    }, isEdit ? `edit account: ${institution} — ${name}` : `add account: ${institution} — ${name}`);
    el.remove();
    toast(isEdit ? `Updated: ${institution} — ${name}` : `Added: ${institution} — ${name}`, 'success');
  };
}

// ---------- boot ----------

if (isMobile()) {
  import('./accounts-mobile.js').then(m => m.init());
} else {
  state.subscribe(render);
  bootstrap();
}
