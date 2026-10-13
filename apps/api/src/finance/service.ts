import crypto from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { AuthError, type AuthenticatedContext } from '../auth/service.js';
import { requireRole } from '../auth/guard.js';
import { createSuccessEnvelope, type SuccessEnvelope } from '../envelope.js';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import {
  claimIdempotency,
  completeIdempotency,
  computeRequestFingerprint,
} from '../../../../packages/database/src/idempotency.js';
import {
  parseFinanceCategory,
  parseFinanceCategoryUpdate,
  parseFinanceEntry,
  parseFinanceCorrection,
  parseVietnamInstant,
  type CreateFinanceEntryRequest,
  type FinanceCategoryData,
  type FinanceEntryData,
  type FinanceTimeSource,
} from '../../../../packages/contracts/src/finance.js';
import {
  PLAN_MAX_ITEMS,
  computePlanSummary,
  parseFinancePlanItem,
  parseFinancePlanItemUpdate,
  parsePlanMonth,
  type FinancePlanItemData,
} from '../../../../packages/contracts/src/finance-plan.js';
import { ReceiptStore, validateReceiptUpload } from './receipt-store.js';
import { decodeReceiptImage } from '../ai-core/image.js';
import { aiEligible, mapReceiptDraft } from './receipt-draft.js';

const fail = (code: string, message: string, status: number): never => {
  throw new AuthError(code, message, status);
};
function uuid(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    fail('VALIDATION_ERROR', 'Invalid identifier', 400);
  return value.toLowerCase();
}
function date(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith('0000') ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    fail('VALIDATION_ERROR', 'Invalid date', 400);
  return value;
}
function version(value: string | undefined): number {
  if (!value) fail('PRECONDITION_REQUIRED', 'If-Match required', 428);
  if (!/^"[1-9][0-9]*"$/.test(value!))
    fail('PRECONDITION_FAILED', 'Invalid If-Match', 412);
  const n = Number(value!.slice(1, -1));
  if (!Number.isSafeInteger(n))
    fail('PRECONDITION_FAILED', 'Invalid If-Match', 412);
  return n;
}
const iso = (v: string | Date): string => new Date(v).toISOString();
interface Category extends QueryResultRow {
  id: string;
  direction: 'income' | 'expense';
  name: string;
  normalized_name: string;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}
interface Entry extends QueryResultRow {
  id: string;
  root_entry_id: string;
  revision_number: number;
  direction: 'income' | 'expense';
  category_id: string;
  category_name_snapshot: string;
  amount_vnd: string;
  occurred_on: string;
  note: string | null;
  occurred_at: Date | null;
  occurred_at_vn: string | null;
  occurred_at_source: FinanceTimeSource;
  receipt_id: string | null;
  created_at: Date;
  root_created_at: Date;
  operation_key: string;
  request_fingerprint: string;
}
interface PlanRow extends QueryResultRow {
  id: string;
  direction: 'income' | 'expense';
  category_id: string;
  category_name: string;
  category_is_active: boolean;
  amount_vnd: string;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}
const planData = (r: PlanRow): FinancePlanItemData => ({
  id: r.id,
  direction: r.direction,
  category_id: r.category_id,
  category_name: r.category_name,
  category_is_active: r.category_is_active,
  amount_vnd: r.amount_vnd,
  is_active: r.is_active,
  version: r.version,
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
});
const planSelect = `SELECT p.id,p.direction,p.category_id,c.name AS category_name,c.is_active AS category_is_active,p.amount_vnd::text AS amount_vnd,p.is_active,p.version,p.created_at,p.updated_at,c.normalized_name FROM fin_plan_items p JOIN fin_categories c ON c.workspace_id=p.workspace_id AND c.owner_user_id=p.owner_user_id AND c.id=p.category_id`;
const categoryData = (r: Category): FinanceCategoryData => ({
  id: r.id,
  direction: r.direction,
  name: r.name,
  is_active: r.is_active,
  version: r.version,
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
});
const entryData = (r: Entry): FinanceEntryData => ({
  id: r.root_entry_id,
  revision_id: r.id,
  version: r.revision_number,
  direction: r.direction,
  category_id: r.category_id,
  category_name_snapshot: r.category_name_snapshot,
  amount_vnd: r.amount_vnd,
  occurred_on: r.occurred_on,
  note: r.note,
  occurred_at: r.occurred_at_vn,
  occurred_at_source: r.occurred_at_source,
  receipt_id: r.receipt_id,
  created_at: iso(r.root_created_at),
  revision_created_at: iso(r.created_at),
});
const entrySelect = `SELECT e.*, e.amount_vnd::text AS amount_vnd, e.occurred_on::text AS occurred_on, to_char(e.occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD"T"HH24:MI:SS"+07:00"') AS occurred_at_vn, root.created_at AS root_created_at FROM fin_entries e JOIN fin_entries root ON root.workspace_id=e.workspace_id AND root.owner_user_id=e.owner_user_id AND root.id=e.root_entry_id`;
const effective = `NOT EXISTS (SELECT 1 FROM fin_entry_corrections x WHERE x.workspace_id=e.workspace_id AND x.owner_user_id=e.owner_user_id AND x.original_revision_id=e.id)`;
export interface FinanceServiceOptions {
  receipts?: ReceiptStore | undefined;
  /** The single AI Core instance (structural; FIN never builds a provider). */
  ai?: ReceiptExtractor | undefined;
  now?: (() => Date) | undefined;
  /**
   * Full-decode gate for uploaded receipts. Defaults to AI Core's sandboxed decoder worker
   * (size, pixel, time and memory limits); never a second decoder. Rejects on invalid images.
   */
  decodeImage?:
    | ((
        image: { mimeType: 'image/png' | 'image/jpeg'; bytes: Uint8Array },
        signal: AbortSignal,
      ) => Promise<unknown>)
    | undefined;
  /** Receives fixed messages only (no paths, bytes or error text). */
  logger?: { warn: (message: string) => void } | undefined;
}
/** Structural subset of AI Core's `extractReceipt` (apps/api/src/ai-core). */
export interface ReceiptExtractor {
  extractReceipt(
    context: FinAiContext,
    input: {
      image: { mimeType: 'image/png' | 'image/jpeg'; bytes: Uint8Array };
      context: {
        categories: {
          id: string;
          name: string;
          direction: 'income' | 'expense';
        }[];
      };
    },
    signal: AbortSignal,
  ): Promise<{ draft: unknown; reviewRequired: true }>;
}
export interface FinAiContext {
  auth: AuthenticatedContext;
}
interface ResolvedTime {
  occurred_at: Date | null;
  occurred_on: string;
  source: FinanceTimeSource;
}
const vietnamDate = (d: Date): string =>
  new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
interface MutationResult {
  status: number;
  body: SuccessEnvelope;
}
interface Cursor {
  binding: string;
  values: string[];
}
function parameters(q: URLSearchParams, allowed: string[]): void {
  const seen = new Set<string>();
  for (const [key] of q) {
    if (!allowed.includes(key) || seen.has(key))
      fail('VALIDATION_ERROR', 'Invalid query parameters', 400);
    seen.add(key);
  }
}
function limit(q: URLSearchParams): number {
  const v = q.get('limit') ?? '50';
  if (!/^[1-9][0-9]{0,2}$/.test(v) || Number(v) > 100)
    fail('VALIDATION_ERROR', 'Invalid limit', 400);
  return Number(v);
}
/** Optional `offset` for numbered pages; mutually exclusive with `cursor`. null = cursor mode. */
function offsetParam(q: URLSearchParams): number | null {
  if (!q.has('offset')) return null;
  const v = q.get('offset') ?? '';
  if (!/^(0|[1-9][0-9]{0,5})$/.test(v) || q.has('cursor'))
    fail('VALIDATION_ERROR', 'Invalid offset', 400);
  return Number(v);
}
function binding(
  auth: AuthenticatedContext,
  route: string,
  filters: unknown,
): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([auth.workspace.id, auth.user.id, route, filters]))
    .digest('hex');
}
function cursor(
  q: URLSearchParams,
  expected: string,
  count: number,
): string[] | null {
  if (!q.has('cursor')) return null;
  const raw = q.get('cursor')!;
  if (!raw || raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw))
    fail('VALIDATION_ERROR', 'Invalid cursor', 400);
  try {
    const c: Cursor = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Cursor;
    if (
      c.binding !== expected ||
      !Array.isArray(c.values) ||
      c.values.length !== count ||
      c.values.some((v) => typeof v !== 'string')
    )
      throw new Error();
    return c.values;
  } catch {
    return fail('VALIDATION_ERROR', 'Invalid cursor', 400);
  }
}
const encode = (binding: string, values: string[]): string =>
  Buffer.from(JSON.stringify({ binding, values })).toString('base64url');

export class FinanceService {
  constructor(
    private readonly pool: Pool,
    private readonly options: FinanceServiceOptions = {},
  ) {}
  private now(): Date {
    return this.options.now ? this.options.now() : new Date();
  }
  private async authorized(
    c: PoolClient,
    auth: AuthenticatedContext,
  ): Promise<void> {
    const u = await c.query(
      "SELECT id FROM users WHERE id=$1 AND status='active' FOR SHARE",
      [auth.user.id],
    );
    const b = await c.query(
      "SELECT id FROM user_workspace_bindings WHERE user_id=$1 AND workspace_id=$2 AND status='active' FOR SHARE",
      [auth.user.id, auth.workspace.id],
    );
    const m = await c.query(
      "SELECT role FROM workspace_memberships WHERE user_id=$1 AND workspace_id=$2 AND status='active' FOR SHARE",
      [auth.user.id, auth.workspace.id],
    );
    const s = await c.query(
      `SELECT s.id FROM auth_sessions s JOIN user_credentials cr ON cr.user_id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.workspace_id=$3 AND s.session_token_hash=$4 AND s.revoked_at IS NULL AND s.idle_expires_at>clock_timestamp() AND s.absolute_expires_at>clock_timestamp() AND s.credential_version_at_issue=cr.credential_version FOR SHARE OF s,cr`,
      [auth.sessionId, auth.user.id, auth.workspace.id, auth.sessionTokenHash],
    );
    const w = await c.query(
      "SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR SHARE",
      [auth.workspace.id],
    );
    if (
      !u.rowCount ||
      !b.rowCount ||
      !m.rowCount ||
      !s.rowCount ||
      !w.rowCount ||
      m.rows[0]?.role !== auth.workspace.role
    )
      fail('UNAUTHENTICATED', 'Session no longer authorized', 401);
    if (m.rows[0]?.role !== 'owner')
      fail('FORBIDDEN', 'Owner permission required', 403);
  }
  /**
   * Read-only REPEATABLE READ transaction. The session/membership `FOR SHARE` locks can collide
   * with a concurrent session `last_seen_at` touch (40001/40P01); reads are idempotent, so the
   * whole transaction is retried a few times before surfacing a retryable 409.
   */
  private async read<T>(
    auth: AuthenticatedContext,
    fn: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    requireRole(['owner'], auth);
    for (let attempt = 1; ; attempt++) {
      const c = await this.pool.connect();
      let broken = false;
      try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        await this.authorized(c, auth);
        const data = await fn(c);
        await c.query('COMMIT');
        return data;
      } catch (e) {
        try {
          await c.query('ROLLBACK');
        } catch {
          broken = true;
        }
        const code = (e as { code?: string }).code;
        if (code === '40001' || code === '40P01') {
          if (attempt >= 4) fail('CONFLICT', 'Concurrent change; retry', 409);
          await new Promise((r) => setTimeout(r, 10 * attempt));
          continue;
        }
        throw e;
      } finally {
        c.release(broken || undefined);
      }
    }
  }
  private async write(
    auth: AuthenticatedContext,
    method: string,
    route: string,
    body: unknown,
    key: string | undefined,
    requestId: string,
    action: string,
    fn: (
      c: PoolClient,
      operation: string,
      fingerprint: string,
    ) => Promise<{ data: unknown; entityId: string; version: number }>,
  ): Promise<MutationResult> {
    requireRole(['owner'], auth);
    if (!key) fail('PRECONDITION_REQUIRED', 'Idempotency-Key required', 428);
    if (!/^[\x21-\x7e]{1,128}$/.test(key!))
      fail('VALIDATION_ERROR', 'Invalid Idempotency-Key', 400);
    const operation = `FIN:${method}:${route}:${key}`;
    const fingerprint = computeRequestFingerprint(method, route, body);
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await this.authorized(c, auth);
      // One private ledger writer at a time; never lock another Owner's ledger.
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `fin:${auth.workspace.id}:${auth.user.id}`,
      ]);
      // Expiry can advance while waiting for the ledger lock.
      await this.authorized(c, auth);
      const claim = await claimIdempotency(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        operationKey: operation,
        requestFingerprint: fingerprint,
      });
      if (claim.status === 'mismatch')
        fail('IDEMPOTENCY_CONFLICT', 'Idempotency key payload mismatch', 409);
      if (claim.status === 'replay') {
        const stored = claim.sanitizedResponse as SuccessEnvelope;
        if (
          !stored ||
          stored.success !== true ||
          !stored.meta?.request_id ||
          !claim.responseCode
        )
          fail(
            'IDEMPOTENCY_IN_PROGRESS',
            'Operation requires reconciliation',
            409,
          );
        await c.query('COMMIT');
        return { status: claim.responseCode!, body: stored };
      }
      if (claim.status !== 'claimed')
        fail(
          'IDEMPOTENCY_IN_PROGRESS',
          'Operation requires reconciliation',
          409,
        );
      // Registry retention is not a license to repeat a committed entry operation.
      const committed = await c.query<Entry>(
        `${entrySelect} WHERE e.workspace_id=$1 AND e.owner_user_id=$2 AND e.operation_key=$3`,
        [auth.workspace.id, auth.user.id, operation],
      );
      if (committed.rows[0]) {
        const row = committed.rows[0];
        if (row.request_fingerprint !== fingerprint)
          fail('IDEMPOTENCY_CONFLICT', 'Idempotency key payload mismatch', 409);
        const proof = await c.query(
          'SELECT request_id FROM audit_events WHERE workspace_id=$1 AND actor_user_id=$2 AND action=$3 AND entity_id=$4',
          [auth.workspace.id, auth.user.id, action, row.id],
        );
        if (proof.rowCount !== 1)
          fail(
            'IDEMPOTENCY_IN_PROGRESS',
            'Operation requires reconciliation',
            409,
          );
        const replay = createSuccessEnvelope(
          entryData(row),
          proof.rows[0].request_id as string,
        );
        await completeIdempotency(c, {
          workspaceId: auth.workspace.id,
          actorUserId: auth.user.id,
          operationKey: operation,
          responseCode: 201,
          sanitizedResponse: replay,
        });
        await c.query('COMMIT');
        return { status: 201, body: replay };
      }
      const out = await fn(c, operation, fingerprint);
      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action,
        entityType: 'finance',
        entityId: out.entityId,
        requestId,
        metadata: { version: out.version },
      });
      const status = method === 'PATCH' ? 200 : 201;
      const response = createSuccessEnvelope(out.data, requestId);
      await completeIdempotency(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        operationKey: operation,
        responseCode: status,
        sanitizedResponse: response,
      });
      await c.query('COMMIT');
      return { status, body: response };
    } catch (e) {
      await c.query('ROLLBACK');
      const code = (e as { code?: string }).code;
      if (code === '23505')
        fail('CONFLICT', 'Conflicting category or operation', 409);
      if (code === '40001' || code === '40P01')
        fail('CONFLICT', 'Concurrent change; retry original operation', 409);
      if (code === '23514')
        fail('INVALID_STATE', 'Entry violates ledger rules', 422);
      throw e;
    } finally {
      c.release();
    }
  }
  async categories(
    auth: AuthenticatedContext,
    q: URLSearchParams,
  ): Promise<unknown> {
    parameters(q, ['direction', 'cursor', 'limit', 'offset']);
    const n = limit(q),
      off = offsetParam(q),
      d = q.get('direction');
    if (d !== null && d !== 'income' && d !== 'expense')
      fail('VALIDATION_ERROR', 'Invalid direction', 400);
    const bind = binding(auth, 'categories', [d]);
    const cur = cursor(q, bind, 2);
    if (cur) {
      if (cur[0]!.length > 100) fail('VALIDATION_ERROR', 'Invalid cursor', 400);
      uuid(cur[1]!);
    }
    return this.read(auth, async (c) => {
      if (off !== null) {
        const total = Number(
          (
            await c.query<{ n: string }>(
              `SELECT count(*)::text AS n FROM fin_categories WHERE workspace_id=$1 AND owner_user_id=$2 AND ($3::text IS NULL OR direction=$3)`,
              [auth.workspace.id, auth.user.id, d],
            )
          ).rows[0]!.n,
        );
        const items = (
          await c.query<Category>(
            `SELECT * FROM fin_categories WHERE workspace_id=$1 AND owner_user_id=$2 AND ($3::text IS NULL OR direction=$3) ORDER BY normalized_name ASC,id ASC LIMIT $4 OFFSET $5`,
            [auth.workspace.id, auth.user.id, d, n, off],
          )
        ).rows;
        return {
          items: items.map(categoryData),
          next_cursor: null,
          total,
          offset: off,
          limit: n,
        };
      }
      const rows = (
        await c.query<Category>(
          `SELECT * FROM fin_categories WHERE workspace_id=$1 AND owner_user_id=$2 AND ($3::text IS NULL OR direction=$3) AND ($4::text IS NULL OR (normalized_name,id)>($4,$5::uuid)) ORDER BY normalized_name ASC,id ASC LIMIT $6`,
          [
            auth.workspace.id,
            auth.user.id,
            d,
            cur?.[0] ?? null,
            cur?.[1] ?? null,
            n + 1,
          ],
        )
      ).rows;
      const more = rows.length > n;
      const page = rows.slice(0, n);
      const last = page.at(-1);
      return {
        items: page.map(categoryData),
        next_cursor:
          more && last ? encode(bind, [last.normalized_name, last.id]) : null,
      };
    });
  }
  async createCategory(
    auth: AuthenticatedContext,
    body: unknown,
    key: string | undefined,
    requestId: string,
  ): Promise<MutationResult> {
    const data = parseFinanceCategory(body);
    return this.write(
      auth,
      'POST',
      '/api/v1/fin/categories',
      data,
      key,
      requestId,
      'FIN_CATEGORY_CREATED',
      async (c) => {
        const row = (
          await c.query<Category>(
            'INSERT INTO fin_categories(workspace_id,owner_user_id,direction,name) VALUES ($1,$2,$3,$4) RETURNING *',
            [auth.workspace.id, auth.user.id, data.direction, data.name],
          )
        ).rows[0]!;
        return {
          data: categoryData(row),
          entityId: row.id,
          version: row.version,
        };
      },
    );
  }
  async updateCategory(
    auth: AuthenticatedContext,
    id: string,
    body: unknown,
    key: string | undefined,
    match: string | undefined,
    requestId: string,
  ): Promise<MutationResult> {
    if (!match) fail('PRECONDITION_REQUIRED', 'If-Match required', 428);
    id = uuid(id);
    const data = parseFinanceCategoryUpdate(body);
    return this.write(
      auth,
      'PATCH',
      `/api/v1/fin/categories/${id}`,
      data,
      key,
      requestId,
      'FIN_CATEGORY_UPDATED',
      async (c) => {
        const current = (
          await c.query<Category>(
            'SELECT * FROM fin_categories WHERE workspace_id=$1 AND owner_user_id=$2 AND id=$3 FOR UPDATE',
            [auth.workspace.id, auth.user.id, id],
          )
        ).rows[0];
        if (!current) fail('NOT_FOUND', 'Category not found', 404);
        if (current!.version !== version(match))
          fail('PRECONDITION_FAILED', 'Category changed', 412);
        const row = (
          await c.query<Category>(
            'UPDATE fin_categories SET name=$4,is_active=$5,version=version+1 WHERE workspace_id=$1 AND owner_user_id=$2 AND id=$3 RETURNING *',
            [
              auth.workspace.id,
              auth.user.id,
              id,
              data.name ?? current!.name,
              data.is_active ?? current!.is_active,
            ],
          )
        ).rows[0]!;
        return {
          data: categoryData(row),
          entityId: row.id,
          version: row.version,
        };
      },
    );
  }
  async plan(auth: AuthenticatedContext, q: URLSearchParams): Promise<unknown> {
    parameters(q, ['month']);
    let month: string;
    try {
      month = parsePlanMonth(
        q.get('month') ?? vietnamDate(this.now()).slice(0, 7),
      );
    } catch {
      return fail('VALIDATION_ERROR', 'Invalid month', 400);
    }
    return this.read(auth, async (c) => {
      const rows = (
        await c.query<PlanRow>(
          `${planSelect} WHERE p.workspace_id=$1 AND p.owner_user_id=$2 ORDER BY p.direction DESC,c.normalized_name ASC,p.created_at ASC,p.id ASC`,
          [auth.workspace.id, auth.user.id],
        )
      ).rows;
      const items = rows.map(planData);
      return { items, summary: computePlanSummary(items, month) };
    });
  }
  async createPlanItem(
    auth: AuthenticatedContext,
    body: unknown,
    key: string | undefined,
    requestId: string,
  ): Promise<MutationResult> {
    const data = parseFinancePlanItem(body);
    return this.write(
      auth,
      'POST',
      '/api/v1/fin/plan-items',
      data,
      key,
      requestId,
      'FIN_PLAN_ITEM_CREATED',
      async (c) => {
        const cat = (
          await c.query<Category>(
            'SELECT * FROM fin_categories WHERE workspace_id=$1 AND owner_user_id=$2 AND id=$3 FOR SHARE',
            [auth.workspace.id, auth.user.id, data.category_id],
          )
        ).rows[0];
        if (!cat) fail('NOT_FOUND', 'Category not found', 404);
        if (cat!.direction !== data.direction)
          fail('VALIDATION_ERROR', 'Category direction mismatch', 400);
        if (!cat!.is_active)
          fail('INVALID_STATE', 'Category is not in use', 422);
        const count = Number(
          (
            await c.query(
              'SELECT count(*)::int AS n FROM fin_plan_items WHERE workspace_id=$1 AND owner_user_id=$2',
              [auth.workspace.id, auth.user.id],
            )
          ).rows[0]!.n,
        );
        if (count >= PLAN_MAX_ITEMS)
          fail('INVALID_STATE', 'Too many plan items', 422);
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO fin_plan_items(workspace_id,owner_user_id,direction,category_id,amount_vnd) VALUES ($1,$2,$3,$4,$5::bigint) RETURNING id',
            [
              auth.workspace.id,
              auth.user.id,
              data.direction,
              data.category_id,
              data.amount_vnd,
            ],
          )
        ).rows[0]!.id;
        const row = (
          await c.query<PlanRow>(
            `${planSelect} WHERE p.workspace_id=$1 AND p.owner_user_id=$2 AND p.id=$3`,
            [auth.workspace.id, auth.user.id, id],
          )
        ).rows[0]!;
        return { data: planData(row), entityId: row.id, version: row.version };
      },
    );
  }
  async updatePlanItem(
    auth: AuthenticatedContext,
    id: string,
    body: unknown,
    key: string | undefined,
    match: string | undefined,
    requestId: string,
  ): Promise<MutationResult> {
    if (!match) fail('PRECONDITION_REQUIRED', 'If-Match required', 428);
    id = uuid(id);
    const data = parseFinancePlanItemUpdate(body);
    return this.write(
      auth,
      'PATCH',
      `/api/v1/fin/plan-items/${id}`,
      data,
      key,
      requestId,
      'FIN_PLAN_ITEM_UPDATED',
      async (c) => {
        const current = (
          await c.query<PlanRow>(
            `${planSelect} WHERE p.workspace_id=$1 AND p.owner_user_id=$2 AND p.id=$3 FOR UPDATE OF p`,
            [auth.workspace.id, auth.user.id, id],
          )
        ).rows[0];
        if (!current) fail('NOT_FOUND', 'Plan item not found', 404);
        if (current!.version !== version(match))
          fail('PRECONDITION_FAILED', 'Plan item changed', 412);
        const nextActive = data.is_active ?? current!.is_active;
        if (nextActive && !current!.is_active && !current!.category_is_active)
          fail('INVALID_STATE', 'Category is not in use', 422);
        await c.query(
          'UPDATE fin_plan_items SET amount_vnd=$4::bigint,is_active=$5,version=version+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND owner_user_id=$2 AND id=$3',
          [
            auth.workspace.id,
            auth.user.id,
            id,
            data.amount_vnd ?? current!.amount_vnd,
            nextActive,
          ],
        );
        const row = (
          await c.query<PlanRow>(
            `${planSelect} WHERE p.workspace_id=$1 AND p.owner_user_id=$2 AND p.id=$3`,
            [auth.workspace.id, auth.user.id, id],
          )
        ).rows[0]!;
        return { data: planData(row), entityId: row.id, version: row.version };
      },
    );
  }
  async entries(
    auth: AuthenticatedContext,
    q: URLSearchParams,
  ): Promise<unknown> {
    parameters(q, [
      'from',
      'to',
      'direction',
      'category_id',
      'cursor',
      'limit',
      'offset',
    ]);
    const n = limit(q),
      off = offsetParam(q),
      from = q.get('from'),
      to = q.get('to'),
      d = q.get('direction'),
      category = q.get('category_id');
    if (from) date(from);
    if (to) date(to);
    if ((q.has('from') && !from) || (q.has('to') && !to))
      fail('VALIDATION_ERROR', 'Invalid date', 400);
    if (from && to && from > to) fail('VALIDATION_ERROR', 'Invalid range', 400);
    if (d !== null && d !== 'income' && d !== 'expense')
      fail('VALIDATION_ERROR', 'Invalid direction', 400);
    if (category !== null) uuid(category);
    const bind = binding(auth, 'entries', [from, to, d, category]);
    const cur = cursor(q, bind, 2);
    if (cur) {
      date(cur[0]!);
      uuid(cur[1]!);
    }
    return this.read(auth, async (c) => {
      if (off !== null) {
        const where = `e.workspace_id=$1 AND e.owner_user_id=$2 AND ${effective} AND ($3::date IS NULL OR e.occurred_on >= $3) AND ($4::date IS NULL OR e.occurred_on <= $4) AND ($5::text IS NULL OR e.direction=$5) AND ($6::uuid IS NULL OR e.category_id=$6)`;
        const args = [auth.workspace.id, auth.user.id, from, to, d, category];
        const total = Number(
          (
            await c.query<{ n: string }>(
              `SELECT count(*)::text AS n FROM fin_entries e WHERE ${where}`,
              args,
            )
          ).rows[0]!.n,
        );
        const items = (
          await c.query<Entry>(
            `${entrySelect} WHERE ${where} ORDER BY e.occurred_on DESC,e.occurred_at DESC NULLS LAST,e.id DESC LIMIT $7 OFFSET $8`,
            [...args, n, off],
          )
        ).rows;
        return {
          items: items.map(entryData),
          next_cursor: null,
          total,
          offset: off,
          limit: n,
        };
      }
      const rows = (
        await c.query<Entry>(
          `${entrySelect} WHERE e.workspace_id=$1 AND e.owner_user_id=$2 AND ${effective} AND ($3::date IS NULL OR e.occurred_on >= $3) AND ($4::date IS NULL OR e.occurred_on <= $4) AND ($5::text IS NULL OR e.direction=$5) AND ($6::uuid IS NULL OR e.category_id=$6) AND ($7::date IS NULL OR (e.occurred_on,e.id)<($7,$8::uuid)) ORDER BY e.occurred_on DESC,e.id DESC LIMIT $9`,
          [
            auth.workspace.id,
            auth.user.id,
            from,
            to,
            d,
            category,
            cur?.[0] ?? null,
            cur?.[1] ?? null,
            n + 1,
          ],
        )
      ).rows;
      const more = rows.length > n,
        page = rows.slice(0, n),
        last = page.at(-1);
      return {
        items: page.map(entryData),
        next_cursor:
          more && last ? encode(bind, [last.occurred_on, last.id]) : null,
      };
    });
  }
  private async current(
    c: PoolClient,
    auth: AuthenticatedContext,
    id: string,
  ): Promise<Entry> {
    const row = (
      await c.query<Entry>(
        `${entrySelect} WHERE e.workspace_id=$1 AND e.owner_user_id=$2 AND e.root_entry_id=$3 AND ${effective}`,
        [auth.workspace.id, auth.user.id, id],
      )
    ).rows[0];
    if (!row) return fail('NOT_FOUND', 'Entry not found', 404);
    return row;
  }
  async detail(
    auth: AuthenticatedContext,
    id: string,
  ): Promise<FinanceEntryData> {
    id = uuid(id);
    return this.read(auth, async (c) =>
      entryData(await this.current(c, auth, id)),
    );
  }
  async corrections(
    auth: AuthenticatedContext,
    id: string,
    q: URLSearchParams,
  ): Promise<unknown> {
    id = uuid(id);
    parameters(q, ['cursor', 'limit']);
    const n = limit(q),
      bind = binding(auth, `corrections/${id}`, []),
      cur = cursor(q, bind, 1);
    if (cur && !/^[1-9][0-9]{0,9}$/.test(cur[0]!))
      fail('VALIDATION_ERROR', 'Invalid cursor', 400);
    return this.read(auth, async (c) => {
      await this.current(c, auth, id);
      const rows = (
        await c.query(
          `SELECT x.*,e.revision_number FROM fin_entry_corrections x JOIN fin_entries e ON e.workspace_id=x.workspace_id AND e.owner_user_id=x.owner_user_id AND e.id=x.replacement_revision_id WHERE x.workspace_id=$1 AND x.owner_user_id=$2 AND x.root_entry_id=$3 AND ($4::bigint IS NULL OR e.revision_number<$4) ORDER BY e.revision_number DESC LIMIT $5`,
          [auth.workspace.id, auth.user.id, id, cur?.[0] ?? null, n + 1],
        )
      ).rows;
      const page = rows.slice(0, n);
      return {
        items: page.map((r) => ({
          id: r.id,
          root_entry_id: r.root_entry_id,
          original_revision_id: r.original_revision_id,
          replacement_revision_id: r.replacement_revision_id,
          reason: r.reason,
          actor_user_id: r.actor_user_id,
          created_at: iso(r.created_at as Date),
        })),
        next_cursor:
          rows.length > n
            ? encode(bind, [String(page.at(-1)!.revision_number)])
            : null,
      };
    });
  }
  private createTime(data: CreateFinanceEntryRequest): ResolvedTime {
    const now = this.now();
    if (data.time_mode === 'auto') {
      return {
        occurred_at: now,
        occurred_on: vietnamDate(now),
        source: 'auto',
      };
    }
    if (data.time_mode === 'manual') {
      const at = parseVietnamInstant(data.occurred_at);
      if (!at) return fail('VALIDATION_ERROR', 'Invalid occurred_at', 400);
      if (at.instant.getTime() > now.getTime())
        return fail('FUTURE_TIME', 'Time cannot be in the future', 422);
      return {
        occurred_at: at.instant,
        occurred_on: at.date,
        source: 'manual',
      };
    }
    return {
      occurred_at: null,
      occurred_on: data.occurred_on!,
      source: 'legacy_date_only',
    };
  }
  /** A correction never changes the time unless the Owner explicitly sends a manual time. */
  private correctionTime(
    old: Entry,
    data: CreateFinanceEntryRequest,
  ): ResolvedTime {
    if (data.time_mode === 'manual') {
      const next = this.createTime(data);
      return next;
    }
    if (data.occurred_on === undefined || data.occurred_on === old.occurred_on)
      return {
        occurred_at: old.occurred_at,
        occurred_on: old.occurred_on,
        source: old.occurred_at_source,
      };
    if (old.occurred_at)
      return fail(
        'TIME_REQUIRED',
        'Changing the date of a timed entry needs a manual time',
        422,
      );
    return {
      occurred_at: null,
      occurred_on: data.occurred_on,
      source: 'legacy_date_only',
    };
  }
  /** Marks an Owner-scoped, unexpired staged receipt attached in the entry's transaction. */
  private async attachReceipt(
    c: PoolClient,
    auth: AuthenticatedContext,
    id: string,
  ): Promise<string> {
    const r = await c.query(
      "UPDATE fin_receipts SET state='attached', attached_at=clock_timestamp() WHERE workspace_id=$1 AND owner_user_id=$2 AND id=$3 AND state='staged' AND expires_at>clock_timestamp() RETURNING id",
      [auth.workspace.id, auth.user.id, id],
    );
    if (!r.rowCount)
      return fail('RECEIPT_UNAVAILABLE', 'Receipt not available', 422);
    return id;
  }
  private async category(
    c: PoolClient,
    auth: AuthenticatedContext,
    data: CreateFinanceEntryRequest,
  ): Promise<Category> {
    const row = (
      await c.query<Category>(
        'SELECT * FROM fin_categories WHERE workspace_id=$1 AND owner_user_id=$2 AND id=$3 FOR SHARE',
        [auth.workspace.id, auth.user.id, data.category_id],
      )
    ).rows[0];
    if (!row) return fail('NOT_FOUND', 'Category not found', 404);
    if (!row.is_active || row.direction !== data.direction)
      return fail(
        'INVALID_CATEGORY',
        'Category inactive or direction mismatch',
        422,
      );
    return row;
  }
  private async insert(
    c: PoolClient,
    auth: AuthenticatedContext,
    data: CreateFinanceEntryRequest,
    category: Category,
    operation: string,
    fingerprint: string,
    root: string,
    revision: number,
    time: ResolvedTime,
    receiptId: string | null,
  ): Promise<Entry> {
    const id = revision === 1 ? root : crypto.randomUUID();
    await c.query(
      'INSERT INTO fin_entries(id,root_entry_id,workspace_id,owner_user_id,revision_number,direction,category_id,category_name_snapshot,amount_vnd,occurred_on,note,operation_key,request_fingerprint,occurred_at,occurred_at_source,receipt_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
      [
        id,
        root,
        auth.workspace.id,
        auth.user.id,
        revision,
        data.direction,
        data.category_id,
        category.name,
        data.amount_vnd,
        time.occurred_on,
        data.note,
        operation,
        fingerprint,
        time.occurred_at,
        time.source,
        receiptId,
      ],
    );
    return (
      await c.query<Entry>(
        `${entrySelect} WHERE e.workspace_id=$1 AND e.owner_user_id=$2 AND e.id=$3`,
        [auth.workspace.id, auth.user.id, id],
      )
    ).rows[0]!;
  }
  async createEntry(
    auth: AuthenticatedContext,
    body: unknown,
    key: string | undefined,
    requestId: string,
  ): Promise<MutationResult> {
    const data = parseFinanceEntry(body);
    return this.write(
      auth,
      'POST',
      '/api/v1/fin/entries',
      data,
      key,
      requestId,
      'FIN_ENTRY_CREATED',
      async (c, operation, fingerprint) => {
        // The time is resolved once, inside the first (and only) committed write. A retry replays
        // the stored response and can never re-stamp.
        const time = this.createTime(data);
        const category = await this.category(c, auth, data);
        const receiptId = data.receipt_id
          ? await this.attachReceipt(c, auth, data.receipt_id)
          : null;
        const row = await this.insert(
          c,
          auth,
          data,
          category,
          operation,
          fingerprint,
          crypto.randomUUID(),
          1,
          time,
          receiptId,
        );
        return {
          data: entryData(row),
          entityId: row.id,
          version: row.revision_number,
        };
      },
    );
  }
  async correct(
    auth: AuthenticatedContext,
    id: string,
    body: unknown,
    key: string | undefined,
    match: string | undefined,
    requestId: string,
  ): Promise<MutationResult> {
    if (!match) fail('PRECONDITION_REQUIRED', 'If-Match required', 428);
    id = uuid(id);
    const data = parseFinanceCorrection(body);
    return this.write(
      auth,
      'POST',
      `/api/v1/fin/entries/${id}/correct`,
      data,
      key,
      requestId,
      'FIN_ENTRY_CORRECTED',
      async (c, operation, fingerprint) => {
        const old = await this.current(c, auth, id);
        if (old.revision_number !== version(match))
          fail('PRECONDITION_FAILED', 'Entry changed', 412);
        const time = this.correctionTime(old, data);
        const receiptTarget =
          data.receipt_id === undefined ? old.receipt_id : data.receipt_id;
        const same =
          old.direction === data.direction &&
          old.category_id === data.category_id &&
          old.amount_vnd === data.amount_vnd &&
          old.occurred_on === time.occurred_on &&
          (old.occurred_at?.getTime() ?? null) ===
            (time.occurred_at?.getTime() ?? null) &&
          old.occurred_at_source === time.source &&
          old.receipt_id === receiptTarget &&
          old.note === data.note;
        if (same) fail('NO_CHANGE', 'Correction must change entry', 422);
        const category = await this.category(c, auth, data);
        const receiptId =
          receiptTarget && receiptTarget !== old.receipt_id
            ? await this.attachReceipt(c, auth, receiptTarget)
            : receiptTarget;
        await c.query(
          'SELECT id FROM fin_entries WHERE workspace_id=$1 AND owner_user_id=$2 AND id=$3 FOR UPDATE',
          [auth.workspace.id, auth.user.id, id],
        );
        const row = await this.insert(
          c,
          auth,
          data,
          category,
          operation,
          fingerprint,
          id,
          old.revision_number + 1,
          time,
          receiptId,
        );
        await c.query(
          'INSERT INTO fin_entry_corrections(workspace_id,owner_user_id,root_entry_id,original_revision_id,replacement_revision_id,reason,actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$2)',
          [auth.workspace.id, auth.user.id, id, old.id, row.id, data.reason],
        );
        return {
          data: entryData(row),
          entityId: row.id,
          version: row.revision_number,
        };
      },
    );
  }
  private receiptStore(): ReceiptStore {
    return (
      this.options.receipts ??
      fail('RECEIPTS_UNAVAILABLE', 'Receipt storage is not configured', 503)
    );
  }
  /** Short Owner-scoped transaction for receipt state; the ledger lock also guards file ops. */
  private async receiptTx<T>(
    auth: AuthenticatedContext,
    fn: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    requireRole(['owner'], auth);
    const c = await this.pool.connect();
    let broken = false;
    try {
      await c.query('BEGIN');
      await this.authorized(c, auth);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `fin:${auth.workspace.id}:${auth.user.id}`,
      ]);
      await this.authorized(c, auth);
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      try {
        await c.query('ROLLBACK');
      } catch {
        broken = true; // connection is unusable: destroy it instead of returning it to the pool
      }
      const code = (e as { code?: string }).code;
      if (code === '40001' || code === '40P01')
        fail('CONFLICT', 'Concurrent change; retry', 409);
      if (code === '23514')
        fail('INVALID_STATE', 'Receipt violates ledger rules', 422);
      throw e;
    } finally {
      c.release(broken || undefined);
    }
  }
  /** Stores a private staged receipt (24h). The Owner confirms it only by saving an entry. */
  async uploadReceipt(
    auth: AuthenticatedContext,
    bytes: Uint8Array,
    declaredType: string | undefined,
    requestId: string,
  ): Promise<MutationResult> {
    const store = this.receiptStore();
    requireRole(['owner'], auth);
    const check = validateReceiptUpload(bytes, declaredType);
    if (!check.ok) {
      const status =
        check.reason === 'TOO_LARGE'
          ? 413
          : check.reason === 'UNSUPPORTED_TYPE' ||
              check.reason === 'TYPE_MISMATCH'
            ? 415
            : 422;
      return fail(`RECEIPT_${check.reason}`, 'Receipt image rejected', status);
    }
    await this.assertDecodable(bytes, check.mime);
    const rel = store.relPath(auth.workspace.id, auth.user.id, check);
    let data;
    try {
      data = await this.receiptTx(auth, async (c) => {
        const id = crypto.randomUUID();
        await store.put(rel, bytes);
        const row = (
          await c.query(
            "INSERT INTO fin_receipts(id,workspace_id,owner_user_id,storage_key,mime_type,size_bytes,sha256,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '24 hours') RETURNING expires_at",
            [
              id,
              auth.workspace.id,
              auth.user.id,
              rel,
              check.mime,
              check.size,
              check.sha256,
            ],
          )
        ).rows[0] as { expires_at: Date };
        const dup = await c.query(
          `SELECT e.root_entry_id FROM fin_entries e JOIN fin_receipts r ON r.workspace_id=e.workspace_id AND r.owner_user_id=e.owner_user_id AND r.id=e.receipt_id WHERE e.workspace_id=$1 AND e.owner_user_id=$2 AND r.sha256=$3 AND ${effective} ORDER BY e.created_at DESC LIMIT 1`,
          [auth.workspace.id, auth.user.id, check.sha256],
        );
        await recordAuditEvent(c, {
          workspaceId: auth.workspace.id,
          actorUserId: auth.user.id,
          action: 'FIN_RECEIPT_UPLOADED',
          entityType: 'finance',
          entityId: id,
          requestId,
          metadata: { size: check.size, mime: check.mime },
        });
        return {
          id,
          mime_type: check.mime,
          size_bytes: check.size,
          expires_at: iso(row.expires_at),
          duplicate_of_entry_id:
            (dup.rows[0] as { root_entry_id: string } | undefined)
              ?.root_entry_id ?? null,
        };
      });
    } catch (e) {
      // A file written before a failed/rolled-back insert is reclaimed only if unreferenced.
      await this.reclaimFiles(auth.workspace.id, auth.user.id, [rel]);
      throw e;
    }
    return { status: 201, body: createSuccessEnvelope(data, requestId) };
  }
  /** Fails closed: any decoder failure rejects the upload before anything is stored. */
  private async assertDecodable(
    bytes: Uint8Array,
    mime: 'image/png' | 'image/jpeg',
  ): Promise<void> {
    const decode = this.options.decodeImage ?? decodeReceiptImage;
    const ac = new AbortController();
    try {
      await decode({ mimeType: mime, bytes }, ac.signal);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'AI_BUSY')
        fail(
          'RECEIPT_VALIDATION_BUSY',
          'Receipt validation is busy; retry',
          429,
        );
      if (code === 'AI_INVALID_INPUT' || code === 'AI_TIMEOUT')
        fail('RECEIPT_MALFORMED_IMAGE', 'Receipt image rejected', 422);
      fail(
        'RECEIPT_VALIDATION_UNAVAILABLE',
        'Receipt validation is unavailable',
        503,
      );
    }
  }
  private async receiptRow(
    c: PoolClient,
    auth: AuthenticatedContext,
    id: string,
    states: string[],
  ): Promise<{
    id: string;
    storage_key: string;
    mime_type: 'image/jpeg' | 'image/png';
    size_bytes: number;
    sha256: string;
    state: string;
  }> {
    const row = (
      await c.query(
        "SELECT id,storage_key,mime_type,size_bytes,sha256,state FROM fin_receipts WHERE workspace_id=$1 AND owner_user_id=$2 AND id=$3 AND state=ANY($4::text[]) AND (state<>'staged' OR expires_at>clock_timestamp())",
        [auth.workspace.id, auth.user.id, id, states],
      )
    ).rows[0];
    if (!row) return fail('NOT_FOUND', 'Receipt not found', 404);
    return row;
  }
  /** Owner-only image bytes for a staged or attached receipt. */
  async receiptFile(
    auth: AuthenticatedContext,
    id: string,
  ): Promise<{ bytes: Uint8Array; mime: string }> {
    id = uuid(id);
    const store = this.receiptStore();
    const row = await this.read(auth, (c) =>
      this.receiptRow(c, auth, id, ['staged', 'attached']),
    );
    try {
      const bytes = await store.get(row.storage_key);
      return { bytes, mime: row.mime_type };
    } catch {
      return fail('NOT_FOUND', 'Receipt not found', 404);
    }
  }
  /** Discards a staged receipt only; an attached receipt is never deleted. */
  async discardReceipt(
    auth: AuthenticatedContext,
    id: string,
    requestId: string,
  ): Promise<MutationResult> {
    id = uuid(id);
    this.receiptStore();
    const key = await this.receiptTx(auth, async (c) => {
      const row = (
        await c.query(
          "UPDATE fin_receipts SET state='discarded' WHERE workspace_id=$1 AND owner_user_id=$2 AND id=$3 AND state='staged' RETURNING storage_key",
          [auth.workspace.id, auth.user.id, id],
        )
      ).rows[0] as { storage_key: string } | undefined;
      if (!row) {
        const any = await c.query(
          'SELECT state FROM fin_receipts WHERE workspace_id=$1 AND owner_user_id=$2 AND id=$3',
          [auth.workspace.id, auth.user.id, id],
        );
        if (any.rows[0]?.state === 'attached')
          fail('RECEIPT_ATTACHED', 'Attached receipt cannot be discarded', 409);
        if (!any.rowCount) fail('NOT_FOUND', 'Receipt not found', 404);
        return null; // already discarded: idempotent
      }
      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action: 'FIN_RECEIPT_DISCARDED',
        entityType: 'finance',
        entityId: id,
        requestId,
        metadata: {},
      });
      return row.storage_key;
    });
    // Physical removal happens only after COMMIT and never affects the committed result.
    if (key) await this.reclaimFiles(auth.workspace.id, auth.user.id, [key]);
    return {
      status: 200,
      body: createSuccessEnvelope({ id, state: 'discarded' }, requestId),
    };
  }
  /**
   * Post-COMMIT, re-runnable file removal. Under the Owner ledger lock (the same lock uploads
   * hold while writing) a content-addressed file is deleted only if no non-discarded receipt
   * still references it. Never throws: a failure leaves the file for the next sweep.
   */
  private async reclaimFiles(
    workspaceId: string,
    ownerId: string,
    keys: string[],
  ): Promise<number> {
    let removed = 0;
    let c: PoolClient | undefined;
    let broken = false;
    try {
      const store = this.receiptStore();
      c = await this.pool.connect();
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `fin:${workspaceId}:${ownerId}`,
      ]);
      for (const key of keys) {
        const left = await c.query(
          "SELECT 1 FROM fin_receipts WHERE workspace_id=$1 AND owner_user_id=$2 AND storage_key=$3 AND state<>'discarded' LIMIT 1",
          [workspaceId, ownerId, key],
        );
        if (left.rowCount) continue;
        try {
          await store.delete(key);
          removed++;
        } catch (e) {
          const code = (e as { code?: string }).code ?? 'ERR';
          try {
            this.options.logger?.warn(
              `FIN receipt file removal failed (${code})`,
            );
          } catch {
            /* logging never affects FIN */
          }
        }
      }
      await c.query('COMMIT');
    } catch {
      if (c) {
        try {
          await c.query('ROLLBACK');
        } catch {
          broken = true;
        }
      }
    } finally {
      c?.release(broken || undefined);
    }
    return removed;
  }
  /** Removes files no live receipt references (failed deletes, rolled-back uploads). Bounded. */
  async sweepOrphanReceiptFiles(limit = 5000): Promise<number> {
    const store = this.receiptStore();
    let removed = 0;
    try {
      const byOwner = new Map<string, string[]>();
      for (const key of await store.list(limit)) {
        const [ws, owner] = key.split('/') as [string, string];
        const k = `${ws}/${owner}`;
        (byOwner.get(k) ?? byOwner.set(k, []).get(k)!).push(key);
      }
      for (const [k, keys] of byOwner) {
        const [ws, owner] = k.split('/') as [string, string];
        removed += await this.reclaimFiles(ws, owner, keys);
      }
    } catch {
      /* the next sweep retries */
    }
    return removed;
  }
  /** Expired staged receipts become discarded (DB first), then unreferenced files are removed. */
  async purgeExpiredReceipts(): Promise<number> {
    this.receiptStore();
    const due = (
      await this.pool.query(
        "SELECT id,workspace_id,owner_user_id FROM fin_receipts WHERE state='staged' AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 100",
      )
    ).rows as { id: string; workspace_id: string; owner_user_id: string }[];
    let n = 0;
    for (const r of due) {
      const c = await this.pool.connect();
      let key: string | undefined;
      let broken = false;
      try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `fin:${r.workspace_id}:${r.owner_user_id}`,
        ]);
        const row = (
          await c.query(
            "UPDATE fin_receipts SET state='discarded' WHERE id=$1 AND state='staged' AND expires_at<=clock_timestamp() RETURNING storage_key",
            [r.id],
          )
        ).rows[0] as { storage_key: string } | undefined;
        await c.query('COMMIT');
        key = row?.storage_key;
      } catch {
        try {
          await c.query('ROLLBACK');
        } catch {
          broken = true;
        }
      } finally {
        c.release(broken || undefined);
      }
      if (key) {
        n++;
        await this.reclaimFiles(r.workspace_id, r.owner_user_id, [key]);
      }
    }
    await this.sweepOrphanReceiptFiles();
    return n;
  }
  /**
   * Passed to AI Core as `authorizeOwner`: resolves the CURRENT session and active Owner
   * membership server-side. The body or headers alone are never trusted.
   */
  readonly aiAuthorizer = async (
    context: FinAiContext,
    signal: AbortSignal,
  ): Promise<{ userId: string; workspaceId: string; role: 'owner' } | null> => {
    if (signal.aborted) return null;
    try {
      await this.read(context.auth, async () => undefined);
    } catch {
      return null;
    }
    return {
      userId: context.auth.user.id,
      workspaceId: context.auth.workspace.id,
      role: 'owner',
    };
  };
  /**
   * Owner clicked "Đọc bằng AI". Sends the image only now, holds no DB transaction during the
   * network call, re-checks authorization afterwards and never creates an entry.
   */
  async extractReceipt(
    auth: AuthenticatedContext,
    id: string,
    signal: AbortSignal,
    requestId: string,
  ): Promise<unknown> {
    id = uuid(id);
    const store = this.receiptStore();
    const ai = this.options.ai;
    const loaded = await this.read(auth, async (c) => ({
      row: await this.receiptRow(c, auth, id, ['staged']),
      categories: (
        await c.query<Category>(
          'SELECT id,name,direction FROM fin_categories WHERE workspace_id=$1 AND owner_user_id=$2 AND is_active ORDER BY created_at,id LIMIT 50',
          [auth.workspace.id, auth.user.id],
        )
      ).rows,
    }));
    if (!ai) return { status: 'unavailable', reason: 'AI_NOT_CONFIGURED' };
    if (!aiEligible(loaded.row.mime_type, loaded.row.size_bytes))
      return fail('VALIDATION_ERROR', 'Receipt not eligible for AI', 422);
    const bytes = await store
      .get(loaded.row.storage_key)
      .catch(() => fail('NOT_FOUND', 'Receipt not found', 404));
    if (
      crypto.createHash('sha256').update(bytes).digest('hex') !==
      loaded.row.sha256
    )
      return fail('NOT_FOUND', 'Receipt not found', 404);
    const categories = loaded.categories.map((x) => ({
      id: x.id,
      name: x.name,
      direction: x.direction,
    }));
    let outcome = 'ok';
    let result: { draft: unknown } | null = null;
    try {
      result = await ai.extractReceipt(
        { auth },
        {
          image: { mimeType: loaded.row.mime_type, bytes },
          context: { categories },
        },
        signal,
      );
    } catch (e) {
      const code = (e as { name?: string; code?: unknown }).code;
      if (
        (e as { name?: string }).name !== 'AiCoreError' ||
        typeof code !== 'string'
      )
        outcome = 'AI_PROVIDER_UNAVAILABLE';
      else outcome = code;
      if (outcome === 'AI_CANCELLED')
        return fail('CANCELLED', 'Request cancelled', 499);
      if (outcome === 'AI_UNAUTHORIZED')
        return fail('FORBIDDEN', 'Owner permission required', 403);
      if (outcome === 'AI_INVALID_INPUT')
        return fail('VALIDATION_ERROR', 'Receipt not eligible for AI', 422);
      if (outcome === 'AI_RATE_LIMITED' || outcome === 'AI_BUSY')
        return fail('AI_RATE_LIMITED', 'AI is busy; try again later', 429);
    }
    // Authorization may have changed during the network call; audit without PII.
    await this.receiptTx(auth, async (c) => {
      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action: 'FIN_RECEIPT_AI_READ',
        entityType: 'finance',
        entityId: id,
        requestId,
        metadata: { outcome },
      });
    });
    if (!result) return { status: 'unavailable', reason: outcome };
    return {
      status: 'ok',
      data: mapReceiptDraft(result.draft, categories, this.now()),
    };
  }
  async summary(
    auth: AuthenticatedContext,
    q: URLSearchParams,
  ): Promise<unknown> {
    parameters(q, ['period', 'anchor']);
    const period = q.get('period'),
      anchor = date(q.get('anchor') ?? '');
    if (!['day', 'week', 'month', 'year'].includes(period ?? ''))
      fail('VALIDATION_ERROR', 'Invalid period', 400);
    const a = new Date(`${anchor}T00:00:00Z`),
      start = new Date(a),
      end = new Date(a);
    if (period === 'week') {
      start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
      end.setTime(start.getTime());
      end.setUTCDate(end.getUTCDate() + 6);
    }
    if (period === 'month') {
      start.setUTCDate(1);
      end.setUTCMonth(end.getUTCMonth() + 1, 0);
    }
    if (period === 'year') {
      start.setUTCMonth(0, 1);
      end.setUTCMonth(11, 31);
    }
    const from = date(start.toISOString().slice(0, 10)),
      to = date(end.toISOString().slice(0, 10));
    return this.read(auth, async (c) => {
      const rows = (
        await c.query<{
          category_id: string;
          category_name: string;
          direction: string;
          total_vnd: string;
        }>(
          `SELECT e.category_id,c.name AS category_name,e.direction,sum(e.amount_vnd)::text AS total_vnd FROM fin_entries e JOIN fin_categories c ON c.workspace_id=e.workspace_id AND c.owner_user_id=e.owner_user_id AND c.id=e.category_id WHERE e.workspace_id=$1 AND e.owner_user_id=$2 AND e.occurred_on BETWEEN $3::date AND $4::date AND ${effective} GROUP BY e.category_id,c.name,e.direction ORDER BY e.category_id`,
          [auth.workspace.id, auth.user.id, from, to],
        )
      ).rows;
      let income = 0n,
        expense = 0n;
      for (const r of rows) {
        if (r.direction === 'income') income += BigInt(r.total_vnd);
        else expense += BigInt(r.total_vnd);
      }
      return {
        period,
        from,
        to,
        total_income_vnd: income.toString(),
        total_expense_vnd: expense.toString(),
        net_vnd: (income - expense).toString(),
        categories: rows,
      };
    });
  }
}
