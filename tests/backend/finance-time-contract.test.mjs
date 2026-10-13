// FIN time/receipt contract + static migration checks (offline; the SQL is NOT executed here).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  parseFinanceEntry,
  parseFinanceCorrection,
  parseVietnamInstant,
  FinanceValidationError,
} from '../../dist/packages/contracts/src/finance.js';

const base = {
  direction: 'expense',
  category_id: 'AAAAAAAA-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  amount_vnd: '1000',
  note: null,
};
const bad = (v, field, fn = parseFinanceEntry) =>
  assert.throws(
    () => fn(v),
    (e) => e instanceof FinanceValidationError && e.field === field,
  );
const R = '55555555-5555-4555-8555-555555555555';

test('FIN time contract: legacy date-only requests still parse unchanged', () => {
  const r = parseFinanceEntry({ ...base, occurred_on: '2024-02-29' });
  assert.deepEqual(r, {
    direction: 'expense',
    category_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    amount_vnd: '1000',
    occurred_on: '2024-02-29',
    note: null,
  });
  bad(base, 'occurred_on'); // create without any time info
});
test('FIN time contract: auto carries no client date or time at all', () => {
  assert.deepEqual(parseFinanceEntry({ ...base, time_mode: 'auto' }), {
    direction: 'expense',
    category_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    amount_vnd: '1000',
    note: null,
    time_mode: 'auto',
  });
  bad({ ...base, time_mode: 'auto', occurred_on: '2026-01-01' }, 'occurred_on');
  bad(
    { ...base, time_mode: 'auto', occurred_at: '2026-01-01T00:00:00+07:00' },
    'occurred_at',
  );
});
test('FIN time contract: manual requires a strict Vietnam instant and derives the date', () => {
  const r = parseFinanceEntry({
    ...base,
    time_mode: 'manual',
    occurred_at: '2026-10-11T08:05+07:00',
  });
  assert.equal(r.occurred_at, '2026-10-11T08:05:00+07:00');
  assert.equal(r.occurred_on, '2026-10-11');
  assert.equal(r.time_mode, 'manual');
  for (const at of [
    undefined,
    '2026-10-11T08:05:00Z',
    '2026-10-11T08:05:00+00:00',
    '2026-10-11T08:05:00+08:00',
    '2026-10-11 08:05:00+07:00',
    '2026-02-30T08:05:00+07:00',
    '2026-10-11T24:00:00+07:00',
    '2026-10-11T08:60:00+07:00',
    '0000-10-11T08:05:00+07:00',
    1,
  ])
    bad({ ...base, time_mode: 'manual', occurred_at: at }, 'occurred_at');
  assert.equal(
    parseFinanceEntry({
      ...base,
      time_mode: 'manual',
      occurred_at: '2026-10-11T00:05:00+07:00',
      occurred_on: '2026-10-11',
    }).occurred_on,
    '2026-10-11',
  );
  bad(
    {
      ...base,
      time_mode: 'manual',
      occurred_at: '2026-10-11T00:05:00+07:00',
      occurred_on: '2026-10-10',
    },
    'occurred_on',
  );
  bad(
    {
      ...base,
      occurred_on: '2026-10-11',
      occurred_at: '2026-10-11T00:05:00+07:00',
    },
    'occurred_at',
  );
  bad({ ...base, time_mode: 'sometimes' }, 'time_mode');
});
test('FIN time contract: instant parser is strict and returns the exact UTC instant', () => {
  const p = parseVietnamInstant('2026-10-11T00:30:15+07:00');
  assert.equal(p.canonical, '2026-10-11T00:30:15+07:00');
  assert.equal(p.date, '2026-10-11');
  assert.equal(p.instant.toISOString(), '2026-10-10T17:30:15.000Z');
  assert.equal(parseVietnamInstant('2026-10-11'), null);
});
test('FIN receipt contract: receipt_id must be a UUID; null on create means none; correction distinguishes keep/remove', () => {
  const c = { ...base, time_mode: 'auto' };
  assert.equal(
    parseFinanceEntry({ ...c, receipt_id: R.toUpperCase() }).receipt_id,
    R,
  );
  assert.equal(
    'receipt_id' in parseFinanceEntry({ ...c, receipt_id: null }),
    false,
  );
  bad({ ...c, receipt_id: 'nope' }, 'receipt_id');
  bad({ ...c, receipt_id: 5 }, 'receipt_id');
  const corr = { ...base, reason: ' sửa ' };
  assert.equal(
    'receipt_id' in parseFinanceCorrection(corr),
    false,
    'absent = keep',
  );
  assert.equal(
    parseFinanceCorrection({ ...corr, receipt_id: null }).receipt_id,
    null,
    'null = remove',
  );
  assert.equal(
    parseFinanceCorrection({ ...corr, receipt_id: R }).receipt_id,
    R,
  );
});
test('FIN time contract: a correction may omit the date (keep) but never request auto', () => {
  const corr = { ...base, reason: 'r' };
  const keep = parseFinanceCorrection(corr);
  assert.equal('occurred_on' in keep, false);
  assert.equal(keep.reason, 'r');
  bad({ ...corr, time_mode: 'auto' }, 'time_mode', parseFinanceCorrection);
  const m = parseFinanceCorrection({
    ...corr,
    time_mode: 'manual',
    occurred_at: '2026-10-09T08:00:00+07:00',
  });
  assert.equal(m.occurred_on, '2026-10-09');
  bad({ ...corr, extra: 1 }, 'extra', parseFinanceCorrection);
  bad('x', 'body', parseFinanceCorrection);
  bad({ ...base }, 'reason', parseFinanceCorrection);
});
test('FIN time contract: stored-pending key order is stable (legacy order preserved)', () => {
  const r = parseFinanceEntry({
    note: null,
    occurred_on: '2024-01-01',
    amount_vnd: '5',
    category_id: base.category_id,
    direction: 'income',
  });
  assert.deepEqual(Object.keys(r), [
    'direction',
    'category_id',
    'amount_vnd',
    'occurred_on',
    'note',
  ]);
  assert.equal(JSON.stringify(parseFinanceEntry(r)), JSON.stringify(r));
});

// ---- static checks of 0015 (text only, nothing is executed) ----
const root = resolve(import.meta.dirname, '../..');
const sql = readFileSync(
  resolve(root, 'packages/database/src/migrations/0015_fin_receipt_time.sql'),
  'utf8',
).replace(/\s+/g, ' ');
test('FIN migration 0015 (static): additive, replaces guards, no destructive statements', () => {
  assert.doesNotMatch(
    sql,
    /\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\s+TABLE\b|\bDELETE\s+FROM\b/i,
  );
  assert.doesNotMatch(sql, /\bUPDATE\s+fin_entries\b/i);
  for (const piece of [
    'ADD COLUMN occurred_at timestamptz NULL',
    "DEFAULT 'legacy_date_only'",
    'ADD COLUMN receipt_id uuid NULL',
    'CREATE TABLE fin_receipts',
    "CHECK (state IN ('staged', 'attached', 'discarded'))",
    'CREATE OR REPLACE FUNCTION fin_entry_insert_guard',
    'CREATE OR REPLACE FUNCTION fin_revision_pair_guard',
    'original.occurred_at, original.occurred_at_source, original.receipt_id',
    'FOREIGN KEY (workspace_id, owner_user_id, receipt_id)',
    "interval '1 minute'",
    "occurred_at_source = 'legacy_date_only' AND occurred_at IS NULL",
  ])
    assert.ok(sql.includes(piece), piece);
  assert.match(sql, /BEFORE TRUNCATE ON fin_receipts.*fin_immutable/);
});
test('FIN migration 0014 is untouched by the new time/receipt model', () => {
  const s14 = readFileSync(
    resolve(root, 'packages/database/src/migrations/0014_fin01a.sql'),
    'utf8',
  );
  assert.doesNotMatch(s14, /occurred_at|fin_receipts/);
});
