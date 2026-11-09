import {
  parseFinancePlanItem,
  parseFinancePlanItemUpdate,
  type FinancePlanItemData,
} from '../../../../packages/contracts/src/finance-plan.js';
import {
  parseFinanceEntry,
  parseFinanceCorrection,
  parseFinanceCategory,
  parseFinanceCategoryUpdate,
} from '../../../../packages/contracts/src/finance.js';
import type {
  FinanceCategoryData,
  FinanceEntryData,
} from '../../../../packages/contracts/src/finance.js';
import type {
  AiResult,
  ReceiptApi,
  ReceiptMime,
  ReceiptSuggestion,
} from './receipt.js';
export interface FinanceIdentity {
  userId: string;
  workspaceId: string;
}
export class FinanceApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(errorMessage(status));
  }
}
export function errorMessage(status: number): string {
  return (
    (
      {
        401: 'Phiên đăng nhập không còn hợp lệ.',
        403: 'Bạn không có quyền thực hiện.',
        409: 'Thao tác xung đột. Giữ nguyên yêu cầu để đối soát hoặc thử lại.',
        412: 'Dữ liệu đã thay đổi. Tải lại trước khi chỉnh sửa.',
        422: 'Dữ liệu hoặc danh mục không hợp lệ.',
        428: 'Thiếu điều kiện an toàn của thao tác.',
      } as Record<number, string>
    )[status] ||
    'Chưa xác định kết quả. Không tạo thao tác mới; hãy thử lại yêu cầu đã lưu.'
  );
}
export function formatVnd(value: string | number | null | undefined): string {
  const str = String(value ?? '');
  if (!/^-?\d+$/.test(str)) return '—';
  return BigInt(str).toLocaleString('vi-VN') + ' ₫';
}
export async function verifyIdentity(
  identity: FinanceIdentity,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch('/api/v1/auth/me', {
    credentials: 'include',
    ...(signal ? { signal } : {}),
  });
  const body = await response.json();
  if (
    !response.ok ||
    body?.success !== true ||
    body.data?.user?.id !== identity.userId ||
    body.data?.active_workspace?.id !== identity.workspaceId ||
    body.data?.active_workspace?.role !== 'owner' ||
    typeof body.data?.csrf_token !== 'string' ||
    !body.data.csrf_token
  )
    throw new FinanceApiError(401, 'IDENTITY_MISMATCH');
  return body.data.csrf_token;
}
export async function financeRead<T>(
  identity: FinanceIdentity,
  path: string,
  signal: AbortSignal,
): Promise<T> {
  await verifyIdentity(identity, signal);
  const res = await fetch('/api/v1/fin' + path, {
    credentials: 'include',
    signal,
  });
  const body = await res.json();
  if (!res.ok || body?.success !== true || !body.data)
    throw new FinanceApiError(res.status, 'READ_FAILED');
  return body.data as T;
}
const MAX_CATEGORY_PAGES = 50;
function isCategory(c: unknown, direction: string): c is FinanceCategoryData {
  const o = c as Record<string, unknown> | null;
  return (
    !!o &&
    typeof o === 'object' &&
    typeof o['id'] === 'string' &&
    /^[0-9a-f-]{36}$/.test(o['id']) &&
    (o['direction'] === 'income' || o['direction'] === 'expense') &&
    (!direction || o['direction'] === direction) &&
    typeof o['name'] === 'string' &&
    o['name'].length > 0 &&
    typeof o['is_active'] === 'boolean' &&
    Number.isSafeInteger(o['version']) &&
    (o['version'] as number) >= 1
  );
}
export async function loadCategoryPages(
  identity: FinanceIdentity,
  direction: string,
  signal: AbortSignal,
): Promise<FinanceCategoryData[]> {
  const items = new Map<string, FinanceCategoryData>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let pages = 0; pages < MAX_CATEGORY_PAGES; pages++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const q = new URLSearchParams({ limit: '100' });
    if (direction) q.set('direction', direction);
    if (cursor) q.set('cursor', cursor);
    const page: {
      items: unknown;
      next_cursor: unknown;
    } = await financeRead(identity, '/categories?' + q, signal);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (
      !Array.isArray(page.items) ||
      !page.items.every((c) => isCategory(c, direction))
    )
      throw new FinanceApiError(500, 'INVALID_PAGE');
    for (const c of page.items as FinanceCategoryData[]) items.set(c.id, c);
    const next = page.next_cursor;
    if (next === null) return [...items.values()];
    if (typeof next !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(next))
      throw new FinanceApiError(500, 'INVALID_CURSOR');
    if (seenCursors.has(next)) throw new FinanceApiError(500, 'CURSOR_LOOP');
    seenCursors.add(next);
    cursor = next;
  }
  throw new FinanceApiError(500, 'TOO_MANY_PAGES');
}
export interface PendingFinanceOperation {
  identity: FinanceIdentity;
  key: string;
  path: string;
  method: 'POST' | 'PATCH';
  payload: Record<string, unknown>;
  version: number | null;
}
function storageKey(i: FinanceIdentity, slot: string): string {
  return `fin01a:${i.workspaceId}:${i.userId}:${slot}`;
}
export function loadPending(
  i: FinanceIdentity,
  slot: string,
): PendingFinanceOperation | null {
  const raw = sessionStorage.getItem(storageKey(i, slot));
  if (raw === null) return null;
  const p: unknown = JSON.parse(raw);
  if (!p || typeof p !== 'object')
    throw new Error('Bản ghi chờ không hợp lệ. Không thể gửi thao tác mới.');
  const o = p as PendingFinanceOperation;
  if (
    o.identity?.userId !== i.userId ||
    o.identity?.workspaceId !== i.workspaceId ||
    typeof o.key !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(o.key) ||
    typeof o.path !== 'string' ||
    !/^\/((categories|entries)(\/[0-9a-f-]{36}(\/correct)?)?|plan-items(\/[0-9a-f-]{36})?)$/.test(
      o.path,
    ) ||
    !['POST', 'PATCH'].includes(o.method) ||
    !o.payload ||
    typeof o.payload !== 'object' ||
    Array.isArray(o.payload) ||
    !(o.version === null || (Number.isSafeInteger(o.version) && o.version > 0))
  )
    throw new Error('Bản ghi chờ không hợp lệ. Không thể gửi thao tác mới.');
  const parsed =
    o.path === '/entries'
      ? parseFinanceEntry(o.payload)
      : o.path === '/plan-items'
        ? parseFinancePlanItem(o.payload)
        : o.path.startsWith('/plan-items/')
          ? parseFinancePlanItemUpdate(o.payload)
          : o.path.endsWith('/correct')
            ? parseFinanceCorrection(o.payload)
            : o.path === '/categories'
              ? parseFinanceCategory(o.payload)
              : parseFinanceCategoryUpdate(o.payload);
  if (JSON.stringify(parsed) !== JSON.stringify(o.payload))
    throw new Error('Nội dung yêu cầu chờ không hợp lệ.');
  if (
    (o.path.endsWith('/correct') || o.method === 'PATCH') &&
    o.version === null
  )
    throw new Error('Yêu cầu chờ thiếu phiên bản.');
  if (
    ((o.path === '/entries' ||
      o.path === '/categories' ||
      o.path === '/plan-items') &&
      o.method !== 'POST') ||
    (o.path.endsWith('/correct') && o.method !== 'POST') ||
    (/^\/(categories|plan-items)\//.test(o.path) && o.method !== 'PATCH')
  )
    throw new Error('Yêu cầu chờ sai operation.');
  return o;
}
export function savePending(
  i: FinanceIdentity,
  slot: string,
  o: PendingFinanceOperation,
): void {
  const key = storageKey(i, slot);
  const raw = JSON.stringify(o);
  sessionStorage.setItem(key, raw);
  if (sessionStorage.getItem(key) !== raw)
    throw new Error('Không lưu được yêu cầu an toàn. Chưa gửi dữ liệu.');
}
export function clearPending(
  i: FinanceIdentity,
  slot: string,
  key: string,
): void {
  const current = loadPending(i, slot);
  if (current?.key === key) {
    const k = storageKey(i, slot);
    const original = sessionStorage.getItem(k);
    sessionStorage.removeItem(k);
    let confirmed = false;
    try {
      confirmed = sessionStorage.getItem(k) === null;
    } catch {
      confirmed = false;
    }
    if (!confirmed) {
      // Removal is unconfirmed: put the original key/payload back so a retry
      // or remount replays the same operation instead of creating a new one.
      try {
        if (original !== null) sessionStorage.setItem(k, original);
      } catch {
        // storage unusable: savePending fails closed before any new send.
      }
      throw new Error(
        'Đã ghi nhận thành công nhưng chưa dọn được bản ghi chờ. Chỉ thử lại cùng yêu cầu.',
      );
    }
  }
}
export async function sendPending(
  o: PendingFinanceOperation,
  signal: AbortSignal,
): Promise<FinanceCategoryData | FinanceEntryData | FinancePlanItemData> {
  const csrf = await verifyIdentity(o.identity, signal);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const res = await fetch('/api/v1/fin' + o.path, {
    method: o.method,
    credentials: 'include',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
      'Idempotency-Key': o.key,
      ...(o.version !== null ? { 'If-Match': `"${o.version}"` } : {}),
    },
    body: JSON.stringify(o.payload),
  });
  const body = await res.json();
  if (!res.ok || body?.success !== true)
    throw new FinanceApiError(
      res.status,
      body?.error?.code || 'MUTATION_FAILED',
    );
  const d = body.data;
  if (
    !d ||
    typeof d.id !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(d.id) ||
    !Number.isSafeInteger(d.version) ||
    d.version < 1 ||
    (d.direction !== o.payload['direction'] && o.path === '/categories')
  )
    throw new Error('Response không hợp lệ; giữ yêu cầu chờ để đối soát.');
  if (o.path.startsWith('/entries')) {
    for (const k of ['direction', 'category_id', 'amount_vnd', 'note'])
      if (d[k] !== o.payload[k])
        throw new Error('Response không khớp yêu cầu; giữ yêu cầu chờ.');
    // Auto mode has no client date: the server stamps the time once and echoes it.
    if (
      'occurred_on' in o.payload &&
      d.occurred_on !== o.payload['occurred_on']
    )
      throw new Error('Response không khớp yêu cầu; giữ yêu cầu chờ.');
    const at = o.payload['occurred_at'];
    if (
      (o.payload['time_mode'] === 'auto' &&
        !(
          d.occurred_at_source === 'auto' && typeof d.occurred_at === 'string'
        )) ||
      (o.payload['time_mode'] === 'manual' &&
        !(
          d.occurred_at_source === 'manual' &&
          d.occurred_at === at &&
          typeof at === 'string' &&
          d.occurred_on === at.slice(0, 10)
        )) ||
      ('receipt_id' in o.payload && d.receipt_id !== o.payload['receipt_id'])
    )
      throw new Error(
        'Response không khớp thời gian hoặc ảnh; giữ yêu cầu chờ.',
      );
    if (
      typeof d.revision_id !== 'string' ||
      typeof d.category_name_snapshot !== 'string'
    )
      throw new Error('Response thiếu revision.');
  } else if (o.path.startsWith('/plan-items')) {
    if (
      typeof d.category_id !== 'string' ||
      typeof d.amount_vnd !== 'string' ||
      typeof d.is_active !== 'boolean' ||
      typeof d.category_name !== 'string'
    )
      throw new Error('Response thiếu khoản dự tính.');
    for (const k of ['direction', 'category_id', 'amount_vnd', 'is_active'])
      if (k in o.payload && d[k] !== o.payload[k])
        throw new Error('Response không khớp khoản dự tính.');
  } else {
    if (typeof d.name !== 'string' || typeof d.is_active !== 'boolean')
      throw new Error('Response thiếu danh mục.');
    if (
      ('name' in o.payload &&
        d.name !== String(o.payload['name']).normalize('NFC').trim()) ||
      ('is_active' in o.payload && d.is_active !== o.payload['is_active'])
    )
      throw new Error('Response không khớp danh mục.');
  }
  if (o.version !== null && d.version !== o.version + 1)
    throw new Error('Response sai phiên bản.');
  return d;
}

/** Real `ReceiptApi`: Owner-only FIN endpoints; the browser never talks to AI directly. */
export function createReceiptApi(identity: FinanceIdentity): ReceiptApi {
  async function call(
    path: string,
    init: { method: string; body?: Uint8Array; contentType?: string },
    signal: AbortSignal,
  ): Promise<{ status: number; body: Record<string, unknown> | null }> {
    const csrf = await verifyIdentity(identity, signal);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const res = await fetch('/api/v1/fin/receipts' + path, {
      method: init.method,
      credentials: 'include',
      signal,
      headers: {
        'X-CSRF-Token': csrf,
        ...(init.contentType ? { 'Content-Type': init.contentType } : {}),
      },
      ...(init.body ? { body: init.body as BodyInit } : {}),
    });
    const body = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    return { status: res.status, body };
  }
  const errorCode = (b: Record<string, unknown> | null): string => {
    const e = b?.['error'] as { code?: unknown } | undefined;
    return typeof e?.code === 'string' ? e.code : 'RECEIPT_FAILED';
  };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  return {
    async upload(bytes: Uint8Array, mime: ReceiptMime, signal: AbortSignal) {
      const r = await call(
        '',
        { method: 'POST', body: bytes, contentType: mime },
        signal,
      );
      const d = r.body?.['data'] as Record<string, unknown> | undefined;
      if (r.status !== 201 || r.body?.['success'] !== true)
        throw new FinanceApiError(r.status, errorCode(r.body));
      if (typeof d?.['id'] !== 'string' || !uuid.test(d['id']))
        throw new Error('Phản hồi ảnh không hợp lệ.');
      return {
        id: d['id'],
        duplicate_of_entry_id:
          typeof d['duplicate_of_entry_id'] === 'string' &&
          uuid.test(d['duplicate_of_entry_id'])
            ? d['duplicate_of_entry_id']
            : null,
      };
    },
    async extract(
      receiptId: string,
      signal: AbortSignal,
    ): Promise<AiResult<ReceiptSuggestion>> {
      if (!uuid.test(receiptId)) throw new Error('Mã ảnh không hợp lệ.');
      const r = await call(`/${receiptId}/extract`, { method: 'POST' }, signal);
      if (r.status === 429)
        return { status: 'unavailable', reason: 'AI_RATE_LIMITED' };
      if (r.status !== 200 || r.body?.['success'] !== true)
        throw new FinanceApiError(r.status, errorCode(r.body));
      const d = r.body['data'] as Record<string, unknown> | undefined;
      if (d?.['status'] === 'unavailable')
        return {
          status: 'unavailable',
          reason:
            typeof d['reason'] === 'string' ? d['reason'] : 'AI_UNAVAILABLE',
        };
      const s = d?.['data'] as Record<string, unknown> | undefined;
      if (
        d?.['status'] !== 'ok' ||
        !s ||
        !Array.isArray(s['ambiguous_fields']) ||
        !Array.isArray(s['unreadable_fields'])
      )
        throw new Error('Phản hồi AI không hợp lệ.');
      return { status: 'ok', data: s as unknown as ReceiptSuggestion };
    },
    async discard(receiptId: string, signal: AbortSignal) {
      if (!uuid.test(receiptId)) throw new Error('Mã ảnh không hợp lệ.');
      const r = await call(`/${receiptId}`, { method: 'DELETE' }, signal);
      if (r.status !== 200 || r.body?.['success'] !== true)
        throw new FinanceApiError(r.status, errorCode(r.body));
    },
  };
}
