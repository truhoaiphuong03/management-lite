import React, { useState, useMemo, useEffect } from 'react';
import { StatusBadge } from '../../../../../packages/ui/src/components/index.js';
import {
  PrintProductionStatus,
  PrintDeliveryStatus,
  type PrintProductionStatusType,
  type PrintDeliveryStatusType,
  type PrintOrderData,
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
  onUpdateOrderField: (orderId: string, patch: Record<string, unknown>) => void;
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
  const [filterMode, setFilterMode] = useState<
    'ALL' | 'IN_PROD' | 'PENDING_DELIVERY' | 'HAS_DEBT'
  >('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [paymentAmountInput, setPaymentAmountInput] = useState<string>(
    paymentAmount > 0 ? String(paymentAmount) : '',
  );

  useEffect(() => {
    if (paymentOrderTarget) {
      setPaymentAmountInput(paymentAmount > 0 ? String(paymentAmount) : '');
    }
  }, [paymentOrderTarget, paymentAmount]);

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
        (ord.delivery_status === 'DELIVERED' ||
          ord.delivery_status === 'RETURNED')
      ) {
        return false;
      }
      if (filterMode === 'HAS_DEBT' && ord.remaining_debt_amount <= 0) {
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
    id: 'ALL' | 'IN_PROD' | 'PENDING_DELIVERY' | 'HAS_DEBT';
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
          o.delivery_status !== 'DELIVERED' && o.delivery_status !== 'RETURNED',
      ).length,
    },
    {
      id: 'HAS_DEBT',
      label: 'Còn nợ',
      count: orders.filter((o) => o.remaining_debt_amount > 0).length,
    },
  ];

  return (
    <div
      data-testid="panel-orders"
      style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      <div className="pq-page-head">
        <div>
          <h1 className="pq-page-title">Đơn hàng đặt in ({orders.length})</h1>
          <p className="pq-page-subtitle">
            Theo dõi tiến độ xưởng in, giao hàng và thu tiền đặt cọc / tất toán
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
          {filteredOrders.map((ord) => (
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
                          : ord.remaining_debt_amount > 0
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
                    • Báo giá gốc: {ord.quote_code || '—'} (v{ord.quote_version}
                    )
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
                    <span className="pq-metric-label">Còn nợ</span>
                    <strong
                      className="pq-metric-val"
                      style={{
                        ...tabularNumStyle,
                        color:
                          ord.remaining_debt_amount > 0
                            ? 'var(--danger-text)'
                            : 'var(--success-text)',
                      }}
                    >
                      {formatVnd(ord.remaining_debt_amount)}
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
                      onUpdateOrderField(ord.id, {
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
                      onUpdateOrderField(ord.id, {
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
                      onUpdateOrderField(ord.id, {
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
                      setPaymentAmount(ord.remaining_debt_amount || 0);
                      setPaymentType(
                        ord.total_paid_amount === 0 ? 'DEPOSIT' : 'FINAL',
                      );
                    }}
                    className="pq-btn pq-btn-primary"
                    style={{ width: '100%' }}
                  >
                    <PqWalletIcon size={15} />
                    <span>Ghi nhận thanh toán</span>
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Record Payment Modal */}
      <CatalogModalDialog
        open={paymentOrderTarget !== null}
        ariaLabel="Ghi nhận thanh toán đơn hàng"
        title={
          paymentOrderTarget
            ? `Thu tiền / Đặt cọc — Đơn ${paymentOrderTarget.order_code}`
            : 'Ghi nhận thanh toán đơn hàng'
        }
        subtitle="Ghi nhận tiền đặt cọc hoặc thanh toán từng đợt của khách hàng."
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
              <option value="DEPOSIT">Tiền đặt cọc (Deposit)</option>
              <option value="INSTALLMENT">Thanh toán đợt</option>
              <option value="FINAL">Tất toán công nợ cuối</option>
              <option value="REFUND">Hoàn tiền (Refund)</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Số tiền thu (VNĐ) *</label>
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
              Xác nhận thu tiền
            </button>
          </div>
        </form>
      </CatalogModalDialog>
    </div>
  );
};
