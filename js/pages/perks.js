import { state, uid } from '../core/state.js';
import { bootstrap, whoPill, fmtMoney, fmtMoneyShort, toast, WHO_LABEL } from '../core/ui.js';
import { periodFor, todayISO, shortDate } from '../core/dates.js';
import { claimsFor } from '../core/derive.js';

const page = document.getElementById('page');

// ---------- page-local UI state ----------

const ui = {
  month: todayISO().slice(0, 7),
  search: '',
  who: 'all',
  card: 'all',
  status: 'all',
  showArchived: false,
  openMenuId: null,
};

const STATUS_LABELS = {
  available: 'Available',
  claimed: 'Claimed',
  skipped: 'Skipped',
  expired: 'Expired',
};

const FREQUENCIES = ['monthly', 'quarterly', 'semi_annual', 'biannual', 'annual'];
const FREQ_LABELS = {
  monthly: 'Monthly', quarterly: 'Quarterly', semi_annual: 'Semi-annual',
  biannual: 'Biannual', annual: 'Annual',
};

// ---------- helpers ----------

function periodForPerk(perk, monthISO) {
  // Always use day 01 to avoid JS date rollover when reset_day exceeds month length.
  return periodFor(`${monthISO}-01`, perk.frequency);
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Periods per year for progress bar (only frequencies that partition a calendar year cleanly)
const PERIODS_PER_YEAR = { bimonthly: 6, quarterly: 4, semi_annual: 2, biannual: 2, annual: 1 };

function perkYearProgress(data, perk, year) {
  const total = PERIODS_PER_YEAR[perk.frequency];
  if (!total) return null;

  // Build the exact period strings for this frequency + year
  let expectedPeriods;
  if (perk.frequency === 'quarterly') {
    expectedPeriods = [1, 2, 3, 4].map(q => `${year}-Q${q}`);
  } else if (perk.frequency === 'biannual' || perk.frequency === 'semi_annual') {
    expectedPeriods = [1, 2].map(h => `${year}-H${h}`);
  } else if (perk.frequency === 'annual') {
    expectedPeriods = [String(year)];
  } else if (perk.frequency === 'bimonthly') {
    expectedPeriods = [1, 3, 5, 7, 9, 11].map(m => `${year}-${String(m).padStart(2, '0')}`);
  } else {
    return null;
  }

  const claimedPeriods = new Set(
    data.perk_claims
      .filter(c => c.perk_id === perk.id && c.status === 'claimed')
      .map(c => c.period)
  );

  const segments = expectedPeriods.map(p => ({ period: p, filled: claimedPeriods.has(p) }));
  const filled = segments.filter(s => s.filled).length;
  return { segments, filled, total };
}

function periodShortLabel(period) {
  if (!period) return '';
  if (period.includes('-Q')) return period.split('-')[1];   // "Q2"
  if (period.includes('-H')) return period.split('-')[1];   // "H1"
  if (/^\d{4}$/.test(period)) return 'Annual';
  return '';
}

function claimForRow(data, perk) {
  const period = periodForPerk(perk, ui.month);
  const c = data.perk_claims.find(x => x.perk_id === perk.id && x.period === period);
  return { status: c ? c.status : 'available', claim: c, period };
}

function filterPerks(data) {
  const q = ui.search.trim().toLowerCase();
  return data.perks.filter(p => {
    if (!ui.showArchived && p.archived) return false;
    if (ui.who !== 'all' && p.who !== ui.who) return false;
    if (ui.card !== 'all' && p.card !== ui.card) return false;
    if (ui.status !== 'all') {
      const { status } = claimForRow(data, p);
      if (status !== ui.status) return false;
    }
    if (q && !(`${p.card} ${p.name} ${p.notes || ''}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

function groupByCard(perks) {
  const map = new Map();
  for (const p of perks) {
    const key = p.card || '—';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function uniqueCards(data) {
  return [...new Set(data.perks.map(p => p.card).filter(Boolean))].sort();
}

function cardAnnualFee(perks) {
  return perks.reduce((acc, p) => Math.max(acc, p.annual_fee_card || 0), 0);
}

function ytdClaimed(data, perkId, year) {
  return data.perk_claims
    .filter(c => c.perk_id === perkId && c.status === 'claimed' && (c.period || '').startsWith(String(year)))
    .length;
}

function cardYTDValue(data, perks, year) {
  return perks.reduce((acc, p) => acc + ytdClaimed(data, p.id, year) * (p.value || 0), 0);
}

function cardAvailableThisPeriod(data, perks) {
  return perks.reduce((acc, p) => {
    const { status } = claimForRow(data, p);
    return status === 'available' ? acc + (p.value || 0) : acc;
  }, 0);
}

// ---------- render ----------

function render({ data, loading }) {
  if (!data) {
    page.innerHTML = loading
      ? `<div class="empty"><h3>Loading…</h3></div>`
      : `<div class="empty"><h3>Not connected</h3><p>Open settings (⚙) to configure your GitHub data repo.</p></div>`;
    return;
  }

  const year = Number(ui.month.slice(0, 4));
  const filtered = filterPerks(data);
  const grouped = groupByCard(filtered);

  // summary across ALL (unfiltered) non-archived perks
  const allActive = data.perks.filter(p => !p.archived);
  const monthlyAvailable = allActive.reduce((acc, p) => {
    if (p.frequency !== 'monthly') return acc;
    const { status } = claimForRow(data, p);
    return status === 'available' ? acc + (p.value || 0) : acc;
  }, 0);
  const nonMonthlyAvailable = allActive.reduce((acc, p) => {
    if (p.frequency === 'monthly') return acc;
    const { status } = claimForRow(data, p);
    return status === 'available' ? acc + (p.value || 0) : acc;
  }, 0);
  const claimedYTD = allActive.reduce((acc, p) => acc + ytdClaimed(data, p.id, year) * (p.value || 0), 0);
  const totalAnnualFees = [...new Set(allActive.map(p => p.card))]
    .reduce((acc, card) => acc + cardAnnualFee(allActive.filter(p => p.card === card)), 0);
  const netRoi = claimedYTD - totalAnnualFees;

  page.innerHTML = `
    ${summaryHTML({ monthlyAvailable, nonMonthlyAvailable, claimedYTD, netRoi, totalAnnualFees })}
    ${filtersHTML(data)}
    ${grouped.length === 0
      ? `<div class="empty"><h3>No perks yet</h3><p>Click + Add perk to create your first one.</p></div>`
      : grouped.map(([card, perks]) => cardSectionHTML(data, card, perks, year)).join('')}
  `;

  wireInteractions(data);
}

function summaryHTML({ monthlyAvailable, nonMonthlyAvailable, claimedYTD, netRoi, totalAnnualFees }) {
  const roiClass = netRoi >= 0 ? '' : 'warn';
  return `
    <div class="summary">
      <div class="card">
        <div class="label">Monthly available</div>
        <div class="value">${fmtMoney(monthlyAvailable)}</div>
        <div class="sub">unclaimed monthly perks</div>
      </div>
      <div class="card">
        <div class="label">Non-monthly available</div>
        <div class="value">${fmtMoney(nonMonthlyAvailable)}</div>
        <div class="sub">quarterly, biannual, annual…</div>
      </div>
      <div class="card">
        <div class="label">Net ROI YTD</div>
        <div class="value ${roiClass}">${fmtMoney(netRoi)}</div>
        <div class="sub">${fmtMoneyShort(claimedYTD)} claimed − ${fmtMoneyShort(totalAnnualFees)} fees</div>
      </div>
    </div>
  `;
}

function filtersHTML(data) {
  const cards = uniqueCards(data);
  const chip = (val, label) => `<div class="chip ${ui.who === val ? 'active' : ''}" data-w="${val}">${label}</div>`;
  return `
    <div class="filters">
      <label class="search">
        <input id="f-search" placeholder="Search perks…" value="${escapeAttr(ui.search)}"/>
      </label>
      <div class="chips" id="f-who">
        ${chip('all', 'All')}${chip('chang', 'Chang')}${chip('kiju', 'Kiju')}${chip('joint', 'Joint')}
      </div>
      <select class="select" id="f-card">
        <option value="all">All cards</option>
        ${cards.map(c => `<option value="${escapeAttr(c)}" ${ui.card === c ? 'selected' : ''}>${escapeHTML(c)}</option>`).join('')}
      </select>
      <select class="select" id="f-status">
        <option value="all">All statuses</option>
        ${Object.entries(STATUS_LABELS).map(([k, v]) =>
          `<option value="${k}" ${ui.status === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
      <button class="btn primary" id="btn-add">+ Add perk</button>
      <div class="month-nav">
        <button class="icon-btn" id="nav-prev" title="Previous">‹</button>
        <div class="month-label">${monthLabel(ui.month)}</div>
        <button class="icon-btn" id="nav-next" title="Next">›</button>
      </div>
    </div>
  `;
}

function cardSectionHTML(data, card, perks, year) {
  const fee = cardAnnualFee(perks);
  const ytdVal = cardYTDValue(data, perks, year);
  const available = cardAvailableThisPeriod(data, perks);
  const roi = ytdVal - fee;
  const roiClass = roi >= 0 ? 'pos' : 'neg';
  const feeStr = fee > 0 ? `${fmtMoney(fee)} fee` : 'no fee';
  const pct = fee > 0 ? Math.min(100, Math.round((ytdVal / fee) * 100)) : null;

  return `
    <div class="card-section">
      <div class="card-header">
        <div class="card-title">${escapeHTML(card)}</div>
        <div class="card-stats">
          <span class="stat">${feeStr}</span>
          <span class="stat">YTD claimed: <b>${fmtMoney(ytdVal)}</b></span>
          <span class="stat">Available now: <b>${fmtMoney(available)}</b></span>
          ${pct != null ? `<span class="stat ${roiClass}">ROI: ${pct}% (${fmtMoney(roi)})</span>` : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table class="perks-table">
          <thead>
            <tr>
              <th>Perk</th>
              <th>Who</th>
              <th>Frequency</th>
              <th>Value</th>
              <th>This period</th>
              <th class="center">Last claimed</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${perks.map(p => perkRowHTML(data, p)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function perkRowHTML(data, perk) {
  const { status, period } = claimForRow(data, perk);
  const claims = claimsFor(data, perk.id);
  const lastClaim = claims.find(c => c.status === 'claimed' && c.claimed_date);
  const year = Number(ui.month.slice(0, 4));
  const yp = perkYearProgress(data, perk, year);
  const pLabel = periodShortLabel(period);

  const pLabelClass = status === 'claimed' ? 'done' : status === 'skipped' ? 'skip' : 'todo';
  const pLabelHTML = pLabel
    ? `<span class="period-lbl ${pLabelClass}">${pLabel}</span> · `
    : '';

  const thisPeriod = yp
    ? `<div class="perk-this-period">
        ${statusPill(status, perk.id)}
        <div class="year-progress">
          ${yp.segments.map(seg =>
            `<span class="seg ${seg.filled ? 'filled' : ''} ${seg.period === period ? 'curr' : ''}"></span>`
          ).join('')}
          <span class="lbl">${pLabelHTML}${year} · ${yp.filled}/${yp.total}</span>
        </div>
       </div>`
    : statusPill(status, perk.id);

  return `
    <tr data-id="${perk.id}" class="${perk.archived ? 'archived' : ''}">
      <td><b>${escapeHTML(perk.name)}</b></td>
      <td>${whoPill(perk.who)}</td>
      <td>${FREQ_LABELS[perk.frequency] || perk.frequency}</td>
      <td>${fmtMoney(perk.value)}</td>
      <td>${thisPeriod}</td>
      <td class="center editable-cell" data-lastclaimed-perk-id="${perk.id}" data-lastclaimed-claim-id="${lastClaim?.id || ''}">${lastClaim ? shortDate(lastClaim.claimed_date) : '—'}</td>
      <td class="note-cell" data-note-perk-id="${perk.id}" title="${escapeAttr(perk.notes || '')}">${truncate(perk.notes || '', 32)}</td>
      <td class="row-actions">
        <button class="del" data-del="${perk.id}" title="Delete">✕</button>
        <button class="dots" data-menu="${perk.id}" title="Actions">⋯</button>
        ${ui.openMenuId === perk.id ? rowMenuHTML(perk, status) : ''}
      </td>
    </tr>
  `;
}

function statusPill(status, perkId) {
  const cls = {
    available: 's-scheduled',
    claimed:   's-paid',
    skipped:   's-skipped',
    expired:   's-needs_confirm',
  }[status] || 's-scheduled';
  return `<button class="status clickable ${cls}" data-cycle="${perkId}">${STATUS_LABELS[status]}</button>`;
}

function rowMenuHTML(perk, status) {
  return `
    <div class="menu">
      <div class="menu-item" data-act="edit"><div class="title">✏️ Edit perk</div></div>
      ${status !== 'claimed' ? `<div class="menu-item" data-act="claim"><div class="title">✅ Mark claimed today</div></div>` : ''}
      ${status !== 'skipped' ? `<div class="menu-item" data-act="skip"><div class="title">➖ Mark skipped</div></div>` : ''}
      ${status !== 'available' ? `<div class="menu-item" data-act="reset"><div class="title">↺ Reset to available</div></div>` : ''}
      <div class="menu-sep"></div>
      <div class="menu-item" data-act="archive"><div class="title">🗄️ ${perk.archived ? 'Unarchive' : 'Archive'} perk</div></div>
      <div class="menu-item danger" data-act="delete"><div class="title">🗑️ Delete perk</div></div>
    </div>
  `;
}

// ---------- interactions ----------

function wireInteractions(data) {
  document.getElementById('f-search')?.addEventListener('input', (e) => {
    ui.search = e.target.value;
    render(state.get());
    document.getElementById('f-search').focus();
  });
  document.getElementById('f-who')?.addEventListener('click', (e) => {
    const w = e.target.dataset.w;
    if (!w) return;
    ui.who = w; render(state.get());
  });
  document.getElementById('f-card')?.addEventListener('change', (e) => {
    ui.card = e.target.value; render(state.get());
  });
  document.getElementById('f-status')?.addEventListener('change', (e) => {
    ui.status = e.target.value; render(state.get());
  });
  document.getElementById('nav-prev')?.addEventListener('click', () => {
    ui.month = shiftMonth(ui.month, -1); render(state.get());
  });
  document.getElementById('nav-next')?.addEventListener('click', () => {
    ui.month = shiftMonth(ui.month, 1); render(state.get());
  });
  document.getElementById('btn-add')?.addEventListener('click', () => openPerkForm());

  page.querySelectorAll('[data-cycle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      cycleStatus(btn.dataset.cycle);
    });
  });

  page.querySelectorAll('button.del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      const perk = state.get().data?.perks.find(p => p.id === id);
      if (!perk) return;
      if (!confirm(`Delete "${perk.name}"?`)) return;
      state.mutate(d => {
        d.perks = d.perks.filter(x => x.id !== id);
        d.perk_claims = d.perk_claims.filter(x => x.perk_id !== id);
      }, `delete ${perk.name}`);
      toast(`Deleted: ${perk.name}`, 'info');
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
      const row = item.closest('tr');
      const id = row?.dataset.id;
      if (!id) return;
      handleMenuAction(id, item.dataset.act);
      ui.openMenuId = null;
      render(state.get());
    });
  });

  if (ui.openMenuId) {
    document.addEventListener('click', () => { ui.openMenuId = null; render(state.get()); }, { once: true });
  }

  // Flip any open menu that would overflow the viewport bottom
  page.querySelectorAll('.menu').forEach(menu => {
    if (menu.getBoundingClientRect().bottom > window.innerHeight - 8) {
      menu.classList.add('menu-up');
    }
  });

  // Inline note editing
  page.querySelectorAll('td.note-cell[data-note-perk-id]').forEach(td => {
    td.addEventListener('click', () => {
      if (td.querySelector('input')) return;
      const perkId = td.dataset.notePerkId;
      const perk = state.get().data?.perks.find(p => p.id === perkId);
      if (!perk) return;
      const current = perk.notes || '';
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
            const p = d.perks.find(x => x.id === perkId);
            if (p) p.notes = val;
          }, `edit note ${perk.name}`);
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

  // Inline last-claimed date editing
  page.querySelectorAll('td.editable-cell[data-lastclaimed-perk-id]').forEach(td => {
    td.addEventListener('click', () => {
      if (td.querySelector('input')) return;
      const perkId = td.dataset.lastclaimedPerkId;
      const claimId = td.dataset.lastclaimedClaimId;
      const { data } = state.get();
      const perk = data?.perks.find(p => p.id === perkId);
      if (!perk) return;
      const existingClaim = claimId ? data.perk_claims.find(c => c.id === claimId) : null;
      const current = existingClaim?.claimed_date || todayISO();

      td.innerHTML = '';
      const input = document.createElement('input');
      input.type = 'date';
      input.className = 'note-input';
      input.value = current;
      td.appendChild(input);
      input.focus();

      function commit() {
        const val = input.value;
        if (!val) { render(state.get()); return; }
        // Derive the period from the entered date, not from ui.month
        const derivedPeriod = periodForPerk(perk, val.slice(0, 7));
        if (existingClaim) {
          if (val !== existingClaim.claimed_date) {
            state.mutate(d => {
              const c = d.perk_claims.find(x => x.id === claimId);
              if (c) { c.claimed_date = val; c.period = derivedPeriod; }
            }, `edit claimed date ${perk.name}`);
          } else {
            render(state.get());
          }
        } else {
          state.mutate(d => {
            d.perk_claims.push({
              id: uid(),
              perk_id: perkId,
              period: derivedPeriod,
              status: 'claimed',
              claimed_date: val,
              notes: '',
            });
          }, `set claimed date ${perk.name}`);
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

function cycleStatus(perkId) {
  const { data } = state.get();
  const perk = data.perks.find(p => p.id === perkId);
  if (!perk) return;
  const period = periodForPerk(perk, ui.month);
  const existing = data.perk_claims.find(c => c.perk_id === perkId && c.period === period);
  const curr = existing?.status || 'available';
  const next = { available: 'claimed', claimed: 'skipped', skipped: 'available', expired: 'available' }[curr] || 'available';

  state.mutate(d => {
    const c = d.perk_claims.find(x => x.perk_id === perkId && x.period === period);
    if (next === 'available') {
      if (c) d.perk_claims = d.perk_claims.filter(x => x !== c);
    } else if (c) {
      c.status = next;
      c.claimed_date = next === 'claimed' ? todayISO() : null;
    } else {
      d.perk_claims.push({
        id: uid(),
        perk_id: perkId,
        period,
        status: next,
        claimed_date: next === 'claimed' ? todayISO() : null,
        notes: '',
      });
    }
  }, `cycle perk ${perk.name}`);
}

function handleMenuAction(id, act) {
  const { data } = state.get();
  const perk = data.perks.find(p => p.id === id);
  if (!perk) return;
  const period = periodForPerk(perk, ui.month);

  switch (act) {
    case 'edit':
      openPerkForm(perk);
      break;
    case 'claim':
      state.mutate(d => {
        const c = d.perk_claims.find(x => x.perk_id === id && x.period === period);
        if (c) { c.status = 'claimed'; c.claimed_date = todayISO(); }
        else d.perk_claims.push({ id: uid(), perk_id: id, period, status: 'claimed', claimed_date: todayISO(), notes: '' });
      }, `claim ${perk.name}`);
      toast(`Claimed: ${perk.name}`, 'success');
      break;
    case 'skip':
      state.mutate(d => {
        const c = d.perk_claims.find(x => x.perk_id === id && x.period === period);
        if (c) { c.status = 'skipped'; c.claimed_date = null; }
        else d.perk_claims.push({ id: uid(), perk_id: id, period, status: 'skipped', claimed_date: null, notes: '' });
      }, `skip ${perk.name}`);
      break;
    case 'reset':
      state.mutate(d => {
        d.perk_claims = d.perk_claims.filter(x => !(x.perk_id === id && x.period === period));
      }, `reset ${perk.name}`);
      break;
    case 'archive':
      state.mutate(d => {
        const p = d.perks.find(x => x.id === id);
        if (p) p.archived = !p.archived;
      }, `archive ${perk.name}`);
      break;
    case 'delete':
      if (!confirm(`Delete "${perk.name}" and all claim history?`)) return;
      state.mutate(d => {
        d.perks = d.perks.filter(x => x.id !== id);
        d.perk_claims = d.perk_claims.filter(x => x.perk_id !== id);
      }, `delete ${perk.name}`);
      toast(`Deleted: ${perk.name}`, 'info');
      break;
  }
}

// ---------- add/edit modal ----------

function openPerkForm(existing) {
  const isEdit = !!existing;
  const p = existing || {
    id: uid(), card: '', name: '', who: 'chang', frequency: 'monthly',
    value: 0, reset_day: 1, annual_fee_card: 0, archived: false, notes: '',
  };

  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `
    <div class="modal modal-lg">
      <h2>${isEdit ? 'Edit perk' : 'Add perk'}</h2>
      <div class="form-grid">
        <label class="field"><span>Card</span><input id="f-card-in" value="${escapeAttr(p.card)}" placeholder="Amex Platinum"/></label>
        <label class="field"><span>Perk name</span><input id="f-name" value="${escapeAttr(p.name)}" placeholder="Uber Eats credit"/></label>
        <label class="field"><span>Who</span>
          <select id="f-who-in">
            ${['chang', 'kiju', 'joint'].map(w => `<option value="${w}" ${p.who === w ? 'selected' : ''}>${WHO_LABEL[w]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Frequency</span>
          <select id="f-freq">
            ${FREQUENCIES.map(f => `<option value="${f}" ${p.frequency === f ? 'selected' : ''}>${FREQ_LABELS[f]}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Value ($)</span><input id="f-value" type="number" step="0.01" value="${p.value ?? 0}"/></label>
        <label class="field"><span>Reset day</span><input id="f-reset" type="number" min="1" max="31" value="${p.reset_day ?? 1}"/></label>
        <label class="field"><span>Annual fee (card)</span><input id="f-fee" type="number" step="0.01" value="${p.annual_fee_card ?? 0}"/></label>
        <label class="field full"><span>Notes</span><input id="f-notes" value="${escapeAttr(p.notes || '')}"/></label>
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
      card: el.querySelector('#f-card-in').value.trim(),
      name: el.querySelector('#f-name').value.trim(),
      who: el.querySelector('#f-who-in').value,
      frequency: el.querySelector('#f-freq').value,
      value: Number(el.querySelector('#f-value').value) || 0,
      reset_day: Number(el.querySelector('#f-reset').value) || 1,
      annual_fee_card: Number(el.querySelector('#f-fee').value) || 0,
      notes: el.querySelector('#f-notes').value.trim(),
    };
    if (!patch.card || !patch.name) { alert('Card and name are required'); return; }

    state.mutate(d => {
      if (isEdit) {
        const idx = d.perks.findIndex(x => x.id === p.id);
        if (idx >= 0) d.perks[idx] = { ...d.perks[idx], ...patch };
      } else {
        d.perks.push({ ...p, ...patch });
      }
    }, isEdit ? `edit perk ${patch.name}` : `add perk ${patch.name}`);

    el.remove();
    toast(isEdit ? `Updated: ${patch.name}` : `Added: ${patch.name}`, 'success');
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
