import type pg from 'pg';
import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import {
  claimIdempotency,
  completeIdempotency,
  computeRequestFingerprint,
  failIdempotency,
} from '../../../../packages/database/src/idempotency.js';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import {
  PrintProductionStatus,
  WorkshopJobStatus,
  WorkshopJobCostStatus,
  ArTransactionKind,
  ArReceiptSubtype,
  ApTransactionKind,
  ApPayoutSubtype,
  LedgerTxStatus,
  CancellationSettlementStatus,
  OpeningBalanceDirection,
  HistoricalImportBatchStatus,
  HistoricalImportRowStatus,
  HistoricalImportResolution,
  LegacyArReconciliationStatus,
  LegacyArAnomalyCode,
  computeOrderReceivableMetrics,
  computeOrderReconciledProfit,
  analyzeHistoricalSheetRows,
  evaluateLegacyPaymentReconciliationAnomalies,
  normalizeLedgerScopeInput,
  assertSafePositiveVnd,
  type LedgerScopeType,
  type PrintWorkshopJobData,
  type PrintOpeningBalanceData,
  type PrintArTransactionData,
  type PrintArAdjustmentData,
  type PrintApTransactionData,
  type PrintApAdjustmentData,
  type PrintOrderCancellationSettlementData,
  type CustomerReceivableSummaryItem,
  type VendorPayableSummaryItem,
  type LegacyUnreconciledVendorNoteItem,
  type UnifiedPrintLedgerItem,
  type PrintFinancialReportData,
  type PrintHistoricalImportBatchData,
  type PrintHistoricalImportRowData,
  type HistoricalImportResolutionType,
  type CancellationSettlementStatusType,
  type LegacyArReconciliationStatusType,
  type LegacyArAnomalyCodeType,
  type LegacyArHistoryActionType,
  type PrintLegacyArReconciliationOverview,
  type PrintLegacyArReconciliationItem,
  type LegacyOrderReconciliationGapItem,
  type PrintLegacyArReconciliationHistoryItem,
} from '../../../../packages/contracts/src/printquote.js';
import { AuthError, type AuthenticatedContext } from '../auth/service.js';
import {
  toInt,
  toDateStr,
  allocateNextLedgerCode,
  mapWorkshopJobRow,
  mapWorkshopJobHistoryRow,
  mapOpeningBalanceRow,
  mapArTransactionRow,
  mapArAllocationRow,
  mapArAdjustmentRow,
  mapApTransactionRow,
  mapApAllocationRow,
  mapApAdjustmentRow,
  mapHistoricalImportBatchRow,
  mapHistoricalImportRow,
} from './ledger-helpers.js';
import {
  initOrderWorkshopJobsTx,
  createWorkshopJobTx,
  updateOrConfirmWorkshopJobTx,
  createOpeningBalanceTx,
  createCustomerReceiptTx,
  allocateCustomerReceiptTx,
  createCustomerRefundTx,
  createArAdjustmentTx,
  voidArTransactionTx,
  createVendorPayoutTx,
  allocateVendorPayoutTx,
  createVendorRefundTx,
  createApAdjustmentTx,
  voidApTransactionTx,
  reconcileLegacyVendorNoteTx,
  settleCancelledOrderTx,
  linkCustomerToLegacyOrderTx,
  reconcileLegacyOrderBalanceDiscrepancyTx,
  confirmLegacyPaymentToArTx,
  holdLegacyPaymentReconciliationTx,
} from './ledger-ar-ap-ops.js';

export class PrintQuoteLedgerService {
  constructor(private readonly pool: DatabasePool) {}

  private assertOwnerAccess(ctx: AuthenticatedContext): void {
    if (ctx.workspace.role !== 'owner') {
      throw new AuthError(
        'FORBIDDEN',
        'Chỉ Chủ sở hữu (Owner) mới có quyền truy cập Sổ công nợ và Tài chính in ấn.',
        403,
      );
    }
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
  // 1. WORKSHOP JOBS (§B)
  // ==========================================================================

  async listWorkshopJobs(
    ctx: AuthenticatedContext,
    filters?: {
      order_id?: string | undefined;
      vendor_id?: string | undefined;
      ledger_scope?: string | undefined;
    },
  ): Promise<PrintWorkshopJobData[]> {
    this.assertOwnerAccess(ctx);
    const params: unknown[] = [ctx.workspace.id];
    const conds = ['j.workspace_id = $1'];

    if (filters?.order_id) {
      params.push(filters.order_id);
      conds.push(`j.order_id = $${params.length}`);
    }
    if (filters?.vendor_id) {
      params.push(filters.vendor_id);
      conds.push(`j.vendor_id = $${params.length}`);
    }
    if (filters?.ledger_scope) {
      params.push(normalizeLedgerScopeInput(filters.ledger_scope));
      conds.push(`j.ledger_scope = $${params.length}`);
    }

    const res = await this.pool.query(
      `SELECT j.*, o.order_code
       FROM print_workshop_jobs j
       JOIN print_orders o ON o.id = j.order_id
       WHERE ${conds.join(' AND ')}
       ORDER BY j.created_at ASC`,
      params,
    );
    const jobs = res.rows.map(mapWorkshopJobRow);

    if (jobs.length > 0 && filters?.order_id) {
      const histRes = await this.pool.query(
        `SELECT * FROM print_workshop_job_history
         WHERE workspace_id = $1 AND order_id = $2
         ORDER BY created_at DESC`,
        [ctx.workspace.id, filters.order_id],
      );
      const byJob = new Map<
        string,
        ReturnType<typeof mapWorkshopJobHistoryRow>[]
      >();
      for (const hr of histRes.rows) {
        const mapped = mapWorkshopJobHistoryRow(hr);
        const arr = byJob.get(mapped.workshop_job_id) ?? [];
        arr.push(mapped);
        byJob.set(mapped.workshop_job_id, arr);
      }
      for (const j of jobs) {
        j.history = byJob.get(j.id) ?? [];
      }
    }

    return jobs;
  }

  async initOrderWorkshopJobs(
    ctx: AuthenticatedContext,
    orderId: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintWorkshopJobData[]> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      `/api/v1/print-quotes/orders/${orderId}/workshop-jobs/init`,
      input,
      idempotencyKey,
      201,
      (client) =>
        initOrderWorkshopJobsTx(client, ctx, orderId, input, requestId),
    );
  }

  async createWorkshopJob(
    ctx: AuthenticatedContext,
    orderId: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintWorkshopJobData> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      `/api/v1/print-quotes/orders/${orderId}/workshop-jobs`,
      input,
      idempotencyKey,
      201,
      (client) => createWorkshopJobTx(client, ctx, orderId, input, requestId),
    );
  }

  async updateWorkshopJob(
    ctx: AuthenticatedContext,
    jobId: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintWorkshopJobData> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'PATCH',
      `/api/v1/print-quotes/workshop-jobs/${jobId}`,
      input,
      idempotencyKey,
      200,
      (client) =>
        updateOrConfirmWorkshopJobTx(client, ctx, jobId, input, requestId),
    );
  }

  // ==========================================================================
  // 2. CUSTOMER RECEIVABLES (AR — §C) & OPENING BALANCES
  // ==========================================================================

  async listOpeningBalances(
    ctx: AuthenticatedContext,
    filters?: {
      direction?: string | undefined;
      ledger_scope?: string | undefined;
    },
  ): Promise<PrintOpeningBalanceData[]> {
    this.assertOwnerAccess(ctx);
    const params: unknown[] = [ctx.workspace.id];
    const conds = ['workspace_id = $1'];
    if (filters?.direction) {
      params.push(filters.direction);
      conds.push(`direction = $${params.length}`);
    }
    if (filters?.ledger_scope) {
      params.push(normalizeLedgerScopeInput(filters.ledger_scope));
      conds.push(`ledger_scope = $${params.length}`);
    }
    const res = await this.pool.query(
      `SELECT * FROM print_opening_balances
       WHERE ${conds.join(' AND ')}
       ORDER BY as_of_date DESC, created_at DESC`,
      params,
    );
    return res.rows.map(mapOpeningBalanceRow);
  }

  async createOpeningBalance(
    ctx: AuthenticatedContext,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintOpeningBalanceData> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      '/api/v1/print-quotes/opening-balances',
      input,
      idempotencyKey,
      201,
      (client) => createOpeningBalanceTx(client, ctx, input, requestId),
    );
  }

  private async queryOrderArTransitionMaps(workspaceId: string): Promise<{
    officialNetByOrder: Map<string, number>;
    legacyByOrder: Map<
      string,
      {
        totalRows: number;
        pendingCount: number;
        pendingReceipts: number;
        pendingRefunds: number;
        allReceipts: number;
        allRefunds: number;
      }
    >;
  }> {
    const [arOrdAllocRes, legOrdRes] = await Promise.all([
      this.pool.query<{ order_id: string; net_alloc: string }>(
        `SELECT
           order_id::text AS order_id,
           (
             COALESCE(SUM(amount) FILTER (WHERE direction = 'APPLY'), 0) -
             COALESCE(SUM(amount) FILTER (WHERE direction IN ('UNAPPLY_REVERSAL', 'REFUND_RELEASE')), 0)
           )::text AS net_alloc
         FROM print_ar_allocations
         WHERE workspace_id = $1 AND order_id IS NOT NULL
         GROUP BY order_id`,
        [workspaceId],
      ),
      this.pool.query<{
        order_id: string;
        total_rows: string;
        pending_count: string;
        pending_receipts: string;
        pending_refunds: string;
        all_receipts: string;
        all_refunds: string;
      }>(
        `SELECT
           p.order_id::text AS order_id,
           COUNT(p.id)::text AS total_rows,
           COUNT(r.id) FILTER (WHERE r.status IN ('PENDING', 'ON_HOLD'))::text AS pending_count,
           COALESCE(SUM(p.amount) FILTER (WHERE r.status IN ('PENDING', 'ON_HOLD') AND p.payment_type <> 'REFUND'), 0)::text AS pending_receipts,
           COALESCE(SUM(p.amount) FILTER (WHERE r.status IN ('PENDING', 'ON_HOLD') AND p.payment_type = 'REFUND'), 0)::text AS pending_refunds,
           COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type <> 'REFUND'), 0)::text AS all_receipts,
           COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type = 'REFUND'), 0)::text AS all_refunds
         FROM print_order_payments p
         LEFT JOIN print_legacy_ar_reconciliations r ON r.legacy_payment_id = p.id
         WHERE p.workspace_id = $1
         GROUP BY p.order_id`,
        [workspaceId],
      ),
    ]);

    const officialNetByOrder = new Map<string, number>();
    for (const r of arOrdAllocRes.rows) {
      officialNetByOrder.set(r.order_id, Math.max(0, toInt(r.net_alloc, 0)));
    }
    const legacyByOrder = new Map<
      string,
      {
        totalRows: number;
        pendingCount: number;
        pendingReceipts: number;
        pendingRefunds: number;
        allReceipts: number;
        allRefunds: number;
      }
    >();
    for (const r of legOrdRes.rows) {
      legacyByOrder.set(r.order_id, {
        totalRows: toInt(r.total_rows, 0),
        pendingCount: toInt(r.pending_count, 0),
        pendingReceipts: toInt(r.pending_receipts, 0),
        pendingRefunds: toInt(r.pending_refunds, 0),
        allReceipts: toInt(r.all_receipts, 0),
        allRefunds: toInt(r.all_refunds, 0),
      });
    }
    return { officialNetByOrder, legacyByOrder };
  }

  private computeOrderTransitionAmounts(
    orderRow: Record<string, unknown>,
    officialNetByOrder: Map<string, number>,
    legacyByOrder: Map<
      string,
      {
        totalRows: number;
        pendingCount: number;
        pendingReceipts: number;
        pendingRefunds: number;
        allReceipts: number;
        allRefunds: number;
      }
    >,
  ): {
    officialPaid: number;
    pendingLegacyNet: number;
    pendingLegacyCount: number;
    effectivePaid: number;
  } {
    const orderId = String(orderRow['id']);
    const officialPaid = officialNetByOrder.get(orderId) ?? 0;
    const leg = legacyByOrder.get(orderId);
    const totalRows = leg?.totalRows ?? 0;
    const pendingLegacyCount = leg?.pendingCount ?? 0;
    const hasPre0036Snapshot =
      orderRow['pre0036_total_paid_snapshot'] !== null &&
      orderRow['pre0036_total_paid_snapshot'] !== undefined;
    const pre0036Paid = hasPre0036Snapshot
      ? toInt(orderRow['pre0036_total_paid_snapshot'], 0)
      : 0;
    const orphanLegacyPaid =
      hasPre0036Snapshot &&
      !orderRow['legacy_balance_discrepancy_resolved'] &&
      totalRows === 0 &&
      pre0036Paid > 0
        ? pre0036Paid
        : 0;
    const pendingLegacyNet =
      (leg?.pendingReceipts ?? 0) -
      (leg?.pendingRefunds ?? 0) +
      orphanLegacyPaid;
    const effectivePaid = Math.max(0, officialPaid + pendingLegacyNet);
    return {
      officialPaid,
      pendingLegacyNet,
      pendingLegacyCount,
      effectivePaid,
    };
  }

  async listCustomerReceivables(
    ctx: AuthenticatedContext,
    filters?: { ledger_scope?: string | undefined },
  ): Promise<{
    summaries: CustomerReceivableSummaryItem[];
    transactions: PrintArTransactionData[];
    adjustments: PrintArAdjustmentData[];
    opening_balances: PrintOpeningBalanceData[];
    legacy_reconciliation: PrintLegacyArReconciliationOverview;
  }> {
    this.assertOwnerAccess(ctx);
    const scopeFilter = filters?.ledger_scope
      ? normalizeLedgerScopeInput(filters.ledger_scope)
      : null;

    const [
      custRes,
      ordRes,
      obRes,
      txRes,
      allocRes,
      adjRes,
      transitionMaps,
      legacyReconciliation,
    ] = await Promise.all([
      this.pool.query(
        `SELECT id, code, name, phone FROM print_customers WHERE workspace_id = $1`,
        [ctx.workspace.id],
      ),
      this.pool.query(
        `SELECT * FROM print_orders WHERE workspace_id = $1 ORDER BY created_at DESC`,
        [ctx.workspace.id],
      ),
      this.pool.query(
        `SELECT * FROM print_opening_balances
           WHERE workspace_id = $1 AND direction = 'CUSTOMER_RECEIVABLE'
           ORDER BY as_of_date DESC`,
        [ctx.workspace.id],
      ),
      this.pool.query(
        `SELECT * FROM print_ar_transactions
           WHERE workspace_id = $1
           ORDER BY occurred_at DESC, created_at DESC`,
        [ctx.workspace.id],
      ),
      this.pool.query(
        `SELECT a.*, o.order_code, ob.doc_code AS opening_doc_code
           FROM print_ar_allocations a
           LEFT JOIN print_orders o ON o.id = a.order_id
           LEFT JOIN print_opening_balances ob ON ob.id = a.opening_balance_id
           WHERE a.workspace_id = $1
           ORDER BY a.created_at ASC`,
        [ctx.workspace.id],
      ),
      this.pool.query(
        `SELECT adj.*, o.order_code
           FROM print_ar_adjustments adj
           LEFT JOIN print_orders o ON o.id = adj.order_id
           WHERE adj.workspace_id = $1
           ORDER BY adj.created_at DESC`,
        [ctx.workspace.id],
      ),
      this.queryOrderArTransitionMaps(ctx.workspace.id),
      this.getLegacyArReconciliationOverview(ctx, filters),
    ]);

    const custMeta = new Map<
      string,
      { code: string; name: string; phone: string | null }
    >();
    for (const c of custRes.rows) {
      custMeta.set(String(c['id']), {
        code: String(c['code']),
        name: String(c['name']),
        phone: c['phone'] ? String(c['phone']) : null,
      });
    }

    const allocsByTx = new Map<
      string,
      ReturnType<typeof mapArAllocationRow>[]
    >();
    for (const r of allocRes.rows) {
      const m = mapArAllocationRow(r);
      const arr = allocsByTx.get(m.ar_transaction_id) ?? [];
      arr.push(m);
      allocsByTx.set(m.ar_transaction_id, arr);
    }

    const transactions = txRes.rows
      .map((r) => {
        const tx = mapArTransactionRow(r);
        tx.allocations = allocsByTx.get(tx.id) ?? [];
        return tx;
      })
      .filter((t) => !scopeFilter || t.ledger_scope === scopeFilter);

    const adjustments = adjRes.rows
      .map(mapArAdjustmentRow)
      .filter((a) => !scopeFilter || a.ledger_scope === scopeFilter);

    const openingBalances = obRes.rows
      .map(mapOpeningBalanceRow)
      .filter((ob) => !scopeFilter || ob.ledger_scope === scopeFilter);

    const buckets = new Map<string, CustomerReceivableSummaryItem>();
    const ensureBucket = (
      customerId: string | null,
      customerName: string,
      customerPhone: string | null,
      scope: LedgerScopeType,
    ): CustomerReceivableSummaryItem => {
      const verifiedId =
        customerId && custMeta.has(customerId) ? customerId : null;
      const normKey = verifiedId
        ? `${scope}:ID:${verifiedId}`
        : `${scope}:NAME:${customerName.trim().toLowerCase()}`;
      const existing = buckets.get(normKey);
      if (existing) return existing;
      const meta = verifiedId ? custMeta.get(verifiedId) : undefined;
      const created: CustomerReceivableSummaryItem = {
        customer_key: normKey,
        customer_id: verifiedId,
        customer_code: meta?.code ?? null,
        customer_name: meta?.name ?? customerName,
        customer_phone: meta?.phone ?? customerPhone,
        ledger_scope: scope,
        active_orders_count: 0,
        opening_balances_count: 0,
        valid_receivable_total: 0,
        net_allocated_receipt_total: 0,
        remaining_receivable_total: 0,
        legacy_pending_ar_total: 0,
        effective_remaining_after_pending_total: 0,
        missing_customer_id: !verifiedId,
        unallocated_credit_total: 0,
        cancelled_holding_pending_total: 0,
        cancelled_agreed_refund_remaining_total: 0,
      };
      buckets.set(normKey, created);
      return created;
    };

    for (const r of ordRes.rows) {
      const scope = normalizeLedgerScopeInput(r['ledger_scope']);
      if (scopeFilter && scope !== scopeFilter) continue;
      const b = ensureBucket(
        r['customer_id'] ? String(r['customer_id']) : null,
        String(r['customer_name']),
        r['customer_phone'] ? String(r['customer_phone']) : null,
        scope,
      );
      const isCancelled =
        r['production_status'] === PrintProductionStatus.CANCELLED;
      const cancelStatus =
        (r[
          'cancellation_settlement_status'
        ] as CancellationSettlementStatusType) ||
        CancellationSettlementStatus.NOT_APPLICABLE;

      const trans = this.computeOrderTransitionAmounts(
        r,
        transitionMaps.officialNetByOrder,
        transitionMaps.legacyByOrder,
      );

      // Official AR strictly counts ONLY confirmed/posted AR allocations (`trans.officialPaid`)!
      const officialMetrics = computeOrderReceivableMetrics({
        grossOrderAmount: toInt(r['total_quote_amount'], 0),
        isCancelled,
        cancellationSettlementStatus: cancelStatus,
        agreedCustomerRefundAmount: toInt(
          r['agreed_customer_refund_amount'],
          0,
        ),
        refundedAfterCancelAmount: toInt(r['refunded_after_cancel_amount'], 0),
        retainedCancellationFee: toInt(r['retained_cancellation_fee'], 0),
        netArAdjustmentAmount: toInt(r['net_ar_adjustment_amount'], 0),
        netAllocatedReceiptAmount: trans.officialPaid,
      });

      const effectiveMetrics = computeOrderReceivableMetrics({
        grossOrderAmount: toInt(r['total_quote_amount'], 0),
        isCancelled,
        cancellationSettlementStatus: cancelStatus,
        agreedCustomerRefundAmount: toInt(
          r['agreed_customer_refund_amount'],
          0,
        ),
        refundedAfterCancelAmount: toInt(r['refunded_after_cancel_amount'], 0),
        retainedCancellationFee: toInt(r['retained_cancellation_fee'], 0),
        netArAdjustmentAmount: toInt(r['net_ar_adjustment_amount'], 0),
        netAllocatedReceiptAmount: trans.effectivePaid,
      });

      if (!isCancelled) {
        b.active_orders_count++;
      }
      const officialSettled = Math.min(
        officialMetrics.validReceivableAmount,
        trans.officialPaid,
      );
      b.valid_receivable_total += officialMetrics.validReceivableAmount;
      b.net_allocated_receipt_total += officialSettled;
      b.remaining_receivable_total += officialMetrics.remainingReceivableAmount;
      b.legacy_pending_ar_total =
        (b.legacy_pending_ar_total ?? 0) + trans.pendingLegacyNet;
      b.effective_remaining_after_pending_total =
        (b.effective_remaining_after_pending_total ?? 0) +
        effectiveMetrics.remainingReceivableAmount;
      b.cancelled_holding_pending_total +=
        effectiveMetrics.customerHoldingPendingAmount;
      b.cancelled_agreed_refund_remaining_total +=
        officialMetrics.remainingAgreedRefundAmount;
    }

    for (const ob of openingBalances) {
      const b = ensureBucket(
        ob.customer_id,
        ob.customer_name ?? 'Khách đầu kỳ',
        null,
        ob.ledger_scope,
      );
      b.opening_balances_count++;
      const effectiveSettled = Math.min(
        ob.valid_amount,
        ob.allocated_settled_amount,
      );
      b.valid_receivable_total += ob.valid_amount;
      b.net_allocated_receipt_total += effectiveSettled;
      b.remaining_receivable_total += ob.remaining_amount;
      b.effective_remaining_after_pending_total =
        (b.effective_remaining_after_pending_total ?? 0) + ob.remaining_amount;
    }

    for (const tx of transactions) {
      if (
        tx.status === LedgerTxStatus.POSTED &&
        tx.tx_kind === ArTransactionKind.RECEIPT &&
        tx.unallocated_amount > 0
      ) {
        const b = ensureBucket(
          tx.customer_id,
          tx.customer_name,
          null,
          tx.ledger_scope,
        );
        b.unallocated_credit_total += tx.unallocated_amount;
      }
    }

    return {
      summaries: [...buckets.values()].sort(
        (a, b) =>
          b.remaining_receivable_total - a.remaining_receivable_total ||
          b.unallocated_credit_total - a.unallocated_credit_total ||
          a.customer_name.localeCompare(b.customer_name, 'vi'),
      ),
      transactions,
      adjustments,
      opening_balances: openingBalances,
      legacy_reconciliation: legacyReconciliation,
    };
  }

  async getLegacyArReconciliationOverview(
    ctx: AuthenticatedContext,
    filters?: {
      ledger_scope?: string | undefined;
      status?: string | undefined;
    },
  ): Promise<PrintLegacyArReconciliationOverview> {
    this.assertOwnerAccess(ctx);
    const scopeFilter = filters?.ledger_scope
      ? normalizeLedgerScopeInput(filters.ledger_scope)
      : null;
    const statusFilter =
      filters?.status && filters.status.trim() !== ''
        ? filters.status.trim().toUpperCase()
        : null;

    const [recRowsRes, ordRowsRes, histRes, transitionMaps] = await Promise.all(
      [
        this.pool.query(
          `SELECT
             r.*,
             p.payment_type,
             p.amount,
             p.payment_method,
             p.paid_at,
             p.reference_code,
             p.note AS payment_note,
             o.order_code,
             o.quote_code,
             o.production_status,
             o.cancellation_settlement_status,
             o.ledger_scope,
             o.customer_id,
             o.customer_name,
             o.customer_phone,
             o.total_quote_amount,
             o.valid_receivable_amount,
             o.pre0036_total_paid_snapshot,
             o.pre0036_remaining_debt_snapshot,
             o.legacy_balance_discrepancy_resolved,
             c.id AS verified_customer_id,
             c.code AS verified_customer_code,
             c.name AS verified_customer_name,
             c.phone AS verified_customer_phone,
             t.tx_code AS posted_ar_tx_code
           FROM print_legacy_ar_reconciliations r
           JOIN print_order_payments p ON p.id = r.legacy_payment_id
           JOIN print_orders o ON o.id = r.order_id
           LEFT JOIN print_customers c ON c.id = o.customer_id AND c.workspace_id = o.workspace_id
           LEFT JOIN print_ar_transactions t ON t.id = r.posted_ar_transaction_id
           WHERE r.workspace_id = $1 AND r.status <> 'POSTED_DIRECT'
           ORDER BY
             CASE r.status WHEN 'PENDING' THEN 0 WHEN 'ON_HOLD' THEN 1 ELSE 2 END ASC,
             p.paid_at DESC,
             r.created_at DESC`,
          [ctx.workspace.id],
        ),
        this.pool.query(
          `SELECT
             o.id,
             o.order_code,
             o.quote_code,
             o.customer_id,
             o.customer_name,
             o.customer_phone,
             o.production_status,
             o.cancellation_settlement_status,
             o.ledger_scope,
             o.total_quote_amount,
             o.pre0036_total_paid_snapshot,
             o.pre0036_remaining_debt_snapshot,
             o.legacy_balance_discrepancy_resolved,
             c.id AS verified_customer_id
           FROM print_orders o
           LEFT JOIN print_customers c ON c.id = o.customer_id AND c.workspace_id = o.workspace_id
           WHERE o.workspace_id = $1
           ORDER BY o.created_at DESC`,
          [ctx.workspace.id],
        ),
        this.pool.query(
          `SELECT * FROM print_legacy_ar_reconciliation_history
           WHERE workspace_id = $1
           ORDER BY created_at DESC
           LIMIT 100`,
          [ctx.workspace.id],
        ),
        this.queryOrderArTransitionMaps(ctx.workspace.id),
      ],
    );

    const summary: PrintLegacyArReconciliationOverview['summary'] = {
      legacy_payments_total_count: 0,
      legacy_payments_gross_receipts: 0,
      legacy_payments_gross_refunds: 0,
      legacy_payments_net_amount: 0,
      confirmed_to_ar_count: 0,
      confirmed_to_ar_receipts: 0,
      confirmed_to_ar_refunds: 0,
      confirmed_to_ar_net_amount: 0,
      pending_count: 0,
      pending_receipts: 0,
      pending_refunds: 0,
      pending_net_amount: 0,
      on_hold_count: 0,
      on_hold_net_amount: 0,
      anomalous_pending_count: 0,
      confirmable_pending_count: 0,
      orders_missing_customer_count: 0,
      orders_balance_mismatch_count: 0,
    };

    const items: PrintLegacyArReconciliationItem[] = [];
    for (const r of recRowsRes.rows) {
      const scope = normalizeLedgerScopeInput(r['ledger_scope']);
      if (scopeFilter && scope !== scopeFilter) continue;

      const orderId = String(r['order_id']);
      const legOrd = transitionMaps.legacyByOrder.get(orderId);
      const trans = this.computeOrderTransitionAmounts(
        {
          id: orderId,
          pre0036_total_paid_snapshot: r['pre0036_total_paid_snapshot'],
          legacy_balance_discrepancy_resolved:
            r['legacy_balance_discrepancy_resolved'],
        },
        transitionMaps.officialNetByOrder,
        transitionMaps.legacyByOrder,
      );

      const grossReceipts = legOrd?.allReceipts ?? 0;
      const grossRefunds = legOrd?.allRefunds ?? 0;
      const paymentType = String(
        r['payment_type'] || 'INSTALLMENT',
      ) as PrintLegacyArReconciliationItem['payment_type'];
      const amount = toInt(r['amount'], 0);
      const isRefund = paymentType === 'REFUND';
      const status = String(r['status']) as LegacyArReconciliationStatusType;
      const grossQuote = toInt(r['total_quote_amount'], 0);
      const prePaid =
        r['pre0036_total_paid_snapshot'] !== null &&
        r['pre0036_total_paid_snapshot'] !== undefined
          ? toInt(r['pre0036_total_paid_snapshot'], 0)
          : 0;
      const preRem =
        r['pre0036_remaining_debt_snapshot'] !== null &&
        r['pre0036_remaining_debt_snapshot'] !== undefined
          ? toInt(r['pre0036_remaining_debt_snapshot'], 0)
          : Math.max(0, grossQuote - prePaid);

      let anomalyCodes: LegacyArAnomalyCodeType[] = [];
      let warningCodes: string[] = [];
      let canConfirm = false;

      if (status !== LegacyArReconciliationStatus.CONFIRMED) {
        const evalRes = evaluateLegacyPaymentReconciliationAnomalies({
          paymentType,
          paymentAmount: amount,
          hasValidSameWorkspaceCustomer: Boolean(r['verified_customer_id']),
          isOrderCancelled:
            r['production_status'] === PrintProductionStatus.CANCELLED,
          cancellationSettlementStatus: String(
            r['cancellation_settlement_status'] || 'NOT_APPLICABLE',
          ),
          orderGrossQuoteAmount: grossQuote,
          orderValidReceivableAmount: toInt(
            r['valid_receivable_amount'],
            grossQuote,
          ),
          pre0036TotalPaidSnapshot: prePaid,
          pre0036RemainingDebtSnapshot: preRem,
          orderLegacyGrossReceipts: grossReceipts,
          orderLegacyGrossRefunds: grossRefunds,
          officialArNetAllocatedOnOrder: trans.officialPaid,
          balanceDiscrepancyResolved: Boolean(
            r['legacy_balance_discrepancy_resolved'],
          ),
        });
        anomalyCodes = evalRes.anomalyCodes;
        warningCodes = evalRes.warningCodes;
        canConfirm =
          status === LegacyArReconciliationStatus.PENDING && evalRes.canConfirm;
      }

      summary.legacy_payments_total_count++;
      if (isRefund) {
        summary.legacy_payments_gross_refunds += amount;
        summary.legacy_payments_net_amount -= amount;
      } else {
        summary.legacy_payments_gross_receipts += amount;
        summary.legacy_payments_net_amount += amount;
      }

      if (status === LegacyArReconciliationStatus.CONFIRMED) {
        summary.confirmed_to_ar_count++;
        if (isRefund) {
          summary.confirmed_to_ar_refunds += amount;
          summary.confirmed_to_ar_net_amount -= amount;
        } else {
          summary.confirmed_to_ar_receipts += amount;
          summary.confirmed_to_ar_net_amount += amount;
        }
      } else if (status === LegacyArReconciliationStatus.ON_HOLD) {
        summary.on_hold_count++;
        summary.on_hold_net_amount += isRefund ? -amount : amount;
      } else {
        summary.pending_count++;
        if (isRefund) {
          summary.pending_refunds += amount;
          summary.pending_net_amount -= amount;
        } else {
          summary.pending_receipts += amount;
          summary.pending_net_amount += amount;
        }
        if (anomalyCodes.length > 0) {
          summary.anomalous_pending_count++;
        } else {
          summary.confirmable_pending_count++;
        }
      }

      if (statusFilter && status !== statusFilter) continue;

      items.push({
        reconciliation_id: String(r['id']),
        legacy_payment_id: String(r['legacy_payment_id']),
        order_id: orderId,
        order_code: String(r['order_code']),
        quote_code: String(r['quote_code']),
        order_production_status: String(r['production_status']),
        ledger_scope: scope,
        customer_id: r['verified_customer_id']
          ? String(r['verified_customer_id'])
          : null,
        customer_code: r['verified_customer_code']
          ? String(r['verified_customer_code'])
          : null,
        customer_name: String(
          r['verified_customer_name'] || r['customer_name'],
        ),
        customer_phone: r['verified_customer_phone']
          ? String(r['verified_customer_phone'])
          : r['customer_phone']
            ? String(r['customer_phone'])
            : null,
        payment_type: paymentType,
        amount,
        payment_method:
          (r[
            'payment_method'
          ] as PrintLegacyArReconciliationItem['payment_method']) ||
          'BANK_TRANSFER',
        paid_at:
          r['paid_at'] instanceof Date
            ? r['paid_at'].toISOString()
            : String(r['paid_at']),
        reference_code: r['reference_code']
          ? String(r['reference_code'])
          : null,
        note: r['payment_note'] ? String(r['payment_note']) : null,
        status,
        anomaly_codes: anomalyCodes,
        warning_codes: warningCodes,
        can_confirm: canConfirm,
        posted_ar_transaction_id: r['posted_ar_transaction_id']
          ? String(r['posted_ar_transaction_id'])
          : null,
        posted_ar_tx_code: r['posted_ar_tx_code']
          ? String(r['posted_ar_tx_code'])
          : null,
        hold_reason: r['hold_reason'] ? String(r['hold_reason']) : null,
        resolution_note: r['resolution_note']
          ? String(r['resolution_note'])
          : null,
        order_total_quote_amount: grossQuote,
        order_valid_receivable_amount: toInt(
          r['valid_receivable_amount'],
          grossQuote,
        ),
        order_pre0036_paid_snapshot: prePaid,
        order_pre0036_remaining_snapshot: preRem,
        order_legacy_gross_receipts: grossReceipts,
        order_legacy_gross_refunds: grossRefunds,
        order_legacy_net_payments: grossReceipts - grossRefunds,
        order_official_ar_allocated: trans.officialPaid,
        order_legacy_pending_net: trans.pendingLegacyNet,
        pre_reconciliation_json:
          r['pre_reconciliation_json'] &&
          typeof r['pre_reconciliation_json'] === 'object'
            ? (r['pre_reconciliation_json'] as Record<string, unknown>)
            : {},
        post_reconciliation_json:
          r['post_reconciliation_json'] &&
          typeof r['post_reconciliation_json'] === 'object'
            ? (r['post_reconciliation_json'] as Record<string, unknown>)
            : null,
        confirmed_at: r['confirmed_at']
          ? r['confirmed_at'] instanceof Date
            ? r['confirmed_at'].toISOString()
            : String(r['confirmed_at'])
          : null,
        confirmed_by: r['confirmed_by'] ? String(r['confirmed_by']) : null,
        created_at:
          r['created_at'] instanceof Date
            ? r['created_at'].toISOString()
            : String(r['created_at']),
        updated_at:
          r['updated_at'] instanceof Date
            ? r['updated_at'].toISOString()
            : String(r['updated_at']),
      });
    }

    const orderGaps: LegacyOrderReconciliationGapItem[] = [];
    for (const o of ordRowsRes.rows) {
      const scope = normalizeLedgerScopeInput(o['ledger_scope']);
      if (scopeFilter && scope !== scopeFilter) continue;

      const orderId = String(o['id']);
      const leg = transitionMaps.legacyByOrder.get(orderId);
      const totalRows = leg?.totalRows ?? 0;
      const legacyNet = (leg?.allReceipts ?? 0) - (leg?.allRefunds ?? 0);
      const hasValidCust = Boolean(o['verified_customer_id']);
      const hasPre0036 =
        o['pre0036_total_paid_snapshot'] !== null &&
        o['pre0036_total_paid_snapshot'] !== undefined;
      const prePaid = hasPre0036
        ? toInt(o['pre0036_total_paid_snapshot'], 0)
        : 0;
      const grossQuote = toInt(o['total_quote_amount'], 0);
      const preRem =
        o['pre0036_remaining_debt_snapshot'] !== null &&
        o['pre0036_remaining_debt_snapshot'] !== undefined
          ? toInt(o['pre0036_remaining_debt_snapshot'], 0)
          : Math.max(0, grossQuote - prePaid);
      const isCancelled =
        o['production_status'] === PrintProductionStatus.CANCELLED;
      const resolved = Boolean(o['legacy_balance_discrepancy_resolved']);

      const gapAnomalies: LegacyArAnomalyCodeType[] = [];
      if (!hasValidCust) {
        gapAnomalies.push(LegacyArAnomalyCode.MISSING_CUSTOMER_ID);
        summary.orders_missing_customer_count++;
      }

      if (hasPre0036 && !resolved) {
        if (totalRows === 0 && prePaid > 0) {
          gapAnomalies.push(
            LegacyArAnomalyCode.ORPHAN_PAID_WITHOUT_PAYMENT_ROWS,
          );
          summary.orders_balance_mismatch_count++;
        } else if (
          prePaid !== legacyNet ||
          (!isCancelled && preRem !== Math.max(0, grossQuote - prePaid))
        ) {
          gapAnomalies.push(LegacyArAnomalyCode.ORDER_BALANCE_MISMATCH);
          summary.orders_balance_mismatch_count++;
        }
      }

      if (gapAnomalies.length > 0) {
        orderGaps.push({
          order_id: orderId,
          order_code: String(o['order_code']),
          quote_code: String(o['quote_code']),
          customer_id: hasValidCust ? String(o['verified_customer_id']) : null,
          customer_name: String(o['customer_name']),
          customer_phone: o['customer_phone']
            ? String(o['customer_phone'])
            : null,
          production_status: String(o['production_status']),
          ledger_scope: scope,
          total_quote_amount: grossQuote,
          pre0036_total_paid_snapshot: prePaid,
          pre0036_remaining_debt_snapshot: preRem,
          legacy_payments_count: totalRows,
          legacy_net_payments: legacyNet,
          anomaly_codes: gapAnomalies,
        });
      }
    }

    const history: PrintLegacyArReconciliationHistoryItem[] = histRes.rows.map(
      (h) => ({
        id: String(h['id']),
        workspace_id: String(h['workspace_id']),
        reconciliation_id: h['reconciliation_id']
          ? String(h['reconciliation_id'])
          : null,
        legacy_payment_id: h['legacy_payment_id']
          ? String(h['legacy_payment_id'])
          : null,
        order_id: String(h['order_id']),
        action: h['action'] as LegacyArHistoryActionType,
        before_json:
          h['before_json'] && typeof h['before_json'] === 'object'
            ? (h['before_json'] as Record<string, unknown>)
            : {},
        after_json:
          h['after_json'] && typeof h['after_json'] === 'object'
            ? (h['after_json'] as Record<string, unknown>)
            : {},
        reason: h['reason'] ? String(h['reason']) : null,
        actor_id: h['actor_id'] ? String(h['actor_id']) : null,
        created_at:
          h['created_at'] instanceof Date
            ? h['created_at'].toISOString()
            : String(h['created_at']),
      }),
    );

    return {
      summary,
      items,
      order_gaps: orderGaps,
      history,
    };
  }

  async linkCustomerToLegacyOrder(
    ctx: AuthenticatedContext,
    orderId: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<{
    order_id: string;
    order_code: string;
    customer_id: string;
    customer_code: string;
    customer_name: string;
  }> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      `/api/v1/print-quotes/orders/${orderId}/link-customer`,
      input,
      idempotencyKey,
      200,
      (client) =>
        linkCustomerToLegacyOrderTx(client, ctx, orderId, input, requestId),
    );
  }

  async reconcileLegacyOrderBalance(
    ctx: AuthenticatedContext,
    orderId: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<{
    order_id: string;
    order_code: string;
    aligned_total_paid_amount: number;
    aligned_remaining_debt_amount: number;
  }> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      `/api/v1/print-quotes/orders/${orderId}/reconcile-legacy-balance`,
      input,
      idempotencyKey,
      200,
      (client) =>
        reconcileLegacyOrderBalanceDiscrepancyTx(
          client,
          ctx,
          orderId,
          input,
          requestId,
        ),
    );
  }

  async confirmLegacyPaymentToAr(
    ctx: AuthenticatedContext,
    targetId: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<{
    reconciliation_id: string;
    legacy_payment_id: string;
    ar_transaction: PrintArTransactionData;
    before_snapshot: Record<string, unknown>;
    after_snapshot: Record<string, unknown>;
  }> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      `/api/v1/print-quotes/receivables/legacy-payments/${targetId}/confirm`,
      input,
      idempotencyKey,
      200,
      (client) =>
        confirmLegacyPaymentToArTx(client, ctx, targetId, input, requestId),
    );
  }

  async holdLegacyPaymentReconciliation(
    ctx: AuthenticatedContext,
    targetId: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<{
    reconciliation_id: string;
    legacy_payment_id: string;
    status: 'PENDING' | 'ON_HOLD';
    hold_reason: string | null;
  }> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      `/api/v1/print-quotes/receivables/legacy-payments/${targetId}/hold`,
      input,
      idempotencyKey,
      200,
      (client) =>
        holdLegacyPaymentReconciliationTx(
          client,
          ctx,
          targetId,
          input,
          requestId,
        ),
    );
  }

  async createCustomerReceipt(
    ctx: AuthenticatedContext,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintArTransactionData> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      '/api/v1/print-quotes/receivables/receipts',
      input,
      idempotencyKey,
      201,
      (client) => createCustomerReceiptTx(client, ctx, input, requestId),
    );
  }

  async allocateCustomerReceipt(
    ctx: AuthenticatedContext,
    arTxId: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintArTransactionData> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      `/api/v1/print-quotes/receivables/receipts/${arTxId}/allocate`,
      input,
      idempotencyKey,
      200,
      (client) =>
        allocateCustomerReceiptTx(client, ctx, arTxId, input, requestId),
    );
  }

  async createCustomerRefund(
    ctx: AuthenticatedContext,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintArTransactionData> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      '/api/v1/print-quotes/receivables/refunds',
      input,
      idempotencyKey,
      201,
      (client) => createCustomerRefundTx(client, ctx, input, requestId),
    );
  }

  async createArAdjustment(
    ctx: AuthenticatedContext,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintArAdjustmentData> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      '/api/v1/print-quotes/receivables/adjustments',
      input,
      idempotencyKey,
      201,
      (client) => createArAdjustmentTx(client, ctx, input, requestId),
    );
  }

  async voidArTransaction(
    ctx: AuthenticatedContext,
    arTxId: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintArTransactionData> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      `/api/v1/print-quotes/receivables/transactions/${arTxId}/void`,
      input,
      idempotencyKey,
      200,
      (client) => voidArTransactionTx(client, ctx, arTxId, input, requestId),
    );
  }

  // ==========================================================================
  // 3. WORKSHOP PAYABLES (AP — §D) & ORDER CANCELLATION SETTLEMENT (§E)
  // ==========================================================================

  async listVendorPayables(
    ctx: AuthenticatedContext,
    filters?: { ledger_scope?: string | undefined },
  ): Promise<{
    summaries: VendorPayableSummaryItem[];
    workshop_jobs: PrintWorkshopJobData[];
    transactions: PrintApTransactionData[];
    adjustments: PrintApAdjustmentData[];
    opening_balances: PrintOpeningBalanceData[];
    legacy_unreconciled_notes: LegacyUnreconciledVendorNoteItem[];
  }> {
    this.assertOwnerAccess(ctx);
    const scopeFilter = filters?.ledger_scope
      ? normalizeLedgerScopeInput(filters.ledger_scope)
      : null;

    const [vendRes, jobsRes, obRes, txRes, allocRes, adjRes, legacyOrdRes] =
      await Promise.all([
        this.pool.query(
          `SELECT id, code, name, phone, bank_name, bank_account_number, bank_account_holder
         FROM print_vendors WHERE workspace_id = $1`,
          [ctx.workspace.id],
        ),
        this.pool.query(
          `SELECT j.*, o.order_code
         FROM print_workshop_jobs j
         JOIN print_orders o ON o.id = j.order_id
         WHERE j.workspace_id = $1
         ORDER BY j.created_at DESC`,
          [ctx.workspace.id],
        ),
        this.pool.query(
          `SELECT * FROM print_opening_balances
         WHERE workspace_id = $1 AND direction = 'VENDOR_PAYABLE'
         ORDER BY as_of_date DESC`,
          [ctx.workspace.id],
        ),
        this.pool.query(
          `SELECT * FROM print_ap_transactions
         WHERE workspace_id = $1
         ORDER BY occurred_at DESC, created_at DESC`,
          [ctx.workspace.id],
        ),
        this.pool.query(
          `SELECT a.*, j.job_code, o.order_code, ob.doc_code AS opening_doc_code
         FROM print_ap_allocations a
         LEFT JOIN print_workshop_jobs j ON j.id = a.workshop_job_id
         LEFT JOIN print_orders o ON o.id = a.order_id
         LEFT JOIN print_opening_balances ob ON ob.id = a.opening_balance_id
         WHERE a.workspace_id = $1
         ORDER BY a.created_at ASC`,
          [ctx.workspace.id],
        ),
        this.pool.query(
          `SELECT adj.*, j.job_code
         FROM print_ap_adjustments adj
         LEFT JOIN print_workshop_jobs j ON j.id = adj.workshop_job_id
         WHERE adj.workspace_id = $1
         ORDER BY adj.created_at DESC`,
          [ctx.workspace.id],
        ),
        this.pool.query(
          `SELECT id, order_code, title, customer_name, vendor_id, vendor_name, vendor_paid_amount, order_date
         FROM print_orders
         WHERE workspace_id = $1
           AND vendor_paid_amount > 0
           AND legacy_vendor_paid_reconciled = false
         ORDER BY order_date DESC`,
          [ctx.workspace.id],
        ),
      ]);

    const vendMeta = new Map<
      string,
      {
        code: string;
        name: string;
        phone: string | null;
        bank_name: string | null;
        bank_account_number: string | null;
        bank_account_holder: string | null;
      }
    >();
    for (const v of vendRes.rows) {
      vendMeta.set(String(v['id']), {
        code: String(v['code']),
        name: String(v['name']),
        phone: v['phone'] ? String(v['phone']) : null,
        bank_name: v['bank_name'] ? String(v['bank_name']) : null,
        bank_account_number: v['bank_account_number']
          ? String(v['bank_account_number'])
          : null,
        bank_account_holder: v['bank_account_holder']
          ? String(v['bank_account_holder'])
          : null,
      });
    }

    const allocsByTx = new Map<
      string,
      ReturnType<typeof mapApAllocationRow>[]
    >();
    for (const r of allocRes.rows) {
      const m = mapApAllocationRow(r);
      const arr = allocsByTx.get(m.ap_transaction_id) ?? [];
      arr.push(m);
      allocsByTx.set(m.ap_transaction_id, arr);
    }

    const workshopJobs = jobsRes.rows
      .map(mapWorkshopJobRow)
      .filter((j) => !scopeFilter || j.ledger_scope === scopeFilter);

    const openingBalances = obRes.rows
      .map(mapOpeningBalanceRow)
      .filter((ob) => !scopeFilter || ob.ledger_scope === scopeFilter);

    const transactions = txRes.rows
      .map((r) => {
        const tx = mapApTransactionRow(r);
        tx.allocations = allocsByTx.get(tx.id) ?? [];
        return tx;
      })
      .filter((t) => !scopeFilter || t.ledger_scope === scopeFilter);

    const adjustments = adjRes.rows
      .map(mapApAdjustmentRow)
      .filter((a) => !scopeFilter || a.ledger_scope === scopeFilter);

    const buckets = new Map<string, VendorPayableSummaryItem>();
    const ensureBucket = (
      vendorId: string,
      fallbackName: string,
      scope: LedgerScopeType,
    ): VendorPayableSummaryItem => {
      const key = `${scope}:${vendorId}`;
      const existing = buckets.get(key);
      if (existing) return existing;
      const meta = vendMeta.get(vendorId);
      const created: VendorPayableSummaryItem = {
        vendor_id: vendorId,
        vendor_code: meta?.code ?? 'N/A',
        vendor_name: meta?.name ?? fallbackName,
        vendor_phone: meta?.phone ?? null,
        bank_name: meta?.bank_name ?? null,
        bank_account_number: meta?.bank_account_number ?? null,
        bank_account_holder: meta?.bank_account_holder ?? null,
        ledger_scope: scope,
        active_jobs_count: 0,
        confirmed_jobs_count: 0,
        unconfirmed_jobs_count: 0,
        expected_unconfirmed_cost_total: 0,
        valid_payable_total: 0,
        net_allocated_payout_total: 0,
        remaining_payable_total: 0,
        unallocated_advance_total: 0,
      };
      buckets.set(key, created);
      return created;
    };

    for (const j of workshopJobs) {
      if (!j.vendor_id) continue;
      const b = ensureBucket(
        j.vendor_id,
        j.vendor_name ?? 'Xưởng in',
        j.ledger_scope,
      );
      if (j.job_status !== WorkshopJobStatus.CANCELLED) {
        b.active_jobs_count++;
      }
      if (j.cost_status === WorkshopJobCostStatus.CONFIRMED) {
        b.confirmed_jobs_count++;
        const effectiveSettled = Math.min(
          j.valid_payable_amount,
          j.allocated_paid_amount,
        );
        b.valid_payable_total += j.valid_payable_amount;
        b.net_allocated_payout_total += effectiveSettled;
        b.remaining_payable_total += j.remaining_payable_amount;
      } else if (j.job_status !== WorkshopJobStatus.CANCELLED) {
        b.unconfirmed_jobs_count++;
        b.expected_unconfirmed_cost_total += j.entered_cost ?? j.expected_cost;
      }
    }

    for (const ob of openingBalances) {
      if (!ob.vendor_id) continue;
      const b = ensureBucket(
        ob.vendor_id,
        ob.vendor_name ?? 'Xưởng đầu kỳ',
        ob.ledger_scope,
      );
      const effectiveSettled = Math.min(
        ob.valid_amount,
        ob.allocated_settled_amount,
      );
      b.valid_payable_total += ob.valid_amount;
      b.net_allocated_payout_total += effectiveSettled;
      b.remaining_payable_total += ob.remaining_amount;
    }

    for (const tx of transactions) {
      if (
        tx.status === LedgerTxStatus.POSTED &&
        tx.tx_kind === ApTransactionKind.PAYOUT &&
        tx.unallocated_amount > 0
      ) {
        const b = ensureBucket(tx.vendor_id, tx.vendor_name, tx.ledger_scope);
        b.unallocated_advance_total += tx.unallocated_amount;
      }
    }

    const legacyNotes: LegacyUnreconciledVendorNoteItem[] =
      legacyOrdRes.rows.map((r) => ({
        order_id: String(r['id']),
        order_code: String(r['order_code']),
        title: String(r['title']),
        customer_name: String(r['customer_name']),
        vendor_id: r['vendor_id'] ? String(r['vendor_id']) : null,
        vendor_name: r['vendor_name'] ? String(r['vendor_name']) : null,
        vendor_paid_amount: toInt(r['vendor_paid_amount'], 0),
        order_date:
          toDateStr(r['order_date']) ?? new Date().toISOString().slice(0, 10),
      }));

    return {
      summaries: [...buckets.values()].sort(
        (a, b) =>
          b.remaining_payable_total - a.remaining_payable_total ||
          b.unallocated_advance_total - a.unallocated_advance_total ||
          a.vendor_name.localeCompare(b.vendor_name, 'vi'),
      ),
      workshop_jobs: workshopJobs,
      transactions,
      adjustments,
      opening_balances: openingBalances,
      legacy_unreconciled_notes: legacyNotes,
    };
  }

  async createVendorPayout(
    ctx: AuthenticatedContext,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintApTransactionData> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      '/api/v1/print-quotes/payables/payouts',
      input,
      idempotencyKey,
      201,
      (client) => createVendorPayoutTx(client, ctx, input, requestId),
    );
  }

  async allocateVendorPayout(
    ctx: AuthenticatedContext,
    apTxId: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintApTransactionData> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      `/api/v1/print-quotes/payables/payouts/${apTxId}/allocate`,
      input,
      idempotencyKey,
      200,
      (client) => allocateVendorPayoutTx(client, ctx, apTxId, input, requestId),
    );
  }

  async createVendorRefund(
    ctx: AuthenticatedContext,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintApTransactionData> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      '/api/v1/print-quotes/payables/refunds',
      input,
      idempotencyKey,
      201,
      (client) => createVendorRefundTx(client, ctx, input, requestId),
    );
  }

  async createApAdjustment(
    ctx: AuthenticatedContext,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintApAdjustmentData> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      '/api/v1/print-quotes/payables/adjustments',
      input,
      idempotencyKey,
      201,
      (client) => createApAdjustmentTx(client, ctx, input, requestId),
    );
  }

  async voidApTransaction(
    ctx: AuthenticatedContext,
    apTxId: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintApTransactionData> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      `/api/v1/print-quotes/payables/transactions/${apTxId}/void`,
      input,
      idempotencyKey,
      200,
      (client) => voidApTransactionTx(client, ctx, apTxId, input, requestId),
    );
  }

  async reconcileLegacyVendorNote(
    ctx: AuthenticatedContext,
    orderId: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<{
    reconciled: boolean;
    payout?: PrintApTransactionData | undefined;
  }> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      `/api/v1/print-quotes/orders/${orderId}/reconcile-legacy-vendor-note`,
      input,
      idempotencyKey,
      200,
      (client) =>
        reconcileLegacyVendorNoteTx(client, ctx, orderId, input, requestId),
    );
  }

  async settleCancelledOrder(
    ctx: AuthenticatedContext,
    orderId: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintOrderCancellationSettlementData> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      `/api/v1/print-quotes/orders/${orderId}/cancel-settlement`,
      input,
      idempotencyKey,
      201,
      (client) =>
        settleCancelledOrderTx(client, ctx, orderId, input, requestId),
    );
  }

  // ==========================================================================
  // 4. UNIFIED TRANSACTIONS & 3-MODE FINANCIAL REPORT (§F)
  // ==========================================================================

  async listUnifiedTransactions(
    ctx: AuthenticatedContext,
    filters?: {
      side?: string | undefined;
      ledger_scope?: string | undefined;
      unallocated_only?: boolean | undefined;
      q?: string | undefined;
    },
  ): Promise<UnifiedPrintLedgerItem[]> {
    this.assertOwnerAccess(ctx);
    const [arTxRes, arAllocRes, apTxRes, apAllocRes, arAdjRes, apAdjRes] =
      await Promise.all([
        this.pool.query(
          `SELECT * FROM print_ar_transactions WHERE workspace_id = $1 ORDER BY occurred_at DESC`,
          [ctx.workspace.id],
        ),
        this.pool.query(
          `SELECT a.ar_transaction_id, COALESCE(o.order_code, ob.doc_code) AS target_code
           FROM print_ar_allocations a
           LEFT JOIN print_orders o ON o.id = a.order_id
           LEFT JOIN print_opening_balances ob ON ob.id = a.opening_balance_id
           WHERE a.workspace_id = $1 AND a.direction = 'APPLY'`,
          [ctx.workspace.id],
        ),
        this.pool.query(
          `SELECT * FROM print_ap_transactions WHERE workspace_id = $1 ORDER BY occurred_at DESC`,
          [ctx.workspace.id],
        ),
        this.pool.query(
          `SELECT a.ap_transaction_id, COALESCE(j.job_code, ob.doc_code) AS target_code
           FROM print_ap_allocations a
           LEFT JOIN print_workshop_jobs j ON j.id = a.workshop_job_id
           LEFT JOIN print_opening_balances ob ON ob.id = a.opening_balance_id
           WHERE a.workspace_id = $1 AND a.direction = 'APPLY'`,
          [ctx.workspace.id],
        ),
        this.pool.query(
          `SELECT adj.*, COALESCE(o.order_code, ob.doc_code) AS target_code
           FROM print_ar_adjustments adj
           LEFT JOIN print_orders o ON o.id = adj.order_id
           LEFT JOIN print_opening_balances ob ON ob.id = adj.opening_balance_id
           WHERE adj.workspace_id = $1 ORDER BY adj.created_at DESC`,
          [ctx.workspace.id],
        ),
        this.pool.query(
          `SELECT adj.*, COALESCE(j.job_code, ob.doc_code) AS target_code
           FROM print_ap_adjustments adj
           LEFT JOIN print_workshop_jobs j ON j.id = adj.workshop_job_id
           LEFT JOIN print_opening_balances ob ON ob.id = adj.opening_balance_id
           WHERE adj.workspace_id = $1 ORDER BY adj.created_at DESC`,
          [ctx.workspace.id],
        ),
      ]);

    const arLinks = new Map<string, string[]>();
    for (const r of arAllocRes.rows) {
      if (!r['target_code']) continue;
      const k = String(r['ar_transaction_id']);
      const arr = arLinks.get(k) ?? [];
      if (!arr.includes(String(r['target_code']))) {
        arr.push(String(r['target_code']));
      }
      arLinks.set(k, arr);
    }

    const apLinks = new Map<string, string[]>();
    for (const r of apAllocRes.rows) {
      if (!r['target_code']) continue;
      const k = String(r['ap_transaction_id']);
      const arr = apLinks.get(k) ?? [];
      if (!arr.includes(String(r['target_code']))) {
        arr.push(String(r['target_code']));
      }
      apLinks.set(k, arr);
    }

    const items: UnifiedPrintLedgerItem[] = [];

    for (const r of arTxRes.rows) {
      const tx = mapArTransactionRow(r);
      items.push({
        id: tx.id,
        ledger_side: 'AR',
        code: tx.tx_code,
        tx_kind: tx.tx_kind,
        subtype: tx.receipt_subtype,
        ledger_scope: tx.ledger_scope,
        counterparty_id: tx.customer_id,
        counterparty_name: tx.customer_name,
        amount: tx.amount,
        allocated_amount: tx.allocated_amount,
        unallocated_amount: tx.unallocated_amount,
        payment_method: tx.payment_method,
        reference_code: tx.reference_code,
        status: tx.status,
        occurred_at: tx.occurred_at,
        note: tx.note,
        source_provenance: tx.source_sheet_name
          ? `${tx.source_sheet_name} / ${tx.source_tab_name ?? ''} #${tx.source_row_number ?? ''}`
          : null,
        linked_codes: arLinks.get(tx.id) ?? [],
        recorded_by: tx.recorded_by,
        created_at: tx.created_at,
      });
    }

    for (const r of apTxRes.rows) {
      const tx = mapApTransactionRow(r);
      items.push({
        id: tx.id,
        ledger_side: 'AP',
        code: tx.tx_code,
        tx_kind: tx.tx_kind,
        subtype: tx.payout_subtype,
        ledger_scope: tx.ledger_scope,
        counterparty_id: tx.vendor_id,
        counterparty_name: tx.vendor_name,
        amount: tx.amount,
        allocated_amount: tx.allocated_amount,
        unallocated_amount: tx.unallocated_amount,
        payment_method: tx.payment_method,
        reference_code: tx.reference_code,
        status: tx.status,
        occurred_at: tx.occurred_at,
        note: tx.note,
        source_provenance: tx.source_sheet_name
          ? `${tx.source_sheet_name} / ${tx.source_tab_name ?? ''} #${tx.source_row_number ?? ''}`
          : null,
        linked_codes: apLinks.get(tx.id) ?? [],
        recorded_by: tx.recorded_by,
        created_at: tx.created_at,
      });
    }

    for (const r of arAdjRes.rows) {
      const adj = mapArAdjustmentRow(r);
      items.push({
        id: adj.id,
        ledger_side: 'AR_ADJUSTMENT',
        code: adj.adj_code,
        tx_kind: adj.adjustment_type,
        subtype: null,
        ledger_scope: adj.ledger_scope,
        counterparty_id: adj.customer_id,
        counterparty_name: adj.customer_name,
        amount: adj.delta_amount,
        allocated_amount: Math.abs(adj.delta_amount),
        unallocated_amount: 0,
        payment_method: null,
        reference_code: adj.reference_code,
        status: 'POSTED',
        occurred_at: adj.created_at,
        note: adj.reason,
        source_provenance: null,
        linked_codes: r['target_code'] ? [String(r['target_code'])] : [],
        recorded_by: adj.recorded_by,
        created_at: adj.created_at,
      });
    }

    for (const r of apAdjRes.rows) {
      const adj = mapApAdjustmentRow(r);
      items.push({
        id: adj.id,
        ledger_side: 'AP_ADJUSTMENT',
        code: adj.adj_code,
        tx_kind: adj.adjustment_type,
        subtype: null,
        ledger_scope: adj.ledger_scope,
        counterparty_id: adj.vendor_id,
        counterparty_name: adj.vendor_name,
        amount: adj.delta_amount,
        allocated_amount: Math.abs(adj.delta_amount),
        unallocated_amount: 0,
        payment_method: null,
        reference_code: adj.reference_code,
        status: 'POSTED',
        occurred_at: adj.created_at,
        note: adj.reason,
        source_provenance: null,
        linked_codes: r['target_code'] ? [String(r['target_code'])] : [],
        recorded_by: adj.recorded_by,
        created_at: adj.created_at,
      });
    }

    const q = filters?.q?.trim().toLowerCase() ?? '';
    const scopeFilter = filters?.ledger_scope
      ? normalizeLedgerScopeInput(filters.ledger_scope)
      : null;

    return items
      .filter((it) => {
        if (filters?.side && it.ledger_side !== filters.side) return false;
        if (scopeFilter && it.ledger_scope !== scopeFilter) return false;
        if (filters?.unallocated_only && it.unallocated_amount <= 0) {
          return false;
        }
        if (q) {
          const hay = [
            it.code,
            it.counterparty_name,
            it.reference_code ?? '',
            it.note ?? '',
            ...it.linked_codes,
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }

  async getFinancialReport(
    ctx: AuthenticatedContext,
    filters?: { ledger_scope?: string | undefined },
  ): Promise<PrintFinancialReportData> {
    this.assertOwnerAccess(ctx);
    const scopeFilter = filters?.ledger_scope
      ? normalizeLedgerScopeInput(filters.ledger_scope)
      : null;

    const [
      ordRes,
      jobsRes,
      obRes,
      arTxRes,
      apTxRes,
      cancelApAllocRes,
      transitionMaps,
    ] = await Promise.all([
      this.pool.query(`SELECT * FROM print_orders WHERE workspace_id = $1`, [
        ctx.workspace.id,
      ]),
      this.pool.query(
        `SELECT * FROM print_workshop_jobs WHERE workspace_id = $1`,
        [ctx.workspace.id],
      ),
      this.pool.query(
        `SELECT * FROM print_opening_balances WHERE workspace_id = $1`,
        [ctx.workspace.id],
      ),
      this.pool.query(
        `SELECT * FROM print_ar_transactions WHERE workspace_id = $1 AND status = 'POSTED'`,
        [ctx.workspace.id],
      ),
      this.pool.query(
        `SELECT * FROM print_ap_transactions WHERE workspace_id = $1 AND status = 'POSTED'`,
        [ctx.workspace.id],
      ),
      this.pool.query<{ order_id: string; net_paid: string }>(
        `SELECT
             order_id::text AS order_id,
             (
               COALESCE(SUM(amount) FILTER (WHERE direction = 'APPLY'), 0) -
               COALESCE(SUM(amount) FILTER (WHERE direction IN ('UNAPPLY_REVERSAL', 'VENDOR_REFUND_RELEASE')), 0)
             )::text AS net_paid
           FROM print_ap_allocations
           WHERE workspace_id = $1 AND order_id IS NOT NULL
           GROUP BY order_id`,
        [ctx.workspace.id],
      ),
      this.queryOrderArTransitionMaps(ctx.workspace.id),
    ]);

    const apPaidByOrder = new Map<string, number>();
    for (const r of cancelApAllocRes.rows) {
      apPaidByOrder.set(r.order_id, toInt(r.net_paid, 0));
    }

    const jobsByOrder = new Map<
      string,
      ReturnType<typeof mapWorkshopJobRow>[]
    >();
    for (const r of jobsRes.rows) {
      const j = mapWorkshopJobRow(r);
      const arr = jobsByOrder.get(j.order_id) ?? [];
      arr.push(j);
      jobsByOrder.set(j.order_id, arr);
    }

    const byScope: PrintFinancialReportData['by_ledger_scope'] = {
      GENERAL: {
        valid_receivable: 0,
        remaining_receivable: 0,
        customer_unallocated: 0,
        valid_payable: 0,
        remaining_payable: 0,
        vendor_unallocated: 0,
      },
      RIENG: {
        valid_receivable: 0,
        remaining_receivable: 0,
        customer_unallocated: 0,
        valid_payable: 0,
        remaining_payable: 0,
        vendor_unallocated: 0,
      },
      HVGROUP: {
        valid_receivable: 0,
        remaining_receivable: 0,
        customer_unallocated: 0,
        valid_payable: 0,
        remaining_payable: 0,
        vendor_unallocated: 0,
      },
    };

    const projected: PrintFinancialReportData['projected'] = {
      active_orders_count: 0,
      gross_order_value: 0,
      net_ar_adjustments: 0,
      valid_order_receivable: 0,
      expected_vendor_cost: 0,
      expected_shipping_fee: 0,
      expected_extra_cost: 0,
      expected_profit: 0,
    };

    const reconciled: PrintFinancialReportData['reconciled'] = {
      reconciled_orders_count: 0,
      pending_cost_confirmation_orders_count: 0,
      confirmed_active_revenue: 0,
      confirmed_cancellation_fee_revenue: 0,
      confirmed_total_revenue: 0,
      confirmed_vendor_cost: 0,
      confirmed_shipping_fee: 0,
      confirmed_extra_cost: 0,
      reconciled_profit: 0,
    };

    const cashflow: PrintFinancialReportData['cashflow_and_debt'] = {
      valid_receivable_total: 0,
      net_allocated_customer_receipt: 0,
      remaining_receivable_total: 0,
      legacy_pending_ar_payments_count: 0,
      legacy_pending_ar_net_total: 0,
      effective_remaining_receivable_after_pending: 0,
      customer_cash_collected_gross: 0,
      customer_cash_refunded_total: 0,
      customer_cash_net_received: 0,
      customer_unallocated_advance_total: 0,
      valid_payable_total: 0,
      net_allocated_vendor_payout: 0,
      remaining_payable_total: 0,
      expected_unconfirmed_workshop_cost_total: 0,
      vendor_cash_paid_gross: 0,
      vendor_cash_refunded_total: 0,
      vendor_cash_net_paid: 0,
      vendor_unallocated_advance_total: 0,
      legacy_unreconciled_vendor_notes_count: 0,
      legacy_unreconciled_vendor_notes_total: 0,
    };

    const cancelled: PrintFinancialReportData['cancelled_and_pending'] = {
      cancelled_orders_count: 0,
      pending_settlement_orders_count: 0,
      settled_cancelled_orders_count: 0,
      customer_holding_pending_decision: 0,
      agreed_customer_refund_remaining: 0,
      retained_cancellation_fee_total: 0,
      cancelled_incurred_confirmed_cost: 0,
      cancelled_vendor_paid_allocated: 0,
      cancelled_vendor_remaining_payable: 0,
    };

    for (const r of ordRes.rows) {
      const scope = normalizeLedgerScopeInput(r['ledger_scope']);
      const isCancelled =
        r['production_status'] === PrintProductionStatus.CANCELLED;
      const cancelStatus =
        (r[
          'cancellation_settlement_status'
        ] as CancellationSettlementStatusType) ||
        CancellationSettlementStatus.NOT_APPLICABLE;
      const gross = toInt(r['total_quote_amount'], 0);
      const netAdj = toInt(r['net_ar_adjustment_amount'], 0);
      const agreedRefund = toInt(r['agreed_customer_refund_amount'], 0);
      const refundedAfter = toInt(r['refunded_after_cancel_amount'], 0);
      const retainedFee = toInt(r['retained_cancellation_fee'], 0);

      const trans = this.computeOrderTransitionAmounts(
        r,
        transitionMaps.officialNetByOrder,
        transitionMaps.legacyByOrder,
      );

      // Official AR strictly counts ONLY confirmed/posted AR allocations (`trans.officialPaid`)!
      const arMetrics = computeOrderReceivableMetrics({
        grossOrderAmount: gross,
        isCancelled,
        cancellationSettlementStatus: cancelStatus,
        agreedCustomerRefundAmount: agreedRefund,
        refundedAfterCancelAmount: refundedAfter,
        retainedCancellationFee: retainedFee,
        netArAdjustmentAmount: netAdj,
        netAllocatedReceiptAmount: trans.officialPaid,
      });

      const effectiveArMetrics = computeOrderReceivableMetrics({
        grossOrderAmount: gross,
        isCancelled,
        cancellationSettlementStatus: cancelStatus,
        agreedCustomerRefundAmount: agreedRefund,
        refundedAfterCancelAmount: refundedAfter,
        retainedCancellationFee: retainedFee,
        netArAdjustmentAmount: netAdj,
        netAllocatedReceiptAmount: trans.effectivePaid,
      });

      byScope[scope].valid_receivable += arMetrics.validReceivableAmount;
      byScope[scope].remaining_receivable +=
        arMetrics.remainingReceivableAmount;

      if (scopeFilter && scope !== scopeFilter) continue;

      const ordJobs = jobsByOrder.get(String(r['id'])) ?? [];
      const hasActiveUnconfirmedJobs = ordJobs.some(
        (j) =>
          j.job_status !== WorkshopJobStatus.CANCELLED &&
          j.cost_status !== WorkshopJobCostStatus.CONFIRMED,
      );
      const isConfirmed = Boolean(r['actual_cost_confirmed']);

      if (
        toInt(r['vendor_paid_amount'], 0) > 0 &&
        !r['legacy_vendor_paid_reconciled']
      ) {
        cashflow.legacy_unreconciled_vendor_notes_count++;
        cashflow.legacy_unreconciled_vendor_notes_total += toInt(
          r['vendor_paid_amount'],
          0,
        );
      }

      if (!isCancelled) {
        projected.active_orders_count++;
        projected.gross_order_value += gross;
        projected.net_ar_adjustments += netAdj;
        projected.valid_order_receivable += arMetrics.validReceivableAmount;
        projected.expected_vendor_cost += toInt(r['expected_vendor_cost'], 0);
        projected.expected_shipping_fee += toInt(r['expected_shipping_fee'], 0);
        projected.expected_extra_cost += toInt(r['expected_extra_cost'], 0);
      } else {
        cancelled.cancelled_orders_count++;
        if (cancelStatus === CancellationSettlementStatus.SETTLED) {
          cancelled.settled_cancelled_orders_count++;
          cancelled.retained_cancellation_fee_total += retainedFee;
        } else {
          cancelled.pending_settlement_orders_count++;
        }
        cancelled.customer_holding_pending_decision +=
          effectiveArMetrics.customerHoldingPendingAmount;
        cancelled.agreed_customer_refund_remaining +=
          arMetrics.remainingAgreedRefundAmount;
        if (isConfirmed) {
          cancelled.cancelled_incurred_confirmed_cost +=
            toInt(r['actual_vendor_cost'], 0) +
            toInt(r['actual_shipping_fee'], 0) +
            toInt(r['actual_extra_cost'], 0);
        }
        cancelled.cancelled_vendor_paid_allocated +=
          apPaidByOrder.get(String(r['id'])) ?? 0;
        cancelled.cancelled_vendor_remaining_payable += ordJobs.reduce(
          (s, j) => s + j.remaining_payable_amount,
          0,
        );
      }

      // Official AR Debt aggregation (`Còn phải thu sổ chính thức = Phải thu hợp lệ - Thu ròng đã phân bổ chính thức`)
      const officialSettled = Math.min(
        arMetrics.validReceivableAmount,
        trans.officialPaid,
      );
      cashflow.valid_receivable_total += arMetrics.validReceivableAmount;
      cashflow.net_allocated_customer_receipt += officialSettled;
      cashflow.remaining_receivable_total +=
        arMetrics.remainingReceivableAmount;
      cashflow.legacy_pending_ar_payments_count =
        (cashflow.legacy_pending_ar_payments_count ?? 0) +
        trans.pendingLegacyCount;
      cashflow.legacy_pending_ar_net_total =
        (cashflow.legacy_pending_ar_net_total ?? 0) + trans.pendingLegacyNet;
      cashflow.effective_remaining_receivable_after_pending =
        (cashflow.effective_remaining_receivable_after_pending ?? 0) +
        effectiveArMetrics.remainingReceivableAmount;

      // Reconciled profit evaluation
      const recon = computeOrderReconciledProfit({
        isCancelled,
        cancellationSettlementStatus: cancelStatus,
        validReceivableAmount: arMetrics.validReceivableAmount,
        retainedCancellationFee: retainedFee,
        hasActiveUnconfirmedWorkshopJobs: hasActiveUnconfirmedJobs,
        actualCostConfirmed: isConfirmed,
        confirmedVendorCost: isConfirmed
          ? toInt(r['actual_vendor_cost'], 0)
          : null,
        confirmedShippingFee: isConfirmed
          ? toInt(r['actual_shipping_fee'], 0)
          : null,
        confirmedExtraCost: isConfirmed
          ? toInt(r['actual_extra_cost'], 0)
          : null,
      });

      if (
        recon.isReconciled &&
        recon.confirmedRevenue !== null &&
        recon.reconciledProfit !== null
      ) {
        reconciled.reconciled_orders_count++;
        if (isCancelled) {
          reconciled.confirmed_cancellation_fee_revenue +=
            recon.confirmedRevenue;
        } else {
          reconciled.confirmed_active_revenue += recon.confirmedRevenue;
        }
        reconciled.confirmed_vendor_cost += toInt(r['actual_vendor_cost'], 0);
        reconciled.confirmed_shipping_fee += toInt(r['actual_shipping_fee'], 0);
        reconciled.confirmed_extra_cost += toInt(r['actual_extra_cost'], 0);
      } else if (!isCancelled) {
        reconciled.pending_cost_confirmation_orders_count++;
      }
    }

    projected.expected_profit =
      projected.valid_order_receivable -
      projected.expected_vendor_cost -
      projected.expected_shipping_fee -
      projected.expected_extra_cost;

    reconciled.confirmed_total_revenue =
      reconciled.confirmed_active_revenue +
      reconciled.confirmed_cancellation_fee_revenue;
    reconciled.reconciled_profit =
      reconciled.confirmed_total_revenue -
      reconciled.confirmed_vendor_cost -
      reconciled.confirmed_shipping_fee -
      reconciled.confirmed_extra_cost;

    // Opening balances in AR & AP
    for (const r of obRes.rows) {
      const ob = mapOpeningBalanceRow(r);
      const effectiveSettled = Math.min(
        ob.valid_amount,
        ob.allocated_settled_amount,
      );
      if (ob.direction === OpeningBalanceDirection.CUSTOMER_RECEIVABLE) {
        byScope[ob.ledger_scope].valid_receivable += ob.valid_amount;
        byScope[ob.ledger_scope].remaining_receivable += ob.remaining_amount;
        if (!scopeFilter || ob.ledger_scope === scopeFilter) {
          cashflow.valid_receivable_total += ob.valid_amount;
          cashflow.net_allocated_customer_receipt += effectiveSettled;
          cashflow.remaining_receivable_total += ob.remaining_amount;
          cashflow.effective_remaining_receivable_after_pending =
            (cashflow.effective_remaining_receivable_after_pending ?? 0) +
            ob.remaining_amount;
        }
      } else {
        byScope[ob.ledger_scope].valid_payable += ob.valid_amount;
        byScope[ob.ledger_scope].remaining_payable += ob.remaining_amount;
        if (!scopeFilter || ob.ledger_scope === scopeFilter) {
          cashflow.valid_payable_total += ob.valid_amount;
          cashflow.net_allocated_vendor_payout += effectiveSettled;
          cashflow.remaining_payable_total += ob.remaining_amount;
        }
      }
    }

    // Workshop jobs in AP
    for (const r of jobsRes.rows) {
      const j = mapWorkshopJobRow(r);
      if (j.cost_status === WorkshopJobCostStatus.CONFIRMED) {
        const effectiveSettled = Math.min(
          j.valid_payable_amount,
          j.allocated_paid_amount,
        );
        byScope[j.ledger_scope].valid_payable += j.valid_payable_amount;
        byScope[j.ledger_scope].remaining_payable += j.remaining_payable_amount;
        if (!scopeFilter || j.ledger_scope === scopeFilter) {
          cashflow.valid_payable_total += j.valid_payable_amount;
          cashflow.net_allocated_vendor_payout += effectiveSettled;
          cashflow.remaining_payable_total += j.remaining_payable_amount;
        }
      } else if (j.job_status !== WorkshopJobStatus.CANCELLED) {
        if (!scopeFilter || j.ledger_scope === scopeFilter) {
          cashflow.expected_unconfirmed_workshop_cost_total +=
            j.entered_cost ?? j.expected_cost;
        }
      }
    }

    // Cashflow from posted AR / AP transactions
    for (const r of arTxRes.rows) {
      const tx = mapArTransactionRow(r);
      if (tx.tx_kind === ArTransactionKind.RECEIPT) {
        byScope[tx.ledger_scope].customer_unallocated += tx.unallocated_amount;
        if (!scopeFilter || tx.ledger_scope === scopeFilter) {
          cashflow.customer_cash_collected_gross += tx.amount;
          cashflow.customer_unallocated_advance_total += tx.unallocated_amount;
        }
      } else if (tx.tx_kind === ArTransactionKind.REFUND) {
        if (!scopeFilter || tx.ledger_scope === scopeFilter) {
          cashflow.customer_cash_refunded_total += tx.amount;
        }
      }
    }
    cashflow.customer_cash_net_received =
      cashflow.customer_cash_collected_gross -
      cashflow.customer_cash_refunded_total;

    for (const r of apTxRes.rows) {
      const tx = mapApTransactionRow(r);
      if (tx.tx_kind === ApTransactionKind.PAYOUT) {
        byScope[tx.ledger_scope].vendor_unallocated += tx.unallocated_amount;
        if (!scopeFilter || tx.ledger_scope === scopeFilter) {
          cashflow.vendor_cash_paid_gross += tx.amount;
          cashflow.vendor_unallocated_advance_total += tx.unallocated_amount;
        }
      } else if (tx.tx_kind === ApTransactionKind.VENDOR_REFUND) {
        if (!scopeFilter || tx.ledger_scope === scopeFilter) {
          cashflow.vendor_cash_refunded_total += tx.amount;
        }
      }
    }
    cashflow.vendor_cash_net_paid =
      cashflow.vendor_cash_paid_gross - cashflow.vendor_cash_refunded_total;

    return {
      projected,
      reconciled,
      cashflow_and_debt: cashflow,
      cancelled_and_pending: cancelled,
      by_ledger_scope: byScope,
    };
  }

  // ==========================================================================
  // 5. HISTORICAL GOOGLE SHEET PREVIEW & CONFIRMED IMPORT (§G)
  // ==========================================================================

  async listHistoricalImportBatches(
    ctx: AuthenticatedContext,
  ): Promise<PrintHistoricalImportBatchData[]> {
    this.assertOwnerAccess(ctx);
    const res = await this.pool.query(
      `SELECT * FROM print_historical_import_batches
       WHERE workspace_id = $1
       ORDER BY created_at DESC`,
      [ctx.workspace.id],
    );
    return res.rows.map(mapHistoricalImportBatchRow);
  }

  async getHistoricalImportBatch(
    ctx: AuthenticatedContext,
    batchId: string,
  ): Promise<PrintHistoricalImportBatchData> {
    this.assertOwnerAccess(ctx);
    const bRes = await this.pool.query(
      `SELECT * FROM print_historical_import_batches WHERE id = $1 AND workspace_id = $2`,
      [batchId, ctx.workspace.id],
    );
    if (!bRes.rows[0]) {
      throw new AuthError(
        'NOT_FOUND',
        'Không tìm thấy lô đối soát nhập lịch sử.',
        404,
      );
    }
    const rRes = await this.pool.query(
      `SELECT * FROM print_historical_import_rows
       WHERE batch_id = $1 AND workspace_id = $2
       ORDER BY source_row_number ASC`,
      [batchId, ctx.workspace.id],
    );
    const batch = mapHistoricalImportBatchRow(bRes.rows[0]);
    batch.rows = rRes.rows.map(mapHistoricalImportRow);
    return batch;
  }

  async previewHistoricalImport(
    ctx: AuthenticatedContext,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintHistoricalImportBatchData> {
    this.assertOwnerAccess(ctx);
    const rawText =
      typeof input['raw_text'] === 'string' ? input['raw_text'] : '';
    const sourceSheetName =
      typeof input['source_sheet_name'] === 'string'
        ? input['source_sheet_name'].trim()
        : '';
    const sourceTabName =
      typeof input['source_tab_name'] === 'string'
        ? input['source_tab_name'].trim()
        : '';

    if (!rawText.trim() || !sourceSheetName || !sourceTabName) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Phải cung cấp Tên Google Sheet (source_sheet_name), Tên Tab (source_tab_name) và dữ liệu bảng (raw_text).',
        400,
      );
    }

    return this.withIdempotentTransaction(
      ctx,
      'POST',
      '/api/v1/print-quotes/import-history/preview',
      input,
      idempotencyKey,
      201,
      async (client) => {
        const fpRes = await client.query<{ row_fingerprint: string }>(
          `SELECT row_fingerprint
           FROM print_historical_import_rows
           WHERE workspace_id = $1 AND row_status = 'IMPORTED'`,
          [ctx.workspace.id],
        );
        const custRes = await client.query<{ id: string; name: string }>(
          `SELECT id, name FROM print_customers WHERE workspace_id = $1`,
          [ctx.workspace.id],
        );
        const vendRes = await client.query<{ id: string; name: string }>(
          `SELECT id, name FROM print_vendors WHERE workspace_id = $1`,
          [ctx.workspace.id],
        );

        const existingFps = new Set(fpRes.rows.map((r) => r.row_fingerprint));
        const custByName = new Map<string, string>();
        for (const c of custRes.rows) {
          custByName.set(c.name.trim().toLowerCase(), c.id);
        }
        const vendByName = new Map<string, string>();
        for (const v of vendRes.rows) {
          vendByName.set(v.name.trim().toLowerCase(), v.id);
        }

        const defaultScope = normalizeLedgerScopeInput(
          input['default_ledger_scope'],
        );
        const analyzed = analyzeHistoricalSheetRows({
          rawText,
          sourceSheetName,
          sourceTabName,
          defaultLedgerScope: defaultScope,
          existingImportedFingerprints: existingFps,
        });

        if (analyzed.length === 0) {
          throw new AuthError(
            'VALIDATION_ERROR',
            'Không tìm thấy dòng dữ liệu nào trong nội dung dán từ Sheet.',
            400,
          );
        }

        const batchCode = await allocateNextLedgerCode(
          client,
          ctx.workspace.id,
          'IMPORT_BATCH',
        );

        const readyCnt = analyzed.filter(
          (r) => r.rowStatus === HistoricalImportRowStatus.READY,
        ).length;
        const needsCnt = analyzed.filter(
          (r) => r.rowStatus === HistoricalImportRowStatus.NEEDS_CONFIRMATION,
        ).length;
        const dupCnt = analyzed.filter(
          (r) => r.rowStatus === HistoricalImportRowStatus.DUPLICATE,
        ).length;

        const bIns = await client.query(
          `INSERT INTO print_historical_import_batches (
             workspace_id, batch_code, source_sheet_name, source_tab_name,
             default_ledger_scope, raw_payload, status,
             total_rows, ready_rows_count, needs_confirmation_rows_count, duplicate_rows_count,
             created_by
           ) VALUES (
             $1, $2, $3, $4,
             $5, $6, 'PREVIEW',
             $7, $8, $9, $10,
             $11
           ) RETURNING *`,
          [
            ctx.workspace.id,
            batchCode,
            sourceSheetName,
            sourceTabName,
            defaultScope,
            rawText,
            analyzed.length,
            readyCnt,
            needsCnt,
            dupCnt,
            ctx.user.id,
          ],
        );
        const batch = mapHistoricalImportBatchRow(bIns.rows[0]!);
        const insertedRows: PrintHistoricalImportRowData[] = [];

        for (const row of analyzed) {
          const normName = row.counterpartyName?.trim().toLowerCase() ?? '';
          const matchedCustId =
            row.counterpartyRole === 'CUSTOMER' && normName
              ? (custByName.get(normName) ?? null)
              : null;
          const matchedVendId =
            row.counterpartyRole === 'VENDOR' && normName
              ? (vendByName.get(normName) ?? null)
              : null;

          // Fail-closed: NEEDS_CONFIRMATION rows default to UNDECIDED until Owner explicitly chooses!
          const initialOwnerRes: HistoricalImportResolutionType =
            row.rowStatus === HistoricalImportRowStatus.READY
              ? row.suggestedResolution
              : row.rowStatus === HistoricalImportRowStatus.DUPLICATE
                ? HistoricalImportResolution.SKIP
                : HistoricalImportResolution.UNDECIDED;

          const rIns = await client.query(
            `INSERT INTO print_historical_import_rows (
               workspace_id, batch_id, source_row_number, ledger_scope,
               counterparty_role, counterparty_name, matched_customer_id, matched_vendor_id,
               raw_amount_text, parsed_amount, raw_goods_total_text, parsed_goods_total,
               voucher_code, occurred_date, note,
               raw_cells_json, flags, row_status,
               suggested_resolution, owner_resolution, row_fingerprint
             ) VALUES (
               $1, $2, $3, $4,
               $5, $6, $7, $8,
               $9, $10, $11, $12,
               $13, $14, $15,
               $16::jsonb, $17::jsonb, $18,
               $19, $20, $21
             ) RETURNING *`,
            [
              ctx.workspace.id,
              batch.id,
              row.sourceRowNumber,
              row.ledgerScope,
              row.counterpartyRole,
              row.counterpartyName,
              matchedCustId,
              matchedVendId,
              row.rawAmountText,
              row.parsedAmount,
              row.rawGoodsTotalText,
              row.parsedGoodsTotal,
              row.voucherCode,
              row.occurredDate,
              row.note,
              JSON.stringify(row.rawCellsJson),
              JSON.stringify(row.flags),
              row.rowStatus,
              row.suggestedResolution,
              initialOwnerRes,
              row.rowFingerprint,
            ],
          );
          insertedRows.push(mapHistoricalImportRow(rIns.rows[0]!));
        }

        batch.rows = insertedRows;

        await recordAuditEvent(client, {
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.user.id,
          action: 'printquote.historical_import.preview',
          entityType: 'print_historical_import_batch',
          entityId: batch.id,
          requestId,
          metadata: {
            batch_code: batch.batch_code,
            source_sheet_name: sourceSheetName,
            source_tab_name: sourceTabName,
            total_rows: batch.total_rows,
          },
        });

        return batch;
      },
    );
  }

  async updateHistoricalImportRow(
    ctx: AuthenticatedContext,
    batchId: string,
    rowId: string,
    input: Record<string, unknown>,
  ): Promise<PrintHistoricalImportRowData> {
    this.assertOwnerAccess(ctx);
    const bRes = await this.pool.query(
      `SELECT status FROM print_historical_import_batches WHERE id = $1 AND workspace_id = $2`,
      [batchId, ctx.workspace.id],
    );
    if (!bRes.rows[0]) {
      throw new AuthError('NOT_FOUND', 'Không tìm thấy lô đối soát.', 404);
    }
    if (bRes.rows[0]['status'] !== HistoricalImportBatchStatus.PREVIEW) {
      throw new AuthError(
        'CONFLICT',
        'Chỉ được chỉnh sửa quyết định dòng khi lô nhập còn ở trạng thái Xem trước (PREVIEW).',
        409,
      );
    }

    const rRes = await this.pool.query(
      `SELECT * FROM print_historical_import_rows WHERE id = $1 AND batch_id = $2 AND workspace_id = $3`,
      [rowId, batchId, ctx.workspace.id],
    );
    const existing = rRes.rows[0];
    if (!existing) {
      throw new AuthError(
        'NOT_FOUND',
        'Không tìm thấy dòng nhập lịch sử.',
        404,
      );
    }

    const nextResolution =
      typeof input['owner_resolution'] === 'string'
        ? (input['owner_resolution'] as HistoricalImportResolutionType)
        : (existing['owner_resolution'] as HistoricalImportResolutionType);
    const nextScope =
      input['ledger_scope'] !== undefined
        ? normalizeLedgerScopeInput(input['ledger_scope'])
        : normalizeLedgerScopeInput(existing['ledger_scope']);
    const nextAmount =
      input['parsed_amount'] !== undefined
        ? input['parsed_amount'] === null
          ? null
          : assertSafePositiveVnd(
              toInt(input['parsed_amount'], 0),
              'Số tiền xác nhận nhập',
            )
        : existing['parsed_amount'] !== null
          ? toInt(existing['parsed_amount'], 0)
          : null;
    const nextVoucher =
      input['voucher_code'] !== undefined
        ? typeof input['voucher_code'] === 'string'
          ? input['voucher_code'].trim() || null
          : null
        : existing['voucher_code']
          ? String(existing['voucher_code'])
          : null;
    const nextCounterparty =
      input['counterparty_name'] !== undefined
        ? typeof input['counterparty_name'] === 'string'
          ? input['counterparty_name'].trim() || null
          : null
        : existing['counterparty_name']
          ? String(existing['counterparty_name'])
          : null;
    const nextVendorId =
      input['matched_vendor_id'] !== undefined
        ? typeof input['matched_vendor_id'] === 'string' &&
          input['matched_vendor_id'].trim()
          ? input['matched_vendor_id'].trim()
          : null
        : existing['matched_vendor_id']
          ? String(existing['matched_vendor_id'])
          : null;
    const nextCustomerId =
      input['matched_customer_id'] !== undefined
        ? typeof input['matched_customer_id'] === 'string' &&
          input['matched_customer_id'].trim()
          ? input['matched_customer_id'].trim()
          : null
        : existing['matched_customer_id']
          ? String(existing['matched_customer_id'])
          : null;
    const nextNote =
      input['note'] !== undefined
        ? typeof input['note'] === 'string'
          ? input['note'].trim() || null
          : null
        : existing['note']
          ? String(existing['note'])
          : null;

    const upd = await this.pool.query(
      `UPDATE print_historical_import_rows
       SET owner_resolution = $1,
           ledger_scope = $2,
           parsed_amount = $3,
           voucher_code = $4,
           counterparty_name = $5,
           matched_vendor_id = $6,
           matched_customer_id = $7,
           note = $8,
           updated_at = now()
       WHERE id = $9 AND batch_id = $10 AND workspace_id = $11
       RETURNING *`,
      [
        nextResolution,
        nextScope,
        nextAmount,
        nextVoucher,
        nextCounterparty,
        nextVendorId,
        nextCustomerId,
        nextNote,
        rowId,
        batchId,
        ctx.workspace.id,
      ],
    );

    return mapHistoricalImportRow(upd.rows[0]!);
  }

  async confirmHistoricalImportBatch(
    ctx: AuthenticatedContext,
    batchId: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    requestId = 'internal',
  ): Promise<PrintHistoricalImportBatchData> {
    this.assertOwnerAccess(ctx);
    return this.withIdempotentTransaction(
      ctx,
      'POST',
      `/api/v1/print-quotes/import-history/batches/${batchId}/confirm`,
      input,
      idempotencyKey,
      200,
      async (client) => {
        const bRes = await client.query(
          `SELECT * FROM print_historical_import_batches
           WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
          [batchId, ctx.workspace.id],
        );
        const bRow = bRes.rows[0];
        if (!bRow) {
          throw new AuthError(
            'NOT_FOUND',
            'Không tìm thấy lô nhập lịch sử.',
            404,
          );
        }
        if (bRow['status'] !== HistoricalImportBatchStatus.PREVIEW) {
          throw new AuthError(
            'CONFLICT',
            'Lô nhập lịch sử này đã được chốt hoặc hủy trước đó.',
            409,
          );
        }

        const rRes = await client.query(
          `SELECT * FROM print_historical_import_rows
           WHERE batch_id = $1 AND workspace_id = $2
           ORDER BY source_row_number ASC FOR UPDATE`,
          [batchId, ctx.workspace.id],
        );
        const rows = rRes.rows.map(mapHistoricalImportRow);

        const undecided = rows.filter(
          (r) => r.owner_resolution === HistoricalImportResolution.UNDECIDED,
        );
        if (undecided.length > 0) {
          throw new AuthError(
            'UNRESOLVED_IMPORT_ROWS',
            `Còn ${undecided.length} dòng lệch/thiếu dữ liệu chưa chọn phương án xử lý (dòng Sheet: ${undecided.map((u) => u.source_row_number).join(', ')}). Hệ thống không tự động đoán công nợ.`,
            400,
          );
        }

        const autoCreateVendors = input['auto_create_missing_vendors'] === true;
        const allowMissingVoucherWithNote =
          input['confirm_missing_voucher'] === true;
        const sheetName = String(bRow['source_sheet_name']);
        const tabName = String(bRow['source_tab_name']);

        let importedCount = 0;

        for (const row of rows) {
          const resChoice = row.owner_resolution;
          if (resChoice === HistoricalImportResolution.SKIP) {
            await client.query(
              `UPDATE print_historical_import_rows
               SET row_status = 'SKIPPED', updated_at = now()
               WHERE id = $1`,
              [row.id],
            );
            continue;
          }
          if (resChoice === HistoricalImportResolution.HOLD_FOR_REVIEW) {
            await client.query(
              `UPDATE print_historical_import_rows
               SET row_status = 'NEEDS_CONFIRMATION', updated_at = now()
               WHERE id = $1`,
              [row.id],
            );
            continue;
          }

          // Duplicate guard across previously imported batches
          const dupCheck = await client.query(
            `SELECT 1 FROM print_historical_import_rows
             WHERE workspace_id = $1 AND row_fingerprint = $2 AND row_status = 'IMPORTED'
             LIMIT 1`,
            [ctx.workspace.id, row.row_fingerprint],
          );
          if (dupCheck.rows.length > 0) {
            throw new AuthError(
              'DUPLICATE_IMPORT_ROW',
              `Dòng Sheet #${row.source_row_number} trùng với dữ liệu lịch sử đã nhập trước đó.`,
              409,
            );
          }

          if (!row.parsed_amount || row.parsed_amount <= 0) {
            throw new AuthError(
              'VALIDATION_ERROR',
              `Dòng Sheet #${row.source_row_number} chưa có số tiền hợp lệ (> 0 VND).`,
              400,
            );
          }
          if (!row.counterparty_name) {
            throw new AuthError(
              'VALIDATION_ERROR',
              `Dòng Sheet #${row.source_row_number} thiếu tên khách hàng / xưởng.`,
              400,
            );
          }
          if (!row.voucher_code && !allowMissingVoucherWithNote) {
            throw new AuthError(
              'MISSING_VOUCHER_CONFIRMATION_REQUIRED',
              `Dòng Sheet #${row.source_row_number} thiếu mã chứng từ. Cần nhập mã chứng từ hoặc xác nhận rõ cho phép nhập kèm ghi chú truy vết.`,
              400,
            );
          }

          const resolveVendorId = async (): Promise<string> => {
            if (row.matched_vendor_id) return row.matched_vendor_id;
            const existV = await client.query<{ id: string }>(
              `SELECT id FROM print_vendors
               WHERE workspace_id = $1 AND lower(btrim(name)) = lower(btrim($2))
               LIMIT 1`,
              [ctx.workspace.id, row.counterparty_name],
            );
            if (existV.rows[0]) return existV.rows[0].id;
            if (!autoCreateVendors) {
              throw new AuthError(
                'VENDOR_MATCH_REQUIRED',
                `Dòng Sheet #${row.source_row_number} ("${row.counterparty_name}") chưa khớp xưởng trong danh mục. Hãy chọn xưởng hoặc bật tạo mới nhà in.`,
                400,
              );
            }
            const vCode = `NI-HIST-${row.source_row_number}-${Date.now().toString().slice(-4)}`;
            const newV = await client.query<{ id: string }>(
              `INSERT INTO print_vendors (workspace_id, code, name, note)
               VALUES ($1, $2, $3, $4) RETURNING id`,
              [
                ctx.workspace.id,
                vCode,
                row.counterparty_name,
                `Tạo từ đối soát Sheet ${sheetName} / ${tabName} #${row.source_row_number}`,
              ],
            );
            return newV.rows[0]!.id;
          };

          let entityType = '';
          let entityId = '';
          const provenanceNote =
            row.note ??
            `Nhập lịch sử từ ${sheetName} / ${tabName} (dòng ${row.source_row_number})`;

          if (
            resChoice === HistoricalImportResolution.IMPORT_OPENING_RECEIVABLE
          ) {
            const ob = await createOpeningBalanceTx(
              client,
              ctx,
              {
                direction: OpeningBalanceDirection.CUSTOMER_RECEIVABLE,
                ledger_scope: row.ledger_scope,
                customer_id: row.matched_customer_id,
                customer_name: row.counterparty_name,
                original_amount: row.parsed_amount,
                as_of_date: row.occurred_date,
                reference_code: row.voucher_code,
                source_sheet_name: sheetName,
                source_tab_name: tabName,
                source_row_number: row.source_row_number,
                import_row_id: row.id,
                note: provenanceNote,
              },
              requestId,
            );
            entityType = 'print_opening_balance';
            entityId = ob.id;
          } else if (
            resChoice === HistoricalImportResolution.IMPORT_OPENING_PAYABLE
          ) {
            const vId = await resolveVendorId();
            const ob = await createOpeningBalanceTx(
              client,
              ctx,
              {
                direction: OpeningBalanceDirection.VENDOR_PAYABLE,
                ledger_scope: row.ledger_scope,
                vendor_id: vId,
                original_amount: row.parsed_amount,
                as_of_date: row.occurred_date,
                reference_code: row.voucher_code,
                source_sheet_name: sheetName,
                source_tab_name: tabName,
                source_row_number: row.source_row_number,
                import_row_id: row.id,
                note: provenanceNote,
              },
              requestId,
            );
            entityType = 'print_opening_balance';
            entityId = ob.id;
          } else if (
            resChoice === HistoricalImportResolution.IMPORT_CUSTOMER_ADVANCE
          ) {
            const tx = await createCustomerReceiptTx(
              client,
              ctx,
              {
                customer_id: row.matched_customer_id,
                customer_name: row.counterparty_name,
                ledger_scope: row.ledger_scope,
                receipt_subtype: ArReceiptSubtype.OPENING_ADVANCE,
                amount: row.parsed_amount,
                allocations: [],
                reference_code: row.voucher_code,
                confirm_duplicate_reference:
                  input['confirm_duplicate_reference'] === true,
                source_sheet_name: sheetName,
                source_tab_name: tabName,
                source_row_number: row.source_row_number,
                note: provenanceNote,
              },
              requestId,
            );
            entityType = 'print_ar_transaction';
            entityId = tx.id;
          } else if (
            resChoice === HistoricalImportResolution.IMPORT_VENDOR_ADVANCE
          ) {
            const vId = await resolveVendorId();
            const tx = await createVendorPayoutTx(
              client,
              ctx,
              {
                vendor_id: vId,
                ledger_scope: row.ledger_scope,
                payout_subtype: ApPayoutSubtype.OPENING_ADVANCE,
                amount: row.parsed_amount,
                allocations: [],
                reference_code: row.voucher_code,
                confirm_duplicate_reference:
                  input['confirm_duplicate_reference'] === true,
                source_sheet_name: sheetName,
                source_tab_name: tabName,
                source_row_number: row.source_row_number,
                note: provenanceNote,
              },
              requestId,
            );
            entityType = 'print_ap_transaction';
            entityId = tx.id;
          }

          await client.query(
            `UPDATE print_historical_import_rows
             SET row_status = 'IMPORTED',
                 imported_entity_type = $1,
                 imported_entity_id = $2,
                 updated_at = now()
             WHERE id = $3`,
            [entityType, entityId, row.id],
          );
          importedCount++;
        }

        const updB = await client.query(
          `UPDATE print_historical_import_batches
           SET status = 'CONFIRMED',
               imported_rows_count = $1,
               confirmed_by = $2,
               confirmed_at = now()
           WHERE id = $3 AND workspace_id = $4
           RETURNING *`,
          [importedCount, ctx.user.id, batchId, ctx.workspace.id],
        );

        const refreshedRows = await client.query(
          `SELECT * FROM print_historical_import_rows
           WHERE batch_id = $1 AND workspace_id = $2
           ORDER BY source_row_number ASC`,
          [batchId, ctx.workspace.id],
        );
        const batch = mapHistoricalImportBatchRow(updB.rows[0]!);
        batch.rows = refreshedRows.rows.map(mapHistoricalImportRow);

        await recordAuditEvent(client, {
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.user.id,
          action: 'printquote.historical_import.confirm',
          entityType: 'print_historical_import_batch',
          entityId: batch.id,
          requestId,
          metadata: {
            batch_code: batch.batch_code,
            imported_rows_count: importedCount,
          },
        });

        return batch;
      },
    );
  }
}
