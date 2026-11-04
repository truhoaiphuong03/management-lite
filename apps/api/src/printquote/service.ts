import type pg from 'pg';
import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import {
  claimIdempotency,
  completeIdempotency,
  computeRequestFingerprint,
  failIdempotency,
} from '../../../../packages/database/src/idempotency.js';
import {
  ProfitMode,
  ProfitScope,
  VendorCostMode,
  PriceItemType,
  QuotePricingStatus,
  LineCostSource,
  AreaInputMode,
  ShippingAllocationStrategy,
  RoundingMode,
  QuoteOrderStatus,
  PrintProductionStatus,
  PrintDeliveryStatus,
  PrintPaymentStatus,
  OrderCostReconciliationStatus,
  calculatePrintQuote,
  createQuoteOrderSnapshot,
  createPendingCostQuoteSnapshot,
  buildCustomerSafePdfPayload,
  assertCustomerSafePdfPayload,
  verifyQuoteSnapshotIntegrity,
  buildQuoteLineFromVendorCatalogItem,
  evaluateCatalogBatchQuantityCondition,
  type ProfitModeType,
  type ProfitScopeType,
  type VendorCostModeType,
  type PriceItemTypeValue,
  type QuotePricingStatusType,
  type LineCostSourceType,
  type ShippingAllocationStrategyType,
  type RoundingModeType,
  type QuoteOrderStatusType,
  type PrintProductionStatusType,
  type PrintDeliveryStatusType,
  type PrintPaymentStatusType,
  type QuoteAreaSpecInput,
  type QuoteFinishingStageInput,
  type QuoteLineInput,
  type PendingCostDraftLineInput,
  type PendingCostDraftStageSnapshot,
  type PendingCostLineSummary,
  type PrintVendorData,
  type PrintVendorPriceItemData,
  type PrintVendorPriceItemHistoryData,
  type PrintCustomerData,
  type PrintQuoteData,
  type PrintQuoteVersionData,
  type PrintOrderData,
  type PrintOrderPaymentData,
  type PrintOrderCostHistoryData,
  type OrderCostReconciliationStatusType,
  type OrderCostHistoryActionType,
  type PrintQuoteDashboardStats,
  type CustomerSafePdfPayload,
  type PersistedQuoteOrderSnapshot,
  type PersistedQuoteLineSnapshot,
} from '../../../../packages/contracts/src/printquote.js';
import { AuthError, type AuthenticatedContext } from '../auth/service.js';

function toInt(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val);
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return fallback;
}

function toNum(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toIso(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function toDateStr(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    const year = val.getFullYear();
    const month = String(val.getMonth() + 1).padStart(2, '0');
    const day = String(val.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  }
  return null;
}

function normalizeStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of val) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function normalizeJsonObject(val: unknown): Record<string, unknown> | null {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  return null;
}

function parseVendorCostMode(
  val: unknown,
  fallback: VendorCostModeType = VendorCostMode.PER_UNIT,
): VendorCostModeType {
  if (val === VendorCostMode.TOTAL_BATCH) return VendorCostMode.TOTAL_BATCH;
  if (val === VendorCostMode.PER_SQM) return VendorCostMode.PER_SQM;
  if (val === VendorCostMode.PER_UNIT) return VendorCostMode.PER_UNIT;
  return fallback;
}

function parseProfitScope(
  val: unknown,
  fallback: ProfitScopeType = ProfitScope.PER_UNIT,
): ProfitScopeType {
  if (val === ProfitScope.TOTAL_BATCH) return ProfitScope.TOTAL_BATCH;
  if (val === ProfitScope.PER_SQM) return ProfitScope.PER_SQM;
  if (val === ProfitScope.PER_UNIT) return ProfitScope.PER_UNIT;
  return fallback;
}

/**
 * Distinguishes:
 * - 'OMITTED': field not sent (`undefined`) -> caller may fallback to catalog
 * - null: explicitly empty/missing (`null` or `""`) -> "Chờ giá xưởng" (`PENDING_COST`)
 * - number (>= 0): explicit non-negative rate, including intentional `0` (`0` or `"0"`)
 */
function parseExplicitOrPendingRate(
  val: unknown,
  label: string,
): number | null | 'OMITTED' {
  if (val === undefined) return 'OMITTED';
  if (val === null) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new AuthError(
        'VALIDATION_ERROR',
        `${label} không hợp lệ hoặc bị âm.`,
        400,
      );
    }
    return parsed;
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val < 0) {
      throw new AuthError(
        'VALIDATION_ERROR',
        `${label} không hợp lệ hoặc bị âm.`,
        400,
      );
    }
    return val;
  }
  throw new AuthError('VALIDATION_ERROR', `${label} không hợp lệ.`, 400);
}

function parseAreaSpecInput(rawArea: unknown): QuoteAreaSpecInput | null {
  if (!rawArea || typeof rawArea !== 'object' || Array.isArray(rawArea)) {
    return null;
  }
  const obj = rawArea as Record<string, unknown>;
  const mode =
    obj['mode'] === AreaInputMode.DIRECT_AREA
      ? AreaInputMode.DIRECT_AREA
      : obj['mode'] === AreaInputMode.DIMENSIONS
        ? AreaInputMode.DIMENSIONS
        : null;
  if (!mode) return null;

  const billableRaw = obj['billableAreaSqm'] ?? obj['billable_area_sqm'];
  const billableAreaSqm =
    billableRaw !== undefined && billableRaw !== null && billableRaw !== ''
      ? toNum(billableRaw, -1)
      : undefined;
  const reasonRaw = obj['adjustmentReason'] ?? obj['adjustment_reason'];
  const adjustmentReason =
    typeof reasonRaw === 'string' && reasonRaw.trim()
      ? reasonRaw.trim()
      : undefined;

  if (mode === AreaInputMode.DIRECT_AREA) {
    const actualRaw = obj['actualAreaSqm'] ?? obj['actual_area_sqm'];
    return {
      mode: AreaInputMode.DIRECT_AREA,
      actualAreaSqm: toNum(actualRaw, -1),
      ...(billableAreaSqm !== undefined ? { billableAreaSqm } : {}),
      ...(adjustmentReason !== undefined ? { adjustmentReason } : {}),
    };
  }

  const widthM = toNum(obj['widthM'] ?? obj['width_m'], -1);
  const heightM = toNum(obj['heightM'] ?? obj['height_m'], -1);
  const sheetsRaw = obj['sheetsCount'] ?? obj['sheets_count'];
  const sheetsCount =
    sheetsRaw !== undefined && sheetsRaw !== null && sheetsRaw !== ''
      ? toInt(sheetsRaw, -1)
      : undefined;

  return {
    mode: AreaInputMode.DIMENSIONS,
    widthM,
    heightM,
    ...(sheetsCount !== undefined ? { sheetsCount } : {}),
    ...(billableAreaSqm !== undefined ? { billableAreaSqm } : {}),
    ...(adjustmentReason !== undefined ? { adjustmentReason } : {}),
  };
}

type StoredQuoteLineJson = PersistedQuoteLineSnapshot & {
  vendorCostMode?: VendorCostModeType | undefined;
};

type ResolvedQuoteLinesOutcome =
  | {
      pricingStatus: 'COMPLETE';
      lines: QuoteLineInput[];
      costModes: Array<VendorCostModeType | undefined>;
    }
  | {
      pricingStatus: 'PENDING_COST';
      draftLines: PendingCostDraftLineInput[];
    };

export class PrintQuoteService {
  constructor(private readonly pool: DatabasePool) {}

  private assertOwnerAccess(ctx: AuthenticatedContext): void {
    if (ctx.workspace.role !== 'owner') {
      throw new AuthError(
        'FORBIDDEN',
        'Chỉ Chủ sở hữu (Owner) mới có quyền truy cập chức năng Báo giá in ấn và dữ liệu giá vốn/lợi nhuận.',
        403,
      );
    }
  }

  /**
   * Cấp mã báo giá (`BG-YYYYMM-NNN`) hoặc mã đơn hàng (`DH-YYYYMM-NNN`) tuần tự,
   * nguyên tử (atomic) trên PostgreSQL bằng bảng `print_code_counters` (`INSERT ... ON CONFLICT DO UPDATE`).
   * Tuyệt đối KHÔNG dùng `COUNT(*) + 1` để tránh trùng mã khi nhiều request đồng thời
   * và không bao giờ tái sử dụng mã cũ khi có bản ghi bị xóa.
   */
  private async allocateNextCode(
    client: pg.PoolClient,
    workspaceId: string,
    kind: 'QUOTE' | 'ORDER',
    explicitCode?: unknown,
  ): Promise<string> {
    const tableName = kind === 'QUOTE' ? 'print_quotes' : 'print_orders';
    const codeColumn = kind === 'QUOTE' ? 'quote_code' : 'order_code';

    if (typeof explicitCode === 'string' && explicitCode.trim()) {
      const normalized = explicitCode.trim().toUpperCase();
      const dupRes = await client.query(
        `SELECT 1 FROM ${tableName} WHERE workspace_id = $1 AND ${codeColumn} = $2 LIMIT 1`,
        [workspaceId, normalized],
      );
      if (dupRes.rows.length > 0) {
        throw new AuthError(
          'CONFLICT',
          `Mã ${kind === 'QUOTE' ? 'báo giá' : 'đơn hàng'} "${normalized}" đã tồn tại.`,
          409,
        );
      }
      return normalized;
    }

    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = kind === 'QUOTE' ? 'BG' : 'DH';
    const counterKey = `${kind}:${ym}`;

    for (let attempt = 0; attempt < 1000; attempt++) {
      const counterRes = await client.query<{ last_value: string }>(
        `INSERT INTO print_code_counters (workspace_id, counter_key, last_value, updated_at)
         VALUES ($1, $2, 1, now())
         ON CONFLICT (workspace_id, counter_key)
         DO UPDATE SET
           last_value = print_code_counters.last_value + 1,
           updated_at = now()
         RETURNING last_value::text AS last_value`,
        [workspaceId, counterKey],
      );
      const seq = Number(counterRes.rows[0]?.last_value ?? 1);
      const candidate = `${prefix}-${ym}-${String(seq).padStart(3, '0')}`;

      const existsRes = await client.query(
        `SELECT 1 FROM ${tableName} WHERE workspace_id = $1 AND ${codeColumn} = $2 LIMIT 1`,
        [workspaceId, candidate],
      );
      if (existsRes.rows.length === 0) {
        return candidate;
      }
    }

    throw new AuthError(
      'INTERNAL_ERROR',
      'Không thể cấp mã tự động sau nhiều lần thử.',
      500,
    );
  }

  private async withIdempotentTransaction<T>(
    ctx: AuthenticatedContext,
    method: string,
    route: string,
    bodyForFingerprint: unknown,
    idempotencyKey: string | undefined,
    responseCode: number,
    work: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    const trimmedKey = idempotencyKey?.trim();
    try {
      await client.query('BEGIN');
      if (trimmedKey) {
        const fingerprint = computeRequestFingerprint(
          method,
          route,
          bodyForFingerprint,
        );
        const claim = await claimIdempotency(client, {
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.user.id,
          operationKey: trimmedKey,
          requestFingerprint: fingerprint,
        });
        if (claim.status === 'replay') {
          await client.query('COMMIT');
          return claim.sanitizedResponse as T;
        }
        if (claim.status === 'mismatch') {
          await client.query('ROLLBACK');
          throw new AuthError('IDEMPOTENCY_CONFLICT', claim.error, 409);
        }
        if (claim.status === 'in_progress') {
          await client.query('ROLLBACK');
          throw new AuthError('IDEMPOTENCY_IN_PROGRESS', claim.error, 409);
        }
      }

      const result = await work(client);

      if (trimmedKey) {
        await completeIdempotency(client, {
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.user.id,
          operationKey: trimmedKey,
          responseCode,
          sanitizedResponse: result,
        });
      }

      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      if (
        trimmedKey &&
        !(
          err instanceof AuthError &&
          (err.code === 'IDEMPOTENCY_CONFLICT' ||
            err.code === 'IDEMPOTENCY_IN_PROGRESS')
        )
      ) {
        try {
          await failIdempotency(this.pool, {
            workspaceId: ctx.workspace.id,
            actorUserId: ctx.user.id,
            operationKey: trimmedKey,
          });
        } catch {
          // ignore
        }
      }
      throw err;
    } finally {
      client.release();
    }
  }

  // ==========================================================================
  // 1. VENDORS (NHÀ IN)
  // ==========================================================================

  async listVendors(ctx: AuthenticatedContext): Promise<PrintVendorData[]> {
    this.assertOwnerAccess(ctx);
    const res = await this.pool.query(
      `SELECT * FROM print_vendors WHERE workspace_id = $1 ORDER BY is_active DESC, name ASC, created_at DESC`,
      [ctx.workspace.id],
    );
    return res.rows.map((r) => this.mapVendorRow(r));
  }

  async createVendor(
    ctx: AuthenticatedContext,
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<PrintVendorData> {
    this.assertOwnerAccess(ctx);
    const name = typeof input['name'] === 'string' ? input['name'].trim() : '';
    if (!name) {
      throw new AuthError('VALIDATION_ERROR', 'Tên nhà in là bắt buộc.', 400);
    }

    return this.withIdempotentTransaction(
      ctx,
      'POST',
      '/api/v1/print-quotes/vendors',
      input,
      idempotencyKey,
      201,
      async (client) => {
        let code =
          typeof input['code'] === 'string'
            ? input['code'].trim().toUpperCase()
            : '';
        if (!code) {
          const countRes = await client.query<{ cnt: string }>(
            `SELECT COUNT(*)::text AS cnt FROM print_vendors WHERE workspace_id = $1`,
            [ctx.workspace.id],
          );
          const nextNum = Number(countRes.rows[0]?.cnt ?? 0) + 1;
          code = `NI${String(nextNum).padStart(3, '0')}`;
        }

        const res = await client.query(
          `INSERT INTO print_vendors (
            workspace_id, code, name, phone, address, bank_name, bank_account_number, bank_account_holder, note, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *`,
          [
            ctx.workspace.id,
            code,
            name,
            typeof input['phone'] === 'string'
              ? input['phone'].trim() || null
              : null,
            typeof input['address'] === 'string'
              ? input['address'].trim() || null
              : null,
            typeof input['bank_name'] === 'string'
              ? input['bank_name'].trim() || null
              : null,
            typeof input['bank_account_number'] === 'string'
              ? input['bank_account_number'].trim() || null
              : null,
            typeof input['bank_account_holder'] === 'string'
              ? input['bank_account_holder'].trim() || null
              : null,
            typeof input['note'] === 'string'
              ? input['note'].trim() || null
              : null,
            input['is_active'] === undefined
              ? true
              : Boolean(input['is_active']),
          ],
        );
        return this.mapVendorRow(res.rows[0]);
      },
    );
  }

  async updateVendor(
    ctx: AuthenticatedContext,
    vendorId: string,
    input: Record<string, unknown>,
  ): Promise<PrintVendorData> {
    this.assertOwnerAccess(ctx);
    const existingRes = await this.pool.query(
      `SELECT * FROM print_vendors WHERE id = $1 AND workspace_id = $2`,
      [vendorId, ctx.workspace.id],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AuthError('NOT_FOUND', 'Không tìm thấy nhà in.', 404);
    }

    const name =
      typeof input['name'] === 'string'
        ? input['name'].trim()
        : String(existing['name']);
    if (!name) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Tên nhà in không được để trống.',
        400,
      );
    }

    const res = await this.pool.query(
      `UPDATE print_vendors
       SET name = $1,
           phone = $2,
           address = $3,
           bank_name = $4,
           bank_account_number = $5,
           bank_account_holder = $6,
           note = $7,
           is_active = $8,
           updated_at = now()
       WHERE id = $9 AND workspace_id = $10
       RETURNING *`,
      [
        name,
        input['phone'] !== undefined
          ? typeof input['phone'] === 'string'
            ? input['phone'].trim() || null
            : null
          : existing['phone'],
        input['address'] !== undefined
          ? typeof input['address'] === 'string'
            ? input['address'].trim() || null
            : null
          : existing['address'],
        input['bank_name'] !== undefined
          ? typeof input['bank_name'] === 'string'
            ? input['bank_name'].trim() || null
            : null
          : existing['bank_name'],
        input['bank_account_number'] !== undefined
          ? typeof input['bank_account_number'] === 'string'
            ? input['bank_account_number'].trim() || null
            : null
          : existing['bank_account_number'],
        input['bank_account_holder'] !== undefined
          ? typeof input['bank_account_holder'] === 'string'
            ? input['bank_account_holder'].trim() || null
            : null
          : existing['bank_account_holder'],
        input['note'] !== undefined
          ? typeof input['note'] === 'string'
            ? input['note'].trim() || null
            : null
          : existing['note'],
        input['is_active'] !== undefined
          ? Boolean(input['is_active'])
          : Boolean(existing['is_active']),
        vendorId,
        ctx.workspace.id,
      ],
    );
    return this.mapVendorRow(res.rows[0]);
  }

  private mapVendorRow(r: Record<string, unknown>): PrintVendorData {
    return {
      id: String(r['id']),
      workspace_id: String(r['workspace_id']),
      code: String(r['code']),
      name: String(r['name']),
      phone: r['phone'] ? String(r['phone']) : null,
      address: r['address'] ? String(r['address']) : null,
      bank_name: r['bank_name'] ? String(r['bank_name']) : null,
      bank_account_number: r['bank_account_number']
        ? String(r['bank_account_number'])
        : null,
      bank_account_holder: r['bank_account_holder']
        ? String(r['bank_account_holder'])
        : null,
      note: r['note'] ? String(r['note']) : null,
      is_active: Boolean(r['is_active']),
      created_at: toIso(r['created_at']),
      updated_at: toIso(r['updated_at']),
    };
  }

  // ==========================================================================
  // 2. WORKSHOP & VENDOR PRICE CATALOG (BẢNG GIÁ XƯỞNG: CƠ BẢN & GIA CÔNG)
  // ==========================================================================

  private async collectUsedPriceItemIds(
    queryable: {
      query: (
        text: string,
        values?: unknown[],
      ) => Promise<{ rows: Record<string, unknown>[] }>;
    },
    workspaceId: string,
  ): Promise<Set<string>> {
    const res = await queryable.query(
      `SELECT DISTINCT ref_id FROM (
         SELECT elem->>'vendorPriceItemId' AS ref_id
         FROM print_quotes q,
              LATERAL jsonb_array_elements(COALESCE(q.lines_json, '[]'::jsonb)) AS elem
         WHERE q.workspace_id = $1
         UNION
         SELECT stg->>'priceItemId' AS ref_id
         FROM print_quotes q,
              LATERAL jsonb_array_elements(COALESCE(q.lines_json, '[]'::jsonb)) AS elem,
              LATERAL jsonb_array_elements(COALESCE(elem->'finishingStages', '[]'::jsonb)) AS stg
         WHERE q.workspace_id = $1
         UNION
         SELECT elem->>'vendorPriceItemId' AS ref_id
         FROM print_quote_versions v,
              LATERAL jsonb_array_elements(COALESCE(v.snapshot_json->'lines', '[]'::jsonb)) AS elem
         WHERE v.workspace_id = $1
         UNION
         SELECT stg->>'priceItemId' AS ref_id
         FROM print_quote_versions v,
              LATERAL jsonb_array_elements(COALESCE(v.snapshot_json->'lines', '[]'::jsonb)) AS elem,
              LATERAL jsonb_array_elements(COALESCE(elem->'finishingStages', '[]'::jsonb)) AS stg
         WHERE v.workspace_id = $1
       ) refs
       WHERE ref_id IS NOT NULL AND ref_id <> ''`,
      [workspaceId],
    );
    const used = new Set<string>();
    for (const r of res.rows) {
      if (typeof r['ref_id'] === 'string' && r['ref_id']) {
        used.add(r['ref_id']);
      }
    }
    return used;
  }

  private async recordPriceItemHistory(
    client: pg.PoolClient,
    params: {
      workspaceId: string;
      priceItemId: string;
      version: number;
      action: 'CREATED' | 'UPDATED' | 'DEACTIVATED' | 'RESTORED';
      beforeJson: PrintVendorPriceItemData | null;
      afterJson: PrintVendorPriceItemData;
      changeNote: string | null;
      changedBy: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO print_vendor_price_item_history (
         workspace_id, price_item_id, version, action,
         before_json, after_json, change_note, changed_by
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
      [
        params.workspaceId,
        params.priceItemId,
        params.version,
        params.action,
        params.beforeJson ? JSON.stringify(params.beforeJson) : null,
        JSON.stringify(params.afterJson),
        params.changeNote,
        params.changedBy,
      ],
    );
  }

  async listPriceItems(
    ctx: AuthenticatedContext,
    vendorIdOrFilter?:
      | string
      | null
      | {
          vendorId?: string | null | undefined;
          itemType?: string | null | undefined;
          includeInactive?: boolean | undefined;
        },
  ): Promise<PrintVendorPriceItemData[]> {
    this.assertOwnerAccess(ctx);
    const filterObj =
      typeof vendorIdOrFilter === 'object' && vendorIdOrFilter !== null
        ? vendorIdOrFilter
        : { vendorId: vendorIdOrFilter };

    const params: unknown[] = [ctx.workspace.id];
    let whereSql = `p.workspace_id = $1`;
    if (filterObj.vendorId) {
      params.push(filterObj.vendorId);
      whereSql += ` AND p.vendor_id = $${params.length}`;
    }
    if (
      filterObj.itemType === PriceItemType.BASE_PRINT ||
      filterObj.itemType === PriceItemType.FINISHING
    ) {
      params.push(filterObj.itemType);
      whereSql += ` AND p.item_type = $${params.length}`;
    }
    if (filterObj.includeInactive === false) {
      whereSql += ` AND p.is_active = true`;
    }

    const [res, usedIds] = await Promise.all([
      this.pool.query(
        `SELECT p.*, v.name AS vendor_name
         FROM print_vendor_price_items p
         LEFT JOIN print_vendors v ON v.id = p.vendor_id
         WHERE ${whereSql}
         ORDER BY p.is_active DESC, p.item_type ASC, COALESCE(v.name, '') ASC, p.name ASC`,
        params,
      ),
      this.collectUsedPriceItemIds(this.pool, ctx.workspace.id),
    ]);

    return res.rows.map((r) => {
      const mapped = this.mapPriceItemRow(r);
      mapped.is_used_in_quotes = usedIds.has(mapped.id);
      return mapped;
    });
  }

  async createPriceItem(
    ctx: AuthenticatedContext,
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<PrintVendorPriceItemData> {
    this.assertOwnerAccess(ctx);
    const vendorIdRaw =
      typeof input['vendor_id'] === 'string' ? input['vendor_id'].trim() : '';
    const vendorId = vendorIdRaw ? vendorIdRaw : null;
    const name = typeof input['name'] === 'string' ? input['name'].trim() : '';
    if (!name) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Tên mục giá xưởng (name) là bắt buộc.',
        400,
      );
    }

    const rawItemType = input['item_type'] ?? input['itemType'];
    if (
      rawItemType !== undefined &&
      rawItemType !== PriceItemType.BASE_PRINT &&
      rawItemType !== PriceItemType.FINISHING
    ) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Phân loại mục giá (item_type) phải là BASE_PRINT hoặc FINISHING.',
        400,
      );
    }
    const itemType: PriceItemTypeValue =
      rawItemType === PriceItemType.FINISHING
        ? PriceItemType.FINISHING
        : PriceItemType.BASE_PRINT;

    const pricingMode = parseVendorCostMode(
      input['pricing_mode'],
      VendorCostMode.PER_UNIT,
    );
    const unitCost = toInt(input['unit_cost'], 0);
    const batchQuantity = Math.max(1, toInt(input['batch_quantity'], 1));
    const batchTotalCost = toInt(
      input['batch_total_cost'],
      pricingMode === VendorCostMode.TOTAL_BATCH
        ? unitCost
        : unitCost * batchQuantity,
    );
    const defaultProfitMode: ProfitModeType =
      input['default_profit_mode'] === ProfitMode.PERCENTAGE
        ? ProfitMode.PERCENTAGE
        : ProfitMode.FIXED_AMOUNT;
    const defaultProfitScope = parseProfitScope(
      input['default_profit_scope'],
      pricingMode === VendorCostMode.PER_SQM
        ? ProfitScope.PER_SQM
        : pricingMode === VendorCostMode.TOTAL_BATCH
          ? ProfitScope.TOTAL_BATCH
          : ProfitScope.PER_UNIT,
    );
    const defaultProfitValue = Math.max(
      0,
      toNum(input['default_profit_value'], 0),
    );

    if (unitCost < 0 || batchTotalCost < 0) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Giá vốn xưởng không được âm.',
        400,
      );
    }

    const includedStages =
      itemType === PriceItemType.BASE_PRINT
        ? normalizeStringArray(
            input['included_stages'] ?? input['includedStages'],
          )
        : [];
    const structuredSpec = normalizeJsonObject(
      input['structured_spec'] ?? input['structuredSpec'],
    );
    const conditionsNote =
      typeof input['conditions_note'] === 'string'
        ? input['conditions_note'].trim() || null
        : typeof input['conditionsNote'] === 'string'
          ? input['conditionsNote'].trim() || null
          : null;
    const defaultUnit =
      pricingMode === VendorCostMode.PER_SQM
        ? 'm²'
        : pricingMode === VendorCostMode.TOTAL_BATCH
          ? 'lô'
          : 'tờ';

    return this.withIdempotentTransaction(
      ctx,
      'POST',
      '/api/v1/print-quotes/price-items',
      input,
      idempotencyKey,
      201,
      async (client) => {
        let vendorName: string | null = null;
        if (vendorId) {
          const vRes = await client.query<{ name: string }>(
            `SELECT name FROM print_vendors WHERE id = $1 AND workspace_id = $2`,
            [vendorId, ctx.workspace.id],
          );
          if (vRes.rows.length === 0) {
            throw new AuthError(
              'NOT_FOUND',
              'Không tìm thấy nhà in thuộc workspace.',
              404,
            );
          }
          vendorName = vRes.rows[0]!.name;
        }

        let code =
          typeof input['code'] === 'string'
            ? input['code'].trim().toUpperCase()
            : '';
        if (!code) {
          const prefix =
            itemType === PriceItemType.FINISHING
              ? 'GC'
              : vendorId
                ? 'BG'
                : 'GX';
          const countRes = await client.query<{ cnt: string }>(
            `SELECT COUNT(*)::text AS cnt FROM print_vendor_price_items WHERE workspace_id = $1`,
            [ctx.workspace.id],
          );
          let seq = Number(countRes.rows[0]?.cnt ?? 0) + 1;
          for (let attempt = 0; attempt < 500; attempt++) {
            const candidate = `${prefix}-${String(seq).padStart(3, '0')}`;
            const dupRes = await client.query(
              `SELECT 1 FROM print_vendor_price_items
               WHERE workspace_id = $1
                 AND COALESCE(vendor_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
                 AND code = $3
               LIMIT 1`,
              [ctx.workspace.id, vendorId, candidate],
            );
            if (dupRes.rows.length === 0) {
              code = candidate;
              break;
            }
            seq++;
          }
          if (!code) {
            code = `${prefix}-${Date.now().toString(36).toUpperCase()}`;
          }
        }

        const res = await client.query(
          `INSERT INTO print_vendor_price_items (
            workspace_id, vendor_id, code, name, item_type, category, specification,
            included_stages, structured_spec, conditions_note, unit,
            pricing_mode, unit_cost, batch_quantity, batch_total_cost,
            default_profit_mode, default_profit_scope, default_profit_value,
            note, is_active, updated_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8::jsonb, $9::jsonb, $10, $11,
            $12, $13, $14, $15,
            $16, $17, $18,
            $19, $20, $21
          )
          RETURNING *`,
          [
            ctx.workspace.id,
            vendorId,
            code,
            name,
            itemType,
            typeof input['category'] === 'string'
              ? input['category'].trim() || null
              : null,
            typeof input['specification'] === 'string'
              ? input['specification'].trim() || null
              : null,
            JSON.stringify(includedStages),
            structuredSpec ? JSON.stringify(structuredSpec) : null,
            conditionsNote,
            typeof input['unit'] === 'string' && input['unit'].trim()
              ? input['unit'].trim()
              : defaultUnit,
            pricingMode,
            unitCost,
            batchQuantity,
            batchTotalCost,
            defaultProfitMode,
            defaultProfitScope,
            defaultProfitValue,
            typeof input['note'] === 'string'
              ? input['note'].trim() || null
              : null,
            input['is_active'] === undefined
              ? true
              : Boolean(input['is_active']),
            ctx.user.id,
          ],
        );

        const created = this.mapPriceItemRow({
          ...res.rows[0],
          vendor_name: vendorName,
        });
        created.is_used_in_quotes = false;

        await this.recordPriceItemHistory(client, {
          workspaceId: ctx.workspace.id,
          priceItemId: created.id,
          version: created.version,
          action: 'CREATED',
          beforeJson: null,
          afterJson: created,
          changeNote:
            typeof input['change_note'] === 'string' &&
            input['change_note'].trim()
              ? input['change_note'].trim()
              : 'Tạo mục giá xưởng mới',
          changedBy: ctx.user.id,
        });

        return created;
      },
    );
  }

  async updatePriceItem(
    ctx: AuthenticatedContext,
    priceItemId: string,
    input: Record<string, unknown>,
  ): Promise<PrintVendorPriceItemData> {
    this.assertOwnerAccess(ctx);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existingRes = await client.query(
        `SELECT p.*, v.name AS vendor_name
         FROM print_vendor_price_items p
         LEFT JOIN print_vendors v ON v.id = p.vendor_id
         WHERE p.id = $1 AND p.workspace_id = $2
         FOR UPDATE OF p`,
        [priceItemId, ctx.workspace.id],
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        throw new AuthError(
          'NOT_FOUND',
          'Không tìm thấy hạng mục bảng giá xưởng.',
          404,
        );
      }

      const beforeMapped = this.mapPriceItemRow(existing);

      let nextVendorId: string | null = beforeMapped.vendor_id;
      let nextVendorName: string | null = beforeMapped.vendor_name;
      if (input['vendor_id'] !== undefined) {
        const trimmedVid =
          typeof input['vendor_id'] === 'string'
            ? input['vendor_id'].trim()
            : '';
        if (trimmedVid) {
          const vRes = await client.query<{ name: string }>(
            `SELECT name FROM print_vendors WHERE id = $1 AND workspace_id = $2`,
            [trimmedVid, ctx.workspace.id],
          );
          if (vRes.rows.length === 0) {
            throw new AuthError(
              'NOT_FOUND',
              'Không tìm thấy nhà in thuộc workspace.',
              404,
            );
          }
          nextVendorId = trimmedVid;
          nextVendorName = vRes.rows[0]!.name;
        } else {
          nextVendorId = null;
          nextVendorName = null;
        }
      }

      const name =
        typeof input['name'] === 'string'
          ? input['name'].trim()
          : beforeMapped.name;
      if (!name) {
        throw new AuthError(
          'VALIDATION_ERROR',
          'Tên mục giá xưởng không được để trống.',
          400,
        );
      }

      const rawItemType = input['item_type'] ?? input['itemType'];
      const itemType: PriceItemTypeValue =
        rawItemType !== undefined
          ? rawItemType === PriceItemType.FINISHING
            ? PriceItemType.FINISHING
            : PriceItemType.BASE_PRINT
          : beforeMapped.item_type;

      const pricingMode =
        input['pricing_mode'] !== undefined
          ? parseVendorCostMode(
              input['pricing_mode'],
              beforeMapped.pricing_mode,
            )
          : beforeMapped.pricing_mode;
      const unitCost =
        input['unit_cost'] !== undefined
          ? toInt(input['unit_cost'], 0)
          : beforeMapped.unit_cost;
      const batchQuantity =
        input['batch_quantity'] !== undefined
          ? Math.max(1, toInt(input['batch_quantity'], 1))
          : beforeMapped.batch_quantity;
      const batchTotalCost =
        input['batch_total_cost'] !== undefined
          ? toInt(input['batch_total_cost'], 0)
          : beforeMapped.batch_total_cost;
      const defaultProfitMode: ProfitModeType =
        input['default_profit_mode'] !== undefined
          ? input['default_profit_mode'] === ProfitMode.PERCENTAGE
            ? ProfitMode.PERCENTAGE
            : ProfitMode.FIXED_AMOUNT
          : beforeMapped.default_profit_mode;
      const defaultProfitScope =
        input['default_profit_scope'] !== undefined
          ? parseProfitScope(
              input['default_profit_scope'],
              beforeMapped.default_profit_scope,
            )
          : beforeMapped.default_profit_scope;
      const defaultProfitValue =
        input['default_profit_value'] !== undefined
          ? Math.max(0, toNum(input['default_profit_value'], 0))
          : beforeMapped.default_profit_value;

      if (unitCost < 0 || batchTotalCost < 0) {
        throw new AuthError(
          'VALIDATION_ERROR',
          'Giá vốn xưởng không được âm.',
          400,
        );
      }

      const rawIncluded = input['included_stages'] ?? input['includedStages'];
      const includedStages =
        itemType === PriceItemType.FINISHING
          ? []
          : rawIncluded !== undefined
            ? normalizeStringArray(rawIncluded)
            : beforeMapped.included_stages;

      const rawStructured = input['structured_spec'] ?? input['structuredSpec'];
      const structuredSpec =
        rawStructured !== undefined
          ? normalizeJsonObject(rawStructured)
          : beforeMapped.structured_spec;

      const rawCond = input['conditions_note'] ?? input['conditionsNote'];
      const conditionsNote =
        rawCond !== undefined
          ? typeof rawCond === 'string'
            ? rawCond.trim() || null
            : null
          : beforeMapped.conditions_note;

      const nextIsActive =
        input['is_active'] !== undefined
          ? Boolean(input['is_active'])
          : beforeMapped.is_active;

      const res = await client.query(
        `UPDATE print_vendor_price_items
         SET vendor_id = $1,
             name = $2,
             item_type = $3,
             category = $4,
             specification = $5,
             included_stages = $6::jsonb,
             structured_spec = $7::jsonb,
             conditions_note = $8,
             unit = $9,
             pricing_mode = $10,
             unit_cost = $11,
             batch_quantity = $12,
             batch_total_cost = $13,
             default_profit_mode = $14,
             default_profit_scope = $15,
             default_profit_value = $16,
             note = $17,
             is_active = $18,
             updated_by = $19,
             version = version + 1,
             updated_at = now()
         WHERE id = $20 AND workspace_id = $21
         RETURNING *`,
        [
          nextVendorId,
          name,
          itemType,
          input['category'] !== undefined
            ? typeof input['category'] === 'string'
              ? input['category'].trim() || null
              : null
            : existing['category'],
          input['specification'] !== undefined
            ? typeof input['specification'] === 'string'
              ? input['specification'].trim() || null
              : null
            : existing['specification'],
          JSON.stringify(includedStages),
          structuredSpec ? JSON.stringify(structuredSpec) : null,
          conditionsNote,
          input['unit'] !== undefined &&
          typeof input['unit'] === 'string' &&
          input['unit'].trim()
            ? input['unit'].trim()
            : existing['unit'],
          pricingMode,
          unitCost,
          batchQuantity,
          batchTotalCost,
          defaultProfitMode,
          defaultProfitScope,
          defaultProfitValue,
          input['note'] !== undefined
            ? typeof input['note'] === 'string'
              ? input['note'].trim() || null
              : null
            : existing['note'],
          nextIsActive,
          ctx.user.id,
          priceItemId,
          ctx.workspace.id,
        ],
      );

      const usedIds = await this.collectUsedPriceItemIds(
        client,
        ctx.workspace.id,
      );
      const updated = this.mapPriceItemRow({
        ...res.rows[0],
        vendor_name: nextVendorName,
      });
      updated.is_used_in_quotes = usedIds.has(updated.id);

      const action: 'UPDATED' | 'DEACTIVATED' | 'RESTORED' =
        beforeMapped.is_active && !nextIsActive
          ? 'DEACTIVATED'
          : !beforeMapped.is_active && nextIsActive
            ? 'RESTORED'
            : 'UPDATED';

      await this.recordPriceItemHistory(client, {
        workspaceId: ctx.workspace.id,
        priceItemId: updated.id,
        version: updated.version,
        action,
        beforeJson: beforeMapped,
        afterJson: updated,
        changeNote:
          typeof input['change_note'] === 'string' &&
          input['change_note'].trim()
            ? input['change_note'].trim()
            : action === 'DEACTIVATED'
              ? 'Ngừng sử dụng mục giá xưởng'
              : action === 'RESTORED'
                ? 'Khôi phục mục giá xưởng'
                : 'Cập nhật mục giá xưởng',
        changedBy: ctx.user.id,
      });

      await client.query('COMMIT');
      return updated;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deactivatePriceItem(
    ctx: AuthenticatedContext,
    priceItemId: string,
    changeNote?: string | null,
  ): Promise<PrintVendorPriceItemData> {
    this.assertOwnerAccess(ctx);
    return this.updatePriceItem(ctx, priceItemId, {
      is_active: false,
      change_note: changeNote || 'Ngừng sử dụng mục giá xưởng',
    });
  }

  async restorePriceItem(
    ctx: AuthenticatedContext,
    priceItemId: string,
    changeNote?: string | null,
  ): Promise<PrintVendorPriceItemData> {
    this.assertOwnerAccess(ctx);
    return this.updatePriceItem(ctx, priceItemId, {
      is_active: true,
      change_note: changeNote || 'Khôi phục mục giá xưởng',
    });
  }

  async deletePriceItem(
    ctx: AuthenticatedContext,
    priceItemId: string,
  ): Promise<{ deleted: true; id: string }> {
    this.assertOwnerAccess(ctx);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existingRes = await client.query(
        `SELECT id, name FROM print_vendor_price_items WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [priceItemId, ctx.workspace.id],
      );
      if (existingRes.rows.length === 0) {
        throw new AuthError('NOT_FOUND', 'Không tìm thấy mục giá xưởng.', 404);
      }

      const usedIds = await this.collectUsedPriceItemIds(
        client,
        ctx.workspace.id,
      );
      if (usedIds.has(priceItemId)) {
        throw new AuthError(
          'PRICE_ITEM_IN_USE',
          `Mục giá "${String(existingRes.rows[0]?.['name'] ?? '')}" đã được dùng trong báo giá nên không thể xóa vĩnh viễn. Vui lòng chọn "Ngừng dùng" để ẩn khỏi danh sách chọn mới mà không mất lịch sử báo giá cũ.`,
          409,
        );
      }

      await client.query(
        `DELETE FROM print_vendor_price_item_history WHERE price_item_id = $1 AND workspace_id = $2`,
        [priceItemId, ctx.workspace.id],
      );
      await client.query(
        `DELETE FROM print_vendor_price_items WHERE id = $1 AND workspace_id = $2`,
        [priceItemId, ctx.workspace.id],
      );
      await client.query('COMMIT');
      return { deleted: true, id: priceItemId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listPriceItemHistory(
    ctx: AuthenticatedContext,
    priceItemId: string,
  ): Promise<PrintVendorPriceItemHistoryData[]> {
    this.assertOwnerAccess(ctx);
    const checkRes = await this.pool.query(
      `SELECT 1 FROM print_vendor_price_items WHERE id = $1 AND workspace_id = $2`,
      [priceItemId, ctx.workspace.id],
    );
    if (checkRes.rows.length === 0) {
      throw new AuthError('NOT_FOUND', 'Không tìm thấy mục giá xưởng.', 404);
    }

    const res = await this.pool.query(
      `SELECT h.*, COALESCE(e.full_name, u.username_normalized, u.email_normalized) AS changed_by_name
       FROM print_vendor_price_item_history h
       LEFT JOIN users u ON u.id = h.changed_by
       LEFT JOIN employees e ON e.user_id = h.changed_by AND e.workspace_id = h.workspace_id
       WHERE h.price_item_id = $1 AND h.workspace_id = $2
       ORDER BY h.version DESC, h.changed_at DESC`,
      [priceItemId, ctx.workspace.id],
    );

    return res.rows.map((r) => ({
      id: String(r['id']),
      workspace_id: String(r['workspace_id']),
      price_item_id: String(r['price_item_id']),
      version: toInt(r['version'], 1),
      action:
        r['action'] === 'CREATED' ||
        r['action'] === 'DEACTIVATED' ||
        r['action'] === 'RESTORED'
          ? r['action']
          : 'UPDATED',
      before_json: normalizeJsonObject(r['before_json']),
      after_json: normalizeJsonObject(r['after_json']) ?? {},
      change_note: r['change_note'] ? String(r['change_note']) : null,
      changed_by: r['changed_by'] ? String(r['changed_by']) : null,
      changed_by_name: r['changed_by_name']
        ? String(r['changed_by_name'])
        : null,
      changed_at: toIso(r['changed_at']),
    }));
  }

  private mapPriceItemRow(
    r: Record<string, unknown>,
  ): PrintVendorPriceItemData {
    const rawIncluded = r['included_stages'];
    const includedStages = Array.isArray(rawIncluded)
      ? normalizeStringArray(rawIncluded)
      : [];
    return {
      id: String(r['id']),
      workspace_id: String(r['workspace_id']),
      vendor_id: r['vendor_id'] ? String(r['vendor_id']) : null,
      vendor_name: r['vendor_name'] ? String(r['vendor_name']) : null,
      code: String(r['code']),
      name: String(r['name']),
      item_type:
        r['item_type'] === PriceItemType.FINISHING
          ? PriceItemType.FINISHING
          : PriceItemType.BASE_PRINT,
      category: r['category'] ? String(r['category']) : null,
      specification: r['specification'] ? String(r['specification']) : null,
      included_stages: includedStages,
      structured_spec: normalizeJsonObject(r['structured_spec']),
      conditions_note: r['conditions_note']
        ? String(r['conditions_note'])
        : null,
      unit: String(r['unit'] || 'tờ'),
      pricing_mode: parseVendorCostMode(
        r['pricing_mode'],
        VendorCostMode.PER_UNIT,
      ),
      unit_cost: toInt(r['unit_cost'], 0),
      batch_quantity: Math.max(1, toInt(r['batch_quantity'], 1)),
      batch_total_cost: toInt(r['batch_total_cost'], 0),
      default_profit_mode:
        (r['default_profit_mode'] as ProfitModeType) || 'FIXED_AMOUNT',
      default_profit_scope: parseProfitScope(
        r['default_profit_scope'],
        ProfitScope.PER_UNIT,
      ),
      default_profit_value: toNum(r['default_profit_value'], 0),
      note: r['note'] ? String(r['note']) : null,
      is_active: Boolean(r['is_active']),
      version: toInt(r['version'], 1),
      updated_by: r['updated_by'] ? String(r['updated_by']) : null,
      created_at: toIso(r['created_at']),
      updated_at: toIso(r['updated_at']),
    };
  }

  // ==========================================================================
  // 3. CUSTOMERS (KHÁCH HÀNG)
  // ==========================================================================

  async listCustomers(ctx: AuthenticatedContext): Promise<PrintCustomerData[]> {
    this.assertOwnerAccess(ctx);
    const res = await this.pool.query(
      `SELECT * FROM print_customers WHERE workspace_id = $1 ORDER BY is_active DESC, name ASC, created_at DESC`,
      [ctx.workspace.id],
    );
    return res.rows.map((r) => this.mapCustomerRow(r));
  }

  async createCustomer(
    ctx: AuthenticatedContext,
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<PrintCustomerData> {
    this.assertOwnerAccess(ctx);
    const name = typeof input['name'] === 'string' ? input['name'].trim() : '';
    if (!name) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Tên khách hàng là bắt buộc.',
        400,
      );
    }

    return this.withIdempotentTransaction(
      ctx,
      'POST',
      '/api/v1/print-quotes/customers',
      input,
      idempotencyKey,
      201,
      async (client) => {
        let code =
          typeof input['code'] === 'string'
            ? input['code'].trim().toUpperCase()
            : '';
        if (!code) {
          const countRes = await client.query<{ cnt: string }>(
            `SELECT COUNT(*)::text AS cnt FROM print_customers WHERE workspace_id = $1`,
            [ctx.workspace.id],
          );
          const nextNum = Number(countRes.rows[0]?.cnt ?? 0) + 1;
          code = `KH${String(nextNum).padStart(3, '0')}`;
        }

        const res = await client.query(
          `INSERT INTO print_customers (
            workspace_id, code, name, company_name, phone, email, address, tax_code, note, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *`,
          [
            ctx.workspace.id,
            code,
            name,
            typeof input['company_name'] === 'string'
              ? input['company_name'].trim() || null
              : null,
            typeof input['phone'] === 'string'
              ? input['phone'].trim() || null
              : null,
            typeof input['email'] === 'string'
              ? input['email'].trim() || null
              : null,
            typeof input['address'] === 'string'
              ? input['address'].trim() || null
              : null,
            typeof input['tax_code'] === 'string'
              ? input['tax_code'].trim() || null
              : null,
            typeof input['note'] === 'string'
              ? input['note'].trim() || null
              : null,
            input['is_active'] === undefined
              ? true
              : Boolean(input['is_active']),
          ],
        );
        return this.mapCustomerRow(res.rows[0]);
      },
    );
  }

  async updateCustomer(
    ctx: AuthenticatedContext,
    customerId: string,
    input: Record<string, unknown>,
  ): Promise<PrintCustomerData> {
    this.assertOwnerAccess(ctx);
    const existingRes = await this.pool.query(
      `SELECT * FROM print_customers WHERE id = $1 AND workspace_id = $2`,
      [customerId, ctx.workspace.id],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AuthError('NOT_FOUND', 'Không tìm thấy khách hàng.', 404);
    }

    const name =
      typeof input['name'] === 'string'
        ? input['name'].trim()
        : String(existing['name']);
    if (!name) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Tên khách hàng không được để trống.',
        400,
      );
    }

    const res = await this.pool.query(
      `UPDATE print_customers
       SET name = $1,
           company_name = $2,
           phone = $3,
           email = $4,
           address = $5,
           tax_code = $6,
           note = $7,
           is_active = $8,
           updated_at = now()
       WHERE id = $9 AND workspace_id = $10
       RETURNING *`,
      [
        name,
        input['company_name'] !== undefined
          ? typeof input['company_name'] === 'string'
            ? input['company_name'].trim() || null
            : null
          : existing['company_name'],
        input['phone'] !== undefined
          ? typeof input['phone'] === 'string'
            ? input['phone'].trim() || null
            : null
          : existing['phone'],
        input['email'] !== undefined
          ? typeof input['email'] === 'string'
            ? input['email'].trim() || null
            : null
          : existing['email'],
        input['address'] !== undefined
          ? typeof input['address'] === 'string'
            ? input['address'].trim() || null
            : null
          : existing['address'],
        input['tax_code'] !== undefined
          ? typeof input['tax_code'] === 'string'
            ? input['tax_code'].trim() || null
            : null
          : existing['tax_code'],
        input['note'] !== undefined
          ? typeof input['note'] === 'string'
            ? input['note'].trim() || null
            : null
          : existing['note'],
        input['is_active'] !== undefined
          ? Boolean(input['is_active'])
          : Boolean(existing['is_active']),
        customerId,
        ctx.workspace.id,
      ],
    );
    return this.mapCustomerRow(res.rows[0]);
  }

  private mapCustomerRow(r: Record<string, unknown>): PrintCustomerData {
    return {
      id: String(r['id']),
      workspace_id: String(r['workspace_id']),
      code: String(r['code']),
      name: String(r['name']),
      company_name: r['company_name'] ? String(r['company_name']) : null,
      phone: r['phone'] ? String(r['phone']) : null,
      email: r['email'] ? String(r['email']) : null,
      address: r['address'] ? String(r['address']) : null,
      tax_code: r['tax_code'] ? String(r['tax_code']) : null,
      note: r['note'] ? String(r['note']) : null,
      is_active: Boolean(r['is_active']),
      created_at: toIso(r['created_at']),
      updated_at: toIso(r['updated_at']),
    };
  }

  // ==========================================================================
  // 4. QUOTES & QUOTE VERSION HISTORY (BÁO GIÁ & LỊCH SỬ PHIÊN BẢN)
  // ==========================================================================

  private reconstructStoredLinesOutcome(
    existingLines: StoredQuoteLineJson[],
    existingPricingStatus: unknown,
  ): ResolvedQuoteLinesOutcome {
    const isPending =
      existingPricingStatus === QuotePricingStatus.PENDING_COST ||
      existingLines.some(
        (l) =>
          l.isPendingCost === true ||
          l.baseCostPending === true ||
          l.baseCostRate === null ||
          (l.finishingStages ?? []).some((s) => s.rate === null),
      );

    if (isPending) {
      const draftLines: PendingCostDraftLineInput[] = existingLines.map(
        (l) => ({
          id: l.id,
          name: l.name,
          specification: l.specification ?? '',
          vendorId: l.vendorId ?? null,
          vendorName: l.vendorName ?? null,
          vendorPriceItemId: l.vendorPriceItemId ?? null,
          ...(l.vendorPriceItemCode !== undefined
            ? { vendorPriceItemCode: l.vendorPriceItemCode }
            : {}),
          ...(l.vendorPriceItemVersion !== undefined
            ? { vendorPriceItemVersion: l.vendorPriceItemVersion }
            : {}),
          ...(l.catalogOriginalRate !== undefined
            ? { catalogOriginalRate: l.catalogOriginalRate }
            : {}),
          ...(l.catalogBatchQuantity !== undefined
            ? { catalogBatchQuantity: l.catalogBatchQuantity }
            : {}),
          ...(l.priceAppliedAt !== undefined
            ? { priceAppliedAt: l.priceAppliedAt }
            : {}),
          unit: l.unit,
          quantity: l.quantity,
          vendorCostMode: l.vendorCostMode ?? VendorCostMode.PER_UNIT,
          baseCostRate:
            l.baseCostPending === true || l.baseCostRate === null
              ? null
              : l.baseCostRate !== undefined
                ? l.baseCostRate
                : l.vendorCostMode === VendorCostMode.TOTAL_BATCH
                  ? l.totalVendorCost
                  : l.unitVendorCost,
          baseCostSource: l.baseCostSource ?? LineCostSource.MANUAL,
          ...(l.baseIncludedStages && l.baseIncludedStages.length > 0
            ? { baseIncludedStages: [...l.baseIncludedStages] }
            : {}),
          areaSpec: l.areaSpec
            ? {
                mode: l.areaSpec.mode,
                ...(l.areaSpec.widthM !== null
                  ? { widthM: l.areaSpec.widthM }
                  : {}),
                ...(l.areaSpec.heightM !== null
                  ? { heightM: l.areaSpec.heightM }
                  : {}),
                sheetsCount: l.areaSpec.sheetsCount,
                actualAreaSqm: l.areaSpec.actualAreaSqm,
                billableAreaSqm: l.areaSpec.billableAreaSqm,
                ...(l.areaSpec.adjustmentReason
                  ? { adjustmentReason: l.areaSpec.adjustmentReason }
                  : {}),
              }
            : null,
          finishingStages: (l.finishingStages ?? []).map(
            (s): PendingCostDraftStageSnapshot => ({
              id: s.id,
              priceItemId: s.priceItemId ?? null,
              code: s.code ?? null,
              ...(s.priceItemVersion !== undefined
                ? { priceItemVersion: s.priceItemVersion }
                : {}),
              ...(s.vendorId !== undefined ? { vendorId: s.vendorId } : {}),
              ...(s.vendorName !== undefined
                ? { vendorName: s.vendorName }
                : {}),
              ...(s.catalogOriginalRate !== undefined
                ? { catalogOriginalRate: s.catalogOriginalRate }
                : {}),
              ...(s.catalogBatchQuantity !== undefined
                ? { catalogBatchQuantity: s.catalogBatchQuantity }
                : {}),
              ...(s.appliedAt !== undefined ? { appliedAt: s.appliedAt } : {}),
              name: s.name,
              pricingMode: s.pricingMode,
              rate: s.rate,
              unit: s.unit,
              billableAreaSqm: s.billableAreaSqm ?? null,
              ...('vendorCost' in s && typeof s.vendorCost === 'number'
                ? { vendorCost: s.vendorCost }
                : {}),
              costSource: s.costSource,
              note: s.note ?? null,
            }),
          ),
          profit: {
            mode: l.profitMode,
            scope: l.profitScope,
            value: l.profitInputValue,
          },
        }),
      );
      return {
        pricingStatus: QuotePricingStatus.PENDING_COST,
        draftLines,
      };
    }

    const lines: QuoteLineInput[] = existingLines.map((l): QuoteLineInput => {
      const hasExtended =
        l.baseCostRate !== undefined ||
        l.vendorCostMode === VendorCostMode.PER_SQM ||
        Boolean(l.areaSpec) ||
        Boolean(l.finishingStages && l.finishingStages.length > 0) ||
        Boolean(l.baseIncludedStages && l.baseIncludedStages.length > 0);

      if (hasExtended) {
        return {
          id: l.id,
          name: l.name,
          specification: l.specification ?? '',
          vendorId: l.vendorId ?? null,
          vendorName: l.vendorName ?? null,
          vendorPriceItemId: l.vendorPriceItemId ?? null,
          ...(l.vendorPriceItemCode !== undefined
            ? { vendorPriceItemCode: l.vendorPriceItemCode }
            : {}),
          ...(l.vendorPriceItemVersion !== undefined
            ? { vendorPriceItemVersion: l.vendorPriceItemVersion }
            : {}),
          ...(l.catalogOriginalRate !== undefined
            ? { catalogOriginalRate: l.catalogOriginalRate }
            : {}),
          ...(l.catalogBatchQuantity !== undefined
            ? { catalogBatchQuantity: l.catalogBatchQuantity }
            : {}),
          ...(l.priceAppliedAt !== undefined
            ? { priceAppliedAt: l.priceAppliedAt }
            : {}),
          unit: l.unit,
          quantity: l.quantity,
          vendorCostMode: l.vendorCostMode ?? VendorCostMode.PER_UNIT,
          baseCostRate:
            typeof l.baseCostRate === 'number'
              ? l.baseCostRate
              : l.vendorCostMode === VendorCostMode.TOTAL_BATCH
                ? l.totalVendorCost
                : l.unitVendorCost,
          ...(l.baseCostSource ? { baseCostSource: l.baseCostSource } : {}),
          ...(l.baseIncludedStages && l.baseIncludedStages.length > 0
            ? { baseIncludedStages: [...l.baseIncludedStages] }
            : {}),
          areaSpec: l.areaSpec
            ? {
                mode: l.areaSpec.mode,
                ...(l.areaSpec.widthM !== null
                  ? { widthM: l.areaSpec.widthM }
                  : {}),
                ...(l.areaSpec.heightM !== null
                  ? { heightM: l.areaSpec.heightM }
                  : {}),
                sheetsCount: l.areaSpec.sheetsCount,
                actualAreaSqm: l.areaSpec.actualAreaSqm,
                billableAreaSqm: l.areaSpec.billableAreaSqm,
                ...(l.areaSpec.adjustmentReason
                  ? { adjustmentReason: l.areaSpec.adjustmentReason }
                  : {}),
              }
            : null,
          finishingStages: (l.finishingStages ?? []).map(
            (s): QuoteFinishingStageInput => ({
              id: s.id,
              priceItemId: s.priceItemId ?? null,
              code: s.code ?? null,
              ...(s.priceItemVersion !== undefined
                ? { priceItemVersion: s.priceItemVersion }
                : {}),
              ...(s.vendorId !== undefined ? { vendorId: s.vendorId } : {}),
              ...(s.vendorName !== undefined
                ? { vendorName: s.vendorName }
                : {}),
              ...(s.catalogOriginalRate !== undefined
                ? { catalogOriginalRate: s.catalogOriginalRate }
                : {}),
              ...(s.catalogBatchQuantity !== undefined
                ? { catalogBatchQuantity: s.catalogBatchQuantity }
                : {}),
              ...(s.appliedAt !== undefined ? { appliedAt: s.appliedAt } : {}),
              name: s.name,
              pricingMode: s.pricingMode,
              rate: typeof s.rate === 'number' ? s.rate : 0,
              unit: s.unit,
              billableAreaSqm: s.billableAreaSqm ?? null,
              costSource: s.costSource,
              note: s.note ?? null,
            }),
          ),
          profit: {
            mode: l.profitMode,
            scope: l.profitScope,
            value: l.profitInputValue,
          },
          extraCost: l.totalExtraCost,
        };
      }

      const base: QuoteLineInput = {
        id: l.id,
        name: l.name,
        specification: l.specification ?? '',
        vendorId: l.vendorId ?? null,
        vendorName: l.vendorName ?? null,
        vendorPriceItemId: l.vendorPriceItemId ?? null,
        ...(l.vendorPriceItemCode !== undefined
          ? { vendorPriceItemCode: l.vendorPriceItemCode }
          : {}),
        ...(l.vendorPriceItemVersion !== undefined
          ? { vendorPriceItemVersion: l.vendorPriceItemVersion }
          : {}),
        ...(l.catalogOriginalRate !== undefined
          ? { catalogOriginalRate: l.catalogOriginalRate }
          : {}),
        ...(l.catalogBatchQuantity !== undefined
          ? { catalogBatchQuantity: l.catalogBatchQuantity }
          : {}),
        ...(l.priceAppliedAt !== undefined
          ? { priceAppliedAt: l.priceAppliedAt }
          : {}),
        unit: l.unit,
        quantity: l.quantity,
        profit: {
          mode: l.profitMode,
          scope: l.profitScope,
          value: l.profitInputValue,
        },
        extraCost: l.totalExtraCost,
      };
      if (l.vendorCostMode === VendorCostMode.TOTAL_BATCH) {
        base.totalVendorCost = l.totalVendorCost;
      } else if (l.vendorCostMode === VendorCostMode.PER_UNIT) {
        base.unitVendorCost = l.unitVendorCost;
      } else {
        base.unitVendorCost = l.unitVendorCost;
        base.totalVendorCost = l.totalVendorCost;
      }
      return base;
    });

    return {
      pricingStatus: QuotePricingStatus.COMPLETE,
      lines,
      costModes: existingLines.map((l) => l.vendorCostMode),
    };
  }

  private async resolveQuoteLinesWithCatalog(
    client: pg.PoolClient,
    workspaceId: string,
    rawItems: unknown,
    allowedInactiveCatalogIds?: ReadonlySet<string>,
  ): Promise<ResolvedQuoteLinesOutcome> {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Báo giá phải có ít nhất 1 dòng sản phẩm.',
        400,
      );
    }

    const catalogById = new Map<string, PrintVendorPriceItemData>();
    const loadCatalogItem = async (
      itemId: string,
    ): Promise<PrintVendorPriceItemData> => {
      const cached = catalogById.get(itemId);
      if (cached) return cached;
      const catRes = await client.query(
        `SELECT p.*, v.name AS vendor_name
         FROM print_vendor_price_items p
         LEFT JOIN print_vendors v ON v.id = p.vendor_id
         WHERE p.id = $1 AND p.workspace_id = $2`,
        [itemId, workspaceId],
      );
      const cat = catRes.rows[0];
      if (!cat) {
        throw new AuthError(
          'NOT_FOUND',
          `Không tìm thấy hạng mục bảng giá xưởng (${itemId}).`,
          404,
        );
      }
      const mapped = this.mapPriceItemRow(cat);
      if (!mapped.is_active && !allowedInactiveCatalogIds?.has(mapped.id)) {
        throw new AuthError(
          'PRICE_ITEM_INACTIVE',
          `Mục giá xưởng "${mapped.name}" đã ngừng dùng, không thể gắn mới vào báo giá.`,
          409,
        );
      }
      catalogById.set(itemId, mapped);
      return mapped;
    };

    // Preload base catalog items and detect whether any line uses V2 workshop/stage/m2/pending features
    let anyExtended = false;
    for (let i = 0; i < rawItems.length; i++) {
      const raw = (rawItems[i] ?? {}) as Record<string, unknown>;
      const vendorPriceItemId =
        typeof raw['vendor_price_item_id'] === 'string' &&
        raw['vendor_price_item_id'].trim()
          ? raw['vendor_price_item_id'].trim()
          : typeof raw['vendorPriceItemId'] === 'string' &&
              raw['vendorPriceItemId'].trim()
            ? raw['vendorPriceItemId'].trim()
            : null;
      let mappedCat: PrintVendorPriceItemData | null = null;
      if (vendorPriceItemId) {
        mappedCat = await loadCatalogItem(vendorPriceItemId);
        if (mappedCat.item_type === PriceItemType.FINISHING) {
          throw new AuthError(
            'VALIDATION_ERROR',
            `Mục "${mappedCat.name}" là giá gia công, không thể chọn làm giá in cơ bản.`,
            400,
          );
        }
      }

      const rawProfit = raw['profit'] as Record<string, unknown> | undefined;
      const profitScopeCandidate =
        rawProfit?.['scope'] ?? raw['profit_scope'] ?? raw['profitScope'];
      const rawStages = raw['finishingStages'] ?? raw['finishing_stages'];
      const rawIncluded =
        raw['baseIncludedStages'] ?? raw['base_included_stages'];

      if (
        raw['baseCostPending'] === true ||
        raw['base_cost_pending'] === true ||
        raw['baseCostRate'] !== undefined ||
        raw['base_cost_rate'] !== undefined ||
        raw['baseCostSource'] !== undefined ||
        raw['base_cost_source'] !== undefined ||
        raw['unitVendorCost'] === null ||
        raw['unit_vendor_cost'] === null ||
        raw['unitVendorCost'] === '' ||
        raw['unit_vendor_cost'] === '' ||
        raw['totalVendorCost'] === null ||
        raw['total_vendor_cost'] === null ||
        raw['totalVendorCost'] === '' ||
        raw['total_vendor_cost'] === '' ||
        (raw['vendorCostMode'] ?? raw['vendor_cost_mode']) ===
          VendorCostMode.PER_SQM ||
        profitScopeCandidate === ProfitScope.PER_SQM ||
        (raw['areaSpec'] !== undefined && raw['areaSpec'] !== null) ||
        (raw['area_spec'] !== undefined && raw['area_spec'] !== null) ||
        (Array.isArray(rawStages) && rawStages.length > 0) ||
        (Array.isArray(rawIncluded) && rawIncluded.length > 0) ||
        mappedCat?.pricing_mode === VendorCostMode.PER_SQM ||
        (mappedCat?.included_stages.length ?? 0) > 0
      ) {
        anyExtended = true;
      }
    }

    const appliedAtIso = new Date().toISOString();

    if (!anyExtended) {
      // Legacy V1/V2 fast path (preserves exact snapshot hash & error messages)
      const lines: QuoteLineInput[] = [];
      const costModes: Array<VendorCostModeType | undefined> = [];
      for (let i = 0; i < rawItems.length; i++) {
        const raw = rawItems[i] as Record<string, unknown>;
        const lineId =
          typeof raw['id'] === 'string' && raw['id'].trim()
            ? raw['id'].trim()
            : `LINE-${i + 1}`;
        const quantity = toInt(raw['quantity'], 0);
        if (quantity <= 0) {
          throw new AuthError(
            'VALIDATION_ERROR',
            `Số lượng sản phẩm dòng #${i + 1} phải > 0.`,
            400,
          );
        }

        const vendorPriceItemId =
          typeof raw['vendor_price_item_id'] === 'string' &&
          raw['vendor_price_item_id'].trim()
            ? raw['vendor_price_item_id'].trim()
            : typeof raw['vendorPriceItemId'] === 'string' &&
                raw['vendorPriceItemId'].trim()
              ? raw['vendorPriceItemId'].trim()
              : null;

        if (
          vendorPriceItemId &&
          raw['unitVendorCost'] === undefined &&
          raw['totalVendorCost'] === undefined &&
          raw['unit_vendor_cost'] === undefined &&
          raw['total_vendor_cost'] === undefined
        ) {
          const mappedCat = await loadCatalogItem(vendorPriceItemId);
          const batchCond = evaluateCatalogBatchQuantityCondition({
            itemName: mappedCat.name,
            itemCode: mappedCat.code,
            itemType: mappedCat.item_type,
            pricingMode: mappedCat.pricing_mode,
            batchQuantity: mappedCat.batch_quantity,
            structuredSpec: mappedCat.structured_spec,
            costSource: LineCostSource.CATALOG,
            lineQuantity: quantity,
            unit: mappedCat.unit,
          });
          if (!batchCond.allowed) {
            throw new AuthError(
              'BATCH_QUANTITY_MISMATCH',
              batchCond.reason!,
              409,
            );
          }
          const rawProfit = raw['profit'] as
            Record<string, unknown> | undefined;
          const explicitProfitVal =
            rawProfit?.['value'] ?? raw['profit_value'] ?? raw['profitValue'];
          const explicitProfitMode =
            rawProfit?.['mode'] ?? raw['profit_mode'] ?? raw['profitMode'];
          const explicitProfitScope =
            rawProfit?.['scope'] ?? raw['profit_scope'] ?? raw['profitScope'];
          const profitOverride =
            rawProfit !== undefined ||
            explicitProfitVal !== undefined ||
            explicitProfitMode !== undefined ||
            explicitProfitScope !== undefined
              ? {
                  mode:
                    explicitProfitMode === ProfitMode.PERCENTAGE
                      ? ProfitMode.PERCENTAGE
                      : ProfitMode.FIXED_AMOUNT,
                  scope:
                    explicitProfitScope === ProfitScope.TOTAL_BATCH
                      ? ProfitScope.TOTAL_BATCH
                      : ProfitScope.PER_UNIT,
                  value: Math.max(
                    0,
                    toNum(explicitProfitVal, mappedCat.default_profit_value),
                  ),
                }
              : undefined;

          const catalogPricingMode: VendorCostModeType = mappedCat.pricing_mode;
          const builtLine = buildQuoteLineFromVendorCatalogItem(
            {
              id: mappedCat.id,
              vendorId: mappedCat.vendor_id,
              vendorName: mappedCat.vendor_name,
              code: mappedCat.code,
              name:
                typeof raw['name'] === 'string' && raw['name'].trim()
                  ? raw['name'].trim()
                  : mappedCat.name,
              specification:
                typeof raw['specification'] === 'string'
                  ? raw['specification'].trim()
                  : (mappedCat.specification ?? ''),
              unit:
                typeof raw['unit'] === 'string' && raw['unit'].trim()
                  ? raw['unit'].trim()
                  : mappedCat.unit,
              pricingMode: catalogPricingMode,
              unitCost: mappedCat.unit_cost,
              batchQuantity: mappedCat.batch_quantity,
              batchTotalCost: mappedCat.batch_total_cost,
              defaultProfitMode: mappedCat.default_profit_mode,
              defaultProfitScope: mappedCat.default_profit_scope,
              defaultProfitValue: mappedCat.default_profit_value,
            },
            {
              lineId,
              quantity,
              ...(profitOverride ? { profitOverride } : {}),
              extraCost: Math.max(
                0,
                toInt(raw['extraCost'] ?? raw['extra_cost'], 0),
              ),
            },
          );
          builtLine.vendorPriceItemCode = mappedCat.code;
          builtLine.vendorPriceItemVersion = mappedCat.version;
          builtLine.catalogOriginalRate =
            catalogPricingMode === VendorCostMode.TOTAL_BATCH
              ? mappedCat.batch_total_cost
              : mappedCat.unit_cost;
          builtLine.catalogBatchQuantity =
            catalogPricingMode === VendorCostMode.TOTAL_BATCH
              ? mappedCat.batch_quantity
              : null;
          builtLine.priceAppliedAt = appliedAtIso;

          lines.push(builtLine);
          costModes.push(catalogPricingMode);
          continue;
        }

        const name = typeof raw['name'] === 'string' ? raw['name'].trim() : '';
        if (!name) {
          throw new AuthError(
            'VALIDATION_ERROR',
            `Tên sản phẩm dòng #${i + 1} không được để trống.`,
            400,
          );
        }

        const hasUnit =
          raw['unitVendorCost'] !== undefined ||
          raw['unit_vendor_cost'] !== undefined;
        const hasTotal =
          raw['totalVendorCost'] !== undefined ||
          raw['total_vendor_cost'] !== undefined;
        if (!hasUnit && !hasTotal) {
          throw new AuthError(
            'VALIDATION_ERROR',
            `Dòng sản phẩm "${name}" phải có giá vốn đơn vị (unitVendorCost) hoặc giá vốn cả lô (totalVendorCost).`,
            400,
          );
        }

        const explicitCostModeRaw =
          raw['vendorCostMode'] ?? raw['vendor_cost_mode'];
        const resolvedCostMode: VendorCostModeType | undefined =
          explicitCostModeRaw === VendorCostMode.TOTAL_BATCH
            ? VendorCostMode.TOTAL_BATCH
            : explicitCostModeRaw === VendorCostMode.PER_UNIT
              ? VendorCostMode.PER_UNIT
              : hasTotal && !hasUnit
                ? VendorCostMode.TOTAL_BATCH
                : hasUnit && !hasTotal
                  ? VendorCostMode.PER_UNIT
                  : undefined;

        const rawProfit = raw['profit'] as Record<string, unknown> | undefined;
        const profitMode: ProfitModeType =
          (rawProfit?.['mode'] ?? raw['profit_mode'] ?? raw['profitMode']) ===
          ProfitMode.PERCENTAGE
            ? ProfitMode.PERCENTAGE
            : ProfitMode.FIXED_AMOUNT;
        const profitScope: ProfitScopeType =
          (rawProfit?.['scope'] ??
            raw['profit_scope'] ??
            raw['profitScope']) === ProfitScope.TOTAL_BATCH
            ? ProfitScope.TOTAL_BATCH
            : ProfitScope.PER_UNIT;
        const profitVal = Math.max(
          0,
          toNum(
            rawProfit?.['value'] ?? raw['profit_value'] ?? raw['profitValue'],
            0,
          ),
        );

        const lineItem: QuoteLineInput = {
          id: lineId,
          name,
          specification:
            typeof raw['specification'] === 'string'
              ? raw['specification'].trim()
              : '',
          vendorId:
            typeof raw['vendor_id'] === 'string'
              ? raw['vendor_id']
              : typeof raw['vendorId'] === 'string'
                ? raw['vendorId']
                : null,
          vendorName:
            typeof raw['vendor_name'] === 'string'
              ? raw['vendor_name']
              : typeof raw['vendorName'] === 'string'
                ? raw['vendorName']
                : null,
          vendorPriceItemId,
          unit:
            typeof raw['unit'] === 'string' && raw['unit'].trim()
              ? raw['unit'].trim()
              : 'tờ',
          quantity,
          profit: {
            mode: profitMode,
            scope: profitScope,
            value: profitVal,
          },
          extraCost: Math.max(
            0,
            toInt(raw['extraCost'] ?? raw['extra_cost'], 0),
          ),
        };

        if (hasUnit && resolvedCostMode !== VendorCostMode.TOTAL_BATCH) {
          lineItem.unitVendorCost = Math.max(
            0,
            toNum(raw['unitVendorCost'] ?? raw['unit_vendor_cost'], 0),
          );
        }
        if (hasTotal && resolvedCostMode !== VendorCostMode.PER_UNIT) {
          lineItem.totalVendorCost = Math.max(
            0,
            toInt(raw['totalVendorCost'] ?? raw['total_vendor_cost'], 0),
          );
        }

        if (vendorPriceItemId) {
          const mappedCat = await loadCatalogItem(vendorPriceItemId);
          const catOrigRate =
            mappedCat.pricing_mode === VendorCostMode.TOTAL_BATCH
              ? mappedCat.batch_total_cost
              : mappedCat.unit_cost;
          const submittedRate =
            resolvedCostMode === VendorCostMode.TOTAL_BATCH
              ? lineItem.totalVendorCost
              : lineItem.unitVendorCost;
          const inferredSource =
            submittedRate !== undefined &&
            submittedRate === catOrigRate &&
            (resolvedCostMode === undefined ||
              resolvedCostMode === mappedCat.pricing_mode)
              ? LineCostSource.CATALOG
              : LineCostSource.CATALOG_OVERRIDDEN;
          if (resolvedCostMode === VendorCostMode.TOTAL_BATCH) {
            const batchCond = evaluateCatalogBatchQuantityCondition({
              itemName: mappedCat.name,
              itemCode: mappedCat.code,
              itemType: mappedCat.item_type,
              pricingMode: mappedCat.pricing_mode,
              batchQuantity: mappedCat.batch_quantity,
              structuredSpec: mappedCat.structured_spec,
              costSource: inferredSource,
              lineQuantity: quantity,
              unit: lineItem.unit,
            });
            if (!batchCond.allowed) {
              throw new AuthError(
                'BATCH_QUANTITY_MISMATCH',
                batchCond.reason!,
                409,
              );
            }
          }
          lineItem.vendorPriceItemCode = mappedCat.code;
          lineItem.vendorPriceItemVersion = mappedCat.version;
          lineItem.catalogOriginalRate = catOrigRate;
          lineItem.catalogBatchQuantity =
            mappedCat.pricing_mode === VendorCostMode.TOTAL_BATCH
              ? mappedCat.batch_quantity
              : null;
          lineItem.priceAppliedAt = appliedAtIso;
        }

        lines.push(lineItem);
        costModes.push(resolvedCostMode);
      }

      return {
        pricingStatus: QuotePricingStatus.COMPLETE,
        lines,
        costModes,
      };
    }

    // Extended multi-stage / m² / pending-cost resolution path
    const draftLines: Array<PendingCostDraftLineInput & { extraCost: number }> =
      [];

    for (let i = 0; i < rawItems.length; i++) {
      const raw = rawItems[i] as Record<string, unknown>;
      const lineId =
        typeof raw['id'] === 'string' && raw['id'].trim()
          ? raw['id'].trim()
          : `LINE-${i + 1}`;
      const quantity = toInt(raw['quantity'], 0);
      if (quantity <= 0) {
        throw new AuthError(
          'VALIDATION_ERROR',
          `Số lượng sản phẩm dòng #${i + 1} phải > 0.`,
          400,
        );
      }

      const vendorPriceItemId =
        typeof raw['vendor_price_item_id'] === 'string' &&
        raw['vendor_price_item_id'].trim()
          ? raw['vendor_price_item_id'].trim()
          : typeof raw['vendorPriceItemId'] === 'string' &&
              raw['vendorPriceItemId'].trim()
            ? raw['vendorPriceItemId'].trim()
            : null;
      const mappedCat = vendorPriceItemId
        ? await loadCatalogItem(vendorPriceItemId)
        : null;

      const name =
        typeof raw['name'] === 'string' && raw['name'].trim()
          ? raw['name'].trim()
          : (mappedCat?.name ?? '');
      if (!name) {
        throw new AuthError(
          'VALIDATION_ERROR',
          `Tên sản phẩm dòng #${i + 1} không được để trống.`,
          400,
        );
      }

      const explicitCostMode = raw['vendorCostMode'] ?? raw['vendor_cost_mode'];
      const vendorCostMode: VendorCostModeType =
        explicitCostMode !== undefined
          ? parseVendorCostMode(explicitCostMode, VendorCostMode.PER_UNIT)
          : mappedCat
            ? mappedCat.pricing_mode
            : (raw['totalVendorCost'] ?? raw['total_vendor_cost']) !==
                  undefined &&
                (raw['unitVendorCost'] ?? raw['unit_vendor_cost']) === undefined
              ? VendorCostMode.TOTAL_BATCH
              : VendorCostMode.PER_UNIT;

      let baseCostRate: number | null;
      if (
        raw['baseCostPending'] === true ||
        raw['base_cost_pending'] === true
      ) {
        baseCostRate = null;
      } else {
        const rawRateField =
          raw['baseCostRate'] !== undefined ||
          raw['base_cost_rate'] !== undefined
            ? (raw['baseCostRate'] ?? raw['base_cost_rate'])
            : vendorCostMode === VendorCostMode.TOTAL_BATCH &&
                (raw['totalVendorCost'] !== undefined ||
                  raw['total_vendor_cost'] !== undefined)
              ? (raw['totalVendorCost'] ?? raw['total_vendor_cost'])
              : (raw['unitVendorCost'] ?? raw['unit_vendor_cost']);

        const parsedBase = parseExplicitOrPendingRate(
          rawRateField,
          `Giá cơ bản dòng "${name}"`,
        );
        if (parsedBase === 'OMITTED') {
          if (mappedCat) {
            baseCostRate =
              vendorCostMode === VendorCostMode.TOTAL_BATCH
                ? mappedCat.batch_total_cost
                : mappedCat.unit_cost;
          } else {
            throw new AuthError(
              'VALIDATION_ERROR',
              `Dòng sản phẩm "${name}" phải có giá cơ bản (hoặc đánh dấu Chờ giá xưởng).`,
              400,
            );
          }
        } else {
          baseCostRate = parsedBase;
        }
      }

      const rawBaseSource = raw['baseCostSource'] ?? raw['base_cost_source'];
      let baseCostSource: LineCostSourceType;
      if (
        rawBaseSource === LineCostSource.CATALOG ||
        rawBaseSource === LineCostSource.MANUAL ||
        rawBaseSource === LineCostSource.CATALOG_OVERRIDDEN
      ) {
        baseCostSource = rawBaseSource;
      } else if (mappedCat) {
        const catRate =
          mappedCat.pricing_mode === VendorCostMode.TOTAL_BATCH
            ? mappedCat.batch_total_cost
            : mappedCat.unit_cost;
        baseCostSource =
          baseCostRate === null ||
          baseCostRate !== catRate ||
          vendorCostMode !== mappedCat.pricing_mode
            ? LineCostSource.CATALOG_OVERRIDDEN
            : LineCostSource.CATALOG;
      } else {
        baseCostSource = LineCostSource.MANUAL;
      }

      const rawIncluded =
        raw['baseIncludedStages'] ?? raw['base_included_stages'];
      const baseIncludedStages =
        rawIncluded !== undefined
          ? normalizeStringArray(rawIncluded)
          : (mappedCat?.included_stages ?? []);

      const unit =
        typeof raw['unit'] === 'string' && raw['unit'].trim()
          ? raw['unit'].trim()
          : (mappedCat?.unit ??
            (vendorCostMode === VendorCostMode.PER_SQM ? 'm²' : 'tờ'));

      const catBaseOriginalRate = mappedCat
        ? mappedCat.pricing_mode === VendorCostMode.TOTAL_BATCH
          ? mappedCat.batch_total_cost
          : mappedCat.unit_cost
        : null;

      if (mappedCat && vendorCostMode === VendorCostMode.TOTAL_BATCH) {
        const baseBatchCond = evaluateCatalogBatchQuantityCondition({
          itemName: mappedCat.name,
          itemCode: mappedCat.code,
          itemType: mappedCat.item_type,
          pricingMode: mappedCat.pricing_mode,
          batchQuantity: mappedCat.batch_quantity,
          structuredSpec: mappedCat.structured_spec,
          costSource:
            baseCostRate === null ? LineCostSource.MANUAL : baseCostSource,
          lineQuantity: quantity,
          unit,
        });
        if (!baseBatchCond.allowed) {
          throw new AuthError(
            'BATCH_QUANTITY_MISMATCH',
            baseBatchCond.reason!,
            409,
          );
        }
      }

      const areaSpec = parseAreaSpecInput(raw['areaSpec'] ?? raw['area_spec']);

      const rawStagesArr = Array.isArray(
        raw['finishingStages'] ?? raw['finishing_stages'],
      )
        ? ((raw['finishingStages'] ?? raw['finishing_stages']) as unknown[])
        : [];
      const resolvedStages: PendingCostDraftStageSnapshot[] = [];

      for (let sIdx = 0; sIdx < rawStagesArr.length; sIdx++) {
        const stgRaw = (rawStagesArr[sIdx] ?? {}) as Record<string, unknown>;
        const stgId =
          typeof stgRaw['id'] === 'string' && stgRaw['id'].trim()
            ? stgRaw['id'].trim()
            : `STG-${i + 1}-${sIdx + 1}`;
        const stgPriceItemId =
          typeof stgRaw['priceItemId'] === 'string' &&
          stgRaw['priceItemId'].trim()
            ? stgRaw['priceItemId'].trim()
            : typeof stgRaw['price_item_id'] === 'string' &&
                stgRaw['price_item_id'].trim()
              ? stgRaw['price_item_id'].trim()
              : null;
        const stgCat = stgPriceItemId
          ? await loadCatalogItem(stgPriceItemId)
          : null;
        if (stgCat && stgCat.item_type !== PriceItemType.FINISHING) {
          throw new AuthError(
            'VALIDATION_ERROR',
            `Mục "${stgCat.name}" là giá in cơ bản, không thể chọn làm công đoạn gia công.`,
            400,
          );
        }

        const stgModeRaw = stgRaw['pricingMode'] ?? stgRaw['pricing_mode'];
        const stgMode =
          stgModeRaw !== undefined
            ? parseVendorCostMode(stgModeRaw, VendorCostMode.PER_UNIT)
            : (stgCat?.pricing_mode ?? VendorCostMode.PER_UNIT);

        const stgName =
          typeof stgRaw['name'] === 'string' && stgRaw['name'].trim()
            ? stgRaw['name'].trim()
            : (stgCat?.name ?? '');
        if (!stgName) {
          throw new AuthError(
            'VALIDATION_ERROR',
            `Công đoạn gia công #${sIdx + 1} của "${name}" phải có tên rõ ràng.`,
            400,
          );
        }

        let stgRate: number | null;
        if (stgRaw['ratePending'] === true || stgRaw['rate_pending'] === true) {
          stgRate = null;
        } else {
          const parsedStgRate = parseExplicitOrPendingRate(
            stgRaw['rate'],
            `Giá công đoạn "${stgName}"`,
          );
          if (parsedStgRate === 'OMITTED') {
            stgRate = stgCat
              ? stgMode === VendorCostMode.TOTAL_BATCH
                ? stgCat.batch_total_cost
                : stgCat.unit_cost
              : null;
          } else {
            stgRate = parsedStgRate;
          }
        }

        const rawStgSource = stgRaw['costSource'] ?? stgRaw['cost_source'];
        let stgCostSource: LineCostSourceType;
        if (
          rawStgSource === LineCostSource.CATALOG ||
          rawStgSource === LineCostSource.MANUAL ||
          rawStgSource === LineCostSource.CATALOG_OVERRIDDEN
        ) {
          stgCostSource = rawStgSource;
        } else if (stgCat) {
          const catStgRate =
            stgCat.pricing_mode === VendorCostMode.TOTAL_BATCH
              ? stgCat.batch_total_cost
              : stgCat.unit_cost;
          stgCostSource =
            stgRate === null ||
            stgRate !== catStgRate ||
            stgMode !== stgCat.pricing_mode
              ? LineCostSource.CATALOG_OVERRIDDEN
              : LineCostSource.CATALOG;
        } else {
          stgCostSource = LineCostSource.MANUAL;
        }

        const rawStgArea =
          stgRaw['billableAreaSqm'] ?? stgRaw['billable_area_sqm'];
        const stgBillableArea =
          rawStgArea !== undefined && rawStgArea !== null && rawStgArea !== ''
            ? toNum(rawStgArea, -1)
            : null;

        const stgUnit =
          typeof stgRaw['unit'] === 'string' && stgRaw['unit'].trim()
            ? stgRaw['unit'].trim()
            : (stgCat?.unit ??
              (stgMode === VendorCostMode.PER_SQM ? 'm²' : unit));
        const stgCatOrigRate = stgCat
          ? stgCat.pricing_mode === VendorCostMode.TOTAL_BATCH
            ? stgCat.batch_total_cost
            : stgCat.unit_cost
          : null;

        if (stgCat && stgMode === VendorCostMode.TOTAL_BATCH) {
          const stgBatchCond = evaluateCatalogBatchQuantityCondition({
            itemName: stgCat.name,
            itemCode: stgCat.code,
            itemType: stgCat.item_type,
            pricingMode: stgCat.pricing_mode,
            batchQuantity: stgCat.batch_quantity,
            structuredSpec: stgCat.structured_spec,
            costSource:
              stgRate === null ? LineCostSource.MANUAL : stgCostSource,
            lineQuantity: quantity,
            unit: unit,
          });
          if (!stgBatchCond.allowed) {
            throw new AuthError(
              'BATCH_QUANTITY_MISMATCH',
              stgBatchCond.reason!,
              409,
            );
          }
        }

        resolvedStages.push({
          id: stgId,
          priceItemId: stgPriceItemId,
          code: stgCat?.code ?? null,
          ...(stgCat
            ? {
                priceItemVersion: stgCat.version,
                vendorId: stgCat.vendor_id,
                vendorName: stgCat.vendor_name,
                catalogOriginalRate: stgCatOrigRate,
                catalogBatchQuantity:
                  stgCat.pricing_mode === VendorCostMode.TOTAL_BATCH
                    ? stgCat.batch_quantity
                    : null,
                appliedAt: appliedAtIso,
              }
            : {}),
          name: stgName,
          pricingMode: stgMode,
          rate: stgRate,
          unit: stgUnit,
          billableAreaSqm: stgBillableArea,
          costSource: stgCostSource,
          note:
            typeof stgRaw['note'] === 'string'
              ? stgRaw['note'].trim() || null
              : (stgCat?.conditions_note ?? null),
        });
      }

      const rawProfit = raw['profit'] as Record<string, unknown> | undefined;
      const explicitProfitMode =
        rawProfit?.['mode'] ?? raw['profit_mode'] ?? raw['profitMode'];
      const explicitProfitScope =
        rawProfit?.['scope'] ?? raw['profit_scope'] ?? raw['profitScope'];
      const explicitProfitVal =
        rawProfit?.['value'] ?? raw['profit_value'] ?? raw['profitValue'];

      const profitMode: ProfitModeType =
        explicitProfitMode !== undefined
          ? explicitProfitMode === ProfitMode.PERCENTAGE
            ? ProfitMode.PERCENTAGE
            : ProfitMode.FIXED_AMOUNT
          : (mappedCat?.default_profit_mode ?? ProfitMode.FIXED_AMOUNT);
      const profitScope: ProfitScopeType =
        explicitProfitScope !== undefined
          ? parseProfitScope(explicitProfitScope, ProfitScope.PER_UNIT)
          : (mappedCat?.default_profit_scope ??
            (vendorCostMode === VendorCostMode.PER_SQM
              ? ProfitScope.PER_SQM
              : ProfitScope.PER_UNIT));
      const profitVal = Math.max(
        0,
        toNum(explicitProfitVal, mappedCat?.default_profit_value ?? 0),
      );

      draftLines.push({
        id: lineId,
        name,
        specification:
          typeof raw['specification'] === 'string'
            ? raw['specification'].trim()
            : (mappedCat?.specification ?? ''),
        vendorId:
          typeof raw['vendor_id'] === 'string' && raw['vendor_id'].trim()
            ? raw['vendor_id'].trim()
            : typeof raw['vendorId'] === 'string' && raw['vendorId'].trim()
              ? raw['vendorId'].trim()
              : (mappedCat?.vendor_id ?? null),
        vendorName:
          typeof raw['vendor_name'] === 'string' && raw['vendor_name'].trim()
            ? raw['vendor_name'].trim()
            : typeof raw['vendorName'] === 'string' && raw['vendorName'].trim()
              ? raw['vendorName'].trim()
              : (mappedCat?.vendor_name ?? null),
        vendorPriceItemId,
        ...(mappedCat
          ? {
              vendorPriceItemCode: mappedCat.code,
              vendorPriceItemVersion: mappedCat.version,
              catalogOriginalRate: catBaseOriginalRate,
              catalogBatchQuantity:
                mappedCat.pricing_mode === VendorCostMode.TOTAL_BATCH
                  ? mappedCat.batch_quantity
                  : null,
              priceAppliedAt: appliedAtIso,
            }
          : {}),
        unit,
        quantity,
        vendorCostMode,
        baseCostRate,
        baseCostSource,
        ...(baseIncludedStages.length > 0 ? { baseIncludedStages } : {}),
        areaSpec,
        finishingStages: resolvedStages,
        profit: {
          mode: profitMode,
          scope: profitScope,
          value: profitVal,
        },
        extraCost: Math.max(0, toInt(raw['extraCost'] ?? raw['extra_cost'], 0)),
      });
    }

    const hasPending = draftLines.some(
      (dl) =>
        dl.baseCostRate === null ||
        (dl.finishingStages ?? []).some((s) => s.rate === null),
    );

    if (hasPending) {
      return {
        pricingStatus: QuotePricingStatus.PENDING_COST,
        draftLines: draftLines.map((dl) => {
          const copy: PendingCostDraftLineInput & { extraCost?: number } = {
            ...dl,
          };
          delete copy.extraCost;
          return copy;
        }),
      };
    }

    const completeLines: QuoteLineInput[] = draftLines.map((dl) => ({
      id: dl.id,
      name: dl.name,
      specification: dl.specification ?? '',
      vendorId: dl.vendorId ?? null,
      vendorName: dl.vendorName ?? null,
      vendorPriceItemId: dl.vendorPriceItemId ?? null,
      ...(dl.vendorPriceItemCode !== undefined
        ? { vendorPriceItemCode: dl.vendorPriceItemCode }
        : {}),
      ...(dl.vendorPriceItemVersion !== undefined
        ? { vendorPriceItemVersion: dl.vendorPriceItemVersion }
        : {}),
      ...(dl.catalogOriginalRate !== undefined
        ? { catalogOriginalRate: dl.catalogOriginalRate }
        : {}),
      ...(dl.catalogBatchQuantity !== undefined
        ? { catalogBatchQuantity: dl.catalogBatchQuantity }
        : {}),
      ...(dl.priceAppliedAt !== undefined
        ? { priceAppliedAt: dl.priceAppliedAt }
        : {}),
      unit: dl.unit ?? 'tờ',
      quantity: dl.quantity,
      vendorCostMode: dl.vendorCostMode,
      baseCostRate: dl.baseCostRate!,
      ...(dl.baseCostSource ? { baseCostSource: dl.baseCostSource } : {}),
      ...(dl.baseIncludedStages && dl.baseIncludedStages.length > 0
        ? { baseIncludedStages: [...dl.baseIncludedStages] }
        : {}),
      areaSpec: dl.areaSpec ?? null,
      finishingStages: (dl.finishingStages ?? []).map(
        (s): QuoteFinishingStageInput => ({
          id: s.id,
          priceItemId: s.priceItemId ?? null,
          code: s.code ?? null,
          ...(s.priceItemVersion !== undefined
            ? { priceItemVersion: s.priceItemVersion }
            : {}),
          ...(s.vendorId !== undefined ? { vendorId: s.vendorId } : {}),
          ...(s.vendorName !== undefined ? { vendorName: s.vendorName } : {}),
          ...(s.catalogOriginalRate !== undefined
            ? { catalogOriginalRate: s.catalogOriginalRate }
            : {}),
          ...(s.catalogBatchQuantity !== undefined
            ? { catalogBatchQuantity: s.catalogBatchQuantity }
            : {}),
          ...(s.appliedAt !== undefined ? { appliedAt: s.appliedAt } : {}),
          name: s.name,
          pricingMode: s.pricingMode,
          rate: s.rate!,
          unit: s.unit,
          billableAreaSqm: s.billableAreaSqm ?? null,
          costSource: s.costSource,
          note: s.note ?? null,
        }),
      ),
      profit: dl.profit,
      extraCost: dl.extraCost,
    }));

    return {
      pricingStatus: QuotePricingStatus.COMPLETE,
      lines: completeLines,
      costModes: completeLines.map((l) => l.vendorCostMode),
    };
  }

  async listQuotes(ctx: AuthenticatedContext): Promise<PrintQuoteData[]> {
    this.assertOwnerAccess(ctx);
    const res = await this.pool.query(
      `SELECT * FROM print_quotes WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [ctx.workspace.id],
    );
    return res.rows.map((r) => this.mapQuoteRow(r));
  }

  async getQuote(
    ctx: AuthenticatedContext,
    quoteId: string,
  ): Promise<PrintQuoteData> {
    this.assertOwnerAccess(ctx);
    const res = await this.pool.query(
      `SELECT * FROM print_quotes WHERE id = $1 AND workspace_id = $2`,
      [quoteId, ctx.workspace.id],
    );
    const row = res.rows[0];
    if (!row) {
      throw new AuthError('NOT_FOUND', 'Không tìm thấy báo giá.', 404);
    }
    const verRes = await this.pool.query(
      `SELECT * FROM print_quote_versions WHERE quote_id = $1 AND workspace_id = $2 ORDER BY version_number DESC`,
      [quoteId, ctx.workspace.id],
    );
    const quote = this.mapQuoteRow(row);
    quote.versions = verRes.rows.map((v) => this.mapQuoteVersionRow(v));
    return quote;
  }

  async getCustomerSafePdf(
    ctx: AuthenticatedContext,
    quoteId: string,
  ): Promise<CustomerSafePdfPayload> {
    this.assertOwnerAccess(ctx);
    const quote = await this.getQuote(ctx, quoteId);
    if (
      quote.pricing_status === QuotePricingStatus.PENDING_COST ||
      !quote.customer_pdf_json
    ) {
      throw new AuthError(
        'QUOTE_PENDING_VENDOR_COST',
        'Báo giá đang ở trạng thái Chờ giá xưởng nên chưa thể xem hoặc xuất PDF báo khách. Vui lòng bổ sung đầy đủ giá xưởng trước.',
        409,
      );
    }
    const pdfPayload = quote.customer_pdf_json;
    assertCustomerSafePdfPayload(pdfPayload);
    return pdfPayload;
  }

  async createQuote(
    ctx: AuthenticatedContext,
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<PrintQuoteData> {
    this.assertOwnerAccess(ctx);

    return this.withIdempotentTransaction(
      ctx,
      'POST',
      '/api/v1/print-quotes/quotes',
      input,
      idempotencyKey,
      201,
      async (client) => {
        const customerId =
          typeof input['customer_id'] === 'string' &&
          input['customer_id'].trim()
            ? input['customer_id'].trim()
            : null;
        let customerName =
          typeof input['customer_name'] === 'string'
            ? input['customer_name'].trim()
            : '';
        let customerPhone =
          typeof input['customer_phone'] === 'string'
            ? input['customer_phone'].trim() || null
            : null;
        let customerAddress =
          typeof input['customer_address'] === 'string'
            ? input['customer_address'].trim() || null
            : null;

        if (customerId) {
          const cRes = await client.query(
            `SELECT * FROM print_customers WHERE id = $1 AND workspace_id = $2`,
            [customerId, ctx.workspace.id],
          );
          const cust = cRes.rows[0];
          if (!cust) {
            throw new AuthError(
              'NOT_FOUND',
              'Không tìm thấy khách hàng đã chọn.',
              404,
            );
          }
          if (!customerName) customerName = String(cust['name']);
          if (!customerPhone && cust['phone'])
            customerPhone = String(cust['phone']);
          if (!customerAddress && cust['address'])
            customerAddress = String(cust['address']);
        }

        if (!customerName) {
          customerName = 'Khách lẻ';
        }

        const quoteCode = await this.allocateNextCode(
          client,
          ctx.workspace.id,
          'QUOTE',
          input['quote_code'],
        );

        const title =
          typeof input['title'] === 'string' && input['title'].trim()
            ? input['title'].trim()
            : `Báo giá in ấn — ${customerName}`;

        const resolvedOutcome = await this.resolveQuoteLinesWithCatalog(
          client,
          ctx.workspace.id,
          input['items'],
        );

        const includeShippingInUnitPrice =
          input['include_shipping_in_unit_price'] !== undefined
            ? Boolean(input['include_shipping_in_unit_price'])
            : input['includeShippingInUnitPrice'] !== undefined
              ? Boolean(input['includeShippingInUnitPrice'])
              : true;

        const rawStrategy =
          input['shipping_allocation_strategy'] ??
          input['shippingAllocationStrategy'];
        const shippingAllocationStrategy: ShippingAllocationStrategyType =
          rawStrategy === ShippingAllocationStrategy.PROPORTIONAL_BY_QUANTITY ||
          rawStrategy === ShippingAllocationStrategy.EQUAL_SPLIT
            ? rawStrategy
            : ShippingAllocationStrategy.PROPORTIONAL_BY_BASE_AMOUNT;

        const rawRoundingMode = input['rounding_mode'] ?? input['roundingMode'];
        const roundingMode: RoundingModeType =
          rawRoundingMode === RoundingMode.FLOOR ||
          rawRoundingMode === RoundingMode.CEIL
            ? rawRoundingMode
            : RoundingMode.NEAREST;
        const roundingStep = Math.max(
          1,
          toInt(input['rounding_step'] ?? input['roundingStep'], 1),
        );

        const shippingFee = Math.max(
          0,
          toInt(input['shipping_fee'] ?? input['shippingFee'], 0),
        );
        const extraCost = Math.max(
          0,
          toInt(input['extra_cost'] ?? input['extraCost'], 0),
        );

        const validUntil = toDateStr(input['valid_until']);
        const notes =
          typeof input['notes'] === 'string'
            ? input['notes'].trim() || null
            : null;

        if (resolvedOutcome.pricingStatus === QuotePricingStatus.PENDING_COST) {
          if (
            input['status'] !== undefined &&
            input['status'] !== QuoteOrderStatus.DRAFT
          ) {
            throw new AuthError(
              'QUOTE_PENDING_VENDOR_COST',
              'Báo giá đang có khoản Chờ giá xưởng nên chỉ được lưu ở trạng thái Bản nháp (DRAFT), chưa thể chốt hoặc gửi khách.',
              409,
            );
          }

          let pendingBuilt;
          try {
            pendingBuilt = createPendingCostQuoteSnapshot({
              quoteId: quoteCode,
              orderId: `SNAP-${quoteCode}-V1`,
              customerName,
              includeShippingInUnitPrice,
              shippingAllocationStrategy,
              shippingFee,
              lines: resolvedOutcome.draftLines,
              requireAreaAdjustmentReason: true,
            });
          } catch (err) {
            if (err instanceof AuthError) throw err;
            throw new AuthError(
              'VALIDATION_ERROR',
              err instanceof Error
                ? err.message
                : 'Dữ liệu bản nháp chờ giá xưởng không hợp lệ.',
              400,
            );
          }
          if (!verifyQuoteSnapshotIntegrity(pendingBuilt.snapshot)) {
            throw new AuthError(
              'INTERNAL_ERROR',
              'Pending-cost snapshot integrity check failed.',
              500,
            );
          }

          const insertPendingRes = await client.query(
            `INSERT INTO print_quotes (
              workspace_id, quote_code, title, customer_id, customer_name, customer_phone, customer_address,
              status, pricing_status, pending_cost_summary, current_version,
              include_shipping_in_unit_price, shipping_allocation_strategy,
              rounding_mode, rounding_step, total_quantity, total_vendor_cost, total_profit,
              shipping_fee, total_extra_cost, total_quote_amount, total_rounding_adjustment,
              single_product_final_unit_price, lines_json, snapshot_json, customer_pdf_json,
              integrity_hash, valid_until, notes, created_by, finalized_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7,
              'DRAFT', 'PENDING_COST', $8::jsonb, 1,
              $9, $10,
              $11, $12, $13, 0, 0,
              $14, $15, 0, 0,
              NULL, $16::jsonb, $17::jsonb, NULL,
              $18, $19, $20, $21, NULL
            ) RETURNING *`,
            [
              ctx.workspace.id,
              quoteCode,
              title,
              customerId,
              customerName,
              customerPhone,
              customerAddress,
              JSON.stringify(pendingBuilt.pendingSummary),
              includeShippingInUnitPrice,
              shippingAllocationStrategy,
              roundingMode,
              roundingStep,
              pendingBuilt.totalQuantity,
              shippingFee,
              extraCost,
              JSON.stringify(pendingBuilt.snapshot.lines),
              JSON.stringify(pendingBuilt.snapshot),
              pendingBuilt.snapshot.integrityHash,
              validUntil,
              notes,
              ctx.user.id,
            ],
          );

          const createdPendingRow = insertPendingRes.rows[0]!;
          const verPendingRes = await client.query(
            `INSERT INTO print_quote_versions (
              workspace_id, quote_id, version_number, status, pricing_status, pending_cost_summary,
              total_quantity, total_vendor_cost, total_profit, shipping_fee,
              total_extra_cost, total_quote_amount, total_rounding_adjustment,
              snapshot_json, customer_pdf_json, integrity_hash, change_note, created_by
            ) VALUES (
              $1, $2, 1, 'DRAFT', 'PENDING_COST', $3::jsonb,
              $4, 0, 0, $5,
              $6, 0, 0,
              $7::jsonb, NULL, $8, $9, $10
            ) RETURNING *`,
            [
              ctx.workspace.id,
              createdPendingRow['id'],
              JSON.stringify(pendingBuilt.pendingSummary),
              pendingBuilt.totalQuantity,
              shippingFee,
              extraCost,
              JSON.stringify(pendingBuilt.snapshot),
              pendingBuilt.snapshot.integrityHash,
              'Lưu bản nháp Chờ giá xưởng (v1)',
              ctx.user.id,
            ],
          );

          const mappedPending = this.mapQuoteRow(createdPendingRow);
          mappedPending.versions = [
            this.mapQuoteVersionRow(verPendingRes.rows[0]!),
          ];
          return mappedPending;
        }

        const { lines: items, costModes } = resolvedOutcome;

        let calcResult;
        try {
          calcResult = calculatePrintQuote({
            quoteId: quoteCode,
            customerName,
            items,
            shippingFee,
            extraCost,
            includeShippingInUnitPrice,
            shippingAllocationStrategy,
            roundingPolicy: {
              mode: roundingMode,
              step: roundingStep,
            },
            requireAreaAdjustmentReason: true,
          });
        } catch (err) {
          if (err instanceof AuthError) throw err;
          throw new AuthError(
            'VALIDATION_ERROR',
            err instanceof Error
              ? err.message
              : 'Dữ liệu tính toán báo giá không hợp lệ.',
            400,
          );
        }

        const status: QuoteOrderStatusType =
          input['status'] === QuoteOrderStatus.FINALIZED
            ? QuoteOrderStatus.FINALIZED
            : QuoteOrderStatus.DRAFT;

        const snapshot = createQuoteOrderSnapshot(calcResult, {
          orderId: `SNAP-${quoteCode}-V1`,
          status,
        });
        if (!verifyQuoteSnapshotIntegrity(snapshot)) {
          throw new AuthError(
            'INTERNAL_ERROR',
            'Snapshot integrity check failed.',
            500,
          );
        }

        const customerPdf = buildCustomerSafePdfPayload(calcResult, {
          quoteCode,
          customerPhone,
          customerAddress,
          validUntil,
          notes,
        });

        const persistedLinesJson: StoredQuoteLineJson[] = snapshot.lines.map(
          (snapLine, idx) =>
            costModes[idx]
              ? { ...snapLine, vendorCostMode: costModes[idx] }
              : snapLine,
        );

        const insertRes = await client.query(
          `INSERT INTO print_quotes (
            workspace_id, quote_code, title, customer_id, customer_name, customer_phone, customer_address,
            status, pricing_status, pending_cost_summary, current_version,
            include_shipping_in_unit_price, shipping_allocation_strategy,
            rounding_mode, rounding_step, total_quantity, total_vendor_cost, total_profit,
            shipping_fee, total_extra_cost, total_quote_amount, total_rounding_adjustment,
            single_product_final_unit_price, lines_json, snapshot_json, customer_pdf_json,
            integrity_hash, valid_until, notes, created_by, finalized_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, 'COMPLETE', '[]'::jsonb, 1,
            $9, $10,
            $11, $12, $13, $14, $15,
            $16, $17, $18, $19,
            $20, $21::jsonb, $22::jsonb, $23::jsonb,
            $24, $25, $26, $27, $28
          ) RETURNING *`,
          [
            ctx.workspace.id,
            quoteCode,
            title,
            customerId,
            customerName,
            customerPhone,
            customerAddress,
            status,
            includeShippingInUnitPrice,
            shippingAllocationStrategy,
            roundingMode,
            roundingStep,
            calcResult.totalQuantity,
            calcResult.totalVendorCost,
            calcResult.totalProfit,
            calcResult.shippingFee,
            calcResult.totalExtraCost,
            calcResult.totalQuoteAmount,
            calcResult.totalRoundingAdjustment,
            calcResult.singleProductFinalUnitPrice,
            JSON.stringify(persistedLinesJson),
            JSON.stringify(snapshot),
            JSON.stringify(customerPdf),
            snapshot.integrityHash,
            validUntil,
            notes,
            ctx.user.id,
            status === QuoteOrderStatus.FINALIZED ? new Date() : null,
          ],
        );

        const createdQuoteRow = insertRes.rows[0]!;
        const verRes = await client.query(
          `INSERT INTO print_quote_versions (
            workspace_id, quote_id, version_number, status, pricing_status, pending_cost_summary,
            total_quantity, total_vendor_cost, total_profit, shipping_fee,
            total_extra_cost, total_quote_amount, total_rounding_adjustment,
            snapshot_json, customer_pdf_json, integrity_hash, change_note, created_by
          ) VALUES (
            $1, $2, 1, $3, 'COMPLETE', '[]'::jsonb,
            $4, $5, $6, $7,
            $8, $9, $10,
            $11::jsonb, $12::jsonb, $13, $14, $15
          ) RETURNING *`,
          [
            ctx.workspace.id,
            createdQuoteRow['id'],
            status,
            calcResult.totalQuantity,
            calcResult.totalVendorCost,
            calcResult.totalProfit,
            calcResult.shippingFee,
            calcResult.totalExtraCost,
            calcResult.totalQuoteAmount,
            calcResult.totalRoundingAdjustment,
            JSON.stringify(snapshot),
            JSON.stringify(customerPdf),
            snapshot.integrityHash,
            'Khởi tạo báo giá phiên bản v1',
            ctx.user.id,
          ],
        );

        const mapped = this.mapQuoteRow(createdQuoteRow);
        mapped.versions = [this.mapQuoteVersionRow(verRes.rows[0]!)];
        return mapped;
      },
    );
  }

  async updateQuote(
    ctx: AuthenticatedContext,
    quoteId: string,
    input: Record<string, unknown>,
  ): Promise<PrintQuoteData> {
    this.assertOwnerAccess(ctx);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existingRes = await client.query(
        `SELECT * FROM print_quotes WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [quoteId, ctx.workspace.id],
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        throw new AuthError('NOT_FOUND', 'Không tìm thấy báo giá.', 404);
      }

      if (
        existing['status'] === QuoteOrderStatus.FINALIZED ||
        existing['status'] === QuoteOrderStatus.CONVERTED
      ) {
        throw new AuthError(
          'CONFLICT',
          `Báo giá (${existing['quote_code']}) đã chốt (${existing['status']}) — Không được phép sửa giá vốn, lợi nhuận hoặc đơn giá.`,
          409,
        );
      }

      const nextVersion = toInt(existing['current_version'], 1) + 1;
      const quoteCode = String(existing['quote_code']);
      const customerName =
        typeof input['customer_name'] === 'string' &&
        input['customer_name'].trim()
          ? input['customer_name'].trim()
          : String(existing['customer_name']);
      const customerPhone =
        input['customer_phone'] !== undefined
          ? typeof input['customer_phone'] === 'string'
            ? input['customer_phone'].trim() || null
            : null
          : existing['customer_phone']
            ? String(existing['customer_phone'])
            : null;
      const customerAddress =
        input['customer_address'] !== undefined
          ? typeof input['customer_address'] === 'string'
            ? input['customer_address'].trim() || null
            : null
          : existing['customer_address']
            ? String(existing['customer_address'])
            : null;
      const title =
        typeof input['title'] === 'string' && input['title'].trim()
          ? input['title'].trim()
          : String(existing['title']);

      const existingStoredLines =
        (existing['lines_json'] as StoredQuoteLineJson[]) ?? [];
      const existingCatalogIds = new Set<string>();
      for (const l of existingStoredLines) {
        if (l.vendorPriceItemId) existingCatalogIds.add(l.vendorPriceItemId);
        for (const s of l.finishingStages ?? []) {
          if (s.priceItemId) existingCatalogIds.add(s.priceItemId);
        }
      }

      const resolvedOutcome =
        input['items'] !== undefined
          ? await this.resolveQuoteLinesWithCatalog(
              client,
              ctx.workspace.id,
              input['items'],
              existingCatalogIds,
            )
          : this.reconstructStoredLinesOutcome(
              existingStoredLines,
              existing['pricing_status'],
            );

      const includeShippingInUnitPrice =
        input['include_shipping_in_unit_price'] !== undefined
          ? Boolean(input['include_shipping_in_unit_price'])
          : Boolean(existing['include_shipping_in_unit_price']);

      const shippingAllocationStrategy: ShippingAllocationStrategyType =
        (input['shipping_allocation_strategy'] as
          ShippingAllocationStrategyType | undefined) ??
        (existing[
          'shipping_allocation_strategy'
        ] as ShippingAllocationStrategyType);

      const roundingMode: RoundingModeType =
        (input['rounding_mode'] as RoundingModeType | undefined) ??
        (existing['rounding_mode'] as RoundingModeType);
      const roundingStep =
        input['rounding_step'] !== undefined
          ? Math.max(1, toInt(input['rounding_step'], 1))
          : Math.max(1, toInt(existing['rounding_step'], 1));

      const shippingFee =
        input['shipping_fee'] !== undefined
          ? Math.max(0, toInt(input['shipping_fee'], 0))
          : Math.max(0, toInt(existing['shipping_fee'], 0));
      const extraCost =
        input['extra_cost'] !== undefined
          ? Math.max(0, toInt(input['extra_cost'], 0))
          : Math.max(0, toInt(existing['total_extra_cost'], 0));

      const validUntil =
        input['valid_until'] !== undefined
          ? toDateStr(input['valid_until'])
          : toDateStr(existing['valid_until']);
      const notes =
        input['notes'] !== undefined
          ? typeof input['notes'] === 'string'
            ? input['notes'].trim() || null
            : null
          : existing['notes']
            ? String(existing['notes'])
            : null;

      if (resolvedOutcome.pricingStatus === QuotePricingStatus.PENDING_COST) {
        if (
          input['status'] !== undefined &&
          input['status'] !== QuoteOrderStatus.DRAFT
        ) {
          throw new AuthError(
            'QUOTE_PENDING_VENDOR_COST',
            'Báo giá đang còn khoản Chờ giá xưởng nên chưa thể chuyển sang trạng thái gửi khách hoặc chốt báo giá.',
            409,
          );
        }

        let pendingBuilt;
        try {
          pendingBuilt = createPendingCostQuoteSnapshot({
            quoteId: quoteCode,
            orderId: `SNAP-${quoteCode}-V${nextVersion}`,
            customerName,
            includeShippingInUnitPrice,
            shippingAllocationStrategy,
            shippingFee,
            lines: resolvedOutcome.draftLines,
            requireAreaAdjustmentReason: true,
          });
        } catch (err) {
          if (err instanceof AuthError) throw err;
          throw new AuthError(
            'VALIDATION_ERROR',
            err instanceof Error
              ? err.message
              : 'Dữ liệu bản nháp chờ giá xưởng không hợp lệ.',
            400,
          );
        }

        const updPendingRes = await client.query(
          `UPDATE print_quotes
           SET title = $1,
               customer_name = $2,
               customer_phone = $3,
               customer_address = $4,
               status = 'DRAFT',
               pricing_status = 'PENDING_COST',
               pending_cost_summary = $5::jsonb,
               current_version = $6,
               include_shipping_in_unit_price = $7,
               shipping_allocation_strategy = $8,
               rounding_mode = $9,
               rounding_step = $10,
               total_quantity = $11,
               total_vendor_cost = 0,
               total_profit = 0,
               shipping_fee = $12,
               total_extra_cost = $13,
               total_quote_amount = 0,
               total_rounding_adjustment = 0,
               single_product_final_unit_price = NULL,
               lines_json = $14::jsonb,
               snapshot_json = $15::jsonb,
               customer_pdf_json = NULL,
               integrity_hash = $16,
               valid_until = $17,
               notes = $18,
               updated_at = now()
           WHERE id = $19 AND workspace_id = $20
           RETURNING *`,
          [
            title,
            customerName,
            customerPhone,
            customerAddress,
            JSON.stringify(pendingBuilt.pendingSummary),
            nextVersion,
            includeShippingInUnitPrice,
            shippingAllocationStrategy,
            roundingMode,
            roundingStep,
            pendingBuilt.totalQuantity,
            shippingFee,
            extraCost,
            JSON.stringify(pendingBuilt.snapshot.lines),
            JSON.stringify(pendingBuilt.snapshot),
            pendingBuilt.snapshot.integrityHash,
            validUntil,
            notes,
            quoteId,
            ctx.workspace.id,
          ],
        );

        const pendingChangeNote =
          typeof input['change_note'] === 'string' &&
          input['change_note'].trim()
            ? input['change_note'].trim()
            : `Lưu nháp Chờ giá xưởng v${nextVersion}`;

        await client.query(
          `INSERT INTO print_quote_versions (
            workspace_id, quote_id, version_number, status, pricing_status, pending_cost_summary,
            total_quantity, total_vendor_cost, total_profit, shipping_fee,
            total_extra_cost, total_quote_amount, total_rounding_adjustment,
            snapshot_json, customer_pdf_json, integrity_hash, change_note, created_by
          ) VALUES (
            $1, $2, $3, 'DRAFT', 'PENDING_COST', $4::jsonb,
            $5, 0, 0, $6,
            $7, 0, 0,
            $8::jsonb, NULL, $9, $10, $11
          )`,
          [
            ctx.workspace.id,
            quoteId,
            nextVersion,
            JSON.stringify(pendingBuilt.pendingSummary),
            pendingBuilt.totalQuantity,
            shippingFee,
            extraCost,
            JSON.stringify(pendingBuilt.snapshot),
            pendingBuilt.snapshot.integrityHash,
            pendingChangeNote,
            ctx.user.id,
          ],
        );

        const verPendingRes = await client.query(
          `SELECT * FROM print_quote_versions WHERE quote_id = $1 AND workspace_id = $2 ORDER BY version_number DESC`,
          [quoteId, ctx.workspace.id],
        );

        await client.query('COMMIT');
        const mappedPending = this.mapQuoteRow(updPendingRes.rows[0]!);
        mappedPending.versions = verPendingRes.rows.map((v) =>
          this.mapQuoteVersionRow(v),
        );
        return mappedPending;
      }

      const { lines: items, costModes } = resolvedOutcome;

      let calcResult;
      try {
        calcResult = calculatePrintQuote({
          quoteId: quoteCode,
          customerName,
          items,
          shippingFee,
          extraCost,
          includeShippingInUnitPrice,
          shippingAllocationStrategy,
          roundingPolicy: {
            mode: roundingMode,
            step: roundingStep,
          },
          requireAreaAdjustmentReason: true,
        });
      } catch (err) {
        if (err instanceof AuthError) throw err;
        throw new AuthError(
          'VALIDATION_ERROR',
          err instanceof Error
            ? err.message
            : 'Dữ liệu tính toán báo giá không hợp lệ.',
          400,
        );
      }

      const nextStatus: QuoteOrderStatusType =
        input['status'] === QuoteOrderStatus.FINALIZED
          ? QuoteOrderStatus.FINALIZED
          : input['status'] === QuoteOrderStatus.SENT
            ? QuoteOrderStatus.SENT
            : input['status'] === QuoteOrderStatus.APPROVED
              ? QuoteOrderStatus.APPROVED
              : input['status'] === QuoteOrderStatus.DRAFT
                ? QuoteOrderStatus.DRAFT
                : (existing['status'] as QuoteOrderStatusType);

      const snapshot = createQuoteOrderSnapshot(calcResult, {
        orderId: `SNAP-${quoteCode}-V${nextVersion}`,
        status: nextStatus,
      });

      const customerPdf = buildCustomerSafePdfPayload(calcResult, {
        quoteCode,
        customerPhone,
        customerAddress,
        validUntil,
        notes,
      });

      const persistedLinesJson: StoredQuoteLineJson[] = snapshot.lines.map(
        (snapLine, idx) =>
          costModes[idx]
            ? { ...snapLine, vendorCostMode: costModes[idx] }
            : snapLine,
      );

      const updRes = await client.query(
        `UPDATE print_quotes
         SET title = $1,
             customer_name = $2,
             customer_phone = $3,
             customer_address = $4,
             status = $5,
             pricing_status = 'COMPLETE',
             pending_cost_summary = '[]'::jsonb,
             current_version = $6,
             include_shipping_in_unit_price = $7,
             shipping_allocation_strategy = $8,
             rounding_mode = $9,
             rounding_step = $10,
             total_quantity = $11,
             total_vendor_cost = $12,
             total_profit = $13,
             shipping_fee = $14,
             total_extra_cost = $15,
             total_quote_amount = $16,
             total_rounding_adjustment = $17,
             single_product_final_unit_price = $18,
             lines_json = $19::jsonb,
             snapshot_json = $20::jsonb,
             customer_pdf_json = $21::jsonb,
             integrity_hash = $22,
             valid_until = $23,
             notes = $24,
             finalized_at = CASE WHEN $5 = 'FINALIZED' AND finalized_at IS NULL THEN now() ELSE finalized_at END,
             updated_at = now()
         WHERE id = $25 AND workspace_id = $26
         RETURNING *`,
        [
          title,
          customerName,
          customerPhone,
          customerAddress,
          nextStatus,
          nextVersion,
          includeShippingInUnitPrice,
          shippingAllocationStrategy,
          roundingMode,
          roundingStep,
          calcResult.totalQuantity,
          calcResult.totalVendorCost,
          calcResult.totalProfit,
          calcResult.shippingFee,
          calcResult.totalExtraCost,
          calcResult.totalQuoteAmount,
          calcResult.totalRoundingAdjustment,
          calcResult.singleProductFinalUnitPrice,
          JSON.stringify(persistedLinesJson),
          JSON.stringify(snapshot),
          JSON.stringify(customerPdf),
          snapshot.integrityHash,
          validUntil,
          notes,
          quoteId,
          ctx.workspace.id,
        ],
      );

      const changeNote =
        typeof input['change_note'] === 'string' && input['change_note'].trim()
          ? input['change_note'].trim()
          : `Cập nhật báo giá lên phiên bản v${nextVersion}`;

      await client.query(
        `INSERT INTO print_quote_versions (
          workspace_id, quote_id, version_number, status, pricing_status, pending_cost_summary,
          total_quantity, total_vendor_cost, total_profit, shipping_fee,
          total_extra_cost, total_quote_amount, total_rounding_adjustment,
          snapshot_json, customer_pdf_json, integrity_hash, change_note, created_by
        ) VALUES (
          $1, $2, $3, $4, 'COMPLETE', '[]'::jsonb,
          $5, $6, $7, $8,
          $9, $10, $11,
          $12::jsonb, $13::jsonb, $14, $15, $16
        )`,
        [
          ctx.workspace.id,
          quoteId,
          nextVersion,
          nextStatus,
          calcResult.totalQuantity,
          calcResult.totalVendorCost,
          calcResult.totalProfit,
          calcResult.shippingFee,
          calcResult.totalExtraCost,
          calcResult.totalQuoteAmount,
          calcResult.totalRoundingAdjustment,
          JSON.stringify(snapshot),
          JSON.stringify(customerPdf),
          snapshot.integrityHash,
          changeNote,
          ctx.user.id,
        ],
      );

      const verRes = await client.query(
        `SELECT * FROM print_quote_versions WHERE quote_id = $1 AND workspace_id = $2 ORDER BY version_number DESC`,
        [quoteId, ctx.workspace.id],
      );

      await client.query('COMMIT');
      const mapped = this.mapQuoteRow(updRes.rows[0]!);
      mapped.versions = verRes.rows.map((v) => this.mapQuoteVersionRow(v));
      return mapped;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteQuote(
    ctx: AuthenticatedContext,
    quoteId: string,
  ): Promise<{ deleted: true; id: string }> {
    this.assertOwnerAccess(ctx);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existingRes = await client.query(
        `SELECT id, quote_code, status FROM print_quotes WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [quoteId, ctx.workspace.id],
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        throw new AuthError('NOT_FOUND', 'Không tìm thấy báo giá.', 404);
      }

      const ordRes = await client.query(
        `SELECT order_code FROM print_orders WHERE workspace_id = $1 AND quote_id = $2 LIMIT 1`,
        [ctx.workspace.id, quoteId],
      );
      if (ordRes.rows.length > 0) {
        throw new AuthError(
          'QUOTE_DELETE_FORBIDDEN',
          `Báo giá ${String(existing['quote_code'])} đã có đơn hàng (${String(ordRes.rows[0]?.['order_code'])}) nên không được phép xóa.`,
          409,
        );
      }

      if (existing['status'] !== QuoteOrderStatus.DRAFT) {
        throw new AuthError(
          'QUOTE_DELETE_FORBIDDEN',
          `Chỉ được phép xóa báo giá ở trạng thái Bản nháp (DRAFT). Báo giá ${String(existing['quote_code'])} đang ở trạng thái ${String(existing['status'])} nên phải giữ nguyên lịch sử.`,
          409,
        );
      }

      await client.query(
        `DELETE FROM print_quotes WHERE id = $1 AND workspace_id = $2`,
        [quoteId, ctx.workspace.id],
      );
      await client.query('COMMIT');
      return { deleted: true, id: quoteId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async finalizeQuote(
    ctx: AuthenticatedContext,
    quoteId: string,
  ): Promise<PrintQuoteData> {
    this.assertOwnerAccess(ctx);
    return this.updateQuote(ctx, quoteId, {
      status: QuoteOrderStatus.FINALIZED,
      change_note: 'Chốt báo giá bất biến (FINALIZED)',
    });
  }

  private mapQuoteRow(r: Record<string, unknown>): PrintQuoteData {
    const pricingStatus: QuotePricingStatusType =
      r['pricing_status'] === QuotePricingStatus.PENDING_COST
        ? QuotePricingStatus.PENDING_COST
        : QuotePricingStatus.COMPLETE;
    const pendingSummary = Array.isArray(r['pending_cost_summary'])
      ? (r['pending_cost_summary'] as PendingCostLineSummary[])
      : [];

    return {
      id: String(r['id']),
      workspace_id: String(r['workspace_id']),
      quote_code: String(r['quote_code']),
      title: String(r['title']),
      customer_id: r['customer_id'] ? String(r['customer_id']) : null,
      customer_name: String(r['customer_name']),
      customer_phone: r['customer_phone'] ? String(r['customer_phone']) : null,
      customer_address: r['customer_address']
        ? String(r['customer_address'])
        : null,
      status: (r['status'] as QuoteOrderStatusType) || QuoteOrderStatus.DRAFT,
      pricing_status: pricingStatus,
      pending_cost_summary: pendingSummary,
      current_version: toInt(r['current_version'], 1),
      include_shipping_in_unit_price: Boolean(
        r['include_shipping_in_unit_price'],
      ),
      shipping_allocation_strategy:
        (r['shipping_allocation_strategy'] as ShippingAllocationStrategyType) ||
        ShippingAllocationStrategy.PROPORTIONAL_BY_BASE_AMOUNT,
      rounding_mode:
        (r['rounding_mode'] as RoundingModeType) || RoundingMode.NEAREST,
      rounding_step: toInt(r['rounding_step'], 1),
      total_quantity: toInt(r['total_quantity'], 0),
      total_vendor_cost: toInt(r['total_vendor_cost'], 0),
      total_profit: toInt(r['total_profit'], 0),
      shipping_fee: toInt(r['shipping_fee'], 0),
      total_extra_cost: toInt(r['total_extra_cost'], 0),
      total_quote_amount: toInt(r['total_quote_amount'], 0),
      total_rounding_adjustment: toInt(r['total_rounding_adjustment'], 0),
      single_product_final_unit_price:
        r['single_product_final_unit_price'] !== null &&
        r['single_product_final_unit_price'] !== undefined
          ? toInt(r['single_product_final_unit_price'], 0)
          : null,
      lines_json: (r['lines_json'] as PersistedQuoteLineSnapshot[]) ?? [],
      snapshot_json: r['snapshot_json'] as PersistedQuoteOrderSnapshot,
      customer_pdf_json: r['customer_pdf_json']
        ? (r['customer_pdf_json'] as CustomerSafePdfPayload)
        : null,
      integrity_hash: String(r['integrity_hash']),
      valid_until: toDateStr(r['valid_until']),
      notes: r['notes'] ? String(r['notes']) : null,
      created_by: r['created_by'] ? String(r['created_by']) : null,
      finalized_at: r['finalized_at'] ? toIso(r['finalized_at']) : null,
      created_at: toIso(r['created_at']),
      updated_at: toIso(r['updated_at']),
    };
  }

  private mapQuoteVersionRow(
    r: Record<string, unknown>,
  ): PrintQuoteVersionData {
    const pricingStatus: QuotePricingStatusType =
      r['pricing_status'] === QuotePricingStatus.PENDING_COST
        ? QuotePricingStatus.PENDING_COST
        : QuotePricingStatus.COMPLETE;
    const pendingSummary = Array.isArray(r['pending_cost_summary'])
      ? (r['pending_cost_summary'] as PendingCostLineSummary[])
      : [];

    return {
      id: String(r['id']),
      quote_id: String(r['quote_id']),
      version_number: toInt(r['version_number'], 1),
      status: (r['status'] as QuoteOrderStatusType) || QuoteOrderStatus.DRAFT,
      pricing_status: pricingStatus,
      pending_cost_summary: pendingSummary,
      total_quantity: toInt(r['total_quantity'], 0),
      total_vendor_cost: toInt(r['total_vendor_cost'], 0),
      total_profit: toInt(r['total_profit'], 0),
      shipping_fee: toInt(r['shipping_fee'], 0),
      total_extra_cost: toInt(r['total_extra_cost'], 0),
      total_quote_amount: toInt(r['total_quote_amount'], 0),
      total_rounding_adjustment: toInt(r['total_rounding_adjustment'], 0),
      snapshot_json: r['snapshot_json'] as PersistedQuoteOrderSnapshot,
      customer_pdf_json: r['customer_pdf_json']
        ? (r['customer_pdf_json'] as CustomerSafePdfPayload)
        : null,
      integrity_hash: String(r['integrity_hash']),
      change_note: r['change_note'] ? String(r['change_note']) : null,
      created_by: r['created_by'] ? String(r['created_by']) : null,
      created_at: toIso(r['created_at']),
    };
  }

  // ==========================================================================
  // 5. ORDERS, PRODUCTION/DELIVERY TRACKING, DEPOSITS & PAYMENTS (PHASE 4)
  // ==========================================================================

  private computePaymentStatus(
    totalQuoteAmount: number,
    depositPaid: number,
    totalPaidAmount: number,
  ): PrintPaymentStatusType {
    if (totalPaidAmount <= 0) return PrintPaymentStatus.UNPAID;
    if (totalPaidAmount >= totalQuoteAmount && totalQuoteAmount > 0) {
      return PrintPaymentStatus.PAID;
    }
    if (depositPaid > 0 && totalPaidAmount === depositPaid) {
      return PrintPaymentStatus.DEPOSIT_PAID;
    }
    return PrintPaymentStatus.PARTIALLY_PAID;
  }

  private parseOptionalCostComponent(
    input: Record<string, unknown>,
    enteredKey: string,
    aliasActualKey: string,
    label: string,
  ): { provided: boolean; value: number | null } {
    const raw =
      input[enteredKey] !== undefined
        ? input[enteredKey]
        : input[aliasActualKey];
    if (raw === undefined) {
      return { provided: false, value: null };
    }
    if (raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      return { provided: true, value: null };
    }
    const num =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number(raw.trim())
          : Number.NaN;
    if (
      !Number.isFinite(num) ||
      !Number.isInteger(num) ||
      num < 0 ||
      num > 1_000_000_000_000
    ) {
      throw new AuthError(
        'VALIDATION_ERROR',
        `${label} phải là số nguyên không âm hợp lệ (VND).`,
        400,
      );
    }
    return { provided: true, value: num };
  }

  private mapCostHistoryRow(
    r: Record<string, unknown>,
  ): PrintOrderCostHistoryData {
    return {
      id: String(r['id']),
      workspace_id: String(r['workspace_id']),
      order_id: String(r['order_id']),
      action: r['action'] as OrderCostHistoryActionType,
      before_json:
        (r['before_json'] as Record<string, unknown> | undefined) ?? {},
      after_json:
        (r['after_json'] as Record<string, unknown> | undefined) ?? {},
      note: r['note'] ? String(r['note']) : null,
      changed_by: r['changed_by'] ? String(r['changed_by']) : null,
      created_at: toIso(r['created_at']),
    };
  }

  private async insertOrderCostHistory(
    client: pg.PoolClient,
    params: {
      workspaceId: string;
      orderId: string;
      action: OrderCostHistoryActionType;
      beforeJson: Record<string, unknown>;
      afterJson: Record<string, unknown>;
      note: string | null;
      changedBy: string | null;
    },
  ): Promise<PrintOrderCostHistoryData> {
    const res = await client.query(
      `INSERT INTO print_order_cost_history (
         workspace_id, order_id, action, before_json, after_json, note, changed_by
       ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
       RETURNING *`,
      [
        params.workspaceId,
        params.orderId,
        params.action,
        JSON.stringify(params.beforeJson),
        JSON.stringify(params.afterJson),
        params.note,
        params.changedBy,
      ],
    );
    return this.mapCostHistoryRow(res.rows[0]!);
  }

  async listOrders(ctx: AuthenticatedContext): Promise<PrintOrderData[]> {
    this.assertOwnerAccess(ctx);
    const res = await this.pool.query(
      `SELECT * FROM print_orders WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [ctx.workspace.id],
    );
    const orders = res.rows.map((r) => this.mapOrderRow(r));
    if (orders.length > 0) {
      const [payRes, histRes] = await Promise.all([
        this.pool.query(
          `SELECT * FROM print_order_payments WHERE workspace_id = $1 ORDER BY paid_at ASC`,
          [ctx.workspace.id],
        ),
        this.pool.query(
          `SELECT * FROM print_order_cost_history WHERE workspace_id = $1 ORDER BY created_at DESC`,
          [ctx.workspace.id],
        ),
      ]);
      const paymentsByOrder = new Map<string, PrintOrderPaymentData[]>();
      for (const row of payRes.rows) {
        const p = this.mapPaymentRow(row);
        const arr = paymentsByOrder.get(p.order_id) ?? [];
        arr.push(p);
        paymentsByOrder.set(p.order_id, arr);
      }
      const historyByOrder = new Map<string, PrintOrderCostHistoryData[]>();
      for (const row of histRes.rows) {
        const h = this.mapCostHistoryRow(row);
        const arr = historyByOrder.get(h.order_id) ?? [];
        arr.push(h);
        historyByOrder.set(h.order_id, arr);
      }
      for (const ord of orders) {
        ord.payments = paymentsByOrder.get(ord.id) ?? [];
        ord.cost_history = historyByOrder.get(ord.id) ?? [];
      }
    }
    return orders;
  }

  async getOrder(
    ctx: AuthenticatedContext,
    orderId: string,
  ): Promise<PrintOrderData> {
    this.assertOwnerAccess(ctx);
    const res = await this.pool.query(
      `SELECT * FROM print_orders WHERE id = $1 AND workspace_id = $2`,
      [orderId, ctx.workspace.id],
    );
    const row = res.rows[0];
    if (!row) {
      throw new AuthError('NOT_FOUND', 'Không tìm thấy đơn hàng in ấn.', 404);
    }
    const [payRes, histRes] = await Promise.all([
      this.pool.query(
        `SELECT * FROM print_order_payments WHERE order_id = $1 AND workspace_id = $2 ORDER BY paid_at ASC`,
        [orderId, ctx.workspace.id],
      ),
      this.pool.query(
        `SELECT * FROM print_order_cost_history WHERE order_id = $1 AND workspace_id = $2 ORDER BY created_at DESC`,
        [orderId, ctx.workspace.id],
      ),
    ]);
    const order = this.mapOrderRow(row);
    order.payments = payRes.rows.map((p) => this.mapPaymentRow(p));
    order.cost_history = histRes.rows.map((h) => this.mapCostHistoryRow(h));
    return order;
  }

  async createOrderFromQuote(
    ctx: AuthenticatedContext,
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<PrintOrderData> {
    this.assertOwnerAccess(ctx);
    const quoteId =
      typeof input['quote_id'] === 'string' ? input['quote_id'].trim() : '';
    if (!quoteId) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Mã báo giá (quote_id) là bắt buộc để tạo đơn hàng.',
        400,
      );
    }

    return this.withIdempotentTransaction(
      ctx,
      'POST',
      '/api/v1/print-quotes/orders',
      input,
      idempotencyKey,
      201,
      async (client) => {
        const qRes = await client.query(
          `SELECT * FROM print_quotes WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
          [quoteId, ctx.workspace.id],
        );
        const quoteRow = qRes.rows[0];
        if (!quoteRow) {
          throw new AuthError(
            'NOT_FOUND',
            'Không tìm thấy báo giá để chuyển thành đơn hàng.',
            404,
          );
        }

        if (quoteRow['status'] === QuoteOrderStatus.CANCELLED) {
          throw new AuthError(
            'VALIDATION_ERROR',
            'Không thể chuyển báo giá đã hủy thành đơn hàng.',
            400,
          );
        }

        if (
          quoteRow['pricing_status'] === QuotePricingStatus.PENDING_COST ||
          !quoteRow['customer_pdf_json']
        ) {
          throw new AuthError(
            'QUOTE_PENDING_VENDOR_COST',
            `Báo giá ${String(quoteRow['quote_code'])} đang ở trạng thái Chờ giá xưởng nên chưa thể chuyển thành đơn hàng. Vui lòng nhập đầy đủ giá xưởng và hoàn tất báo giá trước.`,
            409,
          );
        }

        // Kiểm tra chống chuyển trùng cùng một báo giá thành nhiều đơn hàng
        const existingOrderRes = await client.query<{
          id: string;
          order_code: string;
        }>(
          `SELECT id, order_code FROM print_orders WHERE workspace_id = $1 AND quote_id = $2 LIMIT 1`,
          [ctx.workspace.id, quoteId],
        );
        if (
          existingOrderRes.rows.length > 0 ||
          quoteRow['status'] === QuoteOrderStatus.CONVERTED
        ) {
          const existingCode = existingOrderRes.rows[0]?.order_code;
          throw new AuthError(
            'CONFLICT',
            `Báo giá ${String(quoteRow['quote_code'])} đã được chuyển thành đơn hàng${existingCode ? ` (${existingCode})` : ''}. Không thể chuyển cùng một báo giá thành nhiều đơn hàng.`,
            409,
          );
        }

        // Khóa báo giá sang trạng thái CONVERTED (chốt bất biến)
        await client.query(
          `UPDATE print_quotes
           SET status = 'CONVERTED',
               finalized_at = COALESCE(finalized_at, now()),
               updated_at = now()
           WHERE id = $1 AND workspace_id = $2`,
          [quoteId, ctx.workspace.id],
        );

        const orderCode = await this.allocateNextCode(
          client,
          ctx.workspace.id,
          'ORDER',
          input['order_code'],
        );

        const totalQuoteAmount = toInt(quoteRow['total_quote_amount'], 0);
        const expectedVendorCost = toInt(quoteRow['total_vendor_cost'], 0);
        const expectedShippingFee = toInt(quoteRow['shipping_fee'], 0);
        const expectedExtraCost = toInt(quoteRow['total_extra_cost'], 0);
        const expectedProfit = toInt(quoteRow['total_profit'], 0);

        const vendorField = this.parseOptionalCostComponent(
          input,
          'entered_vendor_cost',
          'actual_vendor_cost',
          'Giá vốn xưởng thực tế',
        );
        const shippingField = this.parseOptionalCostComponent(
          input,
          'entered_shipping_fee',
          'actual_shipping_fee',
          'Phí vận chuyển thực tế',
        );
        const extraField = this.parseOptionalCostComponent(
          input,
          'entered_extra_cost',
          'actual_extra_cost',
          'Chi phí phát sinh thực tế',
        );

        const enteredVendorCost = vendorField.provided
          ? vendorField.value
          : null;
        const enteredShippingFee = shippingField.provided
          ? shippingField.value
          : null;
        const enteredExtraCost = extraField.provided ? extraField.value : null;
        const enteredCount = [
          enteredVendorCost,
          enteredShippingFee,
          enteredExtraCost,
        ].filter((v) => v !== null).length;

        const wantsConfirm = input['actual_cost_confirmed'] === true;
        if (wantsConfirm && enteredCount < 3) {
          throw new AuthError(
            'INCOMPLETE_ACTUAL_COST_CONFIRMATION',
            'Chỉ được xác nhận đối soát lợi nhuận thực tế khi đã nhập đầy đủ cả 3 khoản: Giá vốn xưởng, Phí vận chuyển thực tế và Chi phí phát sinh (nhập 0 nếu không phát sinh). Hệ thống không tự mượn chi phí dự kiến cho khoản chưa kiểm tra.',
            400,
          );
        }

        const actualCostConfirmed = wantsConfirm;
        const costReconciliationStatus: OrderCostReconciliationStatusType =
          actualCostConfirmed
            ? OrderCostReconciliationStatus.CONFIRMED
            : input['actual_cost_confirmed'] === false
              ? OrderCostReconciliationStatus.NEEDS_REVIEW
              : enteredCount === 0
                ? OrderCostReconciliationStatus.UNVERIFIED
                : enteredCount < 3
                  ? OrderCostReconciliationStatus.PARTIAL_ENTERED
                  : OrderCostReconciliationStatus.ENTERED_UNCONFIRMED;

        const actualVendorCost = actualCostConfirmed ? enteredVendorCost! : 0;
        const actualShippingFee = actualCostConfirmed ? enteredShippingFee! : 0;
        const actualExtraCost = actualCostConfirmed ? enteredExtraCost! : 0;
        const actualProfit = actualCostConfirmed
          ? totalQuoteAmount -
            actualVendorCost -
            actualShippingFee -
            actualExtraCost
          : 0;

        const vendorPaidAmount =
          input['vendor_paid_amount'] !== undefined
            ? toInt(input['vendor_paid_amount'], -1)
            : 0;
        if (vendorPaidAmount < 0) {
          throw new AuthError(
            'VALIDATION_ERROR',
            'Số tiền đã thanh toán cho nhà in (vendor_paid_amount) không được âm.',
            400,
          );
        }

        const rawDepositRequired = toInt(input['deposit_required'], 0);
        const rawInitialDepositPaid = toInt(input['deposit_paid'], 0);
        if (rawDepositRequired < 0 || rawInitialDepositPaid < 0) {
          throw new AuthError(
            'VALIDATION_ERROR',
            'Số tiền đặt cọc không được âm.',
            400,
          );
        }
        if (rawDepositRequired > totalQuoteAmount) {
          throw new AuthError(
            'VALIDATION_ERROR',
            `Số tiền yêu cầu đặt cọc (${rawDepositRequired} VND) không được vượt quá tổng giá trị đơn hàng (${totalQuoteAmount} VND).`,
            400,
          );
        }
        if (rawInitialDepositPaid > totalQuoteAmount) {
          throw new AuthError(
            'VALIDATION_ERROR',
            `Số tiền đặt cọc ban đầu (${rawInitialDepositPaid} VND) không được vượt quá tổng giá trị đơn hàng (${totalQuoteAmount} VND).`,
            400,
          );
        }

        const depositRequired = rawDepositRequired;
        const initialDepositPaid = rawInitialDepositPaid;
        const totalPaidAmount = initialDepositPaid;
        const remainingDebtAmount = totalQuoteAmount - totalPaidAmount;
        const paymentStatus = this.computePaymentStatus(
          totalQuoteAmount,
          initialDepositPaid,
          totalPaidAmount,
        );

        const lines =
          (quoteRow['lines_json'] as PersistedQuoteLineSnapshot[]) ?? [];
        const firstLineVendorId = lines[0]?.vendorId ?? null;
        const firstLineVendorName = lines[0]?.vendorName ?? null;

        const vendorId =
          typeof input['vendor_id'] === 'string' && input['vendor_id'].trim()
            ? input['vendor_id'].trim()
            : firstLineVendorId;
        const vendorName =
          typeof input['vendor_name'] === 'string' &&
          input['vendor_name'].trim()
            ? input['vendor_name'].trim()
            : firstLineVendorName;

        const orderDate =
          toDateStr(input['order_date']) ??
          new Date().toISOString().slice(0, 10);
        const printOrderedAt = toDateStr(input['print_ordered_at']);
        const dueDate = toDateStr(input['due_date']);

        const productionStatus: PrintProductionStatusType =
          (input['production_status'] as
            PrintProductionStatusType | undefined) ??
          PrintProductionStatus.PENDING;
        const deliveryStatus: PrintDeliveryStatusType =
          (input['delivery_status'] as PrintDeliveryStatusType | undefined) ??
          PrintDeliveryStatus.NOT_SHIPPED;

        const ordRes = await client.query(
          `INSERT INTO print_orders (
            workspace_id, order_code, quote_id, quote_code, quote_version,
            customer_id, customer_name, customer_phone, customer_address,
            vendor_id, vendor_name, title, order_date, print_ordered_at, due_date,
            production_status, delivery_status, payment_status,
            total_quote_amount, expected_vendor_cost, expected_shipping_fee, expected_extra_cost, expected_profit,
            cost_reconciliation_status, actual_cost_confirmed, actual_cost_confirmed_at, actual_cost_confirmed_by,
            entered_vendor_cost, entered_shipping_fee, entered_extra_cost,
            actual_vendor_cost, actual_shipping_fee, actual_extra_cost, actual_profit, vendor_paid_amount,
            deposit_required, deposit_paid, total_paid_amount, remaining_debt_amount,
            snapshot_json, integrity_hash, notes, created_by
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9,
            $10, $11, $12, $13, $14, $15,
            $16, $17, $18,
            $19, $20, $21, $22, $23,
            $24, $25, $26, $27,
            $28, $29, $30,
            $31, $32, $33, $34, $35,
            $36, $37, $38, $39,
            $40::jsonb, $41, $42, $43
          ) RETURNING *`,
          [
            ctx.workspace.id,
            orderCode,
            quoteId,
            String(quoteRow['quote_code']),
            toInt(quoteRow['current_version'], 1),
            quoteRow['customer_id'],
            String(quoteRow['customer_name']),
            quoteRow['customer_phone'],
            quoteRow['customer_address'],
            vendorId,
            vendorName,
            typeof input['title'] === 'string' && input['title'].trim()
              ? input['title'].trim()
              : String(quoteRow['title']),
            orderDate,
            printOrderedAt,
            dueDate,
            productionStatus,
            deliveryStatus,
            paymentStatus,
            totalQuoteAmount,
            expectedVendorCost,
            expectedShippingFee,
            expectedExtraCost,
            expectedProfit,
            costReconciliationStatus,
            actualCostConfirmed,
            actualCostConfirmed ? new Date() : null,
            actualCostConfirmed ? ctx.user.id : null,
            enteredVendorCost,
            enteredShippingFee,
            enteredExtraCost,
            actualVendorCost,
            actualShippingFee,
            actualExtraCost,
            actualProfit,
            vendorPaidAmount,
            depositRequired,
            initialDepositPaid,
            totalPaidAmount,
            remainingDebtAmount,
            JSON.stringify(quoteRow['snapshot_json']),
            String(quoteRow['integrity_hash']),
            typeof input['notes'] === 'string'
              ? input['notes'].trim() || null
              : quoteRow['notes'],
            ctx.user.id,
          ],
        );

        const createdOrder = this.mapOrderRow(ordRes.rows[0]!);
        createdOrder.payments = [];
        createdOrder.cost_history = [];

        const costNote =
          typeof input['cost_note'] === 'string' && input['cost_note'].trim()
            ? input['cost_note'].trim()
            : null;
        const afterSnap = {
          cost_reconciliation_status: costReconciliationStatus,
          actual_cost_confirmed: actualCostConfirmed,
          entered_vendor_cost: enteredVendorCost,
          entered_shipping_fee: enteredShippingFee,
          entered_extra_cost: enteredExtraCost,
          actual_profit: actualCostConfirmed ? actualProfit : null,
          vendor_paid_amount: vendorPaidAmount,
        };

        if (actualCostConfirmed || enteredCount > 0) {
          const h = await this.insertOrderCostHistory(client, {
            workspaceId: ctx.workspace.id,
            orderId: createdOrder.id,
            action: actualCostConfirmed ? 'CONFIRMED' : 'ENTERED',
            beforeJson: {
              cost_reconciliation_status:
                OrderCostReconciliationStatus.UNVERIFIED,
              actual_cost_confirmed: false,
              entered_vendor_cost: null,
              entered_shipping_fee: null,
              entered_extra_cost: null,
              actual_profit: null,
              vendor_paid_amount: 0,
            },
            afterJson: afterSnap,
            note: costNote,
            changedBy: ctx.user.id,
          });
          createdOrder.cost_history.unshift(h);
        }

        if (vendorPaidAmount > 0) {
          const vh = await this.insertOrderCostHistory(client, {
            workspaceId: ctx.workspace.id,
            orderId: createdOrder.id,
            action: 'VENDOR_PAYMENT_NOTE',
            beforeJson: { vendor_paid_amount: 0 },
            afterJson: { vendor_paid_amount: vendorPaidAmount },
            note: costNote,
            changedBy: ctx.user.id,
          });
          createdOrder.cost_history.unshift(vh);
        }

        if (initialDepositPaid > 0) {
          const pRes = await client.query(
            `INSERT INTO print_order_payments (
              workspace_id, order_id, payment_type, amount, payment_method, note, recorded_by
            ) VALUES ($1, $2, 'DEPOSIT', $3, $4, $5, $6)
            RETURNING *`,
            [
              ctx.workspace.id,
              createdOrder.id,
              initialDepositPaid,
              typeof input['payment_method'] === 'string'
                ? input['payment_method']
                : 'BANK_TRANSFER',
              'Thu tiền cọc khi khởi tạo đơn hàng',
              ctx.user.id,
            ],
          );
          createdOrder.payments = [this.mapPaymentRow(pRes.rows[0]!)];
        }

        return createdOrder;
      },
    );
  }

  async updateOrder(
    ctx: AuthenticatedContext,
    orderId: string,
    input: Record<string, unknown>,
  ): Promise<PrintOrderData> {
    this.assertOwnerAccess(ctx);

    const vendorField = this.parseOptionalCostComponent(
      input,
      'entered_vendor_cost',
      'actual_vendor_cost',
      'Giá vốn xưởng thực tế',
    );
    const shippingField = this.parseOptionalCostComponent(
      input,
      'entered_shipping_fee',
      'actual_shipping_fee',
      'Phí vận chuyển thực tế',
    );
    const extraField = this.parseOptionalCostComponent(
      input,
      'entered_extra_cost',
      'actual_extra_cost',
      'Chi phí phát sinh thực tế',
    );

    if (
      input['vendor_paid_amount'] !== undefined &&
      toInt(input['vendor_paid_amount'], -1) < 0
    ) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Số tiền đã thanh toán cho nhà in (vendor_paid_amount) không được âm.',
        400,
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existingRes = await client.query(
        `SELECT * FROM print_orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [orderId, ctx.workspace.id],
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        throw new AuthError('NOT_FOUND', 'Không tìm thấy đơn hàng in ấn.', 404);
      }

      const totalQuoteAmount = toInt(existing['total_quote_amount'], 0);
      const wasConfirmed = Boolean(existing['actual_cost_confirmed']);
      const prevStatus =
        (existing[
          'cost_reconciliation_status'
        ] as OrderCostReconciliationStatusType) ||
        OrderCostReconciliationStatus.UNVERIFIED;

      const prevEnteredVendor =
        existing['entered_vendor_cost'] !== null &&
        existing['entered_vendor_cost'] !== undefined
          ? toInt(existing['entered_vendor_cost'], 0)
          : null;
      const prevEnteredShipping =
        existing['entered_shipping_fee'] !== null &&
        existing['entered_shipping_fee'] !== undefined
          ? toInt(existing['entered_shipping_fee'], 0)
          : null;
      const prevEnteredExtra =
        existing['entered_extra_cost'] !== null &&
        existing['entered_extra_cost'] !== undefined
          ? toInt(existing['entered_extra_cost'], 0)
          : null;
      const prevVendorPaid = toInt(existing['vendor_paid_amount'], 0);

      const nextEnteredVendor = vendorField.provided
        ? vendorField.value
        : prevEnteredVendor;
      const nextEnteredShipping = shippingField.provided
        ? shippingField.value
        : prevEnteredShipping;
      const nextEnteredExtra = extraField.provided
        ? extraField.value
        : prevEnteredExtra;

      const touchesCostFields =
        vendorField.provided || shippingField.provided || extraField.provided;
      const enteredCount = [
        nextEnteredVendor,
        nextEnteredShipping,
        nextEnteredExtra,
      ].filter((v) => v !== null).length;

      let nextConfirmed: boolean;
      let nextStatus: OrderCostReconciliationStatusType;

      if (input['actual_cost_confirmed'] === false) {
        nextConfirmed = false;
        nextStatus = OrderCostReconciliationStatus.NEEDS_REVIEW;
      } else if (input['actual_cost_confirmed'] === true) {
        if (enteredCount < 3) {
          throw new AuthError(
            'INCOMPLETE_ACTUAL_COST_CONFIRMATION',
            'Chỉ được xác nhận đối soát lợi nhuận thực tế khi đã nhập đầy đủ cả 3 khoản: Giá vốn xưởng, Phí vận chuyển thực tế và Chi phí phát sinh (nhập 0 nếu không phát sinh). Hệ thống không tự mượn chi phí dự kiến cho khoản chưa kiểm tra.',
            400,
          );
        }
        nextConfirmed = true;
        nextStatus = OrderCostReconciliationStatus.CONFIRMED;
      } else if (touchesCostFields) {
        // Explicit cost field edit WITHOUT actual_cost_confirmed: true NEVER auto-confirms!
        nextConfirmed = false;
        nextStatus =
          enteredCount === 0
            ? prevStatus === OrderCostReconciliationStatus.NEEDS_REVIEW ||
              wasConfirmed
              ? OrderCostReconciliationStatus.NEEDS_REVIEW
              : OrderCostReconciliationStatus.UNVERIFIED
            : enteredCount < 3
              ? OrderCostReconciliationStatus.PARTIAL_ENTERED
              : OrderCostReconciliationStatus.ENTERED_UNCONFIRMED;
      } else {
        // Non-cost update (e.g., production_status, delivery_status, notes, vendor_paid_amount)
        nextConfirmed = wasConfirmed;
        nextStatus = prevStatus;
      }

      // Preserve raw legacy DB columns untouched if the order has never been confirmed
      const dbActualVendor = nextConfirmed
        ? nextEnteredVendor!
        : wasConfirmed
          ? 0
          : toInt(existing['actual_vendor_cost'], 0);
      const dbActualShipping = nextConfirmed
        ? nextEnteredShipping!
        : wasConfirmed
          ? 0
          : toInt(existing['actual_shipping_fee'], 0);
      const dbActualExtra = nextConfirmed
        ? nextEnteredExtra!
        : wasConfirmed
          ? 0
          : toInt(existing['actual_extra_cost'], 0);
      const dbActualProfit = nextConfirmed
        ? totalQuoteAmount - dbActualVendor - dbActualShipping - dbActualExtra
        : wasConfirmed
          ? 0
          : toInt(existing['actual_profit'], 0);

      const vendorPaidAmount =
        input['vendor_paid_amount'] !== undefined
          ? toInt(input['vendor_paid_amount'], 0)
          : prevVendorPaid;

      const depositRequired =
        input['deposit_required'] !== undefined
          ? Math.max(0, toInt(input['deposit_required'], 0))
          : toInt(existing['deposit_required'], 0);

      const productionStatus: PrintProductionStatusType =
        input['production_status'] !== undefined
          ? (input['production_status'] as PrintProductionStatusType)
          : (existing['production_status'] as PrintProductionStatusType);

      const deliveryStatus: PrintDeliveryStatusType =
        input['delivery_status'] !== undefined
          ? (input['delivery_status'] as PrintDeliveryStatusType)
          : (existing['delivery_status'] as PrintDeliveryStatusType);

      const printOrderedAt =
        input['print_ordered_at'] !== undefined
          ? toDateStr(input['print_ordered_at'])
          : toDateStr(existing['print_ordered_at']);
      const dueDate =
        input['due_date'] !== undefined
          ? toDateStr(input['due_date'])
          : toDateStr(existing['due_date']);

      const confirmTimestampRefresh =
        nextConfirmed && (!wasConfirmed || touchesCostFields);

      const updRes = await client.query(
        `UPDATE print_orders
         SET print_ordered_at = $1,
             due_date = $2,
             production_status = $3,
             delivery_status = $4,
             cost_reconciliation_status = $5,
             actual_cost_confirmed = $6,
             actual_cost_confirmed_at = CASE
               WHEN $6 = false THEN NULL
               WHEN $19 = true OR actual_cost_confirmed_at IS NULL THEN now()
               ELSE actual_cost_confirmed_at
             END,
             actual_cost_confirmed_by = CASE
               WHEN $6 = false THEN NULL
               WHEN $19 = true OR actual_cost_confirmed_by IS NULL THEN $20
               ELSE actual_cost_confirmed_by
             END,
             entered_vendor_cost = $7,
             entered_shipping_fee = $8,
             entered_extra_cost = $9,
             actual_vendor_cost = $10,
             actual_shipping_fee = $11,
             actual_extra_cost = $12,
             actual_profit = $13,
             vendor_paid_amount = $21,
             deposit_required = $14,
             vendor_id = $15,
             vendor_name = $16,
             notes = $17,
             completed_at = CASE WHEN $3 = 'COMPLETED' AND completed_at IS NULL THEN now() ELSE completed_at END,
             delivered_at = CASE WHEN $4 = 'DELIVERED' AND delivered_at IS NULL THEN now() ELSE delivered_at END,
             updated_at = now()
         WHERE id = $18 AND workspace_id = $22
         RETURNING *`,
        [
          printOrderedAt,
          dueDate,
          productionStatus,
          deliveryStatus,
          nextStatus,
          nextConfirmed,
          nextEnteredVendor,
          nextEnteredShipping,
          nextEnteredExtra,
          dbActualVendor,
          dbActualShipping,
          dbActualExtra,
          dbActualProfit,
          depositRequired,
          input['vendor_id'] !== undefined
            ? typeof input['vendor_id'] === 'string' &&
              input['vendor_id'].trim()
              ? input['vendor_id'].trim()
              : null
            : existing['vendor_id'],
          input['vendor_name'] !== undefined
            ? typeof input['vendor_name'] === 'string' &&
              input['vendor_name'].trim()
              ? input['vendor_name'].trim()
              : null
            : existing['vendor_name'],
          input['notes'] !== undefined
            ? typeof input['notes'] === 'string'
              ? input['notes'].trim() || null
              : null
            : existing['notes'],
          orderId,
          confirmTimestampRefresh,
          ctx.user.id,
          vendorPaidAmount,
          ctx.workspace.id,
        ],
      );

      const costNote =
        typeof input['cost_note'] === 'string' && input['cost_note'].trim()
          ? input['cost_note'].trim()
          : null;

      const costStateChanged =
        nextConfirmed !== wasConfirmed ||
        nextStatus !== prevStatus ||
        nextEnteredVendor !== prevEnteredVendor ||
        nextEnteredShipping !== prevEnteredShipping ||
        nextEnteredExtra !== prevEnteredExtra;

      if (costStateChanged) {
        const beforeSnap = {
          cost_reconciliation_status: prevStatus,
          actual_cost_confirmed: wasConfirmed,
          entered_vendor_cost: prevEnteredVendor,
          entered_shipping_fee: prevEnteredShipping,
          entered_extra_cost: prevEnteredExtra,
          actual_profit: wasConfirmed
            ? toInt(existing['actual_profit'], 0)
            : null,
        };
        const afterSnap = {
          cost_reconciliation_status: nextStatus,
          actual_cost_confirmed: nextConfirmed,
          entered_vendor_cost: nextEnteredVendor,
          entered_shipping_fee: nextEnteredShipping,
          entered_extra_cost: nextEnteredExtra,
          actual_profit: nextConfirmed ? dbActualProfit : null,
        };
        const action: OrderCostHistoryActionType =
          wasConfirmed && !nextConfirmed
            ? 'UNCONFIRMED'
            : !wasConfirmed && nextConfirmed
              ? 'CONFIRMED'
              : wasConfirmed && nextConfirmed
                ? 'ADJUSTED'
                : 'ENTERED';

        await this.insertOrderCostHistory(client, {
          workspaceId: ctx.workspace.id,
          orderId,
          action,
          beforeJson: beforeSnap,
          afterJson: afterSnap,
          note: costNote,
          changedBy: ctx.user.id,
        });
      }

      if (vendorPaidAmount !== prevVendorPaid) {
        await this.insertOrderCostHistory(client, {
          workspaceId: ctx.workspace.id,
          orderId,
          action: 'VENDOR_PAYMENT_NOTE',
          beforeJson: { vendor_paid_amount: prevVendorPaid },
          afterJson: { vendor_paid_amount: vendorPaidAmount },
          note: costNote,
          changedBy: ctx.user.id,
        });
      }

      const [payRes, histRes] = await Promise.all([
        client.query(
          `SELECT * FROM print_order_payments WHERE order_id = $1 AND workspace_id = $2 ORDER BY paid_at ASC`,
          [orderId, ctx.workspace.id],
        ),
        client.query(
          `SELECT * FROM print_order_cost_history WHERE order_id = $1 AND workspace_id = $2 ORDER BY created_at DESC`,
          [orderId, ctx.workspace.id],
        ),
      ]);

      await client.query('COMMIT');

      const mapped = this.mapOrderRow(updRes.rows[0]!);
      mapped.payments = payRes.rows.map((p) => this.mapPaymentRow(p));
      mapped.cost_history = histRes.rows.map((h) => this.mapCostHistoryRow(h));
      return mapped;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async recordOrderPayment(
    ctx: AuthenticatedContext,
    orderId: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<PrintOrderData> {
    this.assertOwnerAccess(ctx);
    const amount = toInt(input['amount'], 0);
    if (amount <= 0) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Số tiền thanh toán phải > 0 VND.',
        400,
      );
    }

    const paymentType =
      input['payment_type'] === 'DEPOSIT' ||
      input['payment_type'] === 'FINAL' ||
      input['payment_type'] === 'REFUND'
        ? input['payment_type']
        : 'INSTALLMENT';
    const paymentMethod =
      input['payment_method'] === 'CASH' ||
      input['payment_method'] === 'QR_VIETQR' ||
      input['payment_method'] === 'OTHER'
        ? input['payment_method']
        : 'BANK_TRANSFER';

    return this.withIdempotentTransaction(
      ctx,
      'POST',
      `/api/v1/print-quotes/orders/${orderId}/payments`,
      input,
      idempotencyKey,
      201,
      async (client) => {
        const ordRes = await client.query(
          `SELECT * FROM print_orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
          [orderId, ctx.workspace.id],
        );
        const ord = ordRes.rows[0];
        if (!ord) {
          throw new AuthError('NOT_FOUND', 'Không tìm thấy đơn hàng.', 404);
        }

        if (
          ord['production_status'] === PrintProductionStatus.CANCELLED &&
          paymentType !== 'REFUND'
        ) {
          throw new AuthError(
            'ORDER_CANCELLED',
            'Đơn hàng đã hủy không thể ghi nhận thu thêm tiền. Nếu cần hoàn trả cọc/tiền đã thu cho khách, vui lòng chọn loại giao dịch Hoàn tiền (REFUND).',
            409,
          );
        }

        const totalQuoteAmount = toInt(ord['total_quote_amount'], 0);

        const existingPayRes = await client.query(
          `SELECT * FROM print_order_payments WHERE order_id = $1 AND workspace_id = $2 ORDER BY paid_at ASC, created_at ASC`,
          [orderId, ctx.workspace.id],
        );
        const existingPayments = existingPayRes.rows.map((p) =>
          this.mapPaymentRow(p),
        );

        let runningDepositPaid = 0;
        let runningTotalPaid = 0;
        for (const p of existingPayments) {
          if (p.payment_type === 'REFUND') {
            runningTotalPaid = Math.max(0, runningTotalPaid - p.amount);
            runningDepositPaid = Math.min(runningDepositPaid, runningTotalPaid);
          } else {
            if (p.payment_type === 'DEPOSIT') {
              runningDepositPaid += p.amount;
            }
            runningTotalPaid += p.amount;
          }
        }

        const currentRemainingDebt = Math.max(
          0,
          totalQuoteAmount - runningTotalPaid,
        );

        if (paymentType === 'REFUND') {
          if (amount > runningTotalPaid) {
            throw new AuthError(
              'VALIDATION_ERROR',
              `Số tiền hoàn trả (${amount} VND) không được vượt quá tổng số tiền khách đã thanh toán (${runningTotalPaid} VND).`,
              400,
            );
          }
        } else {
          if (amount > currentRemainingDebt) {
            throw new AuthError(
              'VALIDATION_ERROR',
              `Số tiền thanh toán (${amount} VND) vượt quá công nợ còn lại của đơn hàng (${currentRemainingDebt} VND).`,
              400,
            );
          }
        }

        await client.query(
          `INSERT INTO print_order_payments (
            workspace_id, order_id, payment_type, amount, payment_method, reference_code, note, recorded_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            ctx.workspace.id,
            orderId,
            paymentType,
            amount,
            paymentMethod,
            typeof input['reference_code'] === 'string'
              ? input['reference_code'].trim() || null
              : null,
            typeof input['note'] === 'string'
              ? input['note'].trim() || null
              : null,
            ctx.user.id,
          ],
        );

        const payListRes = await client.query(
          `SELECT * FROM print_order_payments WHERE order_id = $1 AND workspace_id = $2 ORDER BY paid_at ASC, created_at ASC`,
          [orderId, ctx.workspace.id],
        );
        const payments = payListRes.rows.map((p) => this.mapPaymentRow(p));

        let depositPaid = 0;
        let totalPaidAmount = 0;
        for (const p of payments) {
          if (p.payment_type === 'REFUND') {
            totalPaidAmount = Math.max(0, totalPaidAmount - p.amount);
            depositPaid = Math.min(depositPaid, totalPaidAmount);
          } else {
            if (p.payment_type === 'DEPOSIT') {
              depositPaid += p.amount;
            }
            totalPaidAmount += p.amount;
          }
        }

        const remainingDebtAmount = Math.max(
          0,
          totalQuoteAmount - totalPaidAmount,
        );
        const paymentStatus = this.computePaymentStatus(
          totalQuoteAmount,
          depositPaid,
          totalPaidAmount,
        );

        const updRes = await client.query(
          `UPDATE print_orders
           SET deposit_paid = $1,
               total_paid_amount = $2,
               remaining_debt_amount = $3,
               payment_status = $4,
               updated_at = now()
           WHERE id = $5 AND workspace_id = $6
           RETURNING *`,
          [
            depositPaid,
            totalPaidAmount,
            remainingDebtAmount,
            paymentStatus,
            orderId,
            ctx.workspace.id,
          ],
        );

        const histRes = await client.query(
          `SELECT * FROM print_order_cost_history WHERE order_id = $1 AND workspace_id = $2 ORDER BY created_at DESC`,
          [orderId, ctx.workspace.id],
        );

        const updatedOrder = this.mapOrderRow(updRes.rows[0]!);
        updatedOrder.payments = payments;
        updatedOrder.cost_history = histRes.rows.map((h) =>
          this.mapCostHistoryRow(h),
        );
        return updatedOrder;
      },
    );
  }

  private mapOrderRow(r: Record<string, unknown>): PrintOrderData {
    const isConfirmed = Boolean(r['actual_cost_confirmed']);
    const reconStatus =
      (r['cost_reconciliation_status'] as OrderCostReconciliationStatusType) ||
      (isConfirmed
        ? OrderCostReconciliationStatus.CONFIRMED
        : OrderCostReconciliationStatus.UNVERIFIED);
    const enteredVendor =
      r['entered_vendor_cost'] !== null &&
      r['entered_vendor_cost'] !== undefined
        ? toInt(r['entered_vendor_cost'], 0)
        : null;
    const enteredShipping =
      r['entered_shipping_fee'] !== null &&
      r['entered_shipping_fee'] !== undefined
        ? toInt(r['entered_shipping_fee'], 0)
        : null;
    const enteredExtra =
      r['entered_extra_cost'] !== null && r['entered_extra_cost'] !== undefined
        ? toInt(r['entered_extra_cost'], 0)
        : null;

    const isLegacyNeedsReview =
      !isConfirmed &&
      reconStatus === OrderCostReconciliationStatus.NEEDS_REVIEW &&
      enteredVendor === null &&
      enteredShipping === null &&
      enteredExtra === null;

    return {
      id: String(r['id']),
      workspace_id: String(r['workspace_id']),
      order_code: String(r['order_code']),
      quote_id: String(r['quote_id']),
      quote_code: String(r['quote_code']),
      quote_version: toInt(r['quote_version'], 1),
      customer_id: r['customer_id'] ? String(r['customer_id']) : null,
      customer_name: String(r['customer_name']),
      customer_phone: r['customer_phone'] ? String(r['customer_phone']) : null,
      customer_address: r['customer_address']
        ? String(r['customer_address'])
        : null,
      vendor_id: r['vendor_id'] ? String(r['vendor_id']) : null,
      vendor_name: r['vendor_name'] ? String(r['vendor_name']) : null,
      title: String(r['title']),
      order_date:
        toDateStr(r['order_date']) ?? new Date().toISOString().slice(0, 10),
      print_ordered_at: toDateStr(r['print_ordered_at']),
      due_date: toDateStr(r['due_date']),
      completed_at: r['completed_at'] ? toIso(r['completed_at']) : null,
      delivered_at: r['delivered_at'] ? toIso(r['delivered_at']) : null,
      production_status:
        (r['production_status'] as PrintProductionStatusType) ||
        PrintProductionStatus.PENDING,
      delivery_status:
        (r['delivery_status'] as PrintDeliveryStatusType) ||
        PrintDeliveryStatus.NOT_SHIPPED,
      payment_status:
        (r['payment_status'] as PrintPaymentStatusType) ||
        PrintPaymentStatus.UNPAID,
      total_quote_amount: toInt(r['total_quote_amount'], 0),
      expected_vendor_cost: toInt(r['expected_vendor_cost'], 0),
      expected_shipping_fee: toInt(r['expected_shipping_fee'], 0),
      expected_extra_cost: toInt(r['expected_extra_cost'], 0),
      expected_profit: toInt(r['expected_profit'], 0),
      cost_reconciliation_status: reconStatus,
      actual_cost_confirmed: isConfirmed,
      actual_cost_confirmed_at: r['actual_cost_confirmed_at']
        ? toIso(r['actual_cost_confirmed_at'])
        : null,
      actual_cost_confirmed_by: r['actual_cost_confirmed_by']
        ? String(r['actual_cost_confirmed_by'])
        : null,
      entered_vendor_cost: enteredVendor,
      entered_shipping_fee: enteredShipping,
      entered_extra_cost: enteredExtra,
      actual_vendor_cost: isConfirmed
        ? toInt(r['actual_vendor_cost'], 0)
        : null,
      actual_shipping_fee: isConfirmed
        ? toInt(r['actual_shipping_fee'], 0)
        : null,
      actual_extra_cost: isConfirmed ? toInt(r['actual_extra_cost'], 0) : null,
      actual_profit: isConfirmed ? toInt(r['actual_profit'], 0) : null,
      legacy_raw_actual_costs: isLegacyNeedsReview
        ? {
            vendor_cost: toInt(r['actual_vendor_cost'], 0),
            shipping_fee: toInt(r['actual_shipping_fee'], 0),
            extra_cost: toInt(r['actual_extra_cost'], 0),
            profit: toInt(r['actual_profit'], 0),
          }
        : null,
      vendor_paid_amount: toInt(r['vendor_paid_amount'], 0),
      deposit_required: toInt(r['deposit_required'], 0),
      deposit_paid: toInt(r['deposit_paid'], 0),
      total_paid_amount: toInt(r['total_paid_amount'], 0),
      remaining_debt_amount: toInt(r['remaining_debt_amount'], 0),
      snapshot_json: r['snapshot_json'] as PersistedQuoteOrderSnapshot,
      integrity_hash: String(r['integrity_hash']),
      notes: r['notes'] ? String(r['notes']) : null,
      created_by: r['created_by'] ? String(r['created_by']) : null,
      created_at: toIso(r['created_at']),
      updated_at: toIso(r['updated_at']),
    };
  }

  private mapPaymentRow(r: Record<string, unknown>): PrintOrderPaymentData {
    return {
      id: String(r['id']),
      workspace_id: String(r['workspace_id']),
      order_id: String(r['order_id']),
      payment_type:
        (r['payment_type'] as PrintOrderPaymentData['payment_type']) ||
        'INSTALLMENT',
      amount: toInt(r['amount'], 0),
      payment_method:
        (r['payment_method'] as PrintOrderPaymentData['payment_method']) ||
        'BANK_TRANSFER',
      paid_at: toIso(r['paid_at']),
      reference_code: r['reference_code'] ? String(r['reference_code']) : null,
      note: r['note'] ? String(r['note']) : null,
      recorded_by: r['recorded_by'] ? String(r['recorded_by']) : null,
      created_at: toIso(r['created_at']),
    };
  }

  // ==========================================================================
  // 6. DASHBOARD ANALYTICS (THỐNG KÊ BÁO GIÁ, LỢI NHUẬN & CÔNG NỢ)
  // ==========================================================================

  async getDashboardStats(
    ctx: AuthenticatedContext,
  ): Promise<PrintQuoteDashboardStats> {
    this.assertOwnerAccess(ctx);
    const [vRes, pRes, cRes, qRes, oRes] = await Promise.all([
      this.pool.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM print_vendors WHERE workspace_id = $1 AND is_active = true`,
        [ctx.workspace.id],
      ),
      this.pool.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM print_vendor_price_items WHERE workspace_id = $1 AND is_active = true`,
        [ctx.workspace.id],
      ),
      this.pool.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM print_customers WHERE workspace_id = $1 AND is_active = true`,
        [ctx.workspace.id],
      ),
      this.pool.query<{ total_cnt: string; fin_cnt: string }>(
        `SELECT COUNT(*)::text AS total_cnt,
                COUNT(*) FILTER (WHERE status IN ('FINALIZED', 'CONVERTED'))::text AS fin_cnt
         FROM print_quotes WHERE workspace_id = $1`,
        [ctx.workspace.id],
      ),
      this.pool.query(
        `SELECT production_status, delivery_status, payment_status,
                total_quote_amount, expected_vendor_cost, expected_profit,
                cost_reconciliation_status, actual_cost_confirmed,
                entered_vendor_cost, entered_shipping_fee, entered_extra_cost,
                actual_vendor_cost, actual_shipping_fee, actual_extra_cost, actual_profit,
                vendor_paid_amount, total_paid_amount, remaining_debt_amount
         FROM print_orders
         WHERE workspace_id = $1`,
        [ctx.workspace.id],
      ),
    ]);

    const ordersByProd: Record<PrintProductionStatusType, number> = {
      PENDING: 0,
      PREPRESS: 0,
      PRINTING: 0,
      FINISHING: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };
    const ordersByDeliv: Record<PrintDeliveryStatusType, number> = {
      NOT_SHIPPED: 0,
      PACKING: 0,
      SHIPPING: 0,
      DELIVERED: 0,
      RETURNED: 0,
    };
    const ordersByPay: Record<PrintPaymentStatusType, number> = {
      UNPAID: 0,
      DEPOSIT_PAID: 0,
      PARTIALLY_PAID: 0,
      PAID: 0,
    };

    let activeOrdersCount = 0;
    let totalRevenue = 0;
    let totalExpectedCost = 0;
    let totalActualCost = 0;
    let totalExpectedProfit = 0;
    let totalActualProfit = 0;
    let confirmedActualOrdersCount = 0;
    let needsReviewOrdersCount = 0;
    let unconfirmedEnteredOrdersCount = 0;
    let totalVendorPaid = 0;
    let totalPaid = 0;
    let totalDebt = 0;

    let cancelledOrdersCount = 0;
    let cancelledWithObligationsCount = 0;
    let cancelledCustomerPaidHolding = 0;
    let cancelledVendorPaidAmount = 0;
    let cancelledConfirmedIncurredCost = 0;
    let cancelledUnconfirmedEnteredCost = 0;

    for (const r of oRes.rows) {
      const ps = r['production_status'] as PrintProductionStatusType;
      const ds = r['delivery_status'] as PrintDeliveryStatusType;
      const pays = r['payment_status'] as PrintPaymentStatusType;
      const reconStatus =
        (r[
          'cost_reconciliation_status'
        ] as OrderCostReconciliationStatusType) ||
        OrderCostReconciliationStatus.UNVERIFIED;
      const isConfirmed = Boolean(r['actual_cost_confirmed']);

      if (ordersByProd[ps] !== undefined) ordersByProd[ps]++;

      if (!isConfirmed) {
        if (reconStatus === OrderCostReconciliationStatus.NEEDS_REVIEW) {
          needsReviewOrdersCount++;
        } else if (
          reconStatus === OrderCostReconciliationStatus.PARTIAL_ENTERED ||
          reconStatus === OrderCostReconciliationStatus.ENTERED_UNCONFIRMED
        ) {
          unconfirmedEnteredOrdersCount++;
        }
      }

      if (ps === PrintProductionStatus.CANCELLED) {
        cancelledOrdersCount++;
        const paidHolding = toInt(r['total_paid_amount'], 0);
        const vPaid = toInt(r['vendor_paid_amount'], 0);
        const confirmedIncurred = isConfirmed
          ? toInt(r['actual_vendor_cost'], 0) +
            toInt(r['actual_shipping_fee'], 0) +
            toInt(r['actual_extra_cost'], 0)
          : 0;
        const enteredUnconfirmed = !isConfirmed
          ? (r['entered_vendor_cost'] !== null &&
            r['entered_vendor_cost'] !== undefined
              ? toInt(r['entered_vendor_cost'], 0)
              : 0) +
            (r['entered_shipping_fee'] !== null &&
            r['entered_shipping_fee'] !== undefined
              ? toInt(r['entered_shipping_fee'], 0)
              : 0) +
            (r['entered_extra_cost'] !== null &&
            r['entered_extra_cost'] !== undefined
              ? toInt(r['entered_extra_cost'], 0)
              : 0)
          : 0;

        if (
          paidHolding > 0 ||
          vPaid > 0 ||
          confirmedIncurred > 0 ||
          enteredUnconfirmed > 0
        ) {
          cancelledWithObligationsCount++;
        }
        cancelledCustomerPaidHolding += paidHolding;
        cancelledVendorPaidAmount += vPaid;
        cancelledConfirmedIncurredCost += confirmedIncurred;
        cancelledUnconfirmedEnteredCost += enteredUnconfirmed;
        continue;
      }

      activeOrdersCount++;
      if (ordersByDeliv[ds] !== undefined) ordersByDeliv[ds]++;
      if (ordersByPay[pays] !== undefined) ordersByPay[pays]++;

      totalRevenue += toInt(r['total_quote_amount'], 0);
      totalExpectedCost += toInt(r['expected_vendor_cost'], 0);
      totalExpectedProfit += toInt(r['expected_profit'], 0);
      if (isConfirmed) {
        confirmedActualOrdersCount++;
        totalActualCost += toInt(r['actual_vendor_cost'], 0);
        totalActualProfit += toInt(r['actual_profit'], 0);
      }
      totalVendorPaid += toInt(r['vendor_paid_amount'], 0);
      totalPaid += toInt(r['total_paid_amount'], 0);
      totalDebt += toInt(r['remaining_debt_amount'], 0);
    }

    return {
      total_vendors: toInt(vRes.rows[0]?.cnt, 0),
      total_price_items: toInt(pRes.rows[0]?.cnt, 0),
      total_customers: toInt(cRes.rows[0]?.cnt, 0),
      total_quotes: toInt(qRes.rows[0]?.total_cnt, 0),
      finalized_quotes: toInt(qRes.rows[0]?.fin_cnt, 0),
      total_orders: activeOrdersCount,
      confirmed_actual_orders_count: confirmedActualOrdersCount,
      needs_review_orders_count: needsReviewOrdersCount,
      unconfirmed_entered_orders_count: unconfirmedEnteredOrdersCount,
      total_order_revenue: totalRevenue,
      total_expected_vendor_cost: totalExpectedCost,
      total_actual_vendor_cost: totalActualCost,
      total_expected_profit: totalExpectedProfit,
      total_actual_profit: totalActualProfit,
      total_paid_amount: totalPaid,
      total_vendor_paid_amount: totalVendorPaid,
      total_remaining_debt: totalDebt,
      cancelled_orders_summary: {
        cancelled_orders_count: cancelledOrdersCount,
        cancelled_orders_with_obligations_count: cancelledWithObligationsCount,
        cancelled_customer_paid_holding: cancelledCustomerPaidHolding,
        cancelled_vendor_paid_amount: cancelledVendorPaidAmount,
        cancelled_confirmed_incurred_cost: cancelledConfirmedIncurredCost,
        cancelled_unconfirmed_entered_cost: cancelledUnconfirmedEnteredCost,
      },
      orders_by_production_status: ordersByProd,
      orders_by_delivery_status: ordersByDeliv,
      orders_by_payment_status: ordersByPay,
    };
  }
}
