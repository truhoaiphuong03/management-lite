import { AiCoreError, RECEIPT_FIELDS } from './contract.js';
import type { ReceiptDraft, ReceiptInput } from './contract.js';

const invalidInput = (): never => {
  throw new AiCoreError('AI_INVALID_INPUT');
};
const invalidOutput = (): never => {
  throw new AiCoreError('AI_INVALID_OUTPUT');
};
function object(
  v: unknown,
  keys: string[],
  fail: () => never,
): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
  const r = v as Record<string, unknown>;
  if (
    Object.keys(r).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(r, k))
  )
    return fail();
  return r;
}
function text(v: unknown, max: number, fail: () => never): string {
  if (
    typeof v !== 'string' ||
    !v.trim() ||
    v.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
  )
    return fail();
  return v;
}

/** Preliminary MIME/signature/dimension checks, not a full image decoder. */
export function validateReceiptInput(value: unknown): ReceiptInput {
  const v = object(value, ['image', 'context'], invalidInput);
  const image = object(v.image, ['mimeType', 'bytes'], invalidInput);
  if (
    !(image.bytes instanceof Uint8Array) ||
    image.bytes.length < 24 ||
    image.bytes.length > 4 * 1024 * 1024
  )
    return invalidInput();
  const b = Buffer.from(image.bytes); // snapshot caller-owned bytes before async work
  let width = 0,
    height = 0;
  if (image.mimeType === 'image/png') {
    if (
      b.length < 45 ||
      b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      b.readUInt32BE(8) !== 13 ||
      b.toString('ascii', 12, 16) !== 'IHDR' ||
      b.toString('hex', b.length - 12) !== '0000000049454e44ae426082'
    )
      return invalidInput();
    width = b.readUInt32BE(16);
    height = b.readUInt32BE(20);
  } else if (image.mimeType === 'image/jpeg') {
    if (b[0] !== 255 || b[1] !== 216 || b.at(-2) !== 255 || b.at(-1) !== 217)
      return invalidInput();
    let p = 2;
    while (p + 4 <= b.length) {
      if (b[p] !== 255) return invalidInput();
      while (b[p] === 255) p++;
      const marker = b[p++];
      if (marker === 218 || marker === 217) break;
      if (p + 2 > b.length) return invalidInput();
      const length = b.readUInt16BE(p);
      if (length < 2 || p + length > b.length) return invalidInput();
      if (marker === 192 || marker === 194) {
        if (length < 8) return invalidInput();
        height = b.readUInt16BE(p + 3);
        width = b.readUInt16BE(p + 5);
      }
      p += length;
    }
  } else return invalidInput();
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 16_000_000
  )
    return invalidInput();
  const context = object(v.context, ['categories'], invalidInput);
  if (!Array.isArray(context.categories) || context.categories.length > 50)
    return invalidInput();
  const ids = new Set<string>();
  const categories = context.categories.map((raw) => {
    const c = object(raw, ['id', 'name', 'direction'], invalidInput);
    const id = text(c.id, 64, invalidInput),
      name = text(c.name, 100, invalidInput);
    if (
      !/^[a-zA-Z0-9_-]+$/.test(id) ||
      ids.has(id) ||
      (c.direction !== 'income' && c.direction !== 'expense')
    )
      return invalidInput();
    ids.add(id);
    return { id, name, direction: c.direction as 'income' | 'expense' };
  });
  return {
    image: { mimeType: image.mimeType, bytes: b },
    context: { categories },
  };
}

export function validateReceiptDraft(
  value: unknown,
  input: ReceiptInput,
): ReceiptDraft {
  const v = object(value, ['fields', 'uncertainties'], invalidOutput);
  const fields = object(v.fields, [...RECEIPT_FIELDS], invalidOutput);
  if (
    !Array.isArray(v.uncertainties) ||
    v.uncertainties.length > RECEIPT_FIELDS.length
  )
    return invalidOutput();
  const uncertain = new Set<string>();
  for (const raw of v.uncertainties) {
    const u = object(raw, ['field', 'reason'], invalidOutput);
    if (
      !RECEIPT_FIELDS.includes(u.field as never) ||
      uncertain.has(String(u.field)) ||
      !['missing', 'unreadable', 'ambiguous'].includes(String(u.reason))
    )
      return invalidOutput();
    uncertain.add(String(u.field));
  }
  for (const field of RECEIPT_FIELDS) {
    const o = object(fields[field], ['value', 'evidence'], invalidOutput);
    if (o.value === null) {
      if (o.evidence !== null || !uncertain.has(field)) return invalidOutput();
    } else {
      text(o.value, field === 'description' ? 500 : 160, invalidOutput);
      text(o.evidence, 240, invalidOutput);
      if (uncertain.has(field)) return invalidOutput(); // do not promote uncertain guesses
    }
  }
  const draft = v as unknown as ReceiptDraft;
  const get = (k: keyof ReceiptDraft['fields']) => draft.fields[k].value;
  const amount = get('amount'),
    currency = get('currency'),
    date = get('date'),
    time = get('time'),
    direction = get('direction'),
    category = get('categoryId');
  if (
    amount !== null &&
    (!/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,3})?$/.test(amount) ||
      !/[1-9]/.test(amount))
  )
    return invalidOutput();
  if (currency !== null && !/^[A-Z]{3}$/.test(currency)) return invalidOutput();
  if (currency === 'VND' && amount?.includes('.')) return invalidOutput();
  if (
    date !== null &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      date.startsWith('0000') ||
      !Number.isFinite(Date.parse(date + 'T00:00:00Z')) ||
      new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date)
  )
    return invalidOutput();
  if (
    time !== null &&
    !/^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$/.test(time)
  )
    return invalidOutput();
  if (direction !== null && direction !== 'income' && direction !== 'expense')
    return invalidOutput();
  if (
    category !== null &&
    !input.context.categories.some(
      (c) => c.id === category && c.direction === direction,
    )
  )
    return invalidOutput();
  return structuredClone(draft);
}
