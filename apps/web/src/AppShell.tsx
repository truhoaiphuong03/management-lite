import React, { useState } from 'react';
import {
  DesktopSidebar,
  MobileBottomNav,
  NAV_ITEMS,
  NAV_GROUPS,
  BuildingIcon,
  CrownIcon,
  UserIcon,
  LogOutIcon,
  CloseIcon,
  NavIcon,
  Breadcrumb,
  LockIcon,
} from '../../../packages/ui/src/components/index.js';
import type { UserRole } from './types.js';
import { ReportBugWidget } from './components/ReportBugWidget.js';
import { SYSTEM_VERSION } from '../../../packages/contracts/src/version.js';

export interface AppShellProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  role: UserRole;
  isOwnerVerified?: boolean | undefined;
  onLogout?: () => void;
  csrfToken?: string | undefined;
  userId?: string | undefined;
  workspaceId?: string | undefined;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentPath,
  onNavigate,
  role,
  isOwnerVerified,
  onLogout,
  csrfToken,
  userId,
  workspaceId,
  children,
}) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const handleMobileNav = (path: string) => {
    setIsMoreOpen(false);
    onNavigate(path);
  };

  const itemMap = new Map(NAV_ITEMS.map((item) => [item.id, item]));

  const moreGroups = NAV_GROUPS.map((group) => {
    const items = group.itemIds
      .map((id) => itemMap.get(id))
      .filter((item): item is (typeof NAV_ITEMS)[number] => {
        if (!item) return false;
        // Items not in primary bottom tabs
        const isPrimary = ['/', '/clock', '/reports'].includes(item.path);
        if (isPrimary) return false;
        if (
          (item.id === 'issues' || item.id === 'finance') &&
          (isOwnerVerified !== true || role !== 'owner')
        )
          return false;
        if (role === 'staff' && item.ownerOnly) return false;
        if (role === 'owner' && (item.staffOnly || item.id === 'my-pay'))
          return false;
        return true;
      });
    return {
      ...group,
      items,
    };
  }).filter((group) => group.items.length > 0);

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        backgroundColor: '#0B1220',
      }}
    >
      {/* Real Session Top Header */}
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '44px',
          backgroundColor: '#151F30',
          borderBottom: '1px solid #334155',
          color: '#F8FAFC',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          fontSize: '13px',
          fontWeight: 600,
          zIndex: 100,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BuildingIcon size={18} style={{ color: '#14B8A6' }} />
          <span style={{ color: '#F8FAFC', fontWeight: 700 }}>
            Management Lite
          </span>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: '9999px',
              backgroundColor:
                role === 'owner'
                  ? 'rgba(20, 184, 166, 0.15)'
                  : 'rgba(56, 189, 248, 0.15)',
              color: role === 'owner' ? '#14B8A6' : '#38BDF8',
              border: `1px solid ${
                role === 'owner'
                  ? 'rgba(20, 184, 166, 0.3)'
                  : 'rgba(56, 189, 248, 0.3)'
              }`,
              fontSize: '11px',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            {role === 'owner' ? (
              <CrownIcon size={13} />
            ) : (
              <UserIcon size={13} />
            )}
            <span>{role === 'owner' ? 'Chủ sở hữu' : 'Nhân viên'}</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            data-testid="header-btn-settings"
            onClick={() => onNavigate('/settings')}
            title="Cài đặt tài khoản & Đổi mật khẩu"
            style={{
              boxSizing: 'border-box',
              minHeight: '32px',
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid rgba(20, 184, 166, 0.4)',
              backgroundColor:
                currentPath === '/settings'
                  ? 'rgba(20, 184, 166, 0.2)'
                  : 'rgba(20, 184, 166, 0.08)',
              color: '#14B8A6',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              transition:
                'background-color 0.15s ease, border-color 0.15s ease',
            }}
          >
            <LockIcon size={13} />
            <span>Đổi mật khẩu / Cài đặt</span>
          </button>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              style={{
                boxSizing: 'border-box',
                minHeight: '32px',
                padding: '4px 10px',
                borderRadius: '6px',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                backgroundColor: 'rgba(239, 68, 68, 0.05)',
                color: '#EF4444',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition:
                  'background-color 0.15s ease, border-color 0.15s ease',
              }}
            >
              <LogOutIcon size={13} />
              <span>Đăng xuất</span>
            </button>
          )}
        </div>
      </header>

      {/* Desktop Sidebar (hidden on mobile via CSS media query in style) */}
      <div className="desktop-sidebar-wrapper" style={{ marginTop: '44px' }}>
        <DesktopSidebar
          currentPath={currentPath}
          onNavigate={onNavigate}
          role={role}
          isOwnerVerified={isOwnerVerified === true}
        />
      </div>

      {/* Main Content Area */}
      <main
        style={{
          flex: 1,
          marginTop: '44px',
          marginBottom: '68px', // Space for mobile bottom nav
          padding: '20px 16px',
          maxWidth: '1200px',
          width: '100%',
          overflowX: 'hidden', // Prevent horizontal overflow at 360/390/430px
        }}
      >
        <Breadcrumb
          currentPath={currentPath}
          onNavigate={onNavigate}
          role={role}
        />
        {children}
      </main>

      {/* Mobile Bottom Navigation */}
      <div className="mobile-bottom-nav-wrapper">
        <MobileBottomNav
          currentPath={currentPath}
          onNavigate={handleMobileNav}
          onOpenMore={() => setIsMoreOpen(!isMoreOpen)}
          isMoreOpen={isMoreOpen}
          role={role}
          isOwnerVerified={isOwnerVerified}
        />
      </div>

      {/* Mobile "More" Drawer / Modal */}
      {isMoreOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(11, 18, 32, 0.85)',
            backdropFilter: 'blur(4px)',
            zIndex: 40,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
          onClick={() => setIsMoreOpen(false)}
        >
          <div
            style={{
              backgroundColor: '#151F30',
              borderTop: '1px solid #334155',
              borderTopLeftRadius: '16px',
              borderTopRightRadius: '16px',
              padding: '20px 16px 80px 16px',
              maxHeight: '75vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                paddingBottom: '12px',
                borderBottom: '1px solid #334155',
              }}
            >
              <h3
                style={{ fontSize: '16px', fontWeight: 700, color: '#F8FAFC' }}
              >
                Tất cả chức năng ({role === 'owner' ? 'Owner' : 'Staff'})
              </h3>
              <button
                type="button"
                onClick={() => setIsMoreOpen(false)}
                style={{
                  boxSizing: 'border-box',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: '#94A3B8',
                  cursor: 'pointer',
                  minHeight: '44px',
                  minWidth: '44px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            {moreGroups.map((group, groupIndex) => (
              <div
                key={group.id}
                style={{
                  marginTop: groupIndex === 0 ? '0' : '16px',
                }}
              >
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: '#64748B',
                    marginBottom: '8px',
                    userSelect: 'none',
                  }}
                >
                  {group.title}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                  }}
                >
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleMobileNav(item.path)}
                      style={{
                        boxSizing: 'border-box',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '12px',
                        borderRadius: '8px',
                        border: '1px solid',
                        borderColor:
                          currentPath === item.path
                            ? 'rgba(20, 184, 166, 0.3)'
                            : '#334155',
                        backgroundColor:
                          currentPath === item.path
                            ? 'rgba(20, 184, 166, 0.15)'
                            : '#0B1220',
                        color:
                          currentPath === item.path ? '#14B8A6' : '#F8FAFC',
                        fontSize: '13px',
                        fontWeight: 600,
                        textAlign: 'left',
                        cursor: 'pointer',
                        minHeight: '44px',
                        transition:
                          'background-color 0.15s ease, border-color 0.15s ease',
                      }}
                    >
                      <NavIcon id={item.id} size={20} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div
              style={{
                marginTop: '20px',
                paddingTop: '12px',
                borderTop: '1px solid #334155',
                textAlign: 'center',
                fontSize: '11px',
                color: '#64748B',
              }}
            >
              Management Lite v{SYSTEM_VERSION}
            </div>
          </div>
        </div>
      )}

      {/* Global Floating Bug Report Widget (UI-REPORT-01) */}
      <ReportBugWidget
        currentPath={currentPath}
        csrfToken={csrfToken}
        userId={userId}
        workspaceId={workspaceId}
      />

      {/* Responsive styles */}
      <style>{`
        @media (min-width: 769px) {
          .mobile-bottom-nav-wrapper {
            display: none !important;
          }
          main {
            margin-bottom: 24px !important;
            padding: 32px 32px !important;
          }
        }
        @media (max-width: 768px) {
          .desktop-sidebar-wrapper {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
};
