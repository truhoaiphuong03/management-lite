import React, { useState, useEffect } from 'react';
import { AppShell } from './AppShell.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { DashboardScreen } from './screens/DashboardScreen.js';
import { ClockScreen } from './screens/ClockScreen.js';
import { ReportsScreen } from './screens/ReportsScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
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
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(true);

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

  // 3. Navigation handler synchronizes browser URL (History API)
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

  const handleLogout = () => {
    setIsLoggedIn(false);
    handleNavigate('/login');
  };

  // If viewing login screen
  if (!isLoggedIn || currentPath === '/login') {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // 4. Dynamic route matching & RBAC resolution
  const { route: routeMeta, params } = matchRoute(currentPath);
  const isForbidden = Boolean(routeMeta?.ownerOnly && role === 'staff');

  const renderContent = () => {
    if (isForbidden) {
      return (
        <NotFoundScreen isForbidden onGoHome={() => handleNavigate('/')} />
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
        return <ClockScreen />;
      case '/reports':
        return <ReportsScreen />;
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
      onChangeRole={setRole}
    >
      {renderContent()}
    </AppShell>
  );
};
