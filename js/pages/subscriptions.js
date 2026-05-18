import { state, uid } from '../core/state.js';
import { bootstrap, whoPill, fmtMoney, fmtMoneyShort, toast, WHO_LABEL, positionMenu } from '../core/ui.js';
import { todayISO, shortDate, relativeDays, daysFromToday } from '../core/dates.js';

const page = document.getElementById('page');

const ui = {
  search: '',
  who: 'all',
  category: 'all',
  status: 'all',
  showArchived: false,
  showCancelled: false,
  sort: { key: 'next_renewal', dir: 'asc' },
  openMenuId: null,
};

const CATEGORIES = ['streaming', 'music', 'software', 'fitness', 'news', 'storage', 'gaming', 'shopping', 'cc_annual_fee', 'other'];
const CAT_LABELS = {
  streaming: 'Streaming', music: 'Music', software: 'Software', fitness: 'Fitness',
  news: 'News', storage: 'Storage', gaming: 'Gaming', shopping: 'Shopping',
  cc_annual_fee: 'CC Annual Fee', other: 'Other',
};
const STATUSES = ['active', 'trial', 'paused', 'cancelled'];
const FILTER_STATUSES = ['active', 'trial', 'paused']; // cancelled has its own section
const STATUS_LABELS = { active: 'Active', trial: 'Trial', paused: 'Paused', cancelled: 'Cancelled' };
const FREQUENCIES = ['monthly', 'quarterly', 'semi_annual', 'biannual', 'annual', 'biennial'];
const FREQ_LABELS = {
  monthly: 'Monthly', quarterly: 'Quarterly', semi_annual: 'Semi-annual',
  biannual: 'Biannual', annual: 'Annual', biennial: 'Biennial',
};

// For active subs, derive the next upcoming renewal from the stored anchor date
// rather than relying on the stored value being kept up to date manually.
function computedRenewal(sub) {
  if (!sub.next_renewal || sub.status === 'cancelled') return sub.next_renewal;
  const today = todayISO();
  if (sub.next_renewal >= today) return sub.next_renewal;
  const step = { monthly: 1, quarterly: 3, semi_annual: 6, biannual: 6, annual: 12, biennial: 24 }[sub.frequency] || 1;
  const d = new Date(sub.next_renewal + 'T00:00:00');
  while (d.toISOString().slice(0, 10) < today) {
    d.setMonth(d.getMonth() + step);
  }
  return d.toISOString().slice(0, 10);
}

function monthlyCost(sub) {
  const amt = sub.amount || 0;
  const f = sub.frequency;
  if (f === 'monthly') return amt;
  if (f === 'quarterly') return amt / 3;
  if (f === 'semi_annual' || f === 'biannual') return amt / 6;
  if (f === 'annual') return amt / 12;
  if (f === 'biennial') return amt / 24;
  return amt;
}

// Monthly equivalent of the subsidized portion.
// If subsidized_amount is set, normalize it like monthlyCost; otherwise assume fully covered.
function monthlySubsidy(sub) {
  if (!sub.billed_to) return 0;
  const amt = sub.subsidized_amount != null ? sub.subsidized_amount : (sub.amount || 0);
  const f = sub.frequency;
  if (f === 'monthly') return amt;
  if (f === 'quarterly') return amt / 3;
  if (f === 'semi_annual' || f === 'biannual') return amt / 6;
  if (f === 'annual') return amt / 12;
  if (f === 'biennial') return amt / 24;
  return amt;
}

function filterSubs(data) {
  const q = ui.search.trim().toLowerCase();
  return data.subscriptions.filter(s => {
    if (!ui.showArchived && s.archived) return false;
    if (s.status === 'cancelled') return false; // always in the separate section
    if (ui.who !== 'all' && s.who !== ui.who) return false;
    if (ui.category !== 'all' && s.category !== ui.category) return false;
    if (ui.status !== 'all' && s.status !== ui.status) return false;
    if (q && !(`${s.name} ${s.billed_to || ''} ${s.notes || ''}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

function filterCancelled(data) {
  const q = ui.search.trim().toLowerCase();
  return data.subscriptions.filter(s => {
    if (!ui.showArchived && s.archived) return false;
    if (s.status !== 'cancelled') return false;
    if (ui.who !== 'all' && s.who !== ui.who) return false;
    if (ui.category !== 'all' && s.category !== ui.category) return false;
    if (q && !(`${s.name} ${s.billed_to || ''} ${s.notes || ''}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

function sortSubs(subs) {
  const { key, dir } = ui.sort;
  const mul = dir === 'asc' ? 1 : -1;
  return [...subs].sort((a, b) => {
    let av, bv;
    switch (key) {
      case 'name': av = a.name || ''; bv = b.name || ''; return av.localeCompare(bv) * mul;
      case 'amount': av = a.amount || 0; bv = b.amount || 0; return (av - bv) * mul;
      case 'monthly': av = monthlyCost(a); bv = monthlyCost(b); return (av - bv) * mul;
      case 'next_renewal':
      default: av = computedRenewal(a) || '9999-99-99'; bv = computedRenewal(b) || '9999-99-99';
        return av.localeCompare(bv) * mul;
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

  const allFiltered = sortSubs(filterSubs(data));
  const filteredNonMonthly = allFiltered.filter(s => s.frequency !== 'monthly');
  const filteredMonthly    = allFiltered.filter(s => s.frequency === 'monthly');
  const cancelled = sortSubs(filterCancelled(data));

  const active = data.subscriptions.filter(s => !s.archived && s.status !== 'cancelled');
  const grossMonthly = active.reduce((a, s) => a + monthlyCost(s), 0);
  const subsidizedSubs = active.filter(s => s.billed_to && s.billed_to.trim());
  const subsidizedMonthly = subsidizedSubs.reduce((a, s) => a + monthlySubsidy(s), 0);
  const netMonthly = grossMonthly - subsidizedMonthly;

  // upcoming30: non-monthly only — monthly subs always renew, so they'd make this noisy
  const upcoming30 = active.filter(s => {
    if (s.frequency === 'monthly') return false;
    const d = daysFromToday(computedRenewal(s));
    return d != null && d >= 0 && d <= 30;
  });
  const trialsExpiring = active.filter(s =>
    s.status === 'trial' && s.trial_ends && daysFromToday(s.trial_ends) >= 0 && daysFromToday(s.trial_ends) <= 14
  );

  const hasNonMonthly = filteredNonMonthly.length > 0;
  const hasMonthly    = filteredMonthly.length > 0;

  page.innerHTML = `
    ${summaryHTML({ count: active.length, grossMonthly, subsidizedMonthly, subsidizedCount: subsidizedSubs.length, netMonthly, upcoming30, trialsExpiring })}
    ${trialsExpiring.length ? trialBannerHTML(trialsExpiring) : ''}
    ${filtersHTML()}
    ${!hasNonMonthly && !hasMonthly
      ? `<div class="empty"><h3>No subscriptions yet</h3><p>Click + Add subscription to create your first one.</p></div>`
      : `${hasNonMonthly ? tableHTML(filteredNonMonthly) : ''}
         ${hasMonthly ? monthlySectionHTML(filteredMonthly) : ''}`
    }
    ${cancelled.length ? cancelledSectionHTML(cancelled) : ''}
  `;

  wireInteractions();
}

function summaryHTML({ count, grossMonthly, subsidizedMonthly, subsidizedCount, netMonthly, upcoming30, trialsExpiring }) {
  const upcomingTotal = upcoming30.reduce((a, s) => a + (s.amount || 0), 0);
  return `
    <div class="summary">
      <div class="card">
        <div class="label">Active subs</div>
        <div class="value">${count}</div>
        <div class="sub">excl. cancelled/archived</div>
      </div>
      <div class="card">
        <div class="label">Gross monthly</div>
        <div class="value">${fmtMoney(grossMonthly)}</div>
        <div class="sub">${fmtMoneyShort(grossMonthly * 12)}/yr before subsidies</div>
      </div>
      <div class="card">
        <div class="label">Subsidized</div>
        <div class="value">${fmtMoney(subsidizedMonthly)}</div>
        <div class="sub">${subsidizedCount} sub${subsidizedCount !== 1 ? 's' : ''} covered by perks</div>
      </div>
      <div class="card">
        <div class="label">Net monthly</div>
        <div class="value">${fmtMoney(netMonthly)}</div>
        <div class="sub">${fmtMoneyShort(netMonthly * 12)}/yr out of pocket</div>
      </div>
      <div class="card">
        <div class="label">Non-monthly ≤ 30d</div>
        <div class="value ${upcoming30.length ? 'warn' : ''}">${upcoming30.length}</div>
        <div class="sub">${upcoming30.length ? `${fmtMoney(upcomingTotal)} coming up` : '—'}</div>
      </div>
    </div>
  `;
}

function trialBannerHTML(trials) {
  const first = trials[0];
  return `
    <div class="nag">
      ⚠️ <b>${trials.length} trial${trials.length === 1 ? '' : 's'} ending soon.</b>
      ${first.name} ends ${relativeDays(first.trial_ends)}${trials.length > 1 ? ` · +${trials.length - 1} more` : ''}
    </div>
  `;
}

function filtersHTML() {
  const chip = (val, label) => `<div class="chip ${ui.who === val ? 'active' : ''}" data-w="${val}">${label}</div>`;
  return `
    <div class="filters">
      <label class="search">
        <input id="f-search" placeholder="Search subscriptions…" value="${escapeAttr(ui.search)}"/>
      </label>
      <div class="chips" id="f-who">
        ${chip('all', 'All')}${chip('chang', 'Chang')}${chip('kiju', 'Kiju')}${chip('joint', 'Joint')}
      </div>
      <select class="select" id="f-category">
        <option value="all">All categories</option>
        ${CATEGORIES.map(c => `<option value="${c}" ${ui.category === c ? 'selected' : ''}>${CAT_LABELS[c]}</option>`).join('')}
      </select>
      <select class="select" id="f-status">
        <option value="all">All statuses</option>
        ${FILTER_STATUSES.map(s => `<option value="${s}" ${ui.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
      </select>
      <button class="btn primary" id="btn-add">+ Add subscription</button>
    </div>
  `;
}

function thSortable(key, label) {
  const active = ui.sort.key === key;
  const arrow = active ? (ui.sort.dir === 'asc' ? '▲' : '▼') : '▾';
  return `<th class="sortable ${active ? 'sorted' : ''}" data-sort="${key}">${label} <span class="sort-icon">${arrow}</span></th>`;
}

function tableHTML(subs) {
  const bodyRows = subs.map(s => subRowHTML(s)).join('');
  const tailDivider = '';

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${thSortable('name', 'Name')}
            <th>Who</th>
            <th>Category</th>
            <th>Subsidized by</th>
            <th>Subsidy $</th>
            ${thSortable('amount', 'Amount')}
            <th>Frequency</th>
            ${thSortable('monthly', 'Monthly eq.')}
            ${thSortable('next_renewal', 'Next renewal')}
            <th>Status</th>
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${bodyRows}${tailDivider}</tbody>
      </table>
    </div>
  `;
}

function monthlySectionHTML(subs) {
  return `
    <div class="monthly-section">
      <div class="monthly-section-hdr">
        <span class="monthly-section-title">Monthly</span>
        <span class="monthly-auto-badge">auto-renewing</span>
        <span class="cancelled-count" style="margin-left:4px">${subs.length}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${thSortable('name', 'Name')}
              <th>Who</th>
              <th>Category</th>
              <th>Subsidized by</th>
              <th>Subsidy $</th>
              ${thSortable('amount', 'Amount')}
              <th>Frequency</th>
              ${thSortable('monthly', 'Monthly eq.')}
              ${thSortable('next_renewal', 'Next renewal')}
              <th>Status</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${subs.map(s => subRowHTML(s)).join('')}</tbody>
        </table>
      </div>
    </div>
  `;
}

function cancelledSectionHTML(subs) {
  const arrow = ui.showCancelled ? '▲' : '▼';
  return `
    <div class="cancelled-section">
      <button class="cancelled-toggle" id="btn-cancelled-toggle">
        Cancelled <span class="cancelled-count">${subs.length}</span> ${arrow}
      </button>
      ${ui.showCancelled ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Who</th>
                <th>Category</th>
                <th>Subsidized by</th>
                <th>Amount</th>
                <th>Frequency</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${subs.map(s => cancelledRowHTML(s)).join('')}</tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;
}

function cancelledRowHTML(s) {
  return `
    <tr data-id="${s.id}" class="sub-cancelled">
      <td><b>${escapeHTML(s.name)}</b></td>
      <td>${whoPill(s.who)}</td>
      <td>${CAT_LABELS[s.category] || s.category || '—'}</td>
      <td class="note-cell" data-subsidized-sub-id="${s.id}" title="${escapeAttr(s.billed_to || '')}">${truncate(s.billed_to || '', 28)}</td>
      <td>${fmtMoney(s.amount)}</td>
      <td>${FREQ_LABELS[s.frequency] || s.frequency}</td>
      <td class="note-cell" data-note-sub-id="${s.id}" title="${escapeAttr(s.notes || '')}">${truncate(s.notes || '', 32)}</td>
      <td class="row-actions">
        <button class="del" data-del="${s.id}" title="Delete">✕</button>
        <button class="dots" data-menu="${s.id}">⋯</button>
        ${ui.openMenuId === s.id ? rowMenuHTML(s) : ''}
      </td>
    </tr>
  `;
}

function subRowHTML(s) {
  const renewal = computedRenewal(s);
  const days = renewal ? daysFromToday(renewal) : null;
  const urgency = days != null && days <= 7 ? 'renewal-due' : days != null && days <= 30 ? 'renewal-soon' : '';
  const renewalCell = renewal
    ? `<span class="${urgency}">${shortDate(renewal)} <span class="cell-amount-sub">${relativeDays(renewal)}</span></span>`
    : '—';
  return `
    <tr data-id="${s.id}" class="${s.archived ? 'archived' : ''} ${s.status === 'cancelled' ? 'sub-cancelled' : ''}">
      <td><b>${escapeHTML(s.name)}</b>${subsidizedBadge(s)}</td>
      <td>${whoPill(s.who)}</td>
      <td class="status-cell" data-cat-sub-id="${s.id}">${CAT_LABELS[s.category] || s.category || '—'}</td>
      <td class="note-cell" data-subsidized-sub-id="${s.id}" title="${escapeAttr(s.billed_to || '')}">${truncate(s.billed_to || '', 28)}</td>
      <td class="num editable-cell" data-subsidy-amt-id="${s.id}">${s.billed_to && s.subsidized_amount != null ? fmtMoney(s.subsidized_amount) : s.billed_to ? '<span class="muted">Full</span>' : '—'}</td>
      <td>${fmtMoney(s.amount)}</td>
      <td>${FREQ_LABELS[s.frequency] || s.frequency}</td>
      <td>${fmtMoney(monthlyCost(s))}</td>
      <td>${renewalCell}</td>
      <td class="status-cell" data-status-sub-id="${s.id}">${statusPill(s.status)}</td>
      <td class="note-cell" data-note-sub-id="${s.id}" title="${escapeAttr(s.notes || '')}">${truncate(s.notes || '', 32)}</td>
      <td class="row-actions">
        <button class="del" data-del="${s.id}" title="Delete">✕</button>
        <button class="dots" data-menu="${s.id}">⋯</button>
        ${ui.openMenuId === s.id ? rowMenuHTML(s) : ''}
      </td>
    </tr>
  `;
}

function statusPill(status) {
  const cls = {
    active:    's-paid',
    trial:     's-scheduled',
    paused:    's-skipped',
    cancelled: 's-needs_confirm',
  }[status] || 's-skipped';
  return `<span class="status ${cls}">${STATUS_LABELS[status] || status}</span>`;
}

function rowMenuHTML(s) {
  return `
    <div class="menu" data-id="${s.id}">
      <div class="menu-item" data-act="edit"><div class="title">✏️ Edit</div></div>
      <div class="menu-item" data-act="advance"><div class="title">↻ Advance renewal one period</div><div class="desc">Push next_renewal forward</div></div>
      ${s.status !== 'cancelled' ? `<div class="menu-item" data-act="cancel"><div class="title">❌ Mark cancelled</div></div>` : ''}
      ${s.status !== 'active' ? `<div class="menu-item" data-act="activate"><div class="title">✅ Mark active</div></div>` : ''}
      <div class="menu-sep"></div>
      <div class="menu-item" data-act="archive"><div class="title">🗄️ ${s.archived ? 'Unarchive' : 'Archive'}</div></div>
      <div class="menu-item danger" data-act="delete"><div class="title">🗑️ Delete</div></div>
    </div>
  `;
}

function wireInteractions() {
  document.getElementById('f-search')?.addEventListener('input', (e) => {
    ui.search = e.target.value; render(state.get());
    document.getElementById('f-search').focus();
  });
  document.getElementById('f-who')?.addEventListener('click', (e) => {
    const w = e.target.closest('[data-w]')?.dataset.w;
    if (!w) return;
    ui.who = w; render(state.get());
  });
  document.getElementById('f-category')?.addEventListener('change', (e) => { ui.category = e.target.value; render(state.get()); });
  document.getElementById('f-status')?.addEventListener('change', (e) => { ui.status = e.target.value; render(state.get()); });
  document.getElementById('btn-add')?.addEventListener('click', () => openSubForm());
  document.getElementById('btn-cancelled-toggle')?.addEventListener('click', () => {
    ui.showCancelled = !ui.showCancelled; render(state.get());
  });

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
      const sub = state.get().data?.subscriptions.find(s => s.id === id);
      if (!sub) return;
      if (!confirm(`Delete "${sub.name}"?`)) return;
      state.mutate(d => { d.subscriptions = d.subscriptions.filter(x => x.id !== id); }, `delete ${sub.name}`);
      toast(`Deleted: ${sub.name}`, 'info');
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
      render(state.get());
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

  // Inline status editing
  page.querySelectorAll('td.status-cell[data-status-sub-id]').forEach(td => {
    td.addEventListener('click', () => {
      if (td.querySelector('select')) return;
      const subId = td.dataset.statusSubId;
      const sub = state.get().data?.subscriptions.find(s => s.id === subId);
      if (!sub) return;
      td.innerHTML = '';
      const select = document.createElement('select');
      select.className = 'inline-select';
      STATUSES.forEach(st => {
        const opt = document.createElement('option');
        opt.value = st;
        opt.textContent = STATUS_LABELS[st];
        if (st === sub.status) opt.selected = true;
        select.appendChild(opt);
      });
      td.appendChild(select);
      select.focus();
      select.addEventListener('change', () => {
        const val = select.value;
        state.mutate(d => {
          const s = d.subscriptions.find(x => x.id === subId);
          if (s) s.status = val;
        }, `set status ${sub.name}`);
      });
      select.addEventListener('blur', () => render(state.get()));
      select.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') render(state.get());
      });
    });
  });

  // Inline category editing
  page.querySelectorAll('td.status-cell[data-cat-sub-id]').forEach(td => {
    td.addEventListener('click', () => {
      if (td.querySelector('select')) return;
      const subId = td.dataset.catSubId;
      const sub = state.get().data?.subscriptions.find(s => s.id === subId);
      if (!sub) return;
      td.innerHTML = '';
      const select = document.createElement('select');
      select.className = 'inline-select';
      CATEGORIES.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = CAT_LABELS[c];
        if (c === sub.category) opt.selected = true;
        select.appendChild(opt);
      });
      td.appendChild(select);
      select.focus();
      select.addEventListener('change', () => {
        state.mutate(d => {
          const s = d.subscriptions.find(x => x.id === subId);
          if (s) s.category = select.value;
        }, `set category ${sub.name}`);
      });
      select.addEventListener('blur', () => render(state.get()));
      select.addEventListener('keydown', (e) => { if (e.key === 'Escape') render(state.get()); });
    });
  });

  // Inline subsidy amount editing
  page.querySelectorAll('td.editable-cell[data-subsidy-amt-id]').forEach(td => {
    td.addEventListener('click', () => {
      if (td.querySelector('input')) return;
      const subId = td.dataset.subsidyAmtId;
      const sub = state.get().data?.subscriptions.find(s => s.id === subId);
      if (!sub || !sub.billed_to) return;
      const current = sub.subsidized_amount ?? '';
      td.innerHTML = '';
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.01';
      input.min = '0';
      input.className = 'note-input';
      input.style.textAlign = 'right';
      input.value = current;
      input.placeholder = sub.amount ?? '';
      td.appendChild(input);
      input.focus();
      input.select();

      function commit() {
        const raw = input.value.trim();
        const val = raw === '' ? null : Number(raw);
        if (val !== (sub.subsidized_amount ?? null)) {
          state.mutate(d => {
            const s = d.subscriptions.find(x => x.id === subId);
            if (s) s.subsidized_amount = val;
          }, `edit subsidy amount ${sub.name}`);
        } else {
          render(state.get());
        }
      }
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { input.blur(); }
        if (e.key === 'Escape') { input.removeEventListener('blur', commit); render(state.get()); }
      });
    });
  });

  // Inline subsidized-by editing
  page.querySelectorAll('td.note-cell[data-subsidized-sub-id]').forEach(td => {
    td.addEventListener('click', () => {
      if (td.querySelector('input')) return;
      const subId = td.dataset.subsidizedSubId;
      const sub = state.get().data?.subscriptions.find(s => s.id === subId);
      if (!sub) return;
      const current = sub.billed_to || '';
      td.innerHTML = '';
      const input = document.createElement('input');
      input.className = 'note-input';
      input.value = current;
      input.placeholder = 'e.g. Amex Platinum credit';
      td.appendChild(input);
      input.focus();
      input.select();

      function commit() {
        const val = input.value.trim();
        if (val !== current) {
          state.mutate(d => {
            const s = d.subscriptions.find(x => x.id === subId);
            if (s) s.billed_to = val;
          }, `edit subsidized by ${sub.name}`);
        } else {
          render(state.get());
        }
      }
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { input.blur(); }
        if (e.key === 'Escape') { input.removeEventListener('blur', commit); render(state.get()); }
      });
    });
  });

  // Inline note editing
  page.querySelectorAll('td.note-cell[data-note-sub-id]').forEach(td => {
    td.addEventListener('click', () => {
      if (td.querySelector('input')) return;
      const subId = td.dataset.noteSubId;
      const sub = state.get().data?.subscriptions.find(s => s.id === subId);
      if (!sub) return;
      const current = sub.notes || '';
      td.innerHTML = '';
      const input = document.createElement('input');
      input.className = 'note-input';
      input.value = current;
      td.appendChild(input);
      input.focus();
      input.select();

      function commit() {
        const val = input.value.trim();
        if (val !== current) {
          state.mutate(d => {
            const s = d.subscriptions.find(x => x.id === subId);
            if (s) s.notes = val;
          }, `edit note ${sub.name}`);
        } else {
          render(state.get());
        }
      }
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { input.blur(); }
        if (e.key === 'Escape') { input.removeEventListener('blur', commit); render(state.get()); }
      });
    });
  });
}

function advanceRenewal(sub) {
  if (!sub.next_renewal) return sub.next_renewal;
  const d = new Date(sub.next_renewal + 'T00:00:00');
  const step = { monthly: 1, quarterly: 3, semi_annual: 6, biannual: 6, annual: 12, biennial: 24 }[sub.frequency] || 1;
  d.setMonth(d.getMonth() + step);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function handleMenuAction(id, act) {
  const { data } = state.get();
  const sub = data.subscriptions.find(s => s.id === id);
  if (!sub) return;

  switch (act) {
    case 'edit': openSubForm(sub); break;
    case 'advance':
      state.mutate(d => {
        const s = d.subscriptions.find(x => x.id === id);
        if (s) s.next_renewal = advanceRenewal(s);
      }, `advance ${sub.name}`);
      toast(`Renewal advanced: ${sub.name}`, 'success');
      break;
    case 'cancel':
      state.mutate(d => { const s = d.subscriptions.find(x => x.id === id); if (s) s.status = 'cancelled'; }, `cancel ${sub.name}`);
      break;
    case 'activate':
      state.mutate(d => { const s = d.subscriptions.find(x => x.id === id); if (s) s.status = 'active'; }, `activate ${sub.name}`);
      break;
    case 'archive':
      state.mutate(d => { const s = d.subscriptions.find(x => x.id === id); if (s) s.archived = !s.archived; }, `archive ${sub.name}`);
      break;
    case 'delete':
      if (!confirm(`Delete "${sub.name}"?`)) return;
      state.mutate(d => { d.subscriptions = d.subscriptions.filter(x => x.id !== id); }, `delete ${sub.name}`);
      toast(`Deleted: ${sub.name}`, 'info');
      break;
  }
}

function openSubForm(existing) {
  const isEdit = !!existing;
  const s = existing || {
    id: uid(), name: '', who: 'chang', category: 'streaming', billed_to: '',
    subsidized_amount: null, amount: 0, frequency: 'monthly', next_renewal: todayISO(), status: 'active',
    trial_ends: null, covered_by_perk_id: null, archived: false, notes: '',
  };

  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `
    <div class="modal modal-lg">
      <h2>${isEdit ? 'Edit subscription' : 'Add subscription'}</h2>
      <div class="form-grid">
        <label class="field"><span>Name</span><input id="f-name" value="${escapeAttr(s.name)}" placeholder="Netflix"/></label>
        <label class="field"><span>Who</span>
          <select id="f-who-in">
            ${['chang','kiju','joint'].map(w => `<option value="${w}" ${s.who === w ? 'selected' : ''}>${WHO_LABEL[w]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Category</span>
          <select id="f-cat">
            ${CATEGORIES.map(c => `<option value="${c}" ${s.category === c ? 'selected' : ''}>${CAT_LABELS[c]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Subsidized by</span><input id="f-billed" value="${escapeAttr(s.billed_to || '')}" placeholder="e.g. Amex Platinum streaming credit"/></label>
        <label class="field"><span>Amount ($)</span><input id="f-amount" type="number" step="0.01" value="${s.amount ?? 0}"/></label>
        <label class="field"><span>Frequency</span>
          <select id="f-freq">
            ${FREQUENCIES.map(f => `<option value="${f}" ${s.frequency === f ? 'selected' : ''}>${FREQ_LABELS[f]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Next renewal</span><input id="f-renewal" type="date" value="${s.next_renewal || ''}"/></label>
        <label class="field"><span>Status</span>
          <select id="f-status-in">
            ${STATUSES.map(st => `<option value="${st}" ${s.status === st ? 'selected' : ''}>${STATUS_LABELS[st]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Trial ends (if trial)</span><input id="f-trial" type="date" value="${s.trial_ends || ''}"/></label>
        <label class="field full"><span>Notes</span><input id="f-notes" value="${escapeAttr(s.notes || '')}"/></label>
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
      name: el.querySelector('#f-name').value.trim(),
      who: el.querySelector('#f-who-in').value,
      category: el.querySelector('#f-cat').value,
      billed_to: el.querySelector('#f-billed').value.trim(),
      amount: Number(el.querySelector('#f-amount').value) || 0,
      frequency: el.querySelector('#f-freq').value,
      next_renewal: el.querySelector('#f-renewal').value || null,
      status: el.querySelector('#f-status-in').value,
      trial_ends: el.querySelector('#f-trial').value || null,
      notes: el.querySelector('#f-notes').value.trim(),
    };
    if (!patch.name) { alert('Name is required'); return; }

    state.mutate(d => {
      if (isEdit) {
        const idx = d.subscriptions.findIndex(x => x.id === s.id);
        if (idx >= 0) d.subscriptions[idx] = { ...d.subscriptions[idx], ...patch };
      } else {
        d.subscriptions.push({ ...s, ...patch });
      }
    }, isEdit ? `edit sub ${patch.name}` : `add sub ${patch.name}`);

    el.remove();
    toast(isEdit ? `Updated: ${patch.name}` : `Added: ${patch.name}`, 'success');
  };
}

function subsidizedBadge(s) {
  if (!s.billed_to) return '';
  const label = s.subsidized_amount != null ? `${fmtMoneyShort(s.subsidized_amount)} covered` : 'Subsidized';
  return ` <span class="badge-subsidized">${label}</span>`;
}

function truncate(s, max) {
  return s.length > max ? escapeHTML(s.slice(0, max)) + '…' : escapeHTML(s);
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escapeHTML(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

state.subscribe(render);
bootstrap();
