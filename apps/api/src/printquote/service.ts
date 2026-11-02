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
  ShippingAllocationStrategy,
  RoundingMode,
  QuoteOrderStatus,
  PrintProductionStatus,
  PrintDeliveryStatus,
  PrintPaymentStatus,
  calculatePrintQuote,
  createQuoteOrderSnapshot,
  buildCustomerSafePdfPayload,
  assertCustomerSafePdfPayload,
  verifyQuoteSnapshotIntegrity,
  buildQuoteLineFromVendorCatalogItem,
  type ProfitModeType,
  type ProfitScopeType,
  type VendorCostModeType,
  type ShippingAllocationStrategyType,
  type RoundingModeType,
  type QuoteOrderStatusType,
  type PrintProductionStatusType,
  type PrintDeliveryStatusType,
  type PrintPaymentStatusType,
  type QuoteLineInput,
  type PrintVendorData,
  type PrintVendorPriceItemData,
  type PrintCustomerData,
  type PrintQuoteData,
  type PrintQuoteVersionData,
  type PrintOrderData,
  type PrintOrderPaymentData,
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
  // 2. VENDOR PRICE CATALOG (BẢNG GIÁ NHÀ IN)
  // ==========================================================================

  async listPriceItems(
    ctx: AuthenticatedContext,
    vendorId?: string | null,
  ): Promise<PrintVendorPriceItemData[]> {
    this.assertOwnerAccess(ctx);
    const params: unknown[] = [ctx.workspace.id];
    let whereSql = `p.workspace_id = $1`;
    if (vendorId) {
      params.push(vendorId);
      whereSql += ` AND p.vendor_id = $2`;
    }
    const res = await this.pool.query(
      `SELECT p.*, v.name AS vendor_name
       FROM print_vendor_price_items p
       JOIN print_vendors v ON v.id = p.vendor_id
       WHERE ${whereSql}
       ORDER BY p.is_active DESC, v.name ASC, p.name ASC`,
      params,
    );
    return res.rows.map((r) => this.mapPriceItemRow(r));
  }

  async createPriceItem(
    ctx: AuthenticatedContext,
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<PrintVendorPriceItemData> {
    this.assertOwnerAccess(ctx);
    const vendorId =
      typeof input['vendor_id'] === 'string' ? input['vendor_id'].trim() : '';
    const name = typeof input['name'] === 'string' ? input['name'].trim() : '';
    if (!vendorId || !name) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Nhà in (vendor_id) và Tên hạng mục in (name) là bắt buộc.',
        400,
      );
    }

    const pricingMode: VendorCostModeType =
      input['pricing_mode'] === VendorCostMode.TOTAL_BATCH
        ? VendorCostMode.TOTAL_BATCH
        : VendorCostMode.PER_UNIT;
    const unitCost = toInt(input['unit_cost'], 0);
    const batchQuantity = Math.max(1, toInt(input['batch_quantity'], 1));
    const batchTotalCost = toInt(
      input['batch_total_cost'],
      unitCost * batchQuantity,
    );
    const defaultProfitMode: ProfitModeType =
      input['default_profit_mode'] === ProfitMode.PERCENTAGE
        ? ProfitMode.PERCENTAGE
        : ProfitMode.FIXED_AMOUNT;
    const defaultProfitScope: ProfitScopeType =
      input['default_profit_scope'] === ProfitScope.TOTAL_BATCH
        ? ProfitScope.TOTAL_BATCH
        : ProfitScope.PER_UNIT;
    const defaultProfitValue = Math.max(
      0,
      toNum(input['default_profit_value'], 0),
    );

    if (unitCost < 0 || batchTotalCost < 0) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Giá vốn nhà in không được âm.',
        400,
      );
    }

    return this.withIdempotentTransaction(
      ctx,
      'POST',
      '/api/v1/print-quotes/price-items',
      input,
      idempotencyKey,
      201,
      async (client) => {
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

        let code =
          typeof input['code'] === 'string'
            ? input['code'].trim().toUpperCase()
            : '';
        if (!code) {
          const countRes = await client.query<{ cnt: string }>(
            `SELECT COUNT(*)::text AS cnt FROM print_vendor_price_items WHERE workspace_id = $1 AND vendor_id = $2`,
            [ctx.workspace.id, vendorId],
          );
          const nextNum = Number(countRes.rows[0]?.cnt ?? 0) + 1;
          code = `BG-${String(nextNum).padStart(3, '0')}`;
        }

        const res = await client.query(
          `INSERT INTO print_vendor_price_items (
            workspace_id, vendor_id, code, name, category, specification, unit,
            pricing_mode, unit_cost, batch_quantity, batch_total_cost,
            default_profit_mode, default_profit_scope, default_profit_value, note, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          RETURNING *`,
          [
            ctx.workspace.id,
            vendorId,
            code,
            name,
            typeof input['category'] === 'string'
              ? input['category'].trim() || null
              : null,
            typeof input['specification'] === 'string'
              ? input['specification'].trim() || null
              : null,
            typeof input['unit'] === 'string' && input['unit'].trim()
              ? input['unit'].trim()
              : 'tờ',
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
          ],
        );

        return this.mapPriceItemRow({
          ...res.rows[0],
          vendor_name: vRes.rows[0]!.name,
        });
      },
    );
  }

  async updatePriceItem(
    ctx: AuthenticatedContext,
    priceItemId: string,
    input: Record<string, unknown>,
  ): Promise<PrintVendorPriceItemData> {
    this.assertOwnerAccess(ctx);
    const existingRes = await this.pool.query(
      `SELECT p.*, v.name AS vendor_name
       FROM print_vendor_price_items p
       JOIN print_vendors v ON v.id = p.vendor_id
       WHERE p.id = $1 AND p.workspace_id = $2`,
      [priceItemId, ctx.workspace.id],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AuthError(
        'NOT_FOUND',
        'Không tìm thấy hạng mục bảng giá nhà in.',
        404,
      );
    }

    const name =
      typeof input['name'] === 'string'
        ? input['name'].trim()
        : String(existing['name']);
    const pricingMode: VendorCostModeType =
      input['pricing_mode'] !== undefined
        ? input['pricing_mode'] === VendorCostMode.TOTAL_BATCH
          ? VendorCostMode.TOTAL_BATCH
          : VendorCostMode.PER_UNIT
        : (existing['pricing_mode'] as VendorCostModeType);
    const unitCost =
      input['unit_cost'] !== undefined
        ? toInt(input['unit_cost'], 0)
        : toInt(existing['unit_cost'], 0);
    const batchQuantity =
      input['batch_quantity'] !== undefined
        ? Math.max(1, toInt(input['batch_quantity'], 1))
        : Math.max(1, toInt(existing['batch_quantity'], 1));
    const batchTotalCost =
      input['batch_total_cost'] !== undefined
        ? toInt(input['batch_total_cost'], 0)
        : toInt(existing['batch_total_cost'], 0);
    const defaultProfitMode: ProfitModeType =
      input['default_profit_mode'] !== undefined
        ? input['default_profit_mode'] === ProfitMode.PERCENTAGE
          ? ProfitMode.PERCENTAGE
          : ProfitMode.FIXED_AMOUNT
        : (existing['default_profit_mode'] as ProfitModeType);
    const defaultProfitScope: ProfitScopeType =
      input['default_profit_scope'] !== undefined
        ? input['default_profit_scope'] === ProfitScope.TOTAL_BATCH
          ? ProfitScope.TOTAL_BATCH
          : ProfitScope.PER_UNIT
        : (existing['default_profit_scope'] as ProfitScopeType);
    const defaultProfitValue =
      input['default_profit_value'] !== undefined
        ? Math.max(0, toNum(input['default_profit_value'], 0))
        : toNum(existing['default_profit_value'], 0);

    if (unitCost < 0 || batchTotalCost < 0) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Giá vốn nhà in không được âm.',
        400,
      );
    }

    const res = await this.pool.query(
      `UPDATE print_vendor_price_items
       SET name = $1,
           category = $2,
           specification = $3,
           unit = $4,
           pricing_mode = $5,
           unit_cost = $6,
           batch_quantity = $7,
           batch_total_cost = $8,
           default_profit_mode = $9,
           default_profit_scope = $10,
           default_profit_value = $11,
           note = $12,
           is_active = $13,
           version = version + 1,
           updated_at = now()
       WHERE id = $14 AND workspace_id = $15
       RETURNING *`,
      [
        name,
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
        input['is_active'] !== undefined
          ? Boolean(input['is_active'])
          : Boolean(existing['is_active']),
        priceItemId,
        ctx.workspace.id,
      ],
    );

    return this.mapPriceItemRow({
      ...res.rows[0],
      vendor_name: existing['vendor_name'],
    });
  }

  private mapPriceItemRow(
    r: Record<string, unknown>,
  ): PrintVendorPriceItemData {
    return {
      id: String(r['id']),
      workspace_id: String(r['workspace_id']),
      vendor_id: String(r['vendor_id']),
      vendor_name: r['vendor_name'] ? String(r['vendor_name']) : null,
      code: String(r['code']),
      name: String(r['name']),
      category: r['category'] ? String(r['category']) : null,
      specification: r['specification'] ? String(r['specification']) : null,
      unit: String(r['unit'] || 'tờ'),
      pricing_mode: (r['pricing_mode'] as VendorCostModeType) || 'PER_UNIT',
      unit_cost: toInt(r['unit_cost'], 0),
      batch_quantity: Math.max(1, toInt(r['batch_quantity'], 1)),
      batch_total_cost: toInt(r['batch_total_cost'], 0),
      default_profit_mode:
        (r['default_profit_mode'] as ProfitModeType) || 'FIXED_AMOUNT',
      default_profit_scope:
        (r['default_profit_scope'] as ProfitScopeType) || 'PER_UNIT',
      default_profit_value: toNum(r['default_profit_value'], 0),
      note: r['note'] ? String(r['note']) : null,
      is_active: Boolean(r['is_active']),
      version: toInt(r['version'], 1),
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

  private async resolveQuoteLinesWithCatalog(
    client: pg.PoolClient,
    workspaceId: string,
    rawItems: unknown,
  ): Promise<QuoteLineInput[]> {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Báo giá phải có ít nhất 1 dòng sản phẩm.',
        400,
      );
    }

    const lines: QuoteLineInput[] = [];
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

      // Nếu chọn từ bảng giá nhà in và chưa truyền giá vốn tay, lấy snapshot tại thời điểm tạo
      if (
        vendorPriceItemId &&
        raw['unitVendorCost'] === undefined &&
        raw['totalVendorCost'] === undefined &&
        raw['unit_vendor_cost'] === undefined &&
        raw['total_vendor_cost'] === undefined
      ) {
        const catRes = await client.query(
          `SELECT p.*, v.name AS vendor_name
           FROM print_vendor_price_items p
           JOIN print_vendors v ON v.id = p.vendor_id
           WHERE p.id = $1 AND p.workspace_id = $2`,
          [vendorPriceItemId, workspaceId],
        );
        const cat = catRes.rows[0];
        if (!cat) {
          throw new AuthError(
            'NOT_FOUND',
            `Không tìm thấy hạng mục bảng giá (${vendorPriceItemId}).`,
            404,
          );
        }
        const mappedCat = this.mapPriceItemRow(cat);
        const rawProfit = raw['profit'] as Record<string, unknown> | undefined;
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

        lines.push(
          buildQuoteLineFromVendorCatalogItem(
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
              pricingMode:
                raw['unitVendorCost'] !== undefined ||
                raw['unit_vendor_cost'] !== undefined
                  ? VendorCostMode.PER_UNIT
                  : raw['totalVendorCost'] !== undefined ||
                      raw['total_vendor_cost'] !== undefined
                    ? VendorCostMode.TOTAL_BATCH
                    : mappedCat.pricing_mode,
              unitCost:
                raw['unitVendorCost'] !== undefined ||
                raw['unit_vendor_cost'] !== undefined
                  ? Math.max(
                      0,
                      toNum(
                        raw['unitVendorCost'] ?? raw['unit_vendor_cost'],
                        mappedCat.unit_cost,
                      ),
                    )
                  : mappedCat.unit_cost,
              batchQuantity: mappedCat.batch_quantity,
              batchTotalCost:
                raw['totalVendorCost'] !== undefined ||
                raw['total_vendor_cost'] !== undefined
                  ? Math.max(
                      0,
                      toInt(
                        raw['totalVendorCost'] ?? raw['total_vendor_cost'],
                        mappedCat.batch_total_cost,
                      ),
                    )
                  : mappedCat.batch_total_cost,
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
          ),
        );
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

      const rawProfit = raw['profit'] as Record<string, unknown> | undefined;
      const profitMode: ProfitModeType =
        (rawProfit?.['mode'] ?? raw['profit_mode'] ?? raw['profitMode']) ===
        ProfitMode.PERCENTAGE
          ? ProfitMode.PERCENTAGE
          : ProfitMode.FIXED_AMOUNT;
      const profitScope: ProfitScopeType =
        (rawProfit?.['scope'] ?? raw['profit_scope'] ?? raw['profitScope']) ===
        ProfitScope.TOTAL_BATCH
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
        extraCost: Math.max(0, toInt(raw['extraCost'] ?? raw['extra_cost'], 0)),
      };

      if (hasUnit) {
        lineItem.unitVendorCost = Math.max(
          0,
          toNum(raw['unitVendorCost'] ?? raw['unit_vendor_cost'], 0),
        );
      }
      if (hasTotal) {
        lineItem.totalVendorCost = Math.max(
          0,
          toInt(raw['totalVendorCost'] ?? raw['total_vendor_cost'], 0),
        );
      }

      lines.push(lineItem);
    }

    return lines;
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

        const items = await this.resolveQuoteLinesWithCatalog(
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

        const calcResult = calculatePrintQuote({
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
        });

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

        const validUntil = toDateStr(input['valid_until']);
        const notes =
          typeof input['notes'] === 'string'
            ? input['notes'].trim() || null
            : null;

        const customerPdf = buildCustomerSafePdfPayload(calcResult, {
          quoteCode,
          customerPhone,
          customerAddress,
          validUntil,
          notes,
        });

        const insertRes = await client.query(
          `INSERT INTO print_quotes (
            workspace_id, quote_code, title, customer_id, customer_name, customer_phone, customer_address,
            status, current_version, include_shipping_in_unit_price, shipping_allocation_strategy,
            rounding_mode, rounding_step, total_quantity, total_vendor_cost, total_profit,
            shipping_fee, total_extra_cost, total_quote_amount, total_rounding_adjustment,
            single_product_final_unit_price, lines_json, snapshot_json, customer_pdf_json,
            integrity_hash, valid_until, notes, created_by, finalized_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, 1, $9, $10,
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
            JSON.stringify(snapshot.lines),
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
            workspace_id, quote_id, version_number, status,
            total_quantity, total_vendor_cost, total_profit, shipping_fee,
            total_extra_cost, total_quote_amount, total_rounding_adjustment,
            snapshot_json, customer_pdf_json, integrity_hash, change_note, created_by
          ) VALUES (
            $1, $2, 1, $3,
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

      const items =
        input['items'] !== undefined
          ? await this.resolveQuoteLinesWithCatalog(
              client,
              ctx.workspace.id,
              input['items'],
            )
          : (existing['lines_json'] as PersistedQuoteLineSnapshot[]).map(
              (l) => ({
                id: l.id,
                name: l.name,
                specification: l.specification ?? '',
                vendorId: l.vendorId ?? null,
                vendorName: l.vendorName ?? null,
                vendorPriceItemId: l.vendorPriceItemId ?? null,
                unit: l.unit,
                quantity: l.quantity,
                unitVendorCost: l.unitVendorCost,
                totalVendorCost: l.totalVendorCost,
                profit: {
                  mode: l.profitMode,
                  scope: l.profitScope,
                  value: l.profitInputValue,
                },
                extraCost: l.totalExtraCost,
              }),
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
          : 0;

      const calcResult = calculatePrintQuote({
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
      });

      const nextStatus: QuoteOrderStatusType =
        input['status'] === QuoteOrderStatus.FINALIZED
          ? QuoteOrderStatus.FINALIZED
          : input['status'] === QuoteOrderStatus.SENT
            ? QuoteOrderStatus.SENT
            : input['status'] === QuoteOrderStatus.APPROVED
              ? QuoteOrderStatus.APPROVED
              : (existing['status'] as QuoteOrderStatusType);

      const snapshot = createQuoteOrderSnapshot(calcResult, {
        orderId: `SNAP-${quoteCode}-V${nextVersion}`,
        status: nextStatus,
      });

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

      const customerPdf = buildCustomerSafePdfPayload(calcResult, {
        quoteCode,
        customerPhone,
        customerAddress,
        validUntil,
        notes,
      });

      const updRes = await client.query(
        `UPDATE print_quotes
         SET title = $1,
             customer_name = $2,
             customer_phone = $3,
             customer_address = $4,
             status = $5,
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
          JSON.stringify(snapshot.lines),
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
          workspace_id, quote_id, version_number, status,
          total_quantity, total_vendor_cost, total_profit, shipping_fee,
          total_extra_cost, total_quote_amount, total_rounding_adjustment,
          snapshot_json, customer_pdf_json, integrity_hash, change_note, created_by
        ) VALUES (
          $1, $2, $3, $4,
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
      customer_pdf_json: r['customer_pdf_json'] as CustomerSafePdfPayload,
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
    return {
      id: String(r['id']),
      quote_id: String(r['quote_id']),
      version_number: toInt(r['version_number'], 1),
      status: (r['status'] as QuoteOrderStatusType) || QuoteOrderStatus.DRAFT,
      total_quantity: toInt(r['total_quantity'], 0),
      total_vendor_cost: toInt(r['total_vendor_cost'], 0),
      total_profit: toInt(r['total_profit'], 0),
      shipping_fee: toInt(r['shipping_fee'], 0),
      total_extra_cost: toInt(r['total_extra_cost'], 0),
      total_quote_amount: toInt(r['total_quote_amount'], 0),
      total_rounding_adjustment: toInt(r['total_rounding_adjustment'], 0),
      snapshot_json: r['snapshot_json'] as PersistedQuoteOrderSnapshot,
      customer_pdf_json: r['customer_pdf_json'] as CustomerSafePdfPayload,
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

  async listOrders(ctx: AuthenticatedContext): Promise<PrintOrderData[]> {
    this.assertOwnerAccess(ctx);
    const res = await this.pool.query(
      `SELECT * FROM print_orders WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [ctx.workspace.id],
    );
    const orders = res.rows.map((r) => this.mapOrderRow(r));
    if (orders.length > 0) {
      const payRes = await this.pool.query(
        `SELECT * FROM print_order_payments WHERE workspace_id = $1 ORDER BY paid_at ASC`,
        [ctx.workspace.id],
      );
      const paymentsByOrder = new Map<string, PrintOrderPaymentData[]>();
      for (const row of payRes.rows) {
        const p = this.mapPaymentRow(row);
        const arr = paymentsByOrder.get(p.order_id) ?? [];
        arr.push(p);
        paymentsByOrder.set(p.order_id, arr);
      }
      for (const ord of orders) {
        ord.payments = paymentsByOrder.get(ord.id) ?? [];
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
    const payRes = await this.pool.query(
      `SELECT * FROM print_order_payments WHERE order_id = $1 AND workspace_id = $2 ORDER BY paid_at ASC`,
      [orderId, ctx.workspace.id],
    );
    const order = this.mapOrderRow(row);
    order.payments = payRes.rows.map((p) => this.mapPaymentRow(p));
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

        const actualVendorCost =
          input['actual_vendor_cost'] !== undefined
            ? Math.max(0, toInt(input['actual_vendor_cost'], 0))
            : expectedVendorCost;
        const actualShippingFee =
          input['actual_shipping_fee'] !== undefined
            ? Math.max(0, toInt(input['actual_shipping_fee'], 0))
            : expectedShippingFee;
        const actualExtraCost =
          input['actual_extra_cost'] !== undefined
            ? Math.max(0, toInt(input['actual_extra_cost'], 0))
            : expectedExtraCost;
        const actualProfit =
          totalQuoteAmount -
          actualVendorCost -
          actualShippingFee -
          actualExtraCost;

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
            actual_vendor_cost, actual_shipping_fee, actual_extra_cost, actual_profit,
            deposit_required, deposit_paid, total_paid_amount, remaining_debt_amount,
            snapshot_json, integrity_hash, notes, created_by
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9,
            $10, $11, $12, $13, $14, $15,
            $16, $17, $18,
            $19, $20, $21, $22, $23,
            $24, $25, $26, $27,
            $28, $29, $30, $31,
            $32::jsonb, $33, $34, $35
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
            actualVendorCost,
            actualShippingFee,
            actualExtraCost,
            actualProfit,
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
    const existingRes = await this.pool.query(
      `SELECT * FROM print_orders WHERE id = $1 AND workspace_id = $2`,
      [orderId, ctx.workspace.id],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new AuthError('NOT_FOUND', 'Không tìm thấy đơn hàng in ấn.', 404);
    }

    const totalQuoteAmount = toInt(existing['total_quote_amount'], 0);
    const actualVendorCost =
      input['actual_vendor_cost'] !== undefined
        ? Math.max(0, toInt(input['actual_vendor_cost'], 0))
        : toInt(existing['actual_vendor_cost'], 0);
    const actualShippingFee =
      input['actual_shipping_fee'] !== undefined
        ? Math.max(0, toInt(input['actual_shipping_fee'], 0))
        : toInt(existing['actual_shipping_fee'], 0);
    const actualExtraCost =
      input['actual_extra_cost'] !== undefined
        ? Math.max(0, toInt(input['actual_extra_cost'], 0))
        : toInt(existing['actual_extra_cost'], 0);
    const actualProfit =
      totalQuoteAmount - actualVendorCost - actualShippingFee - actualExtraCost;

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

    const updRes = await this.pool.query(
      `UPDATE print_orders
       SET print_ordered_at = $1,
           due_date = $2,
           production_status = $3,
           delivery_status = $4,
           actual_vendor_cost = $5,
           actual_shipping_fee = $6,
           actual_extra_cost = $7,
           actual_profit = $8,
           deposit_required = $9,
           vendor_id = $10,
           vendor_name = $11,
           notes = $12,
           completed_at = CASE WHEN $3 = 'COMPLETED' AND completed_at IS NULL THEN now() ELSE completed_at END,
           delivered_at = CASE WHEN $4 = 'DELIVERED' AND delivered_at IS NULL THEN now() ELSE delivered_at END,
           updated_at = now()
       WHERE id = $13 AND workspace_id = $14
       RETURNING *`,
      [
        printOrderedAt,
        dueDate,
        productionStatus,
        deliveryStatus,
        actualVendorCost,
        actualShippingFee,
        actualExtraCost,
        actualProfit,
        depositRequired,
        input['vendor_id'] !== undefined
          ? typeof input['vendor_id'] === 'string' && input['vendor_id'].trim()
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
        ctx.workspace.id,
      ],
    );

    const payRes = await this.pool.query(
      `SELECT * FROM print_order_payments WHERE order_id = $1 AND workspace_id = $2 ORDER BY paid_at ASC`,
      [orderId, ctx.workspace.id],
    );
    const mapped = this.mapOrderRow(updRes.rows[0]!);
    mapped.payments = payRes.rows.map((p) => this.mapPaymentRow(p));
    return mapped;
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

        const updatedOrder = this.mapOrderRow(updRes.rows[0]!);
        updatedOrder.payments = payments;
        return updatedOrder;
      },
    );
  }

  private mapOrderRow(r: Record<string, unknown>): PrintOrderData {
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
      actual_vendor_cost: toInt(r['actual_vendor_cost'], 0),
      actual_shipping_fee: toInt(r['actual_shipping_fee'], 0),
      actual_extra_cost: toInt(r['actual_extra_cost'], 0),
      actual_profit: toInt(r['actual_profit'], 0),
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
                total_quote_amount, expected_vendor_cost, actual_vendor_cost,
                expected_profit, actual_profit, total_paid_amount, remaining_debt_amount
         FROM print_orders
         WHERE workspace_id = $1 AND production_status != 'CANCELLED'`,
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

    let totalRevenue = 0;
    let totalExpectedCost = 0;
    let totalActualCost = 0;
    let totalExpectedProfit = 0;
    let totalActualProfit = 0;
    let totalPaid = 0;
    let totalDebt = 0;

    for (const r of oRes.rows) {
      const ps = r['production_status'] as PrintProductionStatusType;
      const ds = r['delivery_status'] as PrintDeliveryStatusType;
      const pays = r['payment_status'] as PrintPaymentStatusType;
      if (ordersByProd[ps] !== undefined) ordersByProd[ps]++;
      if (ordersByDeliv[ds] !== undefined) ordersByDeliv[ds]++;
      if (ordersByPay[pays] !== undefined) ordersByPay[pays]++;

      totalRevenue += toInt(r['total_quote_amount'], 0);
      totalExpectedCost += toInt(r['expected_vendor_cost'], 0);
      totalActualCost += toInt(r['actual_vendor_cost'], 0);
      totalExpectedProfit += toInt(r['expected_profit'], 0);
      totalActualProfit += toInt(r['actual_profit'], 0);
      totalPaid += toInt(r['total_paid_amount'], 0);
      totalDebt += toInt(r['remaining_debt_amount'], 0);
    }

    return {
      total_vendors: toInt(vRes.rows[0]?.cnt, 0),
      total_price_items: toInt(pRes.rows[0]?.cnt, 0),
      total_customers: toInt(cRes.rows[0]?.cnt, 0),
      total_quotes: toInt(qRes.rows[0]?.total_cnt, 0),
      finalized_quotes: toInt(qRes.rows[0]?.fin_cnt, 0),
      total_orders: oRes.rows.length,
      total_order_revenue: totalRevenue,
      total_expected_vendor_cost: totalExpectedCost,
      total_actual_vendor_cost: totalActualCost,
      total_expected_profit: totalExpectedProfit,
      total_actual_profit: totalActualProfit,
      total_paid_amount: totalPaid,
      total_remaining_debt: totalDebt,
      orders_by_production_status: ordersByProd,
      orders_by_delivery_status: ordersByDeliv,
      orders_by_payment_status: ordersByPay,
    };
  }
}
