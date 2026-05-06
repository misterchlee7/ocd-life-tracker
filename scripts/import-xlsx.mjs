// Import data from "Bills Bills Bills" xlsx → ocd-life-tracker data.json shape.
//
// Usage:
//   node scripts/import-xlsx.mjs <path-to.xlsx> <out.json>
//
// Sections in the Bills sheet:
//   rows 1–51   real bills → bills[]
//   rows 53–71  credits     → perks[]
//   rows 82–112 subs        → subscriptions[]
//   rows 114–117 rewards    → merged into bill.cc.rewards_balance
//   rows 118–140 vesting    → grants[] + vesting[]

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

const [,, xlsxPath, outPath = '/tmp/imported-data.json'] = process.argv;
if (!xlsxPath) {
  console.error('Usage: node import-xlsx.mjs <xlsx> [out.json]');
  process.exit(1);
}

// ---------- xlsx parsing (zip + xml, no deps) ----------

const tmp = mkdtempSync(join(tmpdir(), 'xlsx-'));
try {
  execSync(`unzip -o ${JSON.stringify(xlsxPath)} -d ${JSON.stringify(tmp)} > /dev/null`);
} catch (e) {
  console.error('unzip failed:', e.message); process.exit(1);
}

const ssXml = readFileSync(`${tmp}/xl/sharedStrings.xml`, 'utf8');
const sharedStrings = [];
for (const m of ssXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) {
  sharedStrings.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
}

const wbXml = readFileSync(`${tmp}/xl/workbook.xml`, 'utf8');
const sheetDefs = [...wbXml.matchAll(/<sheet[^>]+name="([^"]+)"[^>]+r:id="([^"]+)"/g)].map(x => ({ name: x[1], rid: x[2] }));
const relsXml = readFileSync(`${tmp}/xl/_rels/workbook.xml.rels`, 'utf8');
const rels = {};
for (const m of relsXml.matchAll(/<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g)) rels[m[1]] = m[2];

function colIdx(letters) {
  let n = 0; for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1;
}
function parseSheet(path) {
  const xml = readFileSync(`${tmp}/xl/${path}`, 'utf8');
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = {};
    for (const cm of rm[1].matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const refM = /r="([A-Z]+)\d+"/.exec(cm[1]);
      const typeM = /t="([^"]+)"/.exec(cm[1]);
      if (!refM) continue;
      const col = colIdx(refM[1]);
      const vM = /<v>([\s\S]*?)<\/v>/.exec(cm[2] || '');
      const isM = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(cm[2] || '');
      let val = null;
      if (vM) {
        const raw = vM[1];
        if (typeM?.[1] === 's') val = sharedStrings[Number(raw)];
        else val = isNaN(Number(raw)) ? raw : Number(raw);
      } else if (isM) val = isM[1];
      row[col] = val;
    }
    const max = Math.max(-1, ...Object.keys(row).map(Number));
    const arr = [];
    for (let i = 0; i <= max; i++) arr.push(row[i] ?? null);
    rows.push(arr);
  }
  return rows;
}

const sheets = {};
for (const s of sheetDefs) sheets[s.name] = parseSheet(rels[s.rid]);

rmSync(tmp, { recursive: true, force: true });

// ---------- mapping helpers ----------

function excelDateToISO(serial) {
  if (serial == null || isNaN(Number(serial))) return null;
  const ms = (Number(serial) - 25569) * 86400 * 1000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

const WHO_MAP = { 'All': 'joint', 'Chang': 'chang', 'Kiju': 'kiju' };

const FREQ_MAP = {
  'Monthly': 'monthly',
  'Bimonthly': 'bimonthly',
  'Quarterly': 'quarterly',
  'Biannual': 'biannual',
  'Semi-annual': 'semi_annual',
  'Annual': 'annual',
  'Biennial': 'biennial',
  'Triennial': 'triennial',
  'Quinquennial': 'quinquennial',
  'Trial': 'annual',
};

const TYPE_MAP = {
  'Loan': 'loan',
  'Fee': 'fee',
  'Investment': 'investment',
  'CC': 'cc',
  'Utility': 'utility',
  'Insurance': 'insurance',
  'Gift': 'gift',
};

function uid() { return Math.random().toString(36).slice(2, 10); }

// ---------- transform ----------

// Non-header non-empty rows from Bills sheet.
const allBillsRows = sheets['Bills'];
const billsSheet = allBillsRows.slice(1).filter(r => r && (r[0] != null || r[1] != null));

const bills = [];
const perks = [];
const subscriptions = [];
const grants = [];
const vesting = [];

// Section 1: bills (rows 0–51 of non-header data, but indices in sheet).
// Identify by Who ∈ {All, Chang, Kiju} AND Type ∈ TYPE_MAP.
for (const r of billsSheet) {
  const [brand, name, who, day, amount, freq, monthlyAmt, type, dueDate, paid, reoccuring, ccLast, aprCounter, aprAmount, pending, stillDue, notes] = r;
  if (!brand && !name) continue;
  if (!WHO_MAP[who]) continue;
  if (!TYPE_MAP[type]) continue;
  if (!FREQ_MAP[freq]) continue;

  const bill = {
    id: uid(),
    brand: String(brand || ''),
    name: String(name || ''),
    who: WHO_MAP[who],
    type: TYPE_MAP[type],
    frequency: FREQ_MAP[freq],
    day: Number.isFinite(day) ? Number(day) : 1,
    auto_pay: paid === 'AUTO',
    archived: false,
    notes: notes ? String(notes) : '',
  };
  if (amount != null && isFinite(Number(amount)) && Number(amount) > 0) bill.amount = Number(amount);
  if (monthlyAmt != null && isFinite(Number(monthlyAmt)) && Number(monthlyAmt) > 0) bill.monthly_amount = Number(monthlyAmt);
  if (!bill.amount && type === 'CC') bill.variable = true;

  if (type === 'CC') {
    const cc = {};
    const iso = excelDateToISO(ccLast);
    if (iso) cc.last_used = iso;
    if (aprCounter != null && isFinite(Number(aprCounter)) && Number(aprCounter) > 0) {
      cc.apr_zero = {
        months_left: Number(aprCounter),
        balance_remaining: Number(aprAmount) || 0,
      };
    }
    if (Object.keys(cc).length) bill.cc = cc;
  }
  bills.push(bill);
}

// Section 2: perks (rows where Type === 'Credit')
for (const r of billsSheet) {
  const [card, name, day, amount, freq, type, claimed] = r;
  if (type !== 'Credit') continue;
  if (!card || !name) continue;
  const who = /Kiju/i.test(String(card)) ? 'kiju' : 'chang';  // both users use the same cards; default chang, caller can edit
  perks.push({
    id: uid(),
    card: String(card),
    name: String(name),
    who,
    frequency: FREQ_MAP[freq] || 'monthly',
    value: Number(amount) || 0,
    reset_day: Number.isFinite(day) ? Number(day) : 1,
    archived: false,
    notes: claimed && claimed !== 'N' && claimed !== 'Available' ? String(claimed) : '',
  });
}

// Annual fee info — we'll pull from subscriptions section where the card is a subscription.
// Section 3: subscriptions. Find the "Subscription" header row in billsSheet, then iterate
// rows after it until the next section header ("Free Floating Credits:" etc.) or a
// non-sub row (where col 0 is a date number — vesting).
const subHeaderIdx = billsSheet.findIndex(r => r[0] === 'Subscription');
const vestingStartIdx = billsSheet.findIndex((r, i) => subHeaderIdx >= 0 && i > subHeaderIdx &&
  typeof r[0] === 'number' && typeof r[1] === 'number');
const subEndIdx = vestingStartIdx > 0 ? vestingStartIdx : billsSheet.length;

for (let i = subHeaderIdx + 1; i < subEndIdx; i++) {
  const r = billsSheet[i];
  if (!r) continue;
  const [name, cost, freq, rDay, renewalSerial, col1] = r;
  if (!name || typeof name !== 'string') continue;
  // Skip the "Free Floating Credits:" and similar section marker rows
  if (/^(Free Floating|Liquid Assets|Subs to Cancel|Bonus Tasks)/i.test(name)) continue;
  // Skip rewards-balance rows (freq === 'on Amex', 'on United', 'rewards credit')
  if (typeof freq === 'string' && /^on |rewards credit/i.test(freq)) continue;
  if (!freq || !['Monthly', 'Quarterly', 'Semi-annual', 'Biannual', 'Annual', 'Biennial', 'Triennial', 'Trial'].includes(freq)) continue;
  const isTrial = freq === 'Trial';
  const sub = {
    id: uid(),
    name: String(name),
    who: 'chang',                 // default; user can edit
    category: categorizeSubName(String(name)),
    billed_to: col1 && typeof col1 === 'string' && col1.toLowerCase().includes('amex') ? String(col1) : '',
    amount: Number(cost) || 0,
    frequency: isTrial ? 'annual' : (FREQ_MAP[freq] || 'monthly'),
    status: isTrial ? 'trial' : 'active',
    archived: false,
    notes: '',
  };
  const renewalISO = excelDateToISO(renewalSerial);
  if (renewalISO) sub.next_renewal = renewalISO;
  else if (rDay) {
    // monthly sub with a day-of-month — construct next renewal from today + day
    const today = new Date();
    let y = today.getFullYear(), m = today.getMonth();
    if (today.getDate() >= Number(rDay)) { m++; if (m > 11) { m = 0; y++; } }
    sub.next_renewal = `${y}-${String(m + 1).padStart(2, '0')}-${String(Number(rDay)).padStart(2, '0')}`;
  }
  if (isTrial) sub.trial_ends = sub.next_renewal || null;
  subscriptions.push(sub);
}

function categorizeSubName(n) {
  const s = n.toLowerCase();
  if (/youtube|spotify|apple music|tidal|netflix|hulu|disney|prime video/.test(s)) return 'streaming';
  if (/spotify/.test(s)) return 'music';
  if (/storage|drive|icloud|1password|password|gitkraken|adobe|claude|odk|autopilot|card.?pointers|surfshark|epidemic|patreon|ring protect|huckleberry/.test(s)) return 'software';
  if (/costco|amazon prime|target 360|walmart|instacart|dashpass|uber one/.test(s)) return 'shopping';
  if (/fitness|peloton|strava/.test(s)) return 'fitness';
  if (/mint mobile|phone|t-mobile|verizon|att/.test(s)) return 'other';
  if (/amex|chase|sapphire|platinum|gold|plat/.test(s)) return 'other'; // annual fees for cards
  if (/property tax|tax/.test(s)) return 'other';
  if (/robinhood|broker/.test(s)) return 'software';
  return 'other';
}

// Section 4: free-floating rewards credits — rows with freq === 'on Amex'/'on United'/'rewards credit'
for (const r of billsSheet) {
  if (!r) continue;
  const [name, value, kind] = r;
  if (!name || !value) continue;
  if (typeof kind !== 'string' || !/^on |rewards credit/i.test(kind)) continue;
  // Find a CC bill matching by brand/name containing the text
  const nameLower = String(name).toLowerCase();
  const target = bills.find(b => b.type === 'cc' && `${b.brand} ${b.name}`.toLowerCase().includes(nameLower.split(' ')[0].toLowerCase()));
  if (target) {
    target.cc = target.cc || {};
    target.cc.rewards_balance = Number(value) || 0;
    target.notes = target.notes ? `${target.notes}; ${name}: $${value}` : `${name}: $${value} rewards`;
  } else {
    // no CC matches — skip silently (e.g. United TravelBank Cash)
  }
}

// Section 5: ESPP / vesting events (rows 118+ where col 0 is a date serial, col 1 is amount)
// A few rows have 'espp' marker in col 2; others default to RSU.
const grantRsu = { id: uid(), label: 'Etrade RSU', type: 'rsu', who: 'chang', grant_date: null, total_shares: null, schedule_note: 'Imported from spreadsheet', archived: false, notes: '' };
const grantEspp = { id: uid(), label: 'Etrade ESPP', type: 'espp', who: 'chang', grant_date: null, total_shares: null, schedule_note: 'Imported from spreadsheet', archived: false, notes: '' };
grants.push(grantRsu, grantEspp);

const todayISO = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

for (const r of billsSheet) {
  if (!r) continue;
  const [dateSerial, amount, marker] = r;
  // Vesting rows: col 0 is a date serial number (Excel dates are > 40000), col 1 is an amount
  if (typeof dateSerial !== 'number' || dateSerial < 40000 || !amount || typeof amount !== 'number') continue;
  const iso = excelDateToISO(dateSerial);
  if (!iso) continue;
  const isEspp = String(marker || '').toLowerCase().includes('espp');
  const status = iso < todayISO ? 'vested' : 'upcoming';
  vesting.push({
    id: uid(),
    grant_id: isEspp ? grantEspp.id : grantRsu.id,
    type: isEspp ? 'espp' : 'rsu',
    who: 'chang',
    date: iso,
    shares: null,
    gross_value: Number(amount) || 0,
    status,
    sold_date: null,
    sold_amount: null,
    notes: '',
  });
}

// ---------- assemble data.json ----------

const data = {
  version: 1,
  updated_at: new Date().toISOString(),
  settings: {
    paycheck: {
      frequency: 'biweekly',
      day_of_week: 'friday',
      next_date: null,
      amount_estimate: 0,
    },
    rotation_target_months: 6,
    apr_warn_months: 2,
  },
  bills,
  payments: [],
  perks,
  perk_claims: [],
  subscriptions,
  grants,
  vesting,
  backlog: [],
};

writeFileSync(outPath, JSON.stringify(data, null, 2));

console.log(`✓ wrote ${outPath}`);
console.log(`  bills:         ${bills.length}`);
console.log(`  perks:         ${perks.length}`);
console.log(`  subscriptions: ${subscriptions.length}`);
console.log(`  grants:        ${grants.length}`);
console.log(`  vesting:       ${vesting.length}`);
