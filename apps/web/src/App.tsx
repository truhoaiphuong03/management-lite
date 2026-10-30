import { managementSsoContinuation } from './navigation-guard.js';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppShell } from './AppShell.js';
import {
  VnDateOfBirthSelect,
  VnBankAutocompleteInput,
} from './components/VnProfileInputs.js';
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
import { VerifyEmailScreen } from './screens/VerifyEmailScreen.js';
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
import { SystemLogsScreen } from './screens/SystemLogsScreen.js';
import { PayrollStatsScreen } from './screens/PayrollStatsScreen.js';
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
  const [initialVerifyToken] = useState<string>(() => {
    if (
      typeof window !== 'undefined' &&
      window.location.pathname.startsWith('/verify-email')
    ) {
      const params = new URLSearchParams(
        window.location.hash.slice(1) || window.location.search,
      );
      return (params.get('token') || '').trim();
    }
    return '';
  });
  const [role, setRole] = useState<UserRole>('owner');
  const [verifiedOwnerSession, setVerifiedOwnerSession] =
    useState<boolean>(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined);
  const [emailVerified, setEmailVerified] = useState<boolean | undefined>(
    undefined,
  );
  const [resendBannerState, setResendBannerState] = useState<
    'idle' | 'sending' | 'sent' | 'error'
  >('idle');
  const [verifyInfo, setVerifyInfo] = useState<{
    delivered: boolean | null;
    sentTo: string | null;
    sentFrom: string | null;
    expires: number;
    error?: string | null;
  } | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyCodeState, setVerifyCodeState] = useState<
    'idle' | 'submitting' | 'success' | 'failed'
  >('idle');
  const [verifyCodeError, setVerifyCodeError] = useState<string | null>(null);
  const [missingPhoneOpen, setMissingPhoneOpen] = useState<boolean>(false);
  const [missingPhoneDismissed, setMissingPhoneDismissed] =
    useState<boolean>(false);
  const [promptPhone, setPromptPhone] = useState<string>('');
  const [promptDob, setPromptDob] = useState<string>('');
  const [promptGender, setPromptGender] = useState<string>('');
  const [promptNationalId, setPromptNationalId] = useState<string>('');
  const [promptAddress, setPromptAddress] = useState<string>('');
  const [promptBankName, setPromptBankName] = useState<string>('');
  const [promptBankNumber, setPromptBankNumber] = useState<string>('');
  const [promptBankHolder, setPromptBankHolder] = useState<string>('');
  const [promptSaving, setPromptSaving] = useState<boolean>(false);
  const [promptError, setPromptError] = useState<string | null>(null);
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
    userEmail: undefined,
    emailVerified: undefined,
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
    setUserEmail(t.userEmail);
    setEmailVerified(t.emailVerified);
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
        const ssoTarget =
          verified && window.location.pathname === '/login'
            ? managementSsoContinuation(window.location.search)
            : null;
        if (ssoTarget) {
          window.location.assign(ssoTarget);
          return;
        }
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

  // Check if authenticated employee is missing phone number -> show popup window to fill it in
  useEffect(() => {
    if (!isLoggedIn || !userId || missingPhoneDismissed) {
      setMissingPhoneOpen(false);
      return;
    }
    let active = true;
    const checkEmployeePhone = async () => {
      try {
        const res = await fetch('/api/v1/employees/me', {
          credentials: 'include',
        });
        if (!active || !res.ok) return;
        const json = await res.json().catch(() => null);
        const emp = json?.data;
        if (
          emp &&
          typeof emp.id === 'string' &&
          typeof emp.employee_code === 'string' &&
          emp.employee_code !== 'OWNER'
        ) {
          const currentPhone =
            typeof emp.phone === 'string' ? emp.phone.trim() : '';
          if (!currentPhone) {
            setPromptPhone('');
            setPromptDob(emp.date_of_birth || '');
            setPromptGender(emp.gender || '');
            setPromptNationalId(emp.national_id || '');
            setPromptAddress(emp.address || '');
            setPromptBankName(emp.bank_name || '');
            setPromptBankNumber(emp.bank_account_number || '');
            setPromptBankHolder(emp.bank_account_holder || '');
            setPromptError(null);
            setMissingPhoneOpen(true);
          } else {
            setMissingPhoneOpen(false);
          }
        }
      } catch {
        // Ignore network errors during background profile check
      }
    };
    void checkEmployeePhone();
    return () => {
      active = false;
    };
  }, [isLoggedIn, userId, missingPhoneDismissed]);

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
      const ssoTarget = managementSsoContinuation(window.location.search);
      if (ssoTarget) {
        window.location.assign(ssoTarget);
        return;
      }
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

  // If viewing email verification screen (accessible anonymously or while logged in)
  if (currentPath.startsWith('/verify-email')) {
    return (
      <VerifyEmailScreen
        initialToken={initialVerifyToken}
        initialEmail={userEmail}
        isEmailVerified={Boolean(emailVerified)}
        isLoggedIn={isLoggedIn}
        onNavigate={handleNavigate}
        onVerified={() => {
          void verifySession();
        }}
      />
    );
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
        return (
          <ClockScreen role={role} mode="clock" onNavigate={handleNavigate} />
        );
      case '/attendance/corrections':
      case '/attendance':
        return (
          <ClockScreen role={role} mode="history" onNavigate={handleNavigate} />
        );
      case '/attendance/review':
        if (role !== 'owner') {
          return (
            <NotFoundScreen isForbidden onGoHome={() => handleNavigate('/')} />
          );
        }
        return (
          <ClockScreen role={role} mode="review" onNavigate={handleNavigate} />
        );
      case '/schedule':
        return <ScheduleScreen role={role} onNavigate={handleNavigate} />;
      case '/reports/new':
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
      case '/payroll/stats':
        return <PayrollStatsScreen role={role} onNavigate={handleNavigate} />;
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
      case '/system-logs':
        return <SystemLogsScreen role={role} onNavigate={handleNavigate} />;
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
        {isLoggedIn && emailVerified === false && (
          <div
            role="status"
            data-testid="unverified-email-banner"
            style={{
              backgroundColor: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid #F59E0B',
              color: '#FBBF24',
              padding: '10px 16px',
              fontSize: '13px',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
              borderRadius: '8px',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangleIcon size={16} />
              <span>
                Email tài khoản chưa được xác minh. Vui lòng xác minh email để
                sử dụng tính năng khôi phục mật khẩu.
                {resendBannerState === 'sent' &&
                  ' (Đã gửi liên kết xác minh qua email)'}
                {resendBannerState === 'error' &&
                  ' (Không thể gửi thư, vui lòng thử lại)'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                data-testid="resend-verification-email-btn"
                disabled={resendBannerState === 'sending'}
                onClick={async () => {
                  setResendBannerState('sending');
                  try {
                    const res = await fetch(
                      '/api/v1/auth/verify-email/request',
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify(
                          userEmail ? { email: userEmail } : {},
                        ),
                      },
                    );
                    setResendBannerState(res.ok ? 'sent' : 'error');
                    if (res.ok) {
                      const json = await res.json().catch(() => null);
                      const d = json?.data ?? {};
                      setVerifyCode('');
                      setVerifyCodeState('idle');
                      setVerifyCodeError(null);
                      setVerifyInfo({
                        delivered:
                          typeof d.delivered === 'boolean' ? d.delivered : null,
                        sentTo:
                          typeof d.sent_to === 'string' ? d.sent_to : null,
                        sentFrom:
                          typeof d.sent_from === 'string' ? d.sent_from : null,
                        expires:
                          typeof d.expires_in_minutes === 'number'
                            ? d.expires_in_minutes
                            : 15,
                        error:
                          typeof d.delivery_error === 'string'
                            ? d.delivery_error
                            : null,
                      });
                    }
                  } catch {
                    setResendBannerState('error');
                  }
                }}
                style={{
                  backgroundColor: '#F59E0B',
                  color: '#0F172A',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {resendBannerState === 'sending'
                  ? 'Đang gửi...'
                  : 'Gửi lại email xác minh'}
              </button>
              <button
                type="button"
                data-testid="open-verify-email-page-btn"
                onClick={() =>
                  setVerifyInfo(
                    (prev) =>
                      prev ?? {
                        delivered: null,
                        sentTo: null,
                        sentFrom: null,
                        expires: 15,
                      },
                  )
                }
                style={{
                  backgroundColor: 'transparent',
                  color: '#F8FAFC',
                  border: '1px solid #475569',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Nhập mã xác minh
              </button>
            </div>
          </div>
        )}
        {isLoggedIn && emailVerified === false && verifyInfo && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Xác minh email"
            data-testid="verify-email-code-dialog"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(2, 6, 23, 0.7)',
              padding: '16px',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '440px',
                backgroundColor: '#0F172A',
                border: '1px solid #334155',
                borderRadius: '12px',
                padding: '20px',
                color: '#F8FAFC',
              }}
            >
              <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>
                Xác minh email tài khoản
              </h3>
              {verifyInfo.delivered === true && (
                <div
                  data-testid="verify-email-sent-notice"
                  style={{
                    background: 'rgba(16,185,129,0.12)',
                    border: '1px solid #10B981',
                    color: '#6EE7B7',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    fontSize: '13px',
                    marginBottom: '12px',
                  }}
                >
                  ✅ Đã gửi mail xác minh thành công tới{' '}
                  <strong>{verifyInfo.sentTo}</strong>
                  {verifyInfo.sentFrom
                    ? ` (gửi từ ${verifyInfo.sentFrom})`
                    : ''}
                  . Mã có hiệu lực {verifyInfo.expires} phút. Vui lòng mở hộp
                  thư này và nhập mã bên dưới.
                </div>
              )}
              {verifyInfo.delivered === false && (
                <div
                  style={{
                    background: 'rgba(239,68,68,0.12)',
                    border: '1px solid #EF4444',
                    color: '#FCA5A5',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    fontSize: '13px',
                    marginBottom: '12px',
                  }}
                >
                  ❌ Không gửi được mail tới{' '}
                  <strong>{verifyInfo.sentTo}</strong>. Vui lòng kiểm tra địa
                  chỉ email tài khoản hoặc thử gửi lại.
                  {verifyInfo.error && (
                    <div
                      style={{
                        marginTop: '6px',
                        fontSize: '12px',
                        opacity: 0.85,
                      }}
                    >
                      Lý do kỹ thuật:{' '}
                      {verifyInfo.error === 'mailer_not_configured'
                        ? 'máy chủ chưa cấu hình dịch vụ gửi mail (thiếu BREVO_API_KEY)'
                        : verifyInfo.error === 'http_401'
                          ? 'khóa Brevo không hợp lệ'
                          : verifyInfo.error === 'http_400'
                            ? 'địa chỉ gửi/nhận bị Brevo từ chối (sender chưa xác thực?)'
                            : verifyInfo.error}
                    </div>
                  )}
                </div>
              )}
              {verifyInfo.delivered === null && (
                <div
                  style={{
                    fontSize: '13px',
                    color: '#CBD5E1',
                    marginBottom: '12px',
                  }}
                >
                  Nhập mã xác minh đã nhận trong email{' '}
                  {userEmail ? <strong>{userEmail}</strong> : 'của bạn'}.
                </div>
              )}
              {userEmail && /\.local$/i.test(userEmail) && (
                <div
                  style={{
                    fontSize: '12px',
                    color: '#FBBF24',
                    marginBottom: '12px',
                  }}
                >
                  ⚠️ Email tài khoản hiện tại ({userEmail}) là địa chỉ nội bộ,
                  không thể nhận thư. Hãy đổi sang email thật trong Hồ sơ trước
                  khi xác minh.
                </div>
              )}
              <label
                htmlFor="verify-code-input"
                style={{ fontSize: '12px', color: '#94A3B8' }}
              >
                Mã xác minh
              </label>
              <input
                id="verify-code-input"
                data-testid="verify-email-code-input"
                value={verifyCode}
                autoFocus
                autoComplete="one-time-code"
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="Dán mã xác minh từ email"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  margin: '4px 0 8px',
                  padding: '10px 12px',
                  fontSize: '16px',
                  borderRadius: '8px',
                  border: '1px solid #475569',
                  backgroundColor: '#1E293B',
                  color: '#F8FAFC',
                }}
              />
              {verifyCodeError && (
                <div
                  role="alert"
                  style={{
                    color: '#FCA5A5',
                    fontSize: '12px',
                    marginBottom: '8px',
                  }}
                >
                  {verifyCodeError}
                </div>
              )}
              {verifyCodeState === 'success' && (
                <div
                  style={{
                    color: '#6EE7B7',
                    fontSize: '13px',
                    marginBottom: '8px',
                  }}
                >
                  ✅ Xác minh email thành công!
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  justifyContent: 'flex-end',
                }}
              >
                <button
                  type="button"
                  onClick={() => setVerifyInfo(null)}
                  style={{
                    background: 'transparent',
                    color: '#F8FAFC',
                    border: '1px solid #475569',
                    borderRadius: '6px',
                    padding: '8px 14px',
                    cursor: 'pointer',
                  }}
                >
                  Đóng
                </button>
                <button
                  type="button"
                  data-testid="verify-email-code-submit"
                  disabled={
                    verifyCodeState === 'submitting' || !verifyCode.trim()
                  }
                  onClick={async () => {
                    setVerifyCodeState('submitting');
                    setVerifyCodeError(null);
                    try {
                      const res = await fetch(
                        '/api/v1/auth/verify-email/confirm',
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify({ token: verifyCode.trim() }),
                        },
                      );
                      if (!res.ok) {
                        const j = await res.json().catch(() => null);
                        const code = j?.error?.code;
                        setVerifyCodeState('failed');
                        setVerifyCodeError(
                          code === 'TOKEN_EXPIRED'
                            ? 'Mã đã hết hạn. Vui lòng bấm "Gửi lại email xác minh".'
                            : code === 'RATE_LIMITED'
                              ? 'Nhập sai quá nhiều lần. Vui lòng thử lại sau ít phút.'
                              : 'Mã xác minh không đúng hoặc đã được sử dụng.',
                        );
                        return;
                      }
                      setVerifyCodeState('success');
                      await verifySession();
                      setTimeout(() => setVerifyInfo(null), 1200);
                    } catch {
                      setVerifyCodeState('failed');
                      setVerifyCodeError(
                        'Lỗi kết nối máy chủ. Vui lòng thử lại.',
                      );
                    }
                  }}
                  style={{
                    backgroundColor: '#14B8A6',
                    color: '#0F172A',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '8px 14px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {verifyCodeState === 'submitting'
                    ? 'Đang xác nhận...'
                    : 'Xác nhận'}
                </button>
              </div>
            </div>
          </div>
        )}
        {isLoggedIn && missingPhoneOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Bổ sung thông tin nhân viên"
            data-testid="missing-phone-modal"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1100,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(2, 6, 23, 0.78)',
              padding: '16px',
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '520px',
                backgroundColor: '#0F172A',
                border: '1px solid #14B8A6',
                borderRadius: '14px',
                padding: '22px',
                color: '#F8FAFC',
                boxShadow: '0 24px 48px rgba(0, 0, 0, 0.6)',
              }}
            >
              <h3
                style={{
                  margin: '0 0 6px',
                  fontSize: '17px',
                  fontWeight: 700,
                  color: '#14B8A6',
                }}
              >
                📱 Bổ sung thông tin hồ sơ nhân viên
              </h3>
              <p
                style={{
                  margin: '0 0 16px',
                  fontSize: '13px',
                  color: '#CBD5E1',
                  lineHeight: 1.5,
                }}
              >
                Chỉ bắt buộc điền{' '}
                <strong style={{ color: '#F8FAFC' }}>
                  Số điện thoại liên hệ (*)
                </strong>
                . Các thông tin khác (Ngày sinh, Giới tính, Số CCCD/CMND, Địa chỉ,
                Ngân hàng) đều <strong>không bắt buộc</strong> — có thể điền hoặc
                bỏ trống.
              </p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                  gap: '12px',
                  marginBottom: '12px',
                }}
              >
                <div>
                  <label
                    htmlFor="missing-phone-input"
                    style={{ fontSize: '12px', color: '#94A3B8' }}
                  >
                    Số điện thoại liên hệ{' '}
                    <span style={{ color: '#EF4444', fontWeight: 700 }}>
                      * (Bắt buộc)
                    </span>
                  </label>
                  <input
                    id="missing-phone-input"
                    data-testid="missing-phone-input"
                    type="tel"
                    inputMode="tel"
                    autoFocus
                    value={promptPhone}
                    onChange={(e) => setPromptPhone(e.target.value)}
                    placeholder="VD: 0901234567"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: '4px',
                      padding: '10px 12px',
                      fontSize: '15px',
                      borderRadius: '8px',
                      border: '1px solid #14B8A6',
                      backgroundColor: '#1E293B',
                      color: '#F8FAFC',
                    }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="missing-dob-input"
                    style={{ fontSize: '12px', color: '#94A3B8' }}
                  >
                    Ngày sinh (Ngày / Tháng / Năm — Không bắt buộc)
                  </label>
                  <VnDateOfBirthSelect
                    id="missing-dob-input"
                    testId="missing-dob-input"
                    value={promptDob}
                    onChange={setPromptDob}
                  />
                </div>

                <div>
                  <label
                    htmlFor="missing-gender-input"
                    style={{ fontSize: '12px', color: '#94A3B8' }}
                  >
                    Giới tính{' '}
                    <span style={{ color: '#64748B' }}>(Không bắt buộc)</span>
                  </label>
                  <select
                    id="missing-gender-input"
                    value={promptGender}
                    onChange={(e) => setPromptGender(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: '4px',
                      padding: '10px 12px',
                      fontSize: '14px',
                      borderRadius: '8px',
                      border: '1px solid #475569',
                      backgroundColor: '#1E293B',
                      color: '#F8FAFC',
                    }}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Nam">Nam</option>
                    <option value="Nữ">Nữ</option>
                    <option value="Khác">Khác</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="missing-cccd-input"
                    style={{ fontSize: '12px', color: '#94A3B8' }}
                  >
                    Số CCCD / CMND{' '}
                    <span style={{ color: '#64748B' }}>(Không bắt buộc)</span>
                  </label>
                  <input
                    id="missing-cccd-input"
                    type="text"
                    value={promptNationalId}
                    onChange={(e) => setPromptNationalId(e.target.value)}
                    placeholder="Có thể bỏ trống (VD: 079200012345)"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: '4px',
                      padding: '10px 12px',
                      fontSize: '14px',
                      borderRadius: '8px',
                      border: '1px solid #475569',
                      backgroundColor: '#1E293B',
                      color: '#F8FAFC',
                    }}
                  />
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <label
                    htmlFor="missing-address-input"
                    style={{ fontSize: '12px', color: '#94A3B8' }}
                  >
                    Địa chỉ nơi ở hiện tại{' '}
                    <span style={{ color: '#64748B' }}>(Không bắt buộc)</span>
                  </label>
                  <input
                    id="missing-address-input"
                    type="text"
                    value={promptAddress}
                    onChange={(e) => setPromptAddress(e.target.value)}
                    placeholder="Không bắt buộc — Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: '4px',
                      padding: '10px 12px',
                      fontSize: '14px',
                      borderRadius: '8px',
                      border: '1px solid #475569',
                      backgroundColor: '#1E293B',
                      color: '#F8FAFC',
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  backgroundColor: '#0B1220',
                  border: '1px solid #334155',
                  marginBottom: '12px',
                }}
              >
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#14B8A6',
                    marginBottom: '8px',
                  }}
                >
                  🏦 Thông tin ngân hàng nhận lương (Không bắt buộc)
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fit, minmax(min(100%, 140px), 1fr))',
                    gap: '8px',
                  }}
                >
                  <VnBankAutocompleteInput
                    testId="missing-bank-name-input"
                    value={promptBankName}
                    onChange={setPromptBankName}
                    placeholder="🔍 Tìm tên ngân hàng (MB, VCB...)"
                  />
                  <input
                    type="text"
                    value={promptBankNumber}
                    onChange={(e) => setPromptBankNumber(e.target.value)}
                    placeholder="Số tài khoản"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      fontSize: '13px',
                      borderRadius: '6px',
                      border: '1px solid #475569',
                      backgroundColor: '#1E293B',
                      color: '#F8FAFC',
                    }}
                  />
                  <input
                    type="text"
                    value={promptBankHolder}
                    onChange={(e) =>
                      setPromptBankHolder(e.target.value.toUpperCase())
                    }
                    placeholder="CHỦ TÀI KHOẢN"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      fontSize: '13px',
                      borderRadius: '6px',
                      border: '1px solid #475569',
                      backgroundColor: '#1E293B',
                      color: '#F8FAFC',
                    }}
                  />
                </div>
              </div>

              {promptError && (
                <div
                  role="alert"
                  style={{
                    color: '#FCA5A5',
                    fontSize: '12px',
                    marginBottom: '10px',
                  }}
                >
                  {promptError}
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  gap: '10px',
                  justifyContent: 'flex-end',
                }}
              >
                <button
                  type="button"
                  data-testid="missing-phone-dismiss"
                  onClick={() => {
                    setMissingPhoneDismissed(true);
                    setMissingPhoneOpen(false);
                  }}
                  style={{
                    background: 'transparent',
                    color: '#94A3B8',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                    padding: '9px 14px',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Để sau
                </button>
                <button
                  type="button"
                  data-testid="missing-phone-submit"
                  disabled={promptSaving}
                  onClick={async () => {
                    const compact = promptPhone.replace(/[\s.\-()]/g, '');
                    if (!/^\+?[0-9]{8,15}$/.test(compact)) {
                      setPromptError(
                        'Vui lòng nhập số điện thoại hợp lệ (từ 8 đến 15 chữ số).',
                      );
                      return;
                    }
                    setPromptSaving(true);
                    setPromptError(null);
                    try {
                      let token = csrfToken;
                      if (!token) {
                        const meRes = await fetch('/api/v1/auth/me', {
                          credentials: 'include',
                        });
                        if (meRes.ok) {
                          const meJson = await meRes.json().catch(() => null);
                          token = meJson?.data?.csrf_token || '';
                        }
                      }
                      const headers: Record<string, string> = {
                        'Content-Type': 'application/json',
                      };
                      if (token) headers['X-CSRF-Token'] = token;
                      const res = await fetch('/api/v1/auth/profile', {
                        method: 'PATCH',
                        headers,
                        credentials: 'include',
                        body: JSON.stringify({
                          phone: compact,
                          date_of_birth: promptDob.trim() || null,
                          gender: promptGender.trim() || null,
                          national_id: promptNationalId.trim() || null,
                          address: promptAddress.trim() || null,
                          bank_name: promptBankName.trim() || null,
                          bank_account_number: promptBankNumber.trim() || null,
                          bank_account_holder:
                            promptBankHolder.trim().toUpperCase() || null,
                        }),
                      });
                      const data = await res.json().catch(() => null);
                      if (!res.ok) {
                        setPromptError(
                          data?.error?.message ||
                            'Không thể lưu thông tin. Vui lòng thử lại.',
                        );
                        return;
                      }
                      setMissingPhoneOpen(false);
                      setMissingPhoneDismissed(true);
                    } catch {
                      setPromptError('Lỗi kết nối máy chủ. Vui lòng thử lại.');
                    } finally {
                      setPromptSaving(false);
                    }
                  }}
                  style={{
                    backgroundColor: '#14B8A6',
                    color: '#0F172A',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '9px 18px',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {promptSaving ? 'Đang lưu...' : 'Lưu thông tin'}
                </button>
              </div>
            </div>
          </div>
        )}
        {renderContent()}
      </AppShell>
    </>
  );
};
