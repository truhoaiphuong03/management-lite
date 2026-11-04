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
  const [tableFilter, setTableFilter] = useState<
    'ACTIVE' | 'DEBT' | 'CANCELLED'
  >('ACTIVE');

  const activeOrders = useMemo(
    () => orders.filter((o) => o.production_status !== 'CANCELLED'),
    [orders],
  );
  const cancelledOrders = useMemo(
    () => orders.filter((o) => o.production_status === 'CANCELLED'),
    [orders],
  );

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

  const displayedOrders = useMemo(() => {
    if (tableFilter === 'CANCELLED') return cancelledOrders;
    if (tableFilter === 'DEBT') {
      return activeOrders.filter((o) => o.remaining_debt_amount > 0);
    }
    return activeOrders;
  }, [activeOrders, cancelledOrders, tableFilter]);

  const debtCount = activeOrders.filter(
    (o) => o.remaining_debt_amount > 0,
  ).length;
  const confirmedOrdersCount =
    stats?.confirmed_actual_orders_count ??
    activeOrders.filter((o) => o.actual_cost_confirmed === true).length;
  const confirmedActualProfit =
    confirmedOrdersCount > 0
      ? (stats?.total_actual_profit ??
        activeOrders
          .filter((o) => o.actual_cost_confirmed === true)
          .reduce((sum, o) => sum + (o.actual_profit ?? 0), 0))
      : null;
  const totalVendorPaid =
    stats?.total_vendor_paid_amount ??
    activeOrders.reduce((sum, o) => sum + (o.vendor_paid_amount ?? 0), 0);

  const needsReviewCount =
    stats?.needs_review_orders_count ??
    orders.filter(
      (o) =>
        !o.actual_cost_confirmed &&
        o.cost_reconciliation_status === 'NEEDS_REVIEW',
    ).length;
  const unconfirmedEnteredCount =
    stats?.unconfirmed_entered_orders_count ??
    orders.filter(
      (o) =>
        !o.actual_cost_confirmed &&
        (o.cost_reconciliation_status === 'PARTIAL_ENTERED' ||
          o.cost_reconciliation_status === 'ENTERED_UNCONFIRMED'),
    ).length;

  const cancelledSummary = stats?.cancelled_orders_summary ?? {
    cancelled_orders_count: cancelledOrders.length,
    cancelled_orders_with_obligations_count: cancelledOrders.filter(
      (o) =>
        o.total_paid_amount > 0 ||
        (o.vendor_paid_amount ?? 0) > 0 ||
        o.actual_cost_confirmed,
    ).length,
    cancelled_customer_paid_holding: cancelledOrders.reduce(
      (s, o) => s + o.total_paid_amount,
      0,
    ),
    cancelled_vendor_paid_amount: cancelledOrders.reduce(
      (s, o) => s + (o.vendor_paid_amount ?? 0),
      0,
    ),
    cancelled_confirmed_incurred_cost: cancelledOrders.reduce(
      (s, o) =>
        s +
        (o.actual_cost_confirmed
          ? (o.actual_vendor_cost ?? 0) +
            (o.actual_shipping_fee ?? 0) +
            (o.actual_extra_cost ?? 0)
          : 0),
      0,
    ),
    cancelled_unconfirmed_entered_cost: cancelledOrders.reduce(
      (s, o) =>
        s +
        (!o.actual_cost_confirmed
          ? (o.entered_vendor_cost ?? 0) +
            (o.entered_shipping_fee ?? 0) +
            (o.entered_extra_cost ?? 0)
          : 0),
      0,
    ),
  };

  return (
    <div
      data-testid="panel-profit-debt"
      style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      <div className="pq-page-head">
        <div>
          <h1 className="pq-page-title">Báo cáo lợi nhuận & phải thu</h1>
          <p className="pq-page-subtitle">
            Tổng hợp giá trị đơn hoạt động, lợi nhuận dự kiến, lợi nhuận từ chi
            phí xác nhận và các nghĩa vụ riêng trên đơn hủy
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
          Tách biệt <strong>lợi nhuận dự kiến</strong> lúc lập báo giá và{' '}
          <strong>
            lợi nhuận từ đơn đã xác nhận đủ 3 khoản chi phí thực tế
          </strong>
          . Khoản <em>Thực chi xưởng</em> là ghi chú tổng cấp đơn (chưa tách sổ
          công nợ từng xưởng hay phiếu chi/hoàn tiền nhà in). Sổ Thu chi cá nhân
          (<code>/finance</code>) hoạt động độc lập hoàn toàn.
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
            {stats?.total_orders ?? activeOrders.length} đơn hoạt động /{' '}
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
              ? `Đã xác nhận đủ 3 khoản ${confirmedOrdersCount}/${activeOrders.length} đơn • Ghi chú chi xưởng cấp đơn: ${formatVnd(totalVendorPaid)}`
              : `0/${activeOrders.length} đơn xác nhận đủ 3 khoản chi phí`}
            {needsReviewCount > 0
              ? ` • ${needsReviewCount} đơn cần rà soát`
              : ''}
            {unconfirmedEnteredCount > 0
              ? ` • ${unconfirmedEnteredCount} đơn nhập nháp`
              : ''}
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
            Tổng tiền cọc & các đợt thanh toán đơn hoạt động
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

      {/* Dedicated Cancelled Orders Obligations Card — never hidden, never auto-netted */}
      <div
        data-testid="pq-cancelled-obligations-card"
        style={{
          ...cardStyle,
          borderColor:
            cancelledSummary.cancelled_orders_with_obligations_count > 0
              ? 'var(--danger-text)'
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
            <h2 style={{ margin: 0, fontSize: '14.5px', fontWeight: 700 }}>
              Đơn đã hủy & nghĩa vụ còn lại (
              {cancelledSummary.cancelled_orders_count} đơn hủy)
            </h2>
            <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
              Phản ánh riêng tiền khách đã thu, tiền đã chi xưởng và chi phí
              phát sinh trên đơn hủy — không tự xóa, không tự bù trừ sang đơn
              hoạt động.
            </div>
          </div>
          {cancelledSummary.cancelled_orders_with_obligations_count > 0 && (
            <span
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: 'var(--danger-text)',
              }}
            >
              {cancelledSummary.cancelled_orders_with_obligations_count} đơn hủy
              còn khoản cần xử lý
            </span>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
            gap: '10px',
            ...tabularNumStyle,
          }}
        >
          <div className="pq-stat-card">
            <div className="pq-stat-label">Tiền khách đang giữ (Đơn hủy)</div>
            <div
              className="pq-stat-value"
              style={{
                color:
                  cancelledSummary.cancelled_customer_paid_holding > 0
                    ? 'var(--danger-text)'
                    : 'var(--muted-color)',
              }}
            >
              {formatVnd(cancelledSummary.cancelled_customer_paid_holding)}
            </div>
            <div className="pq-stat-sub">
              Cần hoàn cọc (REFUND) hoặc thỏa thuận riêng
            </div>
          </div>

          <div className="pq-stat-card">
            <div className="pq-stat-label">
              Ghi chú đã chi xưởng cấp đơn (Đơn hủy)
            </div>
            <div className="pq-stat-value">
              {formatVnd(cancelledSummary.cancelled_vendor_paid_amount)}
            </div>
            <div className="pq-stat-sub">
              Tổng tiền đã chuyển nhà in trên các đơn bị hủy
            </div>
          </div>

          <div className="pq-stat-card">
            <div className="pq-stat-label">
              Chi phí thực tế xác nhận phát sinh (Đơn hủy)
            </div>
            <div className="pq-stat-value">
              {formatVnd(cancelledSummary.cancelled_confirmed_incurred_cost)}
            </div>
            <div className="pq-stat-sub">
              {cancelledSummary.cancelled_unconfirmed_entered_cost > 0
                ? `Ngoài ra có ${formatVnd(cancelledSummary.cancelled_unconfirmed_entered_cost)} nhập nháp chưa xác nhận`
                : 'Chi phí xưởng/vận chuyển đã xác nhận trước khi hủy'}
            </div>
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
              aria-pressed={tableFilter === 'ACTIVE'}
              className="pq-filter-pill"
              data-active={tableFilter === 'ACTIVE' ? 'true' : 'false'}
              onClick={() => setTableFilter('ACTIVE')}
            >
              <span>Đơn hoạt động</span>
              <span className="pq-filter-pill-count">
                {activeOrders.length}
              </span>
            </button>
            <button
              type="button"
              aria-pressed={tableFilter === 'DEBT'}
              className="pq-filter-pill"
              data-active={tableFilter === 'DEBT' ? 'true' : 'false'}
              onClick={() => setTableFilter('DEBT')}
            >
              <span>Còn phải thu</span>
              <span className="pq-filter-pill-count">{debtCount}</span>
            </button>
            {cancelledOrders.length > 0 && (
              <button
                type="button"
                aria-pressed={tableFilter === 'CANCELLED'}
                className="pq-filter-pill"
                data-active={tableFilter === 'CANCELLED' ? 'true' : 'false'}
                onClick={() => setTableFilter('CANCELLED')}
              >
                <span>Đơn đã hủy</span>
                <span className="pq-filter-pill-count">
                  {cancelledOrders.length}
                </span>
              </button>
            )}
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
                      {o.actual_cost_confirmed && o.actual_profit !== null
                        ? formatVnd(o.actual_profit)
                        : o.cost_reconciliation_status === 'NEEDS_REVIEW'
                          ? 'Cần rà soát'
                          : o.cost_reconciliation_status ===
                                'PARTIAL_ENTERED' ||
                              o.cost_reconciliation_status ===
                                'ENTERED_UNCONFIRMED'
                            ? 'Nhập nháp'
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
                          o.production_status === 'CANCELLED'
                            ? 'var(--muted-color)'
                            : o.remaining_debt_amount > 0
                              ? 'var(--danger-text)'
                              : 'var(--success-text)',
                        ...tabularNumStyle,
                      }}
                    >
                      {o.production_status === 'CANCELLED'
                        ? 'Đơn đã hủy'
                        : formatVnd(o.remaining_debt_amount)}
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
