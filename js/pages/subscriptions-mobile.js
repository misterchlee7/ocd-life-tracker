import { state } from '../core/state.js';
import { bootstrap, showBottomSheet, whoPill, fmtMoney, fmtMoneyShort, toast, icon } from '../core/ui.js';
import { todayISO, shortDate, relativeDays, daysFromToday } from '../core/dates.js';
import { escapeHTML, SUB_STATUS_LABELS as STATUS_LABELS, SUB_CAT_LABELS as CAT_LABELS } from '../core/text.js';

const page = document.getElementById('page');

const ui = { filter: 'all' };

function computedRenewal(sub) {
  // non_renewing: next_renewal is a fixed end date — never roll it forward
  if (!sub.next_renewal || sub.frequency !== 'monthly' || sub.status === 'non_renewing') return sub.next_renewal;
  const today = todayISO();
  if (sub.next_renewal >= today) return sub.next_renewal;
  const d = new Date(sub.next_renewal + 'T00:00:00');
  while (d.toISOString().slice(0, 10) < today) d.setMonth(d.getMonth() + 1);
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

function monthlySubsidy(sub) {
  if (!sub.billed_to) return 0;
  const amt = sub.subsidized_amount != null ? sub.subsidized_amount : (sub.amount || 0);
  return monthlyCost({ ...sub, amount: amt });
}

function filteredSubs(data) {
  const subs = data.subscriptions.filter(s => !s.archived && s.status !== 'cancelled');
  if (ui.filter === 'all') return subs;
  return subs.filter(s => s.status === ui.filter);
}

// ---------- HTML builders ----------

function summaryStripHTML(data) {
  const active = data.subscriptions.filter(s => !s.archived && s.status !== 'cancelled');
  const grossMonthly = active.reduce((a, s) => a + monthlyCost(s), 0);
  const subsidized = active.reduce((a, s) => a + monthlySubsidy(s), 0);
  const netMonthly = grossMonthly - subsidized;
  const upcoming30 = active.filter(s => {
    if (s.frequency === 'monthly' || s.status === 'non_renewing') return false;
    const d = daysFromToday(computedRenewal(s));
    return d != null && d >= 0 && d <= 30;
  });

  return `
    <div class="m-summary-strip">
      <div class="m-summary-card">
        <div class="label">Active</div>
        <div class="value">${active.length}</div>
      </div>
      <div class="m-summary-card">
        <div class="label">Net monthly</div>
        <div class="value">${fmtMoney(netMonthly)}</div>
        <div class="sub">${fmtMoneyShort(grossMonthly)} gross</div>
      </div>
      <div class="m-summary-card">
        <div class="label">Renewing ≤30d</div>
        <div class="value ${upcoming30.length ? 'warn' : ''}">${upcoming30.length}</div>
        <div class="sub">non-monthly</div>
      </div>
    </div>
  `;
}

function filterBarHTML(data) {
  const subs = data.subscriptions.filter(s => !s.archived && s.status !== 'cancelled');
  const counts = { active: 0, trial: 0, paused: 0, non_renewing: 0 };
  subs.forEach(s => { if (s.status in counts) counts[s.status]++; });

  const chip = (val, label, count) => {
    if (val !== 'all' && count === 0) return '';
    const badge = count > 0 && val !== 'all' ? `<span class="m-chip-count">${count}</span>` : '';
    return `<button class="m-chip ${ui.filter === val ? 'active' : ''}" data-filter="${val}">${label}${badge}</button>`;
  };

  return `
    <div class="m-filter-bar">
      ${chip('all', 'All')}
      ${chip('active', 'Active', counts.active)}
      ${chip('trial', 'Trial', counts.trial)}
      ${chip('paused', 'Paused', counts.paused)}
      ${chip('non_renewing', "Won't renew", counts.non_renewing)}
    </div>
  `;
}

function statusBadge(status) {
  const cls = { active: 's-paid', trial: 's-scheduled', paused: 's-skipped', non_renewing: 's-needs_confirm', cancelled: 's-needs_confirm' }[status] || 's-skipped';
  return `<span class="status ${cls}">${STATUS_LABELS[status] || status}</span>`;
}

function renewalUrgencyClass(days) {
  if (days == null) return '';
  if (days <= 7) return 'renewal-due';
  if (days <= 30) return 'renewal-soon';
  return '';
}

function subCardHTML(sub) {
  const renewal = computedRenewal(sub);
  const days = renewal ? daysFromToday(renewal) : null;
  const urgCls = renewalUrgencyClass(days);
  const renewalText = renewal
    ? `<span class="${urgCls}">${sub.status === 'non_renewing' ? 'Ends ' : ''}${shortDate(renewal)}</span> <span style="color:var(--text-muted);font-size:11px">${relativeDays(renewal)}</span>`
    : '—';
  const subsidyBadge = sub.billed_to
    ? `<span class="pill type tiny" style="background:#eef6ff;color:#3b6fa8;border-color:#c2d8f0">${sub.subsidized_amount != null ? fmtMoneyShort(sub.subsidized_amount) + ' covered' : 'Subsidized'}</span>`
    : '';

  return `
    <div class="m-card" data-id="${sub.id}">
      <div class="m-card-header">
        <div>
          <div class="m-card-name">${escapeHTML(sub.name)}</div>
          <div class="m-card-name-sub">${CAT_LABELS[sub.category] || sub.category || '—'}</div>
        </div>
        <div>
          <div class="m-card-amount">${fmtMoney(sub.amount)}</div>
          <div class="m-card-amount-sub">${fmtMoneyShort(monthlyCost(sub))}/mo</div>
        </div>
      </div>
      <div class="m-card-footer">
        <div class="m-card-left">
          ${whoPill(sub.who)}
          ${statusBadge(sub.status)}
          ${subsidyBadge}
        </div>
        <div class="m-card-right" style="font-size:12px;color:var(--text-muted);text-align:right">
          ${renewalText}
          <button class="m-dots-btn" style="margin-left:6px" data-dots="${sub.id}">⋯</button>
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

  const subs = filteredSubs(data).sort((a, b) => {
    const ra = computedRenewal(a) || '9999-99-99';
    const rb = computedRenewal(b) || '9999-99-99';
    return ra.localeCompare(rb);
  });

  const trialsExpiring = data.subscriptions.filter(s =>
    s.status === 'trial' && s.trial_ends && daysFromToday(s.trial_ends) >= 0 && daysFromToday(s.trial_ends) <= 14
  );
  const trialBanner = trialsExpiring.length
    ? `<div class="nag" style="margin-bottom:10px">${icon('warning', 'sm')} <b>${trialsExpiring.length} trial${trialsExpiring.length !== 1 ? 's' : ''} ending soon</b> — ${escapeHTML(trialsExpiring[0].name)}${trialsExpiring.length > 1 ? ` · +${trialsExpiring.length - 1} more` : ''}</div>`
    : '';

  const listHTML = subs.length === 0
    ? `<div class="m-empty"><div class="m-empty-icon">↻</div><div class="m-empty-msg">No subscriptions here</div></div>`
    : `<div class="m-list">${subs.map(s => subCardHTML(s)).join('')}</div>`;

  page.innerHTML = summaryStripHTML(data) + trialBanner + filterBarHTML(data) + listHTML;
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

  page.querySelectorAll('[data-dots]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSubSheet(btn.dataset.dots);
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

function openSubSheet(subId) {
  const { data } = state.get();
  const sub = data.subscriptions.find(s => s.id === subId);
  if (!sub) return;

  showBottomSheet({
    title: sub.name,
    items: [
      sub.status !== 'non_renewing' ? {
        icon: '↻', label: 'Advance renewal one period',
        description: sub.next_renewal ? `Next: ${shortDate(advanceRenewal(sub))}` : '',
        action: () => {
          state.mutate(d => {
            const s = d.subscriptions.find(x => x.id === subId);
            if (s) s.next_renewal = advanceRenewal(s);
          }, `advance ${sub.name}`);
          toast(`Renewal advanced: ${sub.name}`, 'success');
        },
      } : null,
      sub.status !== 'cancelled' && sub.status !== 'non_renewing' ? {
        icon: '🚫', label: "Won't renew",
        description: sub.next_renewal ? `Auto-renew off — keep until ${shortDate(sub.next_renewal)}` : 'Auto-renew off',
        action: () => {
          state.mutate(d => { const s = d.subscriptions.find(x => x.id === subId); if (s) s.status = 'non_renewing'; }, `won't renew: ${sub.name}`);
          toast(`Won't renew: ${sub.name}`, 'info');
        },
      } : null,
      sub.status !== 'cancelled' ? {
        icon: '❌', label: 'Mark cancelled',
        action: () => {
          state.mutate(d => { const s = d.subscriptions.find(x => x.id === subId); if (s) s.status = 'cancelled'; }, `cancel ${sub.name}`);
          toast(`Cancelled: ${sub.name}`, 'info');
        },
      } : null,
      sub.status === 'cancelled' || sub.status === 'non_renewing' ? {
        icon: '✅', label: 'Mark active',
        action: () => {
          state.mutate(d => { const s = d.subscriptions.find(x => x.id === subId); if (s) s.status = 'active'; }, `activate ${sub.name}`);
          toast(`Activated: ${sub.name}`, 'success');
        },
      } : null,
      sub.status !== 'paused' ? {
        icon: '⏸', label: 'Mark paused',
        action: () => {
          state.mutate(d => { const s = d.subscriptions.find(x => x.id === subId); if (s) s.status = 'paused'; }, `pause ${sub.name}`);
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
