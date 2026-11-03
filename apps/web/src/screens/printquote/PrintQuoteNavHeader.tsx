import React from 'react';
import type { PrintQuoteViewMode } from './types.js';

export interface PrintQuoteNavHeaderProps {
  viewMode: PrintQuoteViewMode;
  onNavigatePath: (path: string) => void;
  quotesCount: number;
  ordersCount: number;
  priceItemsCount: number;
  customersCount: number;
  vendorsCount: number;
}

export const PrintQuoteNavHeader: React.FC<PrintQuoteNavHeaderProps> = ({
  viewMode,
  onNavigatePath,
  quotesCount,
  ordersCount,
  priceItemsCount,
  customersCount,
  vendorsCount,
}) => {
  // Focused editor / detail screens never render module subnav to keep 100% focus
  if (viewMode === 'new' || viewMode === 'detail' || viewMode === 'edit') {
    return null;
  }

  const isCatalogView =
    viewMode === 'catalog-prices' ||
    viewMode === 'catalog-customers' ||
    viewMode === 'catalog-vendors';

  const primaryTabs: Array<{
    id: string;
    label: string;
    path: string;
    active: boolean;
    badge?: number | undefined;
    testId: string;
  }> = [
    {
      id: 'quotes',
      label: 'Báo giá',
      path: '/print-quotes',
      active: viewMode === 'quotes',
      badge: quotesCount,
      testId: 'pq-nav-group-quotes',
    },
    {
      id: 'orders',
      label: 'Đơn hàng',
      path: '/print-quotes/orders',
      active: viewMode === 'orders',
      badge: ordersCount,
      testId: 'pq-nav-group-orders',
    },
    {
      id: 'catalog',
      label: 'Danh mục',
      path: '/print-quotes/catalog/prices',
      active: isCatalogView,
      badge: priceItemsCount + customersCount + vendorsCount,
      testId: 'pq-nav-group-catalog',
    },
    {
      id: 'reports',
      label: 'Báo cáo',
      path: '/print-quotes/reports',
      active: viewMode === 'reports',
      testId: 'pq-nav-group-analytics',
    },
  ];

  const catalogSubTabs: Array<{
    id: string;
    label: string;
    path: string;
    active: boolean;
    testId: string;
  }> = [
    {
      id: 'prices',
      label: `Bảng giá nhà in (${priceItemsCount})`,
      path: '/print-quotes/catalog/prices',
      active: viewMode === 'catalog-prices',
      testId: 'pq-catalog-tab-prices',
    },
    {
      id: 'customers',
      label: `Khách hàng (${customersCount})`,
      path: '/print-quotes/catalog/customers',
      active: viewMode === 'catalog-customers',
      testId: 'pq-catalog-tab-customers',
    },
    {
      id: 'vendors',
      label: `Nhà in đối tác (${vendorsCount})`,
      path: '/print-quotes/catalog/vendors',
      active: viewMode === 'catalog-vendors',
      testId: 'pq-catalog-tab-vendors',
    },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
      }}
    >
      <nav
        aria-label="Điều hướng phân hệ Báo giá in ấn"
        className="app-subnav-bar"
        data-testid="pq-grouped-nav"
      >
        {primaryTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className="app-subnav-item"
            data-testid={item.testId}
            data-active={item.active ? 'true' : 'false'}
            aria-current={item.active ? 'page' : undefined}
            onClick={() => onNavigatePath(item.path)}
            style={{ minHeight: '44px' }}
          >
            <span>{item.label}</span>
            {typeof item.badge === 'number' && item.badge > 0 && (
              <span style={{ fontSize: '12px', opacity: 0.85 }}>
                ({item.badge})
              </span>
            )}
          </button>
        ))}
      </nav>

      {isCatalogView && (
        <div
          role="tablist"
          aria-label="Danh mục Báo giá in ấn"
          data-testid="pq-catalog-tabs"
          style={{
            display: 'flex',
            gap: '6px',
            overflowX: 'auto',
            paddingBottom: '2px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {catalogSubTabs.map((sub) => (
            <button
              key={sub.id}
              type="button"
              role="tab"
              aria-selected={sub.active}
              data-testid={sub.testId}
              onClick={() => onNavigatePath(sub.path)}
              style={{
                minHeight: '44px',
                padding: '8px 14px',
                borderRadius: '8px',
                border: sub.active
                  ? '1px solid var(--accent-text)'
                  : '1px solid var(--border-color)',
                backgroundColor: sub.active
                  ? 'var(--accent-soft)'
                  : 'var(--surface-color)',
                color: sub.active ? 'var(--accent-text)' : 'var(--text-color)',
                fontWeight: sub.active ? 700 : 600,
                fontSize: '13px',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              {sub.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
