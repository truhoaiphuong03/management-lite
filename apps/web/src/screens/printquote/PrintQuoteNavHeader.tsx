import React from 'react';
import {
  resolveNavGroupForTab,
  type PrintQuoteNavGroupId,
  type PrintQuoteTabId,
} from './types.js';

export interface PrintQuoteNavHeaderProps {
  activeTab: PrintQuoteTabId;
  onSelectTab: (tab: PrintQuoteTabId) => void;
  quotesCount: number;
  priceItemsCount: number;
  customersCount: number;
  ordersCount: number;
}

export const PrintQuoteNavHeader: React.FC<PrintQuoteNavHeaderProps> = ({
  activeTab,
  onSelectTab,
  quotesCount,
  priceItemsCount,
  customersCount,
  ordersCount,
}) => {
  const activeGroup = resolveNavGroupForTab(activeTab);

  const navGroups: Array<{
    id: PrintQuoteNavGroupId;
    label: string;
    defaultTab: PrintQuoteTabId;
    badge?: number;
    testId: string;
  }> = [
    {
      id: 'quotes_group',
      label: 'Báo giá',
      defaultTab: 'create',
      badge: quotesCount,
      testId: 'pq-nav-group-quotes',
    },
    {
      id: 'orders_group',
      label: 'Đơn hàng',
      defaultTab: 'orders',
      badge: ordersCount,
      testId: 'pq-nav-group-orders',
    },
    {
      id: 'catalog_group',
      label: 'Danh mục',
      defaultTab: 'vendors',
      badge: priceItemsCount + customersCount,
      testId: 'pq-nav-group-catalog',
    },
    {
      id: 'analytics_group',
      label: 'Báo cáo',
      defaultTab: 'analytics',
      testId: 'pq-nav-group-analytics',
    },
  ];

  const tabs: Array<{
    id: PrintQuoteTabId;
    group: PrintQuoteNavGroupId;
    label: string;
    shortLabel: string;
    testId: string;
  }> = [
    {
      id: 'create',
      group: 'quotes_group',
      label: '1. Tạo báo giá',
      shortLabel: 'Tạo báo giá',
      testId: 'tab-create-quote',
    },
    {
      id: 'quotes',
      group: 'quotes_group',
      label: `2. Danh sách báo giá (${quotesCount})`,
      shortLabel: `DS Báo giá (${quotesCount})`,
      testId: 'tab-quotes-list',
    },
    {
      id: 'vendors',
      group: 'catalog_group',
      label: `3. Nhà in & Bảng giá (${priceItemsCount})`,
      shortLabel: `Nhà in & Giá (${priceItemsCount})`,
      testId: 'tab-vendors-catalog',
    },
    {
      id: 'customers',
      group: 'catalog_group',
      label: `4. Khách hàng (${customersCount})`,
      shortLabel: `Khách hàng (${customersCount})`,
      testId: 'tab-customers',
    },
    {
      id: 'orders',
      group: 'orders_group',
      label: `5. Đơn hàng (${ordersCount})`,
      shortLabel: `Đơn hàng (${ordersCount})`,
      testId: 'tab-orders',
    },
    {
      id: 'analytics',
      group: 'analytics_group',
      label: '6. Lợi nhuận & Công nợ',
      shortLabel: 'Lãi & Công nợ',
      testId: 'tab-profit-debt',
    },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* 4 Nhóm điều hướng rõ ràng: Báo giá • Đơn hàng • Danh mục • Báo cáo */}
      <div
        role="navigation"
        aria-label="Nhóm chức năng Báo giá in ấn"
        data-testid="pq-grouped-nav"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: '6px',
          padding: '4px',
          borderRadius: '10px',
          backgroundColor: 'var(--surface-color)',
          border: '1px solid var(--border-color)',
          boxSizing: 'border-box',
        }}
      >
        {navGroups.map((grp) => {
          const isGroupActive = activeGroup === grp.id;
          return (
            <button
              key={grp.id}
              type="button"
              data-testid={grp.testId}
              aria-current={isGroupActive ? 'true' : undefined}
              onClick={() => onSelectTab(grp.defaultTab)}
              style={{
                minHeight: '36px',
                padding: '6px 8px',
                borderRadius: '7px',
                border: isGroupActive
                  ? '1px solid var(--accent-text)'
                  : '1px solid transparent',
                backgroundColor: isGroupActive
                  ? 'var(--accent-soft)'
                  : 'transparent',
                color: isGroupActive
                  ? 'var(--accent-text)'
                  : 'var(--text-color)',
                fontWeight: isGroupActive ? 700 : 600,
                fontSize: '12.5px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              <span>{grp.label}</span>
              {typeof grp.badge === 'number' && grp.badge > 0 && (
                <span
                  style={{
                    fontSize: '12px',
                    opacity: 0.85,
                  }}
                >
                  ({grp.badge})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Thanh 6 màn hình chi tiết (giữ đầy đủ các màn hình hiện có, nổi bật nhóm đang chọn) */}
      <div
        role="tablist"
        aria-label="Chức năng Báo giá in ấn"
        style={{
          display: 'flex',
          gap: '6px',
          overflowX: 'auto',
          paddingBottom: '4px',
          borderBottom: '1px solid var(--border-color)',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          const inActiveGroup = tab.group === activeGroup;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={tab.testId}
              onClick={() => onSelectTab(tab.id)}
              style={{
                padding: '7px 12px',
                borderRadius: '8px',
                border: active
                  ? '1px solid var(--accent-text)'
                  : inActiveGroup
                    ? '1px solid var(--border-color)'
                    : '1px solid transparent',
                backgroundColor: active
                  ? 'var(--accent-soft)'
                  : inActiveGroup
                    ? 'var(--surface-color)'
                    : 'transparent',
                color: active
                  ? 'var(--accent-text)'
                  : inActiveGroup
                    ? 'var(--text-color)'
                    : 'var(--muted-color)',
                fontWeight: active ? 700 : 500,
                fontSize: '12.5px',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
