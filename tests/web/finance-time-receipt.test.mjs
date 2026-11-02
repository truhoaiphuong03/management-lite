import test from 'node:test';
import assert from 'node:assert/strict';
import {
  vnDate,
  vnDateTimeLocal,
  parseVnLocal,
  resolveEntryTime,
} from '../../dist/apps/web/src/finance/time.js';
import {
  checkReceiptBytes,
  sniffReceiptMime,
  suggestionToPrefill,
  RECEIPT_MAX_BYTES,
} from '../../dist/apps/web/src/finance/receipt.js';

// ---- time (Asia/Ho_Chi_Minh, UTC+7) ----
test('FIN time: VN date/time at the UTC day boundary', () => {
  const d = new Date('2026-10-11T17:30:00Z'); // 00:30 on the 12th in VN
  assert.equal(vnDate(d), '2026-10-12');
  assert.equal(vnDateTimeLocal(d), '2026-10-12T00:30');
  const e = new Date('2026-10-11T16:59:00Z'); // 23:59 on the 11th
  assert.equal(vnDate(e), '2026-10-11');
  assert.equal(vnDateTimeLocal(e), '2026-10-11T23:59');
});
test('FIN time: strict manual parsing', () => {
  assert.equal(
    parseVnLocal('2026-10-11T10:05')?.toISOString(),
    '2026-10-11T03:05:00.000Z',
  );
  for (const bad of [
    '',
    '2026-10-11',
    '2026-10-11 10:05',
    '2026-02-30T10:00',
    '2026-10-11T24:00',
    '2026-10-11T10:60',
    '0000-01-01T00:00',
    '2026-10-11T10:05:00',
  ])
    assert.equal(parseVnLocal(bad), null, bad);
});
test('FIN time: auto uses now; manual past ok; now ok; future rejected', () => {
  const now = new Date('2026-10-11T12:34:56Z'); // 19:34 VN
  const auto = resolveEntryTime({ auto: true, manualLocal: 'ignored', now });
  assert.deepEqual(auto, {
    ok: true,
    mode: 'auto',
    occurred_on: '2026-10-11',
    occurred_at: '2026-10-11T19:34:00+07:00',
  });
  const past = resolveEntryTime({
    auto: false,
    manualLocal: '2026-10-10T08:00',
    now,
  });
  assert.equal(past.ok && past.occurred_on, '2026-10-10');
  assert.equal(past.ok && past.occurred_at, '2026-10-10T08:00:00+07:00');
  assert.equal(
    resolveEntryTime({ auto: false, manualLocal: '2026-10-11T19:34', now }).ok,
    true,
  );
  assert.deepEqual(
    resolveEntryTime({ auto: false, manualLocal: '2026-10-11T19:35', now }),
    {
      ok: false,
      error: 'future',
    },
  );
  assert.deepEqual(resolveEntryTime({ auto: false, manualLocal: 'x', now }), {
    ok: false,
    error: 'invalid',
  });
});

// ---- receipt validation ----
const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0,
]);
const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const webp = Uint8Array.from([
  ...Buffer.from('RIFF'),
  1,
  0,
  0,
  0,
  ...Buffer.from('WEBP'),
]);
test('FIN receipt: magic-byte sniffing, size and type limits', () => {
  assert.equal(sniffReceiptMime(png), 'image/png');
  assert.equal(sniffReceiptMime(jpg), 'image/jpeg');
  assert.equal(sniffReceiptMime(webp), null); // WebP is out of Phase 1
  assert.equal(RECEIPT_MAX_BYTES, 4 * 1024 * 1024);
  assert.deepEqual(checkReceiptBytes(webp), {
    ok: false,
    reason: 'unsupported',
  });
  assert.equal(sniffReceiptMime(Buffer.from('<svg xmlns=')), null);
  assert.equal(sniffReceiptMime(Buffer.from('%PDF-1.7')), null);
  assert.deepEqual(checkReceiptBytes(new Uint8Array()), {
    ok: false,
    reason: 'empty',
  });
  const big = new Uint8Array(RECEIPT_MAX_BYTES + 1);
  big.set(png);
  assert.deepEqual(checkReceiptBytes(big), { ok: false, reason: 'too_large' });
  const exact = new Uint8Array(RECEIPT_MAX_BYTES);
  exact.set(jpg);
  assert.equal(checkReceiptBytes(exact).ok, true);
  assert.deepEqual(checkReceiptBytes(Buffer.from('GIF89a......')), {
    ok: false,
    reason: 'unsupported',
  });
});

// ---- AI suggestion -> prefill (never guess) ----
const base = {
  amount_vnd: '125000',
  occurred_at: '2026-10-10T14:32:00+07:00',
  merchant: 'Cửa hàng A',
  description: 'Hóa đơn ăn trưa',
  suggested_category_id: '00000000-0000-4000-8000-000000000001',
  direction_hint: 'expense',
  occurred_on: '2026-10-10',
  ambiguous_fields: ['date', 'category'],
  unreadable_fields: [],
};
const ids = new Set(['00000000-0000-4000-8000-000000000001']);
const now = new Date('2026-10-11T12:00:00Z');
test('FIN AI prefill: maps valid fields and flags ambiguous fields', () => {
  const p = suggestionToPrefill(base, ids, now);
  assert.equal(p.amount, '125000');
  assert.equal(p.note, 'Cửa hàng A — Hóa đơn ăn trưa');
  assert.equal(p.categoryId, '00000000-0000-4000-8000-000000000001');
  assert.equal(p.occurredAt, '2026-10-10T14:32');
  assert.equal(p.direction, 'expense');
  assert.deepEqual(p.flagged.sort(), ['category', 'date']);
});
test('FIN AI prefill: null, unreadable, invalid or unknown values are never guessed', () => {
  const nothing = suggestionToPrefill(
    {
      ...base,
      amount_vnd: null,
      merchant: null,
      description: null,
      suggested_category_id: null,
      occurred_at: null,
      direction_hint: null,
    },
    ids,
    now,
  );
  assert.deepEqual(nothing, { flagged: [] });
  const bad = suggestionToPrefill(
    {
      ...base,
      amount_vnd: '12.5',
      suggested_category_id: '00000000-0000-4000-8000-0000000000ff',
      occurred_at: '2027-01-01T10:00:00+07:00',
    },
    ids,
    now,
  );
  assert.equal(bad.amount, undefined);
  assert.equal(bad.categoryId, undefined);
  assert.equal(bad.occurredAt, undefined);
  for (const amount of ['0', '-5', '9223372036854775808', '1e5', ' 5'])
    assert.equal(
      suggestionToPrefill({ ...base, amount_vnd: amount }, ids, now).amount,
      undefined,
      amount,
    );
  const unread = suggestionToPrefill(
    { ...base, unreadable_fields: ['amount', 'date', 'category'] },
    ids,
    now,
  );
  assert.equal(unread.amount, undefined);
  assert.equal(unread.categoryId, undefined);
  assert.equal(unread.occurredAt, undefined);
});
