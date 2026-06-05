# CLAUDE.md — ocd-life-tracker

> Read this first in any new session. It's the map of the codebase.

## What this is

A personal finance/life tracker web app. Pure static frontend hosted on GitHub Pages at
**https://misterchlee7.github.io/ocd-life-tracker/**, with a JSON file in a separate private
repo (`ocd-life-tracker-data`) as the database. Read/write happens in the browser via the
GitHub REST API using a Personal Access Token stored in `localStorage`.

Only 2 users (Chang + Kiju). Desktop-first for data entry; mobile has a dedicated card-based UI for quick status updates.

## Architecture at a glance

- **Multi-page static site.** One HTML file per "tab" (dashboard, bills, perks, subscriptions, vesting, backlog, warranties). No framework, no build step, no bundler. Just HTML + CSS + vanilla JS modules.
- **Single source of truth:** `data.json` in the `ocd-life-tracker-data` repo. See [docs/data-schema.md](docs/data-schema.md) for the full schema.
- **Save model:** changes accumulate in memory (dirty flag), user clicks Save → one `PUT /contents/data.json` commit to GitHub. No autosave per keystroke. Undo/redo is in-memory only, cleared on reload. Version history = git history of the data repo.
- **Auth:** user pastes a fine-grained PAT (scoped to `ocd-life-tracker-data` repo, contents: read/write) into a settings modal on first load. Stored in `localStorage` under `otl.pat`.
- **Demo/guest mode:** first-time visitors (no creds in localStorage) see a landing screen with Login vs Try Demo. Demo mode loads hardcoded sample data entirely in memory — nothing is ever written to localStorage or GitHub. See [Demo mode](#demo--guest-mode) section below.

## Repo layout

```
/                           # GitHub Pages root
├── CLAUDE.md               # ← you are here
├── README.md               # user-facing setup (PAT, hosting)
├── index.html              # redirects to dashboard.html
├── dashboard.html          # tab: overview, attention banner, upcoming income
├── bills.html              # tab: bills + CC table (the main workhorse)
├── perks.html              # tab: CC perks/credits tracker
├── subscriptions.html      # tab: subscription renewals
├── vesting.html            # tab: RSU/ESPP schedule
├── backlog.html            # tab: personal todos
├── warranties.html         # tab: product warranty tracker
├── history.html            # meta: read-only activity log (accessible via ⏱ in topbar, not a nav tab)
│
├── css/
│   ├── app.css             # shared styles (extracted from mockups)
│   └── mobile.css          # mobile-only styles: bottom nav, bottom sheet, card primitives, filter chips
│
├── js/
│   ├── core/
│   │   ├── config.js       # repo + file path constants, localStorage keys
│   │   ├── github.js       # GitHub API client (fetchData, putData)
│   │   ├── state.js        # in-memory data, dirty tracking, undo stack, guest mode
│   │   ├── dates.js        # frequency math, next-occurrence, "X days ago"
│   │   ├── derive.js       # computed values (rotation freshness, perk progress, attention items)
│   │   ├── ui.js           # shared UI helpers (pills, status badges, modals, tab drag, bootstrap, isMobile, showBottomSheet)
│   │   └── demo-data.js    # hardcoded sample data for guest/demo mode
│   └── pages/
│       ├── dashboard.js
│       ├── bills.js              # desktop; dynamically imports bills-mobile.js on mobile
│       ├── bills-mobile.js       # mobile bills: card list, month nav, filter chips, bottom sheet actions
│       ├── perks.js              # desktop; dynamically imports perks-mobile.js on mobile
│       ├── perks-mobile.js       # mobile perks: claim/cycle/skip via cards + bottom sheet
│       ├── subscriptions.js      # desktop; dynamically imports subscriptions-mobile.js on mobile
│       ├── subscriptions-mobile.js # mobile subs: renewal urgency cards, advance/cancel via bottom sheet
│       ├── vesting.js            # desktop; dynamically imports vesting-mobile.js on mobile
│       ├── vesting-mobile.js     # mobile vesting: mark vested / sold via bottom sheet + custom modal
│       ├── backlog.js            # desktop; dynamically imports backlog-mobile.js on mobile
│       ├── backlog-mobile.js     # mobile backlog: checkbox list, start/snooze/drop via bottom sheet
│       ├── warranties.js         # desktop; dynamically imports warranties-mobile.js on mobile
│       ├── warranties-mobile.js  # mobile warranties: urgency-bordered cards, read-mostly
│       └── history.js            # read-only activity log: entries grouped by date, newest first
│
├── docs/
│   ├── data-schema.md      # canonical JSON schema for data.json
│   └── decisions.md        # UX decisions + why (payment-confirm flow, rotation, etc.)
│
└── mockups/                # original static HTML mockups — reference only, do not link
    └── *.html
```

## How data flows

```
page load (with credentials)
  → bootstrap() in ui.js checks hasCreds()
  → state.init() — reads localStorage cache first (instant render), then fetches GitHub
  → js/core/derive.js computes views (next occurrences, attention items, totals)
  → js/pages/<page>.js renders via state.subscribe()

page load (no credentials)
  → bootstrap() shows landing screen: [Login with GitHub] [Try Demo]
  → Login → openSettingsModal() → user enters PAT → state.init()
  → Try Demo → state.enterGuestMode(getDemoData()) — in-memory only

user edits in UI
  → state.mutate(fn, label) — snapshots current data onto undo stack, marks dirty
  → cacheWrite() persists to localStorage (skipped entirely in guest mode)
  → re-render via subscribers

user clicks Save (prod mode)
  → github.js:putData() — PUT /contents/data.json with sha, gets new sha back
  → clears dirty flag and undo stack

user clicks "Login to save" (guest mode)
  → openSettingsModal()
  → on save: WHO_LABEL names restored, state.exitGuestMode() called
  → exitGuestMode() purges localStorage cache, calls refresh() for fresh prod data
```

## Domain rules (see `docs/decisions.md` for full context)

- **Manual payment confirmation.** Bill status progression is explicit: `unpaid → scheduled → needs_confirm → paid`. System auto-advances `scheduled → needs_confirm` when payment day passes. Only the user advances to `paid`.
- **"No payment" / skipped bills.** Bills that genuinely had no payment are marked `skipped`. Entering `$0` or clicking "No payment this month" creates/updates a PaymentRecord with `status: 'skipped'` and `paid_amount: 0`. `last_used` on a CC is **not** updated when paying $0.
- **Edit paid amount.** The ⋯ menu on a paid bill shows "✏️ Edit paid amount" (only visible when `status === 'paid'`). It opens `amountModal` pre-filled with `paid_amount` and on confirm updates only `paid_amount` — `paid_date`, `status`, and all other fields are untouched. Use this to correct an amount or record an extra payment (e.g. extra toward mortgage) without losing the original paid date.
- **Status colors.** `unpaid` = warm red (`#fef0ef` / `#b83c30`). `skipped` = neutral grey.
- **Period anchor rule.** When calling `periodFor()` in a page, always pass `-01` as the day — never the bill's actual `day` field. `bill.day` can exceed the month length (e.g. day 31 in April), causing JS `Date` to roll over to the next month and corrupting the period string. `periodFor('2026-04-01', freq)` is always safe. See `periodForBill()` in bills.js and `periodForPerk()` in perks.js.
- **CC rotation.** Cards with a `last_used` date show a freshness bar (fresh/warn/stale). Target: use every card ≥ once per 6 months.
- **0% APR counter.** Each CC can have `apr_zero: { expires_date, months_left, balance_remaining }`. Warns when `months_left ≤ 2`. Surfaced in the dashboard attention hub (`kind: apr_zero`), not in the bills summary cards.
- **Bills summary cards.** Five cards (`.summary.summary-5`, 5-column grid): (1) Pending this month — sum of `pending_amount` for unpaid/scheduled bills, with who breakdown. (2) Paid this month — sum of `paid_amount` for paid bills (uses actual paid amount, not pending, so extra payments toward loans show correctly), with who breakdown + `±$X vs pending` comparison line. (3) Needs confirmation — count of bills past payment day awaiting confirm. (4) CC rewards available — dollar rewards + points across all CCs. (5) Bill breakdown — total non-archived bill count + per-type breakdown sub-line (e.g. `4 CC · 2 Utility · 1 Loan`).
- **Non-monthly progress.** Any bill with `frequency !== "monthly"` shows a segmented year-progress bar. Counter order is `YEAR · filled/total`.
- **Bill due date badge.** Optional `due_date` field — teal if > 30 days, amber if ≤ 30 days, red if overdue.
- **Bill balance remaining.** Optional `balance_remaining` field shown as bold sub-line in Amount cell.
- **Perks.** Monthly perks show status pill only. Non-monthly show year-progress bar + period label (e.g. `Q2`, `H1`) colored red (unclaimed) or green (claimed). Summary: Monthly available | Non-monthly available | Net ROI YTD.
- **Subscriptions.** `billed_to` = which card covers cost. `subsidized_amount` = partial subsidy (null = full amount covered). Cancelled rows faded + struck through. Next Renewal: ≤7d = red, ≤30d = amber. No today divider.
- **Warranties.** `data.warranties || []` — always access defensively. Urgency tiers: ≤7d = red, ≤30d = amber-outline, ≤90d = amber, expired = faded. No today divider.
- **Paid · Month label.** `statusPill()` in bills.js shows `Paid · [month]` only when `paid_date` is **2+ months** away from the viewed month. A bill logged a few days late (e.g. April paid on May 6) just shows "Paid".
- **Bills table columns.** Day | Bill | Who | Amount | This month | Payment | Rewards | Last used | Notes | Actions (10 columns). Type column was removed — the type pill (`<span class="pill type tiny bill-type-inline">`) is rendered inline inside the Bill name cell alongside APR/due badges. The Payment column is contextual: shows `paid_amount` in green (`td.paid-amt`, color `--s-paid-fg`) when status=paid, `pending_amount` otherwise. Sort key stays `'pending'` for backward compat.
- **Compact table columns.** `td.tight { width: 1%; white-space: nowrap }` applied to Day, Who, This month, Payment, Rewards, Last used, Notes, and Actions cells. This collapses those columns to their content width and lets Bill + Amount absorb the remaining table width, eliminating dead space.
- **`monthly_amount` field.** Legacy — was removed from the bill edit form. Never read by UI. Safe to leave in existing `data.json` records; it's just ignored.
- **Paycheck + vesting** combine on dashboard as "Upcoming income". Paycheck is biweekly Friday, configured in `settings`.

## Demo / guest mode

Implemented in `js/core/demo-data.js`, `js/core/state.js`, and `js/core/ui.js`.

**How it works:**
- `state._guest` flag controls all guest-mode behavior
- `state.enterGuestMode(data)` — loads data into memory, sets `_guest = true`, never calls `cacheWrite()`
- `state.exitGuestMode()` — sets `_guest = false`, **purges localStorage cache** (`otl.cache` + `otl.sha`), calls `refresh()` to fetch fresh prod data. Always call this when transitioning from demo to prod.
- `state.save()` returns `{ ok: true, noop: true }` immediately if `_guest` — hard block, no API call ever made
- `state.mutate()` skips `_dirty = true` and `cacheWrite()` when `_guest` — no localStorage writes, nav guard never fires
- Save button shows "Login to save" in guest mode (routes to `openSettingsModal`, never `onSave`)
- Purple demo banner injected below nav tabs via `updateDemoBanner(guest)` in the state subscriber
- `WHO_LABEL` (the `{ chang, kiju, joint }` display-name map in ui.js) is **mutable**. Demo mode swaps in random names from `DEMO_WHO_NAMES` (exported by demo-data.js) before calling `enterGuestMode()`. Restored to real names on login. Since WHO_LABEL is imported by reference everywhere, the swap is instant app-wide.
- Demo data uses `addDays(todayISO(), n)` for all dates so it always looks current — no stale dates.

**Key rule:** If you ever add a new code path that writes/saves data, add a `if (_guest) return` guard or check `state.get().guest` before proceeding. Save must be impossible in guest mode.

## Mobile experience

The mobile UI is a completely separate rendering layer, not just responsive CSS. All 7 pages have dedicated mobile modules.

### Architecture

- **Detection:** `isMobile()` in `ui.js` uses `window.matchMedia('(max-width: 767px)').matches`. Called once at page boot — never changes mid-session.
- **Routing:** Each desktop `<page>.js` checks `isMobile()` at boot. If true, it `import('./page-mobile.js').then(m => m.init())` and skips its own `state.subscribe` + `bootstrap`. If false, desktop render runs normally.
- **Self-contained modules:** Each `*-mobile.js` imports only from `js/core/`, exports a single `init()`, and manages its own `ui = {}` state object (month, filter, etc.). No coupling to the desktop module.
- **Same data path:** `state.mutate()`, `state.save()`, and the GitHub API are identical. Guest mode guards apply automatically. No sync differences.

### Mobile-specific utilities (exported from `ui.js`)

- **`isMobile()`** — `window.matchMedia('(max-width: 767px)').matches`
- **`showBottomSheet({ title, items, onClose })`** — slide-up action sheet. Each item: `{ icon, label, description, action, danger, disabled }`. Appends to `document.body`, animates with CSS transition, removes itself on close or backdrop tap.
- **`initMobileNav()`** — called automatically by `initTopbar()` when `isMobile()`. Injects `#mobile-nav` into `document.body`. Bottom nav: ⌂ Home / ≋ Bills / ★ Perks / ↻ Subs / ··· More (opens bottom sheet for Vesting, Backlog, Warranties). Applies the same dirty-state nav guard as desktop.

### CSS (`css/mobile.css`)

Loaded on all pages via `<link>`. Sections:
- **Bottom sheet** (`.bottom-sheet-overlay`, `.bottom-sheet`, `.bs-*`) — always in DOM, usable from JS at any viewport
- **`@media (max-width: 767px)` block** — hides `#btn-undo`, `#btn-refresh`, `nav.tabs`; shows `#mobile-nav`; repositions toast above bottom nav; overrides summary grid to 2-col
- **Card primitives** — `.m-card`, `.m-card-header`, `.m-card-footer`, `.m-card-left/.right`, `.m-card-name`, `.m-card-amount`
- **Action buttons** — `.m-action-btn` with `.primary`, `.success`, `.warn`, `.muted` variants; `.m-dots-btn`
- **Filter chips** — `.m-filter-bar`, `.m-chip`, `.m-chip-count`
- **Summary strip** — `.m-summary-strip` (horizontal scroll), `.m-summary-card`
- **Month nav** — `.m-month-nav` (full-width pill with ‹ label ›)
- **Empty state** — `.m-empty`, `.m-empty-icon`, `.m-empty-msg`, `.m-empty-sub`
- **Section headers** — `.m-section-hdr`

### Mobile scope (by page)

| Page | Mobile actions |
|------|---------------|
| Bills | Schedule payment, mark paid, confirm paid, skip, edit paid amount, clear payment — all via bottom sheet |
| Perks | Claim, cycle (claim→skip→available), bottom sheet for explicit claim/skip/reset |
| Subscriptions | Advance renewal, cancel, activate, pause — via bottom sheet; read-mostly |
| Backlog | Checkbox to toggle done; bottom sheet for start/snooze/drop/reopen |
| Vesting | Mark vested (primary btn); mark sold (custom inline modal); bottom sheet |
| Warranties | Read-only card list sorted by expiry; urgency-bordered; no actions needed |
| Dashboard | Desktop-only (no mobile module — reads fine on mobile as-is) |

### Key mobile conventions

- `inputmode="decimal"` on all amount inputs (triggers numeric keypad on iOS/Android)
- `env(safe-area-inset-bottom)` on bottom nav and bottom sheet for iPhone notch/home bar
- `overscroll-behavior: contain` on bottom sheet to prevent scroll bleed-through
- `-webkit-tap-highlight-color: transparent` on all interactive mobile elements
- Filter chips hide when count is 0 (e.g. no skipped perks → Skipped chip absent)
- **Do not add editing/creation flows to mobile modules.** Add/edit stays desktop-only. Mobile is status-update focused.

## UI patterns

- **Today divider.** Bills and Vesting show a `TODAY · DATE` rule separating past and future rows. Implemented as `<tr class="today-divider">`. Subscriptions and Warranties intentionally have no today divider.
- **Inline cell editing.** Clicking a `td.note-cell`, `td.status-cell`, or `td.editable-cell` replaces content with a focused `<input>` or `<select>`. Enter/blur commits via `state.mutate()`; Escape re-renders without saving.
- **Custom amount modal.** All "enter an amount" prompts use `amountModal({ title, sub, defaultValue, confirmLabel, onConfirm })` — never native `prompt()`. Confirm button relabels to "No payment" when value is `0`.
- **Navigation guard.** `initTopbar()` intercepts `<nav.tabs> a` clicks when `state.dirty` is true AND `state.guest` is false. Shows modal: Stay / Discard & leave / Save & leave.
- **Tab drag-to-reorder.** HTML5 drag-and-drop on nav tabs. Order saved to `otl.tab_order` in localStorage. New tabs not in saved order are appended at end.
- **3-dot menu positioning.** All row menus use `positionMenu(menu, anchor)` (exported from `ui.js`). It appends the menu to `document.body` with `position: fixed` and computes exact screen coordinates from `anchor.getBoundingClientRect()`. This prevents clipping by any `overflow: auto/hidden` parent container (e.g. scrollable tables). Opens downward if there's room, upward otherwise — measured after append so no guessing. The outside-click handler also does `document.querySelectorAll('body > .menu').forEach(m => m.remove())` to clean up body-appended menus before re-rendering. Applied in bills, perks, subscriptions, vesting, warranties. **Do not use `anchor.parentElement.appendChild` + `menu-up` class for new menus — always use `positionMenu`.**
- **Toast messages.** All action toasts include item context: `Deleted: Chase — Rent`, `Updated: Netflix`, `Claimed: Dining Credit`, `↶ Undone: delete Netflix`. `state.undo()` returns the mutation label string so the toast can display it.

## Conventions

- Vanilla ES modules with `<script type="module">`. No transpile.
- Use `Intl.NumberFormat` and `Intl.DateTimeFormat` — no external date libs.
- All money stored as numbers (not strings). Render at the edge.
- Dates stored as ISO `YYYY-MM-DD` strings. Never `Date` objects in JSON.
- IDs are short random strings (`Math.random().toString(36).slice(2, 10)`). Generated client-side.
- Prefer deriving over storing. e.g., don't store `next_due_date` — compute from `day + frequency + last_paid`.
- GitHub `GET /contents` can return stale CDN data. Always append `?t=${Date.now()}` to cache-bust.
- **Period anchor:** always pass `-01` as the day to `periodFor()` (never `bill.day`) to avoid JS date rollover on short months.

## When making changes

1. If changing data shape: update `docs/data-schema.md` FIRST, then code.
2. Keep `js/core/` free of DOM code — pure data/logic only. Exception: `ui.js` and `demo-data.js` are UI/bootstrap concerns, DOM is fine there.
3. Pages render from derived views, not raw state — add new derivations to `js/core/derive.js`.
4. Any new save/write path must check `_guest` / `state.get().guest` and no-op in demo mode.
5. Mockups in `/mockups/` are the visual source of truth for v1. Match their styling.

## localStorage keys

| Key | Value | Set by |
|-----|-------|--------|
| `otl.pat` | GitHub Personal Access Token | Settings modal |
| `otl.owner` | GitHub username (repo owner) | Settings modal |
| `otl.repo` | Data repo name | Settings modal |
| `otl.branch` | Branch name (default: `main`) | Settings modal |
| `otl.cache` | JSON string of last-fetched data.json | state.cacheWrite() |
| `otl.sha` | SHA of last-fetched data.json | state.cacheWrite() |
| `otl.tab_order` | JSON array of `href` strings | Tab drag-to-reorder |

Note: `otl.cache` and `otl.sha` are explicitly purged by `state.exitGuestMode()` to prevent any stale or demo data from persisting after login.

## Activity history log

Every `state.mutate()` call appends `{ ts, label }` to `data.history` (rolling cap: 500 entries, oldest dropped first). Skipped in guest/demo mode — nothing is ever written to `data.history` while `_guest` is true.

- **Storage:** inside `data.json` (persisted to GitHub with the rest of the data)
- **Page:** `history.html` / `js/pages/history.js` — read-only, entries grouped by date, newest first
- **Access:** ⏱ button in every page's topbar (between ↻ Refresh and ⚙)
- **Undo behavior:** undoing an action removes its history entry (undo restores the pre-mutation snapshot, which didn't include that entry yet) — history reflects the actual committed data state
- **Label convention:** labels follow `action: subject [→ value]` — e.g. `mark paid: Chase — Rent $1200`, `set status: Netflix → cancelled`, `snooze task: Fix gutters until 2026-06-07`. Always include the item name and any relevant value so the history log is self-explanatory without needing to cross-reference the data.

## Security

- **XSS:** `showBottomSheet()` in `ui.js` escapes all caller-supplied strings (`title`, `label`, `description`, `icon`) before injecting into `innerHTML`. Bill/perk/task names come from user-edited data and must never be injected raw.
- **CSP:** every HTML page has `<meta http-equiv="Content-Security-Policy" ...>` restricting scripts to `'self'`, connections to `api.github.com` only, blocking plugins and external form targets.
- **PAT:** stored in `localStorage` under `otl.pat`. Fine-grained, scoped to the data repo only. Rotate every 3–6 months. Never paste untrusted content (from email, web pages) directly into name/notes fields.

## Status

All 7 pages (Dashboard, Bills, Perks, Subscriptions, Vesting, Backlog, Warranties) are fully functional on desktop. Bills, Perks, Subscriptions, Vesting, Backlog, and Warranties have dedicated mobile modules (card-based UI with bottom sheet actions). Dashboard renders fine on mobile with the shared topbar/nav. Demo/guest mode is live on all pages and viewports. History log page is live. Deployed at https://misterchlee7.github.io/ocd-life-tracker/.
