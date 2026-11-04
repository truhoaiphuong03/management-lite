/**
 * MGL-PRINTQUOTE — Sổ Công Nợ Khách (AR), Công Nợ Xưởng (AP), Đặt Xưởng,
 * Quyết Toán Đơn Hủy, Báo Cáo 3 Chế Độ & Nhập Đối Soát Lịch Sử Google Sheet.
 *
 * RANH GIỚI BẤT BIẾN:
 * - Chỉ thuộc phân hệ In ấn (`/print-quotes*`, `/api/v1/print-quotes/*`, bảng `print_*`).
 * - Tuyệt đối không dùng chung, không đồng bộ và không bù trừ với `/finance` (`fin_*`).
 * - Mọi đại lượng tiền tệ ở cấp bút toán/số dư là số nguyên đồng Việt Nam (`VND`, `>= 0` trừ delta điều chỉnh).
 */

import { sha256Hex } from './printquote.js';

export const MAX_SAFE_FINANCE_VND = 1_000_000_000_000; // 1 nghìn tỷ VND

// ============================================================================
// 1. ENUMS & CONSTANTS
// ============================================================================

export const LedgerScope = {
  GENERAL: 'GENERAL',
  RIENG: 'RIENG',
  HVGROUP: 'HVGROUP',
} as const;
export type LedgerScopeType = (typeof LedgerScope)[keyof typeof LedgerScope];

export const WorkshopJobStatus = {
  DRAFT: 'DRAFT',
  ORDERED: 'ORDERED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type WorkshopJobStatusType =
  (typeof WorkshopJobStatus)[keyof typeof WorkshopJobStatus];

export const WorkshopJobCostStatus = {
  UNVERIFIED: 'UNVERIFIED',
  ENTERED_UNCONFIRMED: 'ENTERED_UNCONFIRMED',
  CONFIRMED: 'CONFIRMED',
} as const;
export type WorkshopJobCostStatusType =
  (typeof WorkshopJobCostStatus)[keyof typeof WorkshopJobCostStatus];

export const WorkshopJobHistoryAction = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  VENDOR_ASSIGNED: 'VENDOR_ASSIGNED',
  COST_ENTERED: 'COST_ENTERED',
  COST_CONFIRMED: 'COST_CONFIRMED',
  COST_ADJUSTED: 'COST_ADJUSTED',
  COST_UNCONFIRMED: 'COST_UNCONFIRMED',
  CANCELLED: 'CANCELLED',
} as const;
export type WorkshopJobHistoryActionType =
  (typeof WorkshopJobHistoryAction)[keyof typeof WorkshopJobHistoryAction];

export const ArTransactionKind = {
  RECEIPT: 'RECEIPT',
  REFUND: 'REFUND',
  REVERSAL: 'REVERSAL',
} as const;
export type ArTransactionKindType =
  (typeof ArTransactionKind)[keyof typeof ArTransactionKind];

export const ArReceiptSubtype = {
  DEPOSIT: 'DEPOSIT',
  INSTALLMENT: 'INSTALLMENT',
  FINAL: 'FINAL',
  ADVANCE: 'ADVANCE',
  OPENING_ADVANCE: 'OPENING_ADVANCE',
} as const;
export type ArReceiptSubtypeType =
  (typeof ArReceiptSubtype)[keyof typeof ArReceiptSubtype];

export const ArAllocationDirection = {
  APPLY: 'APPLY',
  UNAPPLY_REVERSAL: 'UNAPPLY_REVERSAL',
  REFUND_RELEASE: 'REFUND_RELEASE',
} as const;
export type ArAllocationDirectionType =
  (typeof ArAllocationDirection)[keyof typeof ArAllocationDirection];

export const ArAdjustmentType = {
  DISCOUNT: 'DISCOUNT',
  RETURN_CREDIT: 'RETURN_CREDIT',
  SURCHARGE: 'SURCHARGE',
  CANCELLATION_SETTLEMENT: 'CANCELLATION_SETTLEMENT',
  REVERSAL: 'REVERSAL',
} as const;
export type ArAdjustmentTypeVal =
  (typeof ArAdjustmentType)[keyof typeof ArAdjustmentType];

export const ApTransactionKind = {
  PAYOUT: 'PAYOUT',
  VENDOR_REFUND: 'VENDOR_REFUND',
  REVERSAL: 'REVERSAL',
} as const;
export type ApTransactionKindType =
  (typeof ApTransactionKind)[keyof typeof ApTransactionKind];

export const ApPayoutSubtype = {
  ADVANCE: 'ADVANCE',
  JOB_PAYMENT: 'JOB_PAYMENT',
  SETTLEMENT: 'SETTLEMENT',
  OPENING_ADVANCE: 'OPENING_ADVANCE',
} as const;
export type ApPayoutSubtypeType =
  (typeof ApPayoutSubtype)[keyof typeof ApPayoutSubtype];

export const ApAllocationDirection = {
  APPLY: 'APPLY',
  UNAPPLY_REVERSAL: 'UNAPPLY_REVERSAL',
  VENDOR_REFUND_RELEASE: 'VENDOR_REFUND_RELEASE',
} as const;
export type ApAllocationDirectionType =
  (typeof ApAllocationDirection)[keyof typeof ApAllocationDirection];

export const ApAdjustmentType = {
  DISCOUNT: 'DISCOUNT',
  DEFECT_DEDUCTION: 'DEFECT_DEDUCTION',
  SURCHARGE: 'SURCHARGE',
  REVERSAL: 'REVERSAL',
} as const;
export type ApAdjustmentTypeVal =
  (typeof ApAdjustmentType)[keyof typeof ApAdjustmentType];

export const LedgerTxStatus = {
  POSTED: 'POSTED',
  VOIDED: 'VOIDED',
} as const;
export type LedgerTxStatusType =
  (typeof LedgerTxStatus)[keyof typeof LedgerTxStatus];

export const CancellationSettlementStatus = {
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  PENDING_SETTLEMENT: 'PENDING_SETTLEMENT',
  SETTLED: 'SETTLED',
} as const;
export type CancellationSettlementStatusType =
  (typeof CancellationSettlementStatus)[keyof typeof CancellationSettlementStatus];

export const OpeningBalanceDirection = {
  CUSTOMER_RECEIVABLE: 'CUSTOMER_RECEIVABLE',
  VENDOR_PAYABLE: 'VENDOR_PAYABLE',
} as const;
export type OpeningBalanceDirectionType =
  (typeof OpeningBalanceDirection)[keyof typeof OpeningBalanceDirection];

export const HistoricalImportBatchStatus = {
  PREVIEW: 'PREVIEW',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
} as const;
export type HistoricalImportBatchStatusType =
  (typeof HistoricalImportBatchStatus)[keyof typeof HistoricalImportBatchStatus];

export const HistoricalImportRowStatus = {
  READY: 'READY',
  NEEDS_CONFIRMATION: 'NEEDS_CONFIRMATION',
  DUPLICATE: 'DUPLICATE',
  IMPORTED: 'IMPORTED',
  SKIPPED: 'SKIPPED',
} as const;
export type HistoricalImportRowStatusType =
  (typeof HistoricalImportRowStatus)[keyof typeof HistoricalImportRowStatus];

export const HistoricalImportResolution = {
  UNDECIDED: 'UNDECIDED',
  IMPORT_OPENING_RECEIVABLE: 'IMPORT_OPENING_RECEIVABLE',
  IMPORT_OPENING_PAYABLE: 'IMPORT_OPENING_PAYABLE',
  IMPORT_CUSTOMER_ADVANCE: 'IMPORT_CUSTOMER_ADVANCE',
  IMPORT_VENDOR_ADVANCE: 'IMPORT_VENDOR_ADVANCE',
  HOLD_FOR_REVIEW: 'HOLD_FOR_REVIEW',
  SKIP: 'SKIP',
} as const;
export type HistoricalImportResolutionType =
  (typeof HistoricalImportResolution)[keyof typeof HistoricalImportResolution];

export const HistoricalImportFlag = {
  EMPTY_CELL_NOT_ZERO: 'EMPTY_CELL_NOT_ZERO',
  MISSING_AMOUNT: 'MISSING_AMOUNT',
  MISSING_VOUCHER: 'MISSING_VOUCHER',
  TOTAL_GOODS_NOT_AUTO_DEBT: 'TOTAL_GOODS_NOT_AUTO_DEBT',
  DUPLICATE_IN_BATCH: 'DUPLICATE_IN_BATCH',
  DUPLICATE_EXISTING_ROW: 'DUPLICATE_EXISTING_ROW',
  MISSING_COUNTERPARTY: 'MISSING_COUNTERPARTY',
  SCOPE_RIENG: 'SCOPE_RIENG',
  SCOPE_HVGROUP: 'SCOPE_HVGROUP',
} as const;
export type HistoricalImportFlagType =
  (typeof HistoricalImportFlag)[keyof typeof HistoricalImportFlag];

// ============================================================================
// 2. DATA TRANSFER INTERFACES (API & UI CONTRACTS)
// ============================================================================

export interface WorkshopJobLineRef {
  lineId: string;
  lineName: string;
  stageId?: string | null | undefined;
  stageName?: string | null | undefined;
  itemRole: 'BASE_PRINT' | 'FINISHING' | 'CUSTOM';
  quantity: number;
  unit: string;
  billableAreaSqm?: number | null | undefined;
  expectedAmount: number;
}

export interface PrintWorkshopJobHistoryData {
  id: string;
  workspace_id: string;
  workshop_job_id: string;
  order_id: string;
  action: WorkshopJobHistoryActionType;
  before_json: Record<string, unknown>;
  after_json: Record<string, unknown>;
  reason: string | null;
  changed_by: string | null;
  created_at: string;
}

export interface PrintWorkshopJobData {
  id: string;
  workspace_id: string;
  job_code: string;
  order_id: string;
  order_code?: string | undefined;
  vendor_id: string | null;
  vendor_name: string | null;
  ledger_scope: LedgerScopeType;
  title: string;
  source_line_refs: WorkshopJobLineRef[];
  job_status: WorkshopJobStatusType;
  cost_status: WorkshopJobCostStatusType;
  expected_cost: number;
  entered_cost: number | null;
  confirmed_cost: number | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  net_ap_adjustment_amount: number;
  valid_payable_amount: number;
  allocated_paid_amount: number;
  remaining_payable_amount: number;
  vendor_overpaid_credit_amount: number;
  ordered_at: string | null;
  due_date: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  history?: PrintWorkshopJobHistoryData[] | undefined;
}

export interface PrintOpeningBalanceData {
  id: string;
  workspace_id: string;
  doc_code: string;
  direction: OpeningBalanceDirectionType;
  ledger_scope: LedgerScopeType;
  customer_id: string | null;
  customer_name: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  original_amount: number;
  net_adjustment_amount: number;
  valid_amount: number;
  allocated_settled_amount: number;
  remaining_amount: number;
  as_of_date: string;
  reference_code: string | null;
  source_sheet_name: string | null;
  source_tab_name: string | null;
  source_row_number: number | null;
  import_row_id: string | null;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface PrintArAllocationData {
  id: string;
  workspace_id: string;
  ar_transaction_id: string;
  order_id: string | null;
  order_code?: string | null | undefined;
  opening_balance_id: string | null;
  opening_doc_code?: string | null | undefined;
  direction: ArAllocationDirectionType;
  amount: number;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface PrintArTransactionData {
  id: string;
  workspace_id: string;
  tx_code: string;
  customer_id: string | null;
  customer_name: string;
  ledger_scope: LedgerScopeType;
  tx_kind: ArTransactionKindType;
  receipt_subtype: ArReceiptSubtypeType | null;
  amount: number;
  allocated_amount: number;
  refunded_unallocated_amount: number;
  unallocated_amount: number;
  payment_method: 'BANK_TRANSFER' | 'CASH' | 'QR_VIETQR' | 'OTHER';
  occurred_at: string;
  reference_code: string | null;
  attachment_url: string | null;
  note: string | null;
  status: LedgerTxStatusType;
  reversal_of_tx_id: string | null;
  void_reason: string | null;
  voided_at: string | null;
  voided_by: string | null;
  related_order_id: string | null;
  legacy_order_payment_id: string | null;
  source_sheet_name: string | null;
  source_tab_name: string | null;
  source_row_number: number | null;
  recorded_by: string | null;
  created_at: string;
  allocations?: PrintArAllocationData[] | undefined;
}

export interface PrintArAdjustmentData {
  id: string;
  workspace_id: string;
  adj_code: string;
  order_id: string | null;
  order_code?: string | null | undefined;
  opening_balance_id: string | null;
  customer_id: string | null;
  customer_name: string;
  ledger_scope: LedgerScopeType;
  adjustment_type: ArAdjustmentTypeVal;
  delta_amount: number;
  reference_code: string | null;
  reason: string;
  recorded_by: string | null;
  created_at: string;
}

export interface PrintApAllocationData {
  id: string;
  workspace_id: string;
  ap_transaction_id: string;
  workshop_job_id: string | null;
  job_code?: string | null | undefined;
  order_id: string | null;
  order_code?: string | null | undefined;
  opening_balance_id: string | null;
  opening_doc_code?: string | null | undefined;
  direction: ApAllocationDirectionType;
  amount: number;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface PrintApTransactionData {
  id: string;
  workspace_id: string;
  tx_code: string;
  vendor_id: string;
  vendor_name: string;
  ledger_scope: LedgerScopeType;
  tx_kind: ApTransactionKindType;
  payout_subtype: ApPayoutSubtypeType | null;
  amount: number;
  allocated_amount: number;
  refunded_unallocated_amount: number;
  unallocated_amount: number;
  payment_method: 'BANK_TRANSFER' | 'CASH' | 'QR_VIETQR' | 'OTHER';
  occurred_at: string;
  reference_code: string | null;
  attachment_url: string | null;
  note: string | null;
  status: LedgerTxStatusType;
  reversal_of_tx_id: string | null;
  void_reason: string | null;
  voided_at: string | null;
  voided_by: string | null;
  reconciled_from_order_id: string | null;
  source_sheet_name: string | null;
  source_tab_name: string | null;
  source_row_number: number | null;
  recorded_by: string | null;
  created_at: string;
  allocations?: PrintApAllocationData[] | undefined;
}

export interface PrintApAdjustmentData {
  id: string;
  workspace_id: string;
  adj_code: string;
  workshop_job_id: string | null;
  job_code?: string | null | undefined;
  order_id: string | null;
  opening_balance_id: string | null;
  vendor_id: string;
  vendor_name: string;
  ledger_scope: LedgerScopeType;
  adjustment_type: ApAdjustmentTypeVal;
  delta_amount: number;
  reference_code: string | null;
  reason: string;
  recorded_by: string | null;
  created_at: string;
}

export interface PrintOrderCancellationSettlementData {
  id: string;
  workspace_id: string;
  order_id: string;
  customer_paid_holding_snapshot: number;
  agreed_customer_refund_amount: number;
  retained_cancellation_fee: number;
  incurred_vendor_cost_snapshot: number;
  vendor_paid_snapshot: number;
  reference_code: string | null;
  reason: string;
  settled_by: string | null;
  created_at: string;
}

export interface CustomerReceivableSummaryItem {
  customer_key: string;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string;
  customer_phone: string | null;
  ledger_scope: LedgerScopeType;
  active_orders_count: number;
  opening_balances_count: number;
  valid_receivable_total: number;
  net_allocated_receipt_total: number;
  remaining_receivable_total: number;
  unallocated_credit_total: number;
  cancelled_holding_pending_total: number;
  cancelled_agreed_refund_remaining_total: number;
}

export interface VendorPayableSummaryItem {
  vendor_id: string;
  vendor_code: string;
  vendor_name: string;
  vendor_phone: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_holder: string | null;
  ledger_scope: LedgerScopeType;
  active_jobs_count: number;
  confirmed_jobs_count: number;
  unconfirmed_jobs_count: number;
  expected_unconfirmed_cost_total: number;
  valid_payable_total: number;
  net_allocated_payout_total: number;
  remaining_payable_total: number;
  unallocated_advance_total: number;
}

export interface LegacyUnreconciledVendorNoteItem {
  order_id: string;
  order_code: string;
  title: string;
  customer_name: string;
  vendor_id: string | null;
  vendor_name: string | null;
  vendor_paid_amount: number;
  order_date: string;
}

export interface UnifiedPrintLedgerItem {
  id: string;
  ledger_side: 'AR' | 'AP' | 'AR_ADJUSTMENT' | 'AP_ADJUSTMENT';
  code: string;
  tx_kind: string;
  subtype: string | null;
  ledger_scope: LedgerScopeType;
  counterparty_id: string | null;
  counterparty_name: string;
  amount: number;
  allocated_amount: number;
  unallocated_amount: number;
  payment_method: string | null;
  reference_code: string | null;
  status: string;
  occurred_at: string;
  note: string | null;
  source_provenance: string | null;
  linked_codes: string[];
  recorded_by: string | null;
  created_at: string;
}

export interface PrintFinancialReportData {
  projected: {
    active_orders_count: number;
    gross_order_value: number;
    net_ar_adjustments: number;
    valid_order_receivable: number;
    expected_vendor_cost: number;
    expected_shipping_fee: number;
    expected_extra_cost: number;
    expected_profit: number;
  };
  reconciled: {
    reconciled_orders_count: number;
    pending_cost_confirmation_orders_count: number;
    confirmed_active_revenue: number;
    confirmed_cancellation_fee_revenue: number;
    confirmed_total_revenue: number;
    confirmed_vendor_cost: number;
    confirmed_shipping_fee: number;
    confirmed_extra_cost: number;
    reconciled_profit: number;
  };
  cashflow_and_debt: {
    // AR: Còn phải thu = Phải thu hợp lệ - Thu ròng đã phân bổ
    valid_receivable_total: number;
    net_allocated_customer_receipt: number;
    remaining_receivable_total: number;
    customer_cash_collected_gross: number;
    customer_cash_refunded_total: number;
    customer_cash_net_received: number;
    customer_unallocated_advance_total: number;
    // AP: Còn phải trả = Phải trả hợp lệ - Chi ròng đã phân bổ
    valid_payable_total: number;
    net_allocated_vendor_payout: number;
    remaining_payable_total: number;
    expected_unconfirmed_workshop_cost_total: number;
    vendor_cash_paid_gross: number;
    vendor_cash_refunded_total: number;
    vendor_cash_net_paid: number;
    vendor_unallocated_advance_total: number;
    legacy_unreconciled_vendor_notes_count: number;
    legacy_unreconciled_vendor_notes_total: number;
  };
  cancelled_and_pending: {
    cancelled_orders_count: number;
    pending_settlement_orders_count: number;
    settled_cancelled_orders_count: number;
    customer_holding_pending_decision: number;
    agreed_customer_refund_remaining: number;
    retained_cancellation_fee_total: number;
    cancelled_incurred_confirmed_cost: number;
    cancelled_vendor_paid_allocated: number;
    cancelled_vendor_remaining_payable: number;
  };
  by_ledger_scope: Record<
    LedgerScopeType,
    {
      valid_receivable: number;
      remaining_receivable: number;
      customer_unallocated: number;
      valid_payable: number;
      remaining_payable: number;
      vendor_unallocated: number;
    }
  >;
}

export interface PrintHistoricalImportRowData {
  id: string;
  batch_id: string;
  source_row_number: number;
  ledger_scope: LedgerScopeType;
  counterparty_role: 'CUSTOMER' | 'VENDOR' | 'UNKNOWN';
  counterparty_name: string | null;
  matched_customer_id: string | null;
  matched_vendor_id: string | null;
  raw_amount_text: string | null;
  parsed_amount: number | null;
  raw_goods_total_text: string | null;
  parsed_goods_total: number | null;
  voucher_code: string | null;
  occurred_date: string | null;
  note: string | null;
  raw_cells_json: Record<string, string | null>;
  flags: HistoricalImportFlagType[];
  row_status: HistoricalImportRowStatusType;
  suggested_resolution: HistoricalImportResolutionType;
  owner_resolution: HistoricalImportResolutionType;
  row_fingerprint: string;
  imported_entity_type: string | null;
  imported_entity_id: string | null;
}

export interface PrintHistoricalImportBatchData {
  id: string;
  workspace_id: string;
  batch_code: string;
  source_sheet_name: string;
  source_tab_name: string;
  default_ledger_scope: LedgerScopeType;
  status: HistoricalImportBatchStatusType;
  total_rows: number;
  ready_rows_count: number;
  needs_confirmation_rows_count: number;
  duplicate_rows_count: number;
  imported_rows_count: number;
  created_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  rows?: PrintHistoricalImportRowData[] | undefined;
}

// ============================================================================
// 3. PURE ACCOUNTING FORMULAS & INVARIANT GUARDS
// ============================================================================

export function assertSafeNonNegativeVnd(value: number, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_SAFE_FINANCE_VND
  ) {
    throw new Error(
      `${label} phải là số nguyên VND không âm hợp lệ (0 .. ${MAX_SAFE_FINANCE_VND}), nhận: ${String(value)}.`,
    );
  }
  return value;
}

export function assertSafePositiveVnd(value: number, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_SAFE_FINANCE_VND
  ) {
    throw new Error(
      `${label} phải là số nguyên VND dương (> 0), nhận: ${String(value)}.`,
    );
  }
  return value;
}

export function assertTransactionConservationInvariant(params: {
  label: string;
  amount: number;
  allocatedAmount: number;
  refundedUnallocatedAmount: number;
  unallocatedAmount: number;
}): void {
  const amount = assertSafePositiveVnd(params.amount, `${params.label}.amount`);
  const allocated = assertSafeNonNegativeVnd(
    params.allocatedAmount,
    `${params.label}.allocatedAmount`,
  );
  const refunded = assertSafeNonNegativeVnd(
    params.refundedUnallocatedAmount,
    `${params.label}.refundedUnallocatedAmount`,
  );
  const unallocated = assertSafeNonNegativeVnd(
    params.unallocatedAmount,
    `${params.label}.unallocatedAmount`,
  );
  if (allocated + refunded + unallocated !== amount) {
    throw new Error(
      `Vi phạm bất biến bảo toàn tiền trên ${params.label}: đã phân bổ (${allocated}) + hoàn từ dư (${refunded}) + chưa phân bổ (${unallocated}) != tổng phiếu (${amount}).`,
    );
  }
}

export function computeOrderReceivableMetrics(params: {
  grossOrderAmount: number;
  isCancelled: boolean;
  cancellationSettlementStatus: CancellationSettlementStatusType;
  agreedCustomerRefundAmount: number;
  refundedAfterCancelAmount: number;
  retainedCancellationFee: number;
  netArAdjustmentAmount: number;
  netAllocatedReceiptAmount: number;
}): {
  validReceivableAmount: number;
  remainingReceivableAmount: number;
  overAllocatedAmount: number;
  customerHoldingPendingAmount: number;
  remainingAgreedRefundAmount: number;
  confirmedCancellationRevenue: number | null;
} {
  const gross = assertSafeNonNegativeVnd(
    params.grossOrderAmount,
    'grossOrderAmount',
  );
  const netPaid = assertSafeNonNegativeVnd(
    params.netAllocatedReceiptAmount,
    'netAllocatedReceiptAmount',
  );

  if (!params.isCancelled) {
    const rawValid = gross + Math.trunc(params.netArAdjustmentAmount);
    if (rawValid < 0) {
      throw new Error(
        `Điều chỉnh giảm phải thu (${params.netArAdjustmentAmount}) không được làm Phải thu hợp lệ của đơn âm (${rawValid}).`,
      );
    }
    const remaining = Math.max(0, rawValid - netPaid);
    const overAllocated = Math.max(0, netPaid - rawValid);
    return {
      validReceivableAmount: rawValid,
      remainingReceivableAmount: remaining,
      overAllocatedAmount: overAllocated,
      customerHoldingPendingAmount: 0,
      remainingAgreedRefundAmount: 0,
      confirmedCancellationRevenue: null,
    };
  }

  // Cancelled order: NEVER guess refund vs revenue when not settled!
  if (
    params.cancellationSettlementStatus !== CancellationSettlementStatus.SETTLED
  ) {
    return {
      validReceivableAmount: 0,
      remainingReceivableAmount: 0,
      overAllocatedAmount: 0,
      customerHoldingPendingAmount: netPaid,
      remainingAgreedRefundAmount: 0,
      confirmedCancellationRevenue: null,
    };
  }

  const agreedRefund = assertSafeNonNegativeVnd(
    params.agreedCustomerRefundAmount,
    'agreedCustomerRefundAmount',
  );
  const refundedAfterCancel = assertSafeNonNegativeVnd(
    params.refundedAfterCancelAmount,
    'refundedAfterCancelAmount',
  );
  const retainedFee = assertSafeNonNegativeVnd(
    params.retainedCancellationFee,
    'retainedCancellationFee',
  );
  const remainingAgreedRefund = Math.max(0, agreedRefund - refundedAfterCancel);

  return {
    validReceivableAmount: retainedFee,
    remainingReceivableAmount: Math.max(0, retainedFee - netPaid),
    overAllocatedAmount: 0,
    customerHoldingPendingAmount: 0,
    remainingAgreedRefundAmount: remainingAgreedRefund,
    confirmedCancellationRevenue: retainedFee,
  };
}

export function computeWorkshopJobPayableMetrics(params: {
  jobStatus: WorkshopJobStatusType;
  costStatus: WorkshopJobCostStatusType;
  expectedCost: number;
  enteredCost: number | null;
  confirmedCost: number | null;
  netApAdjustmentAmount: number;
  netAllocatedPayoutAmount: number;
}): {
  validPayableAmount: number;
  remainingPayableAmount: number;
  vendorOverpaidCreditAmount: number;
  provisionalExpectedUnconfirmedCost: number;
} {
  const expected = assertSafeNonNegativeVnd(
    params.expectedCost,
    'expectedCost',
  );
  const netPaid = assertSafeNonNegativeVnd(
    params.netAllocatedPayoutAmount,
    'netAllocatedPayoutAmount',
  );

  if (
    params.costStatus === WorkshopJobCostStatus.CONFIRMED &&
    params.confirmedCost !== null
  ) {
    const confirmed = assertSafeNonNegativeVnd(
      params.confirmedCost,
      'confirmedCost',
    );
    const rawValid = confirmed + Math.trunc(params.netApAdjustmentAmount);
    if (rawValid < 0) {
      throw new Error(
        `Điều chỉnh giảm phải trả (${params.netApAdjustmentAmount}) không được làm Phải trả hợp lệ âm (${rawValid}).`,
      );
    }
    const remaining = Math.max(0, rawValid - netPaid);
    const overpaid = Math.max(0, netPaid - rawValid);
    return {
      validPayableAmount: rawValid,
      remainingPayableAmount: remaining,
      vendorOverpaidCreditAmount: overpaid,
      provisionalExpectedUnconfirmedCost: 0,
    };
  }

  if (params.jobStatus === WorkshopJobStatus.CANCELLED) {
    return {
      validPayableAmount: 0,
      remainingPayableAmount: 0,
      vendorOverpaidCreditAmount: netPaid,
      provisionalExpectedUnconfirmedCost: 0,
    };
  }

  return {
    validPayableAmount: 0,
    remainingPayableAmount: 0,
    vendorOverpaidCreditAmount: 0,
    provisionalExpectedUnconfirmedCost: params.enteredCost ?? expected,
  };
}

export function computeOrderReconciledProfit(params: {
  isCancelled: boolean;
  cancellationSettlementStatus: CancellationSettlementStatusType;
  validReceivableAmount: number;
  retainedCancellationFee: number;
  hasActiveUnconfirmedWorkshopJobs: boolean;
  actualCostConfirmed: boolean;
  confirmedVendorCost: number | null;
  confirmedShippingFee: number | null;
  confirmedExtraCost: number | null;
}): {
  isReconciled: boolean;
  confirmedRevenue: number | null;
  reconciledProfit: number | null;
} {
  if (params.hasActiveUnconfirmedWorkshopJobs || !params.actualCostConfirmed) {
    return {
      isReconciled: false,
      confirmedRevenue: null,
      reconciledProfit: null,
    };
  }
  if (
    params.confirmedVendorCost === null ||
    params.confirmedShippingFee === null ||
    params.confirmedExtraCost === null
  ) {
    return {
      isReconciled: false,
      confirmedRevenue: null,
      reconciledProfit: null,
    };
  }

  if (params.isCancelled) {
    if (
      params.cancellationSettlementStatus !==
      CancellationSettlementStatus.SETTLED
    ) {
      return {
        isReconciled: false,
        confirmedRevenue: null,
        reconciledProfit: null,
      };
    }
    const rev = params.retainedCancellationFee;
    return {
      isReconciled: true,
      confirmedRevenue: rev,
      reconciledProfit:
        rev -
        params.confirmedVendorCost -
        params.confirmedShippingFee -
        params.confirmedExtraCost,
    };
  }

  const rev = params.validReceivableAmount;
  return {
    isReconciled: true,
    confirmedRevenue: rev,
    reconciledProfit:
      rev -
      params.confirmedVendorCost -
      params.confirmedShippingFee -
      params.confirmedExtraCost,
  };
}

// ============================================================================
// 4. HISTORICAL GOOGLE SHEET TABULAR PARSER & RECONCILIATION ANALYZER (§G)
// ============================================================================

/**
 * Parses CSV or TSV text (including quoted fields) into rows of raw strings.
 * Empty cells stay `""` so callers distinguish `null` (blank) from explicit `"0"`.
 */
export function parseHistoricalSheetTabularText(
  rawText: string,
  explicitDelimiter?: ',' | '\t' | ';',
): string[][] {
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.trim()) return [];

  const firstLine = normalized.split('\n')[0] ?? '';
  const delimiter: ',' | '\t' | ';' =
    explicitDelimiter ??
    (firstLine.includes('\t')
      ? '\t'
      : firstLine.split(';').length > firstLine.split(',').length
        ? ';'
        : ',');

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentField);
      currentField = '';
    } else if (ch === '\n') {
      currentRow.push(currentField);
      currentField = '';
      if (currentRow.some((cell) => cell.trim() !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += ch;
    }
  }
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some((cell) => cell.trim() !== '')) {
      rows.push(currentRow);
    }
  }
  return rows;
}

/**
 * Parses a Vietnamese/International VND cell WITHOUT turning empty cells into 0:
 * - Blank `""` / whitespace / `"-"` -> `{ kind: 'EMPTY', value: null }`
 * - Explicit `"0"` -> `{ kind: 'EXPLICIT_ZERO', value: 0 }`
 * - Valid integer VND (`"2.000.000"`, `"2,000,000"`, `"2000000 đ"`) -> `{ kind: 'VALID', value }`
 * - Unparseable/negative -> `{ kind: 'INVALID', value: null }`
 */
export function parseSheetVndCellStrict(rawCell: string | null | undefined): {
  kind: 'EMPTY' | 'EXPLICIT_ZERO' | 'VALID' | 'INVALID';
  value: number | null;
} {
  if (rawCell === null || rawCell === undefined) {
    return { kind: 'EMPTY', value: null };
  }
  const trimmed = rawCell.trim();
  if (trimmed === '' || trimmed === '—' || trimmed === '-') {
    return { kind: 'EMPTY', value: null };
  }

  const cleaned = trimmed
    .replace(/[₫đĐ\s]/g, '')
    .replace(/VND/gi, '')
    .trim();
  if (cleaned === '') {
    return { kind: 'EMPTY', value: null };
  }
  if (cleaned === '0') {
    return { kind: 'EXPLICIT_ZERO', value: 0 };
  }
  if (cleaned.startsWith('-')) {
    return { kind: 'INVALID', value: null };
  }

  // Strip thousand separators (`.` or `,` when followed by groups of 3 digits)
  const digitsOnly = /^[0-9]{1,3}([.,][0-9]{3})+$/.test(cleaned)
    ? cleaned.replace(/[.,]/g, '')
    : cleaned;

  if (!/^[0-9]+$/.test(digitsOnly)) {
    return { kind: 'INVALID', value: null };
  }
  const num = Number(digitsOnly);
  if (!Number.isSafeInteger(num) || num < 0 || num > MAX_SAFE_FINANCE_VND) {
    return { kind: 'INVALID', value: null };
  }
  return num === 0
    ? { kind: 'EXPLICIT_ZERO', value: 0 }
    : { kind: 'VALID', value: num };
}

export function normalizeLedgerScopeInput(
  raw: unknown,
  fallback: LedgerScopeType = LedgerScope.GENERAL,
): LedgerScopeType {
  if (typeof raw !== 'string') return fallback;
  const upper = raw
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (upper === 'RIENG' || upper.includes('RIENG')) return LedgerScope.RIENG;
  if (upper === 'HVGROUP' || upper.includes('HVGROUP') || upper === 'HV') {
    return LedgerScope.HVGROUP;
  }
  if (upper === 'GENERAL' || upper === 'CHUNG') return LedgerScope.GENERAL;
  return fallback;
}

export interface AnalyzedSheetImportRow {
  sourceRowNumber: number;
  ledgerScope: LedgerScopeType;
  counterpartyRole: 'CUSTOMER' | 'VENDOR' | 'UNKNOWN';
  counterpartyName: string | null;
  rawAmountText: string | null;
  parsedAmount: number | null;
  rawGoodsTotalText: string | null;
  parsedGoodsTotal: number | null;
  voucherCode: string | null;
  occurredDate: string | null;
  note: string | null;
  rawCellsJson: Record<string, string | null>;
  flags: HistoricalImportFlagType[];
  rowStatus: HistoricalImportRowStatusType;
  suggestedResolution: HistoricalImportResolutionType;
  rowFingerprint: string;
}

function normalizeHeaderKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function analyzeHistoricalSheetRows(params: {
  rawText: string;
  sourceSheetName: string;
  sourceTabName: string;
  defaultLedgerScope?: LedgerScopeType | undefined;
  existingImportedFingerprints?: ReadonlySet<string> | undefined;
}): AnalyzedSheetImportRow[] {
  const matrix = parseHistoricalSheetTabularText(params.rawText);
  if (matrix.length === 0) return [];

  const defaultScope = params.defaultLedgerScope ?? LedgerScope.GENERAL;
  const firstRow = matrix[0]!;
  const normalizedHeaders = firstRow.map(normalizeHeaderKey);

  const looksLikeHeader = normalizedHeaders.some((h) =>
    [
      'khach_hang',
      'khach',
      'doi_tuong',
      'xuong',
      'nha_in',
      'so_tien',
      'cong_no',
      'so_du_dau_ky',
      'chung_tu',
      'ma_chung_tu',
      'nhom',
      'loai',
      'counterparty',
      'amount',
      'voucher',
    ].some((kw) => h.includes(kw)),
  );

  const headerNames = looksLikeHeader
    ? firstRow.map((h, idx) => h.trim() || `col_${idx + 1}`)
    : firstRow.map((_, idx) => `col_${idx + 1}`);
  const headerKeys = looksLikeHeader
    ? normalizedHeaders
    : [
        'loai',
        'doi_tuong',
        'nhom',
        'so_tien',
        'chung_tu',
        'ngay',
        'ghi_chu',
      ].slice(0, firstRow.length);

  const dataRows = looksLikeHeader ? matrix.slice(1) : matrix;
  const startRowNumber = looksLikeHeader ? 2 : 1;

  const seenFingerprintsInBatch = new Set<string>();
  const analyzed: AnalyzedSheetImportRow[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i]!;
    const sourceRowNumber = startRowNumber + i;
    const rawCellsJson: Record<string, string | null> = {};
    const byKey = new Map<string, string>();

    for (let c = 0; c < Math.max(headerNames.length, cells.length); c++) {
      const colLabel = headerNames[c] ?? `col_${c + 1}`;
      const k = headerKeys[c] ?? `col_${c + 1}`;
      const rawVal = cells[c] ?? '';
      const trimmed = rawVal.trim();
      rawCellsJson[colLabel] = trimmed === '' ? null : trimmed;
      if (trimmed !== '' && !byKey.has(k)) {
        byKey.set(k, trimmed);
      }
    }

    const findCol = (pred: (k: string) => boolean): string | null => {
      for (let c = 0; c < headerKeys.length; c++) {
        const k = headerKeys[c]!;
        if (pred(k)) {
          const v = (cells[c] ?? '').trim();
          return v === '' ? null : v;
        }
      }
      return null;
    };
    const hasCol = (pred: (k: string) => boolean): boolean =>
      headerKeys.some((k) => pred(k));

    const typeText =
      findCol(
        (k) =>
          k === 'loai' ||
          k.includes('loai_dong') ||
          k.includes('nghiep_vu') ||
          k === 'type',
      ) ?? '';
    const normType = normalizeHeaderKey(typeText);

    const customerCell = findCol(
      (k) => k.includes('khach') || k === 'customer' || k === 'customer_name',
    );
    const vendorCell = findCol(
      (k) =>
        k.includes('xuong') || k.includes('nha_in') || k.includes('vendor'),
    );
    const genericCounterparty = findCol(
      (k) => k.includes('doi_tuong') || k === 'counterparty' || k === 'ten',
    );

    let counterpartyRole: 'CUSTOMER' | 'VENDOR' | 'UNKNOWN' = 'UNKNOWN';
    let counterpartyName: string | null = null;

    if (
      normType.includes('xuong') ||
      normType.includes('phai_tra') ||
      normType.includes('ap') ||
      (vendorCell && !customerCell)
    ) {
      counterpartyRole = 'VENDOR';
      counterpartyName = vendorCell ?? genericCounterparty;
    } else if (
      normType.includes('khach') ||
      normType.includes('phai_thu') ||
      normType.includes('ar') ||
      customerCell
    ) {
      counterpartyRole = 'CUSTOMER';
      counterpartyName = customerCell ?? genericCounterparty;
    } else if (genericCounterparty) {
      counterpartyRole = 'CUSTOMER';
      counterpartyName = genericCounterparty;
    }

    const rawScopeCell = findCol(
      (k) =>
        k.includes('nhom') ||
        k.includes('phap_nhan') ||
        k.includes('so_sach') ||
        k === 'scope' ||
        k === 'group',
    );
    const ledgerScope = rawScopeCell
      ? normalizeLedgerScopeInput(rawScopeCell, defaultScope)
      : normalizeLedgerScopeInput(params.sourceTabName, defaultScope);

    const hasDebtOrAmountCol = hasCol(
      (k) =>
        k === 'so_tien' ||
        k.includes('cong_no') ||
        k.includes('so_du') ||
        k.includes('ung_truoc') ||
        k === 'amount' ||
        k === 'debt_amount',
    );
    const rawAmountText = findCol(
      (k) =>
        k === 'so_tien' ||
        k.includes('cong_no') ||
        k.includes('so_du') ||
        k.includes('ung_truoc') ||
        k === 'amount' ||
        k === 'debt_amount',
    );
    const hasGoodsTotalCol = hasCol(
      (k) =>
        k.includes('tien_hang') ||
        k.includes('tong_tien_hang') ||
        k.includes('thanh_tien_hang') ||
        k === 'goods_total',
    );
    const rawGoodsTotalText = findCol(
      (k) =>
        k.includes('tien_hang') ||
        k.includes('tong_tien_hang') ||
        k.includes('thanh_tien_hang') ||
        k === 'goods_total',
    );

    const voucherCode = findCol(
      (k) =>
        k.includes('chung_tu') ||
        k.includes('ma_gd') ||
        k.includes('tham_chieu') ||
        k === 'voucher' ||
        k === 'reference_code',
    );
    const occurredDate = findCol(
      (k) => k === 'ngay' || k.includes('ngay_') || k === 'date',
    );
    const note = findCol(
      (k) => k.includes('ghi_chu') || k === 'note' || k.includes('dien_giai'),
    );

    const flags: HistoricalImportFlagType[] = [];
    if (ledgerScope === LedgerScope.RIENG) {
      flags.push(HistoricalImportFlag.SCOPE_RIENG);
    } else if (ledgerScope === LedgerScope.HVGROUP) {
      flags.push(HistoricalImportFlag.SCOPE_HVGROUP);
    }

    // Blank cell check: ANY blank numeric cell is explicitly flagged EMPTY_CELL_NOT_ZERO (never coerced to 0)
    const parsedAmtOutcome = parseSheetVndCellStrict(rawAmountText);
    const parsedGoodsOutcome = parseSheetVndCellStrict(rawGoodsTotalText);

    if (
      (hasDebtOrAmountCol && parsedAmtOutcome.kind === 'EMPTY') ||
      (hasGoodsTotalCol && parsedGoodsOutcome.kind === 'EMPTY')
    ) {
      flags.push(HistoricalImportFlag.EMPTY_CELL_NOT_ZERO);
    }

    const parsedAmount = parsedAmtOutcome.value;
    const parsedGoodsTotal = parsedGoodsOutcome.value;

    // Rule §G.4: Do NOT treat goods total as actual debt automatically!
    if (
      parsedAmount === null &&
      parsedGoodsTotal !== null &&
      parsedGoodsTotal > 0
    ) {
      flags.push(HistoricalImportFlag.TOTAL_GOODS_NOT_AUTO_DEBT);
    }

    if (parsedAmount === null || parsedAmount <= 0) {
      flags.push(HistoricalImportFlag.MISSING_AMOUNT);
    }

    if (!voucherCode) {
      flags.push(HistoricalImportFlag.MISSING_VOUCHER);
    }

    if (!counterpartyName) {
      flags.push(HistoricalImportFlag.MISSING_COUNTERPARTY);
    }

    // Content fingerprint for duplicate detection within batch and across previously confirmed imports
    const fingerprintPayload = JSON.stringify({
      scope: ledgerScope,
      role: counterpartyRole,
      counterparty: (counterpartyName ?? '').trim().toLowerCase(),
      type: normType,
      amount: parsedAmount ?? parsedGoodsTotal,
      voucher: (voucherCode ?? '').trim().toLowerCase(),
      date: (occurredDate ?? '').trim(),
    });
    const rowFingerprint = sha256Hex(fingerprintPayload);

    const isMeasurableRow =
      Boolean(counterpartyName) &&
      (parsedAmount !== null ||
        parsedGoodsTotal !== null ||
        Boolean(voucherCode));

    if (isMeasurableRow && seenFingerprintsInBatch.has(rowFingerprint)) {
      flags.push(HistoricalImportFlag.DUPLICATE_IN_BATCH);
    } else if (isMeasurableRow) {
      seenFingerprintsInBatch.add(rowFingerprint);
    }

    if (
      isMeasurableRow &&
      params.existingImportedFingerprints?.has(rowFingerprint)
    ) {
      flags.push(HistoricalImportFlag.DUPLICATE_EXISTING_ROW);
    }

    let suggestedResolution: HistoricalImportResolutionType =
      HistoricalImportResolution.HOLD_FOR_REVIEW;
    let rowStatus: HistoricalImportRowStatusType =
      HistoricalImportRowStatus.NEEDS_CONFIRMATION;

    const isDuplicate =
      flags.includes(HistoricalImportFlag.DUPLICATE_IN_BATCH) ||
      flags.includes(HistoricalImportFlag.DUPLICATE_EXISTING_ROW);
    const hasBlockingGap =
      flags.includes(HistoricalImportFlag.MISSING_AMOUNT) ||
      flags.includes(HistoricalImportFlag.MISSING_VOUCHER) ||
      flags.includes(HistoricalImportFlag.MISSING_COUNTERPARTY) ||
      flags.includes(HistoricalImportFlag.TOTAL_GOODS_NOT_AUTO_DEBT);

    if (isDuplicate) {
      rowStatus = HistoricalImportRowStatus.DUPLICATE;
      suggestedResolution = HistoricalImportResolution.SKIP;
    } else if (!hasBlockingGap && parsedAmount !== null && parsedAmount > 0) {
      rowStatus = HistoricalImportRowStatus.READY;
      if (normType.includes('ung_truoc')) {
        suggestedResolution =
          counterpartyRole === 'VENDOR'
            ? HistoricalImportResolution.IMPORT_VENDOR_ADVANCE
            : HistoricalImportResolution.IMPORT_CUSTOMER_ADVANCE;
      } else {
        suggestedResolution =
          counterpartyRole === 'VENDOR'
            ? HistoricalImportResolution.IMPORT_OPENING_PAYABLE
            : HistoricalImportResolution.IMPORT_OPENING_RECEIVABLE;
      }
    }

    analyzed.push({
      sourceRowNumber,
      ledgerScope,
      counterpartyRole,
      counterpartyName,
      rawAmountText,
      parsedAmount,
      rawGoodsTotalText,
      parsedGoodsTotal,
      voucherCode,
      occurredDate,
      note,
      rawCellsJson,
      flags,
      rowStatus,
      suggestedResolution,
      rowFingerprint,
    });
  }

  return analyzed;
}
