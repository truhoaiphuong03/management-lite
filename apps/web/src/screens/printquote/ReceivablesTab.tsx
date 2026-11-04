import React, { useState, useMemo } from 'react';
import type {
  PrintCustomerData,
  PrintOrderData,
} from '../../../../../packages/contracts/src/printquote.js';
import type {
  CustomerReceivableSummaryItem,
  LedgerScopeType,
  PrintArAdjustmentData,
  PrintArTransactionData,
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

export const ReceivablesTab: React.FC<ReceivablesTabProps> = ({
  data,
  customers,
  orders,
  onMutateLedger,
}) => {
  const [scopeFilter, setScopeFilter] = useState<'ALL' | LedgerScopeType>(
    'ALL',
  );
  const [modalMode, setModalMode] = useState<
    null | 'RECEIPT' | 'ALLOCATE' | 'REFUND' | 'ADJUSTMENT' | 'OPENING' | 'VOID'
  >(null);
  const [selectedTx, setSelectedTx] = useState<PrintArTransactionData | null>(
    null,
  );
  const [formCustomerId, setFormCustomerId] = useState<string>('');
  const [formCustomerName, setFormCustomerName] = useState<string>('');
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
  const [submitting, setSubmitting] = useState<boolean>(false);

  const openOrders = useMemo(
    () =>
      orders.filter(
        (o: PrintOrderData) =>
          o.production_status !== 'CANCELLED' &&
          (scopeFilter === 'ALL' ||
            (o.ledger_scope || 'GENERAL') === scopeFilter) &&
          (!formCustomerId || o.customer_id === formCustomerId),
      ),
    [orders, scopeFilter, formCustomerId],
  );

  const filteredCustomers = useMemo(
    () =>
      (data?.summaries ?? []).filter(
        (c: CustomerReceivableSummaryItem) =>
          scopeFilter === 'ALL' || c.ledger_scope === scopeFilter,
      ),
    [data, scopeFilter],
  );

  const unallocatedReceipts = useMemo(
    () =>
      (data?.transactions ?? []).filter(
        (tx: PrintArTransactionData) =>
          tx.status === 'POSTED' &&
          tx.tx_kind === 'RECEIPT' &&
          tx.unallocated_amount > 0 &&
          (scopeFilter === 'ALL' || tx.ledger_scope === scopeFilter),
      ),
    [data, scopeFilter],
  );

  const totals = useMemo(() => {
    let valid = 0;
    let settled = 0;
    let remaining = 0;
    let advance = 0;
    let cancelledHolding = 0;
    for (const c of filteredCustomers) {
      valid += c.valid_receivable_total;
      settled += c.net_allocated_receipt_total;
      remaining += c.remaining_receivable_total;
      advance += c.unallocated_credit_total;
      cancelledHolding += c.cancelled_holding_pending_total;
    }
    return { valid, settled, remaining, advance, cancelledHolding };
  }, [filteredCustomers]);

  const resetForm = () => {
    setFormCustomerId('');
    setFormCustomerName('');
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
  };

  const openModal = (mode: NonNullable<typeof modalMode>) => {
    resetForm();
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
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="panel-pq-receivables"
      style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
    >
      <div className="pq-page-head">
        <div>
          <h1 className="pq-page-title">Công nợ khách hàng</h1>
          <p className="pq-page-subtitle">
            Theo dõi phải thu hợp lệ, thu nhiều đợt, tiền ứng trước chưa gán đơn
            và hoàn tiền (chỉ thuộc phân hệ In ấn)
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <button
            type="button"
            data-testid="pq-ar-new-receipt-btn"
            className="pq-btn pq-btn-primary"
            onClick={() => openModal('RECEIPT')}
          >
            <PqPlusIcon size={15} />
            <span>Thu tiền khách</span>
          </button>
          <button
            type="button"
            data-testid="pq-ar-adjustment-btn"
            className="pq-btn pq-btn-secondary"
            onClick={() => openModal('ADJUSTMENT')}
          >
            <span>Điều chỉnh công nợ</span>
          </button>
          <button
            type="button"
            data-testid="pq-ar-refund-btn"
            className="pq-btn pq-btn-secondary"
            onClick={() => openModal('REFUND')}
          >
            <span>Hoàn tiền</span>
          </button>
          <button
            type="button"
            data-testid="pq-ar-opening-btn"
            className="pq-btn pq-btn-ghost"
            onClick={() => openModal('OPENING')}
          >
            <span>+ Dư đầu kỳ</span>
          </button>
        </div>
      </div>

      {/* Scope Filter Pills */}
      <div className="pq-filter-pills" role="group" aria-label="Lọc nhóm sổ">
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

      {/* KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: '12px',
        }}
      >
        <div className="pq-stat-card" data-testid="pq-ar-kpi-remaining">
          <div className="pq-stat-label">Còn phải thu hợp lệ</div>
          <div
            className="pq-stat-value"
            style={{ ...tabularNumStyle, color: 'var(--danger-text)' }}
          >
            {formatVnd(totals.remaining)}
          </div>
          <div className="pq-stat-sub">
            Phải thu hợp lệ: {formatVnd(totals.valid)}
          </div>
        </div>

        <div className="pq-stat-card" data-testid="pq-ar-kpi-collected">
          <div className="pq-stat-label">Thu ròng đã phân bổ</div>
          <div
            className="pq-stat-value"
            style={{ ...tabularNumStyle, color: 'var(--success-text)' }}
          >
            {formatVnd(totals.settled)}
          </div>
          <div className="pq-stat-sub">Đã gán vào đơn hàng / đầu kỳ</div>
        </div>

        <div className="pq-stat-card" data-testid="pq-ar-kpi-advance">
          <div className="pq-stat-label">Tiền dư / Ứng trước khách</div>
          <div
            className="pq-stat-value"
            style={{ ...tabularNumStyle, color: 'var(--accent-text)' }}
          >
            {formatVnd(totals.advance)}
          </div>
          <div className="pq-stat-sub">
            {unallocatedReceipts.length} phiếu thu còn số dư chưa gán
          </div>
        </div>

        <div className="pq-stat-card">
          <div className="pq-stat-label">Tiền đang giữ trên đơn hủy</div>
          <div className="pq-stat-value" style={tabularNumStyle}>
            {formatVnd(totals.cancelledHolding)}
          </div>
          <div className="pq-stat-sub">Chờ quyết toán hoàn / giữ phí hủy</div>
        </div>
      </div>

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
                  <th style={{ textAlign: 'right' }}>Thu ròng đã gán</th>
                  <th style={{ textAlign: 'right' }}>Còn phải thu</th>
                  <th style={{ textAlign: 'right' }}>Tiền dư / Ứng trước</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.map((row: CustomerReceivableSummaryItem) => (
                  <tr key={`${row.customer_key}-${row.ledger_scope}`}>
                    <td style={{ fontWeight: 700 }}>{row.customer_name}</td>
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
                        fontWeight: 700,
                        color:
                          row.remaining_receivable_total > 0
                            ? 'var(--danger-text)'
                            : 'var(--success-text)',
                        ...tabularNumStyle,
                      }}
                    >
                      {formatVnd(row.remaining_receivable_total)}
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
                  {customers.map((c) => (
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

          {modalMode !== 'ALLOCATE' && modalMode !== 'VOID' && (
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
                    placeholder="VD: FT26308..."
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
            modalMode === 'VOID') && (
            <div>
              <label style={labelStyle}>Lý do bắt buộc *</label>
              <input
                aria-label="Lý do thực hiện"
                style={inputStyle}
                required
                value={formReason}
                onChange={(e) => setFormReason(e.target.value)}
                placeholder="Ghi rõ căn cứ / thỏa thuận với khách…"
              />
            </div>
          )}

          {modalMode !== 'ADJUSTMENT' && modalMode !== 'VOID' && (
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
