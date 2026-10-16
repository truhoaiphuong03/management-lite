import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppShell } from './AppShell.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { DashboardScreen } from './screens/DashboardScreen.js';
import { ClockScreen } from './screens/ClockScreen.js';
import { ScheduleScreen } from './screens/ScheduleScreen.js';
import { ReportsScreen } from './screens/ReportsScreen.js';
import {
  SettingsScreen,
  applyTheme,
  removeThemeListener,
} from './screens/SettingsScreen.js';
import { EmployeesScreen } from './screens/EmployeesScreen.js';
import { EmployeeNewScreen } from './screens/EmployeeNewScreen.js';
import { EmployeeDetailScreen } from './screens/EmployeeDetailScreen.js';
import { ActivateScreen } from './screens/ActivateScreen.js';
import { ForgotPasswordScreen } from './screens/ForgotPasswordScreen.js';
import { ResetPasswordScreen } from './screens/ResetPasswordScreen.js';
import {
  installAuthInterceptor,
  addSessionExpiredListener,
  resetSessionExpiredState,
} from './auth-interceptor.js';
import { sanitizePostLoginRedirect } from './navigation-guard.js';
import { AlertTriangleIcon } from '../../../packages/ui/src/components/index.js';
import { NotFoundScreen } from './screens/NotFoundScreen.js';
import { PlaceholderScreen } from './screens/PlaceholderScreen.js';
import { PayrollScreen } from './screens/PayrollScreen.js';
import { WorkScreen } from './screens/WorkScreen.js';
import { AccountsScreen } from './screens/AccountsScreen.js';
import { StorageScreen } from './screens/StorageScreen.js';
import { AuditScreen } from './screens/AuditScreen.js';
import { IssuesScreen } from './screens/IssuesScreen.js';
import { IssueDetailScreen } from './screens/IssueDetailScreen.js';
import { GroupOverviewScreen } from './screens/GroupOverviewScreen.js';
import { FinanceOverviewScreen } from './screens/FinanceOverviewScreen.js';
import { FinanceHistoryScreen } from './screens/FinanceHistoryScreen.js';
import { FinanceEntryScreen } from './screens/FinanceEntryScreen.js';
import { createReceiptApi } from './finance/client.js';
import { FinanceCategoriesScreen } from './screens/FinanceCategoriesScreen.js';
import { FinancePlanScreen } from './screens/FinancePlanScreen.js';
import {
  parseSessionPayload,
  executeSessionVerification,
  executeLogout,
  determinePostVerificationRoute,
  evaluateRouteAccess,
  type ParsedSessionData,
  type SessionStateTracker,
} from './session-manager.js';
import type { UserRole } from './types.js';

export {
  parseSessionPayload,
  executeSessionVerification,
  executeLogout,
  determinePostVerificationRoute,
  evaluateRouteAccess,
  type ParsedSessionData,
  type SessionStateTracker,
};

export const App: React.FC = () => {
  // 1. Initial route from browser URL location (deep link / refresh support)
  const getInitialPath = (): string => {
    if (typeof window !== 'undefined' && window.location.pathname) {
      return window.location.pathname;
    }
    return '/';
  };

  const [currentPath, setCurrentPath] = useState<string>(getInitialPath);
  const [role, setRole] = useState<UserRole>('owner');
  const [verifiedOwnerSession, setVerifiedOwnerSession] =
    useState<boolean>(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(undefined);
  const [workspaceName, setWorkspaceName] = useState<string | undefined>(
    undefined,
  );
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(true);
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [entryRequest, setEntryRequest] = useState(0);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<
    string | null
  >(null);
  const expiryRedirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const clearPendingExpiryTimer = useCallback(() => {
    if (expiryRedirectTimerRef.current !== null) {
      clearTimeout(expiryRedirectTimerRef.current);
      expiryRedirectTimerRef.current = null;
    }
    setSessionExpiredNotice(null);
    resetSessionExpiredState();
  }, []);

  // Global 401 Session Expiry Interceptor:
  // Shows notice for 1.5s, saves return path, resets local state, and navigates to /login
  useEffect(() => {
    installAuthInterceptor();
    const unsubscribe = addSessionExpiredListener(() => {
      setSessionExpiredNotice(
        'Phiên làm việc đã hết hạn hoặc không hợp lệ. Đang chuyển về trang đăng nhập...',
      );

      if (expiryRedirectTimerRef.current !== null) {
        clearTimeout(expiryRedirectTimerRef.current);
      }
      expiryRedirectTimerRef.current = setTimeout(() => {
        expiryRedirectTimerRef.current = null;
        executeLogout(sessionTrackerRef.current);
        syncTrackerToState();
        setSessionExpiredNotice(null);
        resetSessionExpiredState();
        handleNavigate('/login');
      }, 1500);
    });

    return () => {
      unsubscribe();
      if (expiryRedirectTimerRef.current !== null) {
        clearTimeout(expiryRedirectTimerRef.current);
        expiryRedirectTimerRef.current = null;
      }
    };
  }, []);

  const sessionTrackerRef = useRef<SessionStateTracker>({
    authEpoch: 0,
    verifiedOwnerSession: false,
    isLoggedIn: false,
    role: 'owner',
    userId: undefined,
    workspaceId: undefined,
    workspaceName: undefined,
    csrfToken: '',
  });

  const syncTrackerToState = () => {
    const t = sessionTrackerRef.current;
    setVerifiedOwnerSession(t.verifiedOwnerSession);
    setIsLoggedIn(t.isLoggedIn);
    setRole(t.role);
    setUserId(t.userId);
    setWorkspaceId(t.workspaceId);
    setWorkspaceName(t.workspaceName);
    setCsrfToken(t.csrfToken);
  };

  // 2. Synchronize with browser Back and Forward buttons (popstate)
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname || '/';
      setCurrentPath(path);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Online/Offline status detection
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' && 'onLine' in navigator
      ? navigator.onLine
      : true,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Initialize visual theme from preferences
  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem('mglite_theme') || 'dark';
      applyTheme(savedTheme);
    } catch {
      // Ignored
    }
    return () => {
      removeThemeListener();
    };
  }, []);

  // Legacy /finance/new: land on the FIN overview and open the add-entry dialog (no dead URL).
  useEffect(() => {
    if (currentPath === '/finance/new' && verifiedOwnerSession) {
      window.history.replaceState(null, '', '/finance');
      setEntryRequest((n) => n + 1);
      setCurrentPath('/finance');
    }
  }, [currentPath, verifiedOwnerSession]);

  // 3. Authoritative session verification against backend
  const verifySession = useCallback(async (): Promise<boolean> => {
    const ok = await executeSessionVerification(
      sessionTrackerRef.current,
      fetch,
    );
    syncTrackerToState();
    return ok;
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      const verified = await verifySession();
      if (active) {
        setIsCheckingSession(false);
        const targetRoute = determinePostVerificationRoute(
          window.location.pathname,
          verified,
        );
        if (targetRoute) {
          handleNavigate(targetRoute);
        }
      }
    };
    init();
    return () => {
      active = false;
    };
  }, [verifySession]);

  // 4. Navigation handler synchronizes browser URL (History API)
  const handleNavigate = (path: string) => {
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogin = async (selectedRole: UserRole) => {
    clearPendingExpiryTimer();
    setRole(selectedRole);
    setIsCheckingSession(true);
    const verified = await verifySession();
    setIsCheckingSession(false);
    if (verified) {
      let returnUrl: string | null = null;
      try {
        returnUrl = sessionStorage.getItem('post_login_redirect');
        if (returnUrl) {
          sessionStorage.removeItem('post_login_redirect');
        }
      } catch {}

      const targetPath = sanitizePostLoginRedirect(returnUrl);

      handleNavigate(targetPath);
    } else {
      setVerifiedOwnerSession(false);
      setIsLoggedIn(false);
      handleNavigate('/login');
    }
  };

  const handleLogout = async () => {
    clearPendingExpiryTimer();
    executeLogout(sessionTrackerRef.current);
    syncTrackerToState();
    handleNavigate('/login');

    try {
      let token = csrfToken;
      if (!token) {
        try {
          const meRes = await fetch('/api/v1/auth/me', {
            credentials: 'include',
          });
          if (meRes.ok) {
            const meData = await meRes.json();
            token = meData.data?.csrf_token || '';
          }
        } catch {
          // ignore
        }
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['X-CSRF-Token'] = token;

      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({}),
      });
    } catch {
      // Ignore logout transport errors, proceed to clear local state
    }
  };

  // If checking session on startup
  if (isCheckingSession) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0B1220',
          color: '#14B8A6',
          fontSize: '15px',
          fontWeight: 600,
        }}
      >
        Đang khởi động phiên làm việc...
      </div>
    );
  }

  // If viewing activate screen (accessible anonymously with token)
  if (currentPath.startsWith('/activate')) {
    return <ActivateScreen onNavigate={handleNavigate} />;
  }

  // If viewing forgot password screen (accessible anonymously)
  if (currentPath === '/forgot-password') {
    return <ForgotPasswordScreen onNavigate={handleNavigate} />;
  }

  // If viewing reset password screen (accessible anonymously with token)
  if (currentPath.startsWith('/reset-password')) {
    return <ResetPasswordScreen onNavigate={handleNavigate} />;
  }

  const renderExpiredBanner = () => {
    if (!sessionExpiredNotice) return null;
    return (
      <div
        role="alert"
        data-testid="session-expired-banner"
        style={{
          position: 'fixed',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 100000,
          backgroundColor: '#DC2626',
          color: '#FFFFFF',
          padding: '12px 24px',
          borderRadius: '8px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '14px',
          fontWeight: 600,
        }}
      >
        <AlertTriangleIcon size={18} />
        <span>{sessionExpiredNotice}</span>
      </div>
    );
  };

  // If viewing login screen
  if (!isLoggedIn || currentPath === '/login') {
    return (
      <>
        {renderExpiredBanner()}
        <LoginScreen onLogin={handleLogin} onNavigate={handleNavigate} />
      </>
    );
  }

  // 5. Dynamic route matching & RBAC resolution
  const {
    route: routeMeta,
    params,
    isIssuesRoute,
    isForbidden,
  } = evaluateRouteAccess(currentPath, verifiedOwnerSession, role);

  const renderContent = () => {
    if (isForbidden) {
      const message = isIssuesRoute
        ? 'Chức năng Sổ tay Issues chỉ dành riêng cho Chủ sở hữu (Owner) với phiên làm việc hợp lệ được xác thực từ máy chủ.'
        : routeMeta?.staffOnly && role === 'owner'
          ? 'Bạn đang ở chế độ xem Chủ sở hữu (Owner). Tuyến đường này dành riêng cho Nhân viên (theo quy tắc C04/PAY-02: Owner không có phiếu lương cá nhân).'
          : 'Bạn đang ở chế độ xem Nhân viên (Staff). Theo quy tắc RBAC-02, tuyến đường này chỉ dành riêng cho Chủ sở hữu (Owner) của workspace.';
      return (
        <NotFoundScreen
          isForbidden
          message={message}
          onGoHome={() => handleNavigate('/')}
        />
      );
    }

    if (!routeMeta) {
      return (
        <NotFoundScreen
          isForbidden={false}
          onGoHome={() => handleNavigate('/')}
        />
      );
    }

    switch (routeMeta.path) {
      case '/finance':
      case '/finance/history':
      case '/finance/categories':
      case '/finance/plan':
      case '/finance/new':
      case '/finance/entries/:id': {
        if (!verifiedOwnerSession || !userId || !workspaceId)
          return (
            <NotFoundScreen isForbidden onGoHome={() => handleNavigate('/')} />
          );
        const identity = { userId, workspaceId };
        const key = `${userId}:${workspaceId}:${currentPath}`;
        if (routeMeta.path === '/finance' || routeMeta.path === '/finance/new')
          return (
            <FinanceOverviewScreen
              key={`${userId}:${workspaceId}:/finance`}
              identity={identity}
              onNavigate={handleNavigate}
              receipt={createReceiptApi(identity)}
              entryRequest={entryRequest}
            />
          );
        if (routeMeta.path === '/finance/history')
          return (
            <FinanceHistoryScreen
              key={key}
              identity={identity}
              onNavigate={handleNavigate}
            />
          );
        if (routeMeta.path === '/finance/plan')
          return (
            <FinancePlanScreen
              key={key}
              identity={identity}
              onNavigate={handleNavigate}
            />
          );
        if (routeMeta.path === '/finance/categories')
          return (
            <FinanceCategoriesScreen
              key={key}
              identity={identity}
              onNavigate={handleNavigate}
            />
          );
        return (
          <FinanceEntryScreen
            key={key}
            identity={identity}
            onNavigate={handleNavigate}
            receipt={createReceiptApi(identity)}
            {...(params['id'] ? { entryId: params['id'] } : {})}
          />
        );
      }
      case '/':
        return (
          <DashboardScreen
            role={role}
            workspaceName={workspaceName}
            userId={userId}
            workspaceId={workspaceId}
            onNavigate={handleNavigate}
          />
        );
      case '/clock':
        return <ClockScreen role={role} onNavigate={handleNavigate} />;
      case '/schedule':
        return <ScheduleScreen role={role} onNavigate={handleNavigate} />;
      case '/reports':
        return <ReportsScreen role={role} onNavigate={handleNavigate} />;
      case '/employees':
        return <EmployeesScreen onNavigate={handleNavigate} />;
      case '/employees/new':
        return <EmployeeNewScreen onNavigate={handleNavigate} />;
      case '/employees/:id':
        return (
          <EmployeeDetailScreen
            employeeId={params['id'] || ''}
            role={role}
            onNavigate={handleNavigate}
          />
        );
      case '/payroll':
      case '/payroll/:id':
      case '/my-pay':
        return <PayrollScreen role={role} onNavigate={handleNavigate} />;
      case '/work':
        return <WorkScreen role={role} onNavigate={handleNavigate} />;
      case '/work/new':
        return <WorkScreen role={role} isNew onNavigate={handleNavigate} />;
      case '/work/:id':
        return (
          <WorkScreen
            role={role}
            workId={params['id']}
            onNavigate={handleNavigate}
          />
        );
      case '/accounts':
        return <AccountsScreen role={role} onNavigate={handleNavigate} />;
      case '/accounts/:id':
        return (
          <AccountsScreen
            role={role}
            accountId={params['id']}
            onNavigate={handleNavigate}
          />
        );
      case '/storage':
        return <StorageScreen role={role} onNavigate={handleNavigate} />;
      case '/storage/:id':
        return (
          <StorageScreen
            role={role}
            folderId={params['id']}
            onNavigate={handleNavigate}
          />
        );
      case '/activate':
        return <ActivateScreen onNavigate={handleNavigate} />;
      case '/audit':
        return <AuditScreen role={role} onNavigate={handleNavigate} />;
      case '/issues':
        if (!verifiedOwnerSession || role !== 'owner') {
          return (
            <NotFoundScreen isForbidden onGoHome={() => handleNavigate('/')} />
          );
        }
        return (
          <IssuesScreen
            onNavigate={handleNavigate}
            workspaceName={workspaceName}
            workspaceId={workspaceId}
          />
        );
      case '/issues/:id':
        if (!verifiedOwnerSession || role !== 'owner') {
          return (
            <NotFoundScreen isForbidden onGoHome={() => handleNavigate('/')} />
          );
        }
        return (
          <IssueDetailScreen
            issueId={params['id'] || ''}
            role={role}
            csrfToken={csrfToken}
            onNavigate={handleNavigate}
          />
        );
      case '/groups/:groupId':
        return (
          <GroupOverviewScreen
            groupId={params['groupId'] || ''}
            role={role}
            isOwnerVerified={verifiedOwnerSession}
            onNavigate={handleNavigate}
          />
        );
      case '/settings':
        return (
          <SettingsScreen
            role={role}
            onChangeRole={setRole}
            onLogout={handleLogout}
          />
        );
      default:
        return (
          <PlaceholderScreen
            route={routeMeta}
            params={params}
            currentPath={currentPath}
            onGoHome={() => handleNavigate('/')}
          />
        );
    }
  };

  return (
    <>
      {renderExpiredBanner()}
      <AppShell
        currentPath={currentPath}
        onNavigate={handleNavigate}
        role={role}
        isOwnerVerified={verifiedOwnerSession}
        onLogout={handleLogout}
        csrfToken={csrfToken}
        userId={userId}
        workspaceId={workspaceId}
      >
        {!isOnline && (
          <div
            role="status"
            aria-live="assertive"
            data-testid="offline-banner"
            style={{
              backgroundColor: '#DC2626',
              color: '#FFFFFF',
              padding: '10px 16px',
              textAlign: 'center',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              borderRadius: '6px',
              marginBottom: '16px',
            }}
          >
            <span>
              Mất kết nối mạng cục bộ (Offline). Vui lòng kiểm tra Wi-Fi / 4G
              trước khi gửi yêu cầu. Nếu máy chủ phản hồi lỗi, vui lòng thử lại
              sau.
            </span>
          </div>
        )}
        {renderContent()}
      </AppShell>
    </>
  );
};
