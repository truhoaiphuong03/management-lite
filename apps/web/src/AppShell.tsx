import React, { useState } from 'react';
import {
  DesktopSidebar,
  MobileBottomNav,
  NAV_ITEMS,
} from '@management-lite/ui/components';
import type { UserRole } from './types.js';

export interface AppShellProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  role: UserRole;
  onLogout?: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentPath,
  onNavigate,
  role,
  onLogout,
  children,
}) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const handleMobileNav = (path: string) => {
    setIsMoreOpen(false);
    onNavigate(path);
  };

  const moreItems = NAV_ITEMS.filter((item) => {
    // Items not in primary bottom tabs
    const isPrimary = ['/', '/clock', '/reports'].includes(item.path);
    if (isPrimary) return false;
    if (role === 'staff' && item.ownerOnly) return false;
    if (role === 'owner' && (item.staffOnly || item.id === 'my-pay'))
      return false;
    return true;
  });

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
          <span style={{ fontSize: '18px' }}>🏢</span>
          <span style={{ color: '#F8FAFC', fontWeight: 700 }}>
            Management Lite
          </span>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '9999px',
              backgroundColor:
                role === 'owner'
                  ? 'rgba(20, 184, 166, 0.2)'
                  : 'rgba(56, 189, 248, 0.2)',
              color: role === 'owner' ? '#14B8A6' : '#38BDF8',
              fontSize: '11px',
              fontWeight: 700,
            }}
          >
            {role === 'owner'
              ? '👑 Chủ sở hữu (Owner)'
              : '👤 Nhân viên (Staff)'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              style={{
                minHeight: '32px',
                padding: '4px 12px',
                borderRadius: '6px',
                border: '1px solid #475569',
                backgroundColor: 'transparent',
                color: '#EF4444',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Đăng xuất
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
        {children}
      </main>

      {/* Mobile Bottom Navigation */}
      <div className="mobile-bottom-nav-wrapper">
        <MobileBottomNav
          currentPath={currentPath}
          onNavigate={handleMobileNav}
          onOpenMore={() => setIsMoreOpen(!isMoreOpen)}
          isMoreOpen={isMoreOpen}
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
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: '#94A3B8',
                  fontSize: '20px',
                  cursor: 'pointer',
                  minHeight: '44px',
                  minWidth: '44px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
              }}
            >
              {moreItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleMobileNav(item.path)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #334155',
                    backgroundColor:
                      currentPath === item.path
                        ? 'rgba(20, 184, 166, 0.15)'
                        : '#0B1220',
                    color: currentPath === item.path ? '#14B8A6' : '#F8FAFC',
                    fontSize: '13px',
                    fontWeight: 600,
                    textAlign: 'left',
                    cursor: 'pointer',
                    minHeight: '44px',
                  }}
                >
                  <span style={{ fontSize: '20px' }}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
