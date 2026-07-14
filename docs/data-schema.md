# data.json schema

Canonical shape of `data.json` stored in the `ocd-life-tracker-data` repo. This is the single source of truth for the app.

**Rules:**
- All money is a **number** (not string, not cents). `3077.99` means $3,077.99.
- All dates are ISO `YYYY-MM-DD` **strings**. No `Date` objects in JSON.
- IDs are short random strings, e.g. `"k3j9z2qx"`.
- Enums are lowercase snake_case strings.
- Prefer omitting a field to storing `null` when it's optional.

## Top level

```jsonc
{
  "version": 1,
  "updated_at": "2026-04-17T02:30:00Z",
  "settings": { /* see below */ },
  "bills":         [ /* Bill */ ],
  "payments":      [ /* PaymentRecord — history log */ ],
  "perks":         [ /* Perk */ ],
  "perk_claims":   [ /* PerkClaim — history log */ ],
  "subscriptions": [ /* Subscription */ ],
  "grants":        [ /* Grant — RSU/ESPP parent */ ],
  "vesting":       [ /* VestingEvent */ ],
  "stock_prices":  { /* ticker → price, e.g. "CSCO": 115.46 */ },
  "backlog":       [ /* BacklogItem */ ],
  "warranties":    [ /* Warranty */ ],  // optional; accessed as data.warranties || []
  "accounts":      [ /* Account */ ],   // optional; accessed as data.accounts || []
  "history":       [ /* HistoryEntry — activity log */ ]
}
```

## Enums

```
who:        "chang" | "kiju" | "joint"
frequency:  "monthly" | "bimonthly" | "quarterly" | "biannual" | "semi_annual" | "annual" | "biennial" | "triennial" | "quinquennial" | "one_time" | "variable"
bill_type:  "cc" | "loan" | "utility" | "insurance" | "fee" | "investment" | "gift" | "other"
bill_status (per-period): "unpaid" | "scheduled" | "needs_confirm" | "paid" | "auto" | "skipped"
perk_status (per-period): "available" | "claimed" | "skipped" | "expired"
sub_status: "active" | "trial" | "paused" | "non_renewing" | "cancelled"
sub_category: "streaming" | "music" | "software" | "fitness" | "news" | "storage" | "gaming" | "shopping" | "cc_annual_fee" | "other"
warranty_category: "electronics" | "appliance" | "vehicle" | "furniture" | "tool" | "outdoor" | "clothing" | "other"
account_type:   "checking" | "savings" | "brokerage" | "retirement" | "hsa" | "cd" | "other"
account_status: "open" | "closed"
grant_type: "rsu" | "espp"
vest_status: "upcoming" | "vested" | "sold" | "pending_settlement"
todo_status:      "open" | "in_progress" | "done" | "snoozed" | "dropped"
backlog_category: "buy" | "do" | "contact" | "misc"   // items without this default to "misc"
priority:         "high" | "medium" | "low"            // legacy; no longer shown in UI
```

## `settings`

```jsonc
{
  "paycheck": {
    "frequency": "biweekly",
    "day_of_week": "friday",
    "next_date": "2026-04-24",
    "amount_estimate": 0         // optional; if set, shown in upcoming income
  },
  "rotation_target_months": 6,   // "use each card every N months"
  "apr_warn_months": 2           // show 0% APR warning when ≤ N months left
}
```

## `Bill`

Represents a recurring bill or credit card. One row per bill. Payment history lives in `payments[]`.

```jsonc
{
  "id": "k3j9z2qx",
  "brand": "PNC",                    // issuer/vendor
  "name": "Mortgage",                // bill-specific label
  "who": "joint",
  "type": "loan",
  "frequency": "monthly",
  "day": 1,                          // day-of-month due (1–31); for non-monthly, the day of the first/anchor occurrence
  "amount": 3077.99,                 // fixed amount; omit for variable CCs
  "monthly_amount": 3077.99,         // LEGACY — no longer shown or editable in UI; safe to leave in existing data, never read
  "balance_remaining": 47200.00,     // optional; total outstanding balance (e.g. loan principal left); updated manually
  "variable": false,                 // true for CCs where amount fluctuates
  "next_due_date": "2026-05-01",     // optional override for non-monthly bills; otherwise derived
  "auto_pay": false,
  "archived": false,
  "due_date": "2026-11-01",       // optional one-time due date shown as a badge under the bill name
  "notes": "",

  // CC-specific (optional)
  "cc": {
    "last_used": "2025-12-07",       // for rotation tracking; only updated manually (not on schedule/mark-paid)
    "credit_limit": 10000,           // optional; total credit limit — shown per-who in Credit Cards summary card
    "rewards_balance": 79.46,        // unredeemed rewards; unit determined by rewards_unit
    "rewards_unit": "dollars",       // "dollars" (default) or any free-form string (e.g. "Chase UR", "Amex MR", "Misc pts")
    "apr_zero": {
      "expires_date": "2026-11-01",
      "months_left": 6,              // auto-decremented on payment
      "balance_remaining": 8899.20
    }
  }
}
```

## `PaymentRecord`

One entry per scheduled/completed payment period. This is what drives the "paid in Jan", "needs confirm this month" state.

```jsonc
{
  "id": "p7m1xx88",
  "bill_id": "k3j9z2qx",
  "period": "2026-04",               // YYYY-MM for monthly; YYYY-H1 / YYYY-H2 for biannual; YYYY-Qn for quarterly; YYYY for annual
  "status": "needs_confirm",         // bill_status enum
  "pending_amount": 3077.99,         // what the user entered as scheduled
  "paid_amount": null,               // filled when status="paid"
  "scheduled_date": "2026-04-01",
  "paid_date": null,                 // ISO date when confirmed paid
  "marker": "a",                     // user's alphabetical marker (a, b, c…) for multiple payments in a period
  "notes": ""
}
```

## `Perk`

A card credit/benefit that resets on a cadence.

```jsonc
{
  "id": "pk4m2n1b",
  "card": "Amex Platinum",           // groups perks by card on the Perks page
  "name": "Uber Eats",
  "who": "chang",
  "frequency": "monthly",
  "value": 15,                       // dollar value per period
  "reset_day": 1,                    // day-of-month the benefit resets
  "annual_fee_card": 895,            // optional; used for ROI calc at card level (stored on one perk per card or in a cards map — tbd)
  "archived": false,
  "notes": ""
}
```

## `PerkClaim`

One per period per perk, tracking status.

```jsonc
{
  "id": "pc9w2vv1",
  "perk_id": "pk4m2n1b",
  "period": "2026-04",               // same format as PaymentRecord.period
  "status": "claimed",               // perk_status enum
  "claimed_date": "2026-04-12",
  "notes": ""
}
```

## `Subscription`

```jsonc
{
  "id": "s1a2b3c4",
  "name": "Adobe Creative Cloud",
  "who": "chang",
  "category": "software",            // sub_category enum
  "billed_to": "Amex Platinum",      // card/account that pays (UI label: "Subsidized by")
  "subsidized_amount": null,         // optional; partial subsidy in $. If null and billed_to is set, full amount is assumed covered.
  "amount": 10.87,
  "frequency": "monthly",
  "next_renewal": "2026-06-06",      // for status "non_renewing" this is the END date (access ends, no charge) — never rolled forward
  "status": "active",                // sub_status enum. "non_renewing" = auto-renew turned off at the vendor but access continues;
                                     // stays in the main table until next_renewal passes, then a Zone-1 dashboard attention item
                                     // (kind: sub_ended) asks the user to confirm → status becomes "cancelled"
  "trial_ends": null,                // ISO date if trial
  "covered_by_perk_id": null,        // if a perk offsets this (e.g., Amex YouTube Premium credit)
  "archived": false,
  "notes": ""
}
```

## `Grant` (RSU/ESPP parent)

```jsonc
{
  "id": "g24r001",
  "label": "G-24-R-001",             // internal identifier (shown in Grants… modal and event form picker)
  "company": "Cisco",                // optional; issuing company — shown as "Company" column in events table
  "ticker": "CSCO",                  // optional; stock ticker — links grant to stock_prices for auto gross value
  "broker": "E*Trade",               // optional; brokerage account — shown as "Broker" column in events table
  "type": "rsu",                     // grant_type
  "who": "chang",
  "grant_date": "2024-02-15",
  "total_shares": 1200,              // original grant size (optional for ESPP)
  "schedule_note": "4-yr, 1yr cliff, quarterly after",
  "archived": false,
  "notes": ""
}
```

## `VestingEvent`

```jsonc
{
  "id": "v8t2p9q1",
  "grant_id": "g24r001",
  "type": "rsu",                     // grant_type (mirrored for convenience)
  "who": "chang",
  "date": "2026-05-10",
  "shares": 50,                      // optional
  "gross_value": 12551.97,           // stored value; auto-computed as shares × stock_prices[grant.ticker] for upcoming/vested when ticker is set. Sold/pending_settlement always use the stored value (historical).
  "status": "upcoming",              // vest_status enum
  "sold_date": null,
  "sold_amount": null,
  "notes": ""
}
```

## `BacklogItem`

```jsonc
{
  "id": "b5q9x2n3",
  "title": "Cancel AllState additional policy",
  "category": "do",                  // backlog_category enum; items without this default to "misc"
  "tags": ["house", "insurance"],
  "due_date": "2026-05-15",          // optional
  "status": "open",                  // todo_status enum
  "snoozed_until": null,             // ISO date when status="snoozed"
  "done_date": null,
  "related": {                       // optional cross-links
    "bill_id": null,
    "perk_id": null,
    "subscription_id": null
  },
  "notes": "",

  // legacy fields (no longer shown in UI, safe to leave in existing data)
  "priority": "medium",
  "who": "joint"
}
```

## Period string format

Used in `PaymentRecord.period` and `PerkClaim.period`.

| frequency      | format        | example      |
|----------------|---------------|--------------|
| monthly        | `YYYY-MM`     | `2026-04`    |
| bimonthly      | `YYYY-MM`     | `2026-04`    |
| quarterly      | `YYYY-Qn`     | `2026-Q2`    |
| semi_annual    | `YYYY-Hn`     | `2026-H1`    |
| biannual       | `YYYY-Hn`     | `2026-H1`    |
| annual         | `YYYY`        | `2026`       |
| biennial+      | `YYYY`        | `2026`       |

## `Warranty`

Tracks product warranties. The `warranties` array is optional at the top level — always access as `data.warranties || []` and guard writes with `if (!d.warranties) d.warranties = []`.

```jsonc
{
  "id": "w3x1p7q2",
  "name": "Samsung 65\" TV",         // required; item description
  "brand": "Samsung",                // optional; inline-editable in table
  "who": "joint",                    // who enum; inline-editable in table
  "category": "electronics",         // warranty_category enum; inline-editable in table
  "store": "Best Buy",               // optional; where purchased
  "serial": "SN123456",              // optional; serial/model number
  "purchase_date": "2024-11-25",     // optional; ISO date
  "expiry_date": "2026-11-25",       // optional; ISO date — drives urgency coloring
  "coverage": "2-year limited, parts & labor",  // optional; free-text coverage description
  "archived": false,
  "notes": ""
}
```

Urgency tiers (based on days until `expiry_date`):
- **≤ 7 days**: red row background + red filled badge ("Xd left")
- **≤ 30 days**: amber row background + red-outline badge ("Xd left")
- **≤ 90 days**: amber-outline badge ("Xd left")
- **Expired** (past date): faded row (opacity 0.55) + dark red "Expired" badge

## `Account`

Registry of financial accounts (bank, brokerage, retirement, …). Read-mostly: "what accounts exist, who owns them, why". The `accounts` array is optional at the top level — always access as `data.accounts || []` and guard writes with `if (!d.accounts) d.accounts = []`.

**No live balance tracking.** Balances are optional manual snapshots (`snapshots[]`), appended via the "Add balance snapshot" row action or the bulk "Update balances" flow (blank field = account skipped). The latest snapshot (by date) is what the UI shows, alongside its age. One snapshot per date — re-snapshotting the same day replaces that entry. Snapshot history also feeds the balance trend chart (investment types), which forward-fills between snapshots — see `docs/decisions.md`. Marking an account `closed` writes a `$0` snapshot in the same mutation (when the latest balance is non-zero) so the chart's aggregate history stays accurate.

```jsonc
{
  "id": "a9k2m4x1",
  "institution": "PNC",              // required; bank/broker name
  "name": "Joint Checking",          // required; account label
  "type": "checking",                // account_type enum
  "who": "joint",                    // who enum
  "last4": "4821",                   // optional; last 4 digits, display only
  "apy": 4.35,                       // optional; interest rate %, updated manually
  "opened_date": "2019-03-12",       // optional; ISO date
  "status": "open",                  // account_status enum; closed rows faded + struck through
  "snapshots": [                     // optional; manual balance snapshots, ascending by date
    { "date": "2026-06-30", "balance": 18250.44 }
  ],
  "notes": "Direct deposit lands here"
}
```

## `HistoryEntry`

Appended by `state.mutate()` on every data change. Capped at 500 entries (oldest dropped first). Never written in guest/demo mode.

```jsonc
{
  "ts": "2026-05-29T21:04:33.412Z",  // ISO timestamp of the mutation
  "label": "mark paid: Chase — Rent $1200"  // human-readable action label passed to state.mutate()
}
```

Label format convention: `action: subject [→ value]`, e.g.:
- Bills: `mark paid: Chase — Rent $1200`, `schedule: Amex — Gold $0`, `no payment: PNC — Mortgage`, `edit note: Chase — Rent`
- Perks: `claimed perk: Dining Credit`, `skip perk: Travel Credit`
- Subscriptions: `set status: Netflix → cancelled`, `advance Netflix`, `add subscription: Spotify`
- Backlog: `done task: Replace kitchen faucet`, `snooze task: Fix gutters until 2026-06-07`
- Vesting: `mark vested: Jun 15, 2026 (50 shares)`, `mark sold: Jun 15, 2026 $5000`
- Warranties: `edit brand: Samsung 65" TV`, `archive: Dyson V11`

Rendered in `history.html`, grouped by date, newest first. Read-only — never mutated directly by the UI.

## Migration notes

- v1 is the initial shape. Any breaking change → bump `version` and write a migration in `js/core/state.js`.
- Never rename a field silently; add the new one, migrate, then remove the old.
