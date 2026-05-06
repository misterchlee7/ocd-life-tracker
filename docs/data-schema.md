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
  "backlog":       [ /* BacklogItem */ ],
  "warranties":    [ /* Warranty */ ]   // optional; accessed as data.warranties || []
}
```

## Enums

```
who:        "chang" | "kiju" | "joint"
frequency:  "monthly" | "bimonthly" | "quarterly" | "biannual" | "semi_annual" | "annual" | "biennial" | "triennial" | "quinquennial" | "one_time" | "variable"
bill_type:  "cc" | "loan" | "utility" | "insurance" | "fee" | "investment" | "gift" | "other"
bill_status (per-period): "unpaid" | "scheduled" | "needs_confirm" | "paid" | "auto" | "skipped"
perk_status (per-period): "available" | "claimed" | "skipped" | "expired"
sub_status: "active" | "trial" | "paused" | "cancelled"
sub_category: "streaming" | "music" | "software" | "fitness" | "news" | "storage" | "gaming" | "shopping" | "cc_annual_fee" | "other"
warranty_category: "electronics" | "appliance" | "vehicle" | "furniture" | "tool" | "outdoor" | "clothing" | "other"
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
  "monthly_amount": 3077.99,         // optional; user's own estimate for budgeting (what was "Monthly Amt" in sheet)
  "balance_remaining": 47200.00,     // optional; total outstanding balance (e.g. loan principal left); updated manually
  "variable": false,                 // true for CCs where amount fluctuates
  "next_due_date": "2026-05-01",     // optional override for non-monthly bills; otherwise derived
  "auto_pay": false,
  "archived": false,
  "due_date": "2026-11-01",       // optional one-time due date shown as a badge under the bill name
  "notes": "",

  // CC-specific (optional)
  "cc": {
    "last_used": "2025-12-07",       // for rotation tracking; omit on regular-use cards
    "rewards_balance": 79.46,        // unredeemed rewards; unit determined by rewards_unit
    "rewards_unit": "dollars",       // "dollars" (default, omit for existing data) | "points"
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
  "next_renewal": "2026-06-06",
  "status": "active",                // sub_status enum
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
  "gross_value": 12551.97,           // user's estimate or actual at event
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

## Migration notes

- v1 is the initial shape. Any breaking change → bump `version` and write a migration in `js/core/state.js`.
- Never rename a field silently; add the new one, migrate, then remove the old.
