import React from 'react';
import { NavIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from './Icons.js';
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
    id: 'print-quotes',
    label: 'Báo giá in ấn',
    path: '/print-quotes',
    icon: 'print-quotes',
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
    id: 'print-quotes',
    title: 'Báo giá in ấn',
    path: '/print-quotes',
    icon: 'print-quotes',
    itemIds: ['print-quotes'],
  },
  {
    id: 'admin',
    title: 'Quản trị',
    path: '/groups/admin',
    icon: 'settings',
    itemIds: ['issues', 'system-logs', 'audit', 'settings'],
  },
];

export interface SidebarUserIdentityInput {
  role: 'owner' | 'admin' | 'staff';
  subRole?: 'admin' | undefined;
  userFullName?: string | undefined;
  userUsername?: string | undefined;
  userEmail?: string | undefined;
  employeeCode?: string | undefined;
}

export interface SidebarUserSummary {
  displayName: string;
  roleLabel: string;
  initials: string;
  secondaryText: string;
  hasEmployeeProfile: boolean;
}

export function resolveSidebarUserSummary(
  input: SidebarUserIdentityInput,
): SidebarUserSummary {
  const roleLabel =
    input.role === 'owner'
      ? 'Chủ sở hữu'
      : input.role === 'admin' || input.subRole === 'admin'
        ? 'Quản lý'
        : 'Nhân viên';

  const trimmedFullName = input.userFullName?.trim() || '';
  const trimmedUsername = input.userUsername?.trim() || '';
  const rawEmail = input.userEmail?.trim() || '';
  const emailPrefix = rawEmail.includes('@')
    ? rawEmail.split('@')[0]?.trim() || ''
    : rawEmail;

  const displayName =
    trimmedFullName || trimmedUsername || emailPrefix || roleLabel;

  const words = displayName.split(/\s+/).filter((w) => w.length > 0);
  const firstWord = words[0] ?? '';
  const lastWord = words[words.length - 1] ?? '';
  const initials =
    words.length >= 2 && firstWord.length > 0 && lastWord.length > 0
      ? `${firstWord[0]}${lastWord[0]}`.toUpperCase()
      : displayName.slice(0, 2).toUpperCase() || 'U';

  const cleanCode = input.employeeCode?.trim() || '';
  const secondaryText =
    cleanCode && cleanCode !== 'OWNER'
      ? `${roleLabel} · ${cleanCode}`
      : roleLabel;

  return {
    displayName,
    roleLabel,
    initials,
    secondaryText,
    hasEmployeeProfile: Boolean(trimmedFullName || cleanCode),
  };
}

export interface DesktopSidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  role: 'owner' | 'admin' | 'staff';
  subRole?: 'admin' | undefined;
  isOwnerVerified?: boolean | undefined;
  version?: string;
  collapsed?: boolean | undefined;
  onToggleCollapse?: (() => void) | undefined;
  userFullName?: string | undefined;
  userUsername?: string | undefined;
  userEmail?: string | undefined;
  employeeCode?: string | undefined;
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
  subRole,
  isOwnerVerified,
  version = SYSTEM_VERSION,
  collapsed = false,
  onToggleCollapse,
  userFullName,
  userUsername,
  userEmail,
  employeeCode,
}) => {
  const userSummary = resolveSidebarUserSummary({
    role,
    subRole,
    userFullName,
    userUsername,
    userEmail,
    employeeCode,
  });
  const isItemVisible = (item: NavItem) => {
    if (
      (item.id === 'issues' ||
        item.id === 'finance' ||
        item.id === 'print-quotes') &&
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
      className="desktop-sidebar-aside"
      data-testid="desktop-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      style={{
        width: collapsed ? '64px' : '224px',
        backgroundColor: 'var(--surface-color)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 44px)',
        position: 'sticky',
        top: '44px',
        flexShrink: 0,
        boxSizing: 'border-box',
        transition: 'width 0.15s ease',
      }}
    >
      <div
        style={{
          padding: collapsed ? '8px 8px 6px 8px' : '8px 10px 6px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-end',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <button
          type="button"
          data-testid="sidebar-collapse-toggle"
          aria-expanded={!collapsed}
          aria-controls="desktop-sidebar-nav"
          aria-label={
            collapsed ? 'Mở rộng menu bên trái' : 'Thu gọn menu bên trái'
          }
          title={collapsed ? 'Mở rộng menu bên trái' : 'Thu gọn menu bên trái'}
          onClick={() => onToggleCollapse?.()}
          className="desktop-sidebar-toggle-btn"
          style={{
            boxSizing: 'border-box',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            gap: '6px',
            width: collapsed ? '40px' : '100%',
            minHeight: '34px',
            padding: collapsed ? '6px' : '6px 10px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: 'transparent',
            color: 'var(--muted-color)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background-color 0.15s ease, color 0.15s ease',
          }}
        >
          {!collapsed && <span>Thu gọn menu</span>}
          {collapsed ? (
            <PanelLeftOpenIcon size={17} />
          ) : (
            <PanelLeftCloseIcon size={17} />
          )}
        </button>
      </div>

      <nav
        id="desktop-sidebar-nav"
        style={{
          padding: collapsed ? '10px 8px' : '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          overflowY: 'auto',
          overflowX: 'hidden',
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
          const itemsSummary = group.items.map((i) => i.label).join(', ');
          return (
            <button
              key={group.id}
              type="button"
              data-testid={`sidebar-nav-${group.id}`}
              data-active={isGroupActive ? 'true' : 'false'}
              aria-label={group.title}
              aria-current={isGroupActive ? 'page' : undefined}
              onClick={() => onNavigate(group.items[0]?.path || group.path)}
              title={
                collapsed ? `${group.title} — ${itemsSummary}` : itemsSummary
              }
              className="desktop-sidebar-nav-btn"
              style={{
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: collapsed ? '0px' : '10px',
                padding: collapsed ? '9px 0' : '9px 12px',
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
                className={collapsed ? 'sr-only' : undefined}
                style={
                  collapsed
                    ? undefined
                    : {
                        fontSize: '13.5px',
                        lineHeight: 1.2,
                        color: isGroupActive
                          ? 'var(--accent-text)'
                          : 'var(--text-color)',
                        fontWeight: isGroupActive ? 600 : 500,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }
                }
              >
                {group.title}
              </span>
            </button>
          );
        })}
      </nav>

      <div
        data-testid="sidebar-user-footer"
        style={{
          padding: collapsed ? '10px 8px' : '10px 10px 8px 10px',
          borderTop: '1px solid var(--border-color)',
          fontSize: '12px',
          color: 'var(--muted-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <button
          type="button"
          data-testid="sidebar-user-profile-btn"
          onClick={() => onNavigate('/settings#profile')}
          aria-label={`${userSummary.displayName} ${userSummary.secondaryText} — Hồ sơ cá nhân & Đổi mật khẩu`}
          title={
            collapsed
              ? `${userSummary.displayName} (${userSummary.secondaryText}) — Bấm để mở Hồ sơ cá nhân & Đổi mật khẩu`
              : 'Mở hồ sơ cá nhân, đổi tên hiển thị & mật khẩu'
          }
          className="desktop-sidebar-user-btn"
          style={{
            boxSizing: 'border-box',
            width: '100%',
            minHeight: '42px',
            padding: collapsed ? '4px 0' : '6px 8px',
            borderRadius: '8px',
            border: '1px solid transparent',
            backgroundColor:
              currentPath === '/settings'
                ? 'var(--accent-soft)'
                : 'transparent',
            color: 'var(--text-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: collapsed ? '0px' : '10px',
            textAlign: 'left',
            cursor: 'pointer',
            transition: 'background-color 0.15s ease, color 0.15s ease',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: 'relative',
              width: '32px',
              height: '32px',
              borderRadius: '999px',
              backgroundColor: 'var(--surface-subtle)',
              border: '1px solid var(--border-color)',
              color: 'var(--accent-text)',
              fontSize: '12px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {userSummary.initials}
            <span
              style={{
                position: 'absolute',
                right: '-1px',
                bottom: '-1px',
                width: '8px',
                height: '8px',
                borderRadius: '999px',
                backgroundColor: 'var(--success-color)',
                border: '1.5px solid var(--surface-color)',
              }}
            />
          </span>
          <span
            className={collapsed ? 'sr-only' : undefined}
            style={
              collapsed
                ? undefined
                : {
                    minWidth: 0,
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1px',
                  }
            }
          >
            <strong
              data-testid="sidebar-user-display-name"
              style={{
                fontSize: '13px',
                lineHeight: 1.25,
                fontWeight: 600,
                color: 'var(--text-color)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {userSummary.displayName}
            </strong>
            <span
              data-testid="sidebar-user-role-label"
              style={{
                fontSize: '12px',
                lineHeight: 1.2,
                color:
                  currentPath === '/settings'
                    ? 'var(--text-secondary)'
                    : 'var(--muted-color)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {userSummary.secondaryText}
            </span>
          </span>
        </button>

        {!collapsed && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '4px',
            }}
          >
            <button
              type="button"
              data-testid="sidebar-user-edit-profile"
              onClick={() => onNavigate('/settings#profile')}
              className="desktop-sidebar-user-btn"
              style={{
                boxSizing: 'border-box',
                minHeight: '30px',
                padding: '4px 6px',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--surface-subtle)',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                transition: 'background-color 0.15s ease, color 0.15s ease',
              }}
            >
              Hồ sơ / Tên
            </button>
            <button
              type="button"
              data-testid="sidebar-user-change-password"
              onClick={() => onNavigate('/settings#password')}
              className="desktop-sidebar-user-btn"
              style={{
                boxSizing: 'border-box',
                minHeight: '30px',
                padding: '4px 6px',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--surface-subtle)',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                transition: 'background-color 0.15s ease, color 0.15s ease',
              }}
            >
              Mật khẩu
            </button>
          </div>
        )}

        <div
          className={collapsed ? 'sr-only' : undefined}
          style={
            collapsed
              ? undefined
              : {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '2px 4px 0 4px',
                  fontSize: '11px',
                  color: 'var(--muted-color)',
                }
          }
        >
          <span>Management Lite</span>
          <span>v{version}</span>
        </div>
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
      (item.id === 'issues' ||
        item.id === 'finance' ||
        item.id === 'print-quotes') &&
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
          'print-quotes': 'Báo giá',
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
