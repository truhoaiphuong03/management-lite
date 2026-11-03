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
import { cardStyle, inputStyle, labelStyle } from './types.js';
import { NumericDraftInput } from './NumericDraftInput.js';

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
  }> = [
    { id: 'ALL', label: `Tất cả (${orders.length})` },
    {
      id: 'IN_PROD',
      label: `Đang in (${
        orders.filter(
          (o) =>
            o.production_status !== 'COMPLETED' &&
            o.production_status !== 'CANCELLED',
        ).length
      })`,
    },
    {
      id: 'PENDING_DELIVERY',
      label: `Chờ giao (${
        orders.filter(
          (o) =>
            o.delivery_status !== 'DELIVERED' &&
            o.delivery_status !== 'RETURNED',
        ).length
      })`,
    },
    {
      id: 'HAS_DEBT',
      label: `Còn nợ (${orders.filter((o) => o.remaining_debt_amount > 0).length})`,
    },
  ];

  return (
    <div style={cardStyle} data-testid="panel-orders">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          marginBottom: '12px',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
            Đơn hàng In ấn, Tiến độ & Thu tiền ({orders.length})
          </h2>
          <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
            Cập nhật trạng thái in ấn, giao hàng và ghi nhận tiền đặt cọc / tất
            toán
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          alignItems: 'center',
          marginBottom: '14px',
        }}
      >
        <input
          type="search"
          aria-label="Tìm kiếm đơn hàng"
          style={{ ...inputStyle, flex: '1 1 200px', maxWidth: '320px' }}
          placeholder="Tìm mã đơn, tên khách hoặc mã báo giá…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div
          style={{
            display: 'flex',
            gap: '6px',
            flexWrap: 'wrap',
          }}
        >
          {filterButtons.map((btn) => {
            const active = filterMode === btn.id;
            return (
              <button
                key={btn.id}
                type="button"
                onClick={() => setFilterMode(btn.id)}
                style={{
                  minHeight: '38px',
                  padding: '6px 12px',
                  borderRadius: '999px',
                  border: active
                    ? '1px solid var(--accent-text)'
                    : '1px solid var(--border-color)',
                  backgroundColor: active
                    ? 'var(--accent-soft)'
                    : 'var(--bg-color)',
                  color: active ? 'var(--accent-text)' : 'var(--muted-color)',
                  fontWeight: active ? 700 : 600,
                  fontSize: '12px',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                {btn.label}
              </button>
            );
          })}
        </div>
      </div>

      {filteredOrders.length === 0 ? (
        <div
          style={{
            padding: '24px',
            textAlign: 'center',
            color: 'var(--muted-color)',
          }}
        >
          {orders.length === 0 ? (
            <>
              Chưa có đơn hàng đặt in nào. Hãy chuyển từ mục{' '}
              <strong>Danh sách báo giá</strong> sang Đơn đặt in.
            </>
          ) : (
            'Không có đơn hàng nào khớp bộ lọc hiện tại.'
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {filteredOrders.map((ord) => (
            <div
              key={ord.id}
              data-testid={`order-card-${ord.order_code}`}
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                padding: '14px',
                backgroundColor: 'var(--bg-color)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: '10px',
                  marginBottom: '12px',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <strong
                      style={{
                        fontSize: '15px',
                        color: 'var(--accent-text)',
                      }}
                    >
                      {ord.order_code}
                    </strong>
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
                      fontSize: '12.5px',
                      color: 'var(--muted-color)',
                      marginTop: '4px',
                    }}
                  >
                    Khách hàng:{' '}
                    <strong>{ord.customer_name || 'Khách lẻ'}</strong> • Mã báo
                    giá gốc: {ord.quote_code || '—'} (v{ord.quote_version})
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: '14px',
                    flexWrap: 'wrap',
                    fontSize: '12.5px',
                  }}
                >
                  <div>
                    <div style={{ color: 'var(--muted-color)' }}>
                      Tổng tiền đơn
                    </div>
                    <strong>{formatVnd(ord.total_quote_amount)}</strong>
                  </div>
                  <div>
                    <div style={{ color: 'var(--muted-color)' }}>Đã thu</div>
                    <strong style={{ color: 'var(--success-text)' }}>
                      {formatVnd(ord.total_paid_amount)}
                    </strong>
                  </div>
                  <div>
                    <div style={{ color: 'var(--muted-color)' }}>Còn nợ</div>
                    <strong
                      style={{
                        color:
                          ord.remaining_debt_amount > 0
                            ? 'var(--danger-text)'
                            : 'var(--success-text)',
                      }}
                    >
                      {formatVnd(ord.remaining_debt_amount)}
                    </strong>
                  </div>
                  <div>
                    <div style={{ color: 'var(--muted-color)' }}>
                      Lời dự kiến (theo BG)
                    </div>
                    <strong style={{ color: 'var(--success-text)' }}>
                      {formatVnd(ord.expected_profit)}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Independent Production & Delivery Status Controls + Dates */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(min(100%, 185px), 1fr))',
                  gap: '10px',
                  paddingTop: '10px',
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
                    style={{
                      width: '100%',
                      minHeight: '42px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: 'var(--primary-color)',
                      color: 'var(--inverse-text)',
                      fontWeight: 700,
                      fontSize: '12.5px',
                      cursor: 'pointer',
                    }}
                  >
                    💰 Ghi nhận Cọc / Thanh toán
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Record Payment Modal */}
      {paymentOrderTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Ghi nhận thanh toán đơn hàng"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            backgroundColor: 'rgba(2, 6, 23, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <form
            onSubmit={onRecordPayment}
            style={{
              ...cardStyle,
              width: '100%',
              maxWidth: '440px',
            }}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>
              Thu tiền / Đặt cọc — Đơn {paymentOrderTarget.order_code}
            </h3>
            <div style={{ marginBottom: '10px' }}>
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
            <div style={{ marginBottom: '10px' }}>
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
            <div style={{ marginBottom: '10px' }}>
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
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Ghi chú giao dịch</label>
              <input
                aria-label="Ghi chú thanh toán"
                style={inputStyle}
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                placeholder="VD: Khách CK cọc 50% đơn in"
              />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
              }}
            >
              <button
                type="button"
                onClick={() => setPaymentOrderTarget(null)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'transparent',
                  color: 'var(--text-color)',
                  cursor: 'pointer',
                }}
              >
                Hủy
              </button>
              <button
                type="submit"
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: 'var(--primary-color)',
                  color: 'var(--inverse-text)',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Xác nhận thu tiền
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
