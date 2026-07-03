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
- **Save model:** changes accumulate in memory (dirty flag), user clicks Save → one `PUT /contents/data.json` commit to GitHub. No autosave per keystroke. Undo/redo is in-memory only, cleared on reload. Version history = git history of the data repo. **Commit messages are built from mutation labels** — `state.mutate(fn, label)` labels accumulate since the last save and `save()` joins them (deduped, ~90 char cap, `+N more` overflow) into the commit message when no explicit message is given. This is separate from `data.history` (the persistent in-app activity log, see below) — one lives in git, one lives in the data.
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
│   ├── theme.js            # classic (non-module) head script: applies otl.theme before first paint
│   ├── core/
│   │   ├── config.js       # repo + file path constants, localStorage keys
│   │   ├── github.js       # GitHub API client (fetchData, putData, friendly 401/403/404/409 errors)
│   │   ├── state.js        # in-memory data, dirty tracking, undo stack, guest mode, commit-message labels
│   │   ├── dates.js        # frequency math, next-occurrence (day-clamped + phase-aligned), "X days ago"
│   │   ├── derive.js       # computed values (statusForRow, rotation, perk progress, attention items, cadenceAnchorMonth)
│   │   ├── actions.js      # bill payment mutation commands (schedulePending/recordPaid/recordSkip/…) — the ONLY place payment rules live
│   │   ├── text.js         # escapeHTML/escapeAttr/truncate + ALL display-label maps (bill/perk/sub/vest/backlog/warranty)
│   │   ├── ui.js           # shared UI helpers (pills, modals incl. amountModal/confirmModal/closeOnEscape, tab drag, bootstrap, isMobile, showBottomSheet)
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
├── tests/
│   └── dates.test.js       # node --test suite for dates.js + derive.js pure logic
├── package.json            # "type": "module" + `npm test` script — NO dependencies, still no build step
│
├── manifest.json           # PWA manifest (standalone, Add to Home Screen)
├── icons/                  # icon.svg (favicon) + apple-touch-icon.png + icon-512.png
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
- **"No payment" / skipped bills.** Bills that genuinely had no payment are marked `skipped`. Entering `$0` or clicking "No payment this month" creates/updates a PaymentRecord with `status: 'skipped'` and `paid_amount: 0`.
- **CC `last_used` is purchase-only.** Scheduling or marking a payment as paid does **not** update `last_used`. Only the explicit "Mark card used today" action (⋯ menu or mobile bottom sheet) or manual edit in the bill form updates it. `last_used` tracks when you last made a purchase with the card, not when you last made a payment.
- **Edit paid amount.** The ⋯ menu on a paid bill shows "✏️ Edit paid amount" (only visible when `status === 'paid'`). It opens `amountModal` pre-filled with `paid_amount` and on confirm updates only `paid_amount` — `paid_date`, `status`, and all other fields are untouched. Use this to correct an amount or record an extra payment (e.g. extra toward mortgage) without losing the original paid date.
- **Status colors.** `unpaid` = warm red (`#fef0ef` / `#b83c30`). `skipped` = neutral grey.
- **Period anchor rule.** When calling `periodFor()` in a page, always pass `-01` as the day — never the bill's actual `day` field. `bill.day` can exceed the month length (e.g. day 31 in April), causing JS `Date` to roll over to the next month and corrupting the period string. `periodFor('2026-04-01', freq)` is always safe. See `periodForBill()` in bills.js and `periodForPerk()` in perks.js.
- **CC rotation.** Cards with a `last_used` date show a freshness bar (fresh/warn/stale). Target: use every card ≥ once per 6 months.
- **0% APR counter.** Each CC can have `apr_zero: { expires_date, months_left, balance_remaining }`. Warns when `months_left ≤ 2`. Surfaced in the dashboard attention hub (`kind: apr_zero`), not in the bills summary cards.
- **Bills summary cards.** Five cards (`.summary.summary-5`, 5-column grid): (1) Pending this month — sum of `pending_amount` for unpaid/scheduled bills, with who breakdown. (2) Paid this month — sum of `paid_amount` for paid bills (uses actual paid amount, not pending, so extra payments toward loans show correctly), with who breakdown + `±$X vs pending` comparison line. (3) Needs confirmation — count of bills past payment day awaiting confirm. (4) CC rewards available — each reward unit (dollars, Chase UR, Amex MR, etc.) shown as an equal-weight line with card count. (5) Credit cards — CC count + credit limit broken down by who (Chang/Kiju/Joint) + total.
- **Non-monthly progress.** Any bill with `frequency !== "monthly"` shows a segmented year-progress bar. Counter order is `YEAR · filled/total`.
- **Bill due date badge.** Optional `due_date` field — shown only for monthly bills. Teal if > 30 days, amber if ≤ 30 days, red if overdue. Non-monthly bills never show the `due_date` pill.
- **Non-monthly unpaid remap ("Not due · Sep" / "Due").** Non-monthly bills with no payment record never show the red "Unpaid" pill. `billStatusDisplay()` in derive.js remaps the display (desktop + mobile share it): teal **"Not due · \<Mon\>"** before the cadence month, amber **"Due"** from the cadence month through the end of the period. The cadence month is phase-aligned via `cadenceAnchorMonth()` (latest payment history); with no history it falls back to the last month of the calendar period (Jun for H1, Dec for annual). Display-only — the underlying status stays `unpaid`, so sorting, filter dropdowns, and summary math are unaffected. Pill classes `s-not_due` / `s-due`; label keys `due`/`not_due` in `BILL_STATUS_LABELS` are never stored. This replaced the old "Due this month" badge (`isDueThisMonth()` in bills.js — removed). Logic covered in `tests/dates.test.js` (`dueMonthInfo`, `billStatusDisplay`).
- **Bill balance remaining.** Optional `balance_remaining` field shown as bold sub-line in Amount cell.
- **Perks.** Monthly perks show status pill only. Non-monthly show year-progress bar + period label (e.g. `Q2`, `H1`) colored red (unclaimed) or green (claimed). Summary: Monthly available | Non-monthly available | Net ROI YTD.
- **Subscriptions.** `billed_to` = which card covers cost. `subsidized_amount` = partial subsidy (null = full amount covered). Cancelled rows faded + struck through. Next Renewal: ≤7d = red, ≤30d = amber. No today divider.
- **Non-renewing subscriptions.** Status `non_renewing` = auto-renew turned off at the vendor but access continues until `next_renewal` (reinterpreted as the END date — `computedRenewal()` never rolls it forward for this status). Row stays in the main table with an amber "Non-renewing" pill and "Ends [date]" in the renewal column. Excluded from the "Non-monthly ≤ 30d" upcoming-charge summary and from `sub_renewal` attention items. Instead: `sub_ending` (zone 2, ends ≤30d) and, once the end date passes, `sub_ended` (zone 1) with a "✓ Confirm cancelled" button on the dashboard that sets status → `cancelled` — no silent auto-transition, matching the manual-confirmation ethos. "Advance renewal" is hidden for non-renewing rows.
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
- **Month view context (bills + perks, desktop + mobile).** Helpers in `ui.js`: `monthOffset`, `monthNavClass`, `monthNavLabelHTML`, `monthBannerHTML`. On the current month the month pill shows a muted `· this month` hint and nothing else. On any other month: a tinted banner (`.month-banner` — amber `past` reusing `--nag-*`, teal `future` using `--teal-*`) renders at the top of the page with the relative distance ("2 months ago") and a "Back to today" button (each page wires `[data-month-today]` to reset `ui.month`), and the month pill gets `.off-month.past/.future` tint. Bills additionally swaps the status column header ("This month" → "May status", via `viewedMonthName()`) and the Pending/Paid summary card labels ("Pending · May", via `monthScopeLabel()`). If you add month navigation to a new page, use these helpers — don't re-implement.
- **Inline cell editing.** Clicking a `td.note-cell`, `td.status-cell`, or `td.editable-cell` replaces content with a focused `<input>` or `<select>`. Enter/blur commits via `state.mutate()`; Escape re-renders without saving.
- **No native dialogs.** `amountModal`, `confirmModal`, and `closeOnEscape` are exported from `ui.js` — never use native `prompt()`/`confirm()`/`alert()`. All "enter an amount" prompts use `amountModal({ title, sub, defaultValue, confirmLabel, onConfirm })` (confirm button relabels to "No payment" at `0`; has `inputmode="decimal"`). All destructive confirmations use `confirmModal({ title, message, confirmLabel, danger, onConfirm })`. Every modal backdrop gets `closeOnEscape(el)` — it only closes the topmost backdrop, so nested modals unwind one at a time. Form validation failures use `toast(msg, 'error')`. (Known stragglers, deliberately left as native: backlog's snooze-until-date prompt and vesting's "+ Add ticker" prompts — they need text/date input, not a numeric amount.)
- **Status pill click (bills desktop).** Unpaid → opens schedule amount modal; scheduled/needs_confirm → mark-paid modal; **paid/skipped → opens the row menu** (terminal states never trigger a destructive reset directly — "Clear payment record" lives in the menu instead).
- **Navigation guard.** `initTopbar()` intercepts `<nav.tabs> a` clicks when `state.dirty` is true AND `state.guest` is false. Shows modal: Stay / Discard & leave / Save & leave.
- **Tab drag-to-reorder.** HTML5 drag-and-drop on nav tabs. Order saved to `otl.tab_order` in localStorage. New tabs not in saved order are appended at end.
- **3-dot menu positioning.** All row menus use `positionMenu(menu, anchor)` (exported from `ui.js`). It appends the menu to `document.body` with `position: fixed` and computes exact screen coordinates from `anchor.getBoundingClientRect()`. This prevents clipping by any `overflow: auto/hidden` parent container (e.g. scrollable tables). Opens downward if there's room, upward otherwise — measured after append so no guessing, and caps `max-height`/`overflow-y: auto` so long menus scroll instead of overflowing the viewport. The outside-click handler also does `document.querySelectorAll('body > .menu').forEach(m => m.remove())` to clean up body-appended menus before re-rendering. Applied in bills, perks, subscriptions, vesting, warranties. **Do not use `anchor.parentElement.appendChild` + `menu-up` class for new menus — always use `positionMenu`.**
- **Toast messages.** All action toasts include item context: `Deleted: Chase — Rent`, `Updated: Netflix`, `Claimed: Dining Credit`, `↶ Undone: delete Netflix`. `state.undo()` returns the mutation label string so the toast can display it. `⌘Z`/`Ctrl+Z` also triggers undo (skipped while a form input is focused).

## Conventions

- Vanilla ES modules with `<script type="module">`. No transpile.
- Use `Intl.NumberFormat` and `Intl.DateTimeFormat` — no external date libs.
- All money stored as numbers (not strings). Render at the edge.
- Dates stored as ISO `YYYY-MM-DD` strings. Never `Date` objects in JSON.
- IDs are short random strings (`Math.random().toString(36).slice(2, 10)`). Generated client-side.
- Prefer deriving over storing. e.g., don't store `next_due_date` — compute from `day + frequency + last_paid`.
- GitHub `GET /contents` can return stale CDN data. Always append `?t=${Date.now()}` to cache-bust.
- **Period anchor:** always pass `-01` as the day to `periodFor()` (never `bill.day`) to avoid JS date rollover on short months.
- **Escaping + labels come from `js/core/text.js`.** Never define local `escapeHTML`/`escapeAttr`/`truncate` or label maps (STATUS/TYPE/FREQ/CAT) in a page — import them (alias as needed, e.g. `BILL_STATUS_LABELS as STATUS_LABELS`). Anything user-entered that lands in an HTML template must go through `escapeHTML`/`escapeAttr` (bottom sheet and menus do this internally).
- **Bill payment mutations go through `js/core/actions.js`.** `schedulePending` / `recordPaid` / `recordSkip` / `setPaidAmount` / `markCardUsed` / `clearPayment` encode the domain rules — including that `recordPaid` does **not** touch `last_used` (see the CC `last_used` rule above). Desktop and mobile bills call the same functions inside `state.mutate()` — never re-implement these inline, or the two platforms will silently diverge.
- **`statusForRow(data, bill, monthISO)` lives in derive.js** (includes the scheduled → needs_confirm auto-advance). Don't duplicate it in pages.
- **`nextOccurrence(day, freq, fromISO, anchorMonth)`** clamps the day to the month length (day 31 stays in April) and optionally phase-aligns non-monthly cadences to a known cadence month; get `anchorMonth` from `cadenceAnchorMonth(data, bill)` (derived from the latest payment). Note: `bills.js`'s own `nextDueDateForBill()` solves a similar phase-alignment problem locally for the year-progress "next due" display — the two aren't unified, that's a known duplication, not a bug.
- **Dark mode is `light-dark()`-driven.** There is NO separate dark block in `app.css` — every color token is defined once as `light-dark(lightVal, darkVal)`, resolved by the `color-scheme` property on `:root`. Never hardcode neutral colors in CSS or inline styles — use the surface variables (`--surface`, `--hover`, `--hover-subtle`, `--hover-accent`, `--th-bg`, `--day-bg`, `--seg-bg`, `--danger-hover-bg`) and semantic text colors (`--red-fg`, `--amber-fg`, `--green-fg`). A new tinted chip/badge gets a `light-dark()` pair inline (or a new var) — never a `prefers-color-scheme` override; a same-specificity override placed before the base rule silently loses the cascade (this exact bug shipped once; the `light-dark()` rewrite killed the class).
- **Theme is user-togglable.** `js/theme.js` (classic non-module script in every page `<head>`, runs before first paint; CSP-safe under `script-src 'self'`) applies `localStorage['otl.theme']` (`'light'`/`'dark'`, absent = follow OS) by setting `documentElement.style.colorScheme`, and syncs the `theme-color` metas via `window.otlApplyTheme`. The topbar toggle (`#btn-theme`, injected by `initTopbar()`) cycles Auto → Light → Dark.
- **UI chrome icons are inline SVG** via `icon(name, cls)` in `ui.js` (Lucide outlines, `currentColor`, sized by `.icon`/`.icon.sm` in app.css). Never use emoji for chrome (topbar, nav, banners, attention-zone titles) — it renders differently per OS. Emoji inside row-menu / bottom-sheet item labels is tolerated legacy (`showBottomSheet` escapes `icon`, so SVG can't be injected there anyway).
- **Page headers.** Every tab renders `pageHeaderHTML(title, countText, actionsHTML)` (from ui.js) at the top: page name + item count + the page's primary "+ Add …" button (moved out of the filters bar). Wiring ids (`btn-add`, `btn-add-bill`, `btn-grants`) are unchanged.
- **Bills row de-noise.** Who column uses `whoDot(who)` (colored dot + plain text, ui.js) instead of `whoPill`; bill type renders as muted uppercase text (`.bill-type-plain`), not a pill — the status pill stays the only pill in a bills row. The Pending summary card carries `.card.primary` (accent left border + tint); keep it the sole primary card per page.

## When making changes

1. If changing data shape: update `docs/data-schema.md` FIRST, then code.
2. Keep `js/core/` free of DOM code — pure data/logic only. Exception: `ui.js` and `demo-data.js` are UI/bootstrap concerns, DOM is fine there.
3. Pages render from derived views, not raw state — add new derivations to `js/core/derive.js`.
4. Any new save/write path must check `_guest` / `state.get().guest` and no-op in demo mode.
5. Mockups in `/mockups/` are the visual source of truth for v1. Match their styling.
6. If touching `dates.js`, `derive.js`, or `actions.js`: run `npm test` (node's built-in runner, no deps) and extend `tests/dates.test.js` for new edge cases.

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
| `otl.theme` | `light` or `dark` (absent = follow OS) | Topbar theme toggle |

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

## PWA + dark mode

- All 8 HTML pages (7 tabs + history.html) link `manifest.json`, `icons/icon.svg` (favicon), and `icons/apple-touch-icon.png`, with `theme-color` metas for both color schemes. Add to Home Screen on iOS/Android gives a standalone app window starting at the dashboard. No service worker (online-only by design).
- Dark mode follows the OS by default; the topbar toggle (Auto/Light/Dark, persisted as `otl.theme`) forces either. Colors resolve via CSS `light-dark()` + `color-scheme` — see the Conventions bullets for the rules.
- The nav tab for bills.html is labeled **"Bills"** everywhere (desktop tabs + mobile nav) — not "Payments".

## Tests

`npm test` runs `node --test tests/*.test.js` — zero dependencies, no build. Covers the pure logic in `dates.js` (periodFor, nextOccurrence day-clamping/phase/leap-year, daysBetween) and `derive.js` (yearProgress, statusForRow, cadenceAnchorMonth). The root `package.json` exists only for `"type": "module"` + the test script; the site remains a build-free static deploy.

## Status

All 7 tabs (Dashboard, Bills, Perks, Subscriptions, Vesting, Backlog, Warranties) plus the History log page are fully functional on desktop. Bills, Perks, Subscriptions, Vesting, Backlog, and Warranties have dedicated mobile modules (card-based UI with bottom sheet actions). Dashboard and History render fine on mobile with the shared topbar/nav. Demo/guest mode is live on all pages and viewports. Dark mode + installable PWA shell are live. Deployed at https://misterchlee7.github.io/ocd-life-tracker/.
