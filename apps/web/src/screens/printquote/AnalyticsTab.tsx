import React, { useState, useMemo } from 'react';
import type {
  PrintQuoteData,
  PrintOrderData,
  PrintQuoteDashboardStats,
} from '../../../../../packages/contracts/src/printquote.js';
import { formatVnd } from '../helpers/printquote-helpers.js';
import { cardStyle, tabularNumStyle } from './types.js';
import { PqShieldIcon } from './PrintQuoteIcons.js';

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

  const debtCount = orders.filter((o) => o.remaining_debt_amount > 0).length;
  const confirmedOrdersCount =
    stats?.confirmed_actual_orders_count ??
    orders.filter((o) => o.actual_cost_confirmed === true).length;
  const confirmedActualProfit =
    confirmedOrdersCount > 0
      ? (stats?.total_actual_profit ??
        orders
          .filter((o) => o.actual_cost_confirmed === true)
          .reduce((sum, o) => sum + o.actual_profit, 0))
      : null;
  const totalVendorPaid =
    stats?.total_vendor_paid_amount ??
    orders.reduce((sum, o) => sum + (o.vendor_paid_amount ?? 0), 0);

  return (
    <div
      data-testid="panel-profit-debt"
      style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      <div className="pq-page-head">
        <div>
          <h1 className="pq-page-title">Báo cáo lợi nhuận & phải thu</h1>
          <p className="pq-page-subtitle">
            Tổng hợp giá trị đơn hàng, lợi nhuận dự kiến và tiến độ thu tiền
          </p>
        </div>
      </div>

      <div
        data-testid="pq-reports-scope-note"
        style={{
          padding: '12px 16px',
          borderRadius: '12px',
          backgroundColor: 'var(--surface-color)',
          border: '1px solid var(--border-color)',
          fontSize: '12.5px',
          color: 'var(--muted-color)',
          lineHeight: 1.55,
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
        }}
      >
        <PqShieldIcon
          size={16}
          style={{ color: 'var(--accent-text)', marginTop: '2px' }}
        />
        <div>
          <strong style={{ color: 'var(--text-color)' }}>
            Phạm vi số liệu báo cáo:
          </strong>{' '}
          Lợi nhuận trên trang này là <strong>lợi nhuận dự kiến</strong> tính
          theo giá vốn lúc lập báo giá (chưa bao gồm sổ đối soát hóa đơn thực tế
          với xưởng in). Sổ Thu chi cá nhân (<code>/finance</code>) hoạt động
          độc lập hoàn toàn.
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
          gap: '12px',
        }}
      >
        <div className="pq-stat-card">
          <div className="pq-stat-label">Tổng giá trị đơn hàng (chưa hủy)</div>
          <div className="pq-stat-value" style={tabularNumStyle}>
            {formatVnd(stats?.total_order_revenue ?? 0)}
          </div>
          <div className="pq-stat-sub">
            {stats?.total_orders ?? orders.length} đơn hàng /{' '}
            {stats?.total_quotes ?? quotes.length} báo giá
          </div>
        </div>

        <div className="pq-stat-card">
          <div className="pq-stat-label">Lợi nhuận dự kiến theo báo giá</div>
          <div
            className="pq-stat-value"
            style={{ ...tabularNumStyle, color: 'var(--success-text)' }}
          >
            {formatVnd(stats?.total_expected_profit ?? 0)}
          </div>
          <div className="pq-stat-sub">
            Vốn dự kiến: {formatVnd(stats?.total_expected_vendor_cost ?? 0)}
          </div>
        </div>

        <div className="pq-stat-card" data-testid="pq-stat-confirmed-actual">
          <div className="pq-stat-label">
            Lời thực tế từ chi phí đã xác nhận
          </div>
          <div
            className="pq-stat-value"
            style={{
              ...tabularNumStyle,
              color:
                confirmedActualProfit !== null
                  ? 'var(--success-text)'
                  : 'var(--muted-color)',
            }}
          >
            {confirmedActualProfit !== null
              ? formatVnd(confirmedActualProfit)
              : 'Chưa xác nhận'}
          </div>
          <div className="pq-stat-sub">
            {confirmedOrdersCount > 0
              ? `Đã xác nhận chi phí ${confirmedOrdersCount}/${orders.length} đơn • Thực chi xưởng: ${formatVnd(totalVendorPaid)}`
              : `0/${orders.length} đơn xác nhận chi phí xưởng`}
          </div>
        </div>

        <div className="pq-stat-card">
          <div className="pq-stat-label">Đã ghi nhận thu trên đơn</div>
          <div
            className="pq-stat-value"
            style={{ ...tabularNumStyle, color: 'var(--accent-text)' }}
          >
            {formatVnd(stats?.total_paid_amount ?? 0)}
          </div>
          <div className="pq-stat-sub">
            Tổng tiền cọc & các đợt thanh toán đã nhập
          </div>
        </div>

        <div className="pq-stat-card">
          <div className="pq-stat-label">Còn phải thu trên đơn</div>
          <div
            className="pq-stat-value"
            style={{ ...tabularNumStyle, color: 'var(--danger-text)' }}
          >
            {formatVnd(stats?.total_remaining_debt ?? 0)}
          </div>
          <div className="pq-stat-sub">
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
            gap: '10px',
            marginBottom: '14px',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
            Chi tiết lợi nhuận dự kiến & phải thu theo đơn
          </h2>
          <div className="pq-filter-pills">
            <button
              type="button"
              aria-pressed={!onlyDebt}
              className="pq-filter-pill"
              data-active={!onlyDebt ? 'true' : 'false'}
              onClick={() => setOnlyDebt(false)}
            >
              <span>Tất cả</span>
              <span className="pq-filter-pill-count">{orders.length}</span>
            </button>
            <button
              type="button"
              aria-pressed={onlyDebt}
              className="pq-filter-pill"
              data-active={onlyDebt ? 'true' : 'false'}
              onClick={() => setOnlyDebt(true)}
            >
              <span>Còn phải thu</span>
              <span className="pq-filter-pill-count">{debtCount}</span>
            </button>
          </div>
        </div>

        {displayedOrders.length === 0 ? (
          <div
            style={{
              padding: '28px 16px',
              textAlign: 'center',
              color: 'var(--muted-color)',
              fontSize: '13px',
            }}
          >
            Chưa có đơn hàng nào khớp bộ lọc hiện tại.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="pq-table">
              <thead>
                <tr>
                  <th>Mã đơn</th>
                  <th>Khách hàng</th>
                  <th style={{ textAlign: 'right' }}>Giá trị đơn</th>
                  <th style={{ textAlign: 'right' }}>Lời dự kiến (BG)</th>
                  <th style={{ textAlign: 'right' }}>Lời thực tế xác nhận</th>
                  <th style={{ textAlign: 'right' }}>Đã thu</th>
                  <th style={{ textAlign: 'right' }}>Còn phải thu</th>
                </tr>
              </thead>
              <tbody>
                {displayedOrders.map((o) => (
                  <tr key={o.id}>
                    <td
                      style={{ fontWeight: 700, color: 'var(--accent-text)' }}
                    >
                      {o.order_code}
                    </td>
                    <td>{o.customer_name || 'Khách lẻ'}</td>
                    <td style={{ textAlign: 'right', ...tabularNumStyle }}>
                      {formatVnd(o.total_quote_amount)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: 700,
                        color: 'var(--success-text)',
                        ...tabularNumStyle,
                      }}
                    >
                      {formatVnd(o.expected_profit)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: o.actual_cost_confirmed ? 700 : 500,
                        color: o.actual_cost_confirmed
                          ? 'var(--success-text)'
                          : 'var(--muted-color)',
                        ...tabularNumStyle,
                      }}
                    >
                      {o.actual_cost_confirmed
                        ? formatVnd(o.actual_profit)
                        : 'Chưa xác nhận'}
                    </td>
                    <td style={{ textAlign: 'right', ...tabularNumStyle }}>
                      {formatVnd(o.total_paid_amount)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: 700,
                        color:
                          o.remaining_debt_amount > 0
                            ? 'var(--danger-text)'
                            : 'var(--success-text)',
                        ...tabularNumStyle,
                      }}
                    >
                      {formatVnd(o.remaining_debt_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
