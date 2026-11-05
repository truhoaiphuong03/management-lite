import React from 'react';
import type {
  CatalogSubPageId,
  FinanceSubPageId,
  PrintQuoteViewMode,
} from './types.js';
import {
  PqChartIcon,
  PqFileTextIcon,
  PqHistoryIcon,
  PqPackageIcon,
  PqStoreIcon,
  PqTagIcon,
  PqUsersIcon,
  PqWalletIcon,
} from './PrintQuoteIcons.js';

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
  // Focused editor & detail routes hide module subnav to maximize calm workspace
  if (viewMode === 'new' || viewMode === 'edit' || viewMode === 'detail') {
    return null;
  }

  const isCatalogView =
    viewMode === 'catalog-prices' ||
    viewMode === 'catalog-customers' ||
    viewMode === 'catalog-vendors';

  const isFinanceView =
    viewMode === 'receivables' ||
    viewMode === 'payables' ||
    viewMode === 'transactions' ||
    viewMode === 'import-history';

  const topItems: Array<{
    id: string;
    testId: string;
    label: string;
    count?: number;
    path: string;
    active: boolean;
    icon: React.ReactNode;
  }> = [
    {
      id: 'quotes',
      testId: 'pq-nav-group-quotes',
      label: 'Báo giá',
      count: quotesCount,
      path: '/print-quotes',
      active: viewMode === 'quotes',
      icon: <PqFileTextIcon size={15} />,
    },
    {
      id: 'orders',
      testId: 'pq-nav-group-orders',
      label: 'Đơn hàng',
      count: ordersCount,
      path: '/print-quotes/orders',
      active: viewMode === 'orders',
      icon: <PqPackageIcon size={15} />,
    },
    {
      id: 'finance',
      testId: 'pq-nav-group-finance',
      label: 'Công nợ',
      path: '/print-quotes/receivables',
      active: isFinanceView,
      icon: <PqWalletIcon size={15} />,
    },
    {
      id: 'catalog',
      testId: 'pq-nav-group-catalog',
      label: 'Danh mục',
      path: '/print-quotes/catalog/prices',
      active: isCatalogView,
      icon: <PqTagIcon size={15} />,
    },
    {
      id: 'reports',
      testId: 'pq-nav-group-analytics',
      label: 'Báo cáo',
      path: '/print-quotes/reports',
      active: viewMode === 'reports',
      icon: <PqChartIcon size={15} />,
    },
  ];

  const activeCatalogSub: CatalogSubPageId =
    viewMode === 'catalog-customers'
      ? 'customers'
      : viewMode === 'catalog-vendors'
        ? 'vendors'
        : 'prices';

  const activeFinanceSub: FinanceSubPageId =
    viewMode === 'payables'
      ? 'payables'
      : viewMode === 'transactions'
        ? 'transactions'
        : viewMode === 'import-history'
          ? 'import-history'
          : 'receivables';

  const financeSubItems: Array<{
    id: FinanceSubPageId;
    label: string;
    path: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'receivables',
      label: 'Công nợ khách',
      path: '/print-quotes/receivables',
      icon: <PqUsersIcon size={14} />,
    },
    {
      id: 'payables',
      label: 'Công nợ xưởng',
      path: '/print-quotes/payables',
      icon: <PqStoreIcon size={14} />,
    },
    {
      id: 'transactions',
      label: 'Giao dịch',
      path: '/print-quotes/transactions',
      icon: <PqWalletIcon size={14} />,
    },
    {
      id: 'import-history',
      label: 'Nhập lịch sử',
      path: '/print-quotes/import-history',
      icon: <PqHistoryIcon size={14} />,
    },
  ];

  const catalogSubItems: Array<{
    id: CatalogSubPageId;
    label: string;
    count: number;
    path: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'prices',
      label: 'Bảng giá nhà in',
      count: priceItemsCount,
      path: '/print-quotes/catalog/prices',
      icon: <PqTagIcon size={14} />,
    },
    {
      id: 'customers',
      label: 'Khách hàng',
      count: customersCount,
      path: '/print-quotes/catalog/customers',
      icon: <PqUsersIcon size={14} />,
    },
    {
      id: 'vendors',
      label: 'Nhà in đối tác',
      count: vendorsCount,
      path: '/print-quotes/catalog/vendors',
      icon: <PqStoreIcon size={14} />,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <nav
        aria-label="Điều hướng phân hệ Báo giá in ấn"
        className="pq-module-nav"
      >
        {topItems.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={item.testId}
            aria-current={item.active ? 'page' : undefined}
            className="pq-module-nav-item"
            data-active={item.active ? 'true' : 'false'}
            onClick={() => onNavigatePath(item.path)}
          >
            {item.icon}
            <span>{item.label}</span>
            {typeof item.count === 'number' && (
              <span
                className="pq-nav-count-pill"
                data-active={item.active ? 'true' : 'false'}
              >
                {item.count}
              </span>
            )}
          </button>
        ))}
      </nav>

      {isFinanceView && (
        <div
          role="navigation"
          aria-label="Phân mục Công nợ & Giao dịch in ấn"
          data-testid="pq-finance-tabs"
          className="pq-catalog-subnav"
        >
          {financeSubItems.map((sub) => {
            const active = activeFinanceSub === sub.id;
            return (
              <button
                key={sub.id}
                type="button"
                data-testid={`pq-finance-tab-${sub.id}`}
                aria-current={active ? 'page' : undefined}
                className="pq-catalog-subnav-item"
                data-active={active ? 'true' : 'false'}
                onClick={() => onNavigatePath(sub.path)}
              >
                {sub.icon}
                <span>{sub.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {isCatalogView && (
        <div
          role="navigation"
          aria-label="Phân mục Danh mục in ấn"
          data-testid="pq-catalog-tabs"
          className="pq-catalog-subnav"
        >
          {catalogSubItems.map((sub) => {
            const active = activeCatalogSub === sub.id;
            return (
              <button
                key={sub.id}
                type="button"
                data-testid={`pq-catalog-tab-${sub.id}`}
                aria-current={active ? 'page' : undefined}
                className="pq-catalog-subnav-item"
                data-active={active ? 'true' : 'false'}
                onClick={() => onNavigatePath(sub.path)}
              >
                {sub.icon}
                <span>{sub.label}</span>
                <span
                  className="pq-nav-count-pill"
                  data-active={active ? 'true' : 'false'}
                >
                  {sub.count}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
