import React, { useState, useMemo, useEffect } from 'react';
import { StatusBadge } from '../../../../../packages/ui/src/components/index.js';
import {
  PrintProductionStatus,
  PrintDeliveryStatus,
  OrderCostReconciliationStatus,
  type PrintProductionStatusType,
  type PrintDeliveryStatusType,
  type PrintOrderData,
  type OrderCostHistoryActionType,
} from '../../../../../packages/contracts/src/printquote.js';
import {
  formatVnd,
  parseNumericDraftValue,
  PRODUCTION_STATUS_LABELS,
  DELIVERY_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
} from '../helpers/printquote-helpers.js';
import { cardStyle, inputStyle, labelStyle, tabularNumStyle } from './types.js';
import { NumericDraftInput } from './NumericDraftInput.js';
import { CatalogModalDialog } from './CatalogModalDialog.js';
import {
  PqPackageIcon,
  PqSearchIcon,
  PqWalletIcon,
} from './PrintQuoteIcons.js';

export interface OrdersTabProps {
  orders: PrintOrderData[];
  onUpdateOrderField: (
    orderId: string,
    patch: Record<string, unknown>,
  ) => void | Promise<boolean>;
  paymentOrderTarget: PrintOrderData | null;
  setPaymentOrderTarget: (ord: PrintOrderData | null) => void;
  paymentAmount: number;
  setPaymentAmount: (v: number) => void;
  paymentType: 'DEPOSIT' | 'INSTALLMENT' | 'FINAL' | 'REFUND';
  setPaymentType: (v: 'DEPOSIT' | 'INSTALLMENT' | 'FINAL' | 'REFUND') => void;
  paymentMethod: string;
  setPaymentMethod: (v: string) => void;
  paymentNote: string;
  setPaymentNote: (v: string) => void;
  onRecordPayment: (e: React.FormEvent) => void;
}

type OrderFilterMode =
  | 'ALL'
  | 'IN_PROD'
  | 'PENDING_DELIVERY'
  | 'HAS_DEBT'
  | 'NEEDS_COST_REVIEW'
  | 'CANCELLED_OBLIGATIONS';

const HISTORY_ACTION_LABELS: Record<OrderCostHistoryActionType, string> = {
  ENTERED: 'Nhập nháp chi phí',
  CONFIRMED: 'Xác nhận chi phí thực tế',
  ADJUSTED: 'Điều chỉnh chi phí xác nhận',
  UNCONFIRMED: 'Bỏ xác nhận (mở rà soát lại)',
  VENDOR_PAYMENT_NOTE: 'Cập nhật ghi chú chi xưởng',
};

function hasCancelledObligation(ord: PrintOrderData): boolean {
  if (ord.production_status !== 'CANCELLED') return false;
  const enteredSum =
    (ord.entered_vendor_cost ?? 0) +
    (ord.entered_shipping_fee ?? 0) +
    (ord.entered_extra_cost ?? 0);
  const confirmedSum = ord.actual_cost_confirmed
    ? (ord.actual_vendor_cost ?? 0) +
      (ord.actual_shipping_fee ?? 0) +
      (ord.actual_extra_cost ?? 0)
    : 0;
  return (
    ord.total_paid_amount > 0 ||
    (ord.vendor_paid_amount ?? 0) > 0 ||
    confirmedSum > 0 ||
    enteredSum > 0
  );
}

export const OrdersTab: React.FC<OrdersTabProps> = ({
  orders,
  onUpdateOrderField,
  paymentOrderTarget,
  setPaymentOrderTarget,
  paymentAmount,
  setPaymentAmount,
  paymentType,
  setPaymentType,
  paymentMethod,
  setPaymentMethod,
  paymentNote,
  setPaymentNote,
  onRecordPayment,
}) => {
  const [filterMode, setFilterMode] = useState<OrderFilterMode>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [paymentAmountInput, setPaymentAmountInput] = useState<string>(
    paymentAmount > 0 ? String(paymentAmount) : '',
  );
  const [costOrderTarget, setCostOrderTarget] = useState<PrintOrderData | null>(
    null,
  );
  const [actualVendorCostInput, setActualVendorCostInput] =
    useState<string>('');
  const [actualShippingInput, setActualShippingInput] = useState<string>('');
  const [actualExtraInput, setActualExtraInput] = useState<string>('');
  const [vendorPaidInput, setVendorPaidInput] = useState<string>('0');
  const [costNoteInput, setCostNoteInput] = useState<string>('');
  const [costModalError, setCostModalError] = useState<string>('');

  useEffect(() => {
    if (paymentOrderTarget) {
      setPaymentAmountInput(paymentAmount > 0 ? String(paymentAmount) : '');
    }
  }, [paymentOrderTarget, paymentAmount]);

  const openConfirmActualCostModal = (ord: PrintOrderData) => {
    setCostOrderTarget(ord);
    // Never pre-fill expected_* into actual cost inputs when unconfirmed!
    setActualVendorCostInput(
      ord.entered_vendor_cost !== null && ord.entered_vendor_cost !== undefined
        ? String(ord.entered_vendor_cost)
        : ord.actual_cost_confirmed && ord.actual_vendor_cost !== null
          ? String(ord.actual_vendor_cost)
          : '',
    );
    setActualShippingInput(
      ord.entered_shipping_fee !== null &&
        ord.entered_shipping_fee !== undefined
        ? String(ord.entered_shipping_fee)
        : ord.actual_cost_confirmed && ord.actual_shipping_fee !== null
          ? String(ord.actual_shipping_fee)
          : '',
    );
    setActualExtraInput(
      ord.entered_extra_cost !== null && ord.entered_extra_cost !== undefined
        ? String(ord.entered_extra_cost)
        : ord.actual_cost_confirmed && ord.actual_extra_cost !== null
          ? String(ord.actual_extra_cost)
          : '',
    );
    setVendorPaidInput(String(ord.vendor_paid_amount ?? 0));
    setCostNoteInput('');
    setCostModalError('');
  };

  const parseOptionalIntegerInput = (
    raw: string,
    label: string,
  ): { ok: boolean; value: number | null; error?: string } => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      return { ok: true, value: null };
    }
    const parsed = parseNumericDraftValue(trimmed, {
      allowDecimal: false,
      min: 0,
      integerOnly: true,
    });
    if (!parsed.isValid || parsed.value === null) {
      return {
        ok: false,
        value: null,
        error: `${label} phải là số nguyên không âm (VNĐ).`,
      };
    }
    return { ok: true, value: parsed.value };
  };

  const submitCostUpdate = async (
    mode: 'SAVE_DRAFT' | 'CONFIRM' | 'UNCONFIRM',
  ) => {
    if (!costOrderTarget) return;
    setCostModalError('');

    const vPaid = parseNumericDraftValue(vendorPaidInput.trim() || '0', {
      allowDecimal: false,
      min: 0,
      integerOnly: true,
    });
    if (!vPaid.isValid || vPaid.value === null) {
      setCostModalError(
        'Ghi chú tổng tiền đã chi xưởng phải là số nguyên không âm (VNĐ).',
      );
      return;
    }

    if (mode === 'UNCONFIRM') {
      const res = await onUpdateOrderField(costOrderTarget.id, {
        actual_cost_confirmed: false,
        vendor_paid_amount: vPaid.value,
        cost_note:
          costNoteInput.trim() || 'Bỏ xác nhận chi phí để kiểm tra lại',
      });
      if (res !== false) {
        setCostOrderTarget(null);
      }
      return;
    }

    const vCost = parseOptionalIntegerInput(
      actualVendorCostInput,
      'Chi phí nhà in + gia công thực tế',
    );
    if (!vCost.ok) {
      setCostModalError(vCost.error || 'Dữ liệu không hợp lệ.');
      return;
    }
    const vShip = parseOptionalIntegerInput(
      actualShippingInput,
      'Phí giao hàng thực tế',
    );
    if (!vShip.ok) {
      setCostModalError(vShip.error || 'Dữ liệu không hợp lệ.');
      return;
    }
    const vExtra = parseOptionalIntegerInput(
      actualExtraInput,
      'Phí phát sinh thực tế',
    );
    if (!vExtra.ok) {
      setCostModalError(vExtra.error || 'Dữ liệu không hợp lệ.');
      return;
    }

    if (
      mode === 'CONFIRM' &&
      (vCost.value === null || vShip.value === null || vExtra.value === null)
    ) {
      setCostModalError(
        'Cần nhập đủ cả 3 khoản (Chi phí nhà in, Phí giao hàng thực tế và Phí phát sinh; nhập 0 nếu không phát sinh) trước khi xác nhận. Hệ thống không tự lấy chi phí dự kiến cho khoản bỏ trống.',
      );
      return;
    }

    const res = await onUpdateOrderField(costOrderTarget.id, {
      ...(mode === 'CONFIRM' ? { actual_cost_confirmed: true } : {}),
      entered_vendor_cost: vCost.value,
      entered_shipping_fee: vShip.value,
      entered_extra_cost: vExtra.value,
      vendor_paid_amount: vPaid.value,
      cost_note: costNoteInput.trim() || null,
    });
    if (res !== false) {
      setCostOrderTarget(null);
    }
  };

  const handleConfirmActualCostSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitCostUpdate('CONFIRM');
  };

  const needsReviewCount = useMemo(
    () =>
      orders.filter(
        (o) =>
          !o.actual_cost_confirmed &&
          (o.cost_reconciliation_status ===
            OrderCostReconciliationStatus.NEEDS_REVIEW ||
            o.cost_reconciliation_status ===
              OrderCostReconciliationStatus.PARTIAL_ENTERED ||
            o.cost_reconciliation_status ===
              OrderCostReconciliationStatus.ENTERED_UNCONFIRMED),
      ).length,
    [orders],
  );

  const cancelledObligationCount = useMemo(
    () => orders.filter(hasCancelledObligation).length,
    [orders],
  );

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((ord) => {
      if (
        filterMode === 'IN_PROD' &&
        (ord.production_status === 'COMPLETED' ||
          ord.production_status === 'CANCELLED')
      ) {
        return false;
      }
      if (
        filterMode === 'PENDING_DELIVERY' &&
        (ord.production_status === 'CANCELLED' ||
          ord.delivery_status === 'DELIVERED' ||
          ord.delivery_status === 'RETURNED')
      ) {
        return false;
      }
      if (
        filterMode === 'HAS_DEBT' &&
        (ord.production_status === 'CANCELLED' ||
          ord.remaining_debt_amount <= 0)
      ) {
        return false;
      }
      if (
        filterMode === 'NEEDS_COST_REVIEW' &&
        (ord.actual_cost_confirmed ||
          (ord.cost_reconciliation_status !==
            OrderCostReconciliationStatus.NEEDS_REVIEW &&
            ord.cost_reconciliation_status !==
              OrderCostReconciliationStatus.PARTIAL_ENTERED &&
            ord.cost_reconciliation_status !==
              OrderCostReconciliationStatus.ENTERED_UNCONFIRMED))
      ) {
        return false;
      }
      if (
        filterMode === 'CANCELLED_OBLIGATIONS' &&
        !hasCancelledObligation(ord)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        ord.order_code.toLowerCase().includes(q) ||
        (ord.customer_name || '').toLowerCase().includes(q) ||
        (ord.quote_code || '').toLowerCase().includes(q)
      );
    });
  }, [orders, filterMode, searchQuery]);

  const filterButtons: Array<{
    id: OrderFilterMode;
    label: string;
    count: number;
  }> = [
    { id: 'ALL', label: 'Tất cả', count: orders.length },
    {
      id: 'IN_PROD',
      label: 'Đang in',
      count: orders.filter(
        (o) =>
          o.production_status !== 'COMPLETED' &&
          o.production_status !== 'CANCELLED',
      ).length,
    },
    {
      id: 'PENDING_DELIVERY',
      label: 'Chờ giao',
      count: orders.filter(
        (o) =>
          o.production_status !== 'CANCELLED' &&
          o.delivery_status !== 'DELIVERED' &&
          o.delivery_status !== 'RETURNED',
      ).length,
    },
    {
      id: 'HAS_DEBT',
      label: 'Còn nợ',
      count: orders.filter(
        (o) =>
          o.production_status !== 'CANCELLED' && o.remaining_debt_amount > 0,
      ).length,
    },
    ...(needsReviewCount > 0
      ? [
          {
            id: 'NEEDS_COST_REVIEW' as const,
            label: 'Cần kiểm tra chi phí',
            count: needsReviewCount,
          },
        ]
      : []),
    ...(cancelledObligationCount > 0
      ? [
          {
            id: 'CANCELLED_OBLIGATIONS' as const,
            label: 'Đơn hủy còn nghĩa vụ',
            count: cancelledObligationCount,
          },
        ]
      : []),
  ];

  const renderUnconfirmedCostText = (ord: PrintOrderData) => {
    const status = ord.cost_reconciliation_status;
    if (status === OrderCostReconciliationStatus.PARTIAL_ENTERED) {
      const parts: string[] = [];
      if (
        ord.entered_vendor_cost !== null &&
        ord.entered_vendor_cost !== undefined
      ) {
        parts.push(`Vốn: ${formatVnd(ord.entered_vendor_cost)}`);
      }
      if (
        ord.entered_shipping_fee !== null &&
        ord.entered_shipping_fee !== undefined
      ) {
        parts.push(`Ship: ${formatVnd(ord.entered_shipping_fee)}`);
      }
      if (
        ord.entered_extra_cost !== null &&
        ord.entered_extra_cost !== undefined
      ) {
        parts.push(`Phát sinh: ${formatVnd(ord.entered_extra_cost)}`);
      }
      return (
        <span style={{ color: 'var(--warning-text, var(--muted-color))' }}>
          Chi phí thực tế:{' '}
          <strong>
            Đã nhập một phần ({parts.join(' · ')}) — Chưa xác nhận từ xưởng
          </strong>
        </span>
      );
    }
    if (status === OrderCostReconciliationStatus.ENTERED_UNCONFIRMED) {
      const enteredTotal =
        (ord.entered_vendor_cost ?? 0) +
        (ord.entered_shipping_fee ?? 0) +
        (ord.entered_extra_cost ?? 0);
      return (
        <span style={{ color: 'var(--warning-text, var(--muted-color))' }}>
          Chi phí thực tế:{' '}
          <strong>
            Đã nhập nháp {formatVnd(enteredTotal)} — Chưa xác nhận từ xưởng
          </strong>
        </span>
      );
    }
    if (status === OrderCostReconciliationStatus.NEEDS_REVIEW) {
      return (
        <span style={{ color: 'var(--danger-text)' }}>
          Chi phí thực tế:{' '}
          <strong>Cần rà soát lại — Chưa xác nhận từ xưởng</strong>
        </span>
      );
    }
    return (
      <span style={{ color: 'var(--muted-color)' }}>
        Chi phí thực tế: <strong>Chưa xác nhận từ xưởng</strong>
      </span>
    );
  };

  return (
    <div
      data-testid="panel-orders"
      style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      <div className="pq-page-head">
        <div>
          <h1 className="pq-page-title">Đơn hàng đặt in ({orders.length})</h1>
          <p className="pq-page-subtitle">
            Theo dõi tiến độ xưởng in, giao hàng, thu tiền khách và đối soát chi
            phí thực tế
          </p>
        </div>
      </div>

      {/* Unified Search & Filter Bar */}
      <div className="pq-toolbar-card">
        <div className="pq-search-wrap">
          <PqSearchIcon size={15} className="pq-search-icon" />
          <input
            type="search"
            aria-label="Tìm kiếm đơn hàng"
            style={{ ...inputStyle, paddingLeft: '36px', minHeight: '40px' }}
            placeholder="Tìm mã đơn, tên khách hoặc mã báo giá…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div
          className="pq-filter-pills"
          role="group"
          aria-label="Lọc trạng thái đơn hàng"
        >
          {filterButtons.map((btn) => {
            const active = filterMode === btn.id;
            return (
              <button
                key={btn.id}
                type="button"
                aria-pressed={active}
                className="pq-filter-pill"
                data-active={active ? 'true' : 'false'}
                onClick={() => setFilterMode(btn.id)}
              >
                <span>{btn.label}</span>
                <span className="pq-filter-pill-count">{btn.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {filteredOrders.length === 0 ? (
        <div
          style={{
            ...cardStyle,
            padding: '40px 24px',
            textAlign: 'center',
          }}
        >
          {orders.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                maxWidth: '420px',
                margin: '0 auto',
              }}
            >
              <div className="pq-empty-icon-ring">
                <PqPackageIcon size={24} />
              </div>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>
                Chưa có đơn hàng đặt in
              </div>
              <div style={{ color: 'var(--muted-color)', fontSize: '13px' }}>
                Khi khách chốt báo giá, hãy nhấn{' '}
                <strong>Chuyển thành Đơn đặt in</strong> từ danh sách hoặc chi
                tiết báo giá.
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--muted-color)', fontSize: '13.5px' }}>
              Không có đơn hàng nào khớp bộ lọc hiện tại.
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredOrders.map((ord) => {
            const isCancelled = ord.production_status === 'CANCELLED';
            const cancelledHasObligation = hasCancelledObligation(ord);
            return (
              <article
                key={ord.id}
                data-testid={`order-card-${ord.order_code}`}
                className="pq-quote-card"
              >
                <div className="pq-quote-card-top">
                  <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span className="pq-code-pill">{ord.order_code}</span>
                      <StatusBadge
                        status={
                          ord.production_status === 'COMPLETED'
                            ? 'success'
                            : ord.production_status === 'CANCELLED'
                              ? 'error'
                              : 'neutral'
                        }
                        label={`SX: ${PRODUCTION_STATUS_LABELS[ord.production_status]}`}
                      />
                      <StatusBadge
                        status={
                          ord.delivery_status === 'DELIVERED'
                            ? 'success'
                            : 'warning'
                        }
                        label={`Giao: ${DELIVERY_STATUS_LABELS[ord.delivery_status]}`}
                      />
                      <StatusBadge
                        status={
                          ord.payment_status === 'PAID'
                            ? 'success'
                            : ord.remaining_debt_amount > 0 && !isCancelled
                              ? 'error'
                              : 'muted'
                        }
                        label={PAYMENT_STATUS_LABELS[ord.payment_status]}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: '13px',
                        color: 'var(--muted-color)',
                        marginTop: '6px',
                      }}
                    >
                      Khách hàng:{' '}
                      <strong style={{ color: 'var(--text-color)' }}>
                        {ord.customer_name || 'Khách lẻ'}
                      </strong>{' '}
                      • Báo giá gốc: {ord.quote_code || '—'} (v
                      {ord.quote_version})
                    </div>
                  </div>

                  <div className="pq-quote-metrics">
                    <div className="pq-metric-cell">
                      <span className="pq-metric-label">Tổng tiền đơn</span>
                      <strong className="pq-metric-val" style={tabularNumStyle}>
                        {formatVnd(ord.total_quote_amount)}
                      </strong>
                    </div>
                    <div className="pq-metric-cell">
                      <span className="pq-metric-label">Đã thu</span>
                      <strong
                        className="pq-metric-val"
                        style={{
                          ...tabularNumStyle,
                          color: 'var(--success-text)',
                        }}
                      >
                        {formatVnd(ord.total_paid_amount)}
                      </strong>
                    </div>
                    <div className="pq-metric-cell">
                      <span className="pq-metric-label">
                        {isCancelled ? 'Trạng thái hủy' : 'Còn nợ'}
                      </span>
                      <strong
                        className="pq-metric-val"
                        style={{
                          ...tabularNumStyle,
                          color: isCancelled
                            ? 'var(--muted-color)'
                            : ord.remaining_debt_amount > 0
                              ? 'var(--danger-text)'
                              : 'var(--success-text)',
                        }}
                      >
                        {isCancelled
                          ? 'Đơn đã hủy'
                          : formatVnd(ord.remaining_debt_amount)}
                      </strong>
                    </div>
                    <div className="pq-metric-cell pq-metric-cell-total">
                      <span className="pq-metric-label">Lời dự kiến (BG)</span>
                      <strong
                        className="pq-metric-total-val"
                        style={{
                          ...tabularNumStyle,
                          color: 'var(--success-text)',
                        }}
                      >
                        {formatVnd(ord.expected_profit)}
                      </strong>
                    </div>
                  </div>
                </div>

                {cancelledHasObligation && (
                  <div
                    data-testid={`pq-order-cancelled-obligation-${ord.order_code}`}
                    style={{
                      marginTop: '10px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--danger-text)',
                      fontSize: '12px',
                      color: 'var(--danger-text)',
                      ...tabularNumStyle,
                    }}
                  >
                    <strong>Đơn đã hủy còn nghĩa vụ cần xử lý riêng:</strong>{' '}
                    Tiền khách đang giữ:{' '}
                    <strong>{formatVnd(ord.total_paid_amount)}</strong> • Ghi
                    chú tổng đã chi xưởng:{' '}
                    <strong>{formatVnd(ord.vendor_paid_amount ?? 0)}</strong>
                    {ord.actual_cost_confirmed && (
                      <>
                        {' '}
                        • Chi phí phát sinh xác nhận:{' '}
                        <strong>
                          {formatVnd(
                            (ord.actual_vendor_cost ?? 0) +
                              (ord.actual_shipping_fee ?? 0) +
                              (ord.actual_extra_cost ?? 0),
                          )}
                        </strong>
                      </>
                    )}
                  </div>
                )}

                {/* Financial Separation Strip: Expected vs Entered vs Confirmed Actual vs Order-Level Vendor Paid Note */}
                <div
                  data-testid={`pq-order-financial-tiers-${ord.order_code}`}
                  style={{
                    marginTop: '10px',
                    padding: '8px 12px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '10px',
                    fontSize: '12px',
                    ...tabularNumStyle,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '12px',
                      alignItems: 'center',
                    }}
                  >
                    <span>
                      Vốn dự kiến:{' '}
                      <strong>{formatVnd(ord.expected_vendor_cost)}</strong>
                    </span>
                    <span>•</span>
                    {ord.actual_cost_confirmed && ord.actual_profit !== null ? (
                      <span style={{ color: 'var(--text-color)' }}>
                        Chi phí thực tế đã xác nhận:{' '}
                        <strong>
                          {formatVnd(
                            (ord.actual_vendor_cost ?? 0) +
                              (ord.actual_shipping_fee ?? 0) +
                              (ord.actual_extra_cost ?? 0),
                          )}
                        </strong>{' '}
                        (Lời TT:{' '}
                        <strong style={{ color: 'var(--success-text)' }}>
                          {formatVnd(ord.actual_profit)}
                        </strong>
                        )
                      </span>
                    ) : (
                      renderUnconfirmedCostText(ord)
                    )}
                    <span>•</span>
                    <span title="Ghi chú tổng tiền đã chi cấp đơn — chưa tách sổ công nợ hoặc phiếu chi theo từng xưởng">
                      Thực chi xưởng (ghi chú cấp đơn — chưa tách sổ công nợ):{' '}
                      <strong>{formatVnd(ord.vendor_paid_amount ?? 0)}</strong>
                    </span>
                  </div>

                  <button
                    type="button"
                    data-testid={`pq-order-confirm-cost-${ord.order_code}`}
                    onClick={() => openConfirmActualCostModal(ord)}
                    className="pq-btn pq-btn-secondary pq-btn-sm"
                  >
                    <span>
                      {ord.actual_cost_confirmed
                        ? 'Điều chỉnh / Bỏ xác nhận'
                        : 'Xác nhận chi phí thực tế'}
                    </span>
                  </button>
                </div>

                {/* Independent Production & Delivery Status Controls */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fit, minmax(min(100%, 185px), 1fr))',
                    gap: '12px',
                    marginTop: '14px',
                    paddingTop: '14px',
                    borderTop: '1px solid var(--border-color)',
                  }}
                >
                  <div>
                    <label style={labelStyle}>Ngày gửi nhà in</label>
                    <input
                      aria-label={`Ngày đặt in ${ord.order_code}`}
                      type="date"
                      style={inputStyle}
                      value={ord.print_ordered_at || ''}
                      onChange={(e) =>
                        void onUpdateOrderField(ord.id, {
                          print_ordered_at: e.target.value || null,
                        })
                      }
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>Tiến độ in ấn</label>
                    <select
                      aria-label={`Trạng thái sản xuất ${ord.order_code}`}
                      style={inputStyle}
                      value={ord.production_status}
                      onChange={(e) =>
                        void onUpdateOrderField(ord.id, {
                          production_status: e.target
                            .value as PrintProductionStatusType,
                        })
                      }
                    >
                      {Object.entries(PrintProductionStatus).map(([, val]) => (
                        <option key={val} value={val}>
                          {PRODUCTION_STATUS_LABELS[val]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={labelStyle}>Tiến độ giao hàng</label>
                    <select
                      aria-label={`Trạng thái giao hàng ${ord.order_code}`}
                      style={inputStyle}
                      value={ord.delivery_status}
                      onChange={(e) =>
                        void onUpdateOrderField(ord.id, {
                          delivery_status: e.target
                            .value as PrintDeliveryStatusType,
                        })
                      }
                    >
                      {Object.entries(PrintDeliveryStatus).map(([, val]) => (
                        <option key={val} value={val}>
                          {DELIVERY_STATUS_LABELS[val]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button
                      type="button"
                      data-testid={`pq-order-record-payment-${ord.order_code}`}
                      onClick={() => {
                        setPaymentOrderTarget(ord);
                        if (isCancelled) {
                          setPaymentAmount(ord.total_paid_amount || 0);
                          setPaymentType('REFUND');
                        } else {
                          setPaymentAmount(ord.remaining_debt_amount || 0);
                          setPaymentType(
                            ord.total_paid_amount === 0 ? 'DEPOSIT' : 'FINAL',
                          );
                        }
                      }}
                      className="pq-btn pq-btn-primary"
                      style={{ width: '100%' }}
                    >
                      <PqWalletIcon size={15} />
                      <span>
                        {isCancelled
                          ? 'Hoàn tiền khách (Đơn hủy)'
                          : 'Ghi nhận thanh toán'}
                      </span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Record Payment Modal */}
      <CatalogModalDialog
        open={paymentOrderTarget !== null}
        ariaLabel="Ghi nhận thanh toán đơn hàng"
        title={
          paymentOrderTarget
            ? paymentOrderTarget.production_status === 'CANCELLED'
              ? `Hoàn tiền khách — Đơn hủy ${paymentOrderTarget.order_code}`
              : `Thu tiền / Đặt cọc — Đơn ${paymentOrderTarget.order_code}`
            : 'Ghi nhận thanh toán đơn hàng'
        }
        subtitle={
          paymentOrderTarget?.production_status === 'CANCELLED'
            ? 'Đơn đã hủy chỉ cho phép ghi nhận Hoàn tiền (REFUND) để tất toán số tiền khách đã đóng.'
            : 'Ghi nhận tiền đặt cọc hoặc thanh toán từng đợt của khách hàng.'
        }
        maxWidth="460px"
        onClose={() => setPaymentOrderTarget(null)}
      >
        <form
          onSubmit={onRecordPayment}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div>
            <label style={labelStyle}>Loại thanh toán</label>
            <select
              aria-label="Loại thanh toán"
              style={inputStyle}
              value={paymentType}
              onChange={(e) =>
                setPaymentType(
                  e.target.value as
                    'DEPOSIT' | 'INSTALLMENT' | 'FINAL' | 'REFUND',
                )
              }
            >
              {paymentOrderTarget?.production_status !== 'CANCELLED' && (
                <>
                  <option value="DEPOSIT">Tiền đặt cọc (Deposit)</option>
                  <option value="INSTALLMENT">Thanh toán đợt</option>
                  <option value="FINAL">Tất toán công nợ cuối</option>
                </>
              )}
              <option value="REFUND">Hoàn tiền (Refund)</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>
              {paymentType === 'REFUND'
                ? 'Số tiền hoàn trả khách (VNĐ) *'
                : 'Số tiền thu (VNĐ) *'}
            </label>
            <NumericDraftInput
              ariaLabel="Số tiền thanh toán"
              allowDecimal={false}
              placeholder="VD: 50000"
              style={inputStyle}
              required
              value={paymentAmountInput}
              onValueChange={(nextRaw) => {
                setPaymentAmountInput(nextRaw);
                const parsed = parseNumericDraftValue(nextRaw, {
                  allowDecimal: false,
                  min: 0,
                  integerOnly: true,
                });
                setPaymentAmount(
                  parsed.isValid && parsed.value !== null ? parsed.value : 0,
                );
              }}
            />
          </div>

          <div>
            <label style={labelStyle}>Phương thức</label>
            <select
              aria-label="Phương thức thanh toán"
              style={inputStyle}
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="BANK_TRANSFER">Chuyển khoản Ngân hàng</option>
              <option value="QR_VIETQR">Quét mã VietQR</option>
              <option value="CASH">Tiền mặt</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Ghi chú giao dịch</label>
            <input
              aria-label="Ghi chú thanh toán"
              style={inputStyle}
              value={paymentNote}
              onChange={(e) => setPaymentNote(e.target.value)}
              placeholder="VD: Khách CK cọc 50% đơn in…"
            />
          </div>

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
              onClick={() => setPaymentOrderTarget(null)}
              className="pq-btn pq-btn-secondary"
            >
              Hủy
            </button>
            <button type="submit" className="pq-btn pq-btn-primary">
              {paymentOrderTarget?.production_status === 'CANCELLED'
                ? 'Xác nhận hoàn tiền'
                : 'Xác nhận thu tiền'}
            </button>
          </div>
        </form>
      </CatalogModalDialog>

      {/* Confirm / Save Draft / Unconfirm Actual Cost Modal */}
      <CatalogModalDialog
        open={costOrderTarget !== null}
        ariaLabel="Xác nhận chi phí thực tế xưởng"
        title={
          costOrderTarget
            ? `Đối soát chi phí thực tế — ${costOrderTarget.order_code}`
            : 'Xác nhận chi phí thực tế'
        }
        subtitle="Tách rõ Dự kiến, Đã nhập nháp và Đã xác nhận. Không tự lấy số dự kiến cho khoản chưa kiểm tra."
        maxWidth="520px"
        onClose={() => setCostOrderTarget(null)}
      >
        <form
          onSubmit={handleConfirmActualCostSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          {costOrderTarget && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-color)',
                fontSize: '12px',
                ...tabularNumStyle,
              }}
            >
              <div>
                Tham chiếu dự kiến lúc báo giá: Vốn{' '}
                <strong>
                  {formatVnd(costOrderTarget.expected_vendor_cost)}
                </strong>{' '}
                • Ship{' '}
                <strong>
                  {formatVnd(costOrderTarget.expected_shipping_fee)}
                </strong>{' '}
                • Phát sinh{' '}
                <strong>
                  {formatVnd(costOrderTarget.expected_extra_cost)}
                </strong>{' '}
                • Lời dự kiến{' '}
                <strong style={{ color: 'var(--success-text)' }}>
                  {formatVnd(costOrderTarget.expected_profit)}
                </strong>
              </div>
              {costOrderTarget.legacy_raw_actual_costs && (
                <div style={{ marginTop: '4px', color: 'var(--muted-color)' }}>
                  Số ghi nhận cũ trước nâng cấp (chưa có bằng chứng xác nhận):
                  Vốn{' '}
                  {formatVnd(
                    costOrderTarget.legacy_raw_actual_costs.vendor_cost,
                  )}{' '}
                  • Ship{' '}
                  {formatVnd(
                    costOrderTarget.legacy_raw_actual_costs.shipping_fee,
                  )}{' '}
                  • Phát sinh{' '}
                  {formatVnd(
                    costOrderTarget.legacy_raw_actual_costs.extra_cost,
                  )}
                </div>
              )}
            </div>
          )}

          {costModalError && (
            <div
              role="alert"
              style={{
                padding: '8px 10px',
                borderRadius: '8px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--danger-text)',
                color: 'var(--danger-text)',
                fontSize: '12px',
              }}
            >
              {costModalError}
            </div>
          )}

          <div>
            <label style={labelStyle}>
              1. Chi phí nhà in + gia công thực tế (VNĐ) *
            </label>
            <NumericDraftInput
              dataTestId="pq-order-actual-vendor-cost-input"
              ariaLabel="Chi phí nhà in thực tế"
              allowDecimal={false}
              placeholder="Nhập từ hóa đơn/phiếu xưởng (nhập 0 nếu không phát sinh)"
              style={{ ...inputStyle, ...tabularNumStyle }}
              value={actualVendorCostInput}
              onValueChange={setActualVendorCostInput}
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '10px',
            }}
          >
            <div>
              <label style={labelStyle}>2. Phí giao hàng thực tế (VNĐ) *</label>
              <NumericDraftInput
                dataTestId="pq-order-actual-shipping-input"
                ariaLabel="Phí giao hàng thực tế"
                allowDecimal={false}
                placeholder="Nhập 0 nếu miễn phí"
                style={{ ...inputStyle, ...tabularNumStyle }}
                value={actualShippingInput}
                onValueChange={setActualShippingInput}
              />
            </div>

            <div>
              <label style={labelStyle}>3. Phí phát sinh thực tế (VNĐ) *</label>
              <NumericDraftInput
                dataTestId="pq-order-actual-extra-input"
                ariaLabel="Phí phát sinh thực tế"
                allowDecimal={false}
                placeholder="Nhập 0 nếu không có"
                style={{ ...inputStyle, ...tabularNumStyle }}
                value={actualExtraInput}
                onValueChange={setActualExtraInput}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>
              Ghi chú tổng tiền đã chi xưởng cấp đơn (VNĐ)
            </label>
            <NumericDraftInput
              dataTestId="pq-order-vendor-paid-input"
              ariaLabel="Tiền thực chi cho xưởng"
              allowDecimal={false}
              style={{ ...inputStyle, ...tabularNumStyle }}
              value={vendorPaidInput}
              onValueChange={setVendorPaidInput}
            />
            <div
              style={{
                fontSize: '11.5px',
                color: 'var(--muted-color)',
                marginTop: '4px',
              }}
            >
              Lưu ý phạm vi: Đây là ghi chú tổng tiền đã thanh toán nhà in ở cấp
              đơn hàng, chưa tách sổ công nợ từng xưởng hoặc phiếu chi/hoàn tiền
              chi tiết.
            </div>
          </div>

          <div>
            <label style={labelStyle}>
              Căn cứ / Ghi chú đối soát hoặc lý do điều chỉnh
            </label>
            <input
              data-testid="pq-order-cost-note-input"
              aria-label="Ghi chú đối soát chi phí"
              style={inputStyle}
              value={costNoteInput}
              onChange={(e) => setCostNoteInput(e.target.value)}
              placeholder="VD: Đối chiếu phiếu giao hàng xưởng #HD-108…"
            />
          </div>

          {costOrderTarget?.cost_history &&
            costOrderTarget.cost_history.length > 0 && (
              <div
                data-testid="pq-order-cost-history-list"
                style={{
                  padding: '8px 10px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  maxHeight: '132px',
                  overflowY: 'auto',
                  fontSize: '11.5px',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                  Lịch sử thay đổi & xác nhận (
                  {costOrderTarget.cost_history.length})
                </div>
                {costOrderTarget.cost_history.slice(0, 5).map((h) => (
                  <div
                    key={h.id}
                    style={{
                      padding: '3px 0',
                      borderTop: '1px dashed var(--border-color)',
                      color: 'var(--muted-color)',
                    }}
                  >
                    <strong style={{ color: 'var(--text-color)' }}>
                      {HISTORY_ACTION_LABELS[h.action] || h.action}
                    </strong>{' '}
                    • {new Date(h.created_at).toLocaleString('vi-VN')}
                    {h.note ? ` — ${h.note}` : ''}
                  </div>
                ))}
              </div>
            )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
              marginTop: '4px',
            }}
          >
            <div>
              {costOrderTarget?.actual_cost_confirmed && (
                <button
                  type="button"
                  data-testid="pq-order-unconfirm-cost-btn"
                  onClick={() => void submitCostUpdate('UNCONFIRM')}
                  className="pq-btn pq-btn-secondary"
                >
                  Bỏ xác nhận (kiểm tra lại)
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setCostOrderTarget(null)}
                className="pq-btn pq-btn-secondary"
              >
                Đóng
              </button>
              {!costOrderTarget?.actual_cost_confirmed && (
                <button
                  type="button"
                  data-testid="pq-order-save-draft-cost-btn"
                  onClick={() => void submitCostUpdate('SAVE_DRAFT')}
                  className="pq-btn pq-btn-secondary"
                >
                  Lưu tạm khoản đã nhập
                </button>
              )}
              <button
                type="submit"
                data-testid="pq-order-confirm-cost-submit"
                className="pq-btn pq-btn-primary"
              >
                Xác nhận đủ 3 khoản
              </button>
            </div>
          </div>
        </form>
      </CatalogModalDialog>
    </div>
  );
};
