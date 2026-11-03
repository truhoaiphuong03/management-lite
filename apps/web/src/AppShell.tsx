import React, { useEffect, useState } from 'react';
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
import { enableResponsiveTables } from './responsive-tables.js';
import { enableFormLabelling } from './a11y-forms.js';

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

const NON_KEYBOARD_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'file',
  'hidden',
  'range',
  'color',
  'image',
]);

function isMobileKeyboardEditableTarget(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) {
    return !el.disabled && !el.readOnly;
  }
  if (el instanceof HTMLInputElement) {
    const inputType = (el.type || 'text').toLowerCase();
    return (
      !NON_KEYBOARD_INPUT_TYPES.has(inputType) && !el.disabled && !el.readOnly
    );
  }
  return el.isContentEditable;
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
  const [isMobileKeyboardOpen, setIsMobileKeyboardOpen] = useState(false);

  useEffect(
    () => enableResponsiveTables(document.getElementById('main-content')),
    [],
  );

  useEffect(
    () => enableFormLabelling(document.getElementById('main-content')),
    [],
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    let blurTimer: ReturnType<typeof setTimeout> | null = null;
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    let hadNativeVvShrink = false;

    const isCompactMobileScreen = () =>
      window.innerWidth <= 768 ||
      (window.innerWidth <= 932 && window.innerHeight <= 520);

    const scrollFocusedInputIntoVisibleArea = () => {
      const active = document.activeElement;
      if (!isCompactMobileScreen() || !isMobileKeyboardEditableTarget(active)) {
        return;
      }
      const vv = window.visualViewport;
      const viewTop = vv ? vv.offsetTop : 0;
      const viewHeight = vv ? vv.height : window.innerHeight;
      const safeTop = viewTop + 52;
      const safeBottom = viewTop + viewHeight - 16;
      if (safeBottom <= safeTop) return;

      const computeDelta = (r: DOMRect): number => {
        if (r.bottom > safeBottom) return r.bottom - safeBottom;
        if (r.top < safeTop) return r.top - safeTop;
        return 0;
      };

      const initialDelta = computeDelta(active.getBoundingClientRect());
      if (initialDelta === 0) return;

      // Tier 1: Window scroll (handles iOS visualViewport + standard root scroller)
      window.scrollBy(0, initialDelta);

      // Tier 2: Scrollable ancestor container (handles body overflow-x:hidden & modal containers)
      const remDelta = computeDelta(active.getBoundingClientRect());
      if (remDelta !== 0) {
        let node: HTMLElement | null = active.parentElement;
        while (node) {
          if (node.scrollHeight > node.clientHeight) {
            const prevTop = node.scrollTop;
            node.scrollTop += remDelta;
            if (node.scrollTop !== prevTop) break;
          }
          node = node.parentElement;
        }
      }

      // Tier 3: Native scrollIntoView fallback if still outside visible band
      if (
        computeDelta(active.getBoundingClientRect()) !== 0 &&
        typeof active.scrollIntoView === 'function'
      ) {
        active.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    };

    const syncKeyboardState = (shouldEnsureScroll: boolean) => {
      const mobile = isCompactMobileScreen();
      const editableFocused = isMobileKeyboardEditableTarget(
        document.activeElement,
      );
      const vv = window.visualViewport;
      const vvShrink = vv ? window.innerHeight - vv.height : 0;

      if (mobile && editableFocused && vvShrink >= 100) {
        hadNativeVvShrink = true;
      }
      if (!editableFocused || !mobile) {
        hadNativeVvShrink = false;
      }

      const dismissedViaAccessoryBar =
        hadNativeVvShrink && vv !== null && vvShrink < 60;
      const nextOpen = mobile && editableFocused && !dismissedViaAccessoryBar;

      document.documentElement.setAttribute(
        'data-mobile-keyboard',
        nextOpen ? 'open' : 'closed',
      );
      setIsMobileKeyboardOpen(nextOpen);

      if (nextOpen && shouldEnsureScroll) {
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => {
            scrollFocusedInputIntoVisibleArea();
          });
        } else {
          scrollFocusedInputIntoVisibleArea();
        }
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          scrollFocusedInputIntoVisibleArea();
        }, 60);
      }
    };

    const handleFocusIn = () => {
      if (blurTimer) {
        clearTimeout(blurTimer);
        blurTimer = null;
      }
      syncKeyboardState(true);
    };

    const handleFocusOut = () => {
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        syncKeyboardState(false);
      }, 80);
    };

    const handleViewportChange = () => {
      syncKeyboardState(true);
    };

    const handleOrientationChange = () => {
      hadNativeVvShrink = false;
      syncKeyboardState(true);
    };

    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleOrientationChange);
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', handleViewportChange);
    }

    syncKeyboardState(false);

    return () => {
      if (blurTimer) clearTimeout(blurTimer);
      if (scrollTimer) clearTimeout(scrollTimer);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('orientationchange', handleOrientationChange);
      if (vv) {
        vv.removeEventListener('resize', handleViewportChange);
      }
      document.documentElement.removeAttribute('data-mobile-keyboard');
    };
  }, []);

  const handleMobileNav = (path: string) => {
    setIsMoreOpen(false);
    onNavigate(path);
  };

  const itemMap = new Map(NAV_ITEMS.map((item) => [item.id, item]));

  const isItemVisibleForRole = (item: (typeof NAV_ITEMS)[number]): boolean => {
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

  const activeGroup = NAV_GROUPS.find((group) => {
    if (currentPath === group.path) return true;
    return group.itemIds.some((id) => {
      const item = itemMap.get(id);
      if (!item || !isItemVisibleForRole(item)) return false;
      if (item.path === '/') return currentPath === '/';
      return (
        currentPath === item.path || currentPath.startsWith(item.path + '/')
      );
    });
  });

  const subNavItems = activeGroup
    ? activeGroup.itemIds
        .map((id) => itemMap.get(id))
        .filter(
          (item): item is (typeof NAV_ITEMS)[number] =>
            Boolean(item) &&
            isItemVisibleForRole(item!) &&
            item!.id !== 'audit' &&
            item!.id !== 'system-logs',
        )
    : [];
  const isIssuesOrLogsRoute =
    role === 'owner' &&
    (currentPath === '/issues' ||
      currentPath.startsWith('/issues/') ||
      currentPath === '/system-logs' ||
      currentPath === '/audit');
  const isDetailSubRoute =
    /^\/(work|employees|accounts|storage|issues|payroll|finance)\/[^/]+/.test(
      currentPath,
    ) &&
    currentPath !== '/attendance/review' &&
    currentPath !== '/attendance/corrections' &&
    currentPath !== '/reports/new';

  const moreGroups = NAV_GROUPS.map((group) => {
    const items = group.itemIds
      .map((id) => itemMap.get(id))
      .filter((item): item is (typeof NAV_ITEMS)[number] => {
        if (!item) return false;
        // Items not in primary bottom tabs
        const isPrimary = ['/', '/clock', '/reports'].includes(item.path);
        if (isPrimary) return false;
        return isItemVisibleForRole(item);
      });
    return {
      ...group,
      items,
    };
  }).filter((group) => group.items.length > 0);

  return (
    <div
      className="app-shell-root"
      data-mobile-keyboard={isMobileKeyboardOpen ? 'open' : 'closed'}
      style={{
        display: 'flex',
        minHeight: '100vh',
        width: '100%',
        maxWidth: '100%',
        backgroundColor: 'var(--bg-color, #0B1220)',
        color: 'var(--text-color, #F8FAFC)',
      }}
    >
      <a href="#main-content" className="skip-link">
        Bỏ qua tới nội dung chính
      </a>
      {/* Real Session Top Header */}
      <header
        className="app-shell-header"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '44px',
          backgroundColor: 'var(--surface-color, #151F30)',
          borderBottom: '1px solid var(--border-color, #334155)',
          color: 'var(--text-color, #F8FAFC)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          padding: '0 16px',
          fontSize: '13px',
          fontWeight: 600,
          zIndex: 100,
          boxSizing: 'border-box',
        }}
      >
        <div
          className="app-shell-header-left"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            minWidth: 0,
            flexShrink: 1,
          }}
        >
          <BuildingIcon
            size={18}
            style={{ color: 'var(--accent-text)', flexShrink: 0 }}
          />
          <span
            className="app-shell-brand-title"
            style={{
              color: 'var(--text-color)',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            Management Lite
          </span>
          <span
            className="app-shell-role-badge"
            style={{
              padding: '3px 10px',
              borderRadius: '9999px',
              backgroundColor:
                role === 'owner'
                  ? 'rgba(20, 184, 166, 0.15)'
                  : 'rgba(56, 189, 248, 0.15)',
              color:
                role === 'owner' ? 'var(--accent-text)' : 'var(--info-text)',
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
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {role === 'owner' ? (
              <CrownIcon size={13} />
            ) : (
              <UserIcon size={13} />
            )}
            <span className="app-shell-role-text">
              {role === 'owner' ? 'Chủ sở hữu' : 'Nhân viên'}
            </span>
          </span>
        </div>
        <div
          className="app-shell-header-actions"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            data-testid="header-btn-settings"
            aria-label="Đổi mật khẩu / Cài đặt"
            onClick={() => onNavigate('/settings')}
            title="Cài đặt tài khoản & Đổi mật khẩu"
            className="app-shell-header-btn"
            style={{
              boxSizing: 'border-box',
              minHeight: '36px',
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              backgroundColor:
                currentPath === '/settings'
                  ? 'rgba(20, 184, 166, 0.2)'
                  : 'transparent',
              color: 'var(--accent-text)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
              transition:
                'background-color 0.15s ease, border-color 0.15s ease',
            }}
          >
            <LockIcon size={13} />
            <span>
              <span className="header-settings-prefix">Đổi mật khẩu / </span>
              Cài đặt
            </span>
          </button>
          {onLogout && (
            <button
              type="button"
              aria-label="Đăng xuất"
              onClick={onLogout}
              className="app-shell-header-btn"
              style={{
                boxSizing: 'border-box',
                minHeight: '36px',
                padding: '4px 10px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'transparent',
                color: 'var(--danger-text)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap',
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
        id="main-content"
        tabIndex={-1}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          margin: '44px auto 0 auto',
          padding:
            '20px 20px calc(84px + env(safe-area-inset-bottom, 0px)) 20px',
          maxWidth: '1240px',
          width: '100%',
          overflowX: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        <div
          className={`app-shell-content${
            subNavItems.length > 1 &&
            !/^\/(work|employees|accounts|storage|issues)\/[^/]+/.test(
              currentPath,
            )
              ? ' has-subnav'
              : ''
          }`}
          style={{ flex: 1, minWidth: 0, width: '100%' }}
        >
          {isDetailSubRoute && (
            <Breadcrumb
              currentPath={currentPath}
              onNavigate={onNavigate}
              role={role}
            />
          )}
          {subNavItems.length > 1 && (
            <nav
              aria-label="Điều hướng phân hệ"
              className="app-subnav-bar"
              data-testid="app-subnav-bar"
            >
              {subNavItems.map((item) => {
                const isItemActive =
                  item.path === '/attendance'
                    ? currentPath === '/attendance'
                    : item.path === '/issues'
                      ? currentPath === '/issues' ||
                        currentPath.startsWith('/issues/') ||
                        currentPath === '/system-logs' ||
                        currentPath === '/audit'
                      : currentPath === item.path ||
                        currentPath.startsWith(item.path + '/');
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="app-subnav-item"
                    data-active={isItemActive ? 'true' : 'false'}
                    onClick={() => onNavigate(item.path)}
                  >
                    <NavIcon id={item.id} size={15} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          )}
          {isIssuesOrLogsRoute && (
            <div
              data-testid="issues-logs-subswitcher"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                flexWrap: 'wrap',
                padding: '4px',
                marginBottom: '14px',
                borderRadius: '8px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {[
                {
                  id: 'issues',
                  label: 'Phiếu báo lỗi',
                  path: '/issues',
                  active:
                    currentPath === '/issues' ||
                    currentPath.startsWith('/issues/'),
                },
                {
                  id: 'system-logs',
                  label: 'Nhật ký hệ thống',
                  path: '/system-logs',
                  active: currentPath === '/system-logs',
                },
                {
                  id: 'audit',
                  label: 'Nhật ký Audit (Bảo mật)',
                  path: '/audit',
                  active: currentPath === '/audit',
                },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`subswitch-${tab.id}`}
                  onClick={() => onNavigate(tab.path)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor: tab.active
                      ? 'rgba(20, 184, 166, 0.16)'
                      : 'transparent',
                    color: tab.active
                      ? 'var(--accent-text)'
                      : 'var(--muted-color)',
                  }}
                >
                  <NavIcon id={tab.id} size={14} />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          )}
          {children}
        </div>

        {/* Global Bug Report Widget (UI-REPORT-01): docked in-flow below content on mobile so it NEVER overlaps primary CTAs */}
        <div
          className="app-shell-report-dock"
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            width: '100%',
            marginTop: '20px',
            paddingTop: '4px',
            boxSizing: 'border-box',
          }}
        >
          <ReportBugWidget
            currentPath={currentPath}
            csrfToken={csrfToken}
            userId={userId}
            workspaceId={workspaceId}
          />
        </div>
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
            backgroundColor: 'var(--overlay-bg, rgba(11, 18, 32, 0.85))',
            backdropFilter: 'blur(4px)',
            zIndex: 40,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            overscrollBehavior: 'contain',
          }}
          onClick={() => setIsMoreOpen(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--surface-color, #151F30)',
              borderTop: '1px solid var(--border-color, #334155)',
              borderTopLeftRadius: '16px',
              borderTopRightRadius: '16px',
              padding:
                '20px 16px calc(84px + env(safe-area-inset-bottom, 0px)) 16px',
              maxHeight: '75vh',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
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
                borderBottom: '1px solid var(--border-color, #334155)',
              }}
            >
              <h3
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--text-color, #F8FAFC)',
                }}
              >
                Tất cả chức năng ({role === 'owner' ? 'Owner' : 'Staff'})
              </h3>
              <button
                type="button"
                aria-label="Đóng menu"
                onClick={() => setIsMoreOpen(false)}
                style={{
                  boxSizing: 'border-box',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: 'var(--muted-color, #94A3B8)',
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
                    color: 'var(--muted-color)',
                    marginBottom: '8px',
                    userSelect: 'none',
                  }}
                >
                  {group.title}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fit, minmax(min(100%, 140px), 1fr))',
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
                            : 'var(--border-color, #334155)',
                        backgroundColor:
                          currentPath === item.path
                            ? 'rgba(20, 184, 166, 0.15)'
                            : 'var(--bg-color, #0B1220)',
                        color:
                          currentPath === item.path
                            ? 'var(--accent-text)'
                            : 'var(--text-color, #F8FAFC)',
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
                borderTop: '1px solid var(--border-color, #334155)',
                textAlign: 'center',
                fontSize: '11px',
                color: 'var(--muted-color)',
              }}
            >
              Management Lite v{SYSTEM_VERSION}
            </div>
          </div>
        </div>
      )}

      {/* Responsive styles */}
      <style>{`
        .app-shell-report-dock .btn-floating-report-bug {
          position: fixed;
          z-index: 900;
        }
        html[data-mobile-keyboard="open"] .mobile-bottom-nav-wrapper,
        .app-shell-root[data-mobile-keyboard="open"] .mobile-bottom-nav-wrapper,
        html[data-mobile-keyboard="open"] .app-shell-report-dock .btn-floating-report-bug,
        .app-shell-root[data-mobile-keyboard="open"] .app-shell-report-dock .btn-floating-report-bug,
        html[data-mobile-keyboard="open"] .btn-floating-report-bug {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
          transition: none !important;
        }
        @media (min-width: 769px) {
          .mobile-bottom-nav-wrapper {
            display: none !important;
          }
          main {
            outline: none;
            margin-bottom: 24px !important;
            padding: 32px !important;
          }
        }
        @media (max-width: 768px) {
          .desktop-sidebar-wrapper {
            display: none !important;
          }
          main {
            padding: 12px 12px calc(132px + env(safe-area-inset-bottom, 0px)) 12px !important;
          }
          .app-shell-header {
            padding: 0 max(10px, env(safe-area-inset-right, 10px)) 0 max(10px, env(safe-area-inset-left, 10px)) !important;
            gap: 6px !important;
          }
          .header-settings-prefix {
            display: none !important;
          }
          .app-shell-header-btn {
            padding: 4px 8px !important;
            font-size: 11px !important;
          }
          .app-shell-role-badge {
            padding: 2px 7px !important;
            font-size: 11px !important;
          }
        }
        @media (max-width: 380px) {
          .app-shell-role-text {
            display: none !important;
          }
          .app-shell-role-badge {
            padding: 4px 6px !important;
          }
        }
      `}</style>
    </div>
  );
};
