// FIN receipt image helpers (client side). Server must re-validate everything.
export const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;
export type ReceiptMime = 'image/jpeg' | 'image/png';
export type ReceiptRejection = 'empty' | 'too_large' | 'unsupported';
/** Sniff magic bytes; the browser-declared type is never trusted. */
export function sniffReceiptMime(b: Uint8Array): ReceiptMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return 'image/jpeg';
  if (
    b.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)
  )
    return 'image/png';
  return null;
}
export function checkReceiptBytes(
  b: Uint8Array,
): { ok: true; mime: ReceiptMime } | { ok: false; reason: ReceiptRejection } {
  if (b.length === 0) return { ok: false, reason: 'empty' };
  if (b.length > RECEIPT_MAX_BYTES) return { ok: false, reason: 'too_large' };
  const mime = sniffReceiptMime(b);
  return mime ? { ok: true, mime } : { ok: false, reason: 'unsupported' };
}
export const receiptRejectionMessage: Record<ReceiptRejection, string> = {
  empty: 'Tệp ảnh rỗng.',
  too_large: 'Ảnh vượt quá 4 MB.',
  unsupported: 'Chỉ nhận ảnh JPEG hoặc PNG.',
};

/**
 * FIN suggestion returned by the FIN server after mapping the official AI Core ReceiptDraft
 * (see apps/api/src/finance/receipt-draft.ts). The browser never sees the raw AI draft.
 */
export interface ReceiptSuggestion {
  amount_vnd: string | null;
  occurred_on: string | null;
  occurred_at: string | null;
  merchant: string | null;
  description: string | null;
  suggested_category_id: string | null;
  direction_hint: 'income' | 'expense' | null;
  ambiguous_fields: string[];
  unreadable_fields: string[];
}
export type AiResult<T> =
  { status: 'ok'; data: T } | { status: 'unavailable'; reason: string };
/** Injected by the screen. Real implementations call FIN/AI Core endpoints. */
export interface ReceiptApi {
  upload(
    bytes: Uint8Array,
    mime: ReceiptMime,
    signal: AbortSignal,
  ): Promise<{ id: string; duplicate_of_entry_id: string | null }>;
  extract(
    receiptId: string,
    signal: AbortSignal,
  ): Promise<AiResult<ReceiptSuggestion>>;
  discard(receiptId: string, signal: AbortSignal): Promise<void>;
}
export interface PrefillFields {
  amount?: string;
  note?: string;
  categoryId?: string;
  occurredAt?: string;
  direction?: 'income' | 'expense';
  flagged: string[];
}
/**
 * Convert a suggestion into form prefill. Null/unreadable/invalid fields are skipped,
 * never guessed. Fields the model marked ambiguous are flagged for extra attention.
 */
export function suggestionToPrefill(
  s: ReceiptSuggestion,
  availableCategoryIds: ReadonlySet<string>,
  now: Date,
): PrefillFields {
  const out: PrefillFields = { flagged: [] };
  const low = (k: string) => s.ambiguous_fields?.includes(k) === true;
  const skip = (k: string) => s.unreadable_fields?.includes(k);
  if (
    !skip('amount') &&
    typeof s.amount_vnd === 'string' &&
    /^[1-9]\d{0,18}$/.test(s.amount_vnd) &&
    BigInt(s.amount_vnd) <= 9223372036854775807n
  ) {
    out.amount = s.amount_vnd;
    if (low('amount')) out.flagged.push('amount');
  }
  const text = [s.merchant, s.description]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .map((v) => v.trim())
    .join(' — ');
  if (text) out.note = [...text].slice(0, 2000).join('');
  if (
    !skip('category') &&
    s.suggested_category_id &&
    availableCategoryIds.has(s.suggested_category_id)
  ) {
    out.categoryId = s.suggested_category_id;
    if (low('category')) out.flagged.push('category');
  }
  if (s.direction_hint) out.direction = s.direction_hint;
  if (
    !skip('date') &&
    typeof s.occurred_at === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s.occurred_at)
  ) {
    const local = s.occurred_at.slice(0, 16);
    const t = Date.parse(`${local}:00+07:00`);
    if (Number.isFinite(t) && t <= now.getTime()) {
      out.occurredAt = local;
      if (low('date')) out.flagged.push('date');
    }
  }
  return out;
}
