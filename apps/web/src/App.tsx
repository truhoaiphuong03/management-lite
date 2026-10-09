import React, { useState, useEffect } from 'react';
import { AppShell } from './AppShell.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { DashboardScreen } from './screens/DashboardScreen.js';
import { ClockScreen } from './screens/ClockScreen.js';
import { ReportsScreen } from './screens/ReportsScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { EmployeesScreen } from './screens/EmployeesScreen.js';
import { EmployeeNewScreen } from './screens/EmployeeNewScreen.js';
import { EmployeeDetailScreen } from './screens/EmployeeDetailScreen.js';
import { ActivateScreen } from './screens/ActivateScreen.js';
import { NotFoundScreen } from './screens/NotFoundScreen.js';
import { PlaceholderScreen } from './screens/PlaceholderScreen.js';
import { matchRoute } from './router.js';
import type { UserRole } from './types.js';

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
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(true);

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

  // 3. Check active session on initial load
  useEffect(() => {
    let active = true;
    const checkSession = async () => {
      try {
        const res = await fetch('/api/v1/auth/me', {
          credentials: 'include',
        });
        if (res.ok) {
          const body = await res.json();
          if (body.success && active) {
            const userRole = body.data?.active_workspace?.role as UserRole;
            if (userRole) setRole(userRole);
            setIsLoggedIn(true);
            if (window.location.pathname === '/login') {
              handleNavigate('/');
            }
          }
        } else if (active) {
          setIsLoggedIn(false);
        }
      } catch {
        if (active) setIsLoggedIn(false);
      } finally {
        if (active) setIsCheckingSession(false);
      }
    };

    checkSession();
    return () => {
      active = false;
    };
  }, []);

  // 4. Navigation handler synchronizes browser URL (History API)
  const handleNavigate = (path: string) => {
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogin = (selectedRole: UserRole) => {
    setRole(selectedRole);
    setIsLoggedIn(true);
    handleNavigate('/');
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
    } catch {
      // Ignore logout transport errors, proceed to clear local state
    }
    setIsLoggedIn(false);
    handleNavigate('/login');
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

  // If viewing login screen
  if (!isLoggedIn || currentPath === '/login') {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // 4. Dynamic route matching & RBAC resolution
  const { route: routeMeta, params } = matchRoute(currentPath);
  const isForbidden = Boolean(
    (routeMeta?.ownerOnly && role === 'staff') ||
    (routeMeta?.staffOnly && role === 'owner'),
  );

  const renderContent = () => {
    if (isForbidden) {
      const message =
        routeMeta?.staffOnly && role === 'owner'
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
      case '/':
        return <DashboardScreen role={role} onNavigate={handleNavigate} />;
      case '/clock':
        return <ClockScreen role={role} onNavigate={handleNavigate} />;
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
      case '/activate':
        return <ActivateScreen onNavigate={handleNavigate} />;
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
    <AppShell
      currentPath={currentPath}
      onNavigate={handleNavigate}
      role={role}
      onLogout={handleLogout}
    >
      {renderContent()}
    </AppShell>
  );
};
