import React from 'react';
import { NAV_GROUPS, NAV_ITEMS } from './Navigation.js';

export interface BreadcrumbItem {
  label: string;
  path?: string | undefined;
}

export interface BreadcrumbResolution {
  items: BreadcrumbItem[];
  parentLabel: string;
  parentPath: string;
}

/**
 * Deterministically resolves navigation breadcrumbs and parent route for any path.
 * Supports:
 * - Function routes: Group > Function
 * - Detail/create routes: Group > List > Current
 * - Group routes: Overview > Group
 * - Deep-link safe: returns exact canonical parent path.
 */
export function resolveNavigationBreadcrumbs(
  currentPath: string,
  options?: { customTitle?: string | undefined; role?: string | undefined },
): BreadcrumbResolution | null {
  if (
    !currentPath ||
    currentPath === '/' ||
    currentPath === '/login' ||
    currentPath.startsWith('/activate')
  ) {
    return null;
  }

  // 1. Group Overview Screens: /groups/:groupId
  if (currentPath.startsWith('/groups/')) {
    const groupId = currentPath.replace('/groups/', '').split('/')[0];
    const group = NAV_GROUPS.find((g) => g.id === groupId);
    const groupTitle = group ? group.title : 'Nhóm chức năng';
    return {
      items: [{ label: 'Tổng quan', path: '/' }, { label: groupTitle }],
      parentLabel: 'Tổng quan',
      parentPath: '/',
    };
  }

  // Helper map
  const itemByPath = new Map(NAV_ITEMS.map((item) => [item.path, item]));
  const groupForItem = (itemPath: string) => {
    const item = itemByPath.get(itemPath);
    if (!item) return undefined;
    return NAV_GROUPS.find((g) => g.itemIds.includes(item.id));
  };

  // 2. Detail & Create Routes (3 levels: Group > List > Current)
  // 2A. Issues: /issues/:id
  if (currentPath.startsWith('/issues/')) {
    const issueId = currentPath.replace('/issues/', '');
    const currentLabel = options?.customTitle || `Chi tiết ${issueId}`;
    return {
      items: [
        { label: 'Quản trị', path: '/groups/admin' },
        { label: 'Sổ tay lỗi', path: '/issues' },
        { label: currentLabel },
      ],
      parentLabel: 'Sổ tay lỗi',
      parentPath: '/issues',
    };
  }

  // 2B. Employees: /employees/new or /employees/:id
  if (currentPath === '/employees/new') {
    return {
      items: [
        { label: 'Nhân sự & Lương', path: '/groups/hr-payroll' },
        { label: 'Nhân sự', path: '/employees' },
        { label: 'Thêm nhân viên' },
      ],
      parentLabel: 'Nhân sự',
      parentPath: '/employees',
    };
  }
  if (currentPath.startsWith('/employees/')) {
    const currentLabel = options?.customTitle || 'Chi tiết nhân sự';
    return {
      items: [
        { label: 'Nhân sự & Lương', path: '/groups/hr-payroll' },
        { label: 'Nhân sự', path: '/employees' },
        { label: currentLabel },
      ],
      parentLabel: 'Nhân sự',
      parentPath: '/employees',
    };
  }

  // 2C. Work: /work/new or /work/:id
  if (currentPath === '/work/new') {
    return {
      items: [
        { label: 'Công việc', path: '/groups/work' },
        { label: 'Công việc', path: '/work' },
        { label: 'Tạo công việc mới' },
      ],
      parentLabel: 'Công việc',
      parentPath: '/work',
    };
  }
  if (currentPath.startsWith('/work/')) {
    const currentLabel = options?.customTitle || 'Chi tiết công việc';
    return {
      items: [
        { label: 'Công việc', path: '/groups/work' },
        { label: 'Công việc', path: '/work' },
        { label: currentLabel },
      ],
      parentLabel: 'Công việc',
      parentPath: '/work',
    };
  }

  // 2D. Accounts: standalone menu item, detail pages hang under it
  if (currentPath === '/accounts' || currentPath.startsWith('/accounts/')) {
    const currentLabel = options?.customTitle || 'Chi tiết tài khoản';
    return {
      items:
        currentPath === '/accounts'
          ? [{ label: 'Tài khoản dùng chung' }]
          : [
              { label: 'Tài khoản dùng chung', path: '/accounts' },
              { label: currentLabel },
            ],
      parentLabel:
        currentPath === '/accounts' ? 'Tổng quan' : 'Tài khoản dùng chung',
      parentPath: currentPath === '/accounts' ? '/' : '/accounts',
    };
  }

  // 2E. Storage: /storage/:id
  if (currentPath.startsWith('/storage/')) {
    const currentLabel = options?.customTitle || 'Chi tiết thư mục';
    return {
      items: [
        { label: 'Công việc', path: '/groups/work' },
        { label: 'Tệp & Drive', path: '/storage' },
        { label: currentLabel },
      ],
      parentLabel: 'Tệp & Drive',
      parentPath: '/storage',
    };
  }

  // 2E2. Payroll statistics: /payroll/stats (fixed page, not a period id)
  if (currentPath === '/payroll/stats') {
    return {
      items: [
        { label: 'Nhân sự & Lương', path: '/groups/hr-payroll' },
        { label: 'Bảng lương', path: '/payroll' },
        { label: 'Thống kê lương' },
      ],
      parentLabel: 'Bảng lương',
      parentPath: '/payroll',
    };
  }

  // 2F. Payroll: /payroll/:id
  if (currentPath.startsWith('/payroll/')) {
    const currentLabel = options?.customTitle || 'Chi tiết bảng lương';
    return {
      items: [
        { label: 'Nhân sự & Lương', path: '/groups/hr-payroll' },
        { label: 'Bảng lương', path: '/payroll' },
        { label: currentLabel },
      ],
      parentLabel: 'Bảng lương',
      parentPath: '/payroll',
    };
  }

  // 2G. Thu chi cá nhân (FIN): standalone menu item, sub-pages hang under it
  if (currentPath === '/finance' || currentPath.startsWith('/finance/')) {
    const finLabels: Record<string, string> = {
      '/finance': 'Tổng hợp',
      '/finance/history': 'Lịch sử',
      '/finance/categories': 'Danh mục',
      '/finance/plan': 'Kế hoạch thu chi cố định',
    };
    const finLabel = currentPath.startsWith('/finance/entries/')
      ? options?.customTitle || 'Chi tiết giao dịch'
      : (finLabels[currentPath] ?? options?.customTitle ?? 'Thu chi');
    return {
      items:
        currentPath === '/finance'
          ? [{ label: 'Thu chi cá nhân' }]
          : [
              { label: 'Thu chi cá nhân', path: '/finance' },
              { label: finLabel },
            ],
      parentLabel: 'Thu chi cá nhân',
      parentPath: '/finance',
    };
  }

  // 2H. Báo giá in ấn (PrintQuote UX V2)
  if (currentPath === '/print-quotes' || currentPath.startsWith('/print-quotes/')) {
    const pqLabels: Record<string, string> = {
      '/print-quotes/new': 'Tạo báo giá mới',
      '/print-quotes/orders': 'Đơn hàng in ấn',
      '/print-quotes/catalog': 'Bảng giá nhà in',
      '/print-quotes/catalog/prices': 'Bảng giá nhà in',
      '/print-quotes/catalog/customers': 'Khách hàng',
      '/print-quotes/catalog/vendors': 'Nhà in đối tác',
      '/print-quotes/reports': 'Báo cáo in ấn',
    };
    const isEdit = /^\/print-quotes\/[^/]+\/edit$/.test(currentPath);
    const editParentPath = isEdit
      ? currentPath.replace(/\/edit$/, '')
      : '/print-quotes';
    const currentLabel =
      pqLabels[currentPath] ??
      options?.customTitle ??
      (isEdit ? 'Sửa báo giá' : 'Chi tiết báo giá');
    return {
      items:
        currentPath === '/print-quotes'
          ? [{ label: 'Báo giá in ấn' }]
          : isEdit
            ? [
                { label: 'Báo giá in ấn', path: '/print-quotes' },
                { label: 'Chi tiết báo giá', path: editParentPath },
                { label: currentLabel },
              ]
            : [
                { label: 'Báo giá in ấn', path: '/print-quotes' },
                { label: currentLabel },
              ],
      parentLabel:
        currentPath === '/print-quotes'
          ? 'Tổng quan'
          : isEdit
            ? 'Chi tiết báo giá'
            : 'Báo giá in ấn',
      parentPath:
        currentPath === '/print-quotes' ? '/' : editParentPath,
    };
  }

  // 3. Primary Function Routes (2 levels: Group > Function)
  const exactItem = itemByPath.get(currentPath);
  if (exactItem) {
    const group = groupForItem(currentPath);
    const groupTitle = group ? group.title : 'Nhóm chức năng';
    const groupPath = group ? group.path : '/';
    return {
      items: [
        { label: groupTitle, path: groupPath },
        { label: exactItem.label },
      ],
      parentLabel: groupTitle,
      parentPath: groupPath,
    };
  }

  // Fallback for any unknown route
  return {
    items: [
      { label: 'Tổng quan', path: '/' },
      { label: options?.customTitle || 'Trang hiện tại' },
    ],
    parentLabel: 'Tổng quan',
    parentPath: '/',
  };
}

export interface BreadcrumbProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  customTitle?: string | undefined;
  role?: string | undefined;
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({
  currentPath,
  onNavigate,
  customTitle,
  role,
}) => {
  const resolution = resolveNavigationBreadcrumbs(currentPath, {
    customTitle,
    role,
  });

  if (!resolution) {
    return null;
  }

  const { items, parentLabel, parentPath } = resolution;

  return (
    <nav
      aria-label="Đường dẫn điều hướng"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
        marginBottom: '16px',
        boxSizing: 'border-box',
      }}
    >
      {/* Mobile Back Link: short, easy to tap, >= 44x44px hit-target */}
      <div className="mobile-breadcrumb-back">
        <button
          type="button"
          onClick={() => onNavigate(parentPath)}
          aria-label={`Quay lại ${parentLabel}`}
          style={{
            boxSizing: 'border-box',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            minHeight: '44px',
            minWidth: '44px',
            padding: '8px 14px',
            borderRadius: '8px',
            backgroundColor: 'var(--surface-subtle)',
            border: '1px solid var(--border-color)',
            color: 'var(--accent-text)',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background-color 0.15s ease, border-color 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(20, 184, 166, 0.15)';
            e.currentTarget.style.borderColor = 'rgba(20, 184, 166, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--surface-subtle)';
            e.currentTarget.style.borderColor = '#334155';
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>{parentLabel}</span>
        </button>
      </div>

      {/* Desktop Full Breadcrumbs: Nhóm > Danh sách > Trang hiện tại */}
      <ol
        className="desktop-breadcrumb-trail"
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '6px',
          listStyle: 'none',
          padding: 0,
          margin: 0,
          fontSize: '13px',
        }}
      >
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li
              key={idx}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {idx > 0 && (
                <span
                  style={{
                    color: 'var(--muted-color)',
                    userSelect: 'none',
                    fontSize: '12px',
                    margin: '0 2px',
                  }}
                  aria-hidden="true"
                >
                  ›
                </span>
              )}

              {item.path && !isLast ? (
                <button
                  type="button"
                  onClick={() => onNavigate(item.path!)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '4px 6px',
                    borderRadius: '4px',
                    color: 'var(--text-secondary)',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    lineHeight: 1.3,
                    transition: 'color 0.15s ease, background-color 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#14B8A6';
                    e.currentTarget.style.backgroundColor =
                      'rgba(20, 184, 166, 0.08)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#CBD5E1';
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.outline = '2px solid #14B8A6';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.outline = 'none';
                  }}
                >
                  {item.label}
                </button>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  style={{
                    padding: '4px 6px',
                    color: isLast
                      ? 'var(--muted-color)'
                      : 'var(--text-secondary)',
                    fontWeight: isLast ? 600 : 500,
                    lineHeight: 1.3,
                  }}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <style>{`
        @media (max-width: 640px) {
          .desktop-breadcrumb-trail {
            display: none !important;
          }
          .mobile-breadcrumb-back {
            display: block !important;
          }
        }
        @media (min-width: 641px) {
          .desktop-breadcrumb-trail {
            display: flex !important;
          }
          .mobile-breadcrumb-back {
            display: none !important;
          }
        }
      `}</style>
    </nav>
  );
};
