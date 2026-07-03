import { state, uid } from '../core/state.js';
import {
  bootstrap, showBottomSheet, whoPill, fmtMoney, fmtMoneyShort, toast,
  monthNavClass, monthNavLabelHTML, monthBannerHTML,
} from '../core/ui.js';
import { periodFor, todayISO } from '../core/dates.js';
import { escapeHTML, PERK_STATUS_LABELS as STATUS_LABELS, FREQ_LABELS as FREQ_SHORT } from '../core/text.js';

const page = document.getElementById('page');

const ui = {
  month: todayISO().slice(0, 7),
  filter: 'all',
};

function periodForPerk(perk) {
  return periodFor(`${ui.month}-01`, perk.frequency);
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function claimForPerk(data, perk) {
  const period = periodForPerk(perk);
  const c = data.perk_claims.find(x => x.perk_id === perk.id && x.period === period);
  return { status: c ? c.status : 'available', claim: c, period };
}

function filteredPerks(data) {
  const active = data.perks.filter(p => !p.archived);
  if (ui.filter === 'all') return active;
  return active.filter(p => claimForPerk(data, p).status === ui.filter);
}

// ---------- HTML builders ----------

function monthNavHTML() {
  return `
    <div class="m-month-nav">
      <button data-nav="-1">‹</button>
      <div class="m-month-label ${monthNavClass(ui.month)}">${monthNavLabelHTML(ui.month)}</div>
      <button data-nav="1">›</button>
    </div>
  `;
}

function summaryStripHTML(data) {
  const year = Number(ui.month.slice(0, 4));
  const active = data.perks.filter(p => !p.archived);
  const monthlyAvail = active.reduce((acc, p) => {
    if (p.frequency !== 'monthly') return acc;
    return claimForPerk(data, p).status === 'available' ? acc + (p.value || 0) : acc;
  }, 0);
  const nonMonthlyAvail = active.reduce((acc, p) => {
    if (p.frequency === 'monthly') return acc;
    return claimForPerk(data, p).status === 'available' ? acc + (p.value || 0) : acc;
  }, 0);
  const claimedYTD = active.reduce((acc, p) => {
    const n = data.perk_claims.filter(c =>
      c.perk_id === p.id && c.status === 'claimed' && (c.period || '').startsWith(String(year))
    ).length;
    return acc + n * (p.value || 0);
  }, 0);
  const fees = [...new Set(active.map(p => p.card))].reduce((acc, card) => {
    return acc + active.filter(p => p.card === card).reduce((a, p) => Math.max(a, p.annual_fee_card || 0), 0);
  }, 0);
  const roi = claimedYTD - fees;

  return `
    <div class="m-summary-strip">
      <div class="m-summary-card">
        <div class="label">Monthly avail.</div>
        <div class="value">${fmtMoney(monthlyAvail)}</div>
      </div>
      <div class="m-summary-card">
        <div class="label">Other avail.</div>
        <div class="value">${fmtMoney(nonMonthlyAvail)}</div>
      </div>
      <div class="m-summary-card">
        <div class="label">Net ROI YTD</div>
        <div class="value ${roi < 0 ? 'warn' : ''}">${fmtMoney(roi)}</div>
        <div class="sub">${fmtMoneyShort(claimedYTD)} claimed</div>
      </div>
    </div>
  `;
}

function filterBarHTML(data) {
  const active = data.perks.filter(p => !p.archived);
  const counts = { available: 0, claimed: 0, skipped: 0 };
  active.forEach(p => {
    const s = claimForPerk(data, p).status;
    if (s in counts) counts[s]++;
  });

  const chip = (val, label, count) => {
    if (val !== 'all' && count === 0) return '';
    const countBadge = count > 0 && val !== 'all'
      ? `<span class="m-chip-count">${count}</span>` : '';
    return `<button class="m-chip ${ui.filter === val ? 'active' : ''}" data-filter="${val}">${label}${countBadge}</button>`;
  };

  return `
    <div class="m-filter-bar">
      ${chip('all', 'All')}
      ${chip('available', 'Available', counts.available)}
      ${chip('claimed', 'Claimed', counts.claimed)}
      ${chip('skipped', 'Skipped', counts.skipped)}
    </div>
  `;
}

function statusBadge(status) {
  const map = {
    available: 's-scheduled',
    claimed: 's-paid',
    skipped: 's-skipped',
    expired: 's-needs_confirm',
  };
  return `<span class="status ${map[status] || 's-scheduled'}">${STATUS_LABELS[status] || status}</span>`;
}

function perkCardHTML(perk, data) {
  const { status } = claimForPerk(data, perk);
  const actionMap = {
    available: `<button class="m-action-btn primary" data-action="claim" data-id="${perk.id}">Claim</button>`,
    claimed:   `<button class="m-action-btn success" data-action="cycle" data-id="${perk.id}">Claimed ✓</button>`,
    skipped:   `<button class="m-action-btn muted" data-action="cycle" data-id="${perk.id}">Skipped</button>`,
    expired:   `<span class="status s-needs_confirm">Expired</span>`,
  };
  const btn = actionMap[status] || '';

  return `
    <div class="m-card" data-id="${perk.id}">
      <div class="m-card-header">
        <div>
          <div class="m-card-name">${escapeHTML(perk.name)}</div>
          <div class="m-card-name-sub">${escapeHTML(perk.card)} · ${FREQ_SHORT[perk.frequency] || perk.frequency}</div>
        </div>
        <div>
          <div class="m-card-amount">${fmtMoney(perk.value)}</div>
        </div>
      </div>
      <div class="m-card-footer">
        <div class="m-card-left">
          ${whoPill(perk.who)}
          ${statusBadge(status)}
        </div>
        <div class="m-card-right">
          ${btn}
          <button class="m-dots-btn" data-dots="${perk.id}">⋯</button>
        </div>
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

  const perks = filteredPerks(data);
  const listHTML = perks.length === 0
    ? `<div class="m-empty"><div class="m-empty-icon">★</div><div class="m-empty-msg">No perks here</div></div>`
    : `<div class="m-list">${perks.map(p => perkCardHTML(p, data)).join('')}</div>`;

  page.innerHTML = monthBannerHTML(ui.month) + monthNavHTML() + summaryStripHTML(data) + filterBarHTML(data) + listHTML;
  wireInteractions(data);
}

// ---------- interactions ----------

function wireInteractions(data) {
  page.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      ui.month = shiftMonth(ui.month, +btn.dataset.nav);
      render(state.get());
    });
  });
  page.querySelector('[data-month-today]')?.addEventListener('click', () => {
    ui.month = todayISO().slice(0, 7);
    render(state.get());
  });

  page.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      ui.filter = btn.dataset.filter;
      render(state.get());
    });
  });

  page.querySelectorAll('[data-action="claim"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      claimPerk(btn.dataset.id);
    });
  });

  page.querySelectorAll('[data-action="cycle"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      cyclePerk(btn.dataset.id);
    });
  });

  page.querySelectorAll('[data-dots]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPerkSheet(btn.dataset.dots);
    });
  });
}

function claimPerk(perkId) {
  const { data } = state.get();
  const perk = data.perks.find(p => p.id === perkId);
  if (!perk) return;
  const period = periodForPerk(perk);
  state.mutate(d => {
    const c = d.perk_claims.find(x => x.perk_id === perkId && x.period === period);
    if (c) { c.status = 'claimed'; c.claimed_date = todayISO(); }
    else d.perk_claims.push({ id: uid(), perk_id: perkId, period, status: 'claimed', claimed_date: todayISO(), notes: '' });
  }, `claim ${perk.name}`);
  toast(`Claimed: ${perk.name}`, 'success');
}

function cyclePerk(perkId) {
  const { data } = state.get();
  const perk = data.perks.find(p => p.id === perkId);
  if (!perk) return;
  const period = periodForPerk(perk);
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
      d.perk_claims.push({ id: uid(), perk_id: perkId, period, status: next, claimed_date: next === 'claimed' ? todayISO() : null, notes: '' });
    }
  }, `${next} perk: ${perk.name}`);
}

function openPerkSheet(perkId) {
  const { data } = state.get();
  const perk = data.perks.find(p => p.id === perkId);
  if (!perk) return;
  const { status } = claimForPerk(data, perk);

  showBottomSheet({
    title: perk.name,
    items: [
      status !== 'claimed' ? {
        icon: '✅', label: 'Mark claimed today',
        action: () => claimPerk(perkId),
      } : null,
      status !== 'skipped' ? {
        icon: '➖', label: 'Mark skipped',
        action: () => {
          const period = periodForPerk(perk);
          state.mutate(d => {
            const c = d.perk_claims.find(x => x.perk_id === perkId && x.period === period);
            if (c) { c.status = 'skipped'; c.claimed_date = null; }
            else d.perk_claims.push({ id: uid(), perk_id: perkId, period, status: 'skipped', claimed_date: null, notes: '' });
          }, `skip ${perk.name}`);
        },
      } : null,
      status !== 'available' ? {
        icon: '↺', label: 'Reset to available',
        action: () => {
          const period = periodForPerk(perk);
          state.mutate(d => {
            d.perk_claims = d.perk_claims.filter(x => !(x.perk_id === perkId && x.period === period));
          }, `reset ${perk.name}`);
        },
      } : null,
    ].filter(Boolean),
  });
}

// ---------- boot ----------

export function init() {
  state.subscribe(render);
  bootstrap();
}
