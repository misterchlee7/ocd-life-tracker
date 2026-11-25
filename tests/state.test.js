// Tests for the two-file save model and the unsaved-edits draft.
//
// Background: data.json and the stock-price bot used to share one file, so every
// scheduled bot run staled an open tab's sha and the next Save died with a 409 —
// and Refresh, the advice the error gave, overwrote the only copy of the pending
// edits. These tests pin both halves of the fix: prices never reach data.json,
// and a reload can never destroy unsaved work.
//
// state.js touches localStorage and fetch, so both are stubbed before import.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';

// --- stubs, installed before importing state.js -----------------------------

function makeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
    _map: m,
  };
}

globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();

// A tiny fake of the GitHub contents API, with per-path content + sha.
const server = {
  files: {},            // path -> { content (object), sha }
  puts: [],             // recorded PUT bodies, for assertions
  failNextPutWith: null, // e.g. { path, status } to force one conflict
};

function setFile(path, content, sha) {
  server.files[path] = { content, sha };
}

globalThis.fetch = async (url, opts = {}) => {
  const path = decodeURIComponent(new URL(url).pathname.split('/contents/')[1].split('?')[0]);
  const method = opts.method || 'GET';

  if (method === 'GET') {
    const f = server.files[path];
    if (!f) return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: btoa(unescape(encodeURIComponent(JSON.stringify(f.content)))), sha: f.sha }),
      text: async () => '',
    };
  }

  // PUT
  const body = JSON.parse(opts.body);
  const parsed = JSON.parse(decodeURIComponent(escape(atob(body.content))));
  server.puts.push({ path, body: parsed, sha: body.sha, message: body.message });

  if (server.failNextPutWith && server.failNextPutWith.path === path) {
    server.failNextPutWith = null;
    return { ok: false, status: 409, text: async () => 'sha mismatch', json: async () => ({}) };
  }
  const nextSha = (server.files[path]?.sha || 'sha0') + '+';
  setFile(path, parsed, nextSha);
  return { ok: true, status: 200, json: async () => ({ content: { sha: nextSha } }), text: async () => '' };
};

const { state } = await import('../js/core/state.js');

const DATA = 'data.json';
const PRICES = 'stock-prices.json';

function baseData(extra = {}) {
  return {
    version: 1,
    updated_at: '2026-11-01T00:00:00Z',
    settings: {},
    bills: [{ id: 'b1', name: 'Rent', who: 'joint' }],
    payments: [],
    perks: [], perk_claims: [], subscriptions: [], grants: [], vesting: [],
    backlog: [], history: [],
    ...extra,
  };
}

async function freshLoad({ prices = { CSCO: 90 }, data = baseData(), pricesMissing = false } = {}) {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('otl.pat', 'tok');
  localStorage.setItem('otl.owner', 'owner');
  localStorage.setItem('otl.repo', 'repo');
  server.files = {};
  server.puts = [];
  server.failNextPutWith = null;
  setFile(DATA, data, 'dataSha1');
  if (!pricesMissing) setFile(PRICES, prices, 'priceSha1');
  await state.init();
}

describe('two-file save model', () => {
  beforeEach(async () => { await freshLoad(); });

  test('prices are exposed on data.stock_prices for readers', () => {
    assert.deepEqual(state.get().data.stock_prices, { CSCO: 90 });
  });

  test('stock_prices is STRIPPED from the data.json that gets written', async () => {
    state.mutate(d => { d.bills[0].name = 'Mortgage'; }, 'edit bill: Rent');
    const res = await state.save();
    assert.equal(res.ok, true);
    const dataPut = server.puts.find(p => p.path === DATA);
    assert.ok(dataPut, 'data.json should have been written');
    assert.equal('stock_prices' in dataPut.body, false,
      'data.json must never carry stock prices again — that is the whole fix');
  });

  test('a data-only edit does not write stock-prices.json at all', async () => {
    state.mutate(d => { d.bills[0].name = 'Mortgage'; }, 'edit bill');
    await state.save();
    assert.equal(server.puts.filter(p => p.path === PRICES).length, 0);
  });

  test('a price edit writes stock-prices.json', async () => {
    state.mutatePrices(p => { p.CSCO = 93.99; }, 'update CSCO price');
    await state.save();
    const pricePut = server.puts.find(p => p.path === PRICES);
    assert.deepEqual(pricePut.body, { CSCO: 93.99 });
  });

  test('price dirtiness is derived: undo back to the original writes nothing', async () => {
    state.mutatePrices(p => { p.CSCO = 93.99; }, 'update CSCO price');
    state.undo();
    await state.save();
    assert.equal(server.puts.filter(p => p.path === PRICES).length, 0,
      'prices reverted to their original value should not be PUT');
  });

  test('missing stock-prices.json falls back to the legacy key inside data.json', async () => {
    await freshLoad({ pricesMissing: true, data: baseData({ stock_prices: { CSCO: 77 } }) });
    assert.deepEqual(state.get().data.stock_prices, { CSCO: 77 },
      'old data must still render before the split file exists');
  });
});

describe('price conflict merges per ticker', () => {
  test('the bot updating another ticker does not clobber our edit', async () => {
    await freshLoad({ prices: { CSCO: 90, AAPL: 200 } });
    state.mutatePrices(p => { p.CSCO = 93.99; }, 'update CSCO price');

    // bot moves AAPL while we were editing CSCO, then our first PUT conflicts
    setFile(PRICES, { CSCO: 90, AAPL: 222 }, 'priceSha2');
    server.failNextPutWith = { path: PRICES, status: 409 };

    const res = await state.save();
    assert.equal(res.ok, true);
    const final = server.puts.filter(p => p.path === PRICES).pop();
    assert.deepEqual(final.body, { CSCO: 93.99, AAPL: 222 },
      'our ticker wins, the bot\'s untouched ticker survives');
  });
});

describe('data.json conflict handling', () => {
  test('identical remote content retries with the fresh sha', async () => {
    await freshLoad();
    state.mutate(d => { d.bills[0].name = 'Mortgage'; }, 'edit bill');
    // sha moved but content is unchanged (empty commit / no-op write)
    const same = JSON.parse(JSON.stringify(server.files[DATA].content));
    setFile(DATA, same, 'dataSha2');
    server.failNextPutWith = { path: DATA, status: 409 };

    const res = await state.save();
    assert.equal(res.ok, true, 'a sha-only change is safe to retry');
    assert.equal(server.puts.filter(p => p.path === DATA).length, 2);
  });

  test('a REAL concurrent edit fails loudly and keeps the draft', async () => {
    await freshLoad();
    state.mutate(d => { d.bills[0].name = 'Mortgage'; }, 'edit bill');
    setFile(DATA, baseData({ bills: [{ id: 'b1', name: 'Something Kiju typed' }] }), 'dataSha2');
    server.failNextPutWith = { path: DATA, status: 409 };

    const res = await state.save();
    assert.equal(res.ok, false, 'must not silently merge someone else\'s edit');
    assert.match(res.error, /conflict/i);
    assert.ok(localStorage.getItem('otl.draft'), 'edits must stay recoverable after a failed save');
  });
});

describe('draft survives a reload', () => {
  beforeEach(async () => { await freshLoad(); });

  test('mutate writes a draft', () => {
    assert.equal(localStorage.getItem('otl.draft'), null);
    state.mutate(d => { d.bills[0].name = 'Mortgage'; }, 'edit bill: Rent');
    const draft = JSON.parse(localStorage.getItem('otl.draft'));
    assert.equal(draft.data.bills[0].name, 'Mortgage');
    assert.deepEqual(draft.labels, ['edit bill: Rent']);
  });

  test('refresh does NOT destroy the draft (the original data-loss bug)', async () => {
    state.mutate(d => { d.bills[0].name = 'Mortgage'; }, 'edit bill');
    await state.refresh();
    assert.ok(localStorage.getItem('otl.draft'),
      'refresh used to overwrite the only copy of unsaved edits');
    assert.equal(state.hasDraft(), true);
  });

  test('restoreDraft reapplies the edits and marks them unsaved', async () => {
    state.mutate(d => { d.bills[0].name = 'Mortgage'; }, 'edit bill');
    await state.refresh();
    assert.equal(state.get().data.bills[0].name, 'Rent', 'refresh reverts the screen');
    assert.equal(state.restoreDraft(), true);
    assert.equal(state.get().data.bills[0].name, 'Mortgage');
    assert.equal(state.get().dirty, true);
  });

  test('draftInfo flags a draft whose base sha has moved on', async () => {
    state.mutate(d => { d.bills[0].name = 'Mortgage'; }, 'edit bill');
    setFile(DATA, baseData(), 'dataSha99');
    await state.refresh();
    assert.equal(state.draftInfo().stale, true);
  });

  test('a successful save clears the draft', async () => {
    state.mutate(d => { d.bills[0].name = 'Mortgage'; }, 'edit bill');
    await state.save();
    assert.equal(localStorage.getItem('otl.draft'), null);
    assert.equal(state.hasDraft(), false);
  });

  test('guest mode never writes a draft and never PUTs', async () => {
    state.enterGuestMode(baseData({ stock_prices: { CSCO: 1 } }));
    state.mutate(d => { d.bills[0].name = 'Demo edit'; }, 'edit bill');
    state.mutatePrices(p => { p.CSCO = 2; }, 'price');
    const before = server.puts.length;
    const res = await state.save();
    assert.equal(res.noop, true);
    assert.equal(server.puts.length, before, 'demo mode must never reach GitHub');
    assert.equal(localStorage.getItem('otl.draft'), null);
  });
});

describe('backup export / import', () => {
  beforeEach(async () => { await freshLoad(); });

  test('export carries data without stock_prices, plus prices alongside', () => {
    const b = state.exportBundle();
    assert.equal('stock_prices' in b.data, false);
    assert.deepEqual(b.stock_prices, { CSCO: 90 });
    assert.ok(b.exported_at);
  });

  test('import round-trips an exported bundle as unsaved edits', () => {
    const b = state.exportBundle();
    b.data.bills[0].name = 'From backup';
    b.stock_prices = { CSCO: 1.23 };
    state.importBundle(b);
    assert.equal(state.get().data.bills[0].name, 'From backup');
    assert.deepEqual(state.get().data.stock_prices, { CSCO: 1.23 });
    assert.equal(state.get().dirty, true, 'import must not auto-save');
  });

  test('import rejects a file that is not from this app', () => {
    assert.throws(() => state.importBundle({ hello: 'world' }), /bills/);
  });
});
