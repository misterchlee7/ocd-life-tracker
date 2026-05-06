// Shared UI: topbar wiring, settings modal, toast, formatters.
// Each page calls initTopbar() on load. Renders into elements with specific IDs
// present in every page's HTML.

import { getCreds, setCreds, hasCreds } from './config.js';
import { state } from './state.js';
import { ping } from './github.js';

// ---------- Formatters ----------

export const fmtMoney = (n) => {
  if (n == null || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const fmtMoneyShort = (n) => {
  if (n == null || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
};

// ---------- Toast ----------

export function toast(msg, kind = 'info') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.classList.add('toast-show'), 10);
  setTimeout(() => {
    el.classList.remove('toast-show');
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

// ---------- Tab drag-to-reorder ----------

const TAB_ORDER_KEY = 'otl.tab_order';

function initTabDrag() {
  const nav = document.querySelector('nav.tabs');
  if (!nav) return;

  // Apply saved order on load
  const saved = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) || 'null');
  if (saved?.length) {
    const links = [...nav.querySelectorAll('a')];
    const map = Object.fromEntries(links.map(a => [a.getAttribute('href'), a]));
    const ordered = saved.map(h => map[h]).filter(Boolean);
    const seen = new Set(saved);
    links.forEach(a => { if (!seen.has(a.getAttribute('href'))) ordered.push(a); });
    ordered.forEach(a => nav.appendChild(a));
  }

  let dragSrc = null;

  nav.querySelectorAll('a').forEach(a => {
    a.draggable = true;

    a.addEventListener('dragstart', e => {
      dragSrc = a;
      // Defer class add so the drag ghost captures the un-faded state
      requestAnimationFrame(() => a.classList.add('tab-dragging'));
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', a.getAttribute('href'));
    });

    a.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (a === dragSrc) return;
      const { left, width } = a.getBoundingClientRect();
      if (e.clientX < left + width / 2) {
        a.classList.add('tab-drop-before');
        a.classList.remove('tab-drop-after');
      } else {
        a.classList.add('tab-drop-after');
        a.classList.remove('tab-drop-before');
      }
    });

    a.addEventListener('dragleave', () => {
      a.classList.remove('tab-drop-before', 'tab-drop-after');
    });

    a.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragSrc || a === dragSrc) return;
      const { left, width } = a.getBoundingClientRect();
      if (e.clientX < left + width / 2) {
        nav.insertBefore(dragSrc, a);
      } else {
        nav.insertBefore(dragSrc, a.nextSibling);
      }
      a.classList.remove('tab-drop-before', 'tab-drop-after');
      const order = [...nav.querySelectorAll('a')].map(x => x.getAttribute('href'));
      localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(order));
    });

    a.addEventListener('dragend', () => {
      nav.querySelectorAll('a').forEach(x =>
        x.classList.remove('tab-dragging', 'tab-drop-before', 'tab-drop-after'));
      dragSrc = null;
    });
  });
}

// ---------- Topbar wiring ----------

export function initTopbar() {
  initTabDrag();

  // hook up Save / Refresh / Settings / Undo buttons, if present
  document.getElementById('btn-save')?.addEventListener('click', () => {
    // In guest mode the save button becomes a login prompt — never call onSave
    if (state.get().guest) openSettingsModal();
    else onSave();
  });
  document.getElementById('btn-refresh')?.addEventListener('click', onRefresh);
  document.getElementById('btn-settings')?.addEventListener('click', () => openSettingsModal());
  document.getElementById('btn-undo')?.addEventListener('click', onUndo);

  // intercept tab navigation when dirty (skip entirely in guest mode — nothing to save)
  document.querySelectorAll('nav.tabs a').forEach(link => {
    link.addEventListener('click', (e) => {
      const s = state.get();
      if (!s.dirty || s.guest) return; // clean or demo — navigate freely
      const href = link.getAttribute('href');
      if (!href || link.classList.contains('active')) return; // same page
      e.preventDefault();
      openNavGuard(href);
    });
  });

  // render dirty/loading indicator + demo banner
  state.subscribe(({ dirty, loading, error, guest }) => {
    const saveBtn = document.getElementById('btn-save');
    if (saveBtn) {
      if (guest) {
        // Guest mode: repurpose Save as a login CTA, always enabled
        saveBtn.disabled = false;
        saveBtn.textContent = 'Login to save';
      } else {
        saveBtn.disabled = !dirty || loading;
        saveBtn.textContent = loading ? 'Saving…' : dirty ? 'Save*' : 'Saved';
      }
    }
    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) undoBtn.disabled = !state.canUndo();

    updateDemoBanner(guest);

    if (error) toast(error, 'error');
  });
}

function updateDemoBanner(guest) {
  const existing = document.getElementById('demo-banner');
  if (guest) {
    if (existing) return; // already showing
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.className = 'demo-banner';
    banner.innerHTML = `
      <span>🎭 Demo mode — changes are not saved</span>
      <button class="btn demo-login-btn" id="demo-login-btn">Login to save your data</button>
    `;
    // Insert right after the nav tabs so it sits below the topbar
    const nav = document.querySelector('nav.tabs');
    if (nav) nav.insertAdjacentElement('afterend', banner);
    else document.body.prepend(banner);
    document.getElementById('demo-login-btn').addEventListener('click', () => openSettingsModal());
  } else {
    existing?.remove();
  }
}

function openNavGuard(href) {
  const existing = document.getElementById('nav-guard-modal');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'nav-guard-modal';
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="width:min(380px,92vw)">
      <h2>Unsaved changes</h2>
      <p class="modal-sub">You have unsaved changes on this page. What would you like to do?</p>
      <div class="modal-actions">
        <button class="btn" id="ng-cancel">Stay here</button>
        <button class="btn" id="ng-discard">Discard &amp; leave</button>
        <button class="btn primary" id="ng-save">Save &amp; leave</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.querySelector('#ng-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

  backdrop.querySelector('#ng-discard').addEventListener('click', () => {
    backdrop.remove();
    location.href = href;
  });

  backdrop.querySelector('#ng-save').addEventListener('click', async () => {
    backdrop.querySelector('#ng-save').textContent = 'Saving…';
    backdrop.querySelector('#ng-save').disabled = true;
    backdrop.querySelector('#ng-discard').disabled = true;
    const res = await state.save();
    if (res.ok) {
      location.href = href;
    } else {
      backdrop.remove();
      toast('Save failed — ' + res.error, 'error');
    }
  });
}

async function onSave() {
  const res = await state.save();
  if (res.ok && !res.noop) toast('saved', 'success');
  else if (res.noop) toast('nothing to save', 'info');
  else toast('save failed: ' + res.error, 'error');
}

async function onRefresh() {
  const { dirty } = state.get();
  if (dirty && !confirm('You have unsaved changes. Refresh from GitHub and discard them?')) return;
  await state.refresh();
  toast('refreshed', 'info');
}

function onUndo() {
  const label = state.undo();
  if (label) toast(`↶ Undone: ${label}`, 'info');
}

// ---------- Settings modal ----------

export function openSettingsModal(opts = {}) {
  const existing = document.getElementById('settings-modal');
  if (existing) existing.remove();

  const creds = getCreds();
  const el = document.createElement('div');
  el.id = 'settings-modal';
  el.className = 'modal-backdrop';
  el.innerHTML = `
    <div class="modal">
      <h2>Settings</h2>
      <p class="modal-sub">Connect to your data repo on GitHub. Stored only in your browser.</p>

      <label class="field">
        <span>GitHub username (owner)</span>
        <input id="s-owner" type="text" value="${escapeAttr(creds.owner)}" placeholder="yourname" />
      </label>

      <label class="field">
        <span>Data repo name</span>
        <input id="s-repo" type="text" value="${escapeAttr(creds.repo || 'ocd-life-tracker-data')}" placeholder="ocd-life-tracker-data" />
      </label>

      <label class="field">
        <span>Branch</span>
        <input id="s-branch" type="text" value="${escapeAttr(creds.branch || 'main')}" placeholder="main" />
      </label>

      <label class="field">
        <span>Personal Access Token (fine-grained)</span>
        <input id="s-pat" type="password" value="${escapeAttr(creds.pat)}" placeholder="github_pat_..." />
        <small>Contents: Read & write on the data repo only.</small>
      </label>

      <div id="s-status" class="modal-status"></div>

      <div class="modal-actions">
        <button class="btn" id="s-test">Test connection</button>
        <span style="flex:1"></span>
        <button class="btn" id="s-cancel">Cancel</button>
        <button class="btn primary" id="s-save">Save & reload</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  el.querySelector('#s-cancel').onclick = () => el.remove();
  el.querySelector('#s-test').onclick = async () => {
    persistInputs();
    setStatus('testing…');
    const r = await ping();
    setStatus(r.ok ? '✓ connected' : '✗ ' + r.message, r.ok ? 'ok' : 'err');
  };
  el.querySelector('#s-save').onclick = async () => {
    persistInputs();
    el.remove();
    if (state.get().guest) {
      // Coming from demo mode: restore real display names, wipe demo data + cache,
      // then fetch real prod data
      WHO_LABEL.chang = 'Chang';
      WHO_LABEL.kiju  = 'Kiju';
      await state.exitGuestMode();
    } else {
      await state.refresh();
    }
  };
  el.addEventListener('click', (e) => { if (e.target === el && !opts.forceOpen) el.remove(); });

  function persistInputs() {
    setCreds({
      owner: el.querySelector('#s-owner').value.trim(),
      repo: el.querySelector('#s-repo').value.trim(),
      branch: el.querySelector('#s-branch').value.trim() || 'main',
      pat: el.querySelector('#s-pat').value.trim(),
    });
  }
  function setStatus(msg, kind) {
    const s = el.querySelector('#s-status');
    s.textContent = msg;
    s.className = 'modal-status ' + (kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : '');
  }
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ---------- Credential gate ----------

// Called by each page. If creds are missing, shows the landing screen
// (Login vs Demo choice). Otherwise initializes state from GitHub.
export async function bootstrap() {
  initTopbar();
  if (!hasCreds()) {
    showLandingScreen();
    return false;
  }
  await state.init();
  return true;
}

function showLandingScreen() {
  const el = document.createElement('div');
  el.id = 'landing-screen';
  el.className = 'modal-backdrop';
  el.innerHTML = `
    <div class="modal landing-modal">
      <h2>OCD Life Tracker</h2>
      <p class="modal-sub">Personal finance &amp; life tracker.<br>Connect your GitHub data repo, or explore with sample data.</p>
      <div class="landing-actions">
        <button class="btn primary" id="l-login">Login with GitHub</button>
        <button class="btn" id="l-demo">Try Demo</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  el.querySelector('#l-login').addEventListener('click', () => {
    el.remove();
    openSettingsModal({ forceOpen: true });
  });

  el.querySelector('#l-demo').addEventListener('click', () => {
    el.remove();
    import('./demo-data.js').then(({ getDemoData, DEMO_WHO_NAMES }) => {
      // Swap display names so real names never appear in demo mode
      WHO_LABEL.chang = DEMO_WHO_NAMES[0];
      WHO_LABEL.kiju  = DEMO_WHO_NAMES[1];
      state.enterGuestMode(getDemoData());
    });
  });
}

// ---------- Common small bits ----------

export const WHO_CLASS = { chang: 'who-chang', kiju: 'who-kiju', joint: 'who-joint' };
export const WHO_LABEL = { chang: 'Chang', kiju: 'Kiju', joint: 'Joint' };

export function whoPill(who) {
  const cls = WHO_CLASS[who] || '';
  const label = WHO_LABEL[who] || who || '';
  return `<span class="pill ${cls}">${label}</span>`;
}

// ---------- Menu positioning ----------

// Appends a .menu element to document.body with position:fixed so it is never
// clipped by overflow:auto/hidden on a parent container (e.g. scrollable tables).
// Right-aligns the menu with the anchor button; opens downward if room, else upward.
export function positionMenu(menu, anchor) {
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.zIndex   = '1000';
  menu.style.left     = 'auto';
  menu.style.right    = `${window.innerWidth - rect.right}px`;
  // Measure height after append — works because fixed elements render outside overflow containers
  const menuH     = menu.offsetHeight;
  const spaceBelow = window.innerHeight - rect.bottom - 4;
  if (spaceBelow >= menuH || rect.top < menuH + 4) {
    menu.style.top    = `${rect.bottom + 4}px`;
    menu.style.bottom = 'auto';
  } else {
    menu.style.top    = 'auto';
    menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  }
}
