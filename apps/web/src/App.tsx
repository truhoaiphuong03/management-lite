import React, { useState } from 'react';
import { AppShell } from './AppShell.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { DashboardScreen } from './screens/DashboardScreen.js';
import { ClockScreen } from './screens/ClockScreen.js';
import { ReportsScreen } from './screens/ReportsScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { NotFoundScreen } from './screens/NotFoundScreen.js';
import { PlaceholderScreen } from './screens/PlaceholderScreen.js';
import { ROUTE_REGISTRY } from './types.js';
import type { UserRole } from './types.js';

export const App: React.FC = () => {
  const [currentPath, setCurrentPath] = useState<string>('/');
  const [role, setRole] = useState<UserRole>('owner');
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(true);

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogin = (selectedRole: UserRole) => {
    setRole(selectedRole);
    setIsLoggedIn(true);
    setCurrentPath('/');
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setCurrentPath('/login');
  };

  // If viewing login screen
  if (!isLoggedIn || currentPath === '/login') {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // Check RBAC permission for route
  const routeMeta = ROUTE_REGISTRY[currentPath];
  const isForbidden = routeMeta?.ownerOnly && role === 'staff';

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

    switch (currentPath) {
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
