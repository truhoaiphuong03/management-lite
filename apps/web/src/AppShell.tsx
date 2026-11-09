import React, { useEffect, useState } from 'react';
import {
  DesktopSidebar,
  MobileBottomNav,
  NAV_ITEMS,
  NAV_GROUPS,
  resolveSidebarUserSummary,
  BuildingIcon,
  CrownIcon,
  UserIcon,
  LogOutIcon,
  CloseIcon,
  NavIcon,
  Breadcrumb,
  LockIcon,
  SunIcon,
  MoonIcon,
} from '../../../packages/ui/src/components/index.js';
import type { UserRole } from './types.js';
import { ReportBugWidget } from './components/ReportBugWidget.js';
import { SYSTEM_VERSION } from '../../../packages/contracts/src/version.js';
import { enableResponsiveTables } from './responsive-tables.js';
import { enableFormLabelling } from './a11y-forms.js';
import {
  getStoredTheme,
  resolveEffectiveTheme,
  setThemePreference,
  type ThemePreference,
} from './theme.js';

export interface AppShellProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  role: UserRole;
  subRole?: 'admin' | undefined;
  isOwnerVerified?: boolean | undefined;
  onLogout?: () => void;
  csrfToken?: string | undefined;
  userId?: string | undefined;
  userFullName?: string | undefined;
  userUsername?: string | undefined;
  userEmail?: string | undefined;
  employeeCode?: string | undefined;
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

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'mglite_sidebar_collapsed';

export function readStoredSidebarCollapsed(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
    }
  } catch {
    // Ignore storage access errors
  }
  return false;
}

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
  subRole,
  isOwnerVerified,
  onLogout,
  csrfToken,
  userId,
  userFullName,
  userUsername,
  userEmail,
  employeeCode,
  workspaceId,
  children,
}) => {
  const userSummary = resolveSidebarUserSummary({
    role,
    subRole,
    userFullName,
    userUsername,
    userEmail,
    employeeCode,
  });
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isMobileKeyboardOpen, setIsMobileKeyboardOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    readStoredSidebarCollapsed(),
  );
  const [themePref, setThemePref] = useState<ThemePreference>(() =>
    getStoredTheme(),
  );
  const [effectiveTheme, setEffectiveTheme] = useState<'dark' | 'light'>(() =>
    resolveEffectiveTheme(getStoredTheme()),
  );
  const [pendingAssignedTasks, setPendingAssignedTasks] = useState<
    Array<{ id: string; title: string; due_at?: string | null; status: string }>
  >([]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;
    let active = true;
    const loadPendingAssignedWork = async () => {
      try {
        let myEmpId = '';
        let myEmpCode = employeeCode || '';
        const meRes = await fetch('/api/v1/auth/me', {
          credentials: 'include',
        });
        if (meRes.ok) {
          const meJson = await meRes.json().catch(() => null);
          myEmpId = meJson?.data?.employee?.id || '';
          if (!myEmpCode) {
            myEmpCode = meJson?.data?.employee?.employee_code || '';
          }
        }
        const workRes = await fetch('/api/v1/work-items?limit=50', {
          credentials: 'include',
        });
        if (!workRes.ok || !active) return;
        const workJson = await workRes.json().catch(() => null);
        const items: Array<{
          id: string;
          title: string;
          due_at?: string | null;
          status: string;
          assignments?: Array<{
            employee_id?: string;
            employee_code?: string;
            status: string;
          }>;
        }> = Array.isArray(workJson?.data?.items) ? workJson.data.items : [];
        const unfinished = items.filter((item) => {
          if (
            item.status === 'completed' ||
            item.status === 'cancelled' ||
            item.status === 'in_review'
          ) {
            return false;
          }
          const assignments = Array.isArray(item.assignments)
            ? item.assignments
            : [];
          if (myEmpId || myEmpCode) {
            return assignments.some(
              (a) =>
                ((myEmpId && a.employee_id === myEmpId) ||
                  (myEmpCode && a.employee_code === myEmpCode)) &&
                (a.status === 'todo' || a.status === 'in_progress'),
            );
          }
          if (role === 'staff') {
            return assignments.some(
              (a) => a.status === 'todo' || a.status === 'in_progress',
            );
          }
          return false;
        });
        if (active) {
          setPendingAssignedTasks(
            unfinished.map((i) => ({
              id: i.id,
              title: i.title,
              due_at: i.due_at ?? null,
              status: i.status,
            })),
          );
        }
      } catch {
        // Ignore network errors on background reminder check
      }
    };
    void loadPendingAssignedWork();
    const handleWorkUpdated = () => {
      void loadPendingAssignedWork();
    };
    window.addEventListener('mglite:work-updated', handleWorkUpdated);
    return () => {
      active = false;
      window.removeEventListener('mglite:work-updated', handleWorkUpdated);
    };
  }, [role, employeeCode, userId]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.addEventListener !== 'function'
    ) {
      return;
    }
    const syncThemeState = (e?: Event) => {
      const detail = (
        e as CustomEvent<{
          theme?: ThemePreference;
          effectiveTheme?: 'dark' | 'light';
        }>
      )?.detail;
      const nextPref = detail?.theme ?? getStoredTheme();
      const nextEffective =
        detail?.effectiveTheme ?? resolveEffectiveTheme(nextPref);
      setThemePref(nextPref);
      setEffectiveTheme(nextEffective);
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'mglite_theme' || e.key === null) {
        syncThemeState();
      }
      if (e.key === SIDEBAR_COLLAPSED_STORAGE_KEY || e.key === null) {
        setSidebarCollapsed(readStoredSidebarCollapsed());
      }
    };
    syncThemeState();
    window.addEventListener('mglite:theme-change', syncThemeState);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('mglite:theme-change', syncThemeState);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const handleToggleSidebarCollapse = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
        }
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  const handleToggleTheme = () => {
    const nextTheme: ThemePreference =
      effectiveTheme === 'dark' ? 'light' : 'dark';
    setThemePreference(nextTheme);
  };

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
    let rafId: number | null = null;
    const scrollTimers: Array<ReturnType<typeof setTimeout>> = [];
    let hadNativeVvShrink = false;

    const clearPendingScrollWork = () => {
      if (rafId !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      while (scrollTimers.length > 0) {
        const t = scrollTimers.pop();
        if (t !== undefined) clearTimeout(t);
      }
    };

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
      const viewHeight =
        vv && vv.height > 0
          ? Math.min(window.innerHeight, vv.height)
          : window.innerHeight;
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

      // Tier 1: Instant window scroll (cancels any ongoing smooth scroll immediately)
      try {
        window.scrollBy({
          top: initialDelta,
          left: 0,
          behavior: 'instant' as ScrollBehavior,
        });
      } catch {
        window.scrollBy(0, initialDelta);
      }

      // Tier 1b: Explicit document.scrollingElement fallback
      const rootDelta = computeDelta(active.getBoundingClientRect());
      if (rootDelta !== 0 && document.scrollingElement) {
        document.scrollingElement.scrollTop += rootDelta;
      }

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

      // Tier 3: Native instant scrollIntoView fallback if still outside visible band
      if (
        computeDelta(active.getBoundingClientRect()) !== 0 &&
        typeof active.scrollIntoView === 'function'
      ) {
        try {
          active.scrollIntoView({
            block: 'center',
            inline: 'nearest',
            behavior: 'instant' as ScrollBehavior,
          });
        } catch {
          active.scrollIntoView({ block: 'center', inline: 'nearest' });
        }
      }
    };

    const scheduleScrollIntoVisibleArea = () => {
      clearPendingScrollWork();
      scrollFocusedInputIntoVisibleArea();
      if (typeof window.requestAnimationFrame === 'function') {
        rafId = window.requestAnimationFrame(() => {
          rafId = null;
          scrollFocusedInputIntoVisibleArea();
        });
      }
      for (const delayMs of [60, 180]) {
        scrollTimers.push(
          setTimeout(() => {
            scrollFocusedInputIntoVisibleArea();
          }, delayMs),
        );
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
        scheduleScrollIntoVisibleArea();
      } else if (!nextOpen) {
        clearPendingScrollWork();
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

    const handleActiveInputInteraction = () => {
      if (
        isCompactMobileScreen() &&
        isMobileKeyboardEditableTarget(document.activeElement)
      ) {
        scrollFocusedInputIntoVisibleArea();
      }
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
    document.addEventListener('click', handleActiveInputInteraction, true);
    document.addEventListener('input', handleActiveInputInteraction, true);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleOrientationChange);
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', handleViewportChange);
    }

    syncKeyboardState(false);

    return () => {
      if (blurTimer) clearTimeout(blurTimer);
      clearPendingScrollWork();
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      document.removeEventListener('click', handleActiveInputInteraction, true);
      document.removeEventListener('input', handleActiveInputInteraction, true);
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
      (item.id === 'issues' ||
        item.id === 'finance' ||
        item.id === 'print-quotes') &&
      (isOwnerVerified !== true || role !== 'owner')
    )
      return false;
    if (
      (item.id === 'audit' || item.id === 'system-logs') &&
      role !== 'owner'
    )
      return false;
    if (role === 'staff' && subRole !== 'admin' && item.ownerOnly) return false;
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
            Boolean(item) && isItemVisibleForRole(item!),
        )
    : [];
  const isDetailSubRoute =
    /^\/(work|employees|accounts|storage|issues|payroll|finance)\/[^/]+/.test(
      currentPath,
    ) &&
    currentPath !== '/attendance/review' &&
    currentPath !== '/attendance/corrections' &&
    currentPath !== '/reports/new' &&
    currentPath !== '/finance/history' &&
    currentPath !== '/finance/categories' &&
    currentPath !== '/finance/plan';

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

  const isPrintQuoteEditor =
    currentPath === '/print-quotes/new' ||
    /^\/print-quotes\/[^/]+\/edit$/.test(currentPath);

  return (
    <div
      className="app-shell-root"
      data-mobile-keyboard={isMobileKeyboardOpen ? 'open' : 'closed'}
      data-pq-editor={isPrintQuoteEditor ? 'true' : undefined}
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
            <span className="app-shell-role-text">{userSummary.roleLabel}</span>
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
            data-testid="header-btn-theme-toggle"
            data-theme-pref={themePref}
            data-effective-theme={effectiveTheme}
            aria-label={
              effectiveTheme === 'dark'
                ? 'Chuyển sang giao diện sáng'
                : 'Chuyển sang giao diện tối'
            }
            title={
              effectiveTheme === 'dark'
                ? themePref === 'system'
                  ? 'Đang theo hệ điều hành (Tối) — Bấm để chuyển sang giao diện sáng'
                  : 'Đang dùng giao diện tối — Bấm để chuyển sang giao diện sáng'
                : themePref === 'system'
                  ? 'Đang theo hệ điều hành (Sáng) — Bấm để chuyển sang giao diện tối'
                  : 'Đang dùng giao diện sáng — Bấm để chuyển sang giao diện tối'
            }
            onClick={handleToggleTheme}
            className="app-shell-header-btn"
            style={{
              boxSizing: 'border-box',
              minHeight: '36px',
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'transparent',
              color: 'var(--text-color)',
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
            {effectiveTheme === 'dark' ? (
              <SunIcon size={14} style={{ color: 'var(--warning-text)' }} />
            ) : (
              <MoonIcon size={14} style={{ color: 'var(--accent-text)' }} />
            )}
            <span>{effectiveTheme === 'dark' ? 'Sáng' : 'Tối'}</span>
          </button>
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
          subRole={subRole}
          isOwnerVerified={isOwnerVerified === true}
          collapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleSidebarCollapse}
          userFullName={userFullName}
          userUsername={userUsername}
          userEmail={userEmail}
          employeeCode={employeeCode}
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
          {pendingAssignedTasks.length > 0 && (
            <div
              role="status"
              data-testid="staff-work-reminder-banner"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                padding: '10px 14px',
                marginBottom: '12px',
                borderRadius: '10px',
                backgroundColor: 'var(--warning-subtle)',
                border: '1px solid var(--warning-text)',
                color: 'var(--text-color)',
                fontSize: '13px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flex: '1 1 240px',
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    color: 'var(--warning-text)',
                    flexShrink: 0,
                  }}
                >
                  🔔 Nhắc việc ({pendingAssignedTasks.length}):
                </span>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Bạn có {pendingAssignedTasks.length} công việc được giao chưa
                  báo cáo hoàn thành (
                  {pendingAssignedTasks
                    .slice(0, 2)
                    .map((t) => t.title)
                    .join(', ')}
                  {pendingAssignedTasks.length > 2 ? '…' : ''})
                </span>
              </div>
              <button
                type="button"
                data-testid="btn-goto-assigned-work"
                onClick={() =>
                  onNavigate(
                    pendingAssignedTasks.length === 1
                      ? `/work/${pendingAssignedTasks[0]!.id}`
                      : '/work',
                  )
                }
                style={{
                  minHeight: '34px',
                  padding: '4px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--warning-text)',
                  backgroundColor: 'var(--surface-color)',
                  color: 'var(--warning-text)',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Báo cáo tiến độ →
              </button>
            </div>
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
                    : currentPath === item.path ||
                      currentPath.startsWith(item.path + '/');
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="app-subnav-item"
                    data-active={isItemActive ? 'true' : 'false'}
                    aria-current={isItemActive ? 'page' : undefined}
                    onClick={() => onNavigate(item.path)}
                  >
                    <NavIcon id={item.id} size={15} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
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
          subRole={subRole}
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
            zIndex: 950,
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

            <div
              data-testid="mobile-more-user-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                padding: '12px',
                marginBottom: '16px',
                borderRadius: '10px',
                backgroundColor: 'var(--bg-color)',
                border: '1px solid var(--border-color)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  minWidth: 0,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '999px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--accent-text)',
                    fontSize: '13px',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {userSummary.initials}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: 'var(--text-color)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {userSummary.displayName}
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                    }}
                  >
                    {userSummary.secondaryText}
                  </div>
                </div>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px',
                }}
              >
                <button
                  type="button"
                  data-testid="mobile-user-edit-profile"
                  onClick={() => handleMobileNav('/settings#profile')}
                  style={{
                    boxSizing: 'border-box',
                    minHeight: '38px',
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--surface-color)',
                    color: 'var(--text-color)',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Hồ sơ & Đổi tên
                </button>
                <button
                  type="button"
                  data-testid="mobile-user-change-password"
                  onClick={() => handleMobileNav('/settings#password')}
                  style={{
                    boxSizing: 'border-box',
                    minHeight: '38px',
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--surface-color)',
                    color: 'var(--text-color)',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Đổi mật khẩu
                </button>
              </div>
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
          position: relative;
          bottom: auto !important;
          right: auto !important;
          z-index: 900;
        }
        .app-shell-report-dock .btn-floating-report-bug[data-dragged="true"] {
          position: fixed;
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
          .app-shell-root[data-pq-editor="true"] .mobile-bottom-nav-wrapper,
          .app-shell-root[data-pq-editor="true"] .app-shell-report-dock .btn-floating-report-bug,
          .app-shell-root[data-pq-editor="true"] .btn-floating-report-bug {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
          main {
            padding: 12px 12px calc(88px + env(safe-area-inset-bottom, 0px)) 12px !important;
          }
          .app-shell-root[data-pq-editor="true"] main {
            padding: 12px 12px calc(32px + env(safe-area-inset-bottom, 0px)) 12px !important;
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
