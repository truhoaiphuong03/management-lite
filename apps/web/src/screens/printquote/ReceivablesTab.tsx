import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAutoDismiss } from '../../../../../packages/ui/src/components/index.js';
import type {
  PrintCustomerData,
  PrintOrderData,
} from '../../../../../packages/contracts/src/printquote.js';
import type {
  CustomerReceivableSummaryItem,
  LedgerScopeType,
  LegacyArAnomalyCodeType,
  LegacyOrderReconciliationGapItem,
  PrintArAdjustmentData,
  PrintArTransactionData,
  PrintLegacyArReconciliationItem,
  PrintLegacyArReconciliationOverview,
  PrintOpeningBalanceData,
} from '../../../../../packages/contracts/src/printquote-finance.js';
import {
  formatVnd,
  parseNumericDraftValue,
} from '../helpers/printquote-helpers.js';
import { cardStyle, inputStyle, labelStyle, tabularNumStyle } from './types.js';
import { NumericDraftInput } from './NumericDraftInput.js';
import { CatalogModalDialog } from './CatalogModalDialog.js';
import { PqPlusIcon, PqWalletIcon } from './PrintQuoteIcons.js';

export interface ReceivablesLedgerPayload {
  summaries: CustomerReceivableSummaryItem[];
  transactions: PrintArTransactionData[];
  adjustments: PrintArAdjustmentData[];
  opening_balances: PrintOpeningBalanceData[];
  legacy_reconciliation?: PrintLegacyArReconciliationOverview | undefined;
}

export interface ReceivablesTabProps {
  data: ReceivablesLedgerPayload | null;
  customers: PrintCustomerData[];
  orders: PrintOrderData[];
  onMutateLedger: (
    endpoint: string,
    body: Record<string, unknown>,
  ) => Promise<{ ok: boolean; error?: string; code?: string }>;
  onRefresh: () => void;
}

const SCOPE_LABELS: Record<LedgerScopeType, string> = {
  GENERAL: 'Sổ chung',
  RIENG: 'Sổ RIÊNG',
  HVGROUP: 'Sổ HVGROUP',
};

const ANOMALY_LABELS: Record<LegacyArAnomalyCodeType, string> = {
  MISSING_CUSTOMER_ID: 'Thiếu mã KH',
  INVALID_AMOUNT: 'Số tiền lỗi',
  ORDER_BALANCE_MISMATCH: 'Lệch số dư đơn',
  ORPHAN_PAID_WITHOUT_PAYMENT_ROWS: 'Đã thu không có dòng phiếu',
  REFUND_EXCEEDS_RECEIPTS: 'Hoàn vượt thu',
  REFUND_AWAITING_CONFIRMED_RECEIPT: 'Chờ xác nhận phiếu thu gốc',
  EXCEEDS_VALID_RECEIVABLE: 'Vượt phải thu hợp lệ',
  CANCELLED_ORDER_UNSETTLED: 'Đơn hủy chờ quyết toán',
};

const pillStyle = (
  tone: 'danger' | 'success' | 'accent' | 'neutral',
): React.CSSProperties => {
  const color =
    tone === 'danger'
      ? 'var(--danger-text)'
      : tone === 'success'
        ? 'var(--success-text)'
        : tone === 'accent'
          ? 'var(--accent-text)'
          : 'var(--muted-color)';
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 700,
    border: `1px solid ${tone === 'neutral' ? 'var(--border-color)' : color}`,
    backgroundColor: 'var(--surface-color)',
    color,
    whiteSpace: 'nowrap',
  };
};

export const ReceivablesTab: React.FC<ReceivablesTabProps> = ({
  data,
  customers,
  orders,
  onMutateLedger,
}) => {
  const [scopeFilter, setScopeFilter] = useState<'ALL' | LedgerScopeType>(
    'ALL',
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [moreMenuOpen, setMoreMenuOpen] = useState<boolean>(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  const [legacyViewTab, setLegacyViewTab] = useState<
    'PENDING' | 'CONFIRMED' | 'HISTORY'
  >('PENDING');

  const [modalMode, setModalMode] = useState<
    | null
    | 'RECEIPT'
    | 'ALLOCATE'
    | 'REFUND'
    | 'ADJUSTMENT'
    | 'OPENING'
    | 'VOID'
    | 'LEGACY_CONFIRM'
    | 'LEGACY_HOLD'
    | 'LEGACY_LINK_CUSTOMER'
    | 'LEGACY_RESOLVE_BALANCE'
  >(null);
  const [selectedTx, setSelectedTx] = useState<PrintArTransactionData | null>(
    null,
  );
  const [selectedLegacyItem, setSelectedLegacyItem] =
    useState<PrintLegacyArReconciliationItem | null>(null);
  const [selectedOrderGap, setSelectedOrderGap] = useState<{
    order_id: string;
    order_code: string;
    customer_name: string;
    customer_phone: string | null;
    pre0036_paid: number;
    legacy_net: number;
  } | null>(null);

  const [formCustomerId, setFormCustomerId] = useState<string>('');
  const [formCustomerName, setFormCustomerName] = useState<string>('');
  const [formCustomerPhone, setFormCustomerPhone] = useState<string>('');
  const [linkCustMode, setLinkCustMode] = useState<'SELECT' | 'QUICK'>(
    'SELECT',
  );
  const [formLedgerScope, setFormLedgerScope] =
    useState<LedgerScopeType>('GENERAL');
  const [formAmountInput, setFormAmountInput] = useState<string>('');
  const [formPaymentMethod, setFormPaymentMethod] =
    useState<string>('BANK_TRANSFER');
  const [formReferenceCode, setFormReferenceCode] = useState<string>('');
  const [formConfirmDupRef, setFormConfirmDupRef] = useState<boolean>(false);
  const [formReason, setFormReason] = useState<string>('');
  const [formNote, setFormNote] = useState<string>('');
  const [formAdjType, setFormAdjType] = useState<
    'DISCOUNT' | 'RETURN_CREDIT' | 'SURCHARGE'
  >('DISCOUNT');
  const [formTargetOrderId, setFormTargetOrderId] = useState<string>('');
  const [formRefundSource, setFormRefundSource] = useState<
    'UNALLOCATED_ADVANCE' | 'CANCELLED_ORDER' | 'ORDER_OVERPAYMENT'
  >('UNALLOCATED_ADVANCE');
  const [allocMap, setAllocMap] = useState<Record<string, string>>({});
  const [modalError, setModalError] = useState<string>('');
  useAutoDismiss(modalError, () => setModalError(''), 5000);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMoreMenuOpen(false);
    };
    const onPointer = (ev: MouseEvent) => {
      if (
        moreMenuRef.current &&
        ev.target instanceof Node &&
        !moreMenuRef.current.contains(ev.target)
      ) {
        setMoreMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [moreMenuOpen]);

  const activeCustomers = useMemo(
    () => customers.filter((c) => c.is_active !== false),
    [customers],
  );

  const normQ = searchQuery.trim().toLowerCase();

  const openOrders = useMemo(
    () =>
      orders.filter(
        (o: PrintOrderData) =>
          o.production_status !== 'CANCELLED' &&
          Boolean(o.customer_id) &&
          (scopeFilter === 'ALL' ||
            (o.ledger_scope || 'GENERAL') === scopeFilter) &&
          (!formCustomerId || o.customer_id === formCustomerId),
      ),
    [orders, scopeFilter, formCustomerId],
  );

  const scopeFilteredCustomers = useMemo(
    () =>
      (data?.summaries ?? []).filter(
        (c: CustomerReceivableSummaryItem) =>
          scopeFilter === 'ALL' || c.ledger_scope === scopeFilter,
      ),
    [data, scopeFilter],
  );

  const filteredCustomers = useMemo(() => {
    if (!normQ) return scopeFilteredCustomers;
    return scopeFilteredCustomers.filter((c) =>
      [c.customer_name, c.customer_code ?? '', c.customer_phone ?? '']
        .join(' ')
        .toLowerCase()
        .includes(normQ),
    );
  }, [scopeFilteredCustomers, normQ]);

  const unallocatedReceipts = useMemo(
    () =>
      (data?.transactions ?? []).filter(
        (tx: PrintArTransactionData) =>
          tx.status === 'POSTED' &&
          tx.tx_kind === 'RECEIPT' &&
          tx.unallocated_amount > 0 &&
          (scopeFilter === 'ALL' || tx.ledger_scope === scopeFilter) &&
          (!normQ ||
            [tx.tx_code, tx.customer_name, tx.reference_code ?? '']
              .join(' ')
              .toLowerCase()
              .includes(normQ)),
      ),
    [data, scopeFilter, normQ],
  );

  const totals = useMemo(() => {
    let valid = 0;
    let settled = 0;
    let remaining = 0;
    let advance = 0;
    let cancelledHolding = 0;
    let legacyPending = 0;
    let effectiveAfterPending = 0;
    for (const c of scopeFilteredCustomers) {
      valid += c.valid_receivable_total;
      settled += c.net_allocated_receipt_total;
      remaining += c.remaining_receivable_total;
      advance += c.unallocated_credit_total;
      cancelledHolding += c.cancelled_holding_pending_total;
      legacyPending += c.legacy_pending_ar_total ?? 0;
      effectiveAfterPending +=
        c.effective_remaining_after_pending_total ??
        c.remaining_receivable_total;
    }
    return {
      valid,
      settled,
      remaining,
      advance,
      cancelledHolding,
      legacyPending,
      effectiveAfterPending,
    };
  }, [scopeFilteredCustomers]);

  const legacyOverview = data?.legacy_reconciliation;
  const legacyPendingItems = useMemo(
    () =>
      (legacyOverview?.items ?? []).filter(
        (it) =>
          it.status !== 'CONFIRMED' &&
          (scopeFilter === 'ALL' || it.ledger_scope === scopeFilter) &&
          (!normQ ||
            [it.order_code, it.customer_name, it.reference_code ?? '']
              .join(' ')
              .toLowerCase()
              .includes(normQ)),
      ),
    [legacyOverview, scopeFilter, normQ],
  );
  const legacyConfirmedItems = useMemo(
    () =>
      (legacyOverview?.items ?? []).filter(
        (it) =>
          it.status === 'CONFIRMED' &&
          (scopeFilter === 'ALL' || it.ledger_scope === scopeFilter),
      ),
    [legacyOverview, scopeFilter],
  );
  const standaloneOrderGaps = useMemo(() => {
    const ordersInItems = new Set(
      (legacyOverview?.items ?? [])
        .filter((it) => it.status !== 'CONFIRMED')
        .map((it) => it.order_id),
    );
    return (legacyOverview?.order_gaps ?? []).filter(
      (g: LegacyOrderReconciliationGapItem) =>
        !ordersInItems.has(g.order_id) &&
        (scopeFilter === 'ALL' || g.ledger_scope === scopeFilter) &&
        (!normQ ||
          [g.order_code, g.customer_name]
            .join(' ')
            .toLowerCase()
            .includes(normQ)),
    );
  }, [legacyOverview, scopeFilter, normQ]);

  const hasLegacyActivity = Boolean(
    legacyOverview &&
    (legacyOverview.summary.legacy_payments_total_count > 0 ||
      legacyOverview.order_gaps.length > 0),
  );

  const resetForm = () => {
    setFormCustomerId('');
    setFormCustomerName('');
    setFormCustomerPhone('');
    setLinkCustMode(activeCustomers.length > 0 ? 'SELECT' : 'QUICK');
    setFormLedgerScope(scopeFilter === 'ALL' ? 'GENERAL' : scopeFilter);
    setFormAmountInput('');
    setFormPaymentMethod('BANK_TRANSFER');
    setFormReferenceCode('');
    setFormConfirmDupRef(false);
    setFormReason('');
    setFormNote('');
    setFormTargetOrderId('');
    setAllocMap({});
    setModalError('');
    setSelectedTx(null);
    setSelectedLegacyItem(null);
    setSelectedOrderGap(null);
  };

  const openModal = (mode: NonNullable<typeof modalMode>) => {
    resetForm();
    setMoreMenuOpen(false);
    setModalMode(mode);
  };

  const parsePositiveInt = (raw: string): number | null => {
    const parsed = parseNumericDraftValue(raw.trim(), {
      allowDecimal: false,
      min: 1,
      integerOnly: true,
    });
    return parsed.isValid && parsed.value !== null && parsed.value > 0
      ? parsed.value
      : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    setSubmitting(true);
    try {
      const cust = customers.find((c) => c.id === formCustomerId);
      const resolvedCustName =
        cust?.name || formCustomerName.trim() || 'Khách lẻ';

      if (modalMode === 'RECEIPT') {
        const amount = parsePositiveInt(formAmountInput);
        if (!amount) {
          setModalError('Nhập số tiền thu nguyên dương (VNĐ).');
          return;
        }
        const allocations = Object.entries(allocMap)
          .map(([orderId, raw]) => ({
            order_id: orderId,
            amount: parsePositiveInt(raw) || 0,
          }))
          .filter((a) => a.amount > 0);

        const res = await onMutateLedger(
          '/api/v1/print-quotes/receivables/receipts',
          {
            customer_id: formCustomerId || null,
            customer_name: resolvedCustName,
            ledger_scope: formLedgerScope,
            amount,
            payment_method: formPaymentMethod,
            reference_code: formReferenceCode.trim() || null,
            confirm_duplicate_reference: formConfirmDupRef,
            note: formNote.trim() || null,
            allocations,
          },
        );
        if (!res.ok) {
          if (res.code === 'DUPLICATE_REFERENCE_CODE') {
            setFormConfirmDupRef(true);
          }
          setModalError(res.error || 'Không thể ghi nhận phiếu thu.');
          return;
        }
        setModalMode(null);
      } else if (modalMode === 'ALLOCATE' && selectedTx) {
        const allocations = Object.entries(allocMap)
          .map(([orderId, raw]) => ({
            order_id: orderId,
            amount: parsePositiveInt(raw) || 0,
          }))
          .filter((a) => a.amount > 0);
        if (allocations.length === 0) {
          setModalError('Nhập số tiền phân bổ cho ít nhất 1 đơn hàng.');
          return;
        }
        const res = await onMutateLedger(
          `/api/v1/print-quotes/receivables/receipts/${encodeURIComponent(selectedTx.id)}/allocate`,
          { allocations, note: formNote.trim() || null },
        );
        if (!res.ok) {
          setModalError(res.error || 'Không thể phân bổ tiền dư.');
          return;
        }
        setModalMode(null);
      } else if (modalMode === 'REFUND') {
        const amount = parsePositiveInt(formAmountInput);
        if (!amount) {
          setModalError('Nhập số tiền hoàn trả nguyên dương (VNĐ).');
          return;
        }
        const res = await onMutateLedger(
          '/api/v1/print-quotes/receivables/refunds',
          {
            customer_id: formCustomerId || null,
            customer_name: resolvedCustName,
            ledger_scope: formLedgerScope,
            amount,
            payment_method: formPaymentMethod,
            reference_code: formReferenceCode.trim() || null,
            source: formRefundSource,
            order_id:
              formRefundSource !== 'UNALLOCATED_ADVANCE'
                ? formTargetOrderId || null
                : null,
            reason: formReason.trim(),
            note: formNote.trim() || null,
          },
        );
        if (!res.ok) {
          setModalError(res.error || 'Không thể ghi nhận hoàn tiền.');
          return;
        }
        setModalMode(null);
      } else if (modalMode === 'ADJUSTMENT') {
        const amount = parsePositiveInt(formAmountInput);
        if (!amount || !formTargetOrderId) {
          setModalError('Chọn đơn hàng và nhập số tiền điều chỉnh > 0.');
          return;
        }
        const deltaAmount = formAdjType === 'SURCHARGE' ? amount : -amount;
        const res = await onMutateLedger(
          '/api/v1/print-quotes/receivables/adjustments',
          {
            order_id: formTargetOrderId,
            adjustment_type: formAdjType,
            delta_amount: deltaAmount,
            reason: formReason.trim(),
          },
        );
        if (!res.ok) {
          setModalError(res.error || 'Không thể điều chỉnh phải thu.');
          return;
        }
        setModalMode(null);
      } else if (modalMode === 'OPENING') {
        const amount = parsePositiveInt(formAmountInput);
        if (!amount || !(cust?.name || formCustomerName.trim())) {
          setModalError('Nhập tên khách hàng và số dư đầu kỳ > 0.');
          return;
        }
        const res = await onMutateLedger(
          '/api/v1/print-quotes/opening-balances',
          {
            direction: 'CUSTOMER_RECEIVABLE',
            ledger_scope: formLedgerScope,
            customer_id: formCustomerId || null,
            customer_name: resolvedCustName,
            original_amount: amount,
            note: formNote.trim() || null,
          },
        );
        if (!res.ok) {
          setModalError(res.error || 'Không thể tạo số dư đầu kỳ.');
          return;
        }
        setModalMode(null);
      } else if (modalMode === 'VOID' && selectedTx) {
        const res = await onMutateLedger(
          `/api/v1/print-quotes/receivables/transactions/${encodeURIComponent(selectedTx.id)}/void`,
          { reason: formReason.trim() },
        );
        if (!res.ok) {
          setModalError(res.error || 'Không thể hủy phiếu thu.');
          return;
        }
        setModalMode(null);
      } else if (modalMode === 'LEGACY_CONFIRM' && selectedLegacyItem) {
        const res = await onMutateLedger(
          `/api/v1/print-quotes/receivables/legacy-payments/${encodeURIComponent(selectedLegacyItem.reconciliation_id)}/confirm`,
          { note: formNote.trim() || null },
        );
        if (!res.ok) {
          setModalError(
            res.error || 'Không thể xác nhận phiếu cũ vào sổ AR chính thức.',
          );
          return;
        }
        setModalMode(null);
      } else if (modalMode === 'LEGACY_HOLD' && selectedLegacyItem) {
        const unhold = selectedLegacyItem.status === 'ON_HOLD';
        const res = await onMutateLedger(
          `/api/v1/print-quotes/receivables/legacy-payments/${encodeURIComponent(selectedLegacyItem.reconciliation_id)}/hold`,
          { unhold, reason: formReason.trim() },
        );
        if (!res.ok) {
          setModalError(res.error || 'Không thể cập nhật trạng thái tạm giữ.');
          return;
        }
        setModalMode(null);
      } else if (modalMode === 'LEGACY_LINK_CUSTOMER' && selectedOrderGap) {
        if (linkCustMode === 'SELECT' && !formCustomerId) {
          setModalError('Vui lòng chọn khách hàng hợp lệ từ danh mục.');
          return;
        }
        if (linkCustMode === 'QUICK' && !formCustomerName.trim()) {
          setModalError('Vui lòng nhập tên khách hàng mới.');
          return;
        }
        const res = await onMutateLedger(
          `/api/v1/print-quotes/orders/${encodeURIComponent(selectedOrderGap.order_id)}/link-customer`,
          {
            ...(linkCustMode === 'SELECT'
              ? { customer_id: formCustomerId }
              : {
                  quick_customer: {
                    name: formCustomerName.trim(),
                    phone: formCustomerPhone.trim() || null,
                  },
                }),
            reason:
              formReason.trim() ||
              'Đối chiếu bổ sung mã khách hàng cho đơn cũ trước migration 0036',
          },
        );
        if (!res.ok) {
          setModalError(res.error || 'Không thể gắn khách hàng cho đơn cũ.');
          return;
        }
        setModalMode(null);
      } else if (modalMode === 'LEGACY_RESOLVE_BALANCE' && selectedOrderGap) {
        if (!formReason.trim()) {
          setModalError('Vui lòng nhập căn cứ đối chiếu số dư.');
          return;
        }
        const res = await onMutateLedger(
          `/api/v1/print-quotes/orders/${encodeURIComponent(selectedOrderGap.order_id)}/reconcile-legacy-balance`,
          { reason: formReason.trim() },
        );
        if (!res.ok) {
          setModalError(
            res.error || 'Không thể chốt đối chiếu chênh lệch số dư đơn cũ.',
          );
          return;
        }
        setModalMode(null);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="panel-pq-receivables"
      style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
    >
      {/* Streamlined Header: 1 Primary CTA + Compact Secondary Menu */}
      <div className="pq-page-head">
        <div>
          <h1 className="pq-page-title">Công nợ khách hàng</h1>
          <p className="pq-page-subtitle">
            Sổ phải thu in ấn chính thức, tiền ứng trước và đối chiếu phiếu cũ
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            data-testid="pq-ar-new-receipt-btn"
            className="pq-btn pq-btn-primary"
            onClick={() => openModal('RECEIPT')}
          >
            <PqPlusIcon size={15} />
            <span>Thu tiền khách</span>
          </button>

          <div ref={moreMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              data-testid="pq-ar-more-actions-btn"
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen}
              className="pq-btn pq-btn-secondary"
              onClick={() => setMoreMenuOpen((prev) => !prev)}
            >
              <span>Thao tác khác ▾</span>
            </button>
            {moreMenuOpen && (
              <div
                role="menu"
                aria-label="Thao tác phụ công nợ khách hàng"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 6px)',
                  zIndex: 30,
                  minWidth: '210px',
                  maxWidth: 'min(260px, calc(100vw - 32px))',
                  padding: '6px',
                  borderRadius: '12px',
                  backgroundColor: 'var(--surface-color)',
                  border: '1px solid var(--border-color)',
                  boxShadow: 'var(--shadow-md)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  data-testid="pq-ar-adjustment-btn"
                  className="pq-btn pq-btn-ghost pq-btn-sm"
                  style={{ justifyContent: 'flex-start', width: '100%' }}
                  onClick={() => openModal('ADJUSTMENT')}
                >
                  <span>Điều chỉnh công nợ</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="pq-ar-refund-btn"
                  className="pq-btn pq-btn-ghost pq-btn-sm"
                  style={{ justifyContent: 'flex-start', width: '100%' }}
                  onClick={() => openModal('REFUND')}
                >
                  <span>Hoàn tiền cho khách</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="pq-ar-opening-btn"
                  className="pq-btn pq-btn-ghost pq-btn-sm"
                  style={{ justifyContent: 'flex-start', width: '100%' }}
                  onClick={() => openModal('OPENING')}
                >
                  <span>+ Thêm dư đầu kỳ</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Single Unified Search + Scope Control Row */}
      <div
        data-testid="pq-ar-toolbar"
        style={{
          ...cardStyle,
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <input
            type="search"
            data-testid="pq-ar-search-input"
            aria-label="Tìm khách hàng, số điện thoại hoặc mã đơn"
            autoComplete="off"
            style={{
              ...inputStyle,
              minHeight: '38px',
              padding: '6px 12px',
            }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm khách hàng, SĐT, mã đơn…"
          />
        </div>
        <div
          className="pq-filter-pills"
          role="group"
          aria-label="Lọc nhóm sổ"
          style={{ flex: '0 1 auto', maxWidth: '100%' }}
        >
          {(['ALL', 'GENERAL', 'RIENG', 'HVGROUP'] as const).map((sc) => (
            <button
              key={sc}
              type="button"
              data-testid={`pq-ar-scope-${sc}`}
              aria-pressed={scopeFilter === sc}
              className="pq-filter-pill"
              data-active={scopeFilter === sc ? 'true' : 'false'}
              onClick={() => setScopeFilter(sc)}
            >
              {sc === 'ALL' ? 'Tất cả sổ' : SCOPE_LABELS[sc]}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards: Distinct Official AR vs Unallocated Advance vs Pending Reconciliation vs Cancelled Holding */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 195px), 1fr))',
          gap: '10px',
        }}
      >
        <div className="pq-stat-card" data-testid="pq-ar-kpi-remaining">
          <div className="pq-stat-label">Còn phải thu (Sổ chính thức)</div>
          <div
            className="pq-stat-value"
            style={{ ...tabularNumStyle, color: 'var(--danger-text)' }}
          >
            {formatVnd(totals.remaining)}
          </div>
          <div className="pq-stat-sub">
            Hợp lệ: {formatVnd(totals.valid)}
            {totals.legacyPending !== 0
              ? ` • Trừ chờ ĐC còn ${formatVnd(totals.effectiveAfterPending)}`
              : ''}
          </div>
        </div>

        <div className="pq-stat-card" data-testid="pq-ar-kpi-collected">
          <div className="pq-stat-label">Đã thu vào sổ AR</div>
          <div
            className="pq-stat-value"
            style={{ ...tabularNumStyle, color: 'var(--success-text)' }}
          >
            {formatVnd(totals.settled)}
          </div>
          <div className="pq-stat-sub">Đã xác nhận & gán đơn / đầu kỳ</div>
        </div>

        <div className="pq-stat-card" data-testid="pq-ar-kpi-advance">
          <div className="pq-stat-label">Tiền dư / Ứng trước</div>
          <div
            className="pq-stat-value"
            style={{ ...tabularNumStyle, color: 'var(--accent-text)' }}
          >
            {formatVnd(totals.advance)}
          </div>
          <div className="pq-stat-sub">
            {unallocatedReceipts.length} phiếu thu chưa gán hết
          </div>
        </div>

        <div className="pq-stat-card">
          <div className="pq-stat-label">Giữ trên đơn hủy</div>
          <div className="pq-stat-value" style={tabularNumStyle}>
            {formatVnd(totals.cancelledHolding)}
          </div>
          <div className="pq-stat-sub">Chờ quyết toán hoàn / phí hủy</div>
        </div>
      </div>

      {/* Legacy print_order_payments Reconciliation Gate (Owner Approved) */}
      {hasLegacyActivity && legacyOverview && (
        <div
          data-testid="pq-ar-legacy-reconciliation-section"
          style={{
            ...cardStyle,
            borderColor:
              legacyOverview.summary.pending_count > 0 ||
              legacyOverview.summary.orders_missing_customer_count > 0
                ? 'var(--accent-text)'
                : 'var(--border-color)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              marginBottom: '10px',
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                Đối chiếu phiếu thu/hoàn cũ trước khi ghi sổ AR chính thức
              </h2>
              <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                Chỉ dòng đủ mã khách & khớp số dư mới được xác nhận vào sổ AR —
                không cộng trùng với đơn cũ
              </div>
            </div>
            <div
              className="pq-filter-pills"
              role="group"
              aria-label="Chế độ xem đối chiếu cũ"
            >
              <button
                type="button"
                data-testid="pq-ar-legacy-tab-pending"
                aria-pressed={legacyViewTab === 'PENDING'}
                className="pq-filter-pill"
                data-active={legacyViewTab === 'PENDING' ? 'true' : 'false'}
                onClick={() => setLegacyViewTab('PENDING')}
              >
                Cần đối chiếu (
                {legacyOverview.summary.pending_count +
                  legacyOverview.summary.on_hold_count +
                  standaloneOrderGaps.length}
                )
              </button>
              <button
                type="button"
                data-testid="pq-ar-legacy-tab-confirmed"
                aria-pressed={legacyViewTab === 'CONFIRMED'}
                className="pq-filter-pill"
                data-active={legacyViewTab === 'CONFIRMED' ? 'true' : 'false'}
                onClick={() => setLegacyViewTab('CONFIRMED')}
              >
                Đã vào sổ ({legacyOverview.summary.confirmed_to_ar_count})
              </button>
              <button
                type="button"
                data-testid="pq-ar-legacy-tab-history"
                aria-pressed={legacyViewTab === 'HISTORY'}
                className="pq-filter-pill"
                data-active={legacyViewTab === 'HISTORY' ? 'true' : 'false'}
                onClick={() => setLegacyViewTab('HISTORY')}
              >
                Lịch sử ({legacyOverview.history.length})
              </button>
            </div>
          </div>

          {/* Before / After Reconciliation Summary Strip */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
              gap: '8px',
              padding: '8px 10px',
              borderRadius: '10px',
              backgroundColor: 'var(--surface-subtle)',
              border: '1px solid var(--border-color)',
              marginBottom: '10px',
              fontSize: '12px',
            }}
          >
            <div>
              <div style={{ color: 'var(--muted-color)' }}>
                Tổng phiếu cũ (
                {legacyOverview.summary.legacy_payments_total_count})
              </div>
              <strong style={tabularNumStyle}>
                {formatVnd(legacyOverview.summary.legacy_payments_net_amount)}
              </strong>
            </div>
            <div>
              <div style={{ color: 'var(--muted-color)' }}>
                Đã xác nhận vào AR (
                {legacyOverview.summary.confirmed_to_ar_count})
              </div>
              <strong
                style={{ ...tabularNumStyle, color: 'var(--success-text)' }}
              >
                {formatVnd(legacyOverview.summary.confirmed_to_ar_net_amount)}
              </strong>
            </div>
            <div>
              <div style={{ color: 'var(--muted-color)' }}>
                Chờ đối chiếu ({legacyOverview.summary.pending_count})
              </div>
              <strong
                style={{ ...tabularNumStyle, color: 'var(--accent-text)' }}
              >
                {formatVnd(legacyOverview.summary.pending_net_amount)}
              </strong>
            </div>
            <div>
              <div style={{ color: 'var(--muted-color)' }}>
                Bất thường / Thiếu KH
              </div>
              <strong
                style={{
                  ...tabularNumStyle,
                  color:
                    legacyOverview.summary.anomalous_pending_count > 0 ||
                    legacyOverview.summary.orders_missing_customer_count > 0
                      ? 'var(--danger-text)'
                      : 'var(--success-text)',
                }}
              >
                {legacyOverview.summary.anomalous_pending_count} dòng •{' '}
                {legacyOverview.summary.orders_missing_customer_count} đơn thiếu
                KH
              </strong>
            </div>
          </div>

          {legacyViewTab === 'PENDING' && (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              {legacyPendingItems.length === 0 &&
              standaloneOrderGaps.length === 0 ? (
                <div
                  style={{
                    padding: '12px',
                    fontSize: '12.5px',
                    color: 'var(--muted-color)',
                    textAlign: 'center',
                  }}
                >
                  Tất cả phiếu cũ và đơn hàng trong phạm vi đang chọn đã đối
                  chiếu xong.
                </div>
              ) : (
                <>
                  {legacyPendingItems.map((it) => (
                    <div
                      key={it.reconciliation_id}
                      data-testid={`pq-ar-legacy-row-${it.legacy_payment_id}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                        padding: '10px 12px',
                        borderRadius: '10px',
                        backgroundColor: 'var(--surface-subtle)',
                        border: '1px solid var(--border-color)',
                        fontSize: '12.5px',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '6px',
                            marginBottom: '4px',
                          }}
                        >
                          <strong>{it.order_code}</strong>
                          <span>• {it.customer_name}</span>
                          <span
                            style={pillStyle(
                              it.payment_type === 'REFUND'
                                ? 'danger'
                                : 'accent',
                            )}
                          >
                            {it.payment_type === 'REFUND'
                              ? 'Hoàn tiền cũ'
                              : `Thu cũ (${it.payment_type})`}{' '}
                            {formatVnd(it.amount)}
                          </span>
                          {it.status === 'ON_HOLD' && (
                            <span style={pillStyle('neutral')}>
                              Đang tạm giữ
                            </span>
                          )}
                          {it.anomaly_codes.map((code) => (
                            <span key={code} style={pillStyle('danger')}>
                              {ANOMALY_LABELS[code] || code}
                            </span>
                          ))}
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--muted-color)',
                          }}
                        >
                          Đơn {formatVnd(it.order_total_quote_amount)} • Trước
                          0036 đã thu{' '}
                          {formatVnd(it.order_pre0036_paid_snapshot)} • Sổ AR
                          chính thức hiện có{' '}
                          {formatVnd(it.order_official_ar_allocated)}
                          {it.hold_reason
                            ? ` • Lý do giữ: ${it.hold_reason}`
                            : ''}
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          gap: '6px',
                          flexWrap: 'wrap',
                        }}
                      >
                        {it.anomaly_codes.includes('MISSING_CUSTOMER_ID') && (
                          <button
                            type="button"
                            data-testid={`pq-ar-legacy-link-customer-${it.order_id}`}
                            className="pq-btn pq-btn-secondary pq-btn-sm"
                            onClick={() => {
                              resetForm();
                              setSelectedOrderGap({
                                order_id: it.order_id,
                                order_code: it.order_code,
                                customer_name: it.customer_name,
                                customer_phone: it.customer_phone,
                                pre0036_paid: it.order_pre0036_paid_snapshot,
                                legacy_net: it.order_legacy_net_payments,
                              });
                              setFormCustomerName(it.customer_name);
                              setFormCustomerPhone(it.customer_phone || '');
                              setModalMode('LEGACY_LINK_CUSTOMER');
                            }}
                          >
                            Gắn mã KH
                          </button>
                        )}
                        {it.anomaly_codes.includes('ORDER_BALANCE_MISMATCH') &&
                          !it.anomaly_codes.includes('MISSING_CUSTOMER_ID') && (
                            <button
                              type="button"
                              data-testid={`pq-ar-legacy-resolve-balance-${it.order_id}`}
                              className="pq-btn pq-btn-secondary pq-btn-sm"
                              onClick={() => {
                                resetForm();
                                setSelectedOrderGap({
                                  order_id: it.order_id,
                                  order_code: it.order_code,
                                  customer_name: it.customer_name,
                                  customer_phone: it.customer_phone,
                                  pre0036_paid: it.order_pre0036_paid_snapshot,
                                  legacy_net: it.order_legacy_net_payments,
                                });
                                setModalMode('LEGACY_RESOLVE_BALANCE');
                              }}
                            >
                              Đối chiếu số dư
                            </button>
                          )}
                        <button
                          type="button"
                          data-testid={`pq-ar-legacy-confirm-${it.legacy_payment_id}`}
                          disabled={!it.can_confirm}
                          className="pq-btn pq-btn-accent pq-btn-sm"
                          title={
                            it.can_confirm
                              ? 'Xác nhận ghi vào sổ AR chính thức'
                              : 'Phải xử lý hết cảnh báo trước khi xác nhận'
                          }
                          onClick={() => {
                            resetForm();
                            setSelectedLegacyItem(it);
                            setModalMode('LEGACY_CONFIRM');
                          }}
                        >
                          Xác nhận vào AR
                        </button>
                        <button
                          type="button"
                          data-testid={`pq-ar-legacy-hold-${it.legacy_payment_id}`}
                          className="pq-btn pq-btn-ghost pq-btn-sm"
                          onClick={() => {
                            resetForm();
                            setSelectedLegacyItem(it);
                            setModalMode('LEGACY_HOLD');
                          }}
                        >
                          {it.status === 'ON_HOLD' ? 'Mở lại' : 'Tạm giữ'}
                        </button>
                      </div>
                    </div>
                  ))}

                  {standaloneOrderGaps.map((g) => (
                    <div
                      key={g.order_id}
                      data-testid={`pq-ar-legacy-order-gap-${g.order_id}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                        padding: '10px 12px',
                        borderRadius: '10px',
                        backgroundColor: 'var(--surface-subtle)',
                        border: '1px solid var(--border-color)',
                        fontSize: '12.5px',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '6px',
                          }}
                        >
                          <strong>{g.order_code}</strong>
                          <span>• {g.customer_name}</span>
                          {g.anomaly_codes.map((code) => (
                            <span key={code} style={pillStyle('danger')}>
                              {ANOMALY_LABELS[code] || code}
                            </span>
                          ))}
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--muted-color)',
                          }}
                        >
                          Đơn cũ {formatVnd(g.total_quote_amount)} • Đã thu ghi
                          nhận trước 0036:{' '}
                          {formatVnd(g.pre0036_total_paid_snapshot)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {g.anomaly_codes.includes('MISSING_CUSTOMER_ID') && (
                          <button
                            type="button"
                            data-testid={`pq-ar-legacy-link-customer-${g.order_id}`}
                            className="pq-btn pq-btn-secondary pq-btn-sm"
                            onClick={() => {
                              resetForm();
                              setSelectedOrderGap({
                                order_id: g.order_id,
                                order_code: g.order_code,
                                customer_name: g.customer_name,
                                customer_phone: g.customer_phone,
                                pre0036_paid: g.pre0036_total_paid_snapshot,
                                legacy_net: g.legacy_net_payments,
                              });
                              setFormCustomerName(g.customer_name);
                              setFormCustomerPhone(g.customer_phone || '');
                              setModalMode('LEGACY_LINK_CUSTOMER');
                            }}
                          >
                            Gắn mã KH
                          </button>
                        )}
                        {(g.anomaly_codes.includes('ORDER_BALANCE_MISMATCH') ||
                          g.anomaly_codes.includes(
                            'ORPHAN_PAID_WITHOUT_PAYMENT_ROWS',
                          )) &&
                          !g.anomaly_codes.includes('MISSING_CUSTOMER_ID') && (
                            <button
                              type="button"
                              data-testid={`pq-ar-legacy-resolve-balance-${g.order_id}`}
                              className="pq-btn pq-btn-secondary pq-btn-sm"
                              onClick={() => {
                                resetForm();
                                setSelectedOrderGap({
                                  order_id: g.order_id,
                                  order_code: g.order_code,
                                  customer_name: g.customer_name,
                                  customer_phone: g.customer_phone,
                                  pre0036_paid: g.pre0036_total_paid_snapshot,
                                  legacy_net: g.legacy_net_payments,
                                });
                                setModalMode('LEGACY_RESOLVE_BALANCE');
                              }}
                            >
                              Đối chiếu số dư
                            </button>
                          )}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {legacyViewTab === 'CONFIRMED' && (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
            >
              {legacyConfirmedItems.length === 0 ? (
                <div
                  style={{
                    padding: '12px',
                    fontSize: '12.5px',
                    color: 'var(--muted-color)',
                    textAlign: 'center',
                  }}
                >
                  Chưa có phiếu cũ nào được xác nhận vào sổ AR chính thức.
                </div>
              ) : (
                legacyConfirmedItems.map((it) => (
                  <div
                    key={it.reconciliation_id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '8px',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--surface-subtle)',
                      fontSize: '12.5px',
                    }}
                  >
                    <span>
                      <strong>{it.order_code}</strong> • {it.customer_name} •{' '}
                      {formatVnd(it.amount)}
                    </span>
                    <span style={pillStyle('success')}>
                      Đã vào AR: {it.posted_ar_tx_code || 'POSTED'}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {legacyViewTab === 'HISTORY' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                maxHeight: '220px',
                overflowY: 'auto',
              }}
            >
              {legacyOverview.history.slice(0, 20).map((h) => (
                <div
                  key={h.id}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--surface-subtle)',
                    fontSize: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '6px',
                  }}
                >
                  <span>
                    <strong>{h.action}</strong>
                    {h.reason ? ` — ${h.reason}` : ''}
                  </span>
                  <span
                    style={{ color: 'var(--muted-color)', ...tabularNumStyle }}
                  >
                    {h.created_at.slice(0, 16).replace('T', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Unallocated Customer Advances */}
      {unallocatedReceipts.length > 0 && (
        <div style={cardStyle} data-testid="pq-ar-unallocated-section">
          <h2 style={{ margin: '0 0 10px', fontSize: '15px', fontWeight: 700 }}>
            Khoản thu chưa phân bổ hết ({unallocatedReceipts.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {unallocatedReceipts.map((tx: PrintArTransactionData) => (
              <div
                key={tx.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  fontSize: '13px',
                }}
              >
                <div>
                  <strong>{tx.tx_code}</strong> • {tx.customer_name} •{' '}
                  <span style={{ color: 'var(--muted-color)' }}>
                    {SCOPE_LABELS[tx.ledger_scope]}
                  </span>
                  <div
                    style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                  >
                    Tổng thu {formatVnd(tx.amount)} • Còn dư chưa phân bổ:{' '}
                    <strong style={{ color: 'var(--accent-text)' }}>
                      {formatVnd(tx.unallocated_amount)}
                    </strong>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="pq-btn pq-btn-accent pq-btn-sm"
                    onClick={() => {
                      resetForm();
                      setSelectedTx(tx);
                      setFormCustomerId(tx.customer_id || '');
                      setFormLedgerScope(tx.ledger_scope);
                      setModalMode('ALLOCATE');
                    }}
                  >
                    Phân bổ vào đơn
                  </button>
                  <button
                    type="button"
                    className="pq-btn pq-btn-danger-ghost pq-btn-sm"
                    onClick={() => {
                      resetForm();
                      setSelectedTx(tx);
                      setModalMode('VOID');
                    }}
                  >
                    Hủy phiếu
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Customer Debt Table */}
      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700 }}>
          Tổng hợp công nợ theo khách hàng
        </h2>
        {filteredCustomers.length === 0 ? (
          <div
            style={{
              padding: '24px 12px',
              textAlign: 'center',
              color: 'var(--muted-color)',
              fontSize: '13px',
            }}
          >
            Chưa có phát sinh công nợ khách hàng trong phạm vi đang chọn.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="pq-table">
              <thead>
                <tr>
                  <th>Khách hàng</th>
                  <th>Nhóm sổ</th>
                  <th style={{ textAlign: 'right' }}>Phải thu hợp lệ</th>
                  <th style={{ textAlign: 'right' }}>Đã thu sổ AR</th>
                  <th style={{ textAlign: 'right' }}>Còn phải thu</th>
                  <th style={{ textAlign: 'right' }}>Tiền dư / Ứng trước</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.map((row: CustomerReceivableSummaryItem) => (
                  <tr key={`${row.customer_key}-${row.ledger_scope}`}>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '6px',
                          fontWeight: 700,
                        }}
                      >
                        <span>{row.customer_name}</span>
                        {row.missing_customer_id && (
                          <span style={pillStyle('danger')}>Thiếu mã KH</span>
                        )}
                      </div>
                      {row.customer_phone && (
                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--muted-color)',
                            ...tabularNumStyle,
                          }}
                        >
                          {row.customer_phone}
                        </div>
                      )}
                    </td>
                    <td>{SCOPE_LABELS[row.ledger_scope]}</td>
                    <td style={{ textAlign: 'right', ...tabularNumStyle }}>
                      {formatVnd(row.valid_receivable_total)}
                    </td>
                    <td style={{ textAlign: 'right', ...tabularNumStyle }}>
                      {formatVnd(row.net_allocated_receipt_total)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        ...tabularNumStyle,
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          color:
                            row.remaining_receivable_total > 0
                              ? 'var(--danger-text)'
                              : 'var(--success-text)',
                        }}
                      >
                        {formatVnd(row.remaining_receivable_total)}
                      </div>
                      {(row.legacy_pending_ar_total ?? 0) !== 0 && (
                        <div
                          style={{
                            fontSize: '11.5px',
                            color: 'var(--muted-color)',
                          }}
                        >
                          Chờ ĐC: {formatVnd(row.legacy_pending_ar_total ?? 0)}{' '}
                          • Còn thực:{' '}
                          {formatVnd(
                            row.effective_remaining_after_pending_total ??
                              row.remaining_receivable_total,
                          )}
                        </div>
                      )}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        color:
                          row.unallocated_credit_total > 0
                            ? 'var(--accent-text)'
                            : 'var(--muted-color)',
                        ...tabularNumStyle,
                      }}
                    >
                      {formatVnd(row.unallocated_credit_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Unified Modal */}
      <CatalogModalDialog
        open={modalMode !== null}
        ariaLabel="Thao tác công nợ khách hàng"
        title={
          modalMode === 'RECEIPT'
            ? 'Thu tiền khách & Phân bổ đơn'
            : modalMode === 'ALLOCATE'
              ? `Phân bổ phiếu ${selectedTx?.tx_code || ''}`
              : modalMode === 'REFUND'
                ? 'Hoàn tiền cho khách'
                : modalMode === 'ADJUSTMENT'
                  ? 'Điều chỉnh phải thu đơn hàng'
                  : modalMode === 'OPENING'
                    ? 'Thêm số dư phải thu đầu kỳ'
                    : modalMode === 'LEGACY_CONFIRM'
                      ? `Xác nhận phiếu cũ vào sổ AR (${selectedLegacyItem?.order_code || ''})`
                      : modalMode === 'LEGACY_HOLD'
                        ? selectedLegacyItem?.status === 'ON_HOLD'
                          ? 'Mở lại đối chiếu phiếu cũ'
                          : 'Tạm giữ phiếu cũ chưa đưa vào AR'
                        : modalMode === 'LEGACY_LINK_CUSTOMER'
                          ? `Gắn mã khách hàng cho đơn ${selectedOrderGap?.order_code || ''}`
                          : modalMode === 'LEGACY_RESOLVE_BALANCE'
                            ? `Đối chiếu số dư đơn ${selectedOrderGap?.order_code || ''}`
                            : 'Hủy / Đảo phiếu thu'
        }
        maxWidth="540px"
        onClose={() => setModalMode(null)}
      >
        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          {modalError && (
            <div
              role="alert"
              style={{
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1px solid var(--danger-text)',
                color: 'var(--danger-text)',
                fontSize: '12.5px',
              }}
            >
              {modalError}
            </div>
          )}

          {modalMode === 'LEGACY_CONFIRM' && selectedLegacyItem && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-color)',
                fontSize: '12.5px',
                lineHeight: 1.5,
              }}
            >
              <div>
                <strong>{selectedLegacyItem.order_code}</strong> •{' '}
                {selectedLegacyItem.customer_name} (
                {selectedLegacyItem.customer_code})
              </div>
              <div style={tabularNumStyle}>
                Số tiền ghi nhận:{' '}
                <strong>{formatVnd(selectedLegacyItem.amount)}</strong> (
                {selectedLegacyItem.payment_type})
              </div>
              <div style={{ color: 'var(--muted-color)', ...tabularNumStyle }}>
                Sổ AR chính thức của đơn:{' '}
                {formatVnd(selectedLegacyItem.order_official_ar_allocated)} ➔{' '}
                <strong>
                  {formatVnd(
                    selectedLegacyItem.payment_type === 'REFUND'
                      ? selectedLegacyItem.order_official_ar_allocated -
                          selectedLegacyItem.amount
                      : selectedLegacyItem.order_official_ar_allocated +
                          selectedLegacyItem.amount,
                  )}
                </strong>{' '}
                (Không nhân đôi tổng thu trên đơn)
              </div>
            </div>
          )}

          {modalMode === 'LEGACY_LINK_CUSTOMER' && selectedOrderGap && (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <div
                className="pq-filter-pills"
                role="group"
                aria-label="Cách gắn khách đơn cũ"
              >
                <button
                  type="button"
                  aria-pressed={linkCustMode === 'SELECT'}
                  className="pq-filter-pill"
                  data-active={linkCustMode === 'SELECT' ? 'true' : 'false'}
                  onClick={() => setLinkCustMode('SELECT')}
                >
                  Chọn khách đã có
                </button>
                <button
                  type="button"
                  aria-pressed={linkCustMode === 'QUICK'}
                  className="pq-filter-pill"
                  data-active={linkCustMode === 'QUICK' ? 'true' : 'false'}
                  onClick={() => setLinkCustMode('QUICK')}
                >
                  + Tạo nhanh khách mới
                </button>
              </div>
              {linkCustMode === 'SELECT' ? (
                <div>
                  <label style={labelStyle}>Khách hàng trong danh mục *</label>
                  <select
                    aria-label="Chọn khách hàng gắn cho đơn cũ"
                    style={inputStyle}
                    value={formCustomerId}
                    onChange={(e) => setFormCustomerId(e.target.value)}
                  >
                    <option value="">-- Chọn khách hàng --</option>
                    {activeCustomers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
                    gap: '10px',
                  }}
                >
                  <div>
                    <label style={labelStyle}>Tên khách hàng mới *</label>
                    <input
                      aria-label="Tên khách hàng mới"
                      style={inputStyle}
                      value={formCustomerName}
                      onChange={(e) => setFormCustomerName(e.target.value)}
                      placeholder="Tên khách hàng…"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Số điện thoại</label>
                    <input
                      aria-label="Số điện thoại khách hàng mới"
                      style={inputStyle}
                      value={formCustomerPhone}
                      onChange={(e) => setFormCustomerPhone(e.target.value)}
                      placeholder="SĐT…"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {modalMode === 'LEGACY_RESOLVE_BALANCE' && selectedOrderGap && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-color)',
                fontSize: '12.5px',
                lineHeight: 1.5,
              }}
            >
              <div>
                Đơn <strong>{selectedOrderGap.order_code}</strong> (
                {selectedOrderGap.customer_name})
              </div>
              <div style={tabularNumStyle}>
                Đã thu ghi trên đầu đơn cũ:{' '}
                <strong>{formatVnd(selectedOrderGap.pre0036_paid)}</strong> •
                Tổng ròng các dòng phiếu cũ:{' '}
                <strong>{formatVnd(selectedOrderGap.legacy_net)}</strong>
              </div>
              <div style={{ color: 'var(--muted-color)' }}>
                Xác nhận đồng bộ số dư theo các dòng phiếu thanh toán hợp lệ
                trước khi đưa từng dòng vào sổ AR.
              </div>
            </div>
          )}

          {(modalMode === 'RECEIPT' ||
            modalMode === 'REFUND' ||
            modalMode === 'OPENING') && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
                gap: '10px',
              }}
            >
              <div>
                <label style={labelStyle}>Khách hàng trong danh mục</label>
                <select
                  aria-label="Chọn khách hàng"
                  style={inputStyle}
                  value={formCustomerId}
                  onChange={(e) => setFormCustomerId(e.target.value)}
                >
                  <option value="">-- Khách lẻ / Nhập tay --</option>
                  {activeCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {!formCustomerId && (
                <div>
                  <label style={labelStyle}>Tên khách hàng</label>
                  <input
                    aria-label="Tên khách hàng nhập tay"
                    style={inputStyle}
                    value={formCustomerName}
                    onChange={(e) => setFormCustomerName(e.target.value)}
                    placeholder="Nhập tên khách…"
                  />
                </div>
              )}
              <div>
                <label style={labelStyle}>Nhóm sổ công nợ</label>
                <select
                  aria-label="Nhóm sổ công nợ"
                  style={inputStyle}
                  value={formLedgerScope}
                  onChange={(e) =>
                    setFormLedgerScope(e.target.value as LedgerScopeType)
                  }
                >
                  <option value="GENERAL">Sổ chung (GENERAL)</option>
                  <option value="RIENG">Sổ RIÊNG</option>
                  <option value="HVGROUP">Sổ HVGROUP</option>
                </select>
              </div>
            </div>
          )}

          {(modalMode === 'ADJUSTMENT' ||
            (modalMode === 'REFUND' &&
              formRefundSource !== 'UNALLOCATED_ADVANCE')) && (
            <div>
              <label style={labelStyle}>Đơn hàng áp dụng *</label>
              <select
                aria-label="Chọn đơn hàng áp dụng"
                style={inputStyle}
                value={formTargetOrderId}
                onChange={(e) => setFormTargetOrderId(e.target.value)}
              >
                <option value="">-- Chọn đơn hàng --</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.order_code} — {o.customer_name || 'Khách lẻ'} (Còn thu:{' '}
                    {formatVnd(o.remaining_debt_amount)})
                  </option>
                ))}
              </select>
            </div>
          )}

          {modalMode === 'REFUND' && (
            <div>
              <label style={labelStyle}>Nguồn tiền hoàn trả</label>
              <select
                aria-label="Nguồn tiền hoàn trả"
                style={inputStyle}
                value={formRefundSource}
                onChange={(e) =>
                  setFormRefundSource(e.target.value as typeof formRefundSource)
                }
              >
                <option value="UNALLOCATED_ADVANCE">
                  Hoàn tiền dư / ứng trước chưa gán đơn
                </option>
                <option value="CANCELLED_ORDER">
                  Hoàn cọc đơn hủy (đã quyết toán hủy)
                </option>
                <option value="ORDER_OVERPAYMENT">
                  Hoàn tiền đơn thu dư sau giảm giá
                </option>
              </select>
            </div>
          )}

          {modalMode === 'ADJUSTMENT' && (
            <div>
              <label style={labelStyle}>Loại điều chỉnh</label>
              <select
                aria-label="Loại điều chỉnh phải thu"
                style={inputStyle}
                value={formAdjType}
                onChange={(e) =>
                  setFormAdjType(e.target.value as typeof formAdjType)
                }
              >
                <option value="DISCOUNT">
                  Giảm phải thu — Chiết khấu / Giảm giá
                </option>
                <option value="RETURN_CREDIT">
                  Giảm phải thu — Trừ hàng lỗi / Trả hàng
                </option>
                <option value="SURCHARGE">
                  Tăng phải thu — Phụ thu thỏa thuận
                </option>
              </select>
            </div>
          )}

          {(modalMode === 'RECEIPT' ||
            modalMode === 'REFUND' ||
            modalMode === 'ADJUSTMENT' ||
            modalMode === 'OPENING') && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
                gap: '10px',
              }}
            >
              <div>
                <label style={labelStyle}>Số tiền (VNĐ) *</label>
                <NumericDraftInput
                  ariaLabel="Số tiền giao dịch phải thu"
                  allowDecimal={false}
                  style={{ ...inputStyle, ...tabularNumStyle }}
                  value={formAmountInput}
                  onValueChange={setFormAmountInput}
                  placeholder="VD: 1500000"
                />
              </div>
              {(modalMode === 'RECEIPT' || modalMode === 'REFUND') && (
                <div>
                  <label style={labelStyle}>Mã chứng từ / UNC</label>
                  <input
                    aria-label="Mã tham chiếu chứng từ"
                    style={inputStyle}
                    value={formReferenceCode}
                    onChange={(e) => setFormReferenceCode(e.target.value)}
                    placeholder="VD: FT26308…"
                  />
                </div>
              )}
            </div>
          )}

          {(modalMode === 'RECEIPT' || modalMode === 'ALLOCATE') &&
            openOrders.length > 0 && (
              <div
                style={{
                  padding: '10px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  maxHeight: '190px',
                  overflowY: 'auto',
                }}
              >
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    marginBottom: '6px',
                  }}
                >
                  Phân bổ vào các đơn còn phải thu (để trống nếu giữ làm ứng
                  trước)
                </div>
                {openOrders
                  .filter((o: PrintOrderData) => o.remaining_debt_amount > 0)
                  .slice(0, 8)
                  .map((ord: PrintOrderData) => (
                    <div
                      key={ord.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                        padding: '4px 0',
                        fontSize: '12.5px',
                      }}
                    >
                      <span>
                        <strong>{ord.order_code}</strong> (Còn:{' '}
                        {formatVnd(ord.remaining_debt_amount)})
                      </span>
                      <div style={{ width: '135px' }}>
                        <NumericDraftInput
                          ariaLabel={`Phân bổ đơn ${ord.order_code}`}
                          allowDecimal={false}
                          style={{
                            ...inputStyle,
                            minHeight: '34px',
                            padding: '5px 8px',
                            ...tabularNumStyle,
                          }}
                          value={allocMap[ord.id] || ''}
                          onValueChange={(v) =>
                            setAllocMap((prev) => ({ ...prev, [ord.id]: v }))
                          }
                          placeholder="0"
                        />
                      </div>
                    </div>
                  ))}
              </div>
            )}

          {(modalMode === 'REFUND' ||
            modalMode === 'ADJUSTMENT' ||
            modalMode === 'VOID' ||
            modalMode === 'LEGACY_HOLD' ||
            modalMode === 'LEGACY_LINK_CUSTOMER' ||
            modalMode === 'LEGACY_RESOLVE_BALANCE') && (
            <div>
              <label style={labelStyle}>
                {modalMode === 'LEGACY_LINK_CUSTOMER'
                  ? 'Ghi chú đối chiếu'
                  : 'Lý do bắt buộc *'}
              </label>
              <input
                aria-label="Lý do thực hiện"
                style={inputStyle}
                required={modalMode !== 'LEGACY_LINK_CUSTOMER'}
                value={formReason}
                onChange={(e) => setFormReason(e.target.value)}
                placeholder="Ghi rõ căn cứ đối chiếu / thỏa thuận…"
              />
            </div>
          )}

          {(modalMode === 'RECEIPT' ||
            modalMode === 'ALLOCATE' ||
            modalMode === 'REFUND' ||
            modalMode === 'OPENING' ||
            modalMode === 'LEGACY_CONFIRM') && (
            <div>
              <label style={labelStyle}>Ghi chú</label>
              <input
                aria-label="Ghi chú giao dịch"
                style={inputStyle}
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                placeholder="Ghi chú nội bộ (không bắt buộc)…"
              />
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              marginTop: '4px',
            }}
          >
            <button
              type="button"
              className="pq-btn pq-btn-secondary"
              onClick={() => setModalMode(null)}
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="pq-btn pq-btn-primary"
            >
              <PqWalletIcon size={15} />
              <span>{submitting ? 'Đang lưu…' : 'Xác nhận lưu'}</span>
            </button>
          </div>
        </form>
      </CatalogModalDialog>
    </div>
  );
};
