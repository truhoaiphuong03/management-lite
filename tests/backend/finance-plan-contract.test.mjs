// FIN fixed plan contract: parsers + exact BigInt arithmetic (offline).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computePlanSummary,
  daysInMonth,
  parseFinancePlanItem,
  parseFinancePlanItemUpdate,
  parsePlanMonth,
  FinancePlanValidationError,
} from '../../dist/packages/contracts/src/finance-plan.js';
import { FinanceValidationError } from '../../dist/packages/contracts/src/finance.js';

const CAT = 'AAAAAAAA-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const item = (direction, amount, is_active = true) => ({
  direction,
  amount_vnd: String(amount),
  is_active,
});

test('days in month incl. leap years', () => {
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2024-02'), 29);
  assert.equal(daysInMonth('2100-02'), 28);
  assert.equal(daysInMonth('2000-02'), 29);
  assert.equal(daysInMonth('2026-04'), 30);
  assert.equal(daysInMonth('2026-01'), 31);
  assert.throws(() => parsePlanMonth('2026-13'), FinancePlanValidationError);
  assert.throws(() => parsePlanMonth('26-01'), FinanceValidationError);
});

test('deficit example: 30 days, 12M vs 15M', () => {
  const s = computePlanSummary(
    [item('income', 12_000_000), item('expense', 15_000_000)],
    '2026-04',
  );
  assert.equal(s.status, 'deficit');
  assert.equal(s.net_vnd, '-3000000');
  assert.equal(s.need_per_month_vnd, '3000000');
  assert.equal(s.need_per_day_vnd, '100000');
  assert.equal(s.need_per_week_vnd, '700000');
});

test('surplus and balanced need nothing', () => {
  const up = computePlanSummary(
    [item('income', 20), item('expense', 5)],
    '2026-01',
  );
  assert.equal(up.status, 'surplus');
  assert.equal(up.shortfall_vnd, '0');
  assert.equal(up.need_per_day_vnd, '0');
  const eq = computePlanSummary(
    [item('income', 5), item('expense', 5)],
    '2026-01',
  );
  assert.equal(eq.status, 'balanced');
  assert.equal(eq.net_vnd, '0');
});

test('rounds up and respects month length', () => {
  const s31 = computePlanSummary([item('expense', 1)], '2026-01');
  assert.equal(s31.need_per_day_vnd, '1');
  assert.equal(s31.need_per_week_vnd, '1');
  const s = computePlanSummary([item('expense', 1000)], '2026-01');
  assert.equal(s.need_per_day_vnd, '33');
  assert.equal(s.need_per_week_vnd, '226');
  const feb = computePlanSummary([item('expense', 2800)], '2026-02');
  assert.equal(feb.need_per_day_vnd, '100');
  assert.equal(feb.need_per_week_vnd, '700');
  const leap = computePlanSummary([item('expense', 2900)], '2024-02');
  assert.equal(leap.need_per_day_vnd, '100');
});

test('inactive excluded; large sums exact', () => {
  const big = '9999999999999';
  const s = computePlanSummary(
    [item('income', big), item('income', big), item('expense', 5, false)],
    '2026-01',
  );
  assert.equal(s.total_income_vnd, '19999999999998');
  assert.equal(s.total_expense_vnd, '0');
});

test('parsers validate input', () => {
  assert.deepEqual(
    parseFinancePlanItem({
      direction: 'income',
      category_id: CAT,
      amount_vnd: '100',
    }),
    { direction: 'income', category_id: CAT.toLowerCase(), amount_vnd: '100' },
  );
  for (const amount of ['0', '-1', '1.5', '01', '', 100, '10000000000000'])
    assert.throws(
      () =>
        parseFinancePlanItem({
          direction: 'expense',
          category_id: CAT,
          amount_vnd: amount,
        }),
      FinanceValidationError,
    );
  assert.throws(() =>
    parseFinancePlanItem({
      direction: 'x',
      category_id: CAT,
      amount_vnd: '1',
    }),
  );
  assert.throws(() => parseFinancePlanItem({ direction: 'income' }));
  assert.throws(() => parseFinancePlanItemUpdate({}));
  assert.throws(() => parseFinancePlanItemUpdate({ is_active: 'no' }));
  assert.throws(() => parseFinancePlanItemUpdate({ extra: 1 }));
  assert.deepEqual(parseFinancePlanItemUpdate({ is_active: false }), {
    is_active: false,
  });
});
