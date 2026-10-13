/** FIN-01A/design.2: private Owner ledger; scope is always server-derived. */
export type FinanceDirection = 'income' | 'expense';
export type FinancePeriod = 'day' | 'week' | 'month' | 'year';
/** Exact integer VND, never a JavaScript number. */
export type VndString = string;
export const FINANCE_MAX_AMOUNT = '9223372036854775807';

export interface FinanceCategoryData {
  id: string;
  direction: FinanceDirection;
  name: string;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface CreateFinanceCategoryRequest {
  direction: FinanceDirection;
  name: string;
}
export interface UpdateFinanceCategoryRequest {
  name?: string;
  is_active?: boolean;
}
/** auto: the server stamps the time once; manual: the Owner supplies a Vietnam-time instant. */
export type FinanceTimeMode = 'auto' | 'manual';
export type FinanceTimeSource =
  'legacy_date_only' | 'auto' | 'manual' | 'receipt_confirmed';
export interface CreateFinanceEntryRequest {
  direction: FinanceDirection;
  category_id: string;
  amount_vnd: VndString;
  /**
   * Required only without `time_mode` (legacy date-only). With `manual` it is derived from
   * `occurred_at`; with `auto` it is forbidden. On a correction, absent means "keep".
   */
  occurred_on?: string;
  note: string | null;
  time_mode?: FinanceTimeMode;
  /** Manual only: `YYYY-MM-DDTHH:mm[:ss]+07:00`, never in the future. */
  occurred_at?: string;
  /** Staged receipt to attach. On a correction: absent keeps, null removes. */
  receipt_id?: string | null;
}
export interface CorrectFinanceEntryRequest extends CreateFinanceEntryRequest {
  reason: string;
}
export interface FinanceEntryData {
  direction: FinanceDirection;
  category_id: string;
  amount_vnd: VndString;
  occurred_on: string;
  note: string | null;
  /** Canonical `+07:00` instant; null for legacy date-only rows. */
  occurred_at: string | null;
  occurred_at_source: FinanceTimeSource;
  receipt_id: string | null;
  /** Logical root ID; revision_id identifies the immutable physical row. */
  id: string;
  revision_id: string;
  version: number;
  category_name_snapshot: string;
  created_at: string;
  revision_created_at: string;
}
export interface FinanceCorrectionData {
  id: string;
  root_entry_id: string;
  original_revision_id: string;
  replacement_revision_id: string;
  reason: string;
  actor_user_id: string;
  created_at: string;
}
export interface FinancePage<T> {
  items: T[];
  next_cursor: string | null;
  /** Present only for numbered-page (`offset`) reads. */
  total?: number;
  offset?: number;
  limit?: number;
}
export interface FinanceSummaryData {
  period: FinancePeriod;
  from: string;
  to: string;
  total_income_vnd: VndString;
  total_expense_vnd: VndString;
  net_vnd: VndString;
  categories: {
    category_id: string;
    category_name: string;
    direction: FinanceDirection;
    total_vnd: VndString;
  }[];
}

export class FinanceValidationError extends Error {
  constructor(public readonly field: string) {
    super(`Invalid finance field: ${field}`);
    this.name = 'FinanceValidationError';
  }
}
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FinanceValidationError('body');
  }
  const data = value as Record<string, unknown>;
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) throw new FinanceValidationError(key);
  }
  return data;
}
function direction(value: unknown): FinanceDirection {
  if (value !== 'income' && value !== 'expense') {
    throw new FinanceValidationError('direction');
  }
  return value;
}
function name(value: unknown): string {
  if (typeof value !== 'string') throw new FinanceValidationError('name');
  const normalized = value.normalize('NFC').trim();
  if (!normalized || [...normalized].length > 100) {
    throw new FinanceValidationError('name');
  }
  return normalized;
}
export function validateFinanceAmount(value: unknown): VndString {
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(value) ||
    BigInt(value) > BigInt(FINANCE_MAX_AMOUNT)
  ) {
    throw new FinanceValidationError('amount_vnd');
  }
  return value;
}
export function parseFinanceCategory(
  value: unknown,
): CreateFinanceCategoryRequest {
  const data = object(value, ['direction', 'name']);
  return { direction: direction(data['direction']), name: name(data['name']) };
}
export function parseFinanceCategoryUpdate(
  value: unknown,
): UpdateFinanceCategoryRequest {
  const data = object(value, ['name', 'is_active']);
  const result: UpdateFinanceCategoryRequest = {};
  if ('name' in data) result.name = name(data['name']);
  if ('is_active' in data) {
    if (typeof data['is_active'] !== 'boolean')
      throw new FinanceValidationError('is_active');
    result.is_active = data['is_active'];
  }
  if (!Object.keys(result).length) throw new FinanceValidationError('body');
  return result;
}
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VN_OFFSET_MS = 7 * 3600 * 1000;
/** Strict Vietnam-time parser: returns the canonical string, its date and the UTC instant. */
export function parseVietnamInstant(
  value: unknown,
): { canonical: string; date: string; instant: Date } | null {
  if (typeof value !== 'string') return null;
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?\+07:00$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const s = m[6] === undefined ? 0 : Number(m[6]);
  const ms = Date.UTC(y, mo - 1, d, h, mi, s) - VN_OFFSET_MS;
  const back = new Date(ms + VN_OFFSET_MS);
  if (
    y < 1 ||
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d ||
    back.getUTCHours() !== h ||
    back.getUTCMinutes() !== mi ||
    back.getUTCSeconds() !== s
  )
    return null;
  const p2 = (n: number) => String(n).padStart(2, '0');
  const date = `${m[1]}-${p2(mo)}-${p2(d)}`;
  return {
    canonical: `${date}T${p2(h)}:${p2(mi)}:${p2(s)}+07:00`,
    date,
    instant: new Date(ms),
  };
}
function parseEntry(
  value: unknown,
  correction: boolean,
): CreateFinanceEntryRequest {
  const data = object(value, [
    'direction',
    'category_id',
    'amount_vnd',
    'occurred_on',
    'note',
    'time_mode',
    'occurred_at',
    'receipt_id',
  ]);
  const category = data['category_id'];
  if (
    typeof category !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      category,
    )
  ) {
    throw new FinanceValidationError('category_id');
  }
  const mode = data['time_mode'];
  if (mode !== undefined && mode !== 'auto' && mode !== 'manual')
    throw new FinanceValidationError('time_mode');
  if (correction && mode === 'auto')
    throw new FinanceValidationError('time_mode');
  let occurredOn: string | undefined;
  let occurredAt: string | undefined;
  if (mode === 'auto') {
    // The server alone stamps the time; the client may not supply any part of it.
    if ('occurred_on' in data) throw new FinanceValidationError('occurred_on');
    if ('occurred_at' in data) throw new FinanceValidationError('occurred_at');
  } else if (mode === 'manual') {
    const at = parseVietnamInstant(data['occurred_at']);
    if (!at) throw new FinanceValidationError('occurred_at');
    occurredAt = at.canonical;
    occurredOn = at.date;
    if ('occurred_on' in data && data['occurred_on'] !== at.date)
      throw new FinanceValidationError('occurred_on');
  } else {
    if ('occurred_at' in data) throw new FinanceValidationError('occurred_at');
    if ('occurred_on' in data || !correction) {
      const date = data['occurred_on'];
      if (
        typeof date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        date.startsWith('0000') ||
        !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
      ) {
        throw new FinanceValidationError('occurred_on');
      }
      occurredOn = date;
    }
  }
  const note = data['note'];
  if (note !== null && (typeof note !== 'string' || [...note].length > 2000)) {
    throw new FinanceValidationError('note');
  }
  // Key order is part of the stored-pending contract (legacy: direction, category, amount, date, note).
  const out: CreateFinanceEntryRequest = {
    direction: direction(data['direction']),
    category_id: category.toLowerCase(),
    amount_vnd: validateFinanceAmount(data['amount_vnd']),
    ...(occurredOn !== undefined ? { occurred_on: occurredOn } : {}),
    note: note as string | null,
  };
  if (mode !== undefined) out.time_mode = mode;
  if (occurredAt !== undefined) out.occurred_at = occurredAt;
  if ('receipt_id' in data) {
    const r = data['receipt_id'];
    if (r === null) {
      if (correction) out.receipt_id = null;
    } else if (typeof r === 'string' && UUID_RE.test(r)) {
      out.receipt_id = r.toLowerCase();
    } else throw new FinanceValidationError('receipt_id');
  }
  return out;
}
export function parseFinanceEntry(value: unknown): CreateFinanceEntryRequest {
  return parseEntry(value, false);
}
export function parseFinanceCorrection(
  value: unknown,
): CorrectFinanceEntryRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new FinanceValidationError('body');
  const { reason, ...entry } = value as Record<string, unknown>;
  if (
    typeof reason !== 'string' ||
    !reason.trim() ||
    [...reason.trim()].length > 1000
  ) {
    throw new FinanceValidationError('reason');
  }
  return { ...parseEntry(entry, true), reason: reason.trim() };
}
