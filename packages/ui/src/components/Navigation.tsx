import React from 'react';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: string;
  ownerOnly?: boolean;
  staffOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Tổng quan', path: '/', icon: '📊' },
  { id: 'clock', label: 'Chấm công', path: '/clock', icon: '⏱️' },
  { id: 'reports', label: 'Báo cáo', path: '/reports', icon: '📝' },
  { id: 'attendance', label: 'Lịch sử công', path: '/attendance', icon: '📅' },
  {
    id: 'attendance-review',
    label: 'Duyệt công',
    path: '/attendance/review',
    icon: '✅',
    ownerOnly: true,
  },
  {
    id: 'employees',
    label: 'Nhân sự',
    path: '/employees',
    icon: '👥',
    ownerOnly: true,
  },
  {
    id: 'payroll',
    label: 'Bảng lương',
    path: '/payroll',
    icon: '💰',
    ownerOnly: true,
  },
  {
    id: 'my-pay',
    label: 'Lương cá nhân',
    path: '/my-pay',
    icon: '💵',
    staffOnly: true,
  },
  {
    id: 'accounts',
    label: 'Tài khoản ACC',
    path: '/accounts',
    icon: '🔐',
    ownerOnly: true,
  },
  {
    id: 'audit',
    label: 'Nhật ký Audit',
    path: '/audit',
    icon: '📋',
    ownerOnly: true,
  },
  { id: 'settings', label: 'Cài đặt', path: '/settings', icon: '⚙️' },
];

export interface DesktopSidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  role: 'owner' | 'staff';
}

export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  currentPath,
  onNavigate,
  role,
}) => {
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (role === 'staff' && item.ownerOnly) return false;
    if (role === 'owner' && (item.staffOnly || item.id === 'my-pay'))
      return false; // C04/PAY-02: Owner has no payroll entry
    return true;
  });

  return (
    <aside
      style={{
        width: '240px',
        backgroundColor: '#151F30',
        borderRight: '1px solid #334155',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: 'sticky',
        top: 0,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          padding: '20px 16px',
          borderBottom: '1px solid #334155',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <span style={{ fontSize: '24px' }}>🏢</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: '15px', color: '#F8FAFC' }}>
            Management Lite
          </div>
          <div style={{ fontSize: '12px', color: '#14B8A6', fontWeight: 600 }}>
            V0.1 Demo
          </div>
        </div>
      </div>

      <nav
        style={{
          padding: '16px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          overflowY: 'auto',
          flex: 1,
        }}
        aria-label="Desktop navigation"
      >
        {visibleItems.map((item) => {
          const isActive = currentPath === item.path;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.path)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 12px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: isActive
                  ? 'rgba(20, 184, 166, 0.15)'
                  : 'transparent',
                color: isActive ? '#14B8A6' : '#94A3B8',
                fontWeight: isActive ? 600 : 500,
                fontSize: '14px',
                textAlign: 'left',
                cursor: 'pointer',
                minHeight: '44px',
                width: '100%',
                transition: 'background-color 0.15s ease, color 0.15s ease',
              }}
            >
              <span style={{ fontSize: '18px' }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div
        style={{
          padding: '16px',
          borderTop: '1px solid #334155',
          fontSize: '12px',
          color: '#94A3B8',
        }}
      >
        <div>
          Vai trò demo:{' '}
          <strong style={{ color: '#F8FAFC', textTransform: 'capitalize' }}>
            {role}
          </strong>
        </div>
        <div style={{ marginTop: '2px', color: '#F59E0B' }}>
          ● Demo presentation
        </div>
      </div>
    </aside>
  );
};

export interface MobileBottomNavProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onOpenMore: () => void;
  isMoreOpen: boolean;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentPath,
  onNavigate,
  onOpenMore,
  isMoreOpen,
}) => {
  // Mobile bottom navigation max 4 primary destinations: Dashboard, Clock, Reports, More
  const primaryTabs = [
    { label: 'Tổng quan', path: '/', icon: '📊' },
    { label: 'Chấm công', path: '/clock', icon: '⏱️' },
    { label: 'Báo cáo', path: '/reports', icon: '📝' },
  ];

  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '60px',
        backgroundColor: '#151F30',
        borderTop: '1px solid #334155',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        zIndex: 50,
      }}
      aria-label="Mobile bottom navigation"
    >
      {primaryTabs.map((tab) => {
        const isActive = currentPath === tab.path && !isMoreOpen;
        return (
          <button
            key={tab.path}
            type="button"
            onClick={() => onNavigate(tab.path)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              minHeight: '44px',
              minWidth: '44px',
              border: 'none',
              backgroundColor: 'transparent',
              color: isActive ? '#14B8A6' : '#94A3B8',
              cursor: 'pointer',
              gap: '2px',
            }}
          >
            <span style={{ fontSize: '18px' }}>{tab.icon}</span>
            <span
              style={{ fontSize: '11px', fontWeight: isActive ? 600 : 500 }}
            >
              {tab.label}
            </span>
          </button>
        );
      })}

      <button
        type="button"
        onClick={onOpenMore}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          minHeight: '44px',
          minWidth: '44px',
          border: 'none',
          backgroundColor: 'transparent',
          color: isMoreOpen ? '#14B8A6' : '#94A3B8',
          cursor: 'pointer',
          gap: '2px',
        }}
      >
        <span style={{ fontSize: '18px' }}>☰</span>
        <span style={{ fontSize: '11px', fontWeight: isMoreOpen ? 600 : 500 }}>
          Thêm
        </span>
      </button>
    </nav>
  );
};
