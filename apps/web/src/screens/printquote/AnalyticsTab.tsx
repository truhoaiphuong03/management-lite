import React, { useState, useMemo } from 'react';
import type {
  PrintQuoteData,
  PrintOrderData,
  PrintQuoteDashboardStats,
} from '../../../../../packages/contracts/src/printquote.js';
import { formatVnd } from '../helpers/printquote-helpers.js';
import { cardStyle } from './types.js';

export interface AnalyticsTabProps {
  stats: PrintQuoteDashboardStats | null;
  orders: PrintOrderData[];
  quotes: PrintQuoteData[];
}

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({
  stats,
  orders,
  quotes,
}) => {
  const [onlyDebt, setOnlyDebt] = useState<boolean>(false);

  const ordersInProdCount = stats?.orders_by_production_status
    ? (stats.orders_by_production_status.PENDING || 0) +
      (stats.orders_by_production_status.PREPRESS || 0) +
      (stats.orders_by_production_status.PRINTING || 0) +
      (stats.orders_by_production_status.FINISHING || 0)
    : 0;
  const ordersPendingDeliveryCount = stats?.orders_by_delivery_status
    ? (stats.orders_by_delivery_status.NOT_SHIPPED || 0) +
      (stats.orders_by_delivery_status.PACKING || 0) +
      (stats.orders_by_delivery_status.SHIPPING || 0)
    : 0;

  const displayedOrders = useMemo(
    () =>
      onlyDebt ? orders.filter((o) => o.remaining_debt_amount > 0) : orders,
    [orders, onlyDebt],
  );

  return (
    <div
      data-testid="panel-profit-debt"
      style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: '12px',
        }}
      >
        <div style={cardStyle}>
          <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
            Tổng doanh thu đơn in
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>
            {formatVnd(stats?.total_order_revenue ?? 0)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
            {stats?.total_orders ?? orders.length} đơn hàng /{' '}
            {stats?.total_quotes ?? quotes.length} báo giá
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
            Lợi nhuận Dự kiến vs Thực tế
          </div>
          <div
            style={{
              fontSize: '18px',
              fontWeight: 800,
              color: 'var(--success-text)',
              marginTop: '4px',
            }}
          >
            {formatVnd(stats?.total_expected_profit ?? 0)} /{' '}
            {formatVnd(stats?.total_actual_profit ?? 0)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
            Đối soát giá nhà in thực tế
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
            Tổng tiền đã thu (Cọc + Đợt)
          </div>
          <div
            style={{
              fontSize: '20px',
              fontWeight: 800,
              color: 'var(--accent-text)',
              marginTop: '4px',
            }}
          >
            {formatVnd(stats?.total_paid_amount ?? 0)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
            Đã đối soát phiếu thu
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
            Tổng Công nợ Khách hàng còn nợ
          </div>
          <div
            style={{
              fontSize: '20px',
              fontWeight: 800,
              color: 'var(--danger-text)',
              marginTop: '4px',
            }}
          >
            {formatVnd(stats?.total_remaining_debt ?? 0)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
            {ordersInProdCount} đơn đang SX • {ordersPendingDeliveryCount} đơn
            chờ giao
          </div>
        </div>
      </div>

      <div style={cardStyle}>
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
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
            Sổ theo dõi Lợi nhuận & Công nợ theo Đơn hàng
          </h3>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setOnlyDebt(false)}
              style={{
                padding: '6px 11px',
                borderRadius: '999px',
                border: !onlyDebt
                  ? '1px solid var(--accent-text)'
                  : '1px solid var(--border-color)',
                backgroundColor: !onlyDebt
                  ? 'var(--accent-soft)'
                  : 'var(--bg-color)',
                color: !onlyDebt ? 'var(--accent-text)' : 'var(--muted-color)',
                fontWeight: !onlyDebt ? 700 : 600,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Tất cả ({orders.length})
            </button>
            <button
              type="button"
              onClick={() => setOnlyDebt(true)}
              style={{
                padding: '6px 11px',
                borderRadius: '999px',
                border: onlyDebt
                  ? '1px solid var(--danger-text)'
                  : '1px solid var(--border-color)',
                backgroundColor: onlyDebt
                  ? 'rgba(239, 68, 68, 0.14)'
                  : 'var(--bg-color)',
                color: onlyDebt ? 'var(--danger-text)' : 'var(--muted-color)',
                fontWeight: onlyDebt ? 700 : 600,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Chỉ xem đơn còn nợ (
              {orders.filter((o) => o.remaining_debt_amount > 0).length})
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '12.5px',
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid var(--border-color)',
                  color: 'var(--muted-color)',
                  textAlign: 'left',
                }}
              >
                <th style={{ padding: '8px' }}>Mã đơn</th>
                <th style={{ padding: '8px' }}>Khách hàng</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>
                  Doanh thu
                </th>
                <th style={{ padding: '8px', textAlign: 'right' }}>
                  Lời dự kiến
                </th>
                <th style={{ padding: '8px', textAlign: 'right' }}>
                  Lời thực tế
                </th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Đã thu</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Còn nợ</th>
              </tr>
            </thead>
            <tbody>
              {displayedOrders.map((o) => (
                <tr
                  key={o.id}
                  style={{ borderBottom: '1px solid var(--border-color)' }}
                >
                  <td style={{ padding: '8px', fontWeight: 700 }}>
                    {o.order_code}
                  </td>
                  <td style={{ padding: '8px' }}>
                    {o.customer_name || 'Khách lẻ'}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>
                    {formatVnd(o.total_quote_amount)}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>
                    {formatVnd(o.expected_profit)}
                  </td>
                  <td
                    style={{
                      padding: '8px',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: 'var(--success-text)',
                    }}
                  >
                    {formatVnd(o.actual_profit)}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>
                    {formatVnd(o.total_paid_amount)}
                  </td>
                  <td
                    style={{
                      padding: '8px',
                      textAlign: 'right',
                      fontWeight: 700,
                      color:
                        o.remaining_debt_amount > 0
                          ? 'var(--danger-text)'
                          : 'var(--success-text)',
                    }}
                  >
                    {formatVnd(o.remaining_debt_amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
