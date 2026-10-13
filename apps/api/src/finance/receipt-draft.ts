// Maps the official AI Core `ReceiptDraft` (structural shape, see ai-core/contract.ts in
// codex/ai-core-01) into the FIN suggestion returned to the Owner UI.
// Pure and defensive: AI output is untrusted; `evidence` is never forwarded and nothing is guessed.
export interface FinReceiptSuggestion {
  amount_vnd: string | null;
  /** YYYY-MM-DD in Asia/Ho_Chi_Minh, only when valid and not in the future. */
  occurred_on: string | null;
  /** ISO-8601 +07:00, only when both date and time were read and are not in the future. */
  occurred_at: string | null;
  merchant: string | null;
  description: string | null;
  suggested_category_id: string | null;
  direction_hint: 'income' | 'expense' | null;
  ambiguous_fields: string[];
  unreadable_fields: string[];
}
export interface DraftCategory {
  id: string;
  direction: 'income' | 'expense';
}
const VN_OFFSET_MS = 7 * 3600 * 1000;
const FIELD_LABEL: Record<string, string> = {
  amount: 'amount',
  currency: 'amount',
  date: 'date',
  time: 'time',
  merchant: 'note',
  description: 'note',
  direction: 'direction',
  categoryId: 'category',
};
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
function val(fields: Record<string, unknown> | null, k: string): string | null {
  const o = obj(fields?.[k]);
  const v = o?.['value'];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
function text(v: string | null, max: number): string | null {
  return v === null ? null : [...v].slice(0, max).join('');
}
function vnLocalToInstant(date: string, time: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!d || !t) return null;
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [h, mi] = [Number(t[1]), Number(t[2])];
  const ms = Date.UTC(y, mo - 1, da, h, mi) - VN_OFFSET_MS;
  const back = new Date(ms + VN_OFFSET_MS);
  return back.getUTCFullYear() === y &&
    back.getUTCMonth() === mo - 1 &&
    back.getUTCDate() === da &&
    back.getUTCHours() === h &&
    y > 0
    ? ms
    : null;
}
export function mapReceiptDraft(
  draft: unknown,
  categories: readonly DraftCategory[],
  now: Date,
): FinReceiptSuggestion {
  const root = obj(draft);
  const fields = obj(root?.['fields']);
  const out: FinReceiptSuggestion = {
    amount_vnd: null,
    occurred_on: null,
    occurred_at: null,
    merchant: text(val(fields, 'merchant'), 200),
    description: text(val(fields, 'description'), 2000),
    suggested_category_id: null,
    direction_hint: null,
    ambiguous_fields: [],
    unreadable_fields: [],
  };
  const unc = Array.isArray(root?.['uncertainties'])
    ? (root!['uncertainties'] as unknown[])
    : [];
  const unreadable = new Set<string>();
  const ambiguous = new Set<string>();
  let timeUnreadable = false;
  for (const u of unc) {
    const o = obj(u);
    const label =
      typeof o?.['field'] === 'string' ? FIELD_LABEL[o['field']] : undefined;
    if (!label) continue;
    // A missing/unreadable time must not discard a readable date (date-only receipts are normal).
    if (label === 'time') {
      if (o?.['reason'] === 'ambiguous') ambiguous.add('date');
      else timeUnreadable = true;
      continue;
    }
    if (o?.['reason'] === 'ambiguous') ambiguous.add(label);
    else if (o?.['reason'] === 'missing' || o?.['reason'] === 'unreadable')
      unreadable.add(label);
  }
  const dir = val(fields, 'direction');
  if (dir === 'income' || dir === 'expense') out.direction_hint = dir;
  // amount: whole VND only; foreign/unknown currency is not converted.
  const currency = val(fields, 'currency');
  const amount = val(fields, 'amount');
  if (amount !== null && !unreadable.has('amount')) {
    const m = /^(\d{1,19})(?:\.0+)?$/.exec(amount);
    if (m && (currency === null || currency.toUpperCase() === 'VND')) {
      const n = BigInt(m[1]!);
      if (n >= 1n && n <= 9223372036854775807n) out.amount_vnd = n.toString();
    } else ambiguous.add('amount');
  }
  const catId = val(fields, 'categoryId');
  if (catId !== null && !unreadable.has('category')) {
    const c = categories.find((x) => x.id === catId);
    if (c && (!out.direction_hint || c.direction === out.direction_hint))
      out.suggested_category_id = c.id;
  }
  const date = val(fields, 'date');
  const time = val(fields, 'time');
  if (date !== null && !unreadable.has('date')) {
    const dayStart = vnLocalToInstant(date, '00:00');
    if (dayStart !== null && dayStart <= now.getTime()) {
      out.occurred_on = date;
      if (time !== null && !timeUnreadable) {
        const at = vnLocalToInstant(date, time);
        if (at !== null && at <= now.getTime())
          out.occurred_at = `${date}T${time.slice(0, 5)}:00+07:00`;
      }
    }
  }
  out.unreadable_fields = [...unreadable].sort();
  out.ambiguous_fields = [...ambiguous].sort();
  return out;
}
/** AI Core currently accepts PNG/JPEG up to 4 MiB; other valid receipts stay manual. */
export const AI_MAX_BYTES = 4 * 1024 * 1024;
export function aiEligible(mime: string, size: number): boolean {
  return (
    (mime === 'image/png' || mime === 'image/jpeg') && size <= AI_MAX_BYTES
  );
}
