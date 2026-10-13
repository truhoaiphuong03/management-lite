import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseFinanceEntry,
  parseFinanceCorrection,
  parseFinanceCategory,
  parseFinanceCategoryUpdate,
  validateFinanceAmount,
  FinanceValidationError,
} from '../../dist/packages/contracts/src/finance.js';

const payload = {
  direction: 'expense',
  category_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  amount_vnd: '9007199254740993',
  occurred_on: '2024-02-29',
  note: '  ghi chú\nnguyên văn  ',
};
test('FIN amount preserves integer precision and BIGINT maximum', () => {
  assert.equal(validateFinanceAmount(payload.amount_vnd), '9007199254740993');
  assert.equal(
    validateFinanceAmount('9223372036854775807'),
    '9223372036854775807',
  );
});
test('FIN amount rejects coercion, zero, negatives, exponents and overflow', () => {
  for (const value of [
    1,
    '0',
    '-1',
    '01',
    '1.0',
    '1e3',
    ' 1',
    '1 ',
    '9223372036854775808',
    null,
    '',
  ]) {
    assert.throws(() => validateFinanceAmount(value), FinanceValidationError);
  }
});
test('FIN entry preserves note and rejects server scope or unknown fields', () => {
  assert.deepEqual(parseFinanceEntry(payload), payload);
  for (const key of ['owner_user_id', 'workspace_id', 'attachment_id', 'id']) {
    assert.throws(
      () => parseFinanceEntry({ ...payload, [key]: 'fake' }),
      FinanceValidationError,
    );
  }
});
test('FIN validates actual Gregorian date, UUID, enum and bounded note', () => {
  for (const date of [
    '2023-02-29',
    '2024-04-31',
    '2024-13-01',
    '0000-01-01',
    '2024-01-01T00:00:00Z',
  ]) {
    assert.throws(
      () => parseFinanceEntry({ ...payload, occurred_on: date }),
      FinanceValidationError,
    );
  }
  for (const patch of [
    { category_id: 'bad' },
    { direction: 'transfer' },
    { note: 'x'.repeat(2001) },
    { note: undefined },
  ]) {
    assert.throws(
      () => parseFinanceEntry({ ...payload, ...patch }),
      FinanceValidationError,
    );
  }
  assert.equal(parseFinanceEntry({ ...payload, note: null }).note, null);
});
test('FIN correction requires bounded reason and full replacement payload', () => {
  assert.equal(
    parseFinanceCorrection({ ...payload, reason: '  sửa nhầm  ' }).reason,
    'sửa nhầm',
  );
  for (const reason of ['', '  ', null, 'x'.repeat(1001)]) {
    assert.throws(
      () => parseFinanceCorrection({ ...payload, reason }),
      FinanceValidationError,
    );
  }
  assert.throws(
    () => parseFinanceCorrection({ reason: 'fix' }),
    FinanceValidationError,
  );
});
test('FIN categories normalize name without permitting direction or scope updates', () => {
  assert.deepEqual(
    parseFinanceCategory({ direction: 'income', name: '  e\u0301  ' }),
    { direction: 'income', name: 'é' },
  );
  assert.deepEqual(parseFinanceCategoryUpdate({ is_active: false }), {
    is_active: false,
  });
  for (const body of [
    {},
    { direction: 'expense' },
    { owner_user_id: 'fake' },
    { is_active: 'false' },
    { name: ' ' },
  ]) {
    assert.throws(
      () => parseFinanceCategoryUpdate(body),
      FinanceValidationError,
    );
  }
});
