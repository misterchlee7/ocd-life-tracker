# UX & design decisions

Why things are the way they are. Read this before changing core flows.

## Payment status is manual

The status progression for a bill payment in a given period is:

```
unpaid  →  scheduled  →  needs_confirm  →  paid
```

- `unpaid` — nothing entered yet.
- `scheduled` — user entered a pending amount. Not yet past payment day.
- `needs_confirm` — payment day has passed, system auto-advanced. User must manually confirm it actually posted.
- `paid` — user confirmed.

**Why manual confirmation?** User doesn't trust auto-pay or institutions, and wants to be psychologically connected to every payment to catch errors and fraud. Never auto-mark as paid.

## CC rotation

Goal: use each credit card at least once every 6 months (configurable in settings).

- Only CCs with a `cc.last_used` date show a rotation bar. Regular-use cards (daily drivers) are left without a date — absence of data means "fresh, don't worry about it."
- Colors: fresh (0–3mo), warn (3–5mo), stale (5+mo).
- Dashboard surfaces stale cards in a "Use these cards next" panel.

## 0% APR tracking

Some CCs carry 0% introductory APR promotional balances. We track:
- `expires_date` — when the promo ends.
- `months_left` — auto-decrements by 1 whenever a payment is logged against this bill.
- `balance_remaining` — what's still owed at 0%.

Warning fires when `months_left ≤ 2` (configurable). Shows up on dashboard attention banner.

## Non-monthly progress bars

Any bill with frequency other than `monthly` shows a segmented bar for the calendar year:
- Biannual → 2 segments
- Quarterly → 4 segments
- Annual → 1 segment
- Semi-annual → 2 segments

Segments fill as payments for that year are logged. Users scan-read "1/2 done for 2026" faster than dates.

## Payment history = separate array

`bills[]` holds definitions. `payments[]` holds history. Same pattern for `perks[]` / `perk_claims[]`.

Benefits:
- Bill rows stay small and stable (no ever-growing history inside each row).
- Deleting/archiving a bill doesn't orphan its history — we keep `payments[]` untouched.
- Cross-bill queries (e.g., "total paid in April") are trivial.

Cost: one `.filter(p => p.bill_id === bill.id)` when rendering. Negligible.

## Manual save, not autosave

User clicks **Save** → one commit to the data repo. Reasons:
- GitHub API rate limits make per-keystroke saves hostile.
- Git history becomes useful version history (semantic saves, not 500 micro-commits).
- User prefers the explicit "I'm done editing" moment.

Dirty state is indicated in the header. Undo/redo is in-memory only and clears on reload.

## localStorage cache

After a successful load, `data.json` + its sha are cached in `localStorage`. Tab switches read from cache instantly and don't re-hit GitHub. A **Refresh** button in the header forces a re-pull.

## Multi-page over SPA

Six HTML files, one per tab. No router, no SPA framework. GitHub Pages serves them directly. Shared CSS/JS is imported from each page. Simpler to debug, matches mockups 1:1.

## Two users, not multi-tenant

App is scoped to one `who` trio: `chang`, `kiju`, `joint`. If you want to reuse this for different people, edit the enum in `docs/data-schema.md` and the CSS color classes.
