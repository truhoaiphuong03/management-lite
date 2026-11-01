import React from 'react';
import { NavIcon } from './Icons.js';
import { SYSTEM_VERSION } from '../../../contracts/src/version.js';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: string;
  ownerOnly?: boolean;
  staffOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'finance',
    label: 'Thu chi cá nhân',
    path: '/finance',
    icon: 'finance',
    ownerOnly: true,
  },
  { id: 'dashboard', label: 'Tổng quan', path: '/', icon: 'dashboard' },
  { id: 'clock', label: 'Chấm công', path: '/clock', icon: 'clock' },
  {
    id: 'schedule',
    label: 'Lịch làm việc',
    path: '/schedule',
    icon: 'schedule',
  },
  { id: 'reports', label: 'Báo cáo', path: '/reports', icon: 'reports' },
  { id: 'work', label: 'Công việc', path: '/work', icon: 'work' },
  { id: 'storage', label: 'Tệp & Drive', path: '/storage', icon: 'storage' },
  {
    id: 'attendance',
    label: 'Lịch sử công',
    path: '/attendance',
    icon: 'attendance',
  },
  {
    id: 'attendance-review',
    label: 'Duyệt công',
    path: '/attendance/review',
    icon: 'attendance-review',
    ownerOnly: true,
  },
  {
    id: 'employees',
    label: 'Nhân sự',
    path: '/employees',
    icon: 'employees',
    ownerOnly: true,
  },
  {
    id: 'payroll',
    label: 'Bảng lương',
    path: '/payroll',
    icon: 'payroll',
    ownerOnly: true,
  },
  {
    id: 'my-pay',
    label: 'Lương cá nhân',
    path: '/my-pay',
    icon: 'my-pay',
    staffOnly: true,
  },
  {
    id: 'accounts',
    label: 'Tài khoản dùng chung',
    path: '/accounts',
    icon: 'accounts',
    ownerOnly: true,
  },
  {
    id: 'audit',
    label: 'Nhật ký Audit',
    path: '/audit',
    icon: 'audit',
    ownerOnly: true,
  },
  {
    id: 'system-logs',
    label: 'Nhật ký hệ thống',
    path: '/system-logs',
    icon: 'system-logs',
    ownerOnly: true,
  },
  {
    id: 'issues',
    label: 'Sổ tay lỗi',
    path: '/issues',
    icon: 'issues',
    ownerOnly: true,
  },
  { id: 'settings', label: 'Cài đặt', path: '/settings', icon: 'settings' },
];

export interface NavGroup {
  id: string;
  title: string;
  path: string;
  icon: string;
  itemIds: string[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    title: 'Tổng quan',
    path: '/',
    icon: 'dashboard',
    itemIds: ['dashboard'],
  },
  {
    id: 'work',
    title: 'Công việc',
    path: '/groups/work',
    icon: 'work',
    itemIds: ['work', 'reports', 'storage'],
  },
  {
    id: 'attendance',
    title: 'Chấm công',
    path: '/groups/attendance',
    icon: 'clock',
    itemIds: ['clock', 'schedule', 'attendance', 'attendance-review'],
  },
  {
    id: 'hr-payroll',
    title: 'Nhân sự',
    path: '/groups/hr-payroll',
    icon: 'employees',
    itemIds: ['employees', 'payroll', 'my-pay'],
  },
  {
    id: 'accounts',
    title: 'Tài khoản',
    path: '/accounts',
    icon: 'accounts',
    itemIds: ['accounts'],
  },
  {
    id: 'finance',
    title: 'Thu chi',
    path: '/finance',
    icon: 'finance',
    itemIds: ['finance'],
  },
  {
    id: 'admin',
    title: 'Quản trị',
    path: '/groups/admin',
    icon: 'settings',
    itemIds: ['issues', 'system-logs', 'audit', 'settings'],
  },
];

export interface DesktopSidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  role: 'owner' | 'admin' | 'staff';
  isOwnerVerified?: boolean | undefined;
  version?: string;
}

export const isGroupActiveForPath = (
  currentPath: string,
  group: { path: string; itemIds: string[] },
  itemMap: Map<string, NavItem>,
): boolean => {
  if (group.path === '/') {
    return currentPath === '/';
  }
  if (currentPath === group.path || currentPath.startsWith(group.path + '/')) {
    return true;
  }
  return group.itemIds.some((id) => {
    const item = itemMap.get(id);
    if (!item) return false;
    if (item.path === '/') return currentPath === '/';
    return currentPath === item.path || currentPath.startsWith(item.path + '/');
  });
};

export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  currentPath,
  onNavigate,
  role,
  isOwnerVerified,
  version = SYSTEM_VERSION,
}) => {
  const isItemVisible = (item: NavItem) => {
    if (
      (item.id === 'issues' || item.id === 'finance') &&
      (isOwnerVerified !== true || role !== 'owner')
    )
      return false;
    if (role === 'staff' && item.ownerOnly) return false;
    if (role === 'owner' && (item.staffOnly || item.id === 'my-pay'))
      return false; // C04/PAY-02: Owner has no payroll entry
    return true;
  };

  const itemMap = new Map<string, NavItem>(
    NAV_ITEMS.map((item) => [item.id, item]),
  );

  const visibleGroups = NAV_GROUPS.map((group) => {
    const items = group.itemIds
      .map((id) => itemMap.get(id))
      .filter(
        (item): item is NavItem => item !== undefined && isItemVisible(item),
      );
    return {
      ...group,
      items,
    };
  }).filter((group) => group.items.length > 0);

  return (
    <aside
      style={{
        width: '224px',
        backgroundColor: 'var(--surface-color)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 44px)',
        position: 'sticky',
        top: '44px',
        flexShrink: 0,
        boxSizing: 'border-box',
      }}
    >
      <nav
        style={{
          padding: '12px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          overflowY: 'auto',
          flex: 1,
        }}
        aria-label="Desktop navigation"
      >
        {visibleGroups.map((group) => {
          const isGroupActive = isGroupActiveForPath(
            currentPath,
            group,
            itemMap,
          );
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => onNavigate(group.items[0]?.path || group.path)}
              title={group.items.map((i) => i.label).join(', ')}
              style={{
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 12px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: isGroupActive
                  ? 'var(--accent-soft)'
                  : 'transparent',
                color: isGroupActive
                  ? 'var(--accent-text)'
                  : 'var(--muted-color)',
                fontWeight: isGroupActive ? 600 : 500,
                textAlign: 'left',
                cursor: 'pointer',
                minHeight: '40px',
                width: '100%',
                transition: 'background-color 0.15s ease, color 0.15s ease',
              }}
            >
              <NavIcon id={group.icon} size={18} />
              <span
                style={{
                  fontSize: '13.5px',
                  lineHeight: 1.2,
                  color: isGroupActive
                    ? 'var(--accent-text)'
                    : 'var(--text-color)',
                  fontWeight: isGroupActive ? 600 : 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {group.title}
              </span>
            </button>
          );
        })}
      </nav>

      <div
        style={{
          padding: '12px 14px',
          borderTop: '1px solid var(--border-color)',
          fontSize: '12px',
          color: 'var(--muted-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <span
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <span style={{ color: 'var(--success-text)', fontSize: '11px' }}>
            ●
          </span>
          <strong style={{ color: 'var(--text-color)', fontWeight: 500 }}>
            {role === 'owner'
              ? 'Chủ sở hữu'
              : role === 'admin'
                ? 'Quản lý'
                : 'Nhân viên'}
          </strong>
        </span>
        <span
          style={{
            fontSize: '11px',
            color: 'var(--muted-color)',
          }}
        >
          v{version}
        </span>
      </div>
    </aside>
  );
};

export interface MobileBottomNavProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onOpenMore?: () => void;
  isMoreOpen?: boolean;
  role?: 'owner' | 'admin' | 'staff' | undefined;
  isOwnerVerified?: boolean | undefined;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentPath,
  onNavigate,
  role = 'owner',
  isOwnerVerified = false,
}) => {
  const isItemVisible = (item: NavItem) => {
    if (
      (item.id === 'issues' || item.id === 'finance') &&
      (isOwnerVerified !== true || role !== 'owner')
    )
      return false;
    if (role === 'staff' && item.ownerOnly) return false;
    if (role === 'owner' && (item.staffOnly || item.id === 'my-pay'))
      return false;
    return true;
  };

  const itemMap = new Map<string, NavItem>(
    NAV_ITEMS.map((item) => [item.id, item]),
  );

  const visibleGroups = NAV_GROUPS.map((group) => {
    const items = group.itemIds
      .map((id) => itemMap.get(id))
      .filter(
        (item): item is NavItem => item !== undefined && isItemVisible(item),
      );
    return {
      ...group,
      items,
    };
  }).filter((group) => group.items.length > 0);

  return (
    <nav
      className="mobile-bottom-nav"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        minHeight: 'calc(60px + env(safe-area-inset-bottom, 0px))',
        backgroundColor: 'var(--surface-color, #151F30)',
        borderTop: '1px solid var(--border-color, #334155)',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'space-around',
        gap: '2px',
        paddingTop: '4px',
        paddingBottom: 'calc(6px + env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(4px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(4px, env(safe-area-inset-right, 0px))',
        zIndex: 920,
        boxSizing: 'border-box',
      }}
      aria-label="Mobile bottom navigation"
    >
      {visibleGroups.map((group) => {
        const isGroupActive = isGroupActiveForPath(currentPath, group, itemMap);
        const shortLabelMap: Record<string, string> = {
          overview: 'Tổng quan',
          attendance: 'Chấm công',
          work: 'Công việc',
          'hr-payroll': 'Nhân sự',
          finance: 'Thu chi',
          accounts: 'Tài khoản',
          admin: 'Quản trị',
        };
        const shortLabel = shortLabelMap[group.id] || group.title;
        return (
          <button
            key={group.id}
            type="button"
            onClick={() => onNavigate(group.items[0]?.path || group.path)}
            aria-current={isGroupActive ? 'page' : undefined}
            aria-label={group.title}
            className="mobile-bottom-nav-btn"
            style={{
              flex: '1 1 0px',
              minWidth: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '52px',
              border: 'none',
              borderRadius: '8px',
              backgroundColor: isGroupActive
                ? 'var(--accent-soft)'
                : 'transparent',
              color: isGroupActive
                ? 'var(--accent-text, #14B8A6)'
                : 'var(--muted-color, #94A3B8)',
              cursor: 'pointer',
              gap: '3px',
              boxSizing: 'border-box',
              padding: '4px 1px',
              touchAction: 'manipulation',
              transition: 'color 0.15s ease, background-color 0.15s ease',
            }}
          >
            <span
              style={{
                width: '22px',
                height: '20px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
              aria-hidden="true"
            >
              <NavIcon id={group.icon} size={18} />
            </span>
            <span
              className="mobile-nav-label"
              style={{
                fontSize: '11px',
                lineHeight: 1.2,
                letterSpacing: '-0.02em',
                fontWeight: isGroupActive ? 600 : 500,
                maxWidth: '100%',
                textAlign: 'center',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {shortLabel}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
