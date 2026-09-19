// Pure-logic tests for vesting computation helpers in js/core/derive.js.
// Run with: npm test  (node --test tests/)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computedGrossValue, isAutoValue, netShares, netValue,
} from '../js/core/derive.js';

// ---------- helpers ----------

function makeData(overrides = {}) {
  return {
    grants: [
      { id: 'g1', ticker: 'CSCO', company: 'Cisco', type: 'rsu', who: 'chang' },
    ],
    stock_prices: { CSCO: 109.46 },
    vesting: [],
    ...overrides,
  };
}

function makeEvent(overrides = {}) {
  return {
    id: 'v1', grant_id: 'g1', type: 'rsu', who: 'chang',
    date: '2026-09-15', shares: 184, gross_value: 15000,
    status: 'upcoming', sold_date: null, sold_amount: null,
    ...overrides,
  };
}

// ---------- computedGrossValue ----------

test('computedGrossValue: upcoming event uses live stock price × shares', () => {
  const data = makeData();
  const v = makeEvent({ status: 'upcoming', shares: 184 });
  assert.equal(computedGrossValue(v, data), 184 * 109.46);
});

test('computedGrossValue: vested event uses live stock price × shares', () => {
  const data = makeData();
  const v = makeEvent({ status: 'vested', shares: 50 });
  assert.equal(computedGrossValue(v, data), 50 * 109.46);
});

test('computedGrossValue: sold event returns stored gross_value', () => {
  const data = makeData();
  const v = makeEvent({ status: 'sold', shares: 184, gross_value: 20140.64 });
  assert.equal(computedGrossValue(v, data), 20140.64);
});

test('computedGrossValue: pending_settlement returns stored gross_value', () => {
  const data = makeData();
  const v = makeEvent({ status: 'pending_settlement', gross_value: 5000 });
  assert.equal(computedGrossValue(v, data), 5000);
});

test('computedGrossValue: no stock price falls back to stored gross_value', () => {
  const data = makeData({ stock_prices: {} });
  const v = makeEvent({ status: 'upcoming', gross_value: 15000 });
  assert.equal(computedGrossValue(v, data), 15000);
});

test('computedGrossValue: no shares falls back to stored gross_value', () => {
  const data = makeData();
  const v = makeEvent({ status: 'upcoming', shares: null, gross_value: 8000 });
  assert.equal(computedGrossValue(v, data), 8000);
});

test('computedGrossValue: grant without ticker falls back to stored gross_value', () => {
  const data = makeData({ grants: [{ id: 'g1', type: 'rsu', who: 'chang' }] });
  const v = makeEvent({ status: 'upcoming', gross_value: 12000 });
  assert.equal(computedGrossValue(v, data), 12000);
});

test('computedGrossValue: ticker is case-insensitive', () => {
  const data = makeData({ grants: [{ id: 'g1', ticker: 'csco', type: 'rsu', who: 'chang' }] });
  const v = makeEvent({ status: 'upcoming', shares: 10 });
  assert.equal(computedGrossValue(v, data), 10 * 109.46);
});

test('computedGrossValue: missing grant returns stored gross_value', () => {
  const data = makeData();
  const v = makeEvent({ grant_id: 'nonexistent', status: 'upcoming', gross_value: 7777 });
  assert.equal(computedGrossValue(v, data), 7777);
});

// ---------- isAutoValue ----------

test('isAutoValue: true for upcoming with ticker and shares', () => {
  const data = makeData();
  const v = makeEvent({ status: 'upcoming', shares: 100 });
  assert.equal(isAutoValue(v, data), true);
});

test('isAutoValue: false for sold status', () => {
  const data = makeData();
  const v = makeEvent({ status: 'sold', shares: 100 });
  assert.equal(isAutoValue(v, data), false);
});

test('isAutoValue: false for pending_settlement status', () => {
  const data = makeData();
  const v = makeEvent({ status: 'pending_settlement', shares: 100 });
  assert.equal(isAutoValue(v, data), false);
});

test('isAutoValue: false when no stock price', () => {
  const data = makeData({ stock_prices: {} });
  const v = makeEvent({ status: 'upcoming', shares: 100 });
  assert.equal(isAutoValue(v, data), false);
});

test('isAutoValue: false when no shares', () => {
  const data = makeData();
  const v = makeEvent({ status: 'upcoming', shares: null });
  assert.equal(isAutoValue(v, data), false);
});

// ---------- netShares ----------

test('netShares: returns shares minus withheld', () => {
  const v = makeEvent({ shares: 184, shares_withheld: 42 });
  assert.equal(netShares(v), 142);
});

test('netShares: returns null when shares_withheld is not set', () => {
  const v = makeEvent({ shares: 184 });
  assert.equal(netShares(v), null);
});

test('netShares: returns null when shares is null', () => {
  const v = makeEvent({ shares: null, shares_withheld: 10 });
  assert.equal(netShares(v), null);
});

test('netShares: handles zero withheld', () => {
  const v = makeEvent({ shares: 100, shares_withheld: 0 });
  assert.equal(netShares(v), 100);
});

// ---------- netValue ----------

test('netValue: computes net value from live price', () => {
  const data = makeData();
  const v = makeEvent({ status: 'upcoming', shares: 184, shares_withheld: 42 });
  const expected = 109.46 * 142;
  assert.equal(netValue(v, data), expected);
});

test('netValue: returns null when no shares_withheld', () => {
  const data = makeData();
  const v = makeEvent({ status: 'upcoming', shares: 184 });
  assert.equal(netValue(v, data), null);
});

test('netValue: uses stored gross_value for sold events', () => {
  const data = makeData();
  const v = makeEvent({ status: 'sold', shares: 184, shares_withheld: 42, gross_value: 20140.64 });
  const pricePerShare = 20140.64 / 184;
  const expected = pricePerShare * 142;
  assert.equal(netValue(v, data), expected);
});

test('netValue: returns null when shares is zero', () => {
  const data = makeData();
  const v = makeEvent({ shares: 0, shares_withheld: 0 });
  assert.equal(netValue(v, data), null);
});

// ---------- mark-sold snapshot scenario ----------

test('computedGrossValue: simulates mark-sold capturing live price', () => {
  const data = makeData();
  const v = makeEvent({ status: 'upcoming', shares: 184, gross_value: 15000 });

  // Before marking sold: value is live
  const liveBefore = computedGrossValue(v, data);
  assert.equal(liveBefore, 184 * 109.46);
  assert.notEqual(liveBefore, 15000);

  // Simulate mark-sold: snapshot the live value into gross_value
  const sold = { ...v, status: 'sold', gross_value: liveBefore, sold_amount: liveBefore };

  // After: the sold event returns the snapshotted value, not the stale one
  assert.equal(computedGrossValue(sold, data), liveBefore);
  assert.notEqual(computedGrossValue(sold, data), 15000);
});

test('computedGrossValue: without snapshot fix, sold would return stale value', () => {
  const data = makeData();
  const v = makeEvent({ status: 'upcoming', shares: 184, gross_value: 15000 });

  // If we forgot to snapshot: status changes but gross_value stays at 15000
  const soldBroken = { ...v, status: 'sold' };
  assert.equal(computedGrossValue(soldBroken, data), 15000);
});
