// FIN-PLAN-MVP contract: fixed monthly income/expense plan and its exact BigInt calculation.
import { FinanceValidationError } from './finance.js';
import type { FinanceDirection, VndString } from './finance.js';

export const PLAN_MAX_AMOUNT = '9999999999999';
export const PLAN_MAX_ITEMS = 200;

export interface FinancePlanItemData {
  id: string;
  direction: FinanceDirection;
  category_id: string;
  category_name: string;
  category_is_active: boolean;
  amount_vnd: VndString;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface CreateFinancePlanItemRequest {
  direction: FinanceDirection;
  category_id: string;
  amount_vnd: VndString;
}
export interface UpdateFinancePlanItemRequest {
  amount_vnd?: VndString;
  is_active?: boolean;
}
export type FinancePlanStatus = 'surplus' | 'balanced' | 'deficit';
export interface FinancePlanSummary {
  month: string;
  days_in_month: number;
  total_income_vnd: VndString;
  total_expense_vnd: VndString;
  net_vnd: VndString;
  status: FinancePlanStatus;
  shortfall_vnd: VndString;
  need_per_year_vnd: VndString;
  need_per_month_vnd: VndString;
  need_per_week_vnd: VndString;
  need_per_day_vnd: VndString;
}
export interface FinancePlanData {
  items: FinancePlanItemData[];
  summary: FinancePlanSummary;
}

export class FinancePlanValidationError extends FinanceValidationError {}
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new FinancePlanValidationError('body');
  const data = value as Record<string, unknown>;
  for (const key of Object.keys(data))
    if (!allowed.includes(key)) throw new FinancePlanValidationError(key);
  return data;
}
export function validatePlanAmount(value: unknown): VndString {
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]{0,12}$/.test(value) ||
    BigInt(value) > BigInt(PLAN_MAX_AMOUNT)
  )
    throw new FinancePlanValidationError('amount_vnd');
  return value;
}
export function parseFinancePlanItem(
  value: unknown,
): CreateFinancePlanItemRequest {
  const data = object(value, ['direction', 'category_id', 'amount_vnd']);
  const direction = data['direction'];
  if (direction !== 'income' && direction !== 'expense')
    throw new FinancePlanValidationError('direction');
  const category = data['category_id'];
  if (typeof category !== 'string' || !UUID_RE.test(category))
    throw new FinancePlanValidationError('category_id');
  return {
    direction,
    category_id: category.toLowerCase(),
    amount_vnd: validatePlanAmount(data['amount_vnd']),
  };
}
export function parseFinancePlanItemUpdate(
  value: unknown,
): UpdateFinancePlanItemRequest {
  const data = object(value, ['amount_vnd', 'is_active']);
  const result: UpdateFinancePlanItemRequest = {};
  if ('amount_vnd' in data)
    result.amount_vnd = validatePlanAmount(data['amount_vnd']);
  if ('is_active' in data) {
    if (typeof data['is_active'] !== 'boolean')
      throw new FinancePlanValidationError('is_active');
    result.is_active = data['is_active'];
  }
  if (!Object.keys(result).length) throw new FinancePlanValidationError('body');
  return result;
}

/** Strict `YYYY-MM` (years 1900-2999). */
export function parsePlanMonth(value: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  const year = m ? Number(m[1]) : 0;
  if (!m || year < 1900 || year > 2999)
    throw new FinancePlanValidationError('month');
  return value;
}
/** Real calendar days of a `YYYY-MM` month (28/29/30/31), Gregorian leap rule; no Date quirks. */
export function daysInMonth(month: string): number {
  const [y, mo] = parsePlanMonth(month).split('-').map(Number) as [
    number,
    number,
  ];
  if (mo === 2)
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(mo) ? 30 : 31;
}
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/**
 * Exact plan arithmetic on BigInt. Inactive rows never count. Needs are rounded UP to whole VND
 * so a displayed target is never lower than the real requirement.
 */
export function computePlanSummary(
  items: readonly Pick<
    FinancePlanItemData,
    'direction' | 'amount_vnd' | 'is_active'
  >[],
  month: string,
): FinancePlanSummary {
  const days = BigInt(daysInMonth(month));
  let income = 0n;
  let expense = 0n;
  for (const i of items) {
    if (!i.is_active) continue;
    if (i.direction === 'income') income += BigInt(i.amount_vnd);
    else expense += BigInt(i.amount_vnd);
  }
  const net = income - expense;
  const shortfall = net < 0n ? -net : 0n;
  return {
    month,
    days_in_month: Number(days),
    total_income_vnd: income.toString(),
    total_expense_vnd: expense.toString(),
    net_vnd: net.toString(),
    status: net > 0n ? 'surplus' : net < 0n ? 'deficit' : 'balanced',
    shortfall_vnd: shortfall.toString(),
    need_per_year_vnd: (expense * 12n).toString(),
    need_per_month_vnd: expense.toString(),
    need_per_week_vnd: ceilDiv(expense * 7n, days).toString(),
    need_per_day_vnd: ceilDiv(expense, days).toString(),
  };
}
