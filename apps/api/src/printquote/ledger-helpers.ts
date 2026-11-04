import type pg from 'pg';
import {
  PrintProductionStatus,
  PrintPaymentStatus,
  OrderCostReconciliationStatus,
  LedgerScope,
  WorkshopJobStatus,
  WorkshopJobCostStatus,
  CancellationSettlementStatus,
  OpeningBalanceDirection,
  LedgerTxStatus,
  computeOrderReceivableMetrics,
  computeWorkshopJobPayableMetrics,
  assertTransactionConservationInvariant,
  normalizeLedgerScopeInput,
  type LedgerScopeType,
  type PrintPaymentStatusType,
  type OrderCostReconciliationStatusType,
  type WorkshopJobStatusType,
  type WorkshopJobCostStatusType,
  type WorkshopJobHistoryActionType,
  type WorkshopJobLineRef,
  type PrintWorkshopJobData,
  type PrintWorkshopJobHistoryData,
  type PrintOpeningBalanceData,
  type PrintArTransactionData,
  type PrintArAllocationData,
  type PrintArAdjustmentData,
  type PrintApTransactionData,
  type PrintApAllocationData,
  type PrintApAdjustmentData,
  type PrintOrderCancellationSettlementData,
  type PrintHistoricalImportBatchData,
  type PrintHistoricalImportRowData,
  type HistoricalImportFlagType,
  type HistoricalImportRowStatusType,
  type HistoricalImportResolutionType,
  type HistoricalImportBatchStatusType,
  type CancellationSettlementStatusType,
} from '../../../../packages/contracts/src/printquote.js';
import { AuthError } from '../auth/service.js';

export function toInt(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val);
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return fallback;
}

export function toIso(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

export function toDateStr(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return toDateStr(parsed);
  }
  return null;
}

export function computeOrderPaymentStatus(
  validReceivable: number,
  depositPaid: number,
  netAllocatedReceipt: number,
): PrintPaymentStatusType {
  if (netAllocatedReceipt <= 0) return PrintPaymentStatus.UNPAID;
  if (validReceivable > 0 && netAllocatedReceipt >= validReceivable) {
    return PrintPaymentStatus.PAID;
  }
  if (depositPaid > 0 && netAllocatedReceipt === depositPaid) {
    return PrintPaymentStatus.DEPOSIT_PAID;
  }
  return PrintPaymentStatus.PARTIALLY_PAID;
}

export type LedgerCodeKind =
  | 'WORKSHOP_JOB'
  | 'AR_TX'
  | 'AP_TX'
  | 'AR_ADJ'
  | 'AP_ADJ'
  | 'OPENING_BAL'
  | 'IMPORT_BATCH';

const LEDGER_CODE_META: Record<
  LedgerCodeKind,
  { prefix: string; table: string; column: string }
> = {
  WORKSHOP_JOB: {
    prefix: 'CVX',
    table: 'print_workshop_jobs',
    column: 'job_code',
  },
  AR_TX: { prefix: 'PT', table: 'print_ar_transactions', column: 'tx_code' },
  AP_TX: { prefix: 'PC', table: 'print_ap_transactions', column: 'tx_code' },
  AR_ADJ: {
    prefix: 'DCAR',
    table: 'print_ar_adjustments',
    column: 'adj_code',
  },
  AP_ADJ: {
    prefix: 'DCAP',
    table: 'print_ap_adjustments',
    column: 'adj_code',
  },
  OPENING_BAL: {
    prefix: 'DK',
    table: 'print_opening_balances',
    column: 'doc_code',
  },
  IMPORT_BATCH: {
    prefix: 'IMP',
    table: 'print_historical_import_batches',
    column: 'batch_code',
  },
};

export async function allocateNextLedgerCode(
  client: pg.PoolClient,
  workspaceId: string,
  kind: LedgerCodeKind,
  explicitCode?: unknown,
): Promise<string> {
  const meta = LEDGER_CODE_META[kind];
  if (typeof explicitCode === 'string' && explicitCode.trim()) {
    const normalized = explicitCode.trim().toUpperCase();
    const dupRes = await client.query(
      `SELECT 1 FROM ${meta.table} WHERE workspace_id = $1 AND ${meta.column} = $2 LIMIT 1`,
      [workspaceId, normalized],
    );
    if (dupRes.rows.length > 0) {
      throw new AuthError(
        'CONFLICT',
        `Mã chứng từ "${normalized}" đã tồn tại trong sổ in ấn.`,
        409,
      );
    }
    return normalized;
  }

  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
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
    const candidate = `${meta.prefix}-${ym}-${String(seq).padStart(3, '0')}`;
    const existsRes = await client.query(
      `SELECT 1 FROM ${meta.table} WHERE workspace_id = $1 AND ${meta.column} = $2 LIMIT 1`,
      [workspaceId, candidate],
    );
    if (existsRes.rows.length === 0) {
      return candidate;
    }
  }

  throw new AuthError(
    'INTERNAL_ERROR',
    'Không thể cấp mã sổ cái in ấn tự động sau nhiều lần thử.',
    500,
  );
}

/**
 * Mirrors a `print_order_payments` row 1-to-1 into `print_ar_transactions` and `print_ar_allocations`
 * so legacy order payment endpoints and the dedicated AR ledger stay 100% synchronized.
 */
export async function mirrorLegacyOrderPaymentToAr(
  client: pg.PoolClient,
  params: {
    workspaceId: string;
    orderRow: Record<string, unknown>;
    paymentRow: Record<string, unknown>;
  },
): Promise<void> {
  const paymentId = String(params.paymentRow['id']);
  const existingRes = await client.query(
    `SELECT id FROM print_ar_transactions WHERE legacy_order_payment_id = $1 LIMIT 1`,
    [paymentId],
  );
  if (existingRes.rows.length > 0) return;

  const pType = String(params.paymentRow['payment_type'] || 'INSTALLMENT');
  const isRefund = pType === 'REFUND';
  const amount = toInt(params.paymentRow['amount'], 0);
  const txCode = await allocateNextLedgerCode(
    client,
    params.workspaceId,
    'AR_TX',
  );
  const scope = normalizeLedgerScopeInput(params.orderRow['ledger_scope']);

  assertTransactionConservationInvariant({
    label: `mirrorLegacyPayment(${txCode})`,
    amount,
    allocatedAmount: amount,
    refundedUnallocatedAmount: 0,
    unallocatedAmount: 0,
  });

  const txRes = await client.query<{ id: string }>(
    `INSERT INTO print_ar_transactions (
       workspace_id, tx_code, customer_id, customer_name, ledger_scope,
       tx_kind, receipt_subtype, amount, allocated_amount,
       refunded_unallocated_amount, unallocated_amount,
       payment_method, occurred_at, reference_code, note, status,
       related_order_id, legacy_order_payment_id, recorded_by
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $8,
       0, 0,
       $9, $10, $11, $12, 'POSTED',
       $13, $14, $15
     ) RETURNING id`,
    [
      params.workspaceId,
      txCode,
      params.orderRow['customer_id'] ?? null,
      String(params.orderRow['customer_name']),
      scope,
      isRefund ? 'REFUND' : 'RECEIPT',
      isRefund ? null : pType,
      amount,
      params.paymentRow['payment_method'] ?? 'BANK_TRANSFER',
      params.paymentRow['paid_at'] ?? new Date(),
      params.paymentRow['reference_code'] ?? null,
      params.paymentRow['note'] ?? null,
      String(params.orderRow['id']),
      paymentId,
      params.paymentRow['recorded_by'] ?? null,
    ],
  );

  await client.query(
    `INSERT INTO print_ar_allocations (
       workspace_id, ar_transaction_id, order_id, direction, amount, note, recorded_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.workspaceId,
      txRes.rows[0]!.id,
      String(params.orderRow['id']),
      isRefund ? 'REFUND_RELEASE' : 'APPLY',
      amount,
      params.paymentRow['note'] ?? null,
      params.paymentRow['recorded_by'] ?? null,
    ],
  );

  await recomputeOrderReceivableState(
    client,
    params.workspaceId,
    String(params.orderRow['id']),
  );
}

export async function recomputeOrderReceivableState(
  client: pg.PoolClient,
  workspaceId: string,
  orderId: string,
): Promise<{
  orderRow: Record<string, unknown>;
  validReceivableAmount: number;
  netAllocatedReceiptAmount: number;
  remainingReceivableAmount: number;
  overAllocatedAmount: number;
}> {
  const ordRes = await client.query(
    `SELECT * FROM print_orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [orderId, workspaceId],
  );
  const ord = ordRes.rows[0];
  if (!ord) {
    throw new AuthError('NOT_FOUND', 'Không tìm thấy đơn hàng in ấn.', 404);
  }

  const adjRes = await client.query<{ net_adj: string }>(
    `SELECT COALESCE(SUM(delta_amount), 0)::text AS net_adj
     FROM print_ar_adjustments
     WHERE workspace_id = $1 AND order_id = $2`,
    [workspaceId, orderId],
  );
  const allocRes = await client.query<{
    apply_sum: string;
    unapply_sum: string;
    refund_sum: string;
    deposit_sum: string;
  }>(
    `SELECT
       COALESCE(SUM(a.amount) FILTER (WHERE a.direction = 'APPLY'), 0)::text AS apply_sum,
       COALESCE(SUM(a.amount) FILTER (WHERE a.direction = 'UNAPPLY_REVERSAL'), 0)::text AS unapply_sum,
       COALESCE(SUM(a.amount) FILTER (WHERE a.direction = 'REFUND_RELEASE'), 0)::text AS refund_sum,
       COALESCE(SUM(a.amount) FILTER (WHERE a.direction = 'APPLY' AND t.receipt_subtype = 'DEPOSIT'), 0)::text AS deposit_sum
     FROM print_ar_allocations a
     JOIN print_ar_transactions t ON t.id = a.ar_transaction_id
     WHERE a.workspace_id = $1 AND a.order_id = $2`,
    [workspaceId, orderId],
  );

  const netArAdj = toInt(adjRes.rows[0]?.net_adj, 0);
  const applySum = toInt(allocRes.rows[0]?.apply_sum, 0);
  const unapplySum = toInt(allocRes.rows[0]?.unapply_sum, 0);
  const refundSum = toInt(allocRes.rows[0]?.refund_sum, 0);
  const depositApplySum = toInt(allocRes.rows[0]?.deposit_sum, 0);

  const rawNetAllocated = applySum - unapplySum - refundSum;
  if (rawNetAllocated < 0) {
    throw new AuthError(
      'VALIDATION_ERROR',
      `Tổng hoàn/hủy phân bổ vượt quá số tiền đã thu trên đơn ${String(ord['order_code'])}.`,
      400,
    );
  }
  const netAllocatedReceipt = rawNetAllocated;
  const depositPaid = Math.min(depositApplySum, netAllocatedReceipt);

  const isCancelled =
    ord['production_status'] === PrintProductionStatus.CANCELLED;
  const grossOrderAmount = toInt(ord['total_quote_amount'], 0);
  const agreedRefund = toInt(ord['agreed_customer_refund_amount'], 0);
  const refundedAfterCancel = toInt(ord['refunded_after_cancel_amount'], 0);
  const retainedFee = toInt(ord['retained_cancellation_fee'], 0);

  let cancelStatus: CancellationSettlementStatusType =
    (ord[
      'cancellation_settlement_status'
    ] as CancellationSettlementStatusType) ||
    CancellationSettlementStatus.NOT_APPLICABLE;

  if (!isCancelled) {
    cancelStatus = CancellationSettlementStatus.NOT_APPLICABLE;
  } else if (cancelStatus === CancellationSettlementStatus.NOT_APPLICABLE) {
    const hasObligation =
      netAllocatedReceipt > 0 ||
      toInt(ord['vendor_paid_amount'], 0) > 0 ||
      toInt(ord['entered_vendor_cost'], 0) > 0 ||
      toInt(ord['actual_vendor_cost'], 0) > 0;
    cancelStatus = hasObligation
      ? CancellationSettlementStatus.PENDING_SETTLEMENT
      : CancellationSettlementStatus.SETTLED;
  }

  let metrics: ReturnType<typeof computeOrderReceivableMetrics>;
  try {
    metrics = computeOrderReceivableMetrics({
      grossOrderAmount,
      isCancelled,
      cancellationSettlementStatus: cancelStatus,
      agreedCustomerRefundAmount: agreedRefund,
      refundedAfterCancelAmount: refundedAfterCancel,
      retainedCancellationFee: retainedFee,
      netArAdjustmentAmount: netArAdj,
      netAllocatedReceiptAmount: netAllocatedReceipt,
    });
  } catch (err) {
    throw new AuthError(
      'VALIDATION_ERROR',
      err instanceof Error
        ? err.message
        : 'Lỗi tính công nợ phải thu đơn hàng.',
      400,
    );
  }

  const paymentStatus = computeOrderPaymentStatus(
    isCancelled ? grossOrderAmount : metrics.validReceivableAmount,
    depositPaid,
    netAllocatedReceipt,
  );

  const isConfirmed = Boolean(ord['actual_cost_confirmed']);
  const confirmedRev = isCancelled
    ? cancelStatus === CancellationSettlementStatus.SETTLED
      ? retainedFee
      : 0
    : metrics.validReceivableAmount;
  const nextActualProfit = isConfirmed
    ? confirmedRev -
      toInt(ord['actual_vendor_cost'], 0) -
      toInt(ord['actual_shipping_fee'], 0) -
      toInt(ord['actual_extra_cost'], 0)
    : toInt(ord['actual_profit'], 0);

  const updRes = await client.query(
    `UPDATE print_orders
     SET net_ar_adjustment_amount = $1,
         valid_receivable_amount = $2,
         deposit_paid = $3,
         total_paid_amount = $4,
         remaining_debt_amount = $5,
         payment_status = $6,
         cancellation_settlement_status = $7,
         actual_profit = $8,
         updated_at = now()
     WHERE id = $9 AND workspace_id = $10
     RETURNING *`,
    [
      netArAdj,
      metrics.validReceivableAmount,
      depositPaid,
      netAllocatedReceipt,
      metrics.remainingReceivableAmount,
      paymentStatus,
      cancelStatus,
      nextActualProfit,
      orderId,
      workspaceId,
    ],
  );

  return {
    orderRow: updRes.rows[0]!,
    validReceivableAmount: metrics.validReceivableAmount,
    netAllocatedReceiptAmount: netAllocatedReceipt,
    remainingReceivableAmount: metrics.remainingReceivableAmount,
    overAllocatedAmount: metrics.overAllocatedAmount,
  };
}

export async function recomputeOpeningBalanceState(
  client: pg.PoolClient,
  workspaceId: string,
  openingBalanceId: string,
): Promise<PrintOpeningBalanceData> {
  const obRes = await client.query(
    `SELECT * FROM print_opening_balances WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [openingBalanceId, workspaceId],
  );
  const ob = obRes.rows[0];
  if (!ob) {
    throw new AuthError('NOT_FOUND', 'Không tìm thấy số dư đầu kỳ.', 404);
  }

  const isAr = ob['direction'] === OpeningBalanceDirection.CUSTOMER_RECEIVABLE;
  const originalAmount = toInt(ob['original_amount'], 0);

  const adjRes = await client.query<{ net_adj: string }>(
    isAr
      ? `SELECT COALESCE(SUM(delta_amount), 0)::text AS net_adj
         FROM print_ar_adjustments WHERE workspace_id = $1 AND opening_balance_id = $2`
      : `SELECT COALESCE(SUM(delta_amount), 0)::text AS net_adj
         FROM print_ap_adjustments WHERE workspace_id = $1 AND opening_balance_id = $2`,
    [workspaceId, openingBalanceId],
  );
  const allocRes = await client.query<{
    apply_sum: string;
    release_sum: string;
  }>(
    isAr
      ? `SELECT
           COALESCE(SUM(amount) FILTER (WHERE direction = 'APPLY'), 0)::text AS apply_sum,
           COALESCE(SUM(amount) FILTER (WHERE direction IN ('UNAPPLY_REVERSAL', 'REFUND_RELEASE')), 0)::text AS release_sum
         FROM print_ar_allocations WHERE workspace_id = $1 AND opening_balance_id = $2`
      : `SELECT
           COALESCE(SUM(amount) FILTER (WHERE direction = 'APPLY'), 0)::text AS apply_sum,
           COALESCE(SUM(amount) FILTER (WHERE direction IN ('UNAPPLY_REVERSAL', 'VENDOR_REFUND_RELEASE')), 0)::text AS release_sum
         FROM print_ap_allocations WHERE workspace_id = $1 AND opening_balance_id = $2`,
    [workspaceId, openingBalanceId],
  );

  const netAdj = toInt(adjRes.rows[0]?.net_adj, 0);
  const validAmount = originalAmount + netAdj;
  if (validAmount < 0) {
    throw new AuthError(
      'VALIDATION_ERROR',
      `Điều chỉnh giảm không được làm số dư đầu kỳ ${String(ob['doc_code'])} bị âm.`,
      400,
    );
  }

  const settled =
    toInt(allocRes.rows[0]?.apply_sum, 0) -
    toInt(allocRes.rows[0]?.release_sum, 0);
  if (settled < 0) {
    throw new AuthError(
      'VALIDATION_ERROR',
      `Số tiền hoàn/hủy phân bổ vượt quá số đã cấn trừ trên ${String(ob['doc_code'])}.`,
      400,
    );
  }
  const remaining = Math.max(0, validAmount - settled);

  const updRes = await client.query(
    `UPDATE print_opening_balances
     SET net_adjustment_amount = $1,
         valid_amount = $2,
         allocated_settled_amount = $3,
         remaining_amount = $4
     WHERE id = $5 AND workspace_id = $6
     RETURNING *`,
    [netAdj, validAmount, settled, remaining, openingBalanceId, workspaceId],
  );

  return mapOpeningBalanceRow(updRes.rows[0]!);
}

export async function recomputeWorkshopJobState(
  client: pg.PoolClient,
  workspaceId: string,
  workshopJobId: string,
): Promise<PrintWorkshopJobData> {
  const jobRes = await client.query(
    `SELECT * FROM print_workshop_jobs WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [workshopJobId, workspaceId],
  );
  const job = jobRes.rows[0];
  if (!job) {
    throw new AuthError('NOT_FOUND', 'Không tìm thấy phiếu đặt xưởng.', 404);
  }

  const adjRes = await client.query<{ net_adj: string }>(
    `SELECT COALESCE(SUM(delta_amount), 0)::text AS net_adj
     FROM print_ap_adjustments
     WHERE workspace_id = $1 AND workshop_job_id = $2`,
    [workspaceId, workshopJobId],
  );
  const allocRes = await client.query<{
    apply_sum: string;
    release_sum: string;
  }>(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE direction = 'APPLY'), 0)::text AS apply_sum,
       COALESCE(SUM(amount) FILTER (WHERE direction IN ('UNAPPLY_REVERSAL', 'VENDOR_REFUND_RELEASE')), 0)::text AS release_sum
     FROM print_ap_allocations
     WHERE workspace_id = $1 AND workshop_job_id = $2`,
    [workspaceId, workshopJobId],
  );

  const netApAdj = toInt(adjRes.rows[0]?.net_adj, 0);
  const netPaid =
    toInt(allocRes.rows[0]?.apply_sum, 0) -
    toInt(allocRes.rows[0]?.release_sum, 0);
  if (netPaid < 0) {
    throw new AuthError(
      'VALIDATION_ERROR',
      `Tổng hoàn tiền nhà in vượt quá số đã chi trên phiếu đặt xưởng ${String(job['job_code'])}.`,
      400,
    );
  }

  const jobStatus = job['job_status'] as WorkshopJobStatusType;
  const costStatus = job['cost_status'] as WorkshopJobCostStatusType;
  const expectedCost = toInt(job['expected_cost'], 0);
  const enteredCost =
    job['entered_cost'] !== null && job['entered_cost'] !== undefined
      ? toInt(job['entered_cost'], 0)
      : null;
  const confirmedCost =
    job['confirmed_cost'] !== null && job['confirmed_cost'] !== undefined
      ? toInt(job['confirmed_cost'], 0)
      : null;

  let metrics: ReturnType<typeof computeWorkshopJobPayableMetrics>;
  try {
    metrics = computeWorkshopJobPayableMetrics({
      jobStatus,
      costStatus,
      expectedCost,
      enteredCost,
      confirmedCost,
      netApAdjustmentAmount: netApAdj,
      netAllocatedPayoutAmount: netPaid,
    });
  } catch (err) {
    throw new AuthError(
      'VALIDATION_ERROR',
      err instanceof Error ? err.message : 'Lỗi tính phải trả phiếu đặt xưởng.',
      400,
    );
  }

  const updRes = await client.query(
    `UPDATE print_workshop_jobs
     SET net_ap_adjustment_amount = $1,
         valid_payable_amount = $2,
         allocated_paid_amount = $3,
         remaining_payable_amount = $4,
         vendor_overpaid_credit_amount = $5,
         updated_at = now()
     WHERE id = $6 AND workspace_id = $7
     RETURNING *`,
    [
      netApAdj,
      metrics.validPayableAmount,
      netPaid,
      metrics.remainingPayableAmount,
      metrics.vendorOverpaidCreditAmount,
      workshopJobId,
      workspaceId,
    ],
  );

  return mapWorkshopJobRow(updRes.rows[0]!);
}

/**
 * Synchronizes an order's aggregated vendor cost & confirmation gate from its active workshop jobs:
 * - Never auto-confirms unconfirmed shipping/extra costs.
 * - If ANY active workshop job is unconfirmed, forces `order.actual_cost_confirmed = false` so
 *   partial multi-workshop orders never falsely claim reconciled profit.
 * - If ALL active workshop jobs are `CONFIRMED`, rolls up `SUM(valid_payable_amount)` into
 *   `order.entered_vendor_cost` (and into `actual_vendor_cost` / `actual_profit` if shipping & extra
 *   are entered and `autoConfirmOrderIfComplete` or `wasConfirmed` holds).
 */
export async function syncOrderFromWorkshopJobs(
  client: pg.PoolClient,
  params: {
    workspaceId: string;
    orderId: string;
    actorId: string;
    note?: string | null | undefined;
    autoConfirmOrderIfComplete?: boolean | undefined;
  },
): Promise<void> {
  const ordRes = await client.query(
    `SELECT * FROM print_orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [params.orderId, params.workspaceId],
  );
  const ord = ordRes.rows[0];
  if (!ord) return;

  const jobsRes = await client.query(
    `SELECT * FROM print_workshop_jobs
     WHERE workspace_id = $1 AND order_id = $2
     ORDER BY created_at ASC`,
    [params.workspaceId, params.orderId],
  );
  if (jobsRes.rows.length === 0) return;

  const activeJobs = jobsRes.rows.filter(
    (j) => j['job_status'] !== WorkshopJobStatus.CANCELLED,
  );
  const cancelledConfirmedJobs = jobsRes.rows.filter(
    (j) =>
      j['job_status'] === WorkshopJobStatus.CANCELLED &&
      j['cost_status'] === WorkshopJobCostStatus.CONFIRMED,
  );

  const allActiveConfirmed =
    activeJobs.length > 0 &&
    activeJobs.every(
      (j) => j['cost_status'] === WorkshopJobCostStatus.CONFIRMED,
    );
  const anyEnteredOrConfirmed =
    activeJobs.some(
      (j) =>
        j['cost_status'] === WorkshopJobCostStatus.CONFIRMED ||
        j['entered_cost'] !== null,
    ) || cancelledConfirmedJobs.length > 0;

  let aggregatedVendorCost: number | null = null;
  if (
    allActiveConfirmed ||
    (activeJobs.length === 0 && cancelledConfirmedJobs.length > 0)
  ) {
    aggregatedVendorCost = [...activeJobs, ...cancelledConfirmedJobs].reduce(
      (sum, j) => sum + toInt(j['valid_payable_amount'], 0),
      0,
    );
  } else if (anyEnteredOrConfirmed) {
    const allHaveEntered = activeJobs.every((j) => j['entered_cost'] !== null);
    if (allHaveEntered) {
      aggregatedVendorCost = activeJobs.reduce(
        (sum, j) =>
          sum +
          (j['cost_status'] === WorkshopJobCostStatus.CONFIRMED
            ? toInt(j['valid_payable_amount'], 0)
            : toInt(j['entered_cost'], 0)),
        0,
      );
    }
  }

  const prevConfirmed = Boolean(ord['actual_cost_confirmed']);
  const prevStatus =
    (ord['cost_reconciliation_status'] as OrderCostReconciliationStatusType) ||
    OrderCostReconciliationStatus.UNVERIFIED;
  const enteredShipping =
    ord['entered_shipping_fee'] !== null &&
    ord['entered_shipping_fee'] !== undefined
      ? toInt(ord['entered_shipping_fee'], 0)
      : null;
  const enteredExtra =
    ord['entered_extra_cost'] !== null &&
    ord['entered_extra_cost'] !== undefined
      ? toInt(ord['entered_extra_cost'], 0)
      : null;

  const jobsReadyForOrderConfirm =
    (allActiveConfirmed ||
      (activeJobs.length === 0 && cancelledConfirmedJobs.length > 0)) &&
    aggregatedVendorCost !== null;
  const canConfirmOrder =
    jobsReadyForOrderConfirm &&
    enteredShipping !== null &&
    enteredExtra !== null &&
    (prevConfirmed || params.autoConfirmOrderIfComplete === true);

  let nextConfirmed = false;
  let nextStatus: OrderCostReconciliationStatusType =
    OrderCostReconciliationStatus.UNVERIFIED;

  if (canConfirmOrder) {
    nextConfirmed = true;
    nextStatus = OrderCostReconciliationStatus.CONFIRMED;
  } else if (!jobsReadyForOrderConfirm && prevConfirmed) {
    nextConfirmed = false;
    nextStatus = OrderCostReconciliationStatus.NEEDS_REVIEW;
  } else if (
    aggregatedVendorCost !== null &&
    enteredShipping !== null &&
    enteredExtra !== null
  ) {
    nextConfirmed = false;
    nextStatus = OrderCostReconciliationStatus.ENTERED_UNCONFIRMED;
  } else if (
    anyEnteredOrConfirmed ||
    enteredShipping !== null ||
    enteredExtra !== null
  ) {
    nextConfirmed = false;
    nextStatus = OrderCostReconciliationStatus.PARTIAL_ENTERED;
  } else {
    nextConfirmed = false;
    nextStatus =
      prevStatus === OrderCostReconciliationStatus.NEEDS_REVIEW
        ? OrderCostReconciliationStatus.NEEDS_REVIEW
        : OrderCostReconciliationStatus.UNVERIFIED;
  }

  const isCancelled =
    ord['production_status'] === PrintProductionStatus.CANCELLED;
  const cancelSettled =
    ord['cancellation_settlement_status'] ===
    CancellationSettlementStatus.SETTLED;
  const confirmedRev = isCancelled
    ? cancelSettled
      ? toInt(ord['retained_cancellation_fee'], 0)
      : 0
    : toInt(
        ord['valid_receivable_amount'],
        toInt(ord['total_quote_amount'], 0),
      );

  const dbActualVendor = nextConfirmed ? aggregatedVendorCost! : 0;
  const dbActualShipping = nextConfirmed ? enteredShipping! : 0;
  const dbActualExtra = nextConfirmed ? enteredExtra! : 0;
  const dbActualProfit = nextConfirmed
    ? confirmedRev - dbActualVendor - dbActualShipping - dbActualExtra
    : 0;

  await client.query(
    `UPDATE print_orders
     SET entered_vendor_cost = $1,
         cost_reconciliation_status = $2,
         actual_cost_confirmed = $3,
         actual_cost_confirmed_at = CASE WHEN $3 = true THEN COALESCE(actual_cost_confirmed_at, now()) ELSE NULL END,
         actual_cost_confirmed_by = CASE WHEN $3 = true THEN COALESCE(actual_cost_confirmed_by, $8) ELSE NULL END,
         actual_vendor_cost = $4,
         actual_shipping_fee = $5,
         actual_extra_cost = $6,
         actual_profit = $7,
         updated_at = now()
     WHERE id = $9 AND workspace_id = $10`,
    [
      aggregatedVendorCost,
      nextStatus,
      nextConfirmed,
      dbActualVendor,
      dbActualShipping,
      dbActualExtra,
      dbActualProfit,
      params.actorId,
      params.orderId,
      params.workspaceId,
    ],
  );

  if (
    prevConfirmed !== nextConfirmed ||
    prevStatus !== nextStatus ||
    toInt(ord['entered_vendor_cost'], -1) !== (aggregatedVendorCost ?? -1)
  ) {
    const action =
      prevConfirmed && !nextConfirmed
        ? 'UNCONFIRMED'
        : !prevConfirmed && nextConfirmed
          ? 'CONFIRMED'
          : prevConfirmed && nextConfirmed
            ? 'ADJUSTED'
            : 'ENTERED';
    await client.query(
      `INSERT INTO print_order_cost_history (
         workspace_id, order_id, action, before_json, after_json, note, changed_by
       ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
      [
        params.workspaceId,
        params.orderId,
        action,
        JSON.stringify({
          cost_reconciliation_status: prevStatus,
          actual_cost_confirmed: prevConfirmed,
          entered_vendor_cost: ord['entered_vendor_cost'] ?? null,
        }),
        JSON.stringify({
          cost_reconciliation_status: nextStatus,
          actual_cost_confirmed: nextConfirmed,
          entered_vendor_cost: aggregatedVendorCost,
          actual_profit: nextConfirmed ? dbActualProfit : null,
        }),
        params.note ?? 'Đồng bộ từ phiếu đặt xưởng',
        params.actorId,
      ],
    );
  }
}

// ============================================================================
// ROW MAPPERS
// ============================================================================

export function mapWorkshopJobRow(
  r: Record<string, unknown>,
): PrintWorkshopJobData {
  return {
    id: String(r['id']),
    workspace_id: String(r['workspace_id']),
    job_code: String(r['job_code']),
    order_id: String(r['order_id']),
    order_code: r['order_code'] ? String(r['order_code']) : undefined,
    vendor_id: r['vendor_id'] ? String(r['vendor_id']) : null,
    vendor_name: r['vendor_name'] ? String(r['vendor_name']) : null,
    ledger_scope: (r['ledger_scope'] as LedgerScopeType) || LedgerScope.GENERAL,
    title: String(r['title']),
    source_line_refs: Array.isArray(r['source_line_refs'])
      ? (r['source_line_refs'] as WorkshopJobLineRef[])
      : [],
    job_status:
      (r['job_status'] as WorkshopJobStatusType) || WorkshopJobStatus.ORDERED,
    cost_status:
      (r['cost_status'] as WorkshopJobCostStatusType) ||
      WorkshopJobCostStatus.UNVERIFIED,
    expected_cost: toInt(r['expected_cost'], 0),
    entered_cost:
      r['entered_cost'] !== null && r['entered_cost'] !== undefined
        ? toInt(r['entered_cost'], 0)
        : null,
    confirmed_cost:
      r['confirmed_cost'] !== null && r['confirmed_cost'] !== undefined
        ? toInt(r['confirmed_cost'], 0)
        : null,
    confirmed_at: r['confirmed_at'] ? toIso(r['confirmed_at']) : null,
    confirmed_by: r['confirmed_by'] ? String(r['confirmed_by']) : null,
    net_ap_adjustment_amount: toInt(r['net_ap_adjustment_amount'], 0),
    valid_payable_amount: toInt(r['valid_payable_amount'], 0),
    allocated_paid_amount: toInt(r['allocated_paid_amount'], 0),
    remaining_payable_amount: toInt(r['remaining_payable_amount'], 0),
    vendor_overpaid_credit_amount: toInt(r['vendor_overpaid_credit_amount'], 0),
    ordered_at: r['ordered_at'] ? toIso(r['ordered_at']) : null,
    due_date: toDateStr(r['due_date']),
    note: r['note'] ? String(r['note']) : null,
    created_by: r['created_by'] ? String(r['created_by']) : null,
    created_at: toIso(r['created_at']),
    updated_at: toIso(r['updated_at']),
  };
}

export function mapWorkshopJobHistoryRow(
  r: Record<string, unknown>,
): PrintWorkshopJobHistoryData {
  return {
    id: String(r['id']),
    workspace_id: String(r['workspace_id']),
    workshop_job_id: String(r['workshop_job_id']),
    order_id: String(r['order_id']),
    action: r['action'] as WorkshopJobHistoryActionType,
    before_json:
      r['before_json'] && typeof r['before_json'] === 'object'
        ? (r['before_json'] as Record<string, unknown>)
        : {},
    after_json:
      r['after_json'] && typeof r['after_json'] === 'object'
        ? (r['after_json'] as Record<string, unknown>)
        : {},
    reason: r['reason'] ? String(r['reason']) : null,
    changed_by: r['changed_by'] ? String(r['changed_by']) : null,
    created_at: toIso(r['created_at']),
  };
}

export function mapOpeningBalanceRow(
  r: Record<string, unknown>,
): PrintOpeningBalanceData {
  return {
    id: String(r['id']),
    workspace_id: String(r['workspace_id']),
    doc_code: String(r['doc_code']),
    direction: r['direction'] as PrintOpeningBalanceData['direction'],
    ledger_scope: (r['ledger_scope'] as LedgerScopeType) || LedgerScope.GENERAL,
    customer_id: r['customer_id'] ? String(r['customer_id']) : null,
    customer_name: r['customer_name'] ? String(r['customer_name']) : null,
    vendor_id: r['vendor_id'] ? String(r['vendor_id']) : null,
    vendor_name: r['vendor_name'] ? String(r['vendor_name']) : null,
    original_amount: toInt(r['original_amount'], 0),
    net_adjustment_amount: toInt(r['net_adjustment_amount'], 0),
    valid_amount: toInt(r['valid_amount'], 0),
    allocated_settled_amount: toInt(r['allocated_settled_amount'], 0),
    remaining_amount: toInt(r['remaining_amount'], 0),
    as_of_date:
      toDateStr(r['as_of_date']) ?? new Date().toISOString().slice(0, 10),
    reference_code: r['reference_code'] ? String(r['reference_code']) : null,
    source_sheet_name: r['source_sheet_name']
      ? String(r['source_sheet_name'])
      : null,
    source_tab_name: r['source_tab_name'] ? String(r['source_tab_name']) : null,
    source_row_number:
      r['source_row_number'] !== null && r['source_row_number'] !== undefined
        ? toInt(r['source_row_number'], 0)
        : null,
    import_row_id: r['import_row_id'] ? String(r['import_row_id']) : null,
    note: r['note'] ? String(r['note']) : null,
    recorded_by: r['recorded_by'] ? String(r['recorded_by']) : null,
    created_at: toIso(r['created_at']),
  };
}

export function mapArTransactionRow(
  r: Record<string, unknown>,
): PrintArTransactionData {
  return {
    id: String(r['id']),
    workspace_id: String(r['workspace_id']),
    tx_code: String(r['tx_code']),
    customer_id: r['customer_id'] ? String(r['customer_id']) : null,
    customer_name: String(r['customer_name']),
    ledger_scope: (r['ledger_scope'] as LedgerScopeType) || LedgerScope.GENERAL,
    tx_kind: r['tx_kind'] as PrintArTransactionData['tx_kind'],
    receipt_subtype: r['receipt_subtype']
      ? (r['receipt_subtype'] as PrintArTransactionData['receipt_subtype'])
      : null,
    amount: toInt(r['amount'], 0),
    allocated_amount: toInt(r['allocated_amount'], 0),
    refunded_unallocated_amount: toInt(r['refunded_unallocated_amount'], 0),
    unallocated_amount: toInt(r['unallocated_amount'], 0),
    payment_method:
      (r['payment_method'] as PrintArTransactionData['payment_method']) ||
      'BANK_TRANSFER',
    occurred_at: toIso(r['occurred_at']),
    reference_code: r['reference_code'] ? String(r['reference_code']) : null,
    attachment_url: r['attachment_url'] ? String(r['attachment_url']) : null,
    note: r['note'] ? String(r['note']) : null,
    status:
      (r['status'] as PrintArTransactionData['status']) ||
      LedgerTxStatus.POSTED,
    reversal_of_tx_id: r['reversal_of_tx_id']
      ? String(r['reversal_of_tx_id'])
      : null,
    void_reason: r['void_reason'] ? String(r['void_reason']) : null,
    voided_at: r['voided_at'] ? toIso(r['voided_at']) : null,
    voided_by: r['voided_by'] ? String(r['voided_by']) : null,
    related_order_id: r['related_order_id']
      ? String(r['related_order_id'])
      : null,
    legacy_order_payment_id: r['legacy_order_payment_id']
      ? String(r['legacy_order_payment_id'])
      : null,
    source_sheet_name: r['source_sheet_name']
      ? String(r['source_sheet_name'])
      : null,
    source_tab_name: r['source_tab_name'] ? String(r['source_tab_name']) : null,
    source_row_number:
      r['source_row_number'] !== null && r['source_row_number'] !== undefined
        ? toInt(r['source_row_number'], 0)
        : null,
    recorded_by: r['recorded_by'] ? String(r['recorded_by']) : null,
    created_at: toIso(r['created_at']),
  };
}

export function mapArAllocationRow(
  r: Record<string, unknown>,
): PrintArAllocationData {
  return {
    id: String(r['id']),
    workspace_id: String(r['workspace_id']),
    ar_transaction_id: String(r['ar_transaction_id']),
    order_id: r['order_id'] ? String(r['order_id']) : null,
    order_code: r['order_code'] ? String(r['order_code']) : null,
    opening_balance_id: r['opening_balance_id']
      ? String(r['opening_balance_id'])
      : null,
    opening_doc_code: r['opening_doc_code']
      ? String(r['opening_doc_code'])
      : null,
    direction: r['direction'] as PrintArAllocationData['direction'],
    amount: toInt(r['amount'], 0),
    note: r['note'] ? String(r['note']) : null,
    recorded_by: r['recorded_by'] ? String(r['recorded_by']) : null,
    created_at: toIso(r['created_at']),
  };
}

export function mapArAdjustmentRow(
  r: Record<string, unknown>,
): PrintArAdjustmentData {
  return {
    id: String(r['id']),
    workspace_id: String(r['workspace_id']),
    adj_code: String(r['adj_code']),
    order_id: r['order_id'] ? String(r['order_id']) : null,
    order_code: r['order_code'] ? String(r['order_code']) : null,
    opening_balance_id: r['opening_balance_id']
      ? String(r['opening_balance_id'])
      : null,
    customer_id: r['customer_id'] ? String(r['customer_id']) : null,
    customer_name: String(r['customer_name']),
    ledger_scope: (r['ledger_scope'] as LedgerScopeType) || LedgerScope.GENERAL,
    adjustment_type: r[
      'adjustment_type'
    ] as PrintArAdjustmentData['adjustment_type'],
    delta_amount: toInt(r['delta_amount'], 0),
    reference_code: r['reference_code'] ? String(r['reference_code']) : null,
    reason: String(r['reason']),
    recorded_by: r['recorded_by'] ? String(r['recorded_by']) : null,
    created_at: toIso(r['created_at']),
  };
}

export function mapApTransactionRow(
  r: Record<string, unknown>,
): PrintApTransactionData {
  return {
    id: String(r['id']),
    workspace_id: String(r['workspace_id']),
    tx_code: String(r['tx_code']),
    vendor_id: String(r['vendor_id']),
    vendor_name: String(r['vendor_name']),
    ledger_scope: (r['ledger_scope'] as LedgerScopeType) || LedgerScope.GENERAL,
    tx_kind: r['tx_kind'] as PrintApTransactionData['tx_kind'],
    payout_subtype: r['payout_subtype']
      ? (r['payout_subtype'] as PrintApTransactionData['payout_subtype'])
      : null,
    amount: toInt(r['amount'], 0),
    allocated_amount: toInt(r['allocated_amount'], 0),
    refunded_unallocated_amount: toInt(r['refunded_unallocated_amount'], 0),
    unallocated_amount: toInt(r['unallocated_amount'], 0),
    payment_method:
      (r['payment_method'] as PrintApTransactionData['payment_method']) ||
      'BANK_TRANSFER',
    occurred_at: toIso(r['occurred_at']),
    reference_code: r['reference_code'] ? String(r['reference_code']) : null,
    attachment_url: r['attachment_url'] ? String(r['attachment_url']) : null,
    note: r['note'] ? String(r['note']) : null,
    status:
      (r['status'] as PrintApTransactionData['status']) ||
      LedgerTxStatus.POSTED,
    reversal_of_tx_id: r['reversal_of_tx_id']
      ? String(r['reversal_of_tx_id'])
      : null,
    void_reason: r['void_reason'] ? String(r['void_reason']) : null,
    voided_at: r['voided_at'] ? toIso(r['voided_at']) : null,
    voided_by: r['voided_by'] ? String(r['voided_by']) : null,
    reconciled_from_order_id: r['reconciled_from_order_id']
      ? String(r['reconciled_from_order_id'])
      : null,
    source_sheet_name: r['source_sheet_name']
      ? String(r['source_sheet_name'])
      : null,
    source_tab_name: r['source_tab_name'] ? String(r['source_tab_name']) : null,
    source_row_number:
      r['source_row_number'] !== null && r['source_row_number'] !== undefined
        ? toInt(r['source_row_number'], 0)
        : null,
    recorded_by: r['recorded_by'] ? String(r['recorded_by']) : null,
    created_at: toIso(r['created_at']),
  };
}

export function mapApAllocationRow(
  r: Record<string, unknown>,
): PrintApAllocationData {
  return {
    id: String(r['id']),
    workspace_id: String(r['workspace_id']),
    ap_transaction_id: String(r['ap_transaction_id']),
    workshop_job_id: r['workshop_job_id'] ? String(r['workshop_job_id']) : null,
    job_code: r['job_code'] ? String(r['job_code']) : null,
    order_id: r['order_id'] ? String(r['order_id']) : null,
    order_code: r['order_code'] ? String(r['order_code']) : null,
    opening_balance_id: r['opening_balance_id']
      ? String(r['opening_balance_id'])
      : null,
    opening_doc_code: r['opening_doc_code']
      ? String(r['opening_doc_code'])
      : null,
    direction: r['direction'] as PrintApAllocationData['direction'],
    amount: toInt(r['amount'], 0),
    note: r['note'] ? String(r['note']) : null,
    recorded_by: r['recorded_by'] ? String(r['recorded_by']) : null,
    created_at: toIso(r['created_at']),
  };
}

export function mapApAdjustmentRow(
  r: Record<string, unknown>,
): PrintApAdjustmentData {
  return {
    id: String(r['id']),
    workspace_id: String(r['workspace_id']),
    adj_code: String(r['adj_code']),
    workshop_job_id: r['workshop_job_id'] ? String(r['workshop_job_id']) : null,
    job_code: r['job_code'] ? String(r['job_code']) : null,
    order_id: r['order_id'] ? String(r['order_id']) : null,
    opening_balance_id: r['opening_balance_id']
      ? String(r['opening_balance_id'])
      : null,
    vendor_id: String(r['vendor_id']),
    vendor_name: String(r['vendor_name']),
    ledger_scope: (r['ledger_scope'] as LedgerScopeType) || LedgerScope.GENERAL,
    adjustment_type: r[
      'adjustment_type'
    ] as PrintApAdjustmentData['adjustment_type'],
    delta_amount: toInt(r['delta_amount'], 0),
    reference_code: r['reference_code'] ? String(r['reference_code']) : null,
    reason: String(r['reason']),
    recorded_by: r['recorded_by'] ? String(r['recorded_by']) : null,
    created_at: toIso(r['created_at']),
  };
}

export function mapCancellationSettlementRow(
  r: Record<string, unknown>,
): PrintOrderCancellationSettlementData {
  return {
    id: String(r['id']),
    workspace_id: String(r['workspace_id']),
    order_id: String(r['order_id']),
    customer_paid_holding_snapshot: toInt(
      r['customer_paid_holding_snapshot'],
      0,
    ),
    agreed_customer_refund_amount: toInt(r['agreed_customer_refund_amount'], 0),
    retained_cancellation_fee: toInt(r['retained_cancellation_fee'], 0),
    incurred_vendor_cost_snapshot: toInt(r['incurred_vendor_cost_snapshot'], 0),
    vendor_paid_snapshot: toInt(r['vendor_paid_snapshot'], 0),
    reference_code: r['reference_code'] ? String(r['reference_code']) : null,
    reason: String(r['reason']),
    settled_by: r['settled_by'] ? String(r['settled_by']) : null,
    created_at: toIso(r['created_at']),
  };
}

export function mapHistoricalImportBatchRow(
  r: Record<string, unknown>,
): PrintHistoricalImportBatchData {
  return {
    id: String(r['id']),
    workspace_id: String(r['workspace_id']),
    batch_code: String(r['batch_code']),
    source_sheet_name: String(r['source_sheet_name']),
    source_tab_name: String(r['source_tab_name']),
    default_ledger_scope:
      (r['default_ledger_scope'] as LedgerScopeType) || LedgerScope.GENERAL,
    status: r['status'] as HistoricalImportBatchStatusType,
    total_rows: toInt(r['total_rows'], 0),
    ready_rows_count: toInt(r['ready_rows_count'], 0),
    needs_confirmation_rows_count: toInt(r['needs_confirmation_rows_count'], 0),
    duplicate_rows_count: toInt(r['duplicate_rows_count'], 0),
    imported_rows_count: toInt(r['imported_rows_count'], 0),
    created_by: r['created_by'] ? String(r['created_by']) : null,
    confirmed_by: r['confirmed_by'] ? String(r['confirmed_by']) : null,
    confirmed_at: r['confirmed_at'] ? toIso(r['confirmed_at']) : null,
    created_at: toIso(r['created_at']),
  };
}

export function mapHistoricalImportRow(
  r: Record<string, unknown>,
): PrintHistoricalImportRowData {
  return {
    id: String(r['id']),
    batch_id: String(r['batch_id']),
    source_row_number: toInt(r['source_row_number'], 1),
    ledger_scope: (r['ledger_scope'] as LedgerScopeType) || LedgerScope.GENERAL,
    counterparty_role:
      (r[
        'counterparty_role'
      ] as PrintHistoricalImportRowData['counterparty_role']) || 'UNKNOWN',
    counterparty_name: r['counterparty_name']
      ? String(r['counterparty_name'])
      : null,
    matched_customer_id: r['matched_customer_id']
      ? String(r['matched_customer_id'])
      : null,
    matched_vendor_id: r['matched_vendor_id']
      ? String(r['matched_vendor_id'])
      : null,
    raw_amount_text: r['raw_amount_text'] ? String(r['raw_amount_text']) : null,
    parsed_amount:
      r['parsed_amount'] !== null && r['parsed_amount'] !== undefined
        ? toInt(r['parsed_amount'], 0)
        : null,
    raw_goods_total_text: r['raw_goods_total_text']
      ? String(r['raw_goods_total_text'])
      : null,
    parsed_goods_total:
      r['parsed_goods_total'] !== null && r['parsed_goods_total'] !== undefined
        ? toInt(r['parsed_goods_total'], 0)
        : null,
    voucher_code: r['voucher_code'] ? String(r['voucher_code']) : null,
    occurred_date: r['occurred_date'] ? String(r['occurred_date']) : null,
    note: r['note'] ? String(r['note']) : null,
    raw_cells_json:
      r['raw_cells_json'] && typeof r['raw_cells_json'] === 'object'
        ? (r['raw_cells_json'] as Record<string, string | null>)
        : {},
    flags: Array.isArray(r['flags'])
      ? (r['flags'] as HistoricalImportFlagType[])
      : [],
    row_status: r['row_status'] as HistoricalImportRowStatusType,
    suggested_resolution: r[
      'suggested_resolution'
    ] as HistoricalImportResolutionType,
    owner_resolution: r['owner_resolution'] as HistoricalImportResolutionType,
    row_fingerprint: String(r['row_fingerprint']),
    imported_entity_type: r['imported_entity_type']
      ? String(r['imported_entity_type'])
      : null,
    imported_entity_id: r['imported_entity_id']
      ? String(r['imported_entity_id'])
      : null,
  };
}
